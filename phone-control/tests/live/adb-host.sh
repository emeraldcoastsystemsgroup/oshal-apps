#!/usr/bin/env bash
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T4, the adb half on a real Linux computer: in a throwaway home, Set up's setup-adb downloads adb and its libraries with apt-get download and unpacks them with dpkg-deb -x (no root), adb reports version 30 or newer, adb-devices starts the real adb server (on a private port, so nobody's own adb is touched), and pairing or connecting to an address where no phone listens gives adb's own failure in words. No phone is needed. Usage: bash tests/live/adb-host.sh [receipt.json]
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
receipt="${1:-/dev/stdout}"
home="$(mktemp -d)"
run="$(mktemp -d /tmp/pca-XXXX)"
port=$((50000 + RANDOM % 10000))
closed=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
export HOME="$home" XDG_RUNTIME_DIR="$run" ANDROID_ADB_SERVER_PORT="$port" PATH=/usr/bin:/bin
cleanup() {
  adb_bin="$home/.local/share/oshal-phone-bridge/adb/usr/lib/android-sdk/platform-tools/adb"
  libs=$(ls -d "$home"/.local/share/oshal-phone-bridge/adb/usr/lib/*/android 2>/dev/null | head -1 || true)
  [ -x "$adb_bin" ] && LD_LIBRARY_PATH="$libs" "$adb_bin" kill-server >/dev/null 2>&1 || true
  rm -rf "$home" "$run"
}
trap cleanup EXIT
b() { python3 -I "$here/bridge/oshal_phone_bridge.py" "$@"; }
setup=$(b setup-adb)
version=$(b status adb=true)
devices=$(b adb-devices)
pair=$(b adb-pair "address=127.0.0.1:$closed" code=000000 || true)
connect=$(b adb-connect "address=127.0.0.1:$closed" || true)
python3 - "$setup" "$version" "$devices" "$pair" "$connect" > "$receipt" <<'PY'
import json, sys
setup, status, devices, pair, connect = (json.loads(arg) for arg in sys.argv[1:])
checks = {
  'setup_ok': setup.get('ok') is True and setup.get('adb', {}).get('source') == 'phone-control',
  'adb_30_or_newer': status['adb'].get('ready') is True,
  'server_started': devices.get('ok') is True,
  'pair_no_answer': pair.get('ok') is False and pair.get('error') == 'no_answer',
  'connect_no_answer': connect.get('ok') is False and connect.get('error') == 'no_answer',
}
print(json.dumps({'checks': checks, 'pass': all(checks.values()), 'setup': setup, 'adb': status['adb'], 'devices': devices,
                  'pair': pair, 'connect': connect}, indent=1))
sys.exit(0 if all(checks.values()) else 1)
PY
