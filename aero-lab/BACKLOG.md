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

## B. Engine resolution needs an operator decision

The package points at an engine tree via `AERO_LAB_ENGINE_DIR`. Two trees exist and they disagree:

| tree | fingerprint | behaviour |
|---|---|---|
| vendored snapshot (`aero-lab/engine/`) | `603cf4c5e8d9e4c9` | runs 3 of 4 presets, reproduces the recorded numbers |
| live upstream checkout | `0a9aaab7ff87f747` | **refuses all four presets** |

The documented default resolution points at the upstream checkout, so **a cockpit started on a box
that has it will 422 on every preset.**

**Done when:** either `AERO_LAB_ENGINE_DIR` defaults to the vendored engine, or the package is
re-vendored once the engine settles. The surface already displays the engine fingerprint, so which
tree answered is never a guess — that part is fine.

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
