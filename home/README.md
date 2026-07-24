# Smart Home (home) — OSHAL app package

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
