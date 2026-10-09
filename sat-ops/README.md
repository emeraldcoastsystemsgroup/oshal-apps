# Sat Ops (sat-ops) — OSHAL app package

1.2.2 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Satellite fleet plane (?app=sat-ops, ADR-102). Satellites are SWARM NODES (the
drone pattern): each sat node runs its ADCS locally — MEKF estimation, the
SAFE/DETUMBLE/SLEW/POINT/DESAT mode manager, magnetorquer desat — against a
simulator engine (the in-process RK4 gyrostat or the NASA 42 referee) and joins
the fleet via authenticated heartbeats. Orbit identity (TLE catalog, SGP4 ground
tracks, pass windows, pairwise conjunction screening) is decoupled from the
attitude nodes; the fleet plane joins the two views by satId. Safety doctrine:
EVERY engine is a simulator — commands cannot reach real hardware by
construction — and every command still passes the operator approve gate.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (the eight route-backed tools + the Sat
  Ops tile), the `/api/sat` routes (surface, secret-gated heartbeat ingest, fleet
  listing, the approval-gated point/mode command dial, SGP4 passes/track/
  conjunctions, TLE catalog CRUD, and the draft-only sat-operator concierge
  `/chat`), the surface (`tools/sat-ops.html`), a package copy of the
  sat-operator persona for the registrar, the route-boundary specs
  (`tests/sat-ops-pass-routes.spec.ts`, `tests/sat-ops-node-fleet.spec.ts`,
  `tests/sat-orbit-w3-routes.spec.ts` — runnable from the package root against a
  framework checkout on the vitest alias path), and the W2 NASA-42 live-mission
  proof harness (`scripts/sat-ops-42-w2-mission.ts`, same requirement).
- **Stays in the OSHAL kernel:** the sat **engine** (`src/features/sat-ops` —
  SatFleet, TleCatalog, SGP4 services, RK4 + NASA 42 adapters, MEKF, ADCS mode
  manager + desat, and its engine specs incl. the SatFleet liveness case), the
  standalone sat **node** (`src/app/sat-node-server.ts`), the engine smoke
  scripts + the scored ADCS evidence campaign
  (`scripts/evidence/prove-sat-ops-campaign.ts` — engine-only), the sat-operator
  **inline node** (both `swarm-bot-registry` blocks + the `ai-lab` persona), and
  the default Sat Ops tile in `oshal-framework.json`.

The packaged route serves the SAME `/api/sat` paths the kernel mount did, so live
evidence probes against the surface remain valid once the package is installed.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Sat Ops | `/api/sat/app` | 3D orbit console + fleet telemetry + approval-gated command console (self-served by this package) |

## Company audience view (Business shell)

The Business shell opens `/api/sat/app?audience=company` (ADR-164 D6). The page then paints, through the shared
audience-view kit, the simulated fleet and the orbit catalog instead of the console: four stats (sim nodes, recent
and stale heartbeats, orbits loaded), a title naming the fleet's state, a fleet table of each node's last report
(engine, heartbeat, ADCS mode, pointing error, wheel momentum, last heard; recent nodes first) and the TLE catalog
joined to its attitude nodes by sat id (newest registration first), with one action and the kit's escape, both
opening Sat Ops in the cockpit.

On open the view makes exactly two reads, `GET /api/sat/fleet` and `GET /api/sat/catalog`, the same in-memory
listings the full page reads on boot. It never computes a ground track, a pass window or a conjunction screen,
never asks the sat-operator concierge, never registers or removes a TLE, never sends a node command and mounts no
connected actions. Signed out, refused, a catalog that could not be read (the fleet still shows), the fleet route's
failure, an unreadable answer and an unreachable server each read as what they are. Every top-level start step of
the full page (its wiring, the boot with its fleet poll, track computation and render loop, and the
connected-actions script) runs only without an audience view; any other request runs the full page unchanged.

Tests: `node --test sat-ops/tests/audience-view.test.cjs` (static contract plus behaviour over the package's real
fleet and catalog routes and the gated start), and
`OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs sat-ops` (headless Chromium over the real
page and the real kit, fixture `tests/audience-view.fixture.cjs`). The first is the `audience-view` case of the
Test Lab catalog `tests/test-lab.yaml`.

## Install

```bash
node scripts/oshal-app.js install sat-ops
```

No migrations — the fleet plane and TLE catalog are in-memory (heartbeat-fed);
this surface owns no tables.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| sat-command-draft | command draft chat turn | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
