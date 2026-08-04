# BUILD SHEET — f=0.80 solar dynastat (validated hybrid, site A d195)

One page. Every number is traced to a result file at the end; anything that is a
build **choice** (not a study output) is marked **[choice]**.

## The vehicle

| item | value | source |
|---|---|---|
| Buoyancy fraction f | 0.80 (Archimedes lift / all-up weight, at 500 m) | HYBRID_refine.out, `ellipsoid f=0.80` (A d195) |
| All-up mass | 1.998 kg (pack A) / 2.182 kg (pack B) | design_snapshot.json ledger (sums exactly) |
| Hull | 3:1 prolate spheroid, 2.866 m x 0.955 m, V = 1.369 m3, S = 7.048 m2 | HYBRID_common.ellipsoid3_dims via design_snapshot.json |
| Hull film | 38 um LLDPE, 0.035 kg/m2, x1.10 for tapes + valve, 10 gores | HYBRID_common.py envelope assumptions; gore count **[choice, task-directed]** |
| Wing | span 2.5 m, chord 208 mm, S 0.52 m2, AR 12.02, taper 1.0, twist 0/0 | TIER1_operator_eval.py |
| Section | Tier-1 CST airfoil = NACA 2412 carried as 18 Kulfan weights | aerosim/validate_designs.py `SECTION_CODE="2412"`; weights in design_snapshot.json |
| Solar | 21x SunPower C60, 0.36 m2 active, eff 0.227, laminate 0.45 kg/m2 | TIER1_operator_eval.py |
| Thruster | 100 W max electrical, 0.30 m folding prop, 1 rotor | TIER1_operator_eval.py / HYBRID_common.py |
| Battery | A: 79.6 Wh / 0.318 kg — B: 125.5 Wh / 0.502 kg (250 Wh/kg pack) | HYBRID_refine.out / HYBRID_f90_fasttrim.out |
| Cruise trim | V = 3.80 m/s, CL 0.896, Re_wing 51 964, load 7.87 W (prop 5.34 + avionics 2.53) | design_snapshot.json performance (re-derived HYBRID_piecewise.evaluate_f) |

## Assembly order

1. **Ribs + spar**: cut 8 ribs per panel from `ribs.dxf` (16 total, all
   identical — constant chord). Thread onto the 10 mm spar tube at 30 % chord.
   Rib stations 0…1250 mm at 178.6 mm pitch **[choice — the study has no rib
   layout; count per task directive]**.
2. **Wing panels**: skin/cover to the `airfoil_template.dxf` profile; verify
   any printed sections against `wing_panel_left/right.stl`. Zero twist, zero
   sweep, zero dihedral (study geometry).
3. **Solar array**: laminate the 21 C60 cells onto the upper skin, 0.36 m2
   active, wired to MPPT before covering.
4. **Hull**: cut 10 gores from `hull_gore.dxf` (outer line = cut, inner =
   sew/tape), seam with PSA tape into the 2.866 x 0.955 m spheroid; fit fill
   valve at the nose **[choice]** and load-tape patches for wing + pod straps.
5. **Pod**: battery + payload/avionics + thruster in one pod on a short strap
   harness under the hull, motor axis aft **[choice]**.
6. **Mate**: wing spar through the hull saddle at the max-diameter station
   (x = 1433 mm from the nose), pod straps to the same station.

## CG target (moment balance — computed in FP_01, design_snapshot.json `balance`)

Axes: x aft of hull nose, z up, hull axis z = 0.

- Center of buoyancy (CB) = spheroid centroid: **x = 1433 mm, z = 0**.
- Everything except the pod (wing, PV, film, He) is centred at x = 1433 mm; the
  pod (battery + payload + pod structure + thruster, **0.533 kg** pack A /
  0.716 kg pack B) hangs at the same station, **z = −628 mm** (hull radius
  478 mm + 150 mm strap drop **[choice — strap length is not a study output]**).
- Resulting CG: x = 1433 mm (directly under CB), z = **−167 mm** (pack A) /
  **−206 mm** (pack B). **Pendulum arm CB-above-CG = 167 mm / 206 mm** — the
  buoyant restoring moment. Target: CB vertically above CG with arm ≥ 100 mm —
  met with margin.
- Placement tolerance: keep the pod within **±50 mm** of the wing-spar station;
  that moves the CG ≤ 13 mm (pack A: 0.533/1.998 of the offset) and holds the
  static pitch attitude inside ~4.6 deg (arcsin 13/167).
- In cruise the wing carries the residual weight (1−f)·M·g = **3.92 N**
  (≈ 400 gf) at the same station, so buoyancy, weight, and wing lift are
  collinear — no standing pitch couple. (Wing lift check: q·S·CL at trim =
  3.92 N. Matches.)

## Fill procedure (He, 20 C)

- Helium mass **222.0 g**. Sized at 500 m / 284.9 K charged to ambient
  + 500 Pa superpressure (HYBRID_common.size_envelope). At ground, 20 C /
  101.3 kPa (+500 Pa), that same mass occupies **1.328 m3 = 97 % of the
  1.369 m3 hull** — fill to a just-taut envelope, not drum-tight.
- Weigh-off: after fill the vehicle must rest **≈ 400 gf heavy** (residual
  (1−f)·M·g at f = 0.80, pack A). Trim with ballast at the pod.
- **Superheat headroom (read before sealing):** the study's diurnal thermal
  ledger (HYBRID_piecewise.out, sphere thermal model at the 1.31 m3 f=0.75
  sizing) shows peak day superheat **+25.6 K → +9.1 kPa** superpressure if
  sealed, i.e. **~81 MPa hoop stress in 38 um film — far beyond LLDPE**. Do
  NOT seal the envelope dead; leave the vent path open (see open item). At
  night the same ledger goes to **−1.5 kPa** — the hull WILL go slack and lose
  shape without a ballonet.

## Preflight (5 items)

1. Weigh-off = 400 ± 50 gf heavy at the field (pack A; ~583 gf for pack B),
   pod hanging level, CG under CB.
2. Battery full; SOC telemetry alive; pack ≥ 79.6 Wh usable (A) — floor in the
   study is SOC 0.05, never plan below it.
3. Solar bus: MPPT output present on all 21 cells (open-circuit + load check).
4. Prop clear of hull and straps through full deflection; motor spin-up to
   ~50 W on the bench-strap without pod oscillation.
5. Envelope: seams taped, no leaks audible/soapy, vent path OPEN, valve
   closed; hull just-taut at ambient.

## Honest open item

**Vent / ballonet is not designed.** The reality-upgrade materials work
(DOSSIER superheat panel; HYBRID_piecewise.out superheat ledger) prices the
need — +9.1 kPa sealed-day / −1.5 kPa night on this hull class — but no vent
sizing, ballonet volume, or slack-hull flight behaviour exists in any result
file. Until that work lands, restrict flights to short, supervised,
line-of-sight windows in mild sun, and never leave the envelope sealed on the
ground in daylight. Also honest: pack option B's 0.502 kg figure comes from a
**fast-trim** (fixed 4.0 m/s) equinox pass that assumed a resized 1.53 m3
hull; flown in THIS hull it gives f = 0.73 and the equinox day was not
re-certified at that f.

## Traceability

| number | file |
|---|---|
| f=0.80, pack 79.6 Wh / 0.318 kg, M 1.998 kg, V 3.80 m/s, env 1.37 m3 / 2.87 x 0.96 m, Re 51 964 | HYBRID_refine.out (re-derived full-precision in design_snapshot.json via HYBRID_piecewise.evaluate_f) |
| ledger: wing 0.738 / PV 0.234 / batt 0.318 / thruster 0.055 / payload 0.100 / pod 0.059 / film+tapes 0.271 / He 0.222 kg | design_snapshot.json `ledger_kg` (sums to 1.998063 kg) |
| hull shape + film + tape factor + 500 Pa superpressure | HYBRID_common.py (ellipsoid3_dims, envelope assumptions block) |
| CST weights (18), section = NACA 2412 Kulfan | aerosim/validate_designs.py + aeropolar.naca_kulfan → design_snapshot.json `airfoil_cst` |
| planform / cells / prop / payload / altitude | TIER1_operator_eval.py header + constants |
| pack B 125.5 Wh / 0.502 kg | HYBRID_f90_fasttrim.out line "B d80 f=0.80" |
| superheat +25.6 K / +9.1 kPa / −1.5 kPa; float case +35.2 K | HYBRID_piecewise.out superheat ledger |
| **Not traceable to any result file (build choices)** | pod strap drop 150 mm; rib stations/pitch; fill valve at nose; pod ± tolerance; (gore count 10, seam 15 mm, spar hole 10 mm at 30 % chord are task-directed) |
