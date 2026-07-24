# Sat Ops (sat-ops) — OSHAL app package

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

## Install

```bash
node scripts/oshal-app.js install sat-ops
```

No migrations — the fleet plane and TLE catalog are in-memory (heartbeat-fed);
this surface owns no tables.
