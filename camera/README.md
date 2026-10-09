# Camera Ops (camera) — OSHAL app package

1.1.2 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

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

## 1.1.1 — the family view for the Home shell

The Jarvis Home shell opens Camera Ops on its first surface, `tools/camera-ops.html` at `/api/camera/app`, with
`?audience=family`. The page then answers with a household view painted by the shared kit (ADR-164 D6) in the family
grammar, from reads the full page already makes under the caller's session:

- `GET /api/camera/fleet`: the cameras, each with its state in plain words (ready, recording and for how long, busy,
  link closed, offline and when it was last seen, no reading), its battery and capture mode; simulated cameras are
  named as practice cameras. The stats cameras online (with how many are offline) and recording now.
- `GET /api/camera/captures?cameraId=<id>&since=0` for each online camera, at most six: the photos and videos the
  cameras reported since Camera Ops last started, newest first, with the video length, the file name on the camera and
  which camera took it. No thumbnail is loaded (a thumbnail URL can address the camera node itself).
- `GET /api/camera/home-summary`: the latest logged commands in plain words (what was asked) with Accepted or Refused,
  and the commands-in-24-hours stat. Accepted is named as the camera taking the command, not as proof a photo or video
  was made.

On open the view makes only those reads. It never sends a camera command, a concierge turn or a node heartbeat, never
reads a camera's state or event log, never starts the live preview or the laptop camera, never loads a feed or
thumbnail from a camera and never fetches the connected-actions offers; nothing in it links out, and its one action and
the escape open Camera Ops in the cockpit. A captures read or the command log failing on its own is named while the
cameras still show; signed out (401), refused (403 on any read), a 5xx, a failure with its own error and a non-JSON
failure each read as what they are. Without `?audience=family` the full Camera Ops page runs unchanged: its main script
(controls, laptop camera, polling) and its connected-actions script start only when no audience view renders.

Tests: `node --test tests/audience-view.test.cjs` (static contract plus behaviour against a stub kit and a stub fetch,
and both page scripts against stubs); `tests/audience-view.fixture.cjs` for the store's
`scripts/audience-views.browser.cjs` (headless Chromium over the real page and kit). The Test Lab case `audience-view`
is registered in `tests/test-lab.yaml`.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| camera-nl-control | camera instruction | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
