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
| `export_build_files.py` | FINAL_PRODUCT generation (FP_01..FP_05 pattern) parameterized on the evaluated design — STL / DXF / airfoil.dat / BOM / build sheet; STLs fail closed on degeneracy, edge topology or triangle self-intersection |
| `aerosim/` | **vendored engine tree** (snapshot of the validated package) |
| `tests/` | the engine's own pytest suite (vendored with it) |
| `HYBRID_common.py`, `HYBRID_piecewise.py` | the hybrid-buoyancy study machinery (envelope sizing; the `hybrid` capability flag) |
| `requirements.txt` | exact top-level pins the validation ran on |
| `requirements-lock.txt` | full `pip freeze` of the validation interpreter |
| `setup-venv.ps1` / `setup-venv.sh` | rebuild the dedicated venv on a dev box (Windows / glibc Python) |
| `container/` | the engine container: `Dockerfile`, `compose.yaml`, and `aero_engine_bridge.py` (the TCP front) |
| `install-engine.sh` | build + start the engine container on a box running the oshal stack, then self-test it |
| `.dockerignore` | whitelist of exactly what the image bakes in |

## Engine container — how a deployed oshal box runs the engine

The oshal api image is Alpine (musl). casadi 3.7.2, which AeroSandbox imports,
publishes glibc-only wheels, so no engine venv can be built in the api container.
The package therefore runs the engine in its own container:

- **Install** (from the host of the box; the package is deployed inside the api
  container, which has the docker CLI):

  ```sh
  docker exec <api-container> sh /app/workspace-shared/deployed-apps/aero-lab/engine/install-engine.sh
  ```

  Aero Lab's engine-down banner prints this command with the real container id.
  The script builds `oshal-aero-lab-engine:local` from `container/Dockerfile`,
  starts it on the stack network (compose project `oshal-aero-lab-engine`, alias
  `aero-lab-engine`, no host port, read-only root, all capabilities dropped), and
  flies the R7 default design once as an acceptance self-test.
- **Built locally, from upstream, every time.** The image starts from the official
  `python:3.11-slim-bookworm` image and installs `requirements.txt` constrained by
  `requirements-lock.txt` from PyPI. Nothing third-party is committed to this package
  and the image is never published. License metadata PyPI publishes for the pinned
  versions: AeroSandbox and NeuralFoil MIT, casadi LGPL-3.0-or-later, numpy / scipy /
  pandas BSD, matplotlib PSF-based, the remaining transitive packages MIT / BSD /
  Apache-2.0 / MPL-2.0.
- **Transport.** With no explicit local engine config and no local venv, the Node
  adapter connects to `AERO_LAB_ENGINE_ADDR` (default `aero-lab-engine:7411`). One
  connection owns one worker process inside the container, so timeouts, kill/restart
  and the idle shutdown behave exactly as with a local worker. Export files come back
  inline and are written to the api-side workDir the download route reads.
- **Stale-container guard.** The bridge's first line names the build hash of the
  engine tree baked into the image; the adapter hashes this package's engine tree
  and refuses (capability_unavailable, with the install command) when they differ.
  After an aero-lab update that changes the engine, re-run the install script.

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

Dev box with a Windows or glibc Python: `powershell -File setup-venv.ps1` (or
`bash setup-venv.sh`), then point `AERO_LAB_ENGINE_DIR` at this directory. A deployed
oshal box uses the engine container above instead.

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
wing re-trimmed at the residual weight. Rejected trim probes are state-pure;
envelope and pack slow state advance exactly once per accepted step, and the
unchanged `1e-8` relative trim tolerance now converges for the f = 0.2/0.4/0.6/0.8
regression boundary. The explicit `build_solar_cruise(..., chain="real")` path
now composes BEMT, motor/ESC/harness, diode PV/MPPT/harness and one real pack;
accepted storage intervals reach `PackEcm.step_power` exactly once. Promotion is
still open because the certified 72 h DESIGN_A real-chain probe lost SOC
(`1.0000 -> 0.9307`) and the full A-D gate has not passed. That measured
candidate work remains in `../BACKLOG.md` section A.

## Determinism

Same design in → same numbers out. No RNG, no wall-clock in results. The
packaged evaluate default remains the explicitly ideal, byte-for-byte validated
sweep chain (R6/R7) until a real candidate earns promotion:
`to_design → build_solar_cruise → integrate_energy (24 h, 60 s) →
usable_energy → screen_design`. The R7 winner vector reproduces
`min_soc 0.4366 / usable 1.0586` through `service.py` (verified at packaging).

## Smoke test

```bash
cd engine
echo '{"id":"1","cmd":"capabilities"}' | <venv-python> aero_lab_worker.py
```

Engine container (the same acceptance flight `install-engine.sh` ends with):

```sh
docker exec oshal-aero-lab-engine python /opt/aero-lab/engine/container/aero_engine_bridge.py --selftest
```
