#!/bin/sh
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- build and start
#   |                                           | the aero-lab engine container from upstream
#   |                                           | sources, then prove it with the in-container
#   |                                           | self-test. POSIX sh: runs inside the oshal
#   |                                           | api container (busybox) or on a Docker host.
#
# Usage -- from the host of any box running the oshal stack (the package is
# deployed inside the api container, which has the docker CLI):
#   docker exec <api-container> sh /app/workspace-shared/deployed-apps/aero-lab/engine/install-engine.sh
# or from a checkout of this package on a machine with docker:
#   sh aero-lab/engine/install-engine.sh
#
# Builds oshal-aero-lab-engine:local LOCALLY from the official python:3.11-slim
# image plus the exact PyPI pins in requirements.txt (nothing is downloaded into
# the package, nothing is published), recreates the container on the stack
# network, then runs the real engine once. Idempotent: re-run it whenever Aero
# Lab reports the engine container is out of date (after an aero-lab update).
#
# Env overrides: OSHAL_NETWORK (stack network), AERO_ENGINE_MEM_LIMIT (default 2g).
set -eu

# Git Bash on Windows rewrites /abs/paths in arguments; docker exec targets are
# container paths. Harmless everywhere else.
export MSYS_NO_PATHCONV=1

# The oshal api container exports COMPOSE_PROJECT_NAME/COMPOSE_FILE for the CORE
# stack, and COMPOSE_PROJECT_NAME outranks the compose file's `name:`. Inherited,
# it put this container INTO the core project, where the core deploy's
# --remove-orphans sweeps it. Drop them; -p below pins our own project.
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
PROJECT=oshal-aero-lab-engine

# `pwd -W` gives a Windows path under Git Bash (docker.exe needs one); busybox and
# bash reject -W, so they fall through to plain pwd.
ENGINE_DIR=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
IMAGE=oshal-aero-lab-engine:local
CONTAINER=oshal-aero-lab-engine
BRIDGE=/opt/aero-lab/engine/container/aero_engine_bridge.py

say() { printf '[aero-lab engine] %s\n' "$*"; }
die() { printf '[aero-lab engine] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 \
  || die "docker CLI not found - run this inside the oshal api container or on the Docker host"
docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"
[ -f "$ENGINE_DIR/container/Dockerfile" ] || die "no container/Dockerfile under $ENGINE_DIR"

# Print one network name per line for a container (empty when it is not one).
networks_of() {
  docker inspect "$1" --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' 2>/dev/null || true
}

# The stack network: OSHAL_NETWORK, else this container's own (run inside the
# api), else the api service's; prefer the one named *_oshal.
detect_network() {
  if [ -n "${OSHAL_NETWORK:-}" ]; then printf '%s\n' "$OSHAL_NETWORK"; return; fi
  nets=$(networks_of "$(hostname)")
  if [ -z "$nets" ]; then
    api=$(docker ps --filter label=com.docker.compose.service=oshal-api --format '{{.Names}}' | head -n 1)
    if [ -n "$api" ]; then nets=$(networks_of "$api"); fi
  fi
  picked=$(printf '%s\n' "$nets" | grep -E '(^|_)oshal$' | head -n 1)
  if [ -z "$picked" ]; then
    picked=$(printf '%s\n' "$nets" | grep -v -E '^(bridge|host|none)?$' | head -n 1)
  fi
  printf '%s\n' "$picked"
}

NETWORK=$(detect_network)
[ -n "$NETWORK" ] || die "could not find the oshal stack network - set OSHAL_NETWORK"
docker network inspect "$NETWORK" >/dev/null 2>&1 || die "network $NETWORK does not exist"

say "building $IMAGE from $ENGINE_DIR"
say "(official python:3.11-slim + the requirements.txt pins; the first build downloads ~600 MB)"
docker build -t "$IMAGE" -f "$ENGINE_DIR/container/Dockerfile" "$ENGINE_DIR"

say "starting $CONTAINER on network $NETWORK (compose project $PROJECT)"
OSHAL_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$ENGINE_DIR/container/compose.yaml" \
  up -d --no-build --force-recreate

got=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$got" = "$PROJECT" ] || die "$CONTAINER landed in compose project '$got', not '$PROJECT' - a core deploy would sweep it"

i=0
until docker exec "$CONTAINER" python -c \
  "import socket; socket.create_connection(('127.0.0.1', 7411), 2).close()" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    docker logs --tail 40 "$CONTAINER" >&2 || true
    die "the engine bridge did not start listening"
  fi
  sleep 1
done

say "self-test: the real engine flies the R7 default design (up to a few minutes)"
if ! docker exec "$CONTAINER" python "$BRIDGE" --selftest; then
  docker logs --tail 60 "$CONTAINER" >&2 || true
  die "self-test failed - the engine container is running but not answering correctly"
fi
say "installed. Aero Lab reaches the engine at aero-lab-engine:7411 - reload the Aero Lab page."
