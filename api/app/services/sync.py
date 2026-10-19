"""Push: apply a batch of client rows for one user with last-write-wins per row."""

from __future__ import annotations

import json
from datetime import date, datetime

from ..rows import TABLES, RowInvalid, TableSpec, validate_row

MAX_PUSH_ENTRIES = 200


def _upsert_sql(table: str, spec: TableSpec) -> str:
    # One statement per table for the whole batch. Rows arrive as one jsonb
    # array; an existing row is replaced only by a strictly newer updated_at,
    # so an equal or older row (a retry, a stale device) changes nothing.
    cols = ", ".join(f'"{c.name}"' for c in spec.columns)
    record = ", ".join(f'"{c.name}" {c.sql_type}' for c in spec.columns)
    updates = ", ".join(f'"{c.name}" = EXCLUDED."{c.name}"' for c in spec.columns if c.name != "id")
    return (
        f"INSERT INTO {table} (user_id, {cols}) "
        f"SELECT $1::uuid, {cols} FROM jsonb_to_recordset($2::jsonb) AS r({record}) "
        f"ON CONFLICT (user_id, id) DO UPDATE SET {updates}, seq = nextval('sync_seq') "
        f"WHERE {table}.updated_at < EXCLUDED.updated_at"
    )


UPSERT_SQL: dict[str, str] = {table: _upsert_sql(table, spec) for table, spec in TABLES.items()}


def _jsonable(value: object) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


async def push(conn, user_id: str, entries: list[dict]) -> dict:
    """Applies `entries` ({id, table, row}) for `user_id` inside the caller's transaction.

    Each entry is validated on its own: invalid ones are rejected, valid ones
    are acked whether or not they changed anything. Within the batch only the
    newest row per (table, id) is written (the later entry wins a tie).
    """
    acked: list[str] = []
    rejected: list[dict] = []
    newest: dict[tuple[str, str], dict] = {}
    for e in entries:
        try:
            row = validate_row(e["table"], e["row"])
        except RowInvalid as exc:
            rejected.append({"id": e["id"], "reason": exc.reason})
            continue
        acked.append(e["id"])
        key = (e["table"], row["id"])
        if key not in newest or row["updated_at"] >= newest[key]["updated_at"]:
            newest[key] = row

    if newest:
        by_table: dict[str, list[dict]] = {}
        for (table, _), row in newest.items():
            by_table.setdefault(table, []).append(row)
        # Serializes this user's pushes, so their seq values commit in order
        # and a pull cursor can never pass a row still being written.
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", user_id)
        for table in TABLES:
            if table in by_table:
                await conn.execute(UPSERT_SQL[table], user_id, json.dumps(by_table[table], default=_jsonable))

    return {"acked": acked, "rejected": rejected}
