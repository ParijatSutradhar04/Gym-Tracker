#!/usr/bin/env bash
#
# Brings the whole stack up locally: the Postgres container, the API, and the
# Expo web dev server, with both logs streamed to this terminal and both shut
# down together on Ctrl-C.
#
#   ./scripts/dev.sh              starts everything
#   ./scripts/dev.sh --no-db      assumes Postgres is already running
#
# This never destroys anything. An existing container is started back up with
# its volume intact, so synced rows survive a restart. The container is also
# left running on exit, since it is a service the rest of your tooling (and the
# API test suite) talks to rather than part of this session.

set -euo pipefail

# Job control puts each background child in its own process group, which is what
# lets the cleanup below take down npx and the node process it spawns (or
# uvicorn and its reloader child) together rather than orphaning the one doing
# the actual work.
set -m

CONTAINER=${CONTAINER:-gym-db}
VOLUME=${VOLUME:-gym_pgdata}
IMAGE=${IMAGE:-postgres:16-alpine}
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
POSTGRES_DB=${POSTGRES_DB:-gymdb}
# 5433 rather than 5432 so this sits beside Financial Tracker's container.
HOST_PORT=${HOST_PORT:-5433}
API_PORT=${API_PORT:-8000}
WEB_PORT=${WEB_PORT:-8443}
PYTHON=${PYTHON:-python3}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

start_db=true
while [ $# -gt 0 ]; do
  case "$1" in
    --no-db) start_db=false ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is not on PATH. Install Node.js first." >&2
  exit 1
fi

# ── Postgres ─────────────────────────────────────────────────────────────────

if [ "$start_db" = true ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not on PATH. Start Postgres yourself and rerun with --no-db." >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "The Docker daemon is not responding. Is Docker Desktop running?" >&2
    exit 1
  fi

  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "==> Postgres container '$CONTAINER' is already running"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "==> Starting the existing '$CONTAINER' container"
    docker start "$CONTAINER" >/dev/null
  else
    echo "==> Creating '$CONTAINER' from $IMAGE on port $HOST_PORT"
    docker run --name "$CONTAINER" \
      -e POSTGRES_USER="$POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      -e POSTGRES_DB="$POSTGRES_DB" \
      -p "$HOST_PORT:5432" \
      -v "$VOLUME:/var/lib/postgresql/data" \
      -d "$IMAGE" >/dev/null
  fi

  # On a first run the image serves over the unix socket only until its own
  # initialisation has finished, so probing over TCP is what tells us it is
  # really ready for the migrate step below.
  echo "==> Waiting for Postgres to accept connections"
  for attempt in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      break
    fi
    if [ "$attempt" -eq 60 ]; then
      echo "Postgres did not become ready in 60s. Container logs:" >&2
      docker logs "$CONTAINER" >&2
      exit 1
    fi
    sleep 1
  done
fi

# ── Dependencies and env files ───────────────────────────────────────────────

if [ ! -x "$ROOT/api/.venv/bin/python" ]; then
  echo "==> Creating api/.venv and installing API dependencies"
  "$PYTHON" -m venv "$ROOT/api/.venv"
  "$ROOT/api/.venv/bin/pip" install --quiet -r "$ROOT/api/requirements.txt" -r "$ROOT/api/requirements-dev.txt"
fi

[ -d "$ROOT/app/node_modules" ] || (echo "==> Installing app dependencies" && cd "$ROOT/app" && npm install)

for dir in api app; do
  if [ ! -f "$ROOT/$dir/.env" ] && [ -f "$ROOT/$dir/.env.example" ]; then
    echo "==> Creating $dir/.env from .env.example"
    cp "$ROOT/$dir/.env.example" "$ROOT/$dir/.env"
  fi
done

# init.sql is idempotent, so this is safe on every start; it also picks up any
# new migrations/NNN_*.sql. migrate.py reads DATABASE_URL from the environment
# only, hence exporting api/.env first.
echo "==> Applying supabase/init.sql and migrations"
(cd "$ROOT/api" && set -a && . ./.env && set +a && .venv/bin/python -m scripts.migrate)

# ── Dev servers ──────────────────────────────────────────────────────────────

pids=()

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "==> Stopping dev servers"
  for pid in ${pids[@]+"${pids[@]}"}; do
    # Negative PID targets the whole process group, so the child doing the
    # real work goes down with it instead of holding the port open.
    kill -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  if [ "$start_db" = true ]; then
    echo "The '$CONTAINER' container is still running. Stop it with: docker stop $CONTAINER"
  fi
}
# A signal exits straight away (running cleanup through the EXIT trap) rather
# than returning into the poll loop below, which would then report the servers
# it just stopped as a crash.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

start() {
  label=$1
  directory=$2
  shift 2
  (cd "$directory" && "$@" 2>&1 | awk -v l="$label" '{ printf "[%s] %s\n", l, $0; fflush() }') &
  pids+=($!)
}

echo "==> Starting the API on http://localhost:$API_PORT"
start api "$ROOT/api" .venv/bin/uvicorn app.main:app --reload --port "$API_PORT"

echo "==> Starting the app on http://localhost:$WEB_PORT"
start web "$ROOT/app" npx expo start --web --port "$WEB_PORT"

echo
echo "Both servers are starting. Press Ctrl-C to stop them."
echo

# `wait -n` would be the natural way to notice a crash, but it needs bash 4.3
# and macOS still ships 3.2, so this polls instead. Either server going down
# takes the other with it rather than leaving a half-running stack behind.
while :; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A dev server exited. Shutting the other one down." >&2
      exit 1
    fi
  done
  sleep 1
done
