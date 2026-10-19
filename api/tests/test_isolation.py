"""Spec Section 8 item 10: every route rejects or scopes rows for a second user."""

import re

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.main import app
from app.services import sync
from tests.conftest import SYNCED_TABLES, CountingConnection, bearer
from tests.samples import entry, sample_row

T1 = "2026-10-19T12:00:00.000Z"
T2 = "2026-10-19T12:00:01.000Z"
TABLE_NAME = re.compile(r"\b(" + "|".join(SYNCED_TABLES) + r")\b")


@pytest.fixture
def as_b(make_token, user_b):
    return make_token(user_b)


async def test_second_user_pull_is_empty_after_first_user_pushes_rows_in_every_table(push, pull, as_b):
    r = await push([entry(t) for t in SYNCED_TABLES])
    assert len(r.json()["acked"]) == 7
    body = (await pull(token=as_b)).json()
    assert (body["changes"], body["hasMore"]) == ([], False)


async def test_second_user_cannot_overwrite_first_users_row_by_pushing_its_id(push, pull, db, as_b):
    row = sample_row("sets", reps=10, updatedAt=T1)
    await push([{"id": "a", "table": "sets", "row": row}])
    r = await push([{"id": "b", "table": "sets", "row": {**row, "reps": 99, "updatedAt": T2}}], token=as_b)
    assert r.json()["acked"] == ["b"]
    [change] = (await pull(cursor=0)).json()["changes"]
    assert change["row"]["reps"] == 10
    owners = await db.fetch("SELECT user_id::text AS u, reps FROM sets WHERE id = $1 ORDER BY reps", row["id"])
    assert len(owners) == 2
    assert len({o["u"] for o in owners}) == 2


async def test_second_user_tombstone_for_first_users_id_does_not_delete_it(push, pull, as_b):
    row = sample_row("day_exercises", updatedAt=T1)
    await push([{"id": "a", "table": "day_exercises", "row": row}])
    await push([{"id": "b", "table": "day_exercises", "row": {**row, "updatedAt": T2, "deletedAt": T2}}], token=as_b)
    [change] = (await pull()).json()["changes"]
    assert change["row"]["deletedAt"] is None


async def test_second_user_cannot_probe_with_a_foreign_cursor(push, pull, db, as_b):
    await push([entry("sets"), entry("days")])
    a_max = await db.fetchval("SELECT max(seq) FROM (SELECT seq FROM sets UNION ALL SELECT seq FROM days) s")
    for cursor in (0, a_max - 1, a_max):
        body = (await pull(cursor=cursor, token=as_b)).json()
        assert body["changes"] == []


async def test_body_user_id_cannot_redirect_a_write(push, db, user_a, user_b, as_b):
    await push([entry("sets", userId=user_a)], token=as_b)
    owners = await db.fetch("SELECT user_id::text AS u FROM sets")
    assert [o["u"] for o in owners] == [user_b]


def _api_routes():
    # The OpenAPI paths are the public, fully prefixed list of every mounted
    # route (FastAPI nests included routers instead of flattening app.routes).
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/api") and not path.startswith("/api/health"):
            for method in operations:
                yield method.upper(), path


def test_the_api_has_sync_routes_to_check():
    assert set(_api_routes()) >= {("POST", "/api/sync/push"), ("GET", "/api/sync/pull")}


@pytest.mark.parametrize("method, path", list(_api_routes()))
async def test_every_api_route_except_health_requires_auth(client, make_token, user_a, method, path):
    assert (await client.request(method, path)).status_code == 401
    forged = make_token(user_a, key=ec.generate_private_key(ec.SECP256R1()))
    assert (await client.request(method, path, headers=bearer(forged))).status_code == 401


class RecordingConnection(CountingConnection):
    def __init__(self, conn):
        super().__init__(conn)
        self.sql: list[str] = []

    def __getattr__(self, name):
        attr = super().__getattr__(name)
        if name in ("execute", "executemany", "fetch", "fetchrow", "fetchval"):
            async def recorded(query, *args, **kwargs):
                self.sql.append(query)
                return await attr(query, *args, **kwargs)

            return recorded
        return attr


async def test_every_statement_touching_a_synced_table_filters_by_user_id(db, user_a):
    conn = RecordingConnection(db)
    async with db.transaction():
        await sync.push(conn, user_a, [entry(t) for t in SYNCED_TABLES])
    await sync.pull(conn, user_a, 0, 500)
    touching = [q for q in conn.sql if TABLE_NAME.search(q)]
    assert len(touching) == 8  # seven upserts and one pull
    for q in touching:
        # Check every UNION branch (and every single statement) on its own.
        for part in q.split(" UNION ALL "):
            if TABLE_NAME.search(part):
                assert "user_id" in part, part
