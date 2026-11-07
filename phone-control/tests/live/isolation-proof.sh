#!/usr/bin/env bash
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.2.0 disposable-kernel isolation proof: boots a throwaway Postgres 16 container and a throwaway oshald on a random loopback port (never 38788 or 38789) with mock personas enabled, installs phone-control from this branch, and runs isolation-proof.cjs to prove two-admin personal isolation and non-admin 403 refusal before tearing everything down.
# Usage: OUT=<dir> OSHALD=<bin> OSHAL_BRIDGE_RUNNER=<runner.js> OSHAL_PACKAGE_NODE_MODULES=<dir> OSHAL_PLATFORM_DIR=<dir> [REF=HEAD] bash tests/live/isolation-proof.sh
set -euo pipefail
pkg="$(cd "$(dirname "$0")/../.." && pwd)"
store="$(cd "$pkg/.." && pwd)"
out="${OUT:?set OUT}"
mkdir -p "$out"
for var in OSHALD OSHAL_BRIDGE_RUNNER OSHAL_PACKAGE_NODE_MODULES OSHAL_PLATFORM_DIR; do
  [ -e "${!var:?set $var}" ] || { echo "$var does not exist: ${!var}" >&2; exit 2; }
done
work="$(mktemp -d)"
chmod 700 "$work"
mkdir -p "$work/apps"
suffix="$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
db="oshal-kernel-pg-phoneiso-$suffix"
port=$(python3 -c 'import socket
while True:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    if p not in (38788, 38789):
        print(p)
        break')
token="phone-iso-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
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
for folder in package-data application-files home kernel ws; do
  mkdir -m 700 "$work/$folder"
done
env -i PATH=/usr/bin:/bin HOME="$work/home" OSHAL_BIND="127.0.0.1:$port" \
  OSHAL_POSTGRES="postgres://kernel:kernel@127.0.0.1:$dbport/kernel" \
  OSHAL_ADMIN_TOKEN="$token" OSHAL_ADMIN_SUBJECT=phone-iso-root \
  OSHAL_VAULT_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  OSHAL_DEPLOYMENT=demo OSHAL_MOCK_IDENTITY=1 \
  OSHAL_APPLICATIONS_DIR="$work/apps" OSHAL_PACKAGE_DATA_DIR="$work/package-data" \
  OSHAL_APPLICATION_FILES_DIR="$work/application-files" OSHAL_JOURNAL_PATH="$work/kernel/mesh.jsonl" \
  OSHAL_LEDGER_SPILL_PATH="$work/kernel/spill.jsonl" OSHAL_WORKSPACE_ROOT="$work/ws" \
  OSHAL_PACKAGE_RUNTIME=/usr/bin/node OSHAL_BRIDGE_RUNNER="$OSHAL_BRIDGE_RUNNER" \
  OSHAL_PACKAGE_NODE_MODULES="$OSHAL_PACKAGE_NODE_MODULES" OSHAL_PLATFORM_DIR="$OSHAL_PLATFORM_DIR" \
  "$OSHALD" serve > "$out/kernel.log" 2>&1 &
kernel=$!
base="http://127.0.0.1:$port"
for _ in $(seq 1 120); do
  curl -sf -m 2 "$base/readyz" >/dev/null && break
  kill -0 "$kernel" || { tail -20 "$out/kernel.log" >&2; exit 1; }
  sleep 1
done
node "$pkg/tests/live/isolation-proof.cjs" "$base" "$token" "$out/isolation-receipt.json"

