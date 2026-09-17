# aero-lab — BACKLOG

Open work on the packaged persistent-flight design lab. Every entry has a done-when so scope does
not have to be guessed later.

**Posture:** the package ships and runs. What is open is engine *certification*, not packaging.
The v1.0.0 honest-limits section in [README.md](README.md) is the user-facing version of this list;
this file is the engineering detail behind it.

---

## A. Promote a passing real-drive validation candidate

The assembly/authority implementation is no longer in this queue. `build_solar_cruise` now has an
explicit `chain="ideal"|"real"` seam; the real choice composes diode PV/MPPT/harness, BEMT,
motor/ESC/harness, one catalogued-cell `PackEcm`, and its billed auxiliary loads. Accepted bus
intervals reach that pack exactly once through `BatteryElement.step -> PackEcm.step_power` in both
integrators and the mission runner observes that trajectory without flat-efficiency replay.
Executable evidence and the measured commands moved to `engine/TEST_STATUS.md` and
`engine/tests/test_real_drive_authority.py`.

What remains open is candidate promotion and validation:

- The public/default validation and service paths deliberately remain `chain="ideal"` so the
  recorded FINAL_PRODUCT numbers are not silently relabelled as real-chain results.
- The measured 72 h DESIGN_A real-chain run is aerodynamically certified with 432 accepted storage
  steps and zero unmet thrust, but it does **not** close: SOC is `1.0000 -> 0.9307` (minimum
  `0.0920`). That candidate must be re-sized or replaced; the failing verdict must not be hidden.
- Validation cases A-D and the realistic 72 h mission still need to pass with the selected real
  candidate before the default can move and the reference outputs can be regenerated.

**Done when:** a real candidate passes cases A-D and the 72 h mission with certified aero, zero
unserved bus demand, SOC persistence and all mass/technology bounds; then make that validated real
chain the default and regenerate the recorded outputs with explicit provenance.

---

## B. Engine resolution — CLOSED 2026-09-16 (the vendored engine is the default)

The package points at an engine tree via `AERO_LAB_ENGINE_DIR`. Two trees exist and they disagree:

| tree | fingerprint | behaviour |
|---|---|---|
| vendored snapshot (`aero-lab/engine/`) | `603cf4c5e8d9e4c9` | runs 3 of 4 presets, reproduces the recorded numbers |
| live upstream checkout | `0a9aaab7ff87f747` | **refuses all four presets** |

**Closed (1.2.1):** the documented resolution pointed at an operator-local scratchpad checkout
*before* the vendored tree, so a box that happened to carry that path 422'd on every preset, and
a box without it had that stranger's path quoted back in `capability_unavailable` and in the
engine-container install hint. Both resolvers — `src-routes/engine-adapter.ts`
`resolveEngineDir()` and `engine/service.py` `_resolve_engine_dir()` — now resolve
**explicit option → `AERO_LAB_ENGINE_DIR` → the tree vendored in this package**, and no
absolute operator-local path is left anywhere in the package. Reaching the upstream tree is a
deliberate `AERO_LAB_ENGINE_DIR`, never a guess.

Guarded by `tests/aero-engine-dir-resolution.spec.ts`: the adapter's resolution order over a
real filesystem (vendored wins, the env override still wins, and with no vendored `aerosim` the
refusal names *this* package's engine dir rather than a path outside it), the real
`engine/service.py` resolver driven in a subprocess, and a scan of every shipped file in the
package for an absolute user-home path.

Since 1.2.0 a deployed api uses the package's engine container, built from the vendored tree
(`ENGINE_DIR=/opt/aero-lab/engine`); the upstream tree is picked only by a natively-run api or
spec whose `AERO_LAB_ENGINE_DIR` points at it.

*Not a defect:* one of the live tree's refusals is **honest**. The R7 winner claims a 441.8 Wh/kg
pack while the certified cell catalogue (LG INR21700 M50) delivers 229.0 Wh/kg — ratio 1.929,
outside the ±15% band. That is the chemistry layer correctly catching an Amprius-class assumption
the ideal model waved through. Do not "fix" it by widening the band.

---

## C. Physical-build gaps (block hardware, not software)

These gate anyone actually building the craft the exporter emits.

- **The vent / ballonet is undesigned and unbilled.** A sealed film envelope cannot take the diurnal
  superheat cycle at this scale (measured peak +25.6 K / +9.1 kPa). It needs pumpkin lobes or a
  ballonet, and that mass is in no ledger. **Any sealed build is gated on this.**
- **The 45 g/m² barrier film has no small-lot vendor.** It is the material that makes the sealed
  six-month configuration close both days; the sourced alternatives are 38 µm LLDPE (leaks faster)
  or a 70 g/m² laminate (which pushes the pack to 250.4 Wh and the craft to 4.165 kg).
- **Party helium does not fly.** 80% purity drops the buoyancy fraction 0.800 → 0.703 (measured),
  gas mass 253 → 568 g, and the design closes on no pack. Welding-grade only.
- **Real parts are 274 g heavier than the certified ledger** — DIY pack 197 Wh/kg vs 250 (+92 g),
  motor/ESC/prop 120 g vs 55.2 (+65 g), and an MPPT the ledger carried as 0 g (+57 g). The as-built
  craft therefore needs a 98.0 Wh minimum pack, not the 79.6 Wh the catalogue design assumed.

---

## D. Smaller items

- **The design-space sweep must be re-run on real physics.** The paused 30k sweep was scored on the
  ideal chain and is not a valid ranking once section A closes.
- **`node scripts/check-store-separation.mjs .` fails repo-wide** on a top-level `_walkthrough-shots/`
  directory (gitignored screenshot debris). Pre-existing and unrelated to this package; aero-lab
  itself passes.

---

## E. The engine container is installed and updated by hand

Since 1.2.0 the engine runs in the package's own container (`engine/container/`, built by
`engine/install-engine.sh`). Nothing installs or refreshes it automatically: after installing the
package, and after any update that changes the engine tree, someone has to run

```sh
docker exec <api-container> sh /app/workspace-shared/deployed-apps/aero-lab/engine/install-engine.sh
```

The app fails honestly in the meantime — a missing or stale container is refused with that exact
command in `capability_unavailable`, and the surface prints it — so no result is ever fabricated.
But a person who installs aero-lab from the store and opens it gets a dead lab until they read the
banner and have shell access to the box.

**Done when:** installing or updating aero-lab on a box with a docker socket leaves a working engine
container with no operator step — either the package declares a post-install command the installer
runs, or the first engine call builds and starts it — and the refusal path is unchanged when that
cannot happen (capabilities false, the exact command, no fabricated numbers). The store-wide half of
this is core BACKLOG "Package-owned engine containers need a documented pattern" (2026-09-14).
