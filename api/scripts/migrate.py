#!/usr/bin/env python3
"""Applies supabase/init.sql, then each migrations/NNN_*.sql not yet applied.

init.sql is idempotent and runs every time; numbered migrations run once each
and are recorded in schema_migrations. Against Supabase, run it with the
*direct* connection (port 5432), not the transaction pooler (6543):
PgBouncer's transaction-pooling mode doesn't support the session state a
multi-statement DDL script relies on.

    DATABASE_URL="postgres://...supabase direct.../postgres" python -m scripts.migrate
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

REPO_ROOT = Path(__file__).resolve().parents[2]
INIT_SQL = REPO_ROOT / "supabase" / "init.sql"
MIGRATIONS_DIR = REPO_ROOT / "migrations"


async def migrate(dsn: str, init_sql: Path, migrations_dir: Path) -> list[str]:
    """Returns the names of the migrations applied by this run, in order."""
    conn = await asyncpg.connect(dsn=dsn)
    try:
        # With no arguments, execute() uses the simple query protocol, which
        # runs a whole semicolon-separated script in one call.
        await conn.execute(init_sql.read_text(encoding="utf8"))
        done = {r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")}
        applied: list[str] = []
        for path in sorted(migrations_dir.glob("[0-9][0-9][0-9]_*.sql")):
            if path.name in done:
                continue
            async with conn.transaction():
                await conn.execute(path.read_text(encoding="utf8"))
                await conn.execute("INSERT INTO schema_migrations (name) VALUES ($1)", path.name)
            applied.append(path.name)
        return applied
    finally:
        await conn.close()


async def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        raise SystemExit(1)
    applied = await migrate(database_url, INIT_SQL, MIGRATIONS_DIR)
    print(f"Applied {INIT_SQL.relative_to(REPO_ROOT)}; migrations: {', '.join(applied) or 'none new'}.")


if __name__ == "__main__":
    asyncio.run(main())
