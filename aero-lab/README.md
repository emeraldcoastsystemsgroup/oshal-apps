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
usable 1.0586, all-up 4.755 kg). The current cleanup's 314-test engine record
and 44-test app-suite follow-on are retained in
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
  `engine/requirements.txt` + venv setup scripts, and the route/adapter specs
  (`tests/`).
- **Cross-runtime and export guards:** the three browser input readouts execute a
  dedicated helper parity-tested against `engine/service.py` to `1e-12`, including
  the server's 79.9 m span ceiling. Every newly generated STL must be finite,
  non-degenerate, closed/edge-manifold and free of non-topological triangle
  intersections before the exporter writes it. The production-resolution mesh
  regression sweeps nominal and legal geometry-box corners.
- **Vendored:** a pinned snapshot of the aerosim engine tree (58 modules under
  `engine/aerosim/`, fingerprint `603cf4c5e8d9e4c9`), so the package runs on a
  fresh box with no external checkout. `AERO_LAB_ENGINE_DIR` still overrides it
  and points at a concurrently-developed upstream tree when set. If neither
  resolves, every capability reports `false` and the surface says exactly why
  nothing runs — no fabricated numbers, ever.

  ⚠ The two trees currently **disagree**: the vendored snapshot runs 3 of 4
  presets and reproduces the recorded numbers; the live upstream tree
  (`0a9aaab7ff87f747`) refuses all four. The surface always shows the engine
  fingerprint, so which tree answered is never a guess. See
  [BACKLOG.md](BACKLOG.md) §B.

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

## Local dev setup

1. **Engine checkout.** aero-lab REQUIRES an aerosim tree. Point
   `AERO_LAB_ENGINE_DIR` at it; the documented default on this box is the
   session scratchpad:

   ```
   AERO_LAB_ENGINE_DIR=C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim
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

A reality-upgrade workflow is **concurrently editing** the engine tree (new
`electrochem`, `electrical`, `propeller`, `materials`, `mission` modules), so a
flag flipping false mid-session is expected behavior, not a defect: the worker
feature-detects every module, keeps serving what still imports, and reports the
import error as the reason.

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
- **The engine tree is external.** No checkout at `AERO_LAB_ENGINE_DIR` means
  every capability is false and the surface says so. That is the shipped
  posture, not an error state.
- **Export vent part pending.** The build package reproduces the validated
  FINAL_PRODUCT set (wing/panel STLs, rib + gore DXF, airfoil dat/template,
  BOM, build sheet); the hybrid envelope's vent fitting is not yet a generated
  part — it appears on the BOM as a sourced item.
- **Low-Re surrogate caveat** (from the validation campaign): section polars at
  Re ≈ 50 000 come from a surrogate model; thin margins deserve skepticism.
- **Browser arithmetic is display-only and parity-guarded.** Span, mean chord and
  pack capacity are computed from the user's inputs in both runtimes and compared
  on shared vectors; polar, energy, mass closure and verdicts still come only from
  the engine.
- Determinism: same design vector in → same numbers out; no RNG, no wall-clock
  in results.
