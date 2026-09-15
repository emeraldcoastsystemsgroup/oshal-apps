#!/bin/sh
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- build and start the
#   |                                           | embodied physics engine container (MuJoCo + Gymnasium
#   |                                           | + Stable-Baselines3) from upstream sources, then prove
#   |                                           | it with the in-container self-test (rest, climb, hover,
#   |                                           | ring sweep). POSIX sh: runs inside the oshal api
#   |                                           | container (busybox) or on a Docker host. The CAD
#   |                                           | Studio installer's shape, including the compose-project
#   |                                           | pin that keeps a core deploy from sweeping it.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | B20: say whether the node rail is on (the swarm service secret in this shell), pass it to the container, and wait for the api to acknowledge the first heartbeat.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | The node needs an OWNER (EMBODIED_NODE_OWNER_SUB, the sub of the person it belongs to): without one an api whose app gate requires an identity refuses its heartbeats; say so before building.
# 4 | maintainer@emeraldcoastsystemsgroup.com   | B6: --with-px4 pulls the official PX4 SITL image, starts it in the same compose project (profile px4) and points the engine at it; the PX4 node then joins the rail as a drone.
# 5 | maintainer@emeraldcoastsystemsgroup.com   | B6: the vehicle is recreated with the engine (force-recreate covers the px4 profile) so it learns this node as its MAVLink partner; the message says so.
#
# Usage -- from the host of any box running the oshal stack (the package is deployed inside the
# api container, which has the docker CLI):
#   docker exec <api-container> sh /app/workspace-shared/deployed-apps/embodied/engine/install-engine.sh
# or from a checkout of this package on a machine with docker:
#   sh embodied/engine/install-engine.sh
#
# Idempotent: re-run it whenever the Embodied tile reports the engine container is out of date.
# Env overrides: OSHAL_NETWORK (stack network), EMBODIED_ENGINE_MEM_LIMIT (default 2g).
set -eu
export MSYS_NO_PATHCONV=1
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
PROJECT=oshal-embodied-engine
WITH_PX4=0
for arg in "$@"; do case "$arg" in --with-px4) WITH_PX4=1 ;; esac; done
ENGINE_DIR=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
IMAGE=oshal-embodied-engine:local
CONTAINER=oshal-embodied-engine
BRIDGE=/opt/embodied/engine/container/embodied_engine_bridge.py
say() { printf '[embodied engine] %s\n' "$*"; }
die() { printf '[embodied engine] ERROR: %s\n' "$*" >&2; exit 1; }
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

if [ -n "${SWARM_SERVICE_SECRET:-}" ]; then
  say "node rail: on - the plant will heartbeat into ${EMBODIED_API_URL:-http://oshal-api:5000}/api/embodied/nodes/heartbeat as ${EMBODIED_NODE_ID:-embodied-plant} and take commands at embodied-engine:7414"
  if [ -n "${EMBODIED_NODE_OWNER_SUB:-}" ]; then
    say "node rail: owned by ${EMBODIED_NODE_OWNER_SUB} (its heartbeats carry that identity; only that person's worlds may fly it)"
  else
    say "node rail: NO OWNER - set EMBODIED_NODE_OWNER_SUB to the sub of the person this node belongs to (the one who opens the tile); an api whose app gate requires an identity will refuse an unowned node's heartbeats"
  fi
else
  say "node rail: OFF - SWARM_SERVICE_SECRET is not set in this shell (run this inside the api container to inherit it); the bridge alone will serve"
fi
if [ "$WITH_PX4" = 1 ]; then
  say "PX4 node: on - pulling px4io/px4-sitl (the official Dronecode SITL image, SIH physics) and starting it as embodied-px4 beside the engine (recreated together: the vehicle learns this node as its MAVLink partner on first contact)"
  export EMBODIED_PX4_ADDR="${EMBODIED_PX4_ADDR:-embodied-px4:14580}"
  COMPOSE_PROFILES=px4
  export COMPOSE_PROFILES
else
  say "PX4 node: off (add --with-px4 to fly a PX4 SIH vehicle as a node on the rail)"
fi
say "building $IMAGE from $ENGINE_DIR"
say "(official python:3.11-slim + the requirements pins; the first build downloads MuJoCo, Gymnasium and CPU-only PyTorch)"
docker build -t "$IMAGE" -f "$ENGINE_DIR/container/Dockerfile" "$ENGINE_DIR"

say "starting $CONTAINER on network $NETWORK (compose project $PROJECT)"
OSHAL_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$ENGINE_DIR/container/compose.yaml" \
  up -d --no-build --force-recreate

got=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$got" = "$PROJECT" ] || die "$CONTAINER landed in compose project '$got', not '$PROJECT' - a core deploy would sweep it"

i=0
until docker exec "$CONTAINER" python -c \
  "import socket; socket.create_connection(('127.0.0.1', 7413), 2).close()" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    docker logs --tail 40 "$CONTAINER" >&2 || true
    die "the engine bridge did not start listening"
  fi
  sleep 1
done

say "self-test: the plant rests on its pad, climbs to the mission altitude, holds it and sweeps the ring"
if ! docker exec "$CONTAINER" python "$BRIDGE" --selftest; then
  docker logs --tail 60 "$CONTAINER" >&2 || true
  die "self-test failed - the engine container is running but not answering correctly"
fi
if [ -n "${SWARM_SERVICE_SECRET:-}" ]; then
  i=0
  until docker logs "$CONTAINER" 2>&1 | grep -q "heartbeat acknowledged"; do
    i=$((i + 1))
    if [ "$i" -ge 20 ]; then
      say "WARNING: the api did not acknowledge a heartbeat within 20 s - check 'docker logs $CONTAINER' (is the embodied package mounted with its /api/embodied/nodes route?)"
      break
    fi
    sleep 1
  done
  [ "$i" -lt 20 ] && say "node rail: the api acknowledged the plant's heartbeat - it is a node on the swarm"
fi
say "installed. The Embodied tile reaches the engine at embodied-engine:7413 - choose 'physics (MuJoCo)' or the rail node on Reset world."
