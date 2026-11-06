# Phone & Device Control (`phone-control`)

Control your **Android phone** and your **iPhone** through **your own computer**, and see your computers' screens.

## How it works

The page sends each command to a computer of yours that runs OSHAL Node with **Let Jarvis control this computer**
allowed, through the kernel's `/api/computers` (ADR-205). There it runs the phone bridge this app installs in your
account when you press **Set up this computer** (`~/.local/share/oshal-phone-bridge/`, every file's sha256 checked;
**Remove from this computer** takes it away). The package server keeps only your records: your phones, the history of
what was sent and what the computer answered, and each computer's last bridge report. It never reaches a phone, a
radio or a network itself.

| Phone | Through | What works | What it needs |
|---|---|---|---|
| Android | adb over Wi-Fi (setup gets adb 30 or newer without root) | live screen (about every 1.5 s while open), tap and swipe on the screen, Home, Back, Recent apps, volume, power, typing, opening an app, reading the words on screen | Developer options, Wireless debugging, **Pair device with pairing code**; the phone and the computer on the same Wi-Fi |
| iPhone | the computer as a Bluetooth keyboard and mouse called `OSHAL-KB` (BlueZ) | typing, Home, Spotlight, volume, Enter and other keys, opening an app (Spotlight, its name, Enter), the pointer by steps | a Linux computer with Bluetooth, `python3-dbus` and `python3-gi`; pairing in a 2-minute window; AssistiveTouch for the pointer |
| Computer | OSHAL Node | its screen picture; **Work on it** opens the kernel's page for it with Jarvis | OSHAL Node with control allowed |

**An iPhone's screen cannot be shown here:** Apple mirrors only to AirPlay receivers. Everything else above works.

"Sent" on an iPhone means a paired iPhone had subscribed to that report; otherwise the answer is "No phone is
listening". Android errors are adb's own, in words. Nothing is sent to a phone while its **Allow control** is off.

The concierge rail reads your phones, the reports and the history. It cannot press anything: a package bot does not
drive computers (ADR-205 D5). **Ask Jarvis to do it** opens the kernel's page for the phone's computer, where Jarvis can
run the bridge by name (`oshal-phone-bridge help`).

The bridge on that computer has the access of the account signed in there, as every OSHAL Node command does.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **48 / 192 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| phone-control-action | device control operation | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
