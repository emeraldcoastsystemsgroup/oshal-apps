# Ocean Lab

An ambient-energy design lab. Model a machine that moves on flow it does not carry — tidal and
current harvest, soil-thermal harvest — size the rotor that feeds it, and export printable geometry.

Two surfaces:

- **Harvest Console** (`/api/ocean-lab/harvest-console`) — marine and ground energy budgets over
  time, seasonal gap analysis, storage sizing.
- **Blade Studio** (`/api/ocean-lab/blade-studio`) — NACA sections, panel-method polars, Cp sweeps,
  and STL / OBJ / OpenSCAD / DXF export of the lofted blade.

## Provenance — read this before quoting a number

Every site, soil profile and tidal constituent set in this app is an **illustrative parameter set
over a real model**. None of it is survey data or harmonic constants for a real station. **No
hardware was built.** The models are honest; the inputs are examples.

The design study behind this package — including its "What is not true" section, which lists what
the models do not cover — is in the core repo at
`docs/research/autonomous-explorer-design-study.md`.

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

Two results the app enforces rather than merely reports:

- **An annual energy surplus is not survival.** A design can harvest 1.96× the energy it spends
  across a year and still be dead for 600 hours of it, because the surplus arrives in the wrong
  season and the store cannot bridge. Read `longestGapHours` and `minSocFraction`, never the margin
  ratio alone.
- **Betz is a hard ceiling.** A returned Cp above 0.5926 is a bug, not a result.

## Layout

```
oshal-app.yaml          manifest — one mounted factory, two ribbon surfaces, seven tools
src-routes/             TypeScript sources
  ocean-lab-routes.ts   the mounted factory; composes both halves, serves the surfaces
  harvest-routes.ts     GET /harvest/sites, POST /harvest/simulate
  rotor-routes.ts       POST /rotor/{solve,cp-curve,export,harvest}
  surface-files.ts      bundled-asset resolution (ctx.appPackageDir)
  engine/               the physics — energy, geometry, marine, ground, rotor-design
routes/                 compiled CommonJS (committed; the manifest points here)
tools/                  the two bundled surfaces and their engine scripts
tests/                  350 specs
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

350 specs across nine files. The load-bearing ones:

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
