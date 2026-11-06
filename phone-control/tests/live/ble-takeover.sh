#!/usr/bin/env bash
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T6, run on the computer with the bonded iPhone AFTER the person pressed Set up this computer and Replace the earlier test keyboard: records whether the earlier test keyboard is gone, the bridge's keyboard is registered and advertising, which iPhone is connected and which reports it subscribed, BlueZ's own view of the adapter and the phone, then types one line and records the answer. It changes nothing else and claims nothing about the phone: the person confirms the text appeared. Usage: bash ble-takeover.sh <iPhone address> [text] > receipt.json
set -uo pipefail
address="${1:?the Bluetooth address of the iPhone, for example 7C:4B:26:2B:6C:02}"
text="${2:-hello from oshal}"
b() { python3 -I "$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py" "$@"; }
status=$(b status adb=false)
earlier=$(ss -ltnp 2>/dev/null | grep -c '127.0.0.1:47835' || true)
show=$(bluetoothctl show 2>&1 | sed -n '1,40p')
info=$(bluetoothctl info "$address" 2>&1 | sed -n '1,30p')
typed=$(b ble-type "text=$text")
python3 - "$status" "$earlier" "$show" "$info" "$typed" "$address" <<'PY'
import json, sys
status, earlier, show, info, typed, address = sys.argv[1:]
status, typed = json.loads(status), json.loads(typed)
ble = status.get('ble') or {}
phone = next((p for p in ble.get('phones', []) if p['address'].upper() == address.upper()), None)
checks = {
  'earlier_keyboard_gone': earlier.strip() == '0' and status.get('earlierKeyboard') is None,
  'registered_and_advertising': bool(ble.get('registered') and ble.get('advertising')),
  'iphone_connected_and_paired': bool(phone and phone['connected'] and phone['paired']),
  'reports_subscribed': ble.get('subscribed', {}),
  'typed_sent': typed.get('sent') is True,
  'not_pairable_outside_a_window': ('Pairable: no' in show) if not ble.get('pairWindowSeconds') else 'window open',
}
print(json.dumps({'checks': checks, 'reportSecurity': ble.get('reportSecurity'), 'typed': typed, 'status': status,
                  'bluetoothctl_show': show, 'bluetoothctl_info': info,
                  'person_must_confirm': 'Did the text appear on the iPhone?'}, indent=1))
PY
