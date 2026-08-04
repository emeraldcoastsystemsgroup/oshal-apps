# aero-lab — BACKLOG

Open work on the packaged persistent-flight design lab. Every entry has a done-when so scope does
not have to be guessed later.

**Posture:** the package ships and runs. What is open is engine *certification*, not packaging.
The v1.0.0 honest-limits section in [README.md](README.md) is the user-facing version of this list;
this file is the engineering detail behind it.

---

## A. The real-drive certification gate is RED

The engine has two propulsion chains. On the **ideal** chain the gate is green and reproduces the
recorded numbers bit-for-bit. On the **real** (BEMT + motor + ESC) chain, five defects below keep
it red.

**The isolating proof, which is what makes this tractable:** flipping one line —
`build_solar_cruise`'s chain default to `"ideal"` — reproduces the pre-upgrade gate *bit-identically*
(case A 1.0446 / B 1.0548 / C 0.2773 / D 0.3636, `GATE_EXIT=0`). Chemistry, electrical, materials
and mission are therefore **clean**. The entire regression is the real drive plus two certification
envelopes calibrated for wings rather than buoyant ships.

### A1 — BEMT certification envelope is too tight
At V = 12.00 m/s (top of the trim-probe bracket) a lightly loaded propeller reaches high advance
ratio and **98% of the thrust integrand falls outside aeropolar's gates**. Swirl tolerance is
`1e-8` against a measured `2.17e-3` residual — five orders tighter than the physics warrants.

*Effect:* refuses validation case A and every real-drive flight.
**Done when:** the swirl tolerance is justified from convergence behaviour rather than inherited,
case A passes on the real chain, and a guard test pins the chosen tolerance so it cannot drift.

### A2 — Buoyant trim cannot converge (blocks the flagship)
Vertical residual `0.000550251 N` against a tolerance of `1.47557e-07 N` on a `14.7557 N` weight —
`3.7e-5` relative, physically meaningless and numerically fatal. An independent sweep of
f = 0.2 / 0.4 / 0.6 / 0.8 on a design that is fine at f = 0 shows **all four refuse, with the
residual scaling with f**.

*Root cause:* the tolerance is ~`1e-8` relative to **gross** weight, but the wing only controls the
`(1 − f)` residual. On a buoyant ship most of the weight is carried by gas the wing never trims.

*Effect:* **the certified Floater cannot be evaluated by the main engine at all.**
**Done when:** the tolerance is defined against the aerodynamically-trimmed fraction, the f-sweep
passes at all four points, and a regression test covers f = 0.8.

### A3 — Uncertified aero at buoyant trim speed
Both chains refuse the aero solution at roughly 4.4–4.5 m/s. Chord 0.208 m at 4.4 m/s gives
Re ≈ 59,000, comfortably above the 30,000 floor — so the refusal is **alpha-span or NeuralFoil
confidence, not Reynolds**.

**Done when:** the refusal is attributed precisely (which gate, which bound) before anything is
changed. No widening a band to make a number appear.

### A4 — Pack thermal model is dead
Over a 72 h mission `pack_T_min == pack_T_max == 288.15 K` exactly and `heater_Wh == 0.0` exactly.
288.15 K is `PackEcm.pack_temp_K`'s initialiser (`ecm.py:483`, sea-level ISA); ambient at 500 m is
284.9 K. **The thermal ODE is never stepped from the mission.**

*Effect:* silently deletes the cold-night physics the electrochemistry upgrade existed to add.
**Done when:** pack temperature tracks ambient across a 72 h run, heater energy is non-zero on a
cold night, and a guard asserts the pack temperature is not constant.

### A5 — Four verification anchors never evaluated
Harness import-name errors, not code defects: Fan 2003 cold usable/R_int ratios; C60 STC worst-bin
MPP; helium permeation through 38 µm LLDPE; mission ledger reconciliation.

**Done when:** all four run and pass or fail on their merits, and the suite completes end-to-end.

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

- **Two physics implementations, no parity test.** The browser console mirrors the server models and
  nothing asserts they agree on a single number. **Done when:** one shared case is asserted equal
  across both to a stated tolerance.
- **The mesh validator does not check self-intersection.** Topology is verified closed and manifold;
  a sufficiently twisted loft could pass every check and still be unprintable.
- **The design-space sweep must be re-run on real physics.** The paused 30k sweep was scored on the
  ideal chain and is not a valid ranking once section A closes.
- **`node scripts/check-store-separation.mjs .` fails repo-wide** on a top-level `_walkthrough-shots/`
  directory (gitignored screenshot debris). Pre-existing and unrelated to this package; aero-lab
  itself passes.
