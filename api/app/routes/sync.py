"""Sync endpoints. Mounted with require_auth; the user id always comes from the token."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StrictStr

from ..auth import current_user_id
from ..db import transaction
from ..errors import HttpError
from ..rows import format_timestamp
from ..services import sync as sync_service

router = APIRouter()


class PushEntry(BaseModel):
    id: StrictStr = Field(min_length=1, max_length=100)
    table: StrictStr
    row: Any


class PushBody(BaseModel):
    entries: list[PushEntry]


@router.post("/push")
async def push(body: PushBody, user_id: str = Depends(current_user_id)) -> dict:
    if len(body.entries) > sync_service.MAX_PUSH_ENTRIES:
        raise HttpError(413, f"A push carries at most {sync_service.MAX_PUSH_ENTRIES} entries")
    async with transaction() as conn:
        result = await sync_service.push(conn, user_id, [e.model_dump() for e in body.entries])
    return {**result, "serverTime": format_timestamp(datetime.now(timezone.utc))}
