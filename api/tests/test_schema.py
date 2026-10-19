import uuid

import asyncpg
import pytest

from scripts.migrate import migrate
from tests.conftest import INIT_SQL, MIGRATIONS_DIR, SYNCED_TABLES, TEST_DATABASE_URL

USER_A = "00000000-0000-4000-8000-00000000000a"
USER_B = "00000000-0000-4000-8000-00000000000b"


async def insert(db, table: str, user_id: str, row_id: str, **cols) -> int:
    names = ["user_id", "id", "updated_at", *cols]
    params = ", ".join(f"${i}" for i in range(3, 3 + len(cols)))
    values = f"$1, $2, now(){', ' if cols else ''}{params}"
    sql = f"INSERT INTO {table} ({', '.join(names)}) VALUES ({values}) RETURNING seq"
    return await db.fetchval(sql, user_id, row_id, *cols.values())


async def test_all_seven_tables_have_scoping_and_cursor_columns(db):
    for table in SYNCED_TABLES:
        rows = await db.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
            table,
        )
        assert {"user_id", "id", "updated_at", "deleted_at", "seq"} <= {r["column_name"] for r in rows}, table


async def test_same_id_can_exist_for_two_users(db):
    set_id = str(uuid.uuid4())
    await insert(db, "sets", USER_A, set_id, set_number=1)
    await insert(db, "sets", USER_B, set_id, set_number=1)
    assert await db.fetchval("SELECT count(*) FROM sets WHERE id = $1", set_id) == 2
    with pytest.raises(asyncpg.UniqueViolationError):
        await insert(db, "sets", USER_A, set_id, set_number=2)


async def test_pull_index_exists_per_table(db):
    rows = await db.fetch("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
    names = {r["indexname"] for r in rows}
    for table in SYNCED_TABLES:
        assert f"idx_{table}_pull" in names


async def test_seq_is_assigned_increasing(db):
    first = await insert(db, "sets", USER_A, str(uuid.uuid4()), set_number=1)
    second = await insert(db, "days", USER_A, str(uuid.uuid4()))
    third = await insert(db, "sets", USER_B, str(uuid.uuid4()), set_number=1)
    assert first < second < third


@pytest.mark.parametrize(
    "table, column, value",
    [
        ("routine_versions", "repeat_rule", "daily"),
        ("sets", "reps", 1000),
        ("sets", "set_number", 0),
        ("day_exercises", "position", -1),
    ],
)
async def test_check_constraints_reject_bad_enum_and_ranges(db, table, column, value):
    with pytest.raises(asyncpg.CheckViolationError):
        await insert(db, table, USER_A, str(uuid.uuid4()), **{column: value})


async def test_init_sql_is_idempotent(db):
    sql = INIT_SQL.read_text(encoding="utf8")
    await db.execute(sql)
    await db.execute(sql)


async def test_migrate_applies_new_migrations_once(db, tmp_path):
    (tmp_path / "001_x.sql").write_text("CREATE TABLE migrate_probe (n int);", encoding="utf8")
    try:
        assert await migrate(TEST_DATABASE_URL, INIT_SQL, tmp_path) == ["001_x.sql"]
        assert await migrate(TEST_DATABASE_URL, INIT_SQL, tmp_path) == []
        assert await db.fetchval("SELECT to_regclass('migrate_probe') IS NOT NULL")
    finally:
        await db.execute("DROP TABLE IF EXISTS migrate_probe")
        await db.execute("DELETE FROM schema_migrations WHERE name = '001_x.sql'")
    assert MIGRATIONS_DIR.is_dir()
