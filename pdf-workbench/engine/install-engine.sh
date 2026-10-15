#!/bin/sh
# Administrator-only own-package engine installation. No kernel/env/app reload.
set -eu
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
engine_dir=$(cd "$(dirname "$0")" && pwd)
PROJECT=oshal-pdf-workbench-engine
: "${OSHAL_NETWORK:?Set the existing installation private network explicitly}"
docker network inspect "$OSHAL_NETWORK" >/dev/null
docker build -t oshal-pdf-workbench-engine:local -f "$engine_dir/container/Dockerfile" "$engine_dir"
image_id=$(docker image inspect oshal-pdf-workbench-engine:local --format '{{.Id}}')
OSHAL_NETWORK="$OSHAL_NETWORK" docker compose -p "$PROJECT" -f "$engine_dir/container/compose.yaml" up -d --no-build
actual_project=$(docker inspect oshal-pdf-workbench-engine --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$actual_project" = "$PROJECT" ] || { printf '%s\n' 'Unexpected compose project' >&2; exit 1; }
actual=$(docker exec oshal-pdf-workbench-engine python server.py --identity)
expected=$(cat "$engine_dir/../routes/engine-identity.json")
[ "$actual" = "$expected" ] || { printf '%s\n' 'Engine identity mismatch' >&2; exit 1; }
printf '%s\n' "$image_id" 'Own engine source identity verified. Root must coordinate private mapping, source admission and actual installed Test Lab acceptance.'
