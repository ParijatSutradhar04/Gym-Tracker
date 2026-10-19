import asyncio
import re

import asyncpg
import pytest

from app.services import sync
from tests.conftest import TEST_DATABASE_URL, CountingConnection
from tests.samples import entry, sample_row

ISO_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
T1 = "2026-10-19T12:00:00.000Z"
T2 = "2026-10-19T12:00:01.000Z"


def row_ids(body):
    return [c["row"]["id"] for c in body["changes"]]


async def pull_all(pull, cursor=0, limit=10):
    """Pages until hasMore is false; returns (row ids in order, final cursor)."""
    ids = []
    while True:
        body = (await pull(cursor=cursor, limit=limit)).json()
        ids += row_ids(body)
        cursor = body["cursor"]
        if not body["hasMore"]:
            return ids, cursor


async def test_pull_returns_changes_in_seq_order_across_tables(push, pull):
    pushed = [entry("days"), entry("sets"), entry("routines")]
    for e in pushed:
        await push([e])
    r = await pull()
    assert r.status_code == 200
    body = r.json()
    assert [(c["table"], c["row"]["id"]) for c in body["changes"]] == [(e["table"], e["row"]["id"]) for e in pushed]
    assert body["hasMore"] is False


async def test_cursor_pages_without_gaps_or_repeats(push, pull):
    entries = [entry("sets") for _ in range(5)]
    await push(entries)
    cursor, sizes, more, seen = 0, [], [], []
    for _ in range(3):
        body = (await pull(cursor=cursor, limit=2)).json()
        sizes.append(len(body["changes"]))
        more.append(body["hasMore"])
        seen += row_ids(body)
        cursor = body["cursor"]
    assert sizes == [2, 2, 1]
    assert more == [True, True, False]
    assert sorted(seen) == sorted(e["row"]["id"] for e in entries)


async def test_cursor_is_server_assigned_not_client_updatedAt(push, pull):
    await push([entry("sets", updatedAt="2026-10-19T12:00:00.000Z")])
    noted = (await pull()).json()["cursor"]
    b = entry("sets", updatedAt="2000-01-01T00:00:00.000Z")
    await push([b])
    assert row_ids((await pull(cursor=noted)).json()) == [b["row"]["id"]]


async def test_update_moves_a_row_to_a_later_seq(push, pull):
    a = sample_row("sets", updatedAt=T1)
    b = sample_row("sets")
    await push([{"id": "e1", "table": "sets", "row": a}])
    await push([{"id": "e2", "table": "sets", "row": b}])
    noted = (await pull()).json()["cursor"]
    await push([{"id": "e3", "table": "sets", "row": {**a, "reps": 12, "updatedAt": T2}}])
    assert row_ids((await pull()).json()) == [b["id"], a["id"]]
    later = (await pull(cursor=noted)).json()["changes"]
    assert [(c["row"]["id"], c["row"]["reps"]) for c in later] == [(a["id"], 12)]


async def test_tombstones_are_returned_with_deletedAt(push, pull):
    row = sample_row("day_exercises", updatedAt=T1)
    await push([{"id": "e1", "table": "day_exercises", "row": row}])
    await push([{"id": "e2", "table": "day_exercises", "row": {**row, "updatedAt": T2, "deletedAt": T2}}])
    [change] = (await pull()).json()["changes"]
    assert change["row"]["deletedAt"] == T2


async def test_wire_shape_is_camelCase_without_user_id_or_seq(push, pull):
    s = sample_row("sets", updatedAt="2026-10-19T12:00:00.123Z")
    d = sample_row("days")
    await push([{"id": "e1", "table": "sets", "row": s}, {"id": "e2", "table": "days", "row": d}])
    body = (await pull()).json()
    rows = {c["table"]: c["row"] for c in body["changes"]}
    assert set(rows["sets"]) == {"id", "updatedAt", "deletedAt", "dayExerciseId", "setNumber", "reps", "weightKg"}
    assert rows["sets"]["updatedAt"] == "2026-10-19T12:00:00.123Z"
    assert rows["sets"] == s
    assert rows["days"]["date"] == "2026-10-19"
    assert rows["days"] == d
    assert body["serverTime"].endswith("Z")
    assert ISO_MS.match(body["serverTime"])


@pytest.mark.parametrize(
    "params", [{"limit": 1001}, {"limit": 0}, {"cursor": -1}, {"cursor": "abc"}, {"cursor": 2**63}]
)
async def test_limit_and_cursor_validation(pull, params):
    r = await pull(**params)
    assert r.status_code == 400


async def test_omitted_limit_and_cursor_default_to_500_and_0(push, pull):
    first = None
    for size in (200, 200, 101):
        batch = [entry("sets") for _ in range(size)]
        first = first or batch[0]["row"]["id"]
        await push(batch)
    body = (await pull()).json()
    assert len(body["changes"]) == 500
    assert body["hasMore"] is True
    assert body["changes"][0]["row"]["id"] == first


async def test_empty_pull_returns_the_request_cursor_and_hasMore_false(pull):
    body = (await pull(cursor=12345)).json()
    assert body == {"changes": [], "cursor": 12345, "hasMore": False, "serverTime": body["serverTime"]}


async def test_pull_requires_a_token(client):
    assert (await client.get("/api/sync/pull")).status_code == 401


async def test_pull_uses_one_query(push, db, user_a):
    await push([entry(t) for t in ("sets", "days", "routines")])
    conn = CountingConnection(db)
    result = await sync.pull(conn, user_a, 0, 500)
    assert len(result["changes"]) == 3
    assert conn.statements == 1


async def test_concurrent_pushes_for_one_user_serialize(push, pull):
    first, second = [entry("sets") for _ in range(50)], [entry("sets") for _ in range(50)]
    await asyncio.gather(push(first), push(second))
    ids, _ = await pull_all(pull)
    assert len(ids) == len(set(ids)) == 100
    assert set(ids) == {e["row"]["id"] for e in first + second}


async def test_a_pull_never_passes_rows_of_a_push_still_in_flight(push, pull, db, user_a):
    """A later push must not commit (and become pullable) ahead of an earlier, still-open one."""
    first, second = [entry("sets") for _ in range(50)], [entry("days") for _ in range(50)]
    holder = await asyncpg.connect(dsn=TEST_DATABASE_URL)
    tx = holder.transaction()
    await tx.start()
    try:
        await sync.push(holder, user_a, first)  # seqs assigned, not yet committed
        second_push = asyncio.create_task(push(second))
        waiting = "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
        for _ in range(500):
            if second_push.done() or await db.fetchval(waiting):
                break
            await asyncio.sleep(0.01)
        seen, cursor = await pull_all(pull)
        await tx.commit()
    finally:
        await holder.close()
    await second_push
    more, _ = await pull_all(pull, cursor=cursor)
    assert set(seen + more) == {e["row"]["id"] for e in first + second}
