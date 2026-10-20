-- Gym Tracker schema. Idempotent: scripts/migrate.py applies it on every run.
--
-- The backend is a thin sync store for the app's seven tables. Every row is
-- keyed (user_id, id): the server stamps user_id from the verified JWT, so an
-- id pushed by one user can never touch another user's row. seq is the pull
-- cursor, drawn from one global sequence and re-assigned on every accepted
-- upsert. There are no foreign keys between synced tables (rows arrive in any
-- order) and none to auth.users (local dev runs without Supabase).

CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routines (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  created_at timestamptz,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_routines_pull ON routines (user_id, seq);

CREATE TABLE IF NOT EXISTS routine_versions (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  routine_id uuid,
  effective_from date,
  title text,
  repeat_rule text CHECK (repeat_rule IN ('weekly', 'twice_weekly', 'biweekly', 'never')),
  start_date date,
  exercises jsonb,
  ended boolean,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_routine_versions_pull ON routine_versions (user_id, seq);

CREATE TABLE IF NOT EXISTS days (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  date date,
  status text CHECK (status IN ('missed', 'skipped')),
  shift_id uuid,
  routine_id uuid,
  title text,
  has_log boolean,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_days_pull ON days (user_id, seq);

CREATE TABLE IF NOT EXISTS shifts (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  date date,
  mode text CHECK (mode IN ('skip', 'catch_up', 'permanent')),
  locked boolean,
  created jsonb,
  before jsonb,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_shifts_pull ON shifts (user_id, seq);

CREATE TABLE IF NOT EXISTS occurrence_moves (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  routine_id uuid,
  from_date date,
  to_date date,
  shift_id uuid,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_occurrence_moves_pull ON occurrence_moves (user_id, seq);

CREATE TABLE IF NOT EXISTS day_exercises (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  date date,
  position int CHECK (position >= 0),
  name text,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_day_exercises_pull ON day_exercises (user_id, seq);

CREATE TABLE IF NOT EXISTS sets (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  day_exercise_id uuid,
  set_number int CHECK (set_number >= 1),
  reps int CHECK (reps BETWEEN 0 AND 999),
  weight_kg numeric(7, 2) CHECK (weight_kg BETWEEN 0 AND 1000),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sets_pull ON sets (user_id, seq);

-- Supabase also serves every table in `public` through its Data API to anyone holding the anon key, which
-- ships in the app. Only the API may touch these rows: it connects as the tables' owner, which RLS does not
-- apply to, so RLS with no policies refuses the anon and authenticated roles everything. The revokes take back
-- Supabase's default grants as well; they are skipped where those roles don't exist (local Postgres).
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE occurrence_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE days ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) = 2 THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END $$;
