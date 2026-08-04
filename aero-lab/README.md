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
usable 1.0586, all-up 4.755 kg).

**The buoyant (hybrid) designs are a different story, and the package says so.**
The recorded FINAL_PRODUCT craft at 47.6 N day 195 (min SOC 0.050) was produced
by an earlier engine revision. On the tree vendored here — and on the live
upstream checkout, and through the study's own `HYBRID_common.run_hybrid` path —
the quasi-steady trim no longer converges once a `BuoyancyVolume` is attached:
every buoyant design returns a hard `TrimConvergenceError`. The `hybrid`
capability flag reports that the machinery **imports**, not that a buoyant design
closes. Pressing Run on the hybrid preset shows the engine's own refusal; the
recorded numbers are history, not a prediction this build reproduces. See
`tests/aero-live-engine.spec.ts` — the guard prints the outcome either way and
will tell you the day the buoyant chain closes again.

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
what is open is engine *certification*, not packaging. The real-drive gate is
currently red, and the certified buoyant craft cannot be evaluated by the main
engine until the trim tolerance in BACKLOG §A2 is fixed.

- **Still-air closure, not mission simulation.** `evaluate` flies the 24 h
  quasi-steady limit cycle at the design point — no wind field, no weather, no
  climb/descent profile. The multi-day `mission` route is capability-gated off
  until the in-flight mission module lands in the engine tree.
- **The engine tree is external.** No checkout at `AERO_LAB_ENGINE_DIR` means
  every capability is false and the surface says so. That is the shipped
  posture, not an error state.
- **Export vent part pending.** The build package reproduces the validated
  FINAL_PRODUCT set (wing/panel STLs, rib + gore DXF, airfoil dat/template,
  BOM, build sheet); the hybrid envelope's vent fitting is not yet a generated
  part — it appears on the BOM as a sourced item.
- **Low-Re surrogate caveat** (from the validation campaign): section polars at
  Re ≈ 50 000 come from a surrogate model; thin margins deserve skepticism.
- Determinism: same design vector in → same numbers out; no RNG, no wall-clock
  in results.
