"""FastAPI app assembly. Vercel's Python runtime (or uvicorn locally) serves `app`."""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

# Load a local .env before any settings are read. No-op in production, where
# real env vars are already set by the platform.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from .config import settings  # noqa: E402
from .errors import register_exception_handlers  # noqa: E402
from .routes import health  # noqa: E402

app = FastAPI(title="Gym Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

# Health is unauthenticated so uptime checks and deploy tooling don't need a
# token; every other router is mounted with dependencies=[require_auth].
app.include_router(health.router, prefix="/api/health")
