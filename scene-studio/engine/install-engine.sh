#!/bin/sh
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- build and start the
#   |                                           | Scene Studio engine container (Godot + godot-mcp,
#   |                                           | Blender + the Blender Lab MCP, the job sandbox)
#   |                                           | from pinned upstream sources, then prove it with
#   |                                           | the bridge's end-to-end self-test over its own TCP
#   |                                           | protocol. POSIX sh: runs inside the oshal api
#   |                                           | container (busybox) or on a Docker host. The
#   |                                           | cad-studio installer's shape, including the
#   |                                           | compose-project pin that keeps a core deploy from
#   |                                           | sweeping the engine.
#
# Usage -- from the host of any box running the oshal stack (the package is deployed inside the
# api container, which has the docker CLI):
#   docker exec <api-container> sh /app/workspace-shared/deployed-apps/scene-studio/engine/install-engine.sh
# or from a checkout of this package on a machine with docker:
#   sh scene-studio/engine/install-engine.sh
#
# Idempotent: re-run it whenever Scene Studio reports the engine container is out of date.
# Env overrides: OSHAL_NETWORK (stack network), SCENE_ENGINE_MEM_LIMIT (default 6g),
# SCENE_ENGINE_CPUS (default 6).
set -eu
export MSYS_NO_PATHCONV=1
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
PROJECT=oshal-scene-studio-engine
ENGINE_DIR=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
IMAGE=oshal-scene-studio-engine:local
CONTAINER=oshal-scene-studio-engine
BRIDGE=/opt/scene-studio/engine/container/scene_engine_bridge.py
say() { printf '[scene-studio engine] %s\n' "$*"; }
die() { printf '[scene-studio engine] ERROR: %s\n' "$*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 \
  || die "docker CLI not found - run this inside the oshal api container or on the Docker host"
docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"
[ -f "$ENGINE_DIR/container/Dockerfile" ] || die "no container/Dockerfile under $ENGINE_DIR"
arch=$(docker info --format '{{.Architecture}}' 2>/dev/null || true)
case "$arch" in
  aarch64|arm64) ;;
  *) die "the Scene Studio engine builds for linux/arm64 only (Godot and Blender are pinned to arm64 builds); this Docker host reports '$arch'" ;;
esac
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
say "(official ubuntu/node images + pinned Godot, Blender and MCP sources; the first build downloads ~600 MB)"
docker build -t "$IMAGE" -f "$ENGINE_DIR/container/Dockerfile" "$ENGINE_DIR"

say "starting $CONTAINER on network $NETWORK (compose project $PROJECT)"
OSHAL_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$ENGINE_DIR/container/compose.yaml" \
  up -d --no-build --force-recreate

got=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$got" = "$PROJECT" ] || die "$CONTAINER landed in compose project '$got', not '$PROJECT' - a core deploy would sweep it"

i=0
until docker exec "$CONTAINER" python3 -c \
  "import socket; socket.create_connection(('127.0.0.1', 7414), 2).close()" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 45 ]; then
    docker logs --tail 40 "$CONTAINER" >&2 || true
    die "the engine bridge did not start listening (a bridge whose job sandbox is not in force refuses to serve - see the log above)"
  fi
  sleep 1
done

say "self-test: godot-mcp edits, previews and runs a Godot scene; the Blender Lab MCP edits, previews and exports a model; the model goes into the Godot project; user code cannot reach the network"
if ! docker exec "$CONTAINER" python3 "$BRIDGE" --selftest; then
  docker logs --tail 60 "$CONTAINER" >&2 || true
  die "self-test failed - the engine container is running but not answering correctly"
fi
say "installed. Scene Studio reaches the engine at scene-studio-engine:7414 - reload the Scene Studio page."
