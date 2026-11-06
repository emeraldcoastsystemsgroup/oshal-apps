#!/usr/bin/env bash
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T5, the whole chain on a throwaway installation, nobody's data involved: the given oshald with a disposable Postgres and its own folders, phone-control from this branch (git archive), the real package sandbox and runner; the published OSHAL Node AppImage on a plain Ubuntu desktop in a container (real sign-in, the real Allow dialog, host network); then a real browser on the page presses Set up this computer, Pair with a wrong address, opens Devices and the computer's picture. Browser -> kernel -> command queue -> the Node app -> bash -> the bridge -> adb. Everything it starts is stopped and removed on the way out; only OUT stays.
# Usage: OUT=<dir> OSHALD=<bin> OSHAL_BRIDGE_RUNNER=<runner.js> OSHAL_PACKAGE_NODE_MODULES=<dir> OSHAL_PLATFORM_DIR=<dir> \
#        NODE_APPIMAGE=<OSHAL-Node-*.AppImage> NODE_APP_SOURCE=<desktop/oshal-node with dist/ and node_modules/> \
#        NODE_APP_SCRIPTS=<desktop/oshal-node/scripts> [REF=HEAD] bash tests/live/chain-proof.sh
set -euo pipefail
pkg="$(cd "$(dirname "$0")/../.." && pwd)"
store="$(cd "$pkg/.." && pwd)"
out="${OUT:?set OUT}"; mkdir -p "$out"
for var in OSHALD OSHAL_BRIDGE_RUNNER OSHAL_PACKAGE_NODE_MODULES OSHAL_PLATFORM_DIR NODE_APPIMAGE NODE_APP_SOURCE NODE_APP_SCRIPTS; do
  [ -e "${!var:?set $var}" ] || { echo "$var does not exist: ${!var}" >&2; exit 2; }
done
if docker ps --format '{{.Names}}' | grep -qE 'oshal-node-desktop-proof|phone-chain-desktop'; then echo "another computer proof is running (display :98); run one at a time" >&2; exit 2; fi
work="$(mktemp -d)"; chmod 700 "$work"; mkdir -p "$work/out" "$work/apps"
suffix="$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
db="oshal-kernel-3a-pg-phonechain-$suffix"; desk="oshal-phone-chain-desktop-$suffix"
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
token="phone-chain-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
kernel=""
cleanup() {
  touch "$work/out/done" 2>/dev/null || true
  sleep 2
  docker logs "$desk" > "$out/computer.log" 2>&1 || true
  docker stop -t 3 "$desk" >/dev/null 2>&1 || true
  [ -n "$kernel" ] && kill "$kernel" 2>/dev/null && wait "$kernel" 2>/dev/null || true
  docker stop -t 2 "$db" >/dev/null 2>&1 || true
  rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT
docker run -d --rm --name "$db" -e POSTGRES_USER=kernel -e POSTGRES_PASSWORD=kernel -e POSTGRES_DB=kernel -p 127.0.0.1::5432 postgres:16 >/dev/null
for _ in $(seq 1 60); do docker exec "$db" pg_isready -q -U kernel -d kernel -h 127.0.0.1 && break; sleep 1; done
dbport=$(docker port "$db" 5432/tcp | head -1 | sed 's/.*://')
git -C "$store" archive "${REF:-HEAD}" phone-control | tar -x -C "$work/apps"
for folder in package-data application-files home kernel ws; do mkdir -m 700 "$work/$folder"; done
env -i PATH=/usr/bin:/bin HOME="$work/home" OSHAL_BIND="127.0.0.1:$port" OSHAL_POSTGRES="postgres://kernel:kernel@127.0.0.1:$dbport/kernel" \
  OSHAL_ADMIN_TOKEN="$token" OSHAL_ADMIN_SUBJECT=phone-chain-proof OSHAL_VAULT_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  OSHAL_DEPLOYMENT=home OSHAL_APPLICATIONS_DIR="$work/apps" OSHAL_PACKAGE_DATA_DIR="$work/package-data" \
  OSHAL_APPLICATION_FILES_DIR="$work/application-files" OSHAL_JOURNAL_PATH="$work/kernel/mesh.jsonl" \
  OSHAL_LEDGER_SPILL_PATH="$work/kernel/spill.jsonl" OSHAL_WORKSPACE_ROOT="$work/ws" OSHAL_PACKAGE_RUNTIME=/usr/bin/node \
  OSHAL_BRIDGE_RUNNER="$OSHAL_BRIDGE_RUNNER" OSHAL_PACKAGE_NODE_MODULES="$OSHAL_PACKAGE_NODE_MODULES" OSHAL_PLATFORM_DIR="$OSHAL_PLATFORM_DIR" \
  "$OSHALD" serve > "$out/kernel.log" 2>&1 &
kernel=$!
base="http://127.0.0.1:$port"
for _ in $(seq 1 120); do curl -sf -m 2 "$base/readyz" >/dev/null && break; kill -0 "$kernel" || { tail -5 "$out/kernel.log"; exit 1; }; sleep 1; done
curl -sf -H "authorization: Bearer $token" "$base/packages" > "$out/packages.json"
python3 -c 'import json,sys; p=[x for x in json.load(open(sys.argv[1]))["packages"] if x["name"]=="phone-control"]; sys.exit(0 if p and p[0]["state"]=="active" and p[0]["version"]=="1.1.0" else 1)' "$out/packages.json" \
  || { echo "phone-control 1.1.0 is not active"; exit 1; }
python3 "$pkg/tests/live/chain-grant.py" "$base" "$token" > "$out/grant.json"
docker build -q -t oshal-phone-chain-desktop -f "$pkg/tests/live/chain-desktop.Dockerfile" "$pkg/tests/live" > "$out/image.txt"
docker run -d --rm --name "$desk" --network host --shm-size=512m -e KERNEL="$base" -e TOKEN="$token" -e APPIMAGE_EXTRACT_AND_RUN=1 \
  -v "$NODE_APP_SOURCE/dist:/app/dist:ro" -v "$NODE_APP_SCRIPTS:/app/scripts:ro" -v "$(readlink -f "$NODE_APP_SOURCE/node_modules"):/app/node_modules:ro" \
  -v "$NODE_APPIMAGE:/release/oshal-node:ro" -v "$pkg/tests/live/chain-node.cjs:/chain/chain-node.cjs:ro" -v "$work/out:/out" \
  -w /app oshal-phone-chain-desktop node /chain/chain-node.cjs >/dev/null
for _ in $(seq 1 180); do
  [ -f "$work/out/computer.json" ] && break
  [ -f "$work/out/computer-failed.txt" ] && { cat "$work/out/computer-failed.txt"; exit 1; }
  docker inspect "$desk" >/dev/null 2>&1 || { echo "the computer container stopped"; exit 1; }
  sleep 1
done
[ -f "$work/out/computer.json" ] || { echo "the computer never connected"; exit 1; }
cp "$work/out/computer.json" "$out/computer.json"
node "$pkg/tests/live/chain-browser.cjs" "$base" "$token" "$out" "$work/out/computer.json"
