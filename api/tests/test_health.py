from contextlib import asynccontextmanager

from app.routes import health


async def test_health_ok_returns_200_status_ok(client, db):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_503_when_database_unreachable(client, monkeypatch):
    @asynccontextmanager
    async def unreachable():
        raise OSError("connection refused")
        yield

    monkeypatch.setattr(health, "acquire", unreachable)
    response = await client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
