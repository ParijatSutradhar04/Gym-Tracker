import re
from decimal import Decimal

import pytest

from app.rows import to_wire
from app.services import sync
from tests.conftest import SYNCED_TABLES, CountingConnection, bearer
from tests.samples import entry, sample_row

T1 = "2026-10-19T12:00:00.000Z"
T2 = "2026-10-19T12:00:01.000Z"
EARLIER = "2026-10-19T11:59:00.000Z"
ISO_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


async def fetch_one(db, table, row_id):
    return await db.fetchrow(f"SELECT * FROM {table} WHERE id = $1", row_id)


async def test_push_creates_rows_in_all_seven_tables_stamped_with_the_token_user(push, db, user_a):
    entries = [entry(t) for t in SYNCED_TABLES]
    r = await push(entries)
    assert r.status_code == 200
    body = r.json()
    assert sorted(body["acked"]) == sorted(e["id"] for e in entries)
    assert body["rejected"] == []
    assert ISO_MS.match(body["serverTime"])
    for t in SYNCED_TABLES:
        rows = await db.fetch(f"SELECT user_id::text AS user_id FROM {t}")
        assert [r["user_id"] for r in rows] == [user_a]


async def test_push_requires_a_token(client):
    r = await client.post("/api/sync/push", json={"entries": []})
    assert r.status_code == 401


async def test_lww_newer_updatedAt_wins(push, db):
    row = sample_row("sets", reps=8, updatedAt=T1)
    await push([{"id": "e1", "table": "sets", "row": row}])
    await push([{"id": "e2", "table": "sets", "row": {**row, "reps": 10, "updatedAt": T2}}])
    assert (await fetch_one(db, "sets", row["id"]))["reps"] == 10
    r = await push([{"id": "e3", "table": "sets", "row": {**row, "reps": 5, "updatedAt": EARLIER}}])
    assert r.json()["acked"] == ["e3"]
    assert (await fetch_one(db, "sets", row["id"]))["reps"] == 10


async def test_equal_updatedAt_is_a_noop_and_acked(push, db):
    row = sample_row("sets")
    await push([{"id": "e1", "table": "sets", "row": row}])
    seq = (await fetch_one(db, "sets", row["id"]))["seq"]
    r = await push([{"id": "e2", "table": "sets", "row": {**row, "reps": 99}}])
    assert r.json()["acked"] == ["e2"]
    stored = await fetch_one(db, "sets", row["id"])
    assert (stored["seq"], stored["reps"]) == (seq, 8)


async def test_retried_batch_is_idempotent(push, db):
    entries = [entry("sets"), entry("sets"), entry("days"), entry("day_exercises"), entry("routines")]
    ids = sorted(e["id"] for e in entries)

    async def snapshot():
        out = []
        for t in ("sets", "days", "day_exercises", "routines"):
            out += [dict(r) for r in await db.fetch(f"SELECT * FROM {t} ORDER BY id")]
        return out

    first = await push(entries)
    before = await snapshot()
    second = await push(entries)
    after = await snapshot()
    assert sorted(first.json()["acked"]) == ids
    assert sorted(second.json()["acked"]) == ids
    assert len(after) == 5
    assert after == before


async def test_tombstone_wins_when_newer_and_older_tombstone_is_ignored(push, db):
    deleted = sample_row("day_exercises", updatedAt=T1)
    await push([{"id": "e1", "table": "day_exercises", "row": deleted}])
    await push([{"id": "e2", "table": "day_exercises", "row": {**deleted, "updatedAt": T2, "deletedAt": T2}}])
    assert (await fetch_one(db, "day_exercises", deleted["id"]))["deleted_at"] is not None

    live = sample_row("day_exercises", updatedAt=T2)
    await push([{"id": "e3", "table": "day_exercises", "row": live}])
    r = await push([{"id": "e4", "table": "day_exercises", "row": {**live, "updatedAt": T1, "deletedAt": T1}}])
    assert r.json()["acked"] == ["e4"]
    assert (await fetch_one(db, "day_exercises", live["id"]))["deleted_at"] is None


async def test_newer_live_row_revives_a_tombstone(push, db):
    row = sample_row("sets", updatedAt=T1, deletedAt=T1)
    await push([{"id": "e1", "table": "sets", "row": row}])
    await push([{"id": "e2", "table": "sets", "row": {**row, "updatedAt": T2, "deletedAt": None}}])
    assert (await fetch_one(db, "sets", row["id"]))["deleted_at"] is None


async def test_invalid_entry_is_rejected_without_blocking_valid_entries(push, db):
    good1, bad, good2 = entry("sets"), entry("sets", reps=1000), entry("sets")
    r = await push([good1, bad, good2])
    assert r.status_code == 200
    body = r.json()
    assert sorted(body["acked"]) == sorted([good1["id"], good2["id"]])
    assert [x["id"] for x in body["rejected"]] == [bad["id"]]
    assert body["rejected"][0]["reason"]
    assert await db.fetchval("SELECT count(*) FROM sets") == 2


MISSING = object()


@pytest.mark.parametrize(
    "table, overrides",
    [
        ("foo", {}),
        ("sets", {"id": "not-a-uuid"}),
        ("sets", {"updatedAt": MISSING}),
        ("sets", {"updatedAt": "2026-10-19"}),
        ("days", {"date": "2026-13-40"}),
        ("routine_versions", {"repeatRule": "daily"}),
        ("shifts", {"mode": "x"}),
        ("days", {"status": "late"}),
        ("sets", {"setNumber": 0}),
        ("sets", {"reps": -1}),
        ("sets", {"reps": 1000}),
        ("sets", {"weightKg": -1}),
        ("sets", {"weightKg": 1001}),
        ("day_exercises", {"name": "x" * 201}),
        ("routine_versions", {"exercises": "Bench"}),
        ("day_exercises", {"position": -1}),
        ("sets", {"id": "0000000A-0000-4000-8000-000000000001"}),
        ("sets", {"reps": True}),
        ("sets", {"weightKg": "22.5"}),
        ("day_exercises", {"position": 2**31}),
        ("day_exercises", {"performedOrder": 0}),
        ("day_exercises", {"performedOrder": -1}),
        ("day_exercises", {"performedOrder": 1.5}),
        ("sets", {"isDrop": "true"}),
        ("sets", {"isDrop": 1}),
        ("day_exercises", {"name": "Bench\x00"}),
        ("shifts", {"before": [{"table": "days", "row": {"title": "\ud800"}}]}),
    ],
)
async def test_invalid_rows_are_rejected(push, db, table, overrides):
    base = sample_row(table if table in SYNCED_TABLES else "sets")
    row = {k: v for k, v in {**base, **overrides}.items() if v is not MISSING}
    r = await push([{"id": "bad", "table": table, "row": row}])
    assert r.status_code == 200
    body = r.json()
    assert body["acked"] == []
    assert [x["id"] for x in body["rejected"]] == ["bad"]
    assert body["rejected"][0]["reason"]
    if table in SYNCED_TABLES:
        assert await db.fetchval(f"SELECT count(*) FROM {table}") == 0


async def test_a_row_postgres_cannot_store_does_not_fail_the_batch(push, db):
    good, bad = entry("sets"), entry("day_exercises", name="Bench\x00")
    r = await push([good, bad])
    assert r.status_code == 200
    assert r.json()["acked"] == [good["id"]]
    assert await db.fetchval("SELECT count(*) FROM sets") == 1


async def test_client_supplied_user_id_is_ignored(push, db, user_a, user_b):
    e = entry("sets", userId=user_b)
    await push([e])
    owners = await db.fetch("SELECT user_id::text AS u FROM sets")
    assert [o["u"] for o in owners] == [user_a]


async def test_batch_over_200_is_413_and_exactly_200_is_ok(push, db):
    r = await push([entry("sets") for _ in range(201)])
    assert r.status_code == 413
    assert r.json()["error"]
    assert await db.fetchval("SELECT count(*) FROM sets") == 0
    r = await push([entry("sets") for _ in range(200)])
    assert r.status_code == 200
    assert len(r.json()["acked"]) == 200
    assert await db.fetchval("SELECT count(*) FROM sets") == 200


async def test_empty_batch_is_ok(push):
    r = await push([])
    assert r.status_code == 200
    assert (r.json()["acked"], r.json()["rejected"]) == ([], [])


@pytest.mark.parametrize("body", [[], {"entries": "x"}, {"rows": []}, {"entries": [{"table": "sets"}]}])
async def test_malformed_body_is_400(client, make_token, user_a, body):
    r = await client.post("/api/sync/push", json=body, headers=bearer(make_token(user_a)))
    assert r.status_code == 400


async def test_duplicate_ids_in_one_batch_keep_the_newest(push, db):
    row = sample_row("sets")
    tie = sample_row("sets")
    entries = [
        {"id": "a1", "table": "sets", "row": {**row, "reps": 8, "updatedAt": T1}},
        {"id": "a2", "table": "sets", "row": {**row, "reps": 9, "updatedAt": T2}},
        {"id": "a3", "table": "sets", "row": {**row, "reps": 7, "updatedAt": EARLIER}},
        {"id": "b1", "table": "sets", "row": {**tie, "reps": 1}},
        {"id": "b2", "table": "sets", "row": {**tie, "reps": 2}},
    ]
    r = await push(entries)
    assert sorted(r.json()["acked"]) == ["a1", "a2", "a3", "b1", "b2"]
    assert (await fetch_one(db, "sets", row["id"]))["reps"] == 9
    assert (await fetch_one(db, "sets", tie["id"]))["reps"] == 2


async def test_json_and_decimal_columns_round_trip(push, db):
    version = sample_row("routine_versions", exercises=["Bench press", "Cable fly"])
    day_row = sample_row("days")
    shift = sample_row(
        "shifts",
        created=[{"table": "days", "id": day_row["id"]}],
        before=[{"table": "days", "row": day_row}],
    )
    heavy, light = sample_row("sets", weightKg=22.5), sample_row("sets", weightKg=2.5, reps=None)
    rows = [("routine_versions", version), ("shifts", shift), ("sets", heavy), ("sets", light)]
    r = await push([{"id": f"e{i}", "table": t, "row": row} for i, (t, row) in enumerate(rows)])
    assert len(r.json()["acked"]) == 4
    assert (await fetch_one(db, "sets", heavy["id"]))["weight_kg"] == Decimal("22.50")
    assert (await fetch_one(db, "sets", light["id"]))["weight_kg"] == Decimal("2.50")
    for t, row in rows:
        assert to_wire(t, await fetch_one(db, t, row["id"])) == row


async def test_database_error_rolls_back_the_whole_batch(push, db, monkeypatch):
    monkeypatch.setitem(sync.UPSERT_SQL, "sets", "SELECT $1::uuid, $2::jsonb, 1 / 0")
    r = await push([entry("routines"), entry("sets")])
    assert r.status_code == 500
    assert await db.fetchval("SELECT count(*) FROM routines") == 0


async def test_push_round_trips_are_bounded(db, user_a):
    entries = [entry(t) for t in ("sets", "sets", "days", "days", "day_exercises", "day_exercises")]
    conn = CountingConnection(db)
    async with db.transaction():
        result = await sync.push(conn, user_a, entries)
    assert len(result["acked"]) == 6
    assert conn.statements <= 4


async def test_new_fields_round_trip(push, pull):
    exercise = sample_row("day_exercises", performedOrder=2)
    drop = sample_row("sets", isDrop=True)
    r = await push([{"id": "e1", "table": "day_exercises", "row": exercise}, {"id": "e2", "table": "sets", "row": drop}])
    assert len(r.json()["acked"]) == 2
    rows = {c["row"]["id"]: c["row"] for c in (await pull()).json()["changes"]}
    assert rows[exercise["id"]] == exercise
    assert rows[drop["id"]] == drop


async def test_missing_new_fields_are_stored_as_defaults_even_on_update(push, db):
    exercise = sample_row("day_exercises", performedOrder=2, updatedAt=T1)
    await push([{"id": "e1", "table": "day_exercises", "row": exercise}])
    old_app = {k: v for k, v in exercise.items() if k != "performedOrder"} | {"updatedAt": T2}
    old_set = {k: v for k, v in sample_row("sets").items() if k != "isDrop"}
    r = await push([{"id": "e2", "table": "day_exercises", "row": old_app}, {"id": "e3", "table": "sets", "row": old_set}])
    assert sorted(r.json()["acked"]) == ["e2", "e3"]
    assert (await fetch_one(db, "day_exercises", exercise["id"]))["performed_order"] is None
    assert (await fetch_one(db, "sets", old_set["id"]))["is_drop"] is False
