#!/usr/bin/env bash
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T7, run on the computer an Android phone is paired and connected with: lists it, reads a picture and compares its size with the phone's own, presses Home and reads which app is on screen, opens a chosen app and reads the screen again. Usage: bash android-device.sh <serial from adb-devices> [package, default com.android.settings] > receipt.json
set -uo pipefail
serial="${1:?the serial adb-devices lists for the phone}"
package="${2:-com.android.settings}"
b() { python3 -I "$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py" "$@"; }
devices=$(b adb-devices)
info=$(b adb-info "serial=$serial")
frame=$(b adb-frame "serial=$serial")
home=$(b adb-key "serial=$serial" key=HOME)
sleep 1
after_home=$(b adb-ui "serial=$serial")
launch=$(b adb-launch "serial=$serial" "package=$package")
sleep 2
after_launch=$(b adb-ui "serial=$serial")
python3 - "$devices" "$info" "$frame" "$home" "$after_home" "$launch" "$after_launch" "$serial" "$package" <<'PY'
import json, sys
devices, info, frame, home, after_home, launch, after_launch = (json.loads(x) for x in sys.argv[1:8])
serial, package = sys.argv[8:]
listed = any(d['serial'] == serial and d['state'] == 'device' for d in devices.get('devices', []))
aspect = lambda w, h: round(w / h, 3) if w and h else None
checks = {
  'listed': listed,
  'frame_matches_phone': frame.get('ok') is True and aspect(frame.get('deviceWidth'), frame.get('deviceHeight')) in
      (aspect(info.get('width'), info.get('height')), aspect(info.get('height'), info.get('width'))),
  'home_pressed': home.get('ok') is True,
  'launcher_after_home': after_home.get('package'),
  'opened': launch.get('ok') is True and after_launch.get('package') == package,
}
frame.pop('data', None)
print(json.dumps({'checks': checks, 'info': info, 'frame': frame, 'after_home_package': after_home.get('package'),
                  'after_launch_package': after_launch.get('package')}, indent=1))
PY
