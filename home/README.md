# Smart Home (home) — OSHAL app package

1.2.4 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Control your smart home by chat (ADR-036/038): connect a hub at `/utilities`
(SmartThings = token paste; Google Nest = OAuth), then the home-bot reads your real
devices + scenes via your connector token and turns "turn off the living room
lights" into the right commands. Destructive actions (locks, garage, thermostat)
are confirmed first (the `no-device-write` 428 gate). Timers (clock or
sunrise/sunset) fire through the kernel scheduler's home branch and log
`home-control` tickets as your activity history.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 2):

- **In this package:** the app manifest (ticketType `home-control` + the Home
  Control workflow), the `/api/home` routes (dashboard surface, device/scene
  reads over the bot's store, assistant fast loop, deterministic /control +
  /scene/run with the confirm gate, schedule CRUD), the dashboard
  (`tools/home.html`), and a package copy of the home-bot persona for the
  registrar.
- **Stays in the OSHAL kernel:** the home-bot node (container + both registry
  blocks + core persona + `scripts/oshal-smartthings.js` + the smart-home
  toolkit), the shared `home-data` volume (bot :rw / api :ro), the
  `smartthings` + `google-home` platform connectors, and the scheduler's
  `home-control` dispatch branch (`home-schedule-dispatch` — fires with no user
  session, so it lives with the scheduler runtime; the packaged route reaches it
  via `@/app/home-schedule-dispatch`).

## Surfaces

| Tile | URL | What |
|---|---|---|
| Home | `/api/home/ui` | Devices + scenes dashboard with a chat bar |
| Hubs | `/utilities` | Connect/disconnect SmartThings / Nest (kernel-served) |

## Install

```bash
node scripts/oshal-app.js install home
```

No migrations — the per-user store is files on the `home-data` volume; nothing
in Postgres. Uninstall/toggle never touches device data.

## Direct Local Swarm (`swarm-local`) & Operations Runbook (1.3.4)

- **`$0`-API-Cost Local Swarm Discovery & Registration (`swarm-local`):**
  - `GET /api/home/local-discover` and `POST /api/home/local-discover`: lists the local Bluetooth and LAN appliances that this installation's own discovery file (`host-local-discovery.json` in the person's folder) names, ready to register. It scans nothing, and since 1.4.0 it lists no made-up device and never a TV: TVs come from the scan below.
  - `POST /api/home/devices/register`: Registers locally discovered or manually entered LAN/Bluetooth/ADB devices directly into the household device inventory under provider `"swarm-local"`.
- **Direct SmartThings Token Input (`POST /api/home/connect-token`):**
  - Allows operators to paste or rotate a SmartThings Personal Access Token directly from `/api/home/ui`, immediately syncing SmartThings devices, scenes, and Family Hub refrigerator camera/temperature capabilities.
- **Persistent `OSHAL_PACKAGE_DATA_DIR` Device Cache:**
  - Inside the read-only Bubblewrap package mount (`ctx.appPackageDir`), persistent local swarm device registrations and cached hub states are written exclusively under `process.env.OSHAL_PACKAGE_DATA_DIR`.
- **Operations Runbook (`GET/POST /api/home/operations-guide`):**
  - Serves an interactive step-by-step operations and pairing runbook covering SmartThings token setup, Samsung Family Hub refrigerator & view-inside camera inspection, and zero-touch local swarm (`swarm-local`) device enrollment.
- **Weekly Refrigerator Assessment, Grocery Cart & Meal Builder (`1.3.5`):**
  - Declares optional `phone-control` dependency (`dependencies.optional.apps`) so enrolled companion phones can capture 3-bay optical Family Hub ViewInside camera snapshots (`GET /api/home/fridge-image`, `POST /api/home/fridge-refresh`).
  - `GET /api/home/fridge-assessment` and `POST /api/home/fridge-assessment`: Compares this week's 3-shelf refrigerator inventory against last week's scan and recent order history, flagging depleted staples, running-low items, and fresh items to eat first.
  - `POST /api/home/fridge-meal-plan`: Starts or updates the recommended grocery cart (`action: "start-cart" | "add-cart-item" | "toggle-cart-item" | "remove-cart-item"`) and builds a 5-day weekly meal list combining current refrigerator contents with ordered groceries.

## TVs and streaming sticks (1.4.0)

The person's own computer finds the TVs and streaming sticks on their home network and presses their buttons. This
package never reaches a network (its sandbox has none) and the server never scans one: everything network-facing is
Phone & Device Control's bridge (1.5.0, `phone-control/bridge/oshal_phone_lan.py`) running on a computer of the
person's, through the kernel's `/api/computers/<id>/run`.

- **On the Smart Home screen**, under *TVs and streaming sticks*: pick one of your computers (an online Linux computer
  with oshal Node signed in and control allowed is chosen first) and press **Scan for TVs**. The page updates the
  bridge on that computer when it is not Phone & Device Control's own, runs the scan and saves what it found. Each TV
  gets a card with **Wake**, **Turn off**, **Vol −/+**, **Mute**, the arrows and **OK**, **Home**, **Back**,
  **Play/Pause**, **Open oshal on this TV** (Samsung: its browser; Android: the oshal TV app when it is installed),
  **Pair** for a Samsung, **Connect** for an Android TV this computer has not used yet, and **Install the TV app**
  (asks once more, then installs the signed oshal TV app on that one Android TV). A Roku cannot open a web page, so
  its card has no Open oshal. Each card says what the computer answered, for example "Press Allow on the TV, then
  Retry." while a Samsung TV asks whether to allow oshal.
- **What the scan does**: reads the computer's neighbor table on its real network interfaces (private addresses only;
  container, VPN and tunnel interfaces are skipped), asks SSDP and avahi who is there, probes the TV ports and reads
  what each device says about itself (Samsung `/api/v2/`, Roku `/query/device-info`, Google Cast, adb state). It never
  connects adb to a new TV, never installs anything, and sends Wake-on-LAN only to saved TVs and only when asked.
- **Samsung pairing**: the TV hands out a token after the person presses Allow; it is kept on that computer only
  (`~/.local/state/oshal-phone-bridge/samsung-tokens.json`, mode 0600) and never sent to the server.
- **Android TVs** found with network debugging on are also added to Phone & Device Control, so its screen and remote
  work there too. A Google TV or Fire TV with debugging off is listed with the steps to turn it on.
- **Routes** (`/api/home/lan/*`, per person in `lan-tvs.json`): `GET /lan/devices`, `POST /lan/discover-plan`,
  `POST /lan/control-plan`, `POST /lan/record`. A plan answers `planned`, never done; a TV's on or off state changes
  only when its own answer says the press worked.
- **Jarvis**: the tools `home-lan-devices`, `home-lan-discover`, `home-lan-control` and `home-lan-record`. Since 1.4.3
  the scan and press tools declare `computerPlan` (program `phone-bridge`, verbs `lan-discover` and `lan-control`), so
  the kernel offers home-bot `computer.run_plan` and gives each fitting plan a planId: home-bot passes that planId, the
  kernel runs exactly the planned command once on the person's own computer, and the computer's answer is recorded
  with `home-lan-record`. It is offered only in the person's own conversation, to a person with Editor on Smart Home
  and a connected computer of theirs with control on (not an Android device); otherwise the plan is said as planned
  and the TV buttons on the Smart Home screen run it.
- **Network TVs saved earlier as local devices** are no longer "switched" by flipping a saved state: `POST /control`
  answers `409 tv_needs_computer` and the device grid points to the TV section instead of showing a switch.
- **Tests**: `tests/home-lan-devices.test.cjs`, `tests/browser/home-tvs.test.cjs` (store-ci job `home`), and the
  bridge's own suite in `phone-control/tests/phone-control-lan.test.mjs`. No test presses a real TV.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| home-assistant | home assistant request | T2 | none | disable | not yet measured | none recorded |
| scheduled-home-control | timer firing | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
