"""Row shapes of the seven synced tables: validation of pushed rows and the wire mapping.

Rows travel in the exact camelCase shape of the app's `Change.row`; columns
are the same fields in snake_case. `user_id` and `seq` are server-only and
never cross the wire.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictBool, StrictStr, ValidationError
from pydantic.alias_generators import to_camel


class RowInvalid(Exception):
    """A pushed row the server will never accept; `reason` goes back to the client."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$")
_INT4_MAX = 2_147_483_647


def _uuid(value: object) -> str:
    # Lowercase only: Postgres hands ids back lowercased, and a pulled id must
    # equal the one the app holds or the app would see two rows.
    if not isinstance(value, str) or not _UUID.match(value):
        raise ValueError("must be a lowercase UUID")
    return value


def _date(value: object) -> date:
    if not isinstance(value, str) or not _DATE.match(value):
        raise ValueError("must be a YYYY-MM-DD date")
    return date.fromisoformat(value)


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP.match(value):
        raise ValueError("must be an ISO timestamp with a time and zone")
    return datetime.fromisoformat(value)


def _number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("must be a number")
    return float(value)


Uuid = Annotated[str, BeforeValidator(_uuid)]
Date = Annotated[date, BeforeValidator(_date)]
Timestamp = Annotated[datetime, BeforeValidator(_timestamp)]
Name = Annotated[StrictStr, Field(min_length=1, max_length=200)]
Objects = Annotated[list[dict[str, Any]], Field(max_length=500)]


class _Row(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="ignore")

    id: Uuid
    updated_at: Timestamp
    deleted_at: Timestamp | None


class Routine(_Row):
    created_at: Timestamp


class RoutineVersion(_Row):
    routine_id: Uuid
    effective_from: Date
    title: Name
    repeat_rule: Literal["weekly", "twice_weekly", "biweekly", "never"]
    start_date: Date
    exercises: Annotated[list[Annotated[StrictStr, Field(max_length=200)]], Field(max_length=200)]
    ended: StrictBool


class Day(_Row):
    date: Date
    status: Literal["missed", "skipped"] | None
    shift_id: Uuid | None
    routine_id: Uuid | None
    title: Name | None
    has_log: StrictBool


class Shift(_Row):
    date: Date
    mode: Literal["skip", "catch_up", "permanent"]
    locked: StrictBool
    created: Objects
    before: Objects


class OccurrenceMove(_Row):
    routine_id: Uuid
    from_date: Date
    to_date: Date
    shift_id: Uuid


class DayExercise(_Row):
    date: Date
    position: Annotated[int, Field(strict=True, ge=0, le=_INT4_MAX)]
    name: Name
    # Optional so an app built before these fields still syncs; missing means the default.
    performed_order: Annotated[int, Field(strict=True, ge=1, le=_INT4_MAX)] | None = None


class SetRow(_Row):
    day_exercise_id: Uuid
    set_number: Annotated[int, Field(strict=True, ge=1, le=_INT4_MAX)]
    reps: Annotated[int, Field(strict=True, ge=0, le=999)] | None
    weight_kg: Annotated[float, BeforeValidator(_number), Field(ge=0, le=1000)] | None
    is_drop: StrictBool = False


@dataclass(frozen=True)
class Column:
    name: str
    wire: str
    sql_type: str


@dataclass(frozen=True)
class TableSpec:
    model: type[_Row]
    columns: tuple[Column, ...]


_BASE = (("id", "uuid"), ("updated_at", "timestamptz"), ("deleted_at", "timestamptz"))


def _spec(model: type[_Row], *columns: tuple[str, str]) -> TableSpec:
    cols = tuple(Column(name, to_camel(name), sql_type) for name, sql_type in (*_BASE, *columns))
    assert [c.name for c in cols] == list(model.model_fields), model.__name__
    return TableSpec(model, cols)


TABLES: dict[str, TableSpec] = {
    "routines": _spec(Routine, ("created_at", "timestamptz")),
    "routine_versions": _spec(
        RoutineVersion,
        ("routine_id", "uuid"),
        ("effective_from", "date"),
        ("title", "text"),
        ("repeat_rule", "text"),
        ("start_date", "date"),
        ("exercises", "jsonb"),
        ("ended", "boolean"),
    ),
    "days": _spec(
        Day,
        ("date", "date"),
        ("status", "text"),
        ("shift_id", "uuid"),
        ("routine_id", "uuid"),
        ("title", "text"),
        ("has_log", "boolean"),
    ),
    "shifts": _spec(
        Shift, ("date", "date"), ("mode", "text"), ("locked", "boolean"), ("created", "jsonb"), ("before", "jsonb")
    ),
    "occurrence_moves": _spec(
        OccurrenceMove, ("routine_id", "uuid"), ("from_date", "date"), ("to_date", "date"), ("shift_id", "uuid")
    ),
    "day_exercises": _spec(
        DayExercise, ("date", "date"), ("position", "int"), ("name", "text"), ("performed_order", "int")
    ),
    "sets": _spec(
        SetRow,
        ("day_exercise_id", "uuid"),
        ("set_number", "int"),
        ("reps", "int"),
        ("weight_kg", "numeric(7,2)"),
        ("is_drop", "boolean"),
    ),
}


def _storable(value: object) -> bool:
    """Postgres text and jsonb reject NUL and unpaired surrogates; one such row would fail its whole batch."""
    if isinstance(value, str):
        if "\x00" in value:
            return False
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return False
        return True
    if isinstance(value, dict):
        return all(_storable(k) and _storable(v) for k, v in value.items())
    if isinstance(value, list):
        return all(_storable(v) for v in value)
    return True


def validate_row(table: str, raw: object) -> dict:
    """The row's column values (snake_case keys), or RowInvalid. Unknown keys such as `userId` are dropped."""
    spec = TABLES.get(table)
    if spec is None:
        raise RowInvalid(f"Unknown table {table!r}")
    if not isinstance(raw, dict):
        raise RowInvalid("row must be an object")
    try:
        values = spec.model.model_validate(raw).model_dump()
    except ValidationError as exc:
        err = exc.errors()[0]
        where = ".".join(str(p) for p in err["loc"]) or "row"
        raise RowInvalid(f"{where}: {err['msg']}") from None
    if not _storable(values):
        raise RowInvalid("row contains text the database cannot store")
    return values


def format_timestamp(value: datetime) -> str:
    """`YYYY-MM-DDTHH:MM:SS.mmmZ`, the shape JavaScript's toISOString produces."""
    u = value.astimezone(timezone.utc)
    return (
        f"{u.year:04d}-{u.month:02d}-{u.day:02d}T{u.hour:02d}:{u.minute:02d}:{u.second:02d}"
        f".{u.microsecond // 1000:03d}Z"
    )


def _wire_value(sql_type: str, value: Any) -> Any:
    if value is None:
        return None
    # Values come either from asyncpg (datetime, date, UUID, Decimal, jsonb
    # text) or from a to_jsonb() row (strings and JSON numbers).
    if sql_type == "timestamptz":
        return format_timestamp(value if isinstance(value, datetime) else datetime.fromisoformat(value))
    if sql_type == "date":
        return value if isinstance(value, str) else value.isoformat()
    if sql_type == "uuid":
        return str(value)
    if sql_type == "jsonb":
        return json.loads(value) if isinstance(value, str) else value
    if isinstance(value, Decimal):
        return float(value)
    return value


def to_wire(table: str, db_row: Mapping) -> dict:
    """A stored row in the app's camelCase shape, without `user_id` or `seq`."""
    return {c.wire: _wire_value(c.sql_type, db_row[c.name]) for c in TABLES[table].columns}
