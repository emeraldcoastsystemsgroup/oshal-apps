# Ocean Lab

1.3.1 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

An ambient-energy design lab. Model a machine that moves on flow it does not carry — tidal and
current harvest, soil-thermal harvest — size the rotor that feeds it, and export printable geometry.

Three surfaces:

- **Harvest Console** (`/api/ocean-lab/harvest-console`) — marine and ground energy budgets over
  time, seasonal gap analysis, storage sizing.
- **Blade Studio** (`/api/ocean-lab/blade-studio`) — NACA sections, panel-method polars, Cp sweeps,
  and STL / OBJ / OpenSCAD / DXF export of the lofted blade.
- **Explorer** (`/api/ocean-lab/explorer`, 1.2.0, ADR-160 S2) — the design study's 300 mm wave
  explorer as a saved vehicle. Change the wing stop angle or the tether length, save, evaluate: the
  five-row sea-state table, the occurrence-weighted mean, km/day and km/year recompute from the
  design vector, and the stage (computed on every read, never stored) drops to `concept` the moment
  the vector changes. The eight "What is not true" limits are rows on the record, and every run —
  this lab's evaluations and an embodied hull drop posted as data — carries its medium id and engine
  fingerprints or is not displayed. `fabricable` means the files are complete and self-consistent;
  it does not mean the machine is safe to build, fly or wet.

  Since 1.3.0 (ADR-160 S3) the Explorer also shows the vehicle's **parts**, derived from the vector on
  every read and never stored: the float, the sub body, the wings, the rudder, the three spindle
  blades and the tether, eleven watertight parts, each a CAD Studio program (a base plus a feature
  list in CAD Studio's contract) scaled from the report's drawings, with **Open in CAD Studio**
  per part. Each part carries the ADR-160 D8 portable object: identity and provenance, the program,
  mass properties with their provenance, a named attachment frame in CAD Studio's world frame, and
  the force model's declared medium requirements. The bought rows come from the report's bill of
  materials, and their masses and prices stay **not published**: the report withheld costs on
  purpose and published no masses. So the **displacement budget**, the gate on `parts-complete`,
  stays OPEN and names every unknown instead of reading one as zero. With real rows it would sum
  each body in the sizing's medium, trim the sub with derived ballast, require the float to carry
  its load, and recompute the sizing at the displacement the parts demand. It goes red when that
  sizing falls below the recorded one. `GET /api/ocean-lab/vehicles/:id/design.md` is the
  generated design document.

## Provenance — read this before quoting a number

Every site, soil profile and tidal constituent set in this app is an **illustrative parameter set
over a real model**. None of it is survey data or harmonic constants for a real station. **No
hardware was built.** The models are honest; the inputs are examples.

The design study behind this package — including its "What is not true" section, which lists what
the models do not cover — is in the core repo at
`docs/research/autonomous-explorer-design-study.md`.

The Explorer's seed (`src-routes/engine/vehicle/explorer-seed.json`) marks every input as
**published**, **reconstructed** or **assumed**, with its basis. The study never published its
sea-state periods or occurrence mix: the seed's periods were solved once against this engine
(wave-propulsion 1.0.0) so that it reproduces the study's published table, and the occurrences
satisfy every published constraint (8 % rough, 70 % flat-to-light, 65 % under way, 0.46 knots).
`tests/engine-explorer-regression.test.js` therefore guards the engine against drift from that
version; it is not an independent validation of the study.

## What is actually modelled

| | |
|---|---|
| Tidal current | Sum of astronomical harmonic constituents (M2, S2, N2, K1 …). The spring/neap beat is not a parameter — it emerges from M2 and S2 drifting in and out of phase at 14.77 days. |
| Turbine harvest | `½ρAv³·Cp·η`, cut-in and rated limits applied per timestep. Mean harvested power is `4/(3π) ≈ 42.4%` of peak-speed power, not the power at mean speed. |
| Soil thermal | `T(z,t) = T̄ + A·e^(−z/d)·cos(ωt − z/d)`, damping depth `d = √(2α/ω)`. At α = 0.5×10⁻⁶ m²/s: 2.241 m annual, 0.117 m diurnal. |
| Thermoelectric | Thermal-resistance network with maximum-power matching at `R_teg = R_soil`. Heat **flow** is what converts, not ΔT — which is why shallow junction pairs beat deep ones by ~3.5×. |
| Section polar | Hess-Smith constant-strength vortex panel method, `Cl(α) = A·cosα + B·sinα`, Viterna post-stall extension. Reproduces thin-airfoil theory: lift slope → 2π/rad. |
| Rotor | Blade-element momentum theory with Prandtl **tip and hub** loss and the Glauert/Buhl high-induction correction. An ideal rotor peaks at Cp = 0.5776 against the Betz limit 16/27 = 0.5926 — approached from below, never crossed. |
| Geometry | Section lofting to a watertight triangle mesh, ear-clipping for concave caps, full validation (edge census, Euler χ, winding consistency, degenerate detection). |
| Wave propulsion | Written from the ambient-energy vessel report's governing math (no copy of the original engine existed in any repository): heave `w = A·ω·cos(ωt)`, `w_max = πH/T`; thrust `T = ½ρV²S[C_L(α)sinθ − C_D(α)cosθ]` with `α = max(0, θ − β_stop)`; the vertical balance `n·F_z ≤ B_float − W_sub` up and `≤ W_sub` down; Theodorsen's lift deficiency by R.T. Jones; the ITTC-57 friction closure; and the kinematic ceiling `U_max = w_heave / tan(β_stop)`. C_L and C_D are the section polar above; ρ, ν and g come from the medium. |
| Media | ADR-160 D7: the three committed medium rows (vacuum, air, seawater) carried as data and pinned to embodied's row by `scripts/check-adr160-contract.mjs`; this lab implements seawater with a free surface. Air is refused by name (`medium_property_unavailable: freeSurface`), vacuum by the model's envelope (`model_not_valid_in_medium`), and an undeclared model fails closed. |

Two results the app enforces rather than merely reports:

- **An annual energy surplus is not survival.** A design can harvest 1.96× the energy it spends
  across a year and still be dead for 600 hours of it, because the surplus arrives in the wrong
  season and the store cannot bridge. Read `longestGapHours` and `minSocFraction`, never the margin
  ratio alone.
- **Betz is a hard ceiling.** A returned Cp above 0.5926 is a bug, not a result.

## Layout

```
oshal-app.yaml          manifest — one mounted factory, three ribbon surfaces, seven tools
migrations/             001-ocean-lab.sql — vehicle, limit and run tables, FORCEd owner RLS
src-routes/             TypeScript sources
  ocean-lab-routes.ts   the mounted factory; composes every half, serves the surfaces
  harvest-routes.ts     GET /harvest/sites, POST /harvest/simulate
  rotor-routes.ts       POST /rotor/{solve,cp-curve,export,harvest}
  vehicle-routes.ts     /vehicles — kinds, seed, record, design, evaluate, run ingest, delete
  vehicle-store.ts      the owner-scoped SQL behind the record
  surface-files.ts      bundled-asset resolution (ctx.appPackageDir)
  engine/               the physics — energy, geometry, marine, ground, rotor-design, wave,
                        and the vehicle record (kind, limits, seed, stage, run fingerprints)
routes/                 compiled CommonJS (committed; the manifest points here)
tools/                  the three bundled surfaces and their engine scripts
tests/                  the package suites; tests/test-lab.yaml registers them with the Test Lab
```

The engine is **bundled**. The only core module this package imports is `@/shared/logger`, resolved
by the framework loader at runtime — a guard in `tests/surface-reachability.spec.ts` asserts that
the compiled output reaches for nothing else.

## Build

```bash
cd c:/Projects/oshal
node scripts/oshal-app.js build ../oshal-apps/ocean-lab
```

or directly:

```bash
npx tsc -p c:/Projects/oshal-apps/ocean-lab/src-routes/tsconfig.json
```

`@/` aliases are left intact in the output on purpose — the oshal loader resolves them at runtime
(BUILDING-EXTENSIONS §5).

## Test

```bash
cd c:/Projects/oshal-apps/ocean-lab
c:/Projects/oshal/node_modules/.bin/vitest run --config tests/vitest.config.ts
```

The Explorer's plain-node engine suites run in the store gate with no install:

```bash
node --test "tests/engine-*.test.js"
```

The framework-coupled ones need a core checkout (`OSHAL_CORE_DIR`): `tests/vehicle-routes.spec.ts`
(the record over loopback HTTP), `tests/vehicle-rls.spec.ts` (owner RLS on a real disposable
PostgreSQL; needs Docker) and `tests/explorer-surface.spec.mjs` (the tile in headless Chromium, run
with `node --test`). `tests/vehicle-parts-routes.spec.ts` covers the parts routes and drives the parts
acceptance script against a CAD Studio double. `tests/explorer-parts-occt.spec.mjs` builds all six part
programs through CAD Studio's own engine image (needs Docker and `oshal-cad-studio-engine:local`). After install, `tests/explorer-live-acceptance.mjs`
walks the installed Explorer, and `tests/explorer-parts-live-acceptance.mjs` builds every part through
CAD Studio's real OCCT kernel. Both run as the operator automation identity and delete what they
created. The load-bearing older ones:

- `surface-reachability.spec.ts` — **derives** its assertion set by parsing the shipped surfaces for
  every `/api/ocean-lab/...` path they reference, then proves each is routable. A surface that
  starts fetching a new endpoint fails this until the route exists. Also asserts the manifest's
  `requiresAuth: true`, which is the real production guard.
- `rotor-bemt.spec.ts` — Betz is never crossed across 24 tip-speed ratios.
- `geometry-mesh-export.spec.ts` — every exported part: 0 open edges, 0 non-manifold, 0 degenerate
  facets, Euler χ = 2, and a binary STL byte length of exactly `84 + 50 × nTriangles`.
- `energy-budget.spec.ts` — the seasonal-gap verdict, including the float-equality defect that once
  reported an over-provisioned pack as non-perpetual.

## Install

```bash
cd c:/Projects/oshal
node scripts/oshal-app.js install ocean-lab
curl -X POST http://localhost:35457/api/swarm/apps/load \
  -H 'content-type: application/json' \
  -d '{"path":"deployed-apps/ocean-lab/oshal-app.yaml"}'
```

Then open `/cockpit/?app=ocean-lab`.

## Company audience view (1.2.1)

The Business shells open the application's first surface as
`/api/ocean-lab/harvest-console?audience=company` (ADR-164 D6). The shared kit
(`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints the signed-in account's
saved Explorer vehicles instead of the console:

- **Stats:** saved vehicles, sized at the current vector, at concept (not evaluated at the current
  vector) and the illustrative sites and soils the console sizes against. When the route's list is
  full (it lists the newest 50) the counts say so.
- **Saved vehicles** table, newest first: name, the stage computed from the design vector on the read,
  the run that sized it, open limits (and how many block `built`), and the last update. The
  fabricable sentence is rendered whole beside it.
- **Site catalogue:** the illustrative marine sites and soils with the route's own provenance note.
- The kit's escape, "Open Ocean Lab in the cockpit". The view has no other action.

On open it makes two plain reads: `GET /api/ocean-lab/vehicles` (owner-scoped SELECTs; the stage is
computed on the read and never stored) and `GET /api/ocean-lab/harvest/sites` (a fixed catalogue).
The Harvest Console and Blade Studio store nothing, so the view shows no harvest result and runs no
simulation: the engine loader does not load the console script (no in-browser model, no server
cross-check), and the connected-actions script imports and mounts nothing. It never solves, evaluates,
seeds or deletes. Signed out, refused, a deployment without the record store, the route's own failure,
an unreadable answer, an unreachable server and an unreadable site catalogue are each named for what
they are. Any request without the parameter, or on a core without the kit, runs the full console.

Tests: `node --test tests/audience-view.test.cjs` (static contract plus behaviour over the package's
real `GET /vehicles` and `GET /sites` routes, loaded with only express and `@/shared/logger` stubbed;
both start-path gates). `tests/audience-view.fixture.cjs` drives the view in headless Chromium through
`scripts/audience-views.browser.cjs ocean-lab` at the store root.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
