#!/bin/sh
# Administrator-only own-package engine installation. No kernel/env/app reload.
set -eu
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
engine_dir=$(cd "$(dirname "$0")" && pwd)
PROJECT=oshal-publishing-studio-engine
: "${OSHAL_NETWORK:?Set the existing installation private network explicitly}"
[ "$(uname -m)" = aarch64 ] || { printf '%s\n' 'Pinned publishing renderer requires aarch64.' >&2; exit 1; }
docker network inspect "$OSHAL_NETWORK" >/dev/null
docker build -t oshal-publishing-studio-engine:local -f "$engine_dir/container/Dockerfile" "$engine_dir"
image_id=$(docker image inspect oshal-publishing-studio-engine:local --format '{{.Id}}')
expected=$(cat "$engine_dir/../routes/engine-identity.json")
# Verify the built source before replacing the own engine. No host network/paths.
built=$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 10001:10001 --entrypoint /opt/publishing-runtime/python/bin/python oshal-publishing-studio-engine:local server.py --identity)
[ "$built" = "$expected" ] || { printf '%s\n' 'Built engine identity mismatch' >&2; exit 1; }
OSHAL_NETWORK="$OSHAL_NETWORK" docker compose -p "$PROJECT" -f "$engine_dir/container/compose.yaml" up -d --no-build
actual_project=$(docker inspect oshal-publishing-studio-engine --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$actual_project" = "$PROJECT" ] || { printf '%s\n' 'Unexpected compose project' >&2; exit 1; }
actual=$(docker exec oshal-publishing-studio-engine /opt/publishing-runtime/python/bin/python server.py --identity)
[ "$actual" = "$expected" ] || { printf '%s\n' 'Running engine identity mismatch' >&2; exit 1; }
printf '%s\n' "$image_id" 'Own private engine source verified. Root must coordinate the private loopback forwarder, kernel mapping, source admission and actual installed acceptance.'
