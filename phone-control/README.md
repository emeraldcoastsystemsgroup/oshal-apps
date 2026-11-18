# Phone & Device Control (`phone-control`)

Control your **Android phone**, your **TV (Fire TV / Android TV)**, your **iPhone** and your **computers** through oshal Node. Every person adds, manages and controls their own devices on their own computers, and every record stays private to the person who configured it.

## Connect a device

Choose **Add a device → Connect with Orbit** to install or update Orbit from this installation's **Get oshal** page. Sign in on the device, then enable its control setting. Signing in alone does not enable control. **Devices already added** opens each registered device's own page and reports its connection and control states separately; an unreported state stays unknown.

The **Optional Linux bridge** section is for Wi-Fi Android/TV connections and iPhone Bluetooth/AirPlay connections through a Linux computer. Windows and Android devices signed in through Orbit remain directly available without being offered Linux bridge installation.

## Open Orbit through your Android phone

Version 1.17 adds two tools for the main Jarvis conversation: list your existing native phone-to-TV connections, then open Orbit through an explicitly selected active connection. Set up and test that connection in Orbit on your Android phone first. The phone and TV must remain enrolled to you with their control settings allowed, and the phone must have a supported local connection to the awake TV.

Ask Jarvis to open Orbit on the selected TV through the selected phone. Jarvis uses the saved connection's exact identifiers; an unclear choice needs clarification. The first native action opens Orbit. Pairing, connection testing and permission changes remain explicit setup actions in Orbit. Separate application chat and direct application requests do not carry the original main Jarvis request needed for this action.

A phone's command acknowledgment and a TV's native receipt are reported separately. Orbit is reported in front only after a fresh native screen read confirms it; playback remains unverified. A failed or unknown result does not trigger an automatic retry or another route. This native relay is covered by installed-package integration tests with scripted phone and TV responses; physical phone-to-TV acceptance remains unverified.

## Fire TV phone app guide

Version 1.18 adds one read-only tool, **Read Fire TV Phone App Guide** (`GET /api/phone-control/remote-apps/fire-tv/guide`). It answers the same fixed text for every person: how to use the Amazon Fire TV app already paired on your own Android phone, starting with the remote you have already selected, then its centre button once the TV is confirmed. The guide takes no input and names no phone, TV or address. It does not inspect, connect, select, press or play anything, and it writes no history.

In the main Jarvis conversation the guide can be followed with the phone tools Jarvis is offered there. Every press must name the Fire TV app as the app in front; a phone that cannot check that, a locked phone or an unclear TV means Jarvis stops and says why. A press that was accepted is reported apart from what the TV is playing, which stays unverified until the same TV is observed or you say what you see.

The guide route is covered by integration tests over the mounted route (`tests/remote-guides.test.cjs`). Jarvis following it on a real phone and TV has not been accepted yet.

Version 1.19 adds one declaration on that tool, `devicePath`. It tells the kernel's path planner (`device.path`) that this way exists: an Android phone or tablet with the Amazon Fire TV app reaches a Fire TV with the remote's keys, for waking it and carrying on with what was on. It grants nothing and runs nothing. The planner offers the way only for your own phone, only while **Let Jarvis control this device** is on there, and says to read this guide first. The declaration is checked by `tests/phone-control-device-path.test.cjs`; the kernel reading it from this installed package has not been tested yet.

## Roku and Samsung TVs

The bridge's `lan-control` verb is what Smart Home's TV tools run on your computer. Version 1.20 adds three actions to it for a Roku and a Samsung TV (`bridge/oshal_phone_front.py`); this package gains no tool or route for them.

| Action | Roku (ECP, port 8060) | Samsung TV (port 8001, remote channel on 8002) |
|---|---|---|
| `launch_app` | `POST /launch/<digit id>` after `GET /query/apps` confirms the application; a title is sent as `contentId` and `mediaType` | `POST /api/v2/applications/<id>`; when the TV refuses it, `ed.apps.launch` on the paired remote channel. A title is refused in words |
| `list_apps` | `GET /query/apps`: applications with digit ids; TV inputs are only counted | `ed.installedApp.get` on the paired remote channel; a TV that does not answer it is said in words |
| `active_app` | `GET /query/active-app` and `/query/media-player`: the application in front, the home screen, a screensaver over it, the player's state | `GET /api/v2/applications/<id>`: running and visible for the one application named |

After a launch the answer reads the TV again and says what it reported in front. Neither kind of TV gives a picture or the text on its screen, so nothing here does. Every id and content id is checked against a closed shape before anything is sent, and only a private home-network address is accepted. These actions are tested against stand-in TVs on `127.0.0.1` (`tests/phone-control-front.test.mjs`); they have not been run against a real Roku or Samsung TV yet. An Android or Fire TV refuses them in words and keeps its own tools above.

## When something is not there

Version 1.20.1 says it in words. A device you have not saved, or one that is not yours, is answered `404` with `{"error":"device_not_found","message":"No saved device is called \"<what you asked for>\". List your devices first (phone-control-list-devices)."}` on every device route, including **List TV Apps** (`phone-control-tv-apps`); a capture, a transfer, a bridge file and a page file that are not there have their own sentence beside their code (`lib/refusals.js`, checked by `tests/phone-control-routes.test.cjs`).

## On a phone

Version 1.20.2: **Your devices** scrolls under a finger and a mouse wheel again (the html and body rule added in 1.3.0 kept a list taller than the screen from moving). On a screen narrower than 900 px the page also ends with room under its last row, so every row's buttons can be scrolled clear of the floating Jarvis button. Checked in Chromium at 412x915 with touch by `tests/phone-control-phone-scroll.test.cjs`.

Version 1.20.3: **Phone / TV / RDP Concierge** and **Connection Concierge** mount the kernel's one chat window (`/shared/ui/js/jarvis-chat-frame.js`) as `device-concierge` with live device and setup `screen_state`, verified in Chromium at `1440x900` and `412x915` by `tests/phone-control-one-chat-window.test.cjs`.

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
| RDP host | the phone bridge's `rdp-probe` on your Linux computer (Windows, Linux `grdctl`/`xrdp`, macOS FreeRDP shadow, or any TCP 3389 host) | setup scripts per OS (**Copy setup script**) and **Check RDP port** (a TCP connect plus the X.224 Connection Confirm handshake). This console does not open RDP desktops: nothing implements an RDP session backend (`/api/rdp/sessions`), so **Connect in console** stays hidden until one exists | Remote Desktop enabled on TCP 3389 (or a custom port) reachable from the Linux computer on your LAN or VPN |
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
