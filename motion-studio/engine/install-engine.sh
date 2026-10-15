#!/bin/sh
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Build/start only Motion's own engine project and prove exact installed identity plus rendered pixels before reporting engine readiness.
# Administrator runs this; it never changes kernel configuration or restarts the kernel.
set -eu
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
PROJECT=oshal-motion-studio-engine
IMAGE=oshal-motion-studio-engine:local
CONTAINER=oshal-motion-studio-engine
ENGINE_DIR=$(cd "$(dirname "$0")" && pwd)
say() { printf '[motion engine] %s\n' "$*"; }
die() { printf '[motion engine] ERROR: %s\n' "$*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || die 'Docker CLI required on the administrator host'
docker info >/dev/null 2>&1 || die 'Docker daemon unavailable'
NETWORK=${OSHAL_NETWORK:-}
[ -n "$NETWORK" ] || die 'Set OSHAL_NETWORK to the installation network; no implicit network selection'
docker network inspect "$NETWORK" >/dev/null 2>&1 || die 'Installation network does not exist'
[ -f "$ENGINE_DIR/../routes/engine-identity.json" ] || die 'Installed route identity is missing'
say 'Building the locked compositor and bridge from this source package'
docker build -t "$IMAGE" -f "$ENGINE_DIR/container/Dockerfile" "$ENGINE_DIR"
OSHAL_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$ENGINE_DIR/container/compose.yaml" up -d --no-build --force-recreate
got=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$got" = "$PROJECT" ] || die "Wrong compose project '$got'; expected '$PROJECT'"
i=0
until docker exec "$CONTAINER" node -e "require('node:net').connect(7414,'127.0.0.1').on('connect',function(){this.destroy()}).on('error',()=>process.exit(1))" >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -lt 30 ] || die 'Motion bridge did not become ready'; sleep 1
done
say 'Checking the installed source identity, actual animated pixels, masked sources and text'
docker exec -i "$CONTAINER" node /opt/motion-engine/container/self-test.mjs --expected-stdin < "$ENGINE_DIR/../routes/engine-identity.json" || die 'Source or rendering self-test failed'
say 'Engine verified. Application installation and acceptance are separate.'
say 'Administrator must pin Motion in OSHAL_PACKAGE_ENGINES and perform the normal kernel configuration reload.'
docker inspect "$CONTAINER" --format 'Motion engine private addresses: {{range .NetworkSettings.Networks}}{{.IPAddress}}:7414 {{end}}'
