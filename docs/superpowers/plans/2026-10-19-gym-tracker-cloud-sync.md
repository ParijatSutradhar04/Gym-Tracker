# Gym Tracker Cloud and Sync Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on Plan 1 being complete** (`docs/superpowers/plans/2026-10-19-gym-tracker-app-core.md`, all 20 tasks merged and `npm test` green). This plan builds on Plan 1's finished code and uses its names exactly (`Change`, `DataStore`, `OutboxApi`, `OutboxEntry`, `LocalStore`, `GymStore`, `mergeRemote`, `createDataStore()`, `SyncStatusSlot`, `KeyValueStorage`, `gt:v1:` keys). Where this plan changes a Plan 1 file, the task says so in a step that names the file.

**Goal:** Add the FastAPI + Supabase backend (a thin authenticated sync store), Supabase login with a persisted session, phone sync over Plan 1's outbox, an online-only website data store, and deployment (Vercel, EAS build, EAS Update).

**Architecture:** The API stores the seven Plan 1 tables as rows keyed `(user_id, id)`, stamps `user_id` from the verified JWT, applies last-write-wins by client `updatedAt`, and hands out a server-assigned `seq` per row as the pull cursor. The phone runs a `SyncEngine` (pull, push the coalesced outbox in batches, ack, pull) on top of `LocalStore`; the website swaps `createDataStore()` for a `RemoteStore` that pushes each commit and pulls a delta on focus. `GymStore` and all UI above it stay as they are, plus a small `applyRemote` and a writes-paused switch.

**Tech Stack:** Python (local venv 3.14 as in Financial Tracker; no pin file there either, so write 3.12-compatible code), FastAPI `>=0.115,<1.0`, asyncpg `>=0.30,<0.32`, pyjwt[crypto] `>=2.9,<3.0`, pydantic `>=2.7,<3.0`, uvicorn, python-dotenv, pytest + pytest-asyncio + httpx (dev); Supabase Postgres + Auth; `@supabase/supabase-js ^2.112.3`, `react-native-url-polyfill ^4.0.0`, `expo-updates` (via `npx expo install`); Vitest for app tests.

**Spec:** `docs/superpowers/specs/2026-10-19-gym-tracker-design.md` (Sections 5, 6, 7 and Section 8 items 8 and 10 are this plan's). Reference project: `/Users/parijat.sutradhar/Projects/Financial_Tracker` (`api/app/{auth,config,db,errors,main}.py`, `api/scripts/migrate.py`, `vercel.json`, `scripts/dev.sh`, `app/src/supabase.ts`, `app/src/screens/LoginScreen.tsx`).

## Global Constraints

Every task's requirements include this section. Spec text is verbatim; decisions this plan makes are marked *(plan)*.

- **Stack (owner's decision):** Expo SDK 57 app (Android via EAS `preview`/`production` + EAS Update; web via react-native-web on Vercel); FastAPI on Vercel; Supabase Postgres + Auth (JWT). Schema in `supabase/init.sql` plus numbered `migrations/`. Repo layout `app/ api/ supabase/ migrations/ scripts/ docs/`.
- **New, separate projects:** GitHub repo `Gym-Tracker`, Vercel project `gym-tracker`, Expo project `gym-tracker` (owner `parijatsutradhars-team`), Android package `com.parijat.gymtracker`, a new Supabase project. The owner creates them (Task 1).
- **`user_id` on every owned row.** The server stamps it from the JWT `sub` and never trusts the client. Every query filters by it (application-level, no RLS yet).
- **Login:** email + password sign-in only; no sign-up UI; the session persists on app and website.
- **Offline-first app:** full local copy plus persistent outbox, last-write-wins per row by `updatedAt`, tombstones via `deletedAt`, unsynced dot in the top bar, nothing in the UI ever waits on the network.
- **Website online-only:** no service worker, no offline store, optimistic UI, banner `You're offline. Changes won't save`, editing paused while offline, loads from the API on start, refreshes on focus.
- **Backend is a thin sync store:** auth, scoping, row-shape validation, last-write-wins. No schedule logic in Python.
- **Wire format** *(plan)*: rows travel in the exact camelCase shape of Plan 1's `Change.row`; the API maps to snake_case columns. `userId`, `seq` never appear on the wire. Timestamps are ISO-8601 UTC with milliseconds and `Z` (`2026-10-19T12:00:00.123Z`), byte-identical on the round trip. Dates are `YYYY-MM-DD`.
- **Endpoints** *(plan)*:
  - `POST /api/sync/push` body `{entries: [{id, table, row}]}` (`id` = `OutboxEntry.id`), max **200** entries (more is `413`), response `{acked: string[], rejected: [{id, reason}], serverTime}`.
  - `GET /api/sync/pull?cursor=<int>&limit=<int>` (`cursor` default 0, `limit` default **500**, 1..**1000** else `400`) returns `{changes: [{table, row}], cursor, hasMore, serverTime}`; `GET /api/health` is the only unauthenticated route.
- **Cursor** *(plan)*: each table has `seq bigint NOT NULL DEFAULT nextval('sync_seq')` (one global sequence), re-assigned from the sequence on every accepted upsert. Pull returns rows with `seq > cursor` ordered by `seq`. Client `updatedAt` is never used for pulling, so clock skew cannot hide rows. Pushes for one user are serialized with `pg_advisory_xact_lock`, so a user's `seq` values become visible in order and a pull cursor never skips a row.
- **Primary key `(user_id, id)`** *(plan)*: pushing an `id` that exists for another user creates your own row and cannot touch theirs. No foreign keys between synced tables (rows arrive in any order) and none to `auth.users` (keeps local dev free of Supabase).
- **Last-write-wins on the server** *(plan)*: an incoming row is applied only if no row exists or its `updatedAt` is strictly newer; an equal or older row is a no-op that is still acked, which makes retries idempotent.
- **Partial failure** *(plan)*: each entry is shape-validated on its own. Invalid entries come back in `rejected` and never block the rest; valid entries apply in one DB transaction (a DB error rolls the whole batch back with `500`, and the client retries it). The client acks both `acked` and `rejected` ids (a rejected entry can never succeed) and records the reasons in `lastError`.
- **Outbox is coalesced on the client** *(plan)*: per `(table, rowId)` keep the newest entry, send one row, ack every coalesced id.
- **Sync cycle on the phone** *(plan)*: pull, push in batches of 200 until the outbox is empty, pull again only if something was pushed. Triggers: app start, foreground, 1.5 s after a local commit (debounced), and retry with backoff `min(2000 * 2^(n-1), 60000)` ms after a failure. No NetInfo dependency: while the outbox is non-empty the retry timer is the reconnect detector.
- **Pull cursor storage** *(plan)*: key `gt:v1:sync` (`{cursor: number}`) in the same `KeyValueStorage`, written only after the page's rows were persisted (a crash re-pulls a page, which is idempotent). Plan 1's hand-off suggested `gt:v1:meta`; that key is rewritten on every `LocalStore.commit`, so a separate key avoids a write race.
- **401 handling** *(plan)*: refresh the token once and retry; a second 401 means `auth_required`: the app stays fully usable, the outbox is kept, sync stops retrying, the top bar shows `Sign in to sync`. A refresh that fails with a network error is `offline`, never `auth_required`. Leave Supabase session time-box and inactivity timeout off.
- **Clock skew** *(plan)*: pull and push responses carry `serverTime`. If the device clock differs by more than `MAX_CLOCK_SKEW_MS = 300000`, push is paused (the outbox is kept), pull continues, and the top bar shows `Check your device clock`.
- **Duplicate `days` / `day_exercises` / `sets`** *(plan)*: converge by construction. `days`, `sets`, and the `day_exercises` that `ensureDayLog` snapshots from the schedule get deterministic ids (`stableId`, Task 8), so two devices that create the same day log offline write the same rows and last-write-wins merges them. An exercise added to an already-logged day gets a fresh `ctx.newId()` at `max(position over all rows of that date, tombstones included) + 1`, so it can never reuse a live row's id; two devices adding exercises both keep theirs. No server uniqueness rule and no read-time dedupe is needed.
- **Env var names:** API `DATABASE_URL`, `SUPABASE_URL`, `CORS_ORIGINS`, `DB_POOL_MAX`, `PORT` (tests: `TEST_DATABASE_URL`). App `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- **Anti-goals (from Financial Tracker `KNOWN_ISSUES.md` #1, slow saves):** pull is exactly one SQL statement; push is one lock statement plus at most one statement per table in the batch; the Vercel function region must match the Supabase region (Task 1); the web store never refetches everything after a write.
- **Commits:** use the attribution trailer the executing harness specifies; never commit on `main`; one commit per task.

## Review Focus

Failure modes the spec implies but its test list does not cover; each has a pinning test in the owning task.

1. **A push times out after the server committed**, so the phone retries the same entries. Expect: no duplicate rows, entries acked on the retry, nothing lost. *(Task 4 `retried_batch_is_idempotent`; Task 10 `timeout_after_server_commit_retries_same_entries_and_acks`)*
2. **Session expired after a week offline.** Expect: the app opens straight into local data, a failed refresh while offline is `offline` not a logout, the outbox survives, and a genuinely revoked session shows `Sign in to sync` without interrupting a workout. *(Task 10, Task 12)*
3. **A pull lands during a local edit.** Expect: the older remote row never overwrites the newer local edit, and the edit is still in the outbox. *(Task 9)*
4. **The same day is logged on two devices (one offline).** Expect: one Bench press tile, not two; the newer value per set wins. *(Task 8)*
5. **A device clock that is minutes or days off.** Expect: pulls still see every row (server cursor), and pushes pause with a visible message instead of letting a wrong-clock row win every conflict. *(Task 5 `cursor_is_server_assigned_not_client_updatedAt`; Task 10 `clock_skew_pauses_push_but_still_pulls`)*

---

## File Structure

**Backend (`api/`, tests in `api/tests/`):** `index.py` (re-exports `app`), `requirements.txt`, `requirements-dev.txt`, `pytest.ini`, `app/{config,db,errors,auth,main,rows}.py`, `app/routes/{health,sync}.py`, `app/services/sync.py`, `scripts/{__init__,migrate}.py`, `tests/{conftest,samples,test_schema,test_health,test_auth,test_push,test_pull,test_isolation}.py`.
**Database:** `supabase/init.sql` (idempotent), `migrations/NNN_*.sql` (none yet, `.gitkeep`).
**Repo root:** `vercel.json`, `scripts/dev.sh`, `.gitignore` (Python additions), `api/.env.example`, `app/.env.example`.
**App engine:** `src/engine/ids.ts` (`stableId`); modified `dayLog.ts`, `sets.ts`, `scheduleEdits.ts`.
**App sync (`app/src/sync/`, no React except the `*.tsx`):** `api.ts` (`SyncApi`, errors), `cursor.ts`, `pull.ts`, `outbox.ts` (coalesce), `SyncEngine.ts`, `scheduler.ts`, `focusRefresh.ts`, `useSyncStatus.ts`, `useOnline.ts` + `useOnline.web.ts`, `SyncRuntime.tsx` + `SyncRuntime.web.tsx`.
**App auth (`app/src/auth/`):** `supabase.ts`, `tokens.ts`, `gate.ts`, `AuthProvider.tsx`; `src/screens/LoginScreen.tsx`.
**App data:** `src/data/RemoteStore.ts`, `src/data/index.web.ts`; modified `GymStore.ts`, `GymProvider.tsx`, `index.ts` types, `src/components/SyncStatusSlot.tsx`, `src/components/ConnectivityShell.tsx` + `.web.tsx`, `App.tsx`, `app.json`, `eas.json`, `package.json`.

---

### Task 1: Owner setup checklist (manual, owner signed in)

**Files:** none (the owner follows this list; later tasks consume the values).

Blocks: Tasks 12 (manual login check), 14 and 15. Tasks 2 to 11 and 13 run with Docker Postgres and fakes only.

- [ ] **Step 1: GitHub.** Create private repo `Gym-Tracker`; add it as `origin`; push the working branches.
- [ ] **Step 2: Supabase.** Create a new project. Choose the region closest to the Vercel function region (default `iad1`, so a US-East region) or set the Vercel region to match in step 4; a mismatch cost Financial Tracker ~1.5 to 2 s per save. Then: Authentication, Users, Add user (email + password, auto-confirm); Authentication, Sign In / Providers, turn **off** "Allow new users to sign up" (the anon key is public and there is no sign-up UI); Project Settings, JWT Keys: confirm the current key is asymmetric **ES256** (`api/app/auth.py` verifies ES256 against the project JWKS, as Financial Tracker does).
- [ ] **Step 3: Values to copy.**
  - `SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_URL`: Project Settings, API, Project URL.
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Project Settings, API Keys, the `anon` (public) key.
  - Runtime `DATABASE_URL`: Connect, Transaction pooler string (port 6543).
  - One-time migrate URL (not stored anywhere): Connect, Direct connection (port 5432), passed inline to `migrate.py`.
- [ ] **Step 4: Vercel.** Create project `gym-tracker` from the repo (root directory = repo root; `vercel.json` defines the services). Environment variables for Production and Preview: `DATABASE_URL` (pooler), `SUPABASE_URL`, `DB_POOL_MAX=3`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Leave `CORS_ORIGINS` unset (web is same-origin). Settings, Functions, Region: the same region as Supabase.
- [ ] **Step 5: Expo/EAS.** `npx eas-cli login`; `cd app && npx eas-cli init` (project `gym-tracker`, owner `parijatsutradhars-team`); note the project id for Task 14.
- [ ] **Step 6: Local env files.** `cp api/.env.example api/.env` and `cp app/.env.example app/.env`; fill `SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (leave `DATABASE_URL` pointing at the Docker Postgres from Task 7).
- [ ] **Step 7: Report back** to the executor: the Expo project id and the Vercel production domain.

---

### Task 2: API project, test harness and database schema

**Files:**
- Create: `api/{index.py,requirements.txt,requirements-dev.txt,pytest.ini}`, `api/app/{__init__,config,db,errors,main}.py`, `api/app/routes/{__init__,health}.py`, `api/scripts/{__init__,migrate}.py`, `supabase/init.sql`, `migrations/.gitkeep`, `api/tests/{conftest.py,test_schema.py,test_health.py}`; modify repo-root `.gitignore` (add `api/.venv/`, `__pycache__/`, `.pytest_cache/`, `api/.env`).
- Reference (copy, adapt names): Financial Tracker `api/index.py`, `api/app/{config,db,errors,main}.py`, `api/routes/health.py`, `api/scripts/migrate.py`.

**Interfaces:**
- Produces: `settings` (`database_url`, `supabase_url`, `cors_origins`, `port`); `get_pool()`, `acquire()`, `transaction()`, `close_pool()` (asyncpg, `statement_cache_size=0`, pool max `DB_POOL_MAX` default 3); `HttpError(status_code, message, details=None)` with the Financial Tracker exception handlers (Postgres check/unique violations become `400`); `app: FastAPI` in `app/main.py`, re-exported by `index.py`; `async def migrate(dsn: str, init_sql: Path, migrations_dir: Path) -> list[str]` in `scripts/migrate.py` (applies `init.sql`, then each `migrations/NNN_*.sql` not yet in table `schema_migrations(name text primary key, applied_at timestamptz)`; returns names applied this run); pytest fixtures `db` (a clean `asyncpg.Connection` to `TEST_DATABASE_URL`, default `postgres://postgres:postgres@localhost:5433/gymdb_test`, created and migrated once per session, all 7 tables truncated before each test), `client` (`httpx.AsyncClient` over `ASGITransport(app)`; calls `close_pool()` after each test).
- Schema (decided here): sequence `sync_seq`; each of `routines, routine_versions, days, shifts, occurrence_moves, day_exercises, sets` has `user_id uuid NOT NULL, id uuid NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz, seq bigint NOT NULL DEFAULT nextval('sync_seq'), PRIMARY KEY (user_id, id)` and index `idx_<table>_pull ON (user_id, seq)`. Domain columns are Plan 1's fields in snake_case: `routines(created_at timestamptz)`; `routine_versions(routine_id uuid, effective_from date, title text, repeat_rule text CHECK in weekly|twice_weekly|biweekly|never, start_date date, exercises jsonb, ended boolean)`; `days(date date, status text CHECK missed|skipped or null, shift_id uuid, routine_id uuid, title text, has_log boolean)`; `shifts(date date, mode text CHECK skip|catch_up|permanent, locked boolean, created jsonb, before jsonb)`; `occurrence_moves(routine_id uuid, from_date date, to_date date, shift_id uuid)`; `day_exercises(date date, position int CHECK >= 0, name text)`; `sets(day_exercise_id uuid, set_number int CHECK >= 1, reps int CHECK 0..999 or null, weight_kg numeric(7,2) CHECK 0..1000 or null)`.

- [ ] **Step 1: Write failing tests.** `test_schema.py`: `all_seven_tables_have_scoping_and_cursor_columns` (each has `user_id`, `id`, `updated_at`, `deleted_at`, `seq`); `same_id_can_exist_for_two_users` (insert `sets` ids equal with two `user_id`s succeeds; same user twice raises `UniqueViolationError`); `pull_index_exists_per_table` (`pg_indexes` has `idx_<t>_pull`); `seq_is_assigned_increasing`; `check_constraints_reject_bad_enum_and_ranges` (`repeat_rule='daily'`, `reps=1000`, `set_number=0`, `position=-1`); `init_sql_is_idempotent` (apply twice, no error); `migrate_applies_new_migrations_once` (temp dir with `001_x.sql` creating a table: first call returns `['001_x.sql']`, second `[]`). `test_health.py`: `health_ok_returns_200_status_ok`; `health_503_when_database_unreachable` (monkeypatch `db.acquire` to raise).
- [ ] **Step 2: Run** `cd api && python -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt && .venv/bin/pytest -q` against a Docker Postgres (`docker run -d --name gym-db -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine`; the harness creates `gymdb_test`). Expected: FAIL (modules and schema missing).
- [ ] **Step 3: Implement** the files above. `requirements.txt` is Financial Tracker's list verbatim (`fastapi>=0.115,<1.0`, `pydantic>=2.7,<3.0`, `asyncpg>=0.30,<0.32`, `pyjwt[crypto]>=2.9,<3.0`, `uvicorn>=0.30,<1.0`, `python-dotenv>=1.0,<2.0`); `requirements-dev.txt` adds `pytest`, `pytest-asyncio`, `httpx` (record resolved versions in the commit body). `pytest.ini`: `asyncio_mode = auto`, `testpaths = tests`. `config.py` keeps Financial Tracker's lazy `supabase_url` and `CORS_ORIGINS` defaults but with the Expo web ports `8081,19006,8443` and no finance settings. `main.py` mounts `health` at `/api/health` unauthenticated; routers added later use `dependencies=[require_auth]`.
- [ ] **Step 4: Run** `.venv/bin/pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat(api): FastAPI skeleton, test harness and Postgres schema with sync cursor`

---

### Task 3: JWT authentication

**Files:**
- Create: `api/app/auth.py`, `api/tests/test_auth.py`; extend `api/tests/conftest.py`.
- Reference: Financial Tracker `api/app/auth.py` (same JWKS client and ES256 rule).

**Interfaces:**
- Produces: `get_current_user(request: Request) -> dict` (verified payload; `401 Missing bearer token` / `Invalid token: ...`; `500` if `SUPABASE_URL` unset); `current_user_id(user: dict = Depends(get_current_user)) -> str` (the `sub` as a canonical UUID string, `401` if absent or not a UUID); `require_auth = Depends(get_current_user)`. Fixtures: `make_token(sub: str | None = None, *, exp_in: int = 3600, aud: str = "authenticated", key=None, alg: str = "ES256") -> str` and an autouse `jwks` fixture that generates one ES256 key pair and replaces `auth._get_jwk_client` with a stub whose `get_signing_key_from_jwt` returns the public key; `user_a`, `user_b` fixtures (distinct UUID strings) and `bearer(token) -> dict` header helper.

- [ ] **Step 1: Write failing tests** against a tiny throwaway app with one route `GET /whoami` using `current_user_id`: `missing_header_is_401`; `non_bearer_scheme_is_401`; `valid_token_returns_sub` (200, body equals `user_a`); `expired_token_is_401` (`exp_in=-10`); `wrong_audience_is_401` (`aud="anon"`); `token_signed_by_a_different_key_is_401`; `hs256_token_signed_with_the_public_key_is_401` (algorithm-confusion); `sub_that_is_not_a_uuid_is_401`; `unset_supabase_url_is_500`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_auth.py -q` → FAIL.
- [ ] **Step 3: Implement** `auth.py` (copy Financial Tracker's, add `current_user_id`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): Supabase JWT auth with user id dependency`

---

### Task 4: Push endpoint and row validation

**Files:**
- Create: `api/app/rows.py`, `api/app/services/{__init__,sync}.py`, `api/app/routes/sync.py` (push only here), `api/tests/{samples.py,test_push.py}`; modify `api/app/main.py` (mount `sync` at `/api/sync` with `dependencies=[require_auth]`).

**Interfaces:**
- Consumes: Task 2 `transaction()`; Task 3 `current_user_id`.
- Produces (`rows.py`): `TABLES: dict[str, TableSpec]` (per table: DB columns with SQL types, camelCase wire name, Pydantic model); `class RowInvalid(Exception)` with `.reason`; `validate_row(table: str, raw: object) -> dict` (returns snake_case column values incl. `updated_at`/`deleted_at` as aware datetimes; unknown extra keys such as `userId` are dropped); `to_wire(table: str, db_row: Mapping) -> dict` (camelCase top-level keys only, `user_id`/`seq` removed, timestamps formatted `YYYY-MM-DDTHH:MM:SS.mmmZ`, dates `YYYY-MM-DD`). Validation caps: `title`/`name` 1..200 chars (stored as given, the client trims); `exercises` list of at most 200 strings of at most 200 chars; `created`/`before` lists of at most 500 objects; `updatedAt` must be an ISO timestamp with a time and zone.
- Produces (`services/sync.py`): `MAX_PUSH_ENTRIES = 200`; `async def push(conn, user_id: str, entries: list[dict]) -> dict` returning `{acked, rejected}`. Algorithm: validate each entry independently; dedupe `(table, id)` inside the batch keeping the newest `updatedAt` (later wins ties) while still acking every entry id; take `pg_advisory_xact_lock(hashtextextended(<user_id>, 0))`; per table one `INSERT ... SELECT ... FROM jsonb_to_recordset($2::jsonb) ... ON CONFLICT (user_id, id) DO UPDATE SET ..., seq = nextval('sync_seq') WHERE <table>.updated_at < EXCLUDED.updated_at`. Every statement includes `user_id`.
- Produces (`routes/sync.py`): `POST /api/sync/push` (`entries` over 200 gives `413 {"error": ...}`, body not an object with `entries` list gives `400`).
- `samples.py`: `sample_row(table, id=None, **overrides) -> dict` valid camelCase rows for all 7 tables; `entry(table, **overrides)` building `{id: <new uuid>, table, row}`.

- [ ] **Step 1: Write failing tests** (`test_push.py`, real app via `client`, tokens for `user_a`):
  - `push_creates_rows_in_all_seven_tables_stamped_with_the_token_user`: one entry per table, 200, `acked` has all 7 entry ids, each table has one row with `user_id == user_a`.
  - `lww_newer_updatedAt_wins`: `sets` row reps 8 at `2026-10-19T12:00:00.000Z`, then reps 10 at `...12:00:01.000Z` gives DB reps 10; then reps 5 at `...11:59:00.000Z` leaves reps 10 and the third entry is still in `acked`.
  - `equal_updatedAt_is_a_noop_and_acked`: second identical push leaves `seq` unchanged.
  - `retried_batch_is_idempotent` (Review Focus 1): push a 5-row batch twice; row count 5, field values and `seq` equal after the retry, both responses ack all five ids.
  - `tombstone_wins_when_newer_and_older_tombstone_is_ignored`; `newer_live_row_revives_a_tombstone` (`deletedAt` back to null).
  - `invalid_entry_is_rejected_without_blocking_valid_entries`: three entries, the middle with `reps: 1000`: `rejected == [{id: <middle>, reason: <non-empty>}]`, other two in `acked` and stored.
  - `invalid_rows_are_rejected` (parametrized): unknown table `"foo"`; `id` `"not-a-uuid"`; missing `updatedAt`; `updatedAt` `"2026-10-19"`; `date` `"2026-13-40"`; `repeatRule` `"daily"`; shift `mode` `"x"`; day `status` `"late"`; `setNumber` 0; `reps` -1 and 1000; `weightKg` -1 and 1001; 201-char `name`; `exercises` `"Bench"` (not a list); `position` -1.
  - `client_supplied_user_id_is_ignored`: row carries `userId: <user_b>`; stored under `user_a`.
  - `batch_over_200_is_413_and_exactly_200_is_ok`; `empty_batch_is_ok`.
  - `duplicate_ids_in_one_batch_keep_the_newest`.
  - `json_and_decimal_columns_round_trip`: `exercises ["Bench press","Cable fly"]`, nested `shifts.created`/`before`, `weightKg` 22.5 and 2.5 stored exactly.
  - `database_error_rolls_back_the_whole_batch`: monkeypatch the second table's statement to raise; response `500`, no rows from the first table.
  - `push_round_trips_are_bounded`: a batch touching 3 tables issues at most 4 statements on the connection (one lock plus three upserts).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_push.py -q` → FAIL.
- [ ] **Step 3: Implement** `rows.py`, `services/sync.py`, `routes/sync.py` and mount it. Generate the per-table SQL from `TABLES` rather than seven hand-written statements.
- [ ] **Step 4: Run** → PASS (also full `pytest -q`).
- [ ] **Step 5: Commit** `feat(api): sync push with row validation, LWW and idempotent retries`

---

### Task 5: Pull endpoint with server cursor

**Files:**
- Modify: `api/app/services/sync.py`, `api/app/routes/sync.py`; Test: `api/tests/test_pull.py`.

**Interfaces:**
- Consumes: Task 4 `to_wire`, `TABLES`, `push`.
- Produces: `DEFAULT_PULL_LIMIT = 500`, `MAX_PULL_LIMIT = 1000`; `async def pull(conn, user_id: str, cursor: int, limit: int) -> dict` returning `{changes, cursor, hasMore, serverTime}`: a single `UNION ALL` over the seven tables (`WHERE user_id = $1 AND seq > $2`, each capped), outer `ORDER BY seq LIMIT limit + 1`; `hasMore` is true when the extra row exists; `cursor` is the last returned `seq` (the request cursor when empty); `GET /api/sync/pull?cursor=&limit=`. `serverTime` is the API's UTC clock in the wire timestamp format.

- [ ] **Step 1: Write failing tests:**
  - `pull_returns_changes_in_seq_order_across_tables`.
  - `cursor_pages_without_gaps_or_repeats`: 5 rows pushed, `limit=2` gives page sizes 2, 2, 1 with `hasMore` true, true, false; the union is the 5 distinct ids.
  - `cursor_is_server_assigned_not_client_updatedAt` (Review Focus 5): push row A (`updatedAt` 2026-10-19), note the cursor, then push row B with `updatedAt` `2000-01-01T00:00:00.000Z`; pulling from the noted cursor returns B.
  - `update_moves_a_row_to_a_later_seq`; `tombstones_are_returned_with_deletedAt`.
  - `wire_shape_is_camelCase_without_user_id_or_seq`: keys of a `sets` change row are exactly `id, updatedAt, deletedAt, dayExerciseId, setNumber, reps, weightKg`; `updatedAt` equals the pushed `2026-10-19T12:00:00.123Z` byte for byte; `date` fields are `YYYY-MM-DD`; `serverTime` ends in `Z`.
  - `limit_and_cursor_validation`: `limit=1001`, `limit=0`, `cursor=-1`, `cursor=abc` are `400`; omitted values default to 500 and 0.
  - `empty_pull_returns_the_request_cursor_and_hasMore_false`.
  - `pull_uses_one_query` (counting wrapper sees one statement).
  - `concurrent_pushes_for_one_user_serialize`: two concurrent 50-row pushes (`asyncio.gather`), then paging with `limit=10` yields all 100 distinct ids and no id twice.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_pull.py -q` → FAIL.
- [ ] **Step 3: Implement** `pull` and the route (query-param validation via FastAPI `Query(ge=..., le=...)`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): sync pull with server-assigned cursor and paging`

---

### Task 6: Second-user isolation tests (spec Section 8 item 10)

**Files:** Test: `api/tests/test_isolation.py`; Modify: only if a test exposes a missing filter.

- [ ] **Step 1: Write the tests** (users `user_a`, `user_b` with real tokens):
  - `second_user_pull_is_empty_after_first_user_pushes_rows_in_every_table`.
  - `second_user_cannot_overwrite_first_users_row_by_pushing_its_id`: A pushes `sets` id X reps 10 at t1; B pushes id X reps 99 at a later t2 (acked); A pulls from 0 and sees reps 10; the DB holds two rows with id X, one per user.
  - `second_user_tombstone_for_first_users_id_does_not_delete_it`.
  - `second_user_cannot_probe_with_a_foreign_cursor` (B pulls with cursor 0 and with A's max `seq`, both empty).
  - `body_user_id_cannot_redirect_a_write` (entry row `userId: user_a` sent with B's token lands under B).
  - `every_api_route_except_health_requires_auth`: iterate `app.routes` whose path starts with `/api` and is not `/api/health`; each returns `401` with no token and with a token for a bad key.
  - `every_statement_touching_a_synced_table_filters_by_user_id`: wrap the connection to record SQL during a push and a pull; each recorded statement that mentions a synced table also contains `user_id`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_isolation.py -q`. Expected: PASS if Tasks 4 and 5 are right; any failure is a scoping bug, fixed in `services/sync.py` (not in the test).
- [ ] **Step 3: Run** full `.venv/bin/pytest -q` → PASS.
- [ ] **Step 4: Commit** `test(api): prove a second user cannot read or overwrite the first user's rows`

---

### Task 7: Local dev stack, env templates, Vercel config

**Files:**
- Create: `scripts/dev.sh`, `vercel.json`, `api/.env.example`, `app/.env.example`.
- Reference: Financial Tracker `scripts/dev.sh`, `vercel.json`, `api/.env.example`, `app/.env.example`.

**Interfaces:**
- Produces: `./scripts/dev.sh [--no-db]` starting (a) Docker `postgres:16-alpine` container `gym-db` (volume `gym_pgdata`, host port 5433, db `gymdb`, kept running on exit) and applying the schema through `api/scripts/migrate.py`; (b) `api/.venv` created and installed if missing; (c) `uvicorn app.main:app --reload --port 8000` in `api/`; (d) `npx expo start --web --port 8443` in `app/`. Logs are prefixed `[api]` and `[web]`, Ctrl-C stops both, one dying stops the other (same process-group pattern as Financial Tracker). Copies `.env.example` to `.env` when missing.
- `vercel.json` is Financial Tracker's with names changed: service `web` (`root: app/`, `buildCommand: npm install && EXPO_PUBLIC_API_URL= npx expo export --platform web`, `outputDirectory: dist`) and service `api` (`root: api/`, `entrypoint: index:app`), rewrites `/api/(.*)` to `api`, everything else to `web`.
- Env templates, each variable commented with where its value comes from (as in Task 1): `api/.env.example` has `DATABASE_URL=postgres://postgres:postgres@localhost:5433/gymdb`, `SUPABASE_URL=`, `CORS_ORIGINS=http://localhost:8081,http://localhost:19006,http://localhost:8443`, `DB_POOL_MAX=3`, `PORT=8000`; `app/.env.example` has `EXPO_PUBLIC_API_URL=http://localhost:8000` (note: a physical phone needs the Mac's LAN IP), `EXPO_PUBLIC_SUPABASE_URL=`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=`.

- [ ] **Step 1: Implement** the four files.
- [ ] **Step 2: Verify:** `bash -n scripts/dev.sh`; run `./scripts/dev.sh`; `curl -s localhost:8000/api/health` prints `{"status":"ok"}`; `curl -s -o /dev/null -w '%{http_code}' localhost:8000/api/sync/pull` prints `401`; `localhost:8443` serves the app; Ctrl-C stops both servers and leaves `gym-db` running.
- [ ] **Step 3: Commit** `chore: dev script, env templates and Vercel services config`

---

### Task 8: Convergent ids for day logs (changes Plan 1 engine files)

**Files:**
- Create: `app/src/engine/ids.ts`; **Modify (Plan 1):** `app/src/engine/dayLog.ts`, `app/src/engine/sets.ts`, `app/src/engine/scheduleEdits.ts`; Test: `app/src/engine/__tests__/ids.test.ts`, `converge.test.ts`.

**Interfaces:**
- Produces: `stableId(kind: 'day' | 'day_exercise' | 'set', key: string): string` — pure, synchronous; a 128-bit hash of `kind + ':' + key` formatted as a lowercase UUID with version nibble `8` and variant `10xx`. Id rules: `Day.id = stableId('day', date)`; `DayExercise.id = stableId('day_exercise', date + '|' + snapshotIndex)` only for rows `ensureDayLog`/`startBackfill` snapshot from the schedule (`snapshotIndex` = index in the scheduled list); `addExercise` on a logged day uses `ctx.newId()` and position `max(position over all of that date's day_exercises rows, tombstones included) + 1`; `SetRow.id = stableId('set', dayExerciseId + '|' + setNumber)`. Everything else keeps `ctx.newId()`.

- [ ] **Step 1: Write failing tests.** `ids.test.ts`: `stableId_is_deterministic_and_uuid_shaped` (regex `^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`; equal for equal input; different for a different kind or key); `no_collisions_over_1000_keys`. `converge.test.ts` (Review Focus 4; weekly Chest & Tricep with Bench press and Cable fly, today `2026-10-19`, two devices = two states built from the same base with different `makeCtx` seeds, device B's clock later):
  - `two_devices_logging_the_same_day_converge`: A logs Bench press `[10,60]`, B logs Bench press `[8,62.5]`; exchange all changes with `mergeRemote` both ways; both states have identical live rows, `getDay(...).exercises` has length 2 (not 4), and Bench press set 1 is reps 8 / 62.5 kg on both.
  - `skip_on_two_devices_leaves_one_day_row`.
  - `deleted_then_relogged_set_reuses_the_same_row_id` (tombstoned set revived with `deletedAt: null`).
  - `exercises_added_on_two_devices_both_survive` (both names show; a duplicate is visible and deletable; nothing lost).
  - `add_after_delete_never_reuses_a_live_exercise_id` (day `[Bench 0, Fly 1, Dips 2]`, delete Fly, add Pushups: Dips keeps its name, id and sets; Pushups is a new row at position 3).
- [ ] **Step 2: Run** `npm test -- ids converge` → FAIL.
- [ ] **Step 3: Implement** `ids.ts` (a small 128-bit non-crypto hash is enough; it must not use async APIs) and switch the id assignments in `dayLog.ts` (`ensureDayLog`, `startBackfill`), and `sets.ts` (`syncSets`; sets are renumbered on every sync, so `dayExerciseId|setNumber` is safe). `scheduleEdits.ts` `addExercise` keeps `newId()` but must use the max-position rule. A tombstoned row with the same id must be re-upserted, not skipped.
- [ ] **Step 4: Run** full `npm test` and `npm run typecheck` → PASS (fix any Plan 1 test that hard-coded `id-N` for these rows by asserting on fields instead).
- [ ] **Step 5: Commit** `feat(engine): deterministic ids so day logs converge across devices`

---

### Task 9: Sync API client, pull loop, outbox coalescing, GymStore remote hooks

**Files:**
- Create: `app/src/sync/{api,cursor,pull,outbox}.ts`; **Modify (Plan 1):** `app/src/data/GymStore.ts`; Test: `app/src/sync/__tests__/{api,cursor,pull,outbox}.test.ts`, extend `app/src/data/__tests__/GymStore.test.ts`.

**Interfaces:**
- Produces (`api.ts`): `class NetworkError extends Error`, `class AuthError extends Error`, `class HttpError extends Error { status: number }`; `interface TokenSource { getToken(): Promise<string>; refreshToken(): Promise<string> }` (`getToken` throws `AuthError` with no session and `NetworkError` when a refresh failed retryably); `interface PushEntry {id: string; table: TableName; row: Change['row']}`; `interface PushResult {acked: string[]; rejected: {id: string; reason: string}[]; serverTime: string}`; `interface PullPage {changes: Change[]; cursor: number; hasMore: boolean; serverTime: string}`; `interface SyncApi { push(entries: PushEntry[]): Promise<PushResult>; pull(cursor: number, limit?: number): Promise<PullPage> }`; `createSyncApi(deps: {baseUrl: string; tokens: TokenSource; fetch?: typeof fetch; timeoutMs?: number}): SyncApi` (`baseUrl` = `EXPO_PUBLIC_API_URL ? EXPO_PUBLIC_API_URL + '/api' : '/api'` as in Financial Tracker; default timeout 20000 ms).
- Produces (`cursor.ts`): `interface CursorStore { get(): Promise<number>; set(n: number): Promise<void> }`; `createCursorStore(storage: KeyValueStorage): CursorStore` (key `gt:v1:sync`, unparseable value reads as 0).
- Produces (`pull.ts`): `pullAll(deps: {api: SyncApi; cursor: CursorStore; apply(changes: Change[]): Promise<void>; limit?: number}): Promise<{pages: number; changes: number; serverTime: string | null}>`.
- Produces (`outbox.ts`): `coalesceEntries(entries: OutboxEntry[]): {send: PushEntry[]; ackIds: string[]}`.
- **Plan 1 change in `GymStore.ts`:** `dispatch(changes: Change[]): boolean` (was `void`; returns `false` and changes nothing while writes are paused); `setWritesPaused(paused: boolean): void`; `applyRemote(changes: Change[]): Promise<void>` (runs `mergeRemote` against in-memory state, notifies subscribers synchronously if anything was accepted, queues `store.applyRemote(accepted)` on the same serial chain as commits, resolves once persisted; allowed while paused).

- [ ] **Step 1: Write failing tests.**
  `api.test.ts` (fake `fetch`): `push_posts_entries_with_bearer_token`; `pull_builds_cursor_and_limit_query` (`/api/sync/pull?cursor=0&limit=500`); `401_refreshes_the_token_once_and_retries`; `second_401_throws_AuthError`; `fetch_rejection_throws_NetworkError`; `request_that_never_resolves_times_out_as_NetworkError` (fake timers, 20000 ms); `5xx_throws_HttpError_with_status`; `4xx_keeps_the_server_error_message`; `token_source_NetworkError_propagates`.
  `cursor.test.ts`: `defaults_to_0`; `persists_across_instances`; `corrupt_value_reads_as_0`.
  `pull.test.ts`: `pages_until_hasMore_is_false` (1200 changes, pages of 500: 3 requests, 1200 applied); `cursor_is_saved_after_each_page_and_after_apply` (call order apply, set, apply, set); `apply_failure_does_not_advance_the_cursor`; `crash_after_page_one_resumes_from_the_saved_cursor`; `empty_pull_applies_nothing`.
  `outbox.test.ts`: `keeps_the_newest_entry_per_row_and_acks_all_ids` (10 entries for one set row: one sent, 10 ack ids); `same_row_id_in_different_tables_stays_separate`; `send_order_follows_first_seq`.
  `GymStore.test.ts` additions: `applyRemote_merges_notifies_and_persists_after_pending_commits`; **`remote_older_than_a_local_edit_is_ignored`** (Review Focus 3: dispatch a set edit at `updatedAt` T2, `applyRemote` the older T1 version of the same row: state unchanged, subscribers not notified, `store.applyRemote` not called with it); **`pull_in_flight_during_a_local_edit_does_not_clobber_it`** (start a `pullAll` whose `apply` is `gym.applyRemote` and whose fake API resolves late; dispatch the edit meanwhile; after the pull resolves the edit is intact and still in the outbox); `remote_tombstone_removes_the_row_from_the_view`; `dispatch_returns_false_and_changes_nothing_while_paused`; `applyRemote_still_works_while_paused`.
- [ ] **Step 2: Run** `npm test -- sync GymStore` → FAIL.
- [ ] **Step 3: Implement** the four sync files and the `GymStore` changes. `GymStore.applyRemote` is the only new write path and must not append to the outbox.
- [ ] **Step 4: Run** full `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(sync): API client, paged pull, outbox coalescing and GymStore remote hooks`

---

### Task 10: SyncEngine (phone push/pull cycle)

**Files:**
- Create: `app/src/sync/SyncEngine.ts`; Test: `app/src/sync/__tests__/SyncEngine.test.ts`.

**Interfaces:**
- Consumes: Task 9 `SyncApi`, `CursorStore`, `pullAll`, `coalesceEntries`, errors; Plan 1 `OutboxApi`.
- Produces: `type SyncPhase = 'idle' | 'syncing' | 'offline' | 'auth_required' | 'clock_skew' | 'error'`; `interface SyncStatus {phase: SyncPhase; pending: number; lastSyncedAt: string | null; lastError: string | null}`; `MAX_CLOCK_SKEW_MS = 300000`; `PUSH_BATCH = 200`; `nextRetryDelayMs(failures: number): number` (0 gives 0; `min(2000 * 2^(failures-1), 60000)`); `class SyncEngine { constructor(deps: {outbox: OutboxApi; api: SyncApi; cursor: CursorStore; apply(changes: Change[]): Promise<void>; now(): number}); syncOnce(): Promise<void>; getStatus(): SyncStatus; subscribe(fn: () => void): () => void; resume(): void }`. `syncOnce` is single-flight (a call during a cycle schedules exactly one follow-up cycle). Cycle: pull; if `|now() - Date.parse(serverTime)| > MAX_CLOCK_SKEW_MS` set `clock_skew` and skip push; else push batches of `peek(200)` coalesced, `ack` coalesced ids plus rejected ids; pull again only if anything was pushed. `NetworkError` gives `offline`, `AuthError` gives `auth_required` (until `resume()`), `HttpError` 5xx/429 gives `error`; all keep the outbox. `pending` mirrors `outbox.count()` through `subscribe`.

- [ ] **Step 1: Write failing tests** (real `LocalStore` over `MemoryStorage`, fake `SyncApi` that records calls and keeps a server map):
  - `push_sends_the_outbox_in_batches_of_200_then_acks` (450 distinct rows: pushes of 200, 200, 50; `count() === 0`).
  - `coalesced_edits_send_one_row_but_ack_every_entry` (10 edits to one set: 1 row sent, `count() === 0`).
  - `cycle_order_is_pull_push_pull_and_skips_the_second_pull_when_nothing_was_pushed`.
  - `rejected_entries_are_acked_reported_and_do_not_block_the_rest` (`lastError` contains the reason).
  - **`timeout_after_server_commit_retries_same_entries_and_acks`** (Review Focus 1): the fake server applies the batch then throws `NetworkError` on the first push; after it `count() === 3` and phase `offline`; the second `syncOnce` sends the same ids, `count() === 0`, the fake server has 3 rows, not 6.
  - `network_error_keeps_the_outbox_and_sets_offline`; `server_500_sets_error_and_keeps_the_outbox`; `nextRetryDelayMs` table (0→0, 1→2000, 2→4000, 5→32000, 6→60000, 20→60000).
  - `auth_error_sets_auth_required_and_resume_syncs_again`.
  - **`expired_session_offline_is_offline_not_auth_required`** (Review Focus 2: `createSyncApi` over a `TokenSource` whose `getToken` throws `NetworkError`; phase `offline`; a later `getToken` success syncs and empties the outbox).
  - **`clock_skew_pauses_push_but_still_pulls`** (Review Focus 5: `serverTime` 20 minutes ahead of `now()`: phase `clock_skew`, `push` never called, pulled rows applied, outbox intact; with a corrected clock the next cycle pushes).
  - `edit_made_during_a_push_survives_the_ack` (a deferred push; dispatch another change meanwhile; after the ack only the new entry remains).
  - `overlapping_syncOnce_calls_run_one_follow_up_cycle`; `status_pending_follows_outbox_subscription`.
- [ ] **Step 2: Run** `npm test -- SyncEngine` → FAIL.
- [ ] **Step 3: Implement** `SyncEngine.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sync): SyncEngine with batched coalesced push, paged pull and failure states`

---

### Task 11: Sync triggers, runtime and the unsynced dot

**Files:**
- Create: `app/src/sync/{scheduler.ts,useSyncStatus.ts,SyncRuntime.tsx}`; **Modify (Plan 1):** `app/src/components/SyncStatusSlot.tsx` (renders `null` today), `app/src/data/GymProvider.tsx` (mount `<SyncRuntime>`); Test: `app/src/sync/__tests__/scheduler.test.ts`.

**Interfaces:**
- Produces (`scheduler.ts`): `createScheduler(deps: {engine: Pick<SyncEngine,'syncOnce'|'getStatus'>; outbox: Pick<OutboxApi,'count'|'subscribe'>; timers: {setTimeout; clearTimeout}; debounceMs?: number}): {start(): void; stop(): void; onForeground(): void}`. Rules: `start` runs one cycle at once; a commit that raises `count()` above its last value schedules a cycle after 1500 ms (a burst collapses into one); an ack that lowers `count()` schedules nothing; after a failed cycle (`offline`/`error`) retry after `nextRetryDelayMs(failures)`; no retry while `auth_required`; `onForeground` runs a cycle immediately; `stop` clears every timer.
- Produces: `useSyncStatus(): SyncStatus & {signIn(): void}`; `SyncRuntime` (native) builds `SyncEngine` from `dataStore as LocalStore` (it is the `OutboxApi`), `createSyncApi({baseUrl, tokens: supabaseTokenSource})` (Task 12), `createCursorStore(asyncStorageAdapter)`, `apply = gym.applyRemote`; starts the scheduler once a session exists, forwards `AppState` `active` to `onForeground`, and calls `engine.resume()` when auth state becomes signed in.
- `SyncStatusSlot` (inside Plan 1's `TopBar`): `pending > 0` renders an 8px `accent` dot with `accessibilityLabel="Unsynced changes"`; `auth_required` renders a pressable `Sign in to sync` (muted, Inter 12px) that opens `LoginScreen` in a `Modal`; `clock_skew` renders `Check your device clock`; otherwise `null`. No new color tokens, no spinner.

- [ ] **Step 1: Write failing tests** (`scheduler.test.ts`, Vitest fake timers): `start_runs_one_cycle_immediately`; `commit_burst_debounces_to_one_cycle_after_1500ms` (5 commits within 1 s: one `syncOnce` at 1500 ms after the last); `ack_does_not_retrigger`; `failure_retries_with_backoff_until_success` (retries at 2000, 4000, 8000 ms); `no_retry_while_auth_required`; `foreground_runs_immediately`; `stop_clears_pending_timers`.
- [ ] **Step 2: Run** `npm test -- scheduler` → FAIL.
- [ ] **Step 3: Implement** the scheduler, hook, runtime and slot.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npx expo export --platform web` → PASS / builds.
- [ ] **Step 5: Verify (Android, airplane mode, no server needed):** edit a set, the dot appears; kill and reopen the app, the dot is still there.
- [ ] **Step 6: Commit** `feat(sync): scheduler, SyncRuntime and the unsynced dot in the top bar`

---

### Task 12: Supabase login and persisted session

**Files:**
- Create: `app/src/auth/{supabase,tokens,gate}.ts`, `app/src/auth/AuthProvider.tsx`, `app/src/screens/LoginScreen.tsx`; **Modify (Plan 1):** `app/App.tsx`, `app/package.json`; Test: `app/src/auth/__tests__/{tokens,gate}.test.ts`.
- Reference: Financial Tracker `app/src/supabase.ts` and `LoginScreen.tsx` (same sign-in call; restyled to this app's tokens).

**Interfaces:**
- Install: `npm install @supabase/supabase-js@^2.112.3 react-native-url-polyfill@^4.0.0`.
- Produces (`supabase.ts`): `AUTH_STORAGE_KEY = 'gt:v1:auth'`; `supabase` created with `storage: AsyncStorage`, `storageKey: AUTH_STORAGE_KEY`, `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`; warns instead of throwing when the env vars are blank (as Financial Tracker does). AsyncStorage is localStorage on web, so the session persists on both.
- Produces (`tokens.ts`): `interface AuthLike { getSession(): Promise<{data: {session: {access_token: string} | null}; error: {name: string} | null}>; refreshSession(): Promise<{data: {session: {access_token: string} | null}; error: {name: string} | null}> }`; `createTokenSource(auth: AuthLike): TokenSource`; `supabaseTokenSource = createTokenSource(supabase.auth)`. Mapping: no session and no error gives `AuthError`; error named `AuthRetryableFetchError` (or any fetch failure) gives `NetworkError`; any other refresh error gives `AuthError`.
- Produces (`gate.ts`): `resolveGate(i: {platform: 'native' | 'web'; hasStoredSession: boolean; hasLocalData: boolean}): 'login' | 'app' | 'app_signin_prompt'` — stored session gives `app` on both platforms (an expired access token is still a stored session); no session: web gives `login`; native gives `login` if there is no local data, else `app_signin_prompt`. `hasStoredSession` reads `AUTH_STORAGE_KEY` straight from storage, not from `getSession()`, so an offline refresh failure cannot log the user out.
- `AuthProvider`: `useAuth(): {hasStoredSession: boolean; loading: boolean}`; subscribes to `onAuthStateChange`. `LoginScreen`: email + password, `Sign In` button (accent fill, on-accent text, disabled while submitting), inline error text, heading `Gym Tracker`, subtitle `Sign in to continue`, token colors, no sign-up link.
- `App.tsx` order: fonts, `AuthProvider`, then per `resolveGate`: web without a session renders `LoginScreen` before `GymProvider`; native always initializes `GymProvider` first (local data needs no network), then gates.

- [ ] **Step 1: Write failing tests.** `tokens.test.ts` (fake `AuthLike`): `getToken_returns_the_access_token`; `getToken_without_a_session_throws_AuthError`; `getToken_when_refresh_failed_retryably_throws_NetworkError` (error name `AuthRetryableFetchError`); `refreshToken_returns_the_new_token`; `refreshToken_with_invalid_refresh_token_throws_AuthError`. `gate.test.ts` (Review Focus 2): table over platform x stored x local data, including `expired_stored_session_still_opens_the_app` (native and web `app`), `fresh_native_install_shows_login`, `native_with_local_data_but_no_session_shows_signin_prompt_not_login`, `web_without_session_shows_login`.
- [ ] **Step 2: Run** `npm test -- tokens gate` → FAIL.
- [ ] **Step 3: Implement** the files and wire `App.tsx`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npx expo export --platform web` → PASS.
- [ ] **Step 5: Verify (needs Task 1):** web sign-in with the owner's user, reload: still signed in; Android kill and reopen: still signed in; wrong password shows the Supabase error text inline.
- [ ] **Step 6: Commit** `feat(auth): Supabase sign-in with persisted session and offline-safe gate`

---

### Task 13: Website remote store, offline banner, focus refresh

**Files:**
- Create: `app/src/data/{RemoteStore.ts,index.web.ts}`, `app/src/sync/{focusRefresh.ts,useOnline.ts,useOnline.web.ts,SyncRuntime.web.tsx}`, `app/src/components/{ConnectivityShell.tsx,ConnectivityShell.web.tsx,LoadFailedScreen.tsx}`; **Modify (Plan 1):** `app/src/data/GymProvider.tsx` (show `LoadFailedScreen` with a Retry button when `init` throws `NetworkError`, next to the existing `StoreCorruptError` screen), `app/App.tsx` (wrap Home in `ConnectivityShell`); Test: `app/src/data/__tests__/RemoteStore.test.ts`, `app/src/sync/__tests__/focusRefresh.test.ts`.

**Interfaces:**
- Produces (`RemoteStore.ts`): `class RemoteStore implements DataStore { constructor(api: SyncApi, deps: {newId(): string; sleep(ms: number): Promise<void>}); load(): Promise<DataState>; commit(changes: Change[]): Promise<void>; applyRemote(changes: Change[]): Promise<void>; pullDelta(): Promise<Change[]> }`. `load` pages from cursor 0 (limit 500) and keeps the cursor in memory; `commit` pushes `changes` as entries with fresh ids in chunks of 200, retrying `NetworkError`/5xx at 1, 2, 4, 8, 16 s (5 attempts) then throws, and throws on any `rejected`; `applyRemote` is a no-op (the website persists nothing); `pullDelta` pulls since the cursor and returns the changes.
- `index.web.ts`: `createDataStore()` returns `new RemoteStore(createSyncApi({baseUrl, tokens: supabaseTokenSource}), {newId, sleep})`. Metro picks it for web by platform extension, so Plan 1's `index.ts` (native, `LocalStore`) is untouched.
- Produces (`focusRefresh.ts`): `createFocusRefresh(deps: {pull(): Promise<Change[]>; apply(changes: Change[]): Promise<void>; isOnline(): boolean; subscribe(fn: () => void): () => void}): () => void` (returns the unsubscribe). `SyncRuntime.web.tsx` wires `subscribe` to `document` `visibilitychange` (when visible) and `window` `focus`, `pull = remote.pullDelta`, `apply = gym.applyRemote`.
- `useOnline(): boolean` (`useOnline.ts` returns `true`; `.web.ts` follows `navigator.onLine` plus `online`/`offline` events). `ConnectivityShell.web.tsx`: when offline renders a top banner with the exact text `You're offline. Changes won't save`, dims the children and sets `pointerEvents="none"` on them, and calls `gym.setWritesPaused(true)`; resumes and runs a refresh on reconnect; when `gym.lastError` is non-null (a commit gave up) shows `A change didn't save. Reload to resync.` with a Reload button. The native file passes children through.

- [ ] **Step 1: Write failing tests.** `RemoteStore.test.ts` (fake `SyncApi`): `load_pages_until_hasMore_false_and_builds_the_state` (1200 rows, 3 requests); `load_rejects_with_NetworkError_when_offline`; `commit_pushes_changes_as_entries_with_fresh_ids`; `commit_retries_network_errors_with_1_2_4s_backoff_then_succeeds` (sleep spy `[1000, 2000]`); `commit_gives_up_after_5_attempts_and_throws`; `commit_throws_when_the_server_rejects_an_entry`; `commit_401_surfaces_AuthError`; `pullDelta_returns_changes_since_the_cursor_and_advances_it`; `applyRemote_is_a_noop`. `focusRefresh.test.ts`: `refreshes_when_the_event_fires` (a tab left open on a stale day picks up phone edits without reload); `overlapping_events_coalesce_into_one_pull`; `skips_while_offline`; `a_failed_pull_is_swallowed_and_the_next_event_retries`.
- [ ] **Step 2: Run** `npm test -- RemoteStore focusRefresh` → FAIL.
- [ ] **Step 3: Implement** the files above and the two Plan 1 edits.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npx expo export --platform web` → PASS / builds.
- [ ] **Step 5: Verify (web, needs Tasks 1 and 7):** `./scripts/dev.sh`, sign in; DevTools, Network, Offline: banner shows the exact text, taps do nothing; back online: banner clears and a tap saves; edit a set on the phone, then focus the web tab: the change appears without reload.
- [ ] **Step 6: Commit** `feat(web): remote data store, offline banner with paused edits, refresh on focus`

---

### Task 14: EAS and Expo configuration

**Files:** Modify: `app/app.json`, `app/eas.json`, `app/package.json`.

**Interfaces:**
- Install: `npx expo install expo-updates`.
- `app.json`: add `updates.url` = `https://u.expo.dev/<projectId>` and `extra.eas.projectId` = `<projectId>` (from Task 1 step 5; Plan 1 deliberately left both out). `runtimeVersion.policy: appVersion`, `owner`, Android package stay as Plan 1 set them.
- `eas.json`: add the same `env` block to **both** `build.preview` and `build.production` (Financial Tracker only had it on preview): `EXPO_PUBLIC_API_URL` = the Vercel production origin, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the anon key is public by design, as in Financial Tracker). Channels `preview` and `production` already exist from Plan 1.

- [ ] **Step 1: Edit** the three files with the owner-supplied values.
- [ ] **Step 2: Verify:** `npx expo config --type public` shows `updates.url` and `extra.eas.projectId`; `npx eas-cli config --platform android --profile preview` resolves the env vars (needs login, otherwise note it as unverified).
- [ ] **Step 3: Commit** `chore(app): EAS Update, project id and build env for preview and production`

---

### Task 15: End-to-end verification

**Files:** Modify: nothing expected (fix defects found, each with a regression test where code is involved).

- [ ] **Step 1: Automated.** `cd api && .venv/bin/pytest -q` all pass (schema, health, auth, push, pull, isolation). `cd app && npm test && npm run typecheck && npx expo export --platform web` all pass.
- [ ] **Step 2: Schema on Supabase (owner confirms before this runs).** `DATABASE_URL="<direct 5432 string>" api/.venv/bin/python api/scripts/migrate.py`; run it twice and confirm the second run applies nothing.
- [ ] **Step 3: Vercel deploy (owner-run push or `vercel --prod`).** `curl https://<domain>/api/health` prints `{"status":"ok"}`; `curl -i https://<domain>/api/sync/pull` is `401`; the web root loads the login screen. Timing check against KNOWN_ISSUES #1: a one-row push with a valid token takes well under 500 ms warm (`curl -w '%{time_total}'`).
- [ ] **Step 4: EAS (owner-run).** `cd app && npx eas-cli build --platform android --profile preview`; install the APK. Then change a visible string, `npx eas-cli update --channel preview --message "e2e"`, relaunch the app twice, and confirm the change arrives. Check the app talks to the production API, not the placeholder (the unsynced dot clears after a sync).
- [ ] **Step 5: Manual two-device check.**
  1. Phone in airplane mode: log a set. The dot appears; kill and reopen: the set and dot remain.
  2. Airplane mode off: the dot clears within 60 s, or at once on foreground.
  3. The open web tab, on focus, shows the set without reload.
  4. Edit an exercise name on the web; foreground the phone; it appears.
  5. Delete a set on the phone offline, reconnect: it disappears from the web (tombstone).
  6. Phone offline logs Bench press `10 x 60` for today, web logs Bench press `8 x 62.5` for today: after reconnect both show one Bench press tile and the same (newer) values.
  7. In the Supabase dashboard sign the user out of all sessions; on the phone the next sync shows `Sign in to sync`, the workout screen stays usable, and signing in pushes the pending changes.
  8. Web DevTools offline: the exact banner text, edits paused.
- [ ] **Step 6: Report** results, anything unverified on a device, and any fixes as `fix: issues found in end-to-end pass`.

---

## Spec coverage

- Section 5 phone: Tasks 9 to 11. Website: Task 13. Section 6 backend and data: Tasks 2 to 6. Section 7 owner tasks: Task 1, wiring in Tasks 7, 12, 14. Section 8 item 8 (sync half): Tasks 8, 10, 15. Item 10: Task 6.
