#!/usr/bin/env bash
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.4: the play-way check (tests/phone-control-play-way-live-proof.mjs) on a throwaway kernel, so the kernel's own reading of the play tool's devicePath is known before the package is delivered anywhere. It boots a throwaway PostgreSQL 16 container and a throwaway oshald on a random loopback port (never 38788, 38789, 38798 or 38799) with this package as its only store application and one local model for Jarvis, runs the check's person, check and remove, and stops everything. No installation, no slot and no device is touched; the local model answers one or two turns. MUTATE changes the copied manifest only, for the control run: a declaration the kernel refuses must end the check with 1. Modeled on tests/live/isolation-proof.sh.
# Usage: OUT=<dir> OSHALD=<bin> OSHAL_BRIDGE_RUNNER=<runner.js> OSHAL_PACKAGE_NODE_MODULES=<dir> OSHAL_PLATFORM_DIR=<dir> OSHAL_VLLM_URL=http://127.0.0.1:<port>/v1 [OSHAL_FLEET_MODEL=bot-fast] [REF=HEAD|WORKTREE] [MUTATE=<sed expression>] bash tests/live/play-way-disposable.sh
# OSHALD is a kernel built at or after commit 2816eff1, and OSHAL_PLATFORM_DIR that commit's platform folder. The exit code is the check's: 0 offered, 2 Jarvis did not call device.path, 1 otherwise.
set -euo pipefail
pkg="$(cd "$(dirname "$0")/../.." && pwd)"
store="$(cd "$pkg/.." && pwd)"
out="${OUT:?set OUT}"
mkdir -p "$out"
for var in OSHALD OSHAL_BRIDGE_RUNNER OSHAL_PACKAGE_NODE_MODULES OSHAL_PLATFORM_DIR; do
  [ -e "${!var:?set $var}" ] || { echo "$var does not exist: ${!var}" >&2; exit 2; }
done
model="${OSHAL_VLLM_URL:?set OSHAL_VLLM_URL to a local model on this computer}"
case "$model" in http://127.0.0.1:*) ;; *) echo "OSHAL_VLLM_URL is a local model on this computer, http://127.0.0.1:<port>/v1" >&2; exit 2 ;; esac
work="$(mktemp -d)"
chmod 700 "$work"
mkdir -p "$work/apps"
suffix="$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
db="oshal-kernel-pg-playway-$suffix"
port=$(python3 -c 'import socket
while True:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    if p not in (38788, 38789, 38798, 38799):
        print(p)
        break')
token="play-way-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
kernel=""
cleanup() {
  [ -n "$kernel" ] && kill "$kernel" 2>/dev/null && wait "$kernel" 2>/dev/null || true
  docker stop -t 2 "$db" >/dev/null 2>&1 || true
  rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT
docker run -d --rm --name "$db" -e POSTGRES_USER=kernel -e POSTGRES_PASSWORD=kernel -e POSTGRES_DB=kernel -p 127.0.0.1::5432 postgres:16 >/dev/null
for _ in $(seq 1 60); do
  docker exec "$db" pg_isready -q -U kernel -d kernel -h 127.0.0.1 && break
  sleep 1
done
dbport=$(docker port "$db" 5432/tcp | head -1 | sed 's/.*://')
if [ "${REF:-}" = "WORKTREE" ]; then
  mkdir -p "$work/apps/phone-control"
  tar -C "$pkg" --exclude='__pycache__' -cf - . | tar -x -C "$work/apps/phone-control"
else
  git -C "$store" archive "${REF:-HEAD}" phone-control | tar -x -C "$work/apps"
fi
[ -z "${MUTATE:-}" ] || sed -i "$MUTATE" "$work/apps/phone-control/oshal-app.yaml"
for folder in package-data application-files home kernel ws private; do
  mkdir -m 700 "$work/$folder"
done
env -i PATH=/usr/bin:/bin HOME="$work/home" OSHAL_BIND="127.0.0.1:$port" \
  OSHAL_POSTGRES="postgres://kernel:kernel@127.0.0.1:$dbport/kernel" \
  OSHAL_ADMIN_TOKEN="$token" OSHAL_ADMIN_SUBJECT=play-way-root \
  OSHAL_VAULT_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  OSHAL_DEPLOYMENT=demo OSHAL_MOCK_IDENTITY=1 \
  OSHAL_APPLICATIONS_DIR="$work/apps" OSHAL_PACKAGE_DATA_DIR="$work/package-data" \
  OSHAL_APPLICATION_FILES_DIR="$work/application-files" OSHAL_JOURNAL_PATH="$work/kernel/mesh.jsonl" \
  OSHAL_LEDGER_SPILL_PATH="$work/kernel/spill.jsonl" OSHAL_WORKSPACE_ROOT="$work/ws" \
  OSHAL_PACKAGE_RUNTIME=/usr/bin/node OSHAL_BRIDGE_RUNNER="$OSHAL_BRIDGE_RUNNER" \
  OSHAL_PACKAGE_NODE_MODULES="$OSHAL_PACKAGE_NODE_MODULES" OSHAL_PLATFORM_DIR="$OSHAL_PLATFORM_DIR" \
  OSHAL_FLEET_PROVIDER=vllm OSHAL_FLEET_MODEL="${OSHAL_FLEET_MODEL:-bot-fast}" OSHAL_VLLM_URL="$model" \
  OSHAL_INFERENCE_LOCAL_ENDPOINTS="[{\"url_prefix\": \"$model\", \"addresses\": [\"127.0.0.1\"]}]" \
  "$OSHALD" serve > "$out/kernel.log" 2>&1 &
kernel=$!
base="http://127.0.0.1:$port"
for _ in $(seq 1 120); do
  curl -sf -m 2 "$base/readyz" >/dev/null && break
  kill -0 "$kernel" || { tail -20 "$out/kernel.log" >&2; exit 1; }
  sleep 1
done
(umask 077; printf 'OSHAL_ADMIN_TOKEN=%s\n' "$token" > "$work/private/kernel.env")
proof="$pkg/tests/phone-control-play-way-live-proof.mjs"
node "$proof" person "$base" "$work/private/kernel.env" "$work/private/person.json"
verdict=0
node "$proof" check "$base" "$work/private/person.json" "$out" || verdict=$?
node "$proof" remove "$base" "$work/private/kernel.env" "$work/private/person.json"
exit "$verdict"
