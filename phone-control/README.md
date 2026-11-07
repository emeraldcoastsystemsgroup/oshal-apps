# Phone & Device Control (`phone-control`)

Control your **Android phone**, your **TV (Fire TV / Android TV)**, your **iPhone** and your **computers** through oshal Node. Device features are restricted to the installation's administrator, and every record stays private to the person who configured it.

## How it works

The page sends each command to a computer of yours that runs oshal Node with **Let Jarvis control this computer**
allowed, through the kernel's `/api/computers` (ADR-205). On a Linux computer, **Set up this computer** installs the
phone bridge in your account (`~/.local/share/oshal-phone-bridge/`, every file's sha256 checked; **Remove from this
computer** takes it away). The package server keeps only your owner-scoped records: your phones and TVs, session
preferences, chat threads, whiteboard overlays, saved screenshots/recordings, file-transfer receipts, command history,
and each computer's last bridge report. It never reaches a phone, a radio or a network itself.

| Device | Through | What works | What it needs |
|---|---|---|---|
| Android | adb over Wi-Fi (setup gets adb 30 or newer without root) | live screen (High / Balanced / Low quality), tap and swipe, Home, Back, Recent apps, volume, power, typing, special keys, opening an app, reading the words on screen, `/sdcard/Download` file transfer, clipboard sync where Android permits, screenshot, clip recording, chat log, whiteboard | Developer options, Wireless debugging, **Pair device with pairing code**; the phone and the computer on the same Wi-Fi |
| TV (Fire TV / Android TV) | network adb over Wi-Fi (port 5555) | 1-step **Load oshal TV** (connects, waits for Allow, pushes & launches the signed oshal TV app), Wi-Fi TV scan, live screen with direct click-anywhere & drag gestures, Back/Home bar, typing, opening Leanback launcher apps, TV Concierge, `/sdcard/Download` file transfer, screenshot, clip recording, whiteboard | ADB debugging on (using your remote or the Fire TV phone remote app), same Wi-Fi, **Allow USB debugging?** accepted once on the TV |
| iPhone | Bluetooth keyboard & AssistiveTouch pointer peripheral `OSHAL-KB` (BlueZ) + AirPlay receiver `OSHAL Mirror (<computer>)` (UxPlay) | live AirPlay screen mirroring, opt-in learned Bluetooth pointer calibration (`ble-calibrate`), direct click-to-tap, drag-to-swipe, wheel scroll, long-press app icon drag, screen text reading, typing, Home, Spotlight, volume, Enter and special keys, opening an app, Phone Concierge tasks (including **Organize my apps**), screenshot, clip recording, whiteboard, removing pairings | a Linux computer with Bluetooth (`python3-dbus`, `python3-gi`) and `avahi-daemon` on the same Wi-Fi; pairing started on the iPhone in **Settings → Bluetooth → OSHAL-KB**; **Control Center → Screen Mirroring** for the screen; AssistiveTouch for taps, swipes and icon drags |
| RDP Desktop | native `/api/rdp/sessions` (Windows, Linux `grdctl`/`xrdp`, macOS FreeRDP shadow, or any TCP 3389 host) | setup scripts per OS, X.224 port handshake check, **Connect in console** live desktop picture, direct click, drag, scroll, keyboard typing, special keys, screen text snapshot, RDP Concierge, screenshot, clip recording, chat log, whiteboard | Remote Desktop enabled on TCP 3389 (or custom port) reachable on LAN or VPN |
| Computer | oshal Node (`desktop.control`, `app.open`, `shell.exec`) | live screen, direct Touch tap or Mouse pad pointer, right/double click, scroll, live keyboard, `Ctrl+Alt+Del` / Super / F1–F12, multi-monitor switching, `~/Downloads` file transfer, clipboard sync, screenshot, clip recording, `oshal-privacy-hook` privacy screen when installed, lock on session end, desktop chat notifications, whiteboard, operator screen sharing (**Switch sides**), **Work on it** | oshal Node with control allowed |

For Bluetooth on an iPhone, the Linux computer acts as a keyboard peripheral (`OSHAL-KB`), so pairing always starts on
the iPhone (**Settings → Bluetooth → OSHAL-KB**) during the 2-minute window rather than from a computer scan.

"Sent" on an iPhone means a paired iPhone had subscribed to that report; when the keyboard report is subscribed while
the mouse report is not, the bridge reports `assistive_touch_off` and offers a 1-click **Open AssistiveTouch on iPhone**
shortcut. Android errors are adb's own, in words. Capabilities that an operating system does not expose in user space
(such as iOS filesystem/clipboard access or display blanking without `oshal-privacy-hook`) return an explicit refusal
rather than faking success. Nothing is sent to a phone while its **Allow control** is off.

A dedicated **Phone Concierge** in the session sidebar plans mobile-specific actions (opening apps through Spotlight or
package launch, reading phone screen text coordinates, swiping Home Screen pages, and organizing app icons with bounded
anti-loop protection), while a **Connection Concierge** inside **Add a device** diagnoses computer, Android, Fire TV and
iPhone connection errors with 1-click fixes. **Work on it** opens the kernel's desktop workspace for computers only.

The bridge on that computer has the access of the account signed in there, as every oshal Node command does.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **48 / 192 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| phone-control-action | device control operation | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
