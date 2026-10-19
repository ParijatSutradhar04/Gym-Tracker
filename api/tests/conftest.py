"""Shared fixtures: a freshly migrated test database and an in-process API client."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgres://postgres:postgres@localhost:5433/gymdb_test"
)
# Settings read DATABASE_URL when app.config is imported, so point it at the
# test database before anything from the app is imported.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402

from app.db import close_pool  # noqa: E402
from app.main import app  # noqa: E402
from scripts.migrate import migrate  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
INIT_SQL = REPO_ROOT / "supabase" / "init.sql"
MIGRATIONS_DIR = REPO_ROOT / "migrations"
SYNCED_TABLES = (
    "routines",
    "routine_versions",
    "days",
    "shifts",
    "occurrence_moves",
    "day_exercises",
    "sets",
)


async def _recreate_test_database() -> None:
    server, _, name = TEST_DATABASE_URL.rpartition("/")
    admin = await asyncpg.connect(dsn=f"{server}/postgres")
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await admin.execute(f'CREATE DATABASE "{name}"')
    finally:
        await admin.close()
    await migrate(TEST_DATABASE_URL, INIT_SQL, MIGRATIONS_DIR)


@pytest.fixture(scope="session", autouse=True)
def test_database() -> None:
    """Drops and recreates the test database, then applies the schema, once per run."""
    asyncio.run(_recreate_test_database())


@pytest.fixture
async def db():
    """A connection to the test database with every synced table emptied."""
    conn = await asyncpg.connect(dsn=TEST_DATABASE_URL)
    await conn.execute(f"TRUNCATE {', '.join(SYNCED_TABLES)}")
    try:
        yield conn
    finally:
        await conn.close()


@pytest.fixture
async def client():
    """The API in-process. The pool is closed after each test so it never outlives its event loop."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    await close_pool()
