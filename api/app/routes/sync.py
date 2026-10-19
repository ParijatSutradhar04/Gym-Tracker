"""Sync endpoints. Mounted with require_auth; the user id always comes from the token."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, StrictStr

from ..auth import current_user_id
from ..db import acquire, transaction
from ..errors import HttpError
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
    return {**result, "serverTime": sync_service.server_time()}


@router.get("/pull")
async def pull(
    cursor: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(sync_service.DEFAULT_PULL_LIMIT, ge=1, le=sync_service.MAX_PULL_LIMIT),
    user_id: str = Depends(current_user_id),
) -> dict:
    async with acquire() as conn:
        return await sync_service.pull(conn, user_id, cursor, limit)
