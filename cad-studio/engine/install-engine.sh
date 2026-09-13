#!/bin/sh
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- build and start the
#   |                                           | CAD Studio engine container (CadQuery / OCCT) from
#   |                                           | upstream sources, then prove it with the in-container
#   |                                           | self-test. POSIX sh: runs inside the oshal api
#   |                                           | container (busybox) or on a Docker host. The
#   |                                           | aero-lab installer's shape, including the compose-
#   |                                           | project pin that keeps a core deploy from sweeping it.
#
# Usage -- from the host of any box running the oshal stack (the package is deployed inside the
# api container, which has the docker CLI):
#   docker exec <api-container> sh /app/workspace-shared/deployed-apps/cad-studio/engine/install-engine.sh
# or from a checkout of this package on a machine with docker:
#   sh cad-studio/engine/install-engine.sh
#
# Idempotent: re-run it whenever CAD Studio reports the engine container is out of date.
# Env overrides: OSHAL_NETWORK (stack network), CAD_ENGINE_MEM_LIMIT (default 3g).
set -eu
export MSYS_NO_PATHCONV=1
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
PROJECT=oshal-cad-studio-engine
ENGINE_DIR=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
IMAGE=oshal-cad-studio-engine:local
CONTAINER=oshal-cad-studio-engine
BRIDGE=/opt/cad-studio/engine/container/cad_engine_bridge.py
say() { printf '[cad-studio engine] %s\n' "$*"; }
die() { printf '[cad-studio engine] ERROR: %s\n' "$*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 \
  || die "docker CLI not found - run this inside the oshal api container or on the Docker host"
docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"
[ -f "$ENGINE_DIR/container/Dockerfile" ] || die "no container/Dockerfile under $ENGINE_DIR"
networks_of() {
  docker inspect "$1" --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' 2>/dev/null || true
}
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
say "(official python:3.11-slim + the requirements pins; the first build downloads ~250 MB of CadQuery/OCCT wheels)"
docker build -t "$IMAGE" -f "$ENGINE_DIR/container/Dockerfile" "$ENGINE_DIR"

say "starting $CONTAINER on network $NETWORK (compose project $PROJECT)"
OSHAL_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$ENGINE_DIR/container/compose.yaml" \
  up -d --no-build --force-recreate

got=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$got" = "$PROJECT" ] || die "$CONTAINER landed in compose project '$got', not '$PROJECT' - a core deploy would sweep it"

i=0
until docker exec "$CONTAINER" python -c \
  "import socket; socket.create_connection(('127.0.0.1', 7412), 2).close()" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    docker logs --tail 40 "$CONTAINER" >&2 || true
    die "the engine bridge did not start listening"
  fi
  sleep 1
done

say "self-test: the real kernel rebuilds a bracket with a hole and a fillet"
if ! docker exec "$CONTAINER" python "$BRIDGE" --selftest; then
  docker logs --tail 60 "$CONTAINER" >&2 || true
  die "self-test failed - the engine container is running but not answering correctly"
fi
say "installed. CAD Studio reaches the engine at cad-studio-engine:7412 - reload the CAD Studio page."
