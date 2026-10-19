"""Valid camelCase rows for every synced table, in the exact shape of the app's Change.row."""

from __future__ import annotations

import uuid

T0 = "2026-10-19T12:00:00.000Z"


def _id() -> str:
    return str(uuid.uuid4())


def _defaults(table: str) -> dict:
    match table:
        case "routines":
            return {"createdAt": T0}
        case "routine_versions":
            return {
                "routineId": _id(),
                "effectiveFrom": "2026-10-19",
                "title": "Chest & Tricep",
                "repeatRule": "weekly",
                "startDate": "2026-10-19",
                "exercises": ["Bench press", "Cable fly"],
                "ended": False,
            }
        case "days":
            return {
                "date": "2026-10-19",
                "status": None,
                "shiftId": None,
                "routineId": _id(),
                "title": "Chest & Tricep",
                "hasLog": True,
            }
        case "shifts":
            return {"date": "2026-10-19", "mode": "skip", "locked": False, "created": [], "before": []}
        case "occurrence_moves":
            return {"routineId": _id(), "fromDate": "2026-10-19", "toDate": "2026-10-20", "shiftId": _id()}
        case "day_exercises":
            return {"date": "2026-10-19", "position": 0, "name": "Bench press"}
        case "sets":
            return {"dayExerciseId": _id(), "setNumber": 1, "reps": 8, "weightKg": 22.5}
    raise KeyError(table)


def sample_row(table: str, id: str | None = None, **overrides) -> dict:
    return {"id": id or _id(), "updatedAt": T0, "deletedAt": None, **_defaults(table), **overrides}


def entry(table: str, **overrides) -> dict:
    """An outbox entry: its own id, plus a sample row (overrides, including the row `id`, go to the row)."""
    return {"id": _id(), "table": table, "row": sample_row(table, **overrides)}
