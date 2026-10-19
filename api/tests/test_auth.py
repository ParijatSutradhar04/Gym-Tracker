import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import Depends, FastAPI

from app import auth
from app.auth import current_user_id
from app.config import settings
from tests.conftest import bearer

whoami_app = FastAPI()


@whoami_app.get("/whoami")
def whoami(user_id: str = Depends(current_user_id)) -> str:
    return user_id


@pytest.fixture
async def whoami():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=whoami_app), base_url="http://test") as c:
        yield c


async def test_missing_header_is_401(whoami):
    r = await whoami.get("/whoami")
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing bearer token"


async def test_non_bearer_scheme_is_401(whoami, make_token, user_a):
    r = await whoami.get("/whoami", headers={"Authorization": f"Basic {make_token(user_a)}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing bearer token"


async def test_valid_token_returns_sub(whoami, make_token, user_a):
    r = await whoami.get("/whoami", headers=bearer(make_token(user_a)))
    assert r.status_code == 200
    assert r.json() == user_a


async def test_expired_token_is_401(whoami, make_token, user_a):
    r = await whoami.get("/whoami", headers=bearer(make_token(user_a, exp_in=-10)))
    assert r.status_code == 401
    assert r.json()["detail"].startswith("Invalid token: ")


async def test_wrong_audience_is_401(whoami, make_token, user_a):
    r = await whoami.get("/whoami", headers=bearer(make_token(user_a, aud="anon")))
    assert r.status_code == 401
    assert r.json()["detail"].startswith("Invalid token: ")


async def test_token_signed_by_a_different_key_is_401(whoami, make_token, user_a):
    other = ec.generate_private_key(ec.SECP256R1())
    r = await whoami.get("/whoami", headers=bearer(make_token(user_a, key=other)))
    assert r.status_code == 401
    assert r.json()["detail"].startswith("Invalid token: ")


async def test_hs256_token_signed_with_the_public_key_is_401(whoami, make_token, user_a, jwks):
    public_pem = jwks.public_key.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    r = await whoami.get("/whoami", headers=bearer(make_token(user_a, alg="HS256", key=public_pem)))
    assert r.status_code == 401
    assert r.json()["detail"].startswith("Invalid token: ")


async def test_sub_that_is_not_a_uuid_is_401(whoami, make_token):
    r = await whoami.get("/whoami", headers=bearer(make_token("not-a-uuid")))
    assert r.status_code == 401


async def test_missing_sub_is_401(whoami, make_token):
    r = await whoami.get("/whoami", headers=bearer(make_token()))
    assert r.status_code == 401


async def test_unset_supabase_url_is_500(whoami, make_token, user_a, monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", None)
    r = await whoami.get("/whoami", headers=bearer(make_token(user_a)))
    assert r.status_code == 500


async def test_jwks_fetch_failure_is_503_not_401(whoami, make_token, user_a, monkeypatch):
    # A blip fetching the signing keys says nothing about the token: clients retry a 5xx, but a 401 asks the
    # user to sign in again.
    class Unreachable:
        def get_signing_key_from_jwt(self, token):
            raise jwt.PyJWKClientConnectionError("Fail to fetch data from the url, err: timed out")

    token = make_token(user_a)
    monkeypatch.setattr(auth, "_get_jwk_client", lambda: Unreachable())
    r = await whoami.get("/whoami", headers=bearer(token))
    assert r.status_code == 503
