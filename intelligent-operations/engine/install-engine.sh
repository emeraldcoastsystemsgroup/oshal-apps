#!/bin/sh
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- start the Intelligent
#   |                                           | Operations detection engine (digest-pinned OpenSearch
#   |                                           | percolator + the typed engine) as its own compose
#   |                                           | project on a Docker host such as the Spark, wait for
#   |                                           | search health, prove the engine with the hello/health
#   |                                           | exchange the package itself performs, then print the
#   |                                           | two host steps the operator runs next. Builds nothing:
#   |                                           | both images are official and pinned in compose.yaml.
#   |                                           | The cad-studio installer's shape, including the
#   |                                           | compose-project pin that keeps a core deploy from
#   |                                           | sweeping it.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | Restart an existing oshal-native-operations-link
#   |                                           | user unit after the recreate: the link resolves
#   |                                           | the container's address only when it starts, so
#   |                                           | a re-run left the kernel dialling a dead address.
#   |                                           | The host steps are printed only when that unit is
#   |                                           | absent, and --help prints the usage block by its
#   |                                           | markers instead of line numbers that move.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | The restart is proven, not assumed: within 5 s the
#   |                                           | unit must be active (systemctl --user is-active) and
#   |                                           | the loopback port parsed from its ExecStart must
#   |                                           | accept a TCP connect (python3 socket.create_connection),
#   |                                           | or the last 20 journal lines are printed and the
#   |                                           | script exits 1 - a unit that restarted into a dead
#   |                                           | forwarder used to be reported as dialling the engine.
#   |                                           | The closing step names the real control: Operations
#   |                                           | navigation entry "Data pipeline", button "Check
#   |                                           | detection service" (GET /pipeline/health); the screen
#   |                                           | it named before ("Data & decisions") does not exist.
# 4   | maintainer@emeraldcoastsystemsgroup.com   | The closing step no longer calls "Check detection service" the
#     |                                           | only control that reports the engine state: publishing or
#     |                                           | previewing a policy and evaluating share the same engine
#     |                                           | client and report the same reason and command (third review,
#     |                                           | 2026-11-03). It is the on-demand check.
#
# Usage -- from a checkout of this package on the Docker host:
#   sh intelligent-operations/engine/install-engine.sh [listen-port]
# <listen-port> (default 37420) is the loopback port the kernel's link unit forwards to the
# engine, the one OSHAL_PACKAGE_ENGINES pins for intelligent-operations; it is only PRINTED in the
# closing instructions, never applied.
#
# Idempotent: re-run it after the engine source (and identity.json) changes; the engine container
# is recreated so the mounted files are the current ones, search keeps its data volume. When the
# user unit oshal-native-operations-link.service exists it is restarted, because the link resolves
# the container's address only when it starts and the recreate gives the engine a new one; the two
# host steps are printed only when that unit is absent.
# Env overrides: OSHAL_ENGINE_NETWORK (external engines network, default oshal-native-engines).
set -eu
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
PROJECT=oshal-intelligent-operations-engine
ENGINE_DIR=$(cd "$(dirname "$0")" && pwd)
COMPOSE=$ENGINE_DIR/container/compose.yaml
CONTAINER=oshal-intelligent-operations-engine
SEARCH=oshal-intelligent-operations-search
# The kernel's loopback link to this engine, when the native host has installed it.
LINK=oshal-native-operations-link.service
NETWORK=${OSHAL_ENGINE_NETWORK:-oshal-native-engines}
ENGINE_PORT=7419
HEALTH='http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=5s'
say() { printf '[intelligent-operations engine] %s\n' "$*"; }
die() { printf '[intelligent-operations engine] ERROR: %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  -h|--help) sed -n '/^# Usage/,/^# Env overrides/p' "$0"; exit 0 ;;
esac
LISTEN=${1:-37420}
case "$LISTEN" in
  ''|*[!0-9]*) die "listen port must be a number (got '$LISTEN')" ;;
esac
[ "$LISTEN" -gt 1024 ] && [ "$LISTEN" -le 65535 ] || die "listen port must be nonprivileged (1025-65535), got $LISTEN"

command -v docker >/dev/null 2>&1 || die "docker CLI not found - run this on the Docker host"
docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"
docker compose version >/dev/null 2>&1 || die "docker compose (v2 plugin) is required"
[ -f "$COMPOSE" ] || die "no container/compose.yaml under $ENGINE_DIR"
for name in server.py percolation.py identity.json; do
  [ -f "$ENGINE_DIR/$name" ] || die "engine file $name is missing under $ENGINE_DIR"
done
# The engines network belongs to the native host installation; this script never creates it.
docker network inspect "$NETWORK" >/dev/null 2>&1 \
  || die "engines network $NETWORK does not exist - install the native host first, or set OSHAL_ENGINE_NETWORK"

# The digest the package verifies every hello against (routes/detection-engine.js reads this file
# from the installed package; the container mounts the very same file read-only).
EXPECTED=$(sed -n 's/.*"buildHash"[[:space:]]*:[[:space:]]*"\([a-f0-9]\{64\}\)".*/\1/p' "$ENGINE_DIR/identity.json")
[ -n "$EXPECTED" ] || die "identity.json carries no 64-hex buildHash"

say "starting project $PROJECT from $COMPOSE (official images, nothing is built)"
say "search: private network only; engine: joined to $NETWORK with no published port"
OSHAL_ENGINE_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$COMPOSE" up -d --wait --wait-timeout 300
# Recreate the engine alone so a bind-mounted file replaced since the last run (a new inode after a
# checkout) is the one served; search keeps running on its data volume.
OSHAL_ENGINE_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$COMPOSE" \
  up -d --wait --wait-timeout 120 --no-deps --force-recreate engine

for c in "$CONTAINER" "$SEARCH"; do
  got=$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project"}}')
  [ "$got" = "$PROJECT" ] || die "$c landed in compose project '$got', not '$PROJECT' - a core deploy would sweep it"
done

say "waiting for OpenSearch health yellow inside $SEARCH"
i=0
until docker exec "$SEARCH" curl -fsS "$HEALTH" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 36 ]; then
    docker logs --tail 40 "$SEARCH" >&2 || true
    die "OpenSearch did not reach yellow health"
  fi
  sleep 5
done

# Self-test: the exact exchange the kernel relay performs for routes/detection-engine.js -- read the
# engine's hello line, send one health command with id 1, read one reply line -- and refuse unless
# the hello's protocol/engine/buildHash equal engine/identity.json (host copy and mounted copy).
self_test() {
  docker exec "$CONTAINER" python -B -c '
import json, socket, sys
expected = json.load(open("/engine/identity.json"))
host_digest, port = sys.argv[1], int(sys.argv[2])
def fail(reason):
    print(json.dumps({"status": "failed", "reason": reason})); sys.exit(1)
if expected["buildHash"] != host_digest: fail("mounted identity.json differs from the host identity.json")
with socket.create_connection(("127.0.0.1", port), 5) as sock:
    sock.settimeout(20); stream = sock.makefile("rwb")
    hello = json.loads(stream.readline())
    if hello.get("error"): fail("engine refused the hello: " + str(hello["error"]))
    for key in ("protocol", "engine", "buildHash"):
        if hello.get(key) != expected[key]: fail("hello " + key + " " + repr(hello.get(key)) + " does not equal identity.json " + repr(expected[key]))
    stream.write((json.dumps({"cmd": "health", "args": {}, "id": 1}) + "\n").encode()); stream.flush()
    reply = json.loads(stream.readline())
if reply.get("id") != 1: fail("reply id is not 1: " + json.dumps(reply))
if reply.get("error"): fail("health error: " + json.dumps(reply["error"]))
result = reply.get("result") or {}
if result.get("backend") != "opensearch" or result.get("health") not in ("green", "yellow"): fail("unexpected health result: " + json.dumps(result))
print(json.dumps({"status": "passed", "engine": hello["engine"], "protocol": hello["protocol"], "buildHash": hello["buildHash"], "backend": result["backend"], "version": result.get("version"), "health": result["health"]}))
' "$EXPECTED" "$ENGINE_PORT"
}
say "self-test: hello identity against identity.json, then the health command"
if ! self_test; then
  docker logs --tail 40 "$CONTAINER" >&2 || true
  die "self-test failed - the engine container is running but not answering as this package build"
fi

say "installed. The kernel reaches the engine only through its loopback link unit."
# The restarted link is proven before it is reported: within 5 s the unit must be active and the
# loopback port it forwards ($1) must accept a TCP connect, or the kernel still has no engine.
link_ready() {
  i=0
  while [ "$i" -lt 5 ]; do
    if systemctl --user is-active "$LINK" >/dev/null 2>&1 \
      && python3 -c 'import socket, sys; socket.create_connection(("127.0.0.1", int(sys.argv[1])), 1).close()' "$1" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}
# The link unit resolves the container's address when it starts, and the recreate above gave the
# engine a new one: an existing unit is restarted here, or the kernel keeps dialling the dead
# address. Nothing else on the host is applied; without the unit the two steps are printed instead.
if command -v systemctl >/dev/null 2>&1 && systemctl --user cat "$LINK" >/dev/null 2>&1; then
  unit_listen=$(systemctl --user cat "$LINK" 2>/dev/null \
    | sed -n 's/^ExecStart=.*native_container_forward\.py[[:space:]]\{1,\}\([0-9]\{1,\}\)[[:space:]].*/\1/p' | head -n 1)
  probe=${unit_listen:-$LISTEN}
  [ -n "$unit_listen" ] || say "note: no listen port could be parsed from the unit's ExecStart; probing loopback $LISTEN"
  systemctl --user restart "$LINK" || die "could not restart $LINK - the kernel link still dials the engine's old address"
  if ! link_ready "$probe"; then
    journalctl --user --no-pager -u "$LINK" -n 20 >&2 || true
    die "$LINK was restarted but within 5 s it was not active or loopback 127.0.0.1:$probe refused a TCP connect - the kernel cannot dial the engine; its last 20 journal lines are above"
  fi
  say "restarted $LINK: loopback $probe -> $CONTAINER:$ENGINE_PORT on $NETWORK dials the recreated engine again (unit active, 127.0.0.1:$probe accepted a TCP connect)"
  [ -z "$unit_listen" ] || [ "$unit_listen" = "$LISTEN" ] \
    || say "note: the installed unit forwards loopback $unit_listen, not the $LISTEN given here; the unit is what the kernel uses"
  say "OSHAL_PACKAGE_ENGINES must still pin {\"intelligent-operations\":\"127.0.0.1:$probe\"} in oshald.env - unchanged by this script"
else
  say "no user unit $LINK is installed; this script applies NEITHER step below:"
  printf '\n  1. Link unit: loopback %s -> %s:%s on %s. The forwarder line\n' "$LISTEN" "$CONTAINER" "$ENGINE_PORT" "$NETWORK"
  printf '     (ExecStart of ~/.config/systemd/user/%s, generated like the other engine links):\n' "$LINK"
  printf '       native_container_forward.py %s %s %s %s\n' "$LISTEN" "$CONTAINER" "$NETWORK" "$ENGINE_PORT"
  printf '  2. OSHAL_PACKAGE_ENGINES entry, merged into the existing map in oshald.env (keep every other engine), then one kernel restart:\n'
  printf '       {"intelligent-operations":"127.0.0.1:%s"}\n\n' "$LISTEN"
fi
say "then open Operations, choose the navigation entry 'Data pipeline' and press 'Check detection service' (GET /pipeline/health): that on-demand check, like publishing or previewing a policy and evaluating, reports the engine state with this install command - a down or stale engine answers 'not reachable' or 'does not match this package build' together with it."
