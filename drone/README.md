# Drone Ops (drone) — OSHAL app package

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
