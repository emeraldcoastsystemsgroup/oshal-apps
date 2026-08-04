# aero-lab engine

The validated **aerosim** persistent-flight simulator, packaged as the
compute worker behind `/api/aero-lab`. The simulator survived a 5-round
adversarial validation campaign; this directory wraps it — it never
re-implements physics.

## Layout

| path | what |
|---|---|
| `service.py` | the JSON-lines stdio worker (BUILD_CONTRACT §5): `capabilities` / `polar` / `evaluate` / `screen` / `export` / `mission` |
| `aero_lab_worker.py` | the frozen spawn target the Node adapter runs; delegates to `service.py` |
| `export_build_files.py` | FINAL_PRODUCT generation (FP_01..FP_05 pattern) parameterized on the evaluated design — STL / DXF / airfoil.dat / BOM / build sheet |
| `aerosim/` | **vendored engine tree** (snapshot of the validated package) |
| `tests/` | the engine's own pytest suite (vendored with it) |
| `HYBRID_common.py`, `HYBRID_piecewise.py` | the hybrid-buoyancy study machinery (envelope sizing; the `hybrid` capability flag) |
| `requirements.txt` | exact top-level pins the validation ran on |
| `requirements-lock.txt` | full `pip freeze` of the validation interpreter |
| `setup-venv.ps1` / `setup-venv.sh` | rebuild the dedicated venv on a fresh box |

## Engine-dir contract

The worker resolves the aerosim tree in this order:

1. `AERO_LAB_ENGINE_DIR` (env) — set by the Node adapter;
2. the documented dev-box scratchpad
   `C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim`
   (the live tree a concurrent reality-upgrade workflow edits);
3. **this directory** — the vendored snapshot, so a fresh clone still runs.

Python resolves as `AERO_LAB_PYTHON`, else `<engineDir>/.venv/Scripts/python.exe`
(win32) / `<engineDir>/.venv/bin/python`. Never a system python — the pins are
part of the model.

Fresh box: `powershell -File setup-venv.ps1` (or `bash setup-venv.sh`), then
point `AERO_LAB_ENGINE_DIR` at this directory.

## Honesty posture

Every module is **feature-detected** at load: modules the concurrent
reality-upgrade workflow is still landing (`mission`, `materials`,
`electrochem`, …) report `false` in `capabilities` and their commands return
`capability_unavailable` — never fabricated numbers. A broken/mid-edit tree
degrades to an honest capabilities report; the worker does not crash.

`capabilities` also reports `engineFingerprint` (sha256 over the four stable
entry-point modules) so any result can be traced to the exact engine build.

**Hybrid designs** (`buoyancy_fraction > 0`) fly the shipped in-sim path: a
spherical `BuoyancyVolume` sized by the HYBRID_common fixed point, with the
wing re-trimmed at the residual weight. The engine's quasi-steady trim
frequently REFUSES hybrid design points (its 1e-8-relative residual tolerance
vs the buoyancy element's force floor) — that refusal comes back verbatim as
`inadmissible_input` (HTTP 422), which is the honest answer. The study's
streamlined-hull piecewise closure (`HYBRID_piecewise`, how the validated
f=0.80 craft closed) is not yet exposed through the wire.

## Determinism

Same design in → same numbers out. No RNG, no wall-clock in results. The
evaluate chain is byte-for-byte the validated sweep chain (R6/R7):
`to_design → build_solar_cruise → integrate_energy (24 h, 60 s) →
usable_energy → screen_design`. The R7 winner vector reproduces
`min_soc 0.4366 / usable 1.0586` through `service.py` (verified at packaging).

## Smoke test

```bash
cd engine
echo '{"id":"1","cmd":"capabilities"}' | <venv-python> aero_lab_worker.py
```
