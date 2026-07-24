# Camera Ops (camera) — OSHAL app package

Remote camera control (?app=camera). Cameras are DEVICE NODES (the drone pattern,
ADR-099): the embedded simulator is always present, and real cameras — GoPro first,
over Open GoPro HTTP — join the fleet via authenticated camera-node heartbeats.
Control is deterministic code (no LLM in the control loop); the **camera-operator**
concierge interprets natural language into ONE validated command, and destructive
ops (delete-all) always require an explicit human confirm (HTTP 428 until
`confirm:true`). Every actuating command is audit-logged under the caller's sub.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (the four route-backed tools + the Camera
  Ops tile), the `/api/camera` routes (surface, fleet/state/events/captures reads,
  the confirm-gated control endpoints, the secret-gated node heartbeat ingest, and
  the concierge `/chat`), the surface (`tools/camera-ops.html`), a package copy of
  the camera-operator persona for the registrar, and the route-boundary spec
  (`tests/camera-routes.spec.ts`, runnable from the package root against a
  framework checkout on the vitest alias path).
- **Stays in the OSHAL kernel:** the camera **engine** (`src/features/camera` —
  CameraService, sim + GoPro + remote providers, fleet plane, command validator),
  the standalone camera **node** (`src/app/camera-node-server.ts`), the
  camera-operator **inline node** (both `swarm-bot-registry` blocks + the
  `ai-lab` persona), and the default Camera Ops tile in `oshal-framework.json`
  (carved apps keep their default tiles).

## Surfaces

| Tile | URL | What |
|---|---|---|
| Camera Ops | `/api/camera/app` | Fleet + live state + control console (self-served by this package) |

## Install

```bash
node scripts/oshal-app.js install camera
```

No migrations — `camera_command_log` is created by the packaged route's lazy
`ensureCameraSchema` (`runRuntimeSchemaBootstrap` with owner-RLS via
`buildOwnerRlsPolicyStatements`).
