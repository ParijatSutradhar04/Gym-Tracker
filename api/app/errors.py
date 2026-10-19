"""HTTP error type + FastAPI exception handlers."""

from __future__ import annotations

import logging

import asyncpg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("gym_api")


class HttpError(Exception):
    def __init__(self, status_code: int, message: str, details: object = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.details = details


def bad_request(message: str, details: object = None) -> HttpError:
    return HttpError(400, message, details)


_CHECK_VIOLATION = "23514"
_FOREIGN_KEY_VIOLATION = "23503"
_UNIQUE_VIOLATION = "23505"
_RAISE_EXCEPTION = "P0001"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HttpError)
    async def _http_error(_: Request, exc: HttpError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.message, "details": exc.details},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # loc[0] is "body"/"query"/"path"; drop it so the path names the field.
        details = [
            {"path": ".".join(str(p) for p in e["loc"][1:]) or str(e["loc"][-1]), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(status_code=400, content={"error": "Invalid request", "details": details})

    @app.exception_handler(asyncpg.PostgresError)
    async def _pg_error(_: Request, exc: asyncpg.PostgresError) -> JSONResponse:
        # The schema's checks and keys reject rows the caller shaped wrongly;
        # those mean a bad request, not a broken server.
        code = getattr(exc, "sqlstate", None)
        if code in (_CHECK_VIOLATION, _FOREIGN_KEY_VIOLATION, _UNIQUE_VIOLATION, _RAISE_EXCEPTION):
            return JSONResponse(status_code=400, content={"error": str(exc)})
        logger.exception("Unhandled Postgres error")
        return JSONResponse(status_code=500, content={"error": "Internal server error"})

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception")
        return JSONResponse(status_code=500, content={"error": "Internal server error"})
