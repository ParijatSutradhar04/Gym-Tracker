"""Environment configuration.

Locally, a .env file is loaded with python-dotenv before this module is
imported (app/main.py does that).
"""

import os


def _required(name: str, fallback: str | None = None) -> str:
    value = os.environ.get(name) or fallback
    if not value:
        raise RuntimeError(f"Missing required environment variable {name}")
    return value


class Settings:
    # Defaults to the Docker Postgres that scripts/dev.sh starts.
    database_url: str = _required("DATABASE_URL", "postgres://postgres:postgres@localhost:5433/gymdb")

    # Irrelevant on Vercel serverless; only used by `uvicorn app.main:app --port`.
    port: int = int(os.environ.get("PORT", "8000"))

    # Comma-separated list of origins allowed to call the API directly.
    # The Expo web build is served same-origin behind Vercel rewrites, so this
    # mainly matters for local dev (Expo web/Metro).
    cors_origins: list[str] = [
        o.strip()
        for o in os.environ.get(
            "CORS_ORIGINS",
            "http://localhost:8081,http://localhost:19006,http://localhost:8443",
        ).split(",")
        if o.strip()
    ]

    # Supabase project URL (Settings -> API -> Project URL). Session JWTs are
    # signed with the project's JWT Signing Keys (ES256); the public half is
    # fetched from this project's JWKS endpoint. Checked lazily so importing
    # this module without it set (e.g. schema-only tests) doesn't crash.
    supabase_url: str | None = os.environ.get("SUPABASE_URL")


settings = Settings()
