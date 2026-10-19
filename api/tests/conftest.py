"""Shared fixtures: a freshly migrated test database, an in-process API client and signed tokens."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgres://postgres:postgres@localhost:5433/gymdb_test"
)
# Settings read DATABASE_URL when app.config is imported, so point it at the
# test database before anything from the app is imported.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

from app import auth  # noqa: E402
from app.config import settings  # noqa: E402
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
USER_A = "00000000-0000-4000-8000-00000000000a"
USER_B = "00000000-0000-4000-8000-00000000000b"


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


@pytest.fixture
def user_a() -> str:
    return USER_A


@pytest.fixture
def user_b() -> str:
    return USER_B


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def jwks(monkeypatch):
    """Stands in for the Supabase project's JWKS: one ES256 key pair per test, no network."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    client = SimpleNamespace(get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=public_key))
    monkeypatch.setattr(auth, "_get_jwk_client", lambda: client)
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.test")
    return SimpleNamespace(private_key=private_key, public_key=public_key)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


@pytest.fixture
def make_token(jwks):
    """Signs a Supabase-shaped session token. sub=None leaves the claim out.

    alg="HS256" signs by hand with `key` as the HMAC secret (PyJWT refuses a
    PEM key there), so tests can forge an algorithm-confusion token.
    """

    def _make(
        sub: str | None = None,
        *,
        exp_in: int = 3600,
        aud: str = "authenticated",
        key=None,
        alg: str = "ES256",
    ) -> str:
        now = int(time.time())
        payload = {"aud": aud, "role": "authenticated", "iat": now, "exp": now + exp_in}
        if sub is not None:
            payload["sub"] = sub
        if alg == "HS256":
            header = {"alg": alg, "typ": "JWT"}
            signing_input = f"{_b64url(json.dumps(header).encode())}.{_b64url(json.dumps(payload).encode())}"
            signature = hmac.new(key, signing_input.encode(), hashlib.sha256).digest()
            return f"{signing_input}.{_b64url(signature)}"
        return jwt.encode(payload, key or jwks.private_key, algorithm=alg)

    return _make


@pytest.fixture
def push(client, db, make_token, user_a):
    """POSTs entries to /api/sync/push as user_a (or the given token's user), on emptied tables."""

    async def _push(entries, token=None):
        # ASCII-escaped like JSON.stringify, so a lone surrogate travels as "\ud800".
        return await client.post(
            "/api/sync/push",
            content=json.dumps({"entries": entries}),
            headers={**bearer(token or make_token(user_a)), "Content-Type": "application/json"},
        )

    return _push


@pytest.fixture
def pull(client, db, make_token, user_a):
    """GETs /api/sync/pull as user_a (or the given token's user); None leaves a parameter out."""

    async def _pull(cursor=None, limit=None, token=None):
        params = {k: v for k, v in {"cursor": cursor, "limit": limit}.items() if v is not None}
        return await client.get("/api/sync/pull", params=params, headers=bearer(token or make_token(user_a)))

    return _pull


class CountingConnection:
    """Proxies a connection and counts every statement sent through it."""

    def __init__(self, conn):
        self._conn = conn
        self.statements = 0

    def __getattr__(self, name):
        attr = getattr(self._conn, name)
        if name in ("execute", "executemany", "fetch", "fetchrow", "fetchval"):
            async def counted(*args, **kwargs):
                self.statements += 1
                return await attr(*args, **kwargs)

            return counted
        return attr
