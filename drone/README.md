# Drone Ops (drone) — OSHAL app package

1.2.2 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Drone fleet automation control (?app=drone, ADR-098/099). Drones are SWARM NODES:
the embedded kinematic simulator is always present, and real vehicles (sim or
MAVLink at the airframe) join the fleet via authenticated drone-node heartbeats.
Flight is deterministic code — every command is geofence-validated in the kernel
DroneService; no LLM sits in the control loop. The **drone-operator** concierge
only DRAFTS missions (single-drone or coordinated fleet plans with deterministic
separation checks); nothing flies without an explicit human Execute, and real
hardware additionally requires the confirm rail. Every actuating command is
audit-logged under the caller's sub.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (the four route-backed tools + the Drone
  Ops tile), the `/api/drone` routes (surface, state/fleet/events/captures reads,
  the full command set, per-user missions with the approval-gated execute, show
  timelines + live retask, the secret-gated node heartbeat ingest, and the
  draft-only concierge `/chat`), the surface (`tools/drone-ops.html`), and a
  package copy of the drone-operator persona for the registrar.
- **Stays in the OSHAL kernel:** the drone **engine** (`src/features/drone` —
  DroneService, sim/MAVLink/remote providers, fleet plane, mission + show
  validators, patterns, the FleetShowRunner conductor, and ALL its engine specs),
  the standalone drone **node** (`src/app/drone-node-server.ts`) + the
  `DRONE_EMBEDDED_SIMS` compose knob, the drone-operator **inline node** (both
  `swarm-bot-registry` blocks + the `ai-lab` persona), the concierge-store
  `'drone'` conversation prefix, and the default Drone Ops tile in
  `oshal-framework.json` (carved apps keep their default tiles).

## Surfaces

| Tile | URL | What |
|---|---|---|
| Drone Ops | `/api/drone/app` | Fleet map + telemetry + missions + shows console (self-served by this package) |

## Install

```bash
node scripts/oshal-app.js install drone
```

No migrations — `drone_missions` / `drone_command_log` / `drone_conversations` /
`drone_messages` are created by the packaged route's lazy `ensureDroneSchema`
(`runRuntimeSchemaBootstrap` with owner-RLS via `buildOwnerRlsPolicyStatements`).

## Position for the drone's group (1.3.0)

Where a drone is belongs to the group that owns its location data
([ADR-169](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/169-location-places-and-proximity.md)
D6, slice L6). `GET /state`, `GET /fleet` and `GET /fleet/:droneId/state` return live `position` and
`home` only to a member of the group the drone is enrolled to in Settings, Location (the kernel's
`locatedDevice`, `uses: location`, row-level security deciding); every other caller, including every
viewer of a drone that is not enrolled at all and a service caller asserting a subject, gets both as
`null` with `positionWithheld: true`. Battery, status, heading, speed, the mission progress, the fence
and every command are unchanged. The surface hides a withheld drone's marker and trail and shows
"POSITION WITHHELD" beside its status; its capture thumbnails still draw, without the home-direction tick.

A drone reports its own position to the core device ingest under a location credential a group admin
issues from Settings, Location (`OSHAL_LOCATION_DEVICE_ID` + `OSHAL_LOCATION_TOKEN` on the drone node);
that rail is the kernel's, not this package's, and its heartbeat here is unchanged.

## Family audience view (1.2.1)

The Home shell opens the surface as `/api/drone/app?audience=family` (ADR-164 D6). The shared kit
(`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints the signed-in account's own saved
flight plans in plain words: how many are saved, how many are not flown yet, how many plans were started in the
last five days and how many commands the flight checks turned down (the last two from `GET /home-summary`), a title
that names the account's state, and the latest plans as tiles with their shape (one drone and its stops, drones
flying together, a timed show), where each came from and where it stands. A plan the route marks `flown` reads
"Started": the route writes that flag when a flight starts, not when it finishes. On open it makes exactly two
reads, `GET /missions` and `GET /home-summary`, owner-scoped SELECTs under the caller's session. It never reads
live telemetry, the fleet, the show conductor or the operator chat, never sends a vehicle command, never drafts,
saves, executes or deletes a plan and mounts no connected actions. The one action and the escape open Drone Ops in
the cockpit, where every flight is approved. Signed out, refused, a count the summary could not check, a failed
read, an unreadable answer and an unreachable server are each named. Any other request runs the full page
unchanged; every start step of its main script and its connected-actions script is gated on the kit's decision.

```bash
node --test drone/tests/audience-view.test.cjs
OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs drone
```

The first runs from the store root with no browser: the static kit contract, the view's behaviour over the
package's real `GET /missions` and `GET /home-summary` routes (framework aliases stubbed, a stub pool), and the
gates of both page scripts. The second drives `tests/audience-view.fixture.cjs` over the real page and the real kit
in headless Chromium. The first is registered as the `audience-view` case of the Lab catalog
(`tests/test-lab.yaml`).

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| mission-draft-chat | mission draft chat turn | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
