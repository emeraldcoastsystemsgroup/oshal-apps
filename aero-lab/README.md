# Aero Lab (aero-lab) — OSHAL app package

Persistent-flight design lab (`?app=aero-lab`). A person shapes a solar-endurance
aircraft with real sliders — span, area, aspect ratio, battery mass, cell
efficiency, buoyancy fraction, site, season — runs it through the **real aerosim
engine** (wing polar, 24 h energy limit cycle, admissibility screen), reads the
verdict with real plots (SOC trace, polar curve, drag buildup, mass closure,
margins), and downloads the physical build package (STL wing panels, DXF ribs
and hull gores, airfoil dat, BOM, build sheet). A design concierge
(`aero-designer`, Form B inline) turns plain language into a design-vector
draft; the deterministic engine is the only source of numbers.

**Worked example — [reference-design/](reference-design/):** "the Floater", a solar
dynastat that closes its 24 h energy loop, exported end-to-end by this package.
9-page report, 3D viewer, STL/DXF/gore CAD, and a BOM with real sourced parts at
~$518. Start at [reference-design/index.html](reference-design/index.html). Its
numbers come from the *ideal* propulsion chain — read the honesty section there
and [BACKLOG.md](BACKLOG.md) §A before quoting any of them.

## Engine provenance

The engine is the **aerosim** persistent-flight simulator: a quasi-steady
trim + RK4 energy integrator over a viscous-panel wing polar
(AeroSandbox/NeuralFoil section data), a mass-closure vehicle builder in which
every element is billed, and a sweep-contract admissibility screen. It survived
a five-round adversarial validation campaign — independent mutation gates,
naked-knob audits, screen-deletion tests, and re-derivation of the published
winner numbers from a clean checkout — before being packaged here. Its
reference pure-solar design (the R7 sweep winner: min SOC 0.4366, usable margin
1.0586) is reproduced by the packaged engine on demand, not quoted from prose —
the live spec re-derives it every run (measured 2026-08-03: min SOC 0.4365,
usable 1.0586, all-up 4.755 kg). The engine's dated test record is retained in
[engine/TEST_STATUS.md](engine/TEST_STATUS.md).

**Buoyant (hybrid) trim is evaluable again, but the historical craft is not
re-certified on the real electrical chain.** The defect was state ownership, not
an overly strict force tolerance: rejected trim probes were each advancing
envelope thermal/permeation time and moving the root underneath the solver. The
vendored engine now advances slow state once per accepted step and retains the
original `1e-8` relative trim tolerance. Measured 2026-08-06, the real
`HYBRID_common` f = 0.2/0.4/0.6/0.8 boundary all converges; f = 0.8 trims at
4.8175 m/s with certified aero, and direct 4.4/4.5 m/s probes certify both
Reynolds brackets. `engine/tests/test_accepted_state_integration.py` pins those
facts. An explicit real builder path now makes BEMT plus motor/ESC/harness and
`PackEcm.step_power` the integrated propulsion/storage authorities, with one
accepted electrical mutation per interval. The recorded FINAL_PRODUCT energy
numbers still come from the named ideal path and have not been relabelled. The
first 72 h DESIGN_A real-chain run remained certified but failed persistence
(`SOC 1.0000 -> 0.9307`), so backlog section A now tracks candidate re-sizing,
full A-D validation and default promotion rather than missing architecture.

Honest caveat that survived the campaign: the
low-Reynolds section data is a surrogate model — XFOIL-class tools are least
trustworthy exactly in this Re ≈ 50 000 regime, so treat single-digit-percent
margins as design guidance, not flight certification.

## What is (and is not) in this package

- **In this package:** the app manifest (six route-backed tools + the Aero Lab
  tile), the `/api/aero-lab` routes (surface, capabilities, polar, evaluate,
  screen, mission, export + per-file download, and the draft-only
  `aero-designer` concierge `/chat`), the surface (`tools/aero-lab.html`), the
  `aero-designer` persona for the registrar, the Python protocol worker + the
  parameterized FINAL_PRODUCT export generator (`engine/`), exact-pinned
  `engine/requirements.txt` + venv setup scripts, the engine container
  (`engine/container/`: Dockerfile, compose file, TCP bridge) and its installer
  `engine/install-engine.sh`, and the route/adapter/container-transport specs
  (`tests/`), and — since 1.3.0 — the vehicle record: `migrations/001-aero-lab.sql`,
  the `/api/aero-lab/vehicles` routes, the force-model envelope data and the
  Floater seed read from `reference-design/` (ADR-160 S4), with its tests
  registered in `tests/test-lab.yaml`.
- **Cross-runtime and export guards:** the three browser input readouts execute a
  dedicated helper parity-tested against `engine/service.py` to `1e-12`, including
  the server's 79.9 m span ceiling. Every newly generated STL must be finite,
  non-degenerate, closed/edge-manifold and free of non-topological triangle
  intersections before the exporter writes it. The production-resolution mesh
  regression sweeps nominal and legal geometry-box corners.
- **Vendored:** a pinned snapshot of the aerosim engine tree (58 modules under
  `engine/aerosim/`, fingerprint `7cb4ddce5d711136`), so the package runs on a
  fresh box with no external checkout. The engine container is built from this
  tree, so a deployed box always answers from the vendored snapshot.
  It is also what a local worker uses by default; `AERO_LAB_ENGINE_DIR` overrides
  it and is the only way to reach a concurrently-developed upstream tree. If no
  engine is reachable, every capability reports `false` and the surface says
  exactly why nothing runs — no fabricated numbers, ever.

  Measured on the vendored snapshot (2026-09-27, `engine/TEST_STATUS.md`): the
  public `evaluate` — still the ideal chain — answers all four presets with real
  physics; `fixedwing` and `r7winner` close (min SOC 0.3600 and 0.4366), `tier1`
  and `hybrid80` do not (both floor at 0.0500). The real-chain certification
  (the engine's `certify` command, `engine/certify_reference.py`) fails all four,
  each for a structured reason from the closed set in `engine/aerosim/validity.py`:
  `tier1` and `hybrid80` `negative_airframe_mass` (the catalogued real parts
  outweigh the all-up mass the vector bills), `fixedwing` `soc_not_persistent`
  (SOC 1.0000 → 0.9318 over 24 h), `r7winner` `param_out_of_bounds` (declared
  cell efficiency 0.2918 outside the C60 diode band [0.2240, 0.2440]).
  ⚠ The concurrently-developed upstream tree (`0a9aaab7ff87f747`) refused all
  four presets when last measured. Since 1.2.1 nothing selects that tree by
  accident — it is reached only through an explicit `AERO_LAB_ENGINE_DIR`.
  The surface always shows the engine fingerprint, so which tree answered is
  never a guess. See [BACKLOG.md](BACKLOG.md) §B.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Aero Lab | `/api/aero-lab/app` | Design sliders + AI draft chat, real engine plots (polar, 24 h SOC, drag buildup, mass closure), verdict card, build-package export (self-served by this package) |

## Install

```bash
node scripts/oshal-app.js install aero-lab
```

No migrations — evaluations are computed on demand and exports live in a
per-run temp dir; this surface owns no tables.

## Engine on a deployed box — the engine container

The oshal api image is Alpine (musl) and casadi (via AeroSandbox) ships glibc-only
wheels, so a deployed box runs the engine in the package's own container, built
locally from upstream sources. After installing or updating aero-lab, run once from
the host (Aero Lab's engine-down banner prints the exact command):

```sh
docker exec <api-container> sh /app/workspace-shared/deployed-apps/aero-lab/engine/install-engine.sh
```

Which transport runs is chosen once, when the api loads the package: a local venv in `engine/.venv` wins over
the container. Since 1.4.1 only this platform's layout counts (`.venv/bin/python` on Linux,
`.venv\Scripts\python.exe` on Windows), so a Windows venv copied onto a Linux box no longer hijacks the
transport and fails every spawn with ENOEXEC (seen on the DGX Spark after the laptop restore). An explicit
`AERO_LAB_ENGINE_ADDR` selects the container regardless.

Details — image contents, licenses, transport, the stale-container guard — are in
[engine/README.md](engine/README.md#engine-container--how-a-deployed-oshal-box-runs-the-engine).

## Local dev setup

1. **Engine checkout.** aero-lab ships one: the vendored snapshot at
   `engine/`, which is what a local worker uses with no configuration. Set
   `AERO_LAB_ENGINE_DIR` only to drive a different aerosim checkout — the
   surface prints the engine fingerprint, so which tree answered is never a
   guess:

   ```
   AERO_LAB_ENGINE_DIR=<path-to-an-aerosim-checkout>
   ```

2. **Dedicated venv.** The engine runs from `<engineDir>/.venv` — never a
   system Python (aerosandbox pins pandas; the box's shared interpreter carries
   unrelated tooling). On a fresh box:

   ```powershell
   # from AERO_LAB_ENGINE_DIR
   & <this-package>/engine/setup-venv.ps1     # py -3.11 venv + pip install -r engine/requirements.txt
   ```

   (`engine/setup-venv.sh` is the POSIX sibling.) Override the interpreter with
   `AERO_LAB_PYTHON` if the venv lives elsewhere. Pins are exact (`==`) because
   a surrogate aero model's numbers are only reproducible against a pinned
   model version.

3. Routes spawn one persistent worker (`engine/aero_lab_worker.py`) lazily on
   first engine call; it idles out after 10 min and restarts on crash/timeout.

## Capability flags (the honesty mechanism)

`GET /api/aero-lab/capabilities` reports what the engine tree can actually do
right now — the surface renders these as chips and the concierge receives them
every turn:

| flag | true when | when false |
|---|---|---|
| `polar` | `aerosim.aeropolar.wing_polar` imports | `/polar` → 503 `capability_unavailable` |
| `evaluate` | `build_solar_cruise` + `integrate_energy` import | `/evaluate` → 503 |
| `screen` | `screen_design` imports | `/screen` → 503 |
| `mission` | `aerosim.mission.runner.fly_mission` imports (in-flight module) | `/mission` → 503 |
| `export` | FP-pattern geometry deps import | `/export` → 503 |
| `hybrid` | `HYBRID_common` + `HYBRID_piecewise` import | any design with `buoyancy_fraction > 0` → 503 (never silently dropped) |
| `certify` | `engine/certify_reference.py` + the screen + the hybrid path import | the engine's `certify` command → `capability_unavailable` (an engine command; no HTTP route calls it yet) |

A reality-upgrade workflow is **concurrently editing** the engine tree (new
`electrochem`, `electrical`, `propeller`, `materials`, `mission` modules), so a
flag flipping false mid-session is expected behavior, not a defect: the worker
feature-detects every module, keeps serving what still imports, and reports the
import error as the reason.

## The Floater as a record (ADR-160 S4)

`reference-design/` is one committed run of `engine/export_build_files.py`, and a folder cannot say
it has gone stale. Since 1.3.0 the Floater is also a **record**: `GET /api/aero-lab/vehicles`,
owner-scoped rows in the package's first migration (`migrations/001-aero-lab.sql`, FORCEd owner RLS).
The right rail of the tile shows it; **Seed the Floater from the reference design** creates the
vehicle from `design_snapshot.json` (the authored design vector) and stores the committed export run
as **evaluation 1** — every artifact hashed, every `verify_*.json` kept, the figures, and the engine
fingerprints (package version, generator, the vendored engine tree's build hash).

- **The stage is computed on every read, never stored.** Today the Floater reads `sized`: evaluation
  1 carries every figure the kind requires at the current vector. Change the vector
  (`PATCH /vehicles/:id/design`) and it reads `concept` until re-evaluated.
- **The mass budget is RED, and that is the point.** `BOM.csv`'s certified ledger is 1998.1 g; the
  as-built ledger in `V2_CONFIG.md` is 2272.4 g: **+274.3 g** that nothing was sized for. The budget
  check blocks `parts-complete` until the vector is re-sized at the real parts and closes.
- **The kind's limits are rows, not prose.** The six sentences of the reference design's "Not true,
  and important" section are limit rows on the kind (five block `built`); a kind that declares none
  is refused at load.
- **Force models declare their envelopes as data** (`src-routes/force-model-envelopes.json`):
  `aeropolar`, `aerosurface` and `solar` are valid in **air only**, each with the reason a refusal
  quotes back (`GET /vehicles/force-models/aeropolar/in/seawater` → 422
  `model_not_valid_in_medium: aeropolar, seawater`). An undeclared model fails closed to air.
- **An evaluation that cannot name its medium and engine is withheld, never listed as a result.**
  And a package that cannot read a real version from its manifest, or has no engine tree to hash,
  does not seed at all: `POST /vehicles/floater/seed` answers 503 `run_unfingerprinted` naming what
  is missing and inserts nothing — the refusal embodied makes for the same condition.

> `fabricable` means the files are complete and self-consistent. It does not mean the machine is
> safe to build, fly or wet. Every surface that renders a stage renders that sentence with it.

## Honest limits (v1.0.0 posture)

Engineering detail behind every item here — with done-when criteria — is in
[BACKLOG.md](BACKLOG.md). The short version: the package ships and runs, and
what is open is engine *certification*, not packaging. Buoyant trim and accepted
thermal/chemistry state run under regression, and the real-drive assembly now has
one BEMT/PV/PackEcm accounting path. Promotion remains red because the measured
72 h real DESIGN_A trajectory does not preserve SOC and cases A-D have not yet
passed on a selected real candidate (BACKLOG §A).

- **`evaluate` is still-air closure; `mission` is the profile path.** `evaluate`
  flies the 24 h quasi-steady limit cycle at the design point. The shipped
  mission runner adds wind, altitude chunks, accepted pack/envelope state and a
  mission ledger. On an explicitly real build, accepted bus intervals go once
  through `PackEcm.step_power` and the mission observes that live SOC/aging
  trajectory; flat replay is ideal-only. The packaged default remains ideal
  until a real candidate passes the promotion gate in BACKLOG §A.
- **The engine runs outside the api process.** With no reachable engine — no local
  venv and no engine container (or one built from a different engine tree) — every
  capability is false and the surface says why, with the install command.
- **No export is a certified build.** The build package reproduces the
  validated FINAL_PRODUCT set (wing/panel STLs, rib + gore DXF, airfoil
  dat/template, BOM, build sheet), and every export now carries a
  `buildCertification` block (in `design_snapshot.json` and `BUILD_SHEET.md`)
  that reads **not certified** and lists the evidence the design needs: a vented
  relief or rated superpressure structure (pressure), the ledger's film at its
  density and permeability (material), helium at ≥ 99.995 % (purity), and every
  ledger line weighed within its band (mass). `engine/build_certification.py`
  `reconcile_build_evidence()` is the only path to certified; the vent/ballonet
  itself is not yet a generated or billed part (BACKLOG §C).
- **Low-Re surrogate caveat** (from the validation campaign): section polars at
  Re ≈ 50 000 come from a surrogate model; thin margins deserve skepticism.
- **Browser arithmetic is display-only and parity-guarded.** Span, mean chord and
  pack capacity are computed from the user's inputs in both runtimes and compared
  on shared vectors; polar, energy, mass closure and verdicts still come only from
  the engine.
- Determinism: same design vector in → same numbers out; no RNG, no wall-clock
  in results.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **544 / 2176 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| aero-design-draft | design draft chat turn | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
