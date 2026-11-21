#!/usr/bin/env bash
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.14 (BACKLOG B12): the non-administrator check (tests/design-studio-nonadmin-live-proof.mjs) on a throwaway kernel, so what a person who is not an administrator meets is known before anything is delivered. It boots a throwaway PostgreSQL 16 container and a throwaway oshald on a random loopback port (never 38788, 38789, 38798 or 38799) with the six packages of this checkout as its only store applications (engineering-shelf, design-studio, cad-studio, circuit-lab, embodied, scan-to-print), and one throwaway container per engine named in ENGINES from the images already on this computer (never the installation's own engine containers), pinned for this kernel only. `run` runs the check's person, check and remove and stops everything; `up` leaves it running and prints where; `down` stops what `up` started. No installation, no slot, no printer and no outside account is touched. Modeled on phone-control/tests/live/play-way-disposable.sh.
# Usage: OUT=<dir> OSHALD=<bin> OSHAL_BRIDGE_RUNNER=<runner.js> OSHAL_PACKAGE_NODE_MODULES=<dir> OSHAL_PLATFORM_DIR=<dir> [OSHAL_VLLM_URL=http://127.0.0.1:<port>/v1] [OSHAL_FLEET_MODEL=bot-fast] [ENGINES="cad-studio circuit-lab embodied"] [REF=HEAD|WORKTREE] bash tests/live/nonadmin-disposable.sh run|up|down
# OSHALD is a kernel built at or after commit 2816eff1, and OSHAL_PLATFORM_DIR that commit's platform folder. Without OSHAL_VLLM_URL the kernel has no model and the check reports the design partner's step as not run. The exit code of `run` is the check's.
set -euo pipefail
pkg="$(cd "$(dirname "$0")/../.." && pwd)"
store="$(cd "$pkg/.." && pwd)"
out="${OUT:?set OUT}"
mode="${1:-run}"
state="$out/disposable.state"
PACKAGES="engineering-shelf design-studio cad-studio circuit-lab embodied scan-to-print"

engine_image() { case "$1" in cad-studio) echo "${OSHAL_CAD_ENGINE_IMAGE:-oshal-cad-studio-engine:local} 7412 3g" ;; circuit-lab) echo "${OSHAL_CIRCUIT_ENGINE_IMAGE:-oshal-circuit-lab-engine:local} 7413 1g" ;; embodied) echo "${OSHAL_EMBODIED_ENGINE_IMAGE:-oshal-embodied-engine:local} 7413 2g" ;; scan-to-print) echo "${OSHAL_SLICER_ENGINE_IMAGE:-oshal-scan-to-print-engine:local} 7414 3g" ;; *) echo "unknown engine $1" >&2; exit 2 ;; esac; }

down() {
  [ -f "$state" ] || return 0
  # shellcheck disable=SC1090
  . "$state"
  [ -n "${kernel:-}" ] && kill "$kernel" 2>/dev/null || true
  for name in ${containers:-}; do docker rm -f "$name" >/dev/null 2>&1 || true; done
  [ -n "${work:-}" ] && [ -d "$work" ] && rm -rf "$work" 2>/dev/null || true
  rm -f "$state"
}

up() {
  for var in OSHALD OSHAL_BRIDGE_RUNNER OSHAL_PACKAGE_NODE_MODULES OSHAL_PLATFORM_DIR; do
    [ -e "${!var:?set $var}" ] || { echo "$var does not exist: ${!var}" >&2; exit 2; }
  done
  model="${OSHAL_VLLM_URL:-}"
  case "$model" in ''|http://127.0.0.1:*) ;; *) echo "OSHAL_VLLM_URL is a local model on this computer, http://127.0.0.1:<port>/v1" >&2; exit 2 ;; esac
  mkdir -p "$out"
  work="$(mktemp -d)"; chmod 700 "$work"; mkdir -p "$work/apps"
  suffix="$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  db="oshal-kernel-pg-dsb12-$suffix"; containers="$db"
  (umask 077; printf 'work=%q\ncontainers=%q\nkernel=\n' "$work" "$containers" > "$state")
  port=$(python3 -c 'import socket
while True:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    if p not in (38788, 38789, 38798, 38799):
        print(p)
        break')
  token="dsb12-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  docker run -d --rm --name "$db" -e POSTGRES_USER=kernel -e POSTGRES_PASSWORD=kernel -e POSTGRES_DB=kernel -p 127.0.0.1::5432 postgres:16 >/dev/null
  for _ in $(seq 1 60); do docker exec "$db" pg_isready -q -U kernel -d kernel -h 127.0.0.1 && break; sleep 1; done
  dbport=$(docker port "$db" 5432/tcp | head -1 | sed 's/.*://')
  engines="{"; running=""
  for engine in ${ENGINES-cad-studio circuit-lab embodied}; do
    read -r image inner memory <<<"$(engine_image "$engine")"
    docker image inspect "$image" >/dev/null 2>&1 || { echo "engine image $image is not on this computer: $engine stays without an engine" >&2; continue; }
    name="oshal-dsb12-$engine-$suffix"
    docker run -d --rm --name "$name" --memory "$memory" --tmpfs /tmp:size=1g -p "127.0.0.1::$inner" "$image" >/dev/null
    containers="$containers $name"
    eport=$(docker port "$name" "$inner/tcp" | head -1 | sed 's/.*://')
    engines="$engines\"$engine\":\"127.0.0.1:$eport\","; running="$running $engine"
  done
  engines="${engines%,}}"
  (umask 077; printf 'work=%q\ncontainers=%q\nkernel=\n' "$work" "$containers" > "$state")
  for name in $PACKAGES; do
    if [ "${REF:-WORKTREE}" = "WORKTREE" ]; then
      mkdir -p "$work/apps/$name"
      tar -C "$store/$name" --exclude='__pycache__' --exclude='node_modules' -cf - . | tar -x -C "$work/apps/$name"
    else
      git -C "$store" archive "$REF" "$name" | tar -x -C "$work/apps"
    fi
  done
  for folder in package-data application-files home kernel ws private; do mkdir -m 700 "$work/$folder"; done
  model_env=()
  [ -z "$model" ] || model_env=(OSHAL_FLEET_PROVIDER=vllm "OSHAL_FLEET_MODEL=${OSHAL_FLEET_MODEL:-bot-fast}" "OSHAL_VLLM_URL=$model" "OSHAL_INFERENCE_LOCAL_ENDPOINTS=[{\"url_prefix\": \"$model\", \"addresses\": [\"127.0.0.1\"]}]")
  env -i PATH=/usr/bin:/bin HOME="$work/home" OSHAL_BIND="127.0.0.1:$port" \
    OSHAL_POSTGRES="postgres://kernel:kernel@127.0.0.1:$dbport/kernel" \
    OSHAL_ADMIN_TOKEN="$token" OSHAL_ADMIN_SUBJECT=dsb12-root \
    OSHAL_VAULT_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
    OSHAL_DEPLOYMENT=demo OSHAL_MOCK_IDENTITY=1 \
    OSHAL_APPLICATIONS_DIR="$work/apps" OSHAL_PACKAGE_DATA_DIR="$work/package-data" \
    OSHAL_APPLICATION_FILES_DIR="$work/application-files" OSHAL_JOURNAL_PATH="$work/kernel/mesh.jsonl" \
    OSHAL_LEDGER_SPILL_PATH="$work/kernel/spill.jsonl" OSHAL_WORKSPACE_ROOT="$work/ws" \
    OSHAL_PACKAGE_RUNTIME=/usr/bin/node OSHAL_BRIDGE_RUNNER="$OSHAL_BRIDGE_RUNNER" \
    OSHAL_PACKAGE_NODE_MODULES="$OSHAL_PACKAGE_NODE_MODULES" OSHAL_PLATFORM_DIR="$OSHAL_PLATFORM_DIR" \
    OSHAL_PACKAGE_ENGINES="$engines" "${model_env[@]}" \
    "$OSHALD" serve > "$out/kernel.log" 2>&1 &
  kernel=$!
  (umask 077; printf 'work=%q\ncontainers=%q\nkernel=%q\n' "$work" "$containers" "$kernel" > "$state")
  base="http://127.0.0.1:$port"
  for _ in $(seq 1 180); do
    curl -sf -m 2 "$base/readyz" >/dev/null && break
    kill -0 "$kernel" 2>/dev/null || { tail -20 "$out/kernel.log" >&2; down; exit 1; }
    sleep 1
  done
  (umask 077; printf 'OSHAL_ADMIN_TOKEN=%s\n' "$token" > "$work/private/kernel.env")
  (umask 077; printf 'work=%q\ncontainers=%q\nkernel=%q\nbase=%q\nenvfile=%q\npersonfile=%q\n' "$work" "$containers" "$kernel" "$base" "$work/private/kernel.env" "$work/private/person.json" > "$state")
  echo "kernel $base · engines:${running:- none} · model: ${model:-none} · env file $work/private/kernel.env"
}

case "$mode" in
  down) down ;;
  up) down; up ;;
  run)
    down; up
    # shellcheck disable=SC1090
    . "$state"
    trap down EXIT
    proof="$pkg/tests/design-studio-nonadmin-live-proof.mjs"
    node "$proof" person "$base" "$envfile" "$personfile"
    verdict=0
    node "$proof" check "$base" "$personfile" "$out" || verdict=$?
    node "$proof" remove "$base" "$envfile" "$personfile" || true
    exit "$verdict" ;;
  *) echo "usage: nonadmin-disposable.sh run|up|down" >&2; exit 2 ;;
esac
