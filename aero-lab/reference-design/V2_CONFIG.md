# The Floater — v2 configuration certification

Three configurations certified on the same evaluation path that produced the v1 design:
**AS-BUILT** (the aircraft the BOM actually buys), **v2 SEALED** (6-month no-refill), and **CARGO**.
Plus a **wing-growth search**, because the first two runs showed the 2.5 m wing had become the
binding constraint.

Every number below is pasted from an actual run. Run files are named inline. Nothing is
extrapolated between design points — each row is its own closure run.

*Generated 2026-08-03. Site A = 47.6°N, 500 m, day 195 (solstice side) and day 80 (equinox).*

---

## RECOMMENDATION — build CONFIG 2 (as-built, LLDPE hull) with a 98–121 Wh pack

**Build the 2991 × 997 mm (117.8 × 39.3 in) as-built hull, the existing 2.5 m wing and 21 cells,
real BOM parts, and grow pack A from 8 cells to 10 (2S5P, 100.8 Wh, ~512 g, +$19.90).**

It is the only configuration here that is both **fully sourced** and **closes the 24 h loop**
(d195 at 98.0 Wh; pack B at 121 Wh closes with a real 0.164 SOC floor). It is 274 g and 5 inches
from the design already drawn in `FINAL_PRODUCT/`. Everything else — sealing, tilt-thrust, cargo —
is an upgrade to this same airframe.

Three findings drive that, and each is a run in this document:

- **The v1 2.0 kg / 80 Wh aircraft only ever worked because of light, leaky LLDPE film.** With
  real part masses it grows to 2272 g and needs 98 Wh — still cheap, still real, but it refills
  every few weeks.
- **Sealing it for six months costs +70% all-up mass and a metre more wingspan** (3857 g, 3.5 m,
  41 cells) — and even then the six-month margin is *zero* (flag H3), and the barrier film has no
  small-lot vendor (flag H2).
- **The wing was not the constraint — the sealed film was.** Doubling span 2.5 → 5.0 m never gets
  the sealed aircraft onto a real pack, but changing the film assumption from 70 to the sourced
  45 g/m² is worth **110 Wh of battery and 1.17 kg of aircraft** on its own.

Cargo is a separate vehicle: a 10 lb loiterer needs **f ≈ 0.95 and an 8.2 m³ hull** — an airship
with a wing, not this aircraft. At the briefed f = 0.80 it does not close at any pack size.

---

## 0. Method and provenance

| what | where it comes from |
|---|---|
| evaluation path | root-level `HYBRID_common.py` / `HYBRID_piecewise.py` — the same modules that certified v1 (`HYBRID_refine.out`), untouched by this study |
| harness | `V2_00_common.py` (this study), wrapping that path; wing span/area parameterised for the growth sweep |
| hull shape | 3:1 prolate spheroid, `H.ellipsoid3_dims` — the exact shape the ellipsoid drag model assumes |
| hull drag | ITTC-57 turbulent Cf × Hoerner form factor FF(fineness 3) = 1.548 on true wetted area |
| trim | `bounds.reference_trim` at residual weight (1−f)·M·g with the `extra_CD0` ×1.2 floor fixed-pointed at the residual-trim Re; on solver refusal, the same fast-trim fallback that certified v1 pack B |
| 24 h closure | `P.cycle_closes` / `P.min_cap_Wh` — η_charge 0.95, η_discharge 0.95, SOC floor 0.05, full-again-by-next-sunset |
| wing mass | `H.wing_mass_kg` (Stender regression calibrated to AtlantikSolar AS-2, range-checked, refuses outside the built envelope) |
| tail/boom floor | `min_fuselage_boom_tail_mass_kg(carried, span)` — re-evaluated at every mass and span |
| real part masses | `FINAL_PRODUCT/BOM_v2.csv` |
| f (buoyancy fraction) | ρ_air·V / M_allup. f = 0.80 held for every sizing run: the hull carries 80% of the weight, the wing flies the other 20% |

**Baseline for all deltas — v1 certified design** (`FINAL_PRODUCT/design_snapshot.json`):
hull 2865.9 × 955.3 mm (112.8 × 37.6 in), 1.3694 m³; wing 2.5 m / 0.52 m² / AR 12.02;
all-up **1998.1 g**; trim 3.80 m/s; load 7.87 W; closes d195 on 79.6 Wh.

---

## 1. CONFIG 2 — AS-BUILT (run first, highest priority)

The aircraft as actually assembled from `BOM_v2.csv` real measured masses.
Run: **`V2_10_asbuilt.py` → `V2_10_asbuilt.out`, `V2_10_asbuilt_result.json`.**

### What changed from the certified ledger

| line | v1 certified | as-built (BOM_v2) | delta |
|---|---|---|---|
| pack A | 318.2 g @ 250 Wh/kg (79.6 Wh) | **410 g @ 197 Wh/kg (80.6 Wh)** — Molicel P28A ×8, row 5 | **+90.9 g** |
| thruster group | 55.2 g | **120 g** — X2212 + APC 12×8E + Skywalker 30A, rows 2–4 | **+64.8 g** |
| MPPT | *0 g — not in the ledger at all* | **57 g** — Genasun GV-5-Li, row 8 | **+57.0 g** |
| servos | 2 × 9 g | 2 × 13 g — MG90S real weight, row 11 | inside the unchanged 100 g avionics budget (FC 25 + GPS 5 + servos 27 + RX/wiring 25 = 82 g) |
| film | 38 µm LLDPE × 1.10 tapes | **unchanged** — row 13 is the same film | +24.3 g (bigger hull only) |
| helium | 99.9% welding grade | **unchanged** — row 16 | +30.5 g (bigger hull only) |

> **Correction to an earlier run.** `V2_02_asbuilt.out` (a prior attempt) certified "as-built" while
> silently inheriting the *sealed laminate* hull defaults — 0.070 kg/m² film + 100 g tendons + 10%
> gas reserve. That is not what `BOM_v2.csv` buys. Its headline (pack A 48 Wh short, all-up
> 2.907 kg) is the **sealed** aircraft, not the as-built one, and is superseded by everything below.

### The as-built hull, resized to f = 0.80

```
[d195]  as-built pack A: pack    80.6 Wh (0.409 kg) M_allup 2.272 kg f=0.800 V 4.00 m/s
        [fast-trim V=4.0] load 9.18 W (prop 6.43 + pay 2.76) D_w 0.33 D_e 0.55 N
        cd_vol 0.044 env 1.56 m3 2.99 x 1.00 m min_soc 0.050 closes=False unserved 11.6 Wh
    hull 2991.4 x 997.1 mm  =  117.8 x 39.3 in  (1.557 m3, 7.68 m2 skin)
```

**Hull: 2991.4 × 997.1 mm = 117.8 × 39.3 in (9 ft 9.8 in long), 1.557 m³, 7.68 m² of skin.**

### All-up ledger (pack A), grams

| item | v1 certified | as-built | delta |
|---|---|---|---|
| wing structure | 738.0 | 738.0 | — |
| PV (cells + laminate) | 234.0 | 234.0 | — |
| battery pack A | 318.2 | **409.1** | +90.9 |
| thruster group | 55.2 | **120.0** | +64.8 |
| payload / avionics | 100.0 | 100.0 | — |
| MPPT (Genasun GV-5) | 0.0 | **57.0** | +57.0 |
| fuselage / boom / tail floor | 59.3 | 66.1 | +6.8 |
| film + tapes | 271.4 | 295.7 | +24.3 |
| helium | 222.0 | 252.5 | +30.5 |
| **ALL-UP** | **1998.1** | **2272.4** | **+274.3** |

The BOM predicted "~2212 g in the v1 hull". That was right about the parts; the extra **60 g** is the
hull growth itself — a bigger envelope needs more film and more gas, which needs more envelope.
The fixed point converges at 2272.4 g.

### Closure

| pack | d195 solstice | d80 equinox |
|---|---|---|
| **real pack A, 80.6 Wh / 410 g** | **NO — 11.6 Wh short**, SOC floor 0.050 hit | NO — 42.1 Wh short |
| **real pack B, 121.0 Wh / 605 g** | **YES**, SOC floor **0.164** | NO — 21.3 Wh short |
| minimum closing pack | **98.0 Wh** (0.497 kg) | **180.3 Wh** (0.915 kg) |

```
#### AS-BUILT minimum closing pack (hull resized f=0.80 at the pack it lands on) ####
[d195]  as-built pack A: pack    98.0 Wh (0.497 kg) M_allup 2.385 kg f=0.800 V 4.00 m/s
        [best-endurance] load 9.61 W (prop 6.76 + pay 2.85) ... min_soc 0.050 closes=True
    hull 3040.0 x 1013.3 mm  =  119.7 x 39.9 in  (1.634 m3, 7.93 m2 skin)
[d80]   as-built pack A: pack   180.3 Wh (0.915 kg) M_allup 2.919 kg f=0.800 V 4.43 m/s
        [best-endurance] load 12.87 W (prop 9.61 + pay 3.26) ... min_soc 0.050 closes=True
    hull 3251.9 x 1084.0 mm  =  128.0 x 42.7 in  (2.001 m3, 9.07 m2 skin)
```

**The gap is small and buyable.** Pack A is 17.4 Wh short of the d195 minimum. Two more Molicel
P28A cells (2S5P = 100.8 Wh, 10 cells ≈ 512 g, +$19.90) clears it with margin. That is the single
cheapest fix in this document.

Pack B (121 Wh) closes d195 with a real reserve (SOC floor 0.164, i.e. it never comes near the
5% floor) — but its own hull is 3097.9 × 1032.6 mm (122.0 × 40.7 in), 1.730 m³, all-up 2523.8 g.

**One hull or two?** Pack B dropped into the *pack-A* hull does **not** work:

```
[pack B in the pack-A hull, d195]: pack 121.0 Wh (0.605 kg) M_allup 2.474 kg f=0.735
        V 4.70 m/s load 12.87 W ... min_soc 0.050 closes=False
```

f falls to 0.735, the wing has to carry 65% more residual weight, trim rises to 4.70 m/s and the
loop opens. **Size the hull for the pack you will actually fly.**

### SOC floors

The floor is 0.05 by construction (`P.SOC_MIN`) and the solver clamps to it. Where `min_soc` reads
exactly 0.050 the aircraft is *at* the floor and `unserved_Wh > 0` means it went through it —
that is the failure, not a margin. The only as-built point with genuine daylight above the floor is
**pack B at d195: min_soc 0.164**.

### NEGATIVE CHECK — 80%-purity party helium

`BOM_v2.csv` row 15 warns that many Balloon Time tanks are "not less than 80 percent helium" (the
vendor's own wording — confirmed on balloontime.com during this study). Re-run in the **same
physical hull**, sized for 99.9%:

```
#### NEGATIVE CHECK: 80%-purity party helium, SAME physical hull (sized for 99.9%) ####
[d195]  as-built 80% party He: pack 80.6 Wh (0.409 kg) M_allup 2.587 kg f=0.703 V 5.17 m/s
        [best-endurance] load 15.52 W (prop 12.51 + pay 3.01) D_w 0.47 D_e 0.87 N
        cd_vol 0.041 env 1.56 m3 2.99 x 1.00 m min_soc 0.050 closes=False
  gas density ratio 0.31055 vs pure 0.13819 -> net lift/m3 x 0.8000
  f 0.800 -> 0.703;  gas mass 253 -> 568 g;  residual weight the WING must carry 4.46 -> 7.55 N
```

**What actually happens, plainly:** the gas mass in the hull more than doubles (253 → 568 g), the
aircraft gets 315 g heavier without gaining a gram of useful load, buoyancy fraction falls
0.800 → **0.703**, and the residual weight the wing must fly rises **4.46 → 7.55 N (+69%)**.
Trim rises from 4.00 to **5.17 m/s**, propulsive power from 6.43 to **12.51 W**, total load from
9.18 to **15.52 W** — a **69% power increase** for the same mission. The 24 h loop does not close
and no pack in this airframe closes it.

> **Honest correction to the expected number.** The brief predicted f ≈ 0.64 (0.80 × 0.80).
> The *net lift per m³* does fall by exactly ×0.8000 — that part is right, and it is derived, not
> assumed: ρ_mix/ρ_air = 0.8(0.13819) + 0.2 = 0.31055, so net lift ∝ (1 − 0.31055)/(1 − 0.13819)
> = 0.8000. But **f does not scale with lift**, because f = ρ_air·V / M_allup and the blend makes
> M_allup *larger*. The honest answer is **f = 0.703**, and the aircraft still will not fly.
> Cheaper to state correctly than to round to a scarier number.

### Delta vs the v1 catalogue design

```
#### DELTA vs the v1 catalogue design (2865.9 x 955.3 mm, 1.3694 m3, 1998.1 g) ####
  length  +125.6 mm (+4.9 in)
  diam    +41.9 mm (+1.6 in)
  volume  +0.188 m3
  all-up  +274 g
  trim V  +0.20 m/s
  load    +1.32 W
```

**In plain terms: the real aircraft is about 5 inches longer, 1.6 inches fatter, and 274 grams
heavier than the catalogue design — and it needs a 98 Wh pack instead of an 80 Wh one.**

---

## 2. WING-GROWTH SEARCH — is the 2.5 m wing the binding constraint?

Run: **`V2_11_wing.py` → `V2_11_wing.out`, `V2_11_wing_result.json`.**

**Why this was run.** v1 spilled ~60% of its 616 Wh/day harvest, so the wing was never the
constraint. Adding the sealed hull *and* the real part masses moved the aircraft into a
harvest-limited regime — and the wing had been held at 2.5 m / 0.52 m² / 21 cells through every
run. This releases it: span 2.5 → 5.0 m, area = b²/12.0192 (AR held at v1's 12.0192), cells
scaling with area at the v1 packing 0.6923, PV mass 0.45 kg/m² on the full planform, wing
structure from `H.wing_mass_kg` (Stender/AtlantikSolar), tail floor re-evaluated at the new span,
hull resized to f = 0.80 at every point, pack re-minimised at every point.

**Basis: v2 SEALED on AS-BUILT masses at the conservative 70 g/m² film** (the sealed spec's
2 × LLDPE assumption). Section 3 shows what happens at the film density that was actually sourced.

### The trade curve

| span | area | cells | C60 cost | wing struct | PV | harvest d195 / d80 | **min pack d195** | all-up | hull (mm) | hull (ft) | **min pack d80** | all-up | real pack A d195 | real pack B d195 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **2.5 m** | 0.520 m² | 21 | $94 | 738 g | 234 g | 615.9 / 391.6 Wh | 250.4 Wh | 4.165 kg | 3660.9 × 1220.3 | 12.01 × 4.00 | **never closes** | — | short 48.0 Wh | short 33.2 Wh |
| **3.0 m** | 0.749 m² | 30 | $136 | 980 g | 337 g | 886.9 / 563.9 Wh | 167.4 Wh | **4.052 kg** | 3627.5 × 1209.2 | 11.90 × 3.97 | **never closes** | — | short 41.7 Wh | short 22.4 Wh |
| **3.5 m** | 1.019 m² | 41 | $185 | 1246 g | 459 g | 1207.2 / 767.5 Wh | 153.5 Wh | 4.504 kg | 3757.6 × 1252.5 | 12.33 × 4.11 | **276.4 Wh** | 5.392 kg | short 42.2 Wh | **short 18.6 Wh** |
| **4.0 m** | 1.331 m² | 54 | $242 | 1533 g | 599 g | 1576.7 / 1002.5 Wh | **151.9 Wh** | 5.096 kg | 3915.6 × 1305.2 | 12.85 × 4.28 | 264.3 Wh | 5.902 kg | short 44.8 Wh | short 19.2 Wh |
| **4.5 m** | 1.685 m² | 68 | $306 | 1842 g | 758 g | 1995.5 / 1268.7 Wh | 159.0 Wh | 5.800 kg | 4088.1 × 1362.7 | 13.41 × 4.47 | **257.9 Wh** | 6.504 kg | short 51.4 Wh | short 24.8 Wh |
| **5.0 m** | 2.080 m² | 84 | $378 | 2170 g | 936 g | 2463.6 / 1566.3 Wh | 164.8 Wh | 6.541 kg | 4255.4 × 1418.5 | 13.96 × 4.65 | 260.8 Wh | 7.220 kg | short 57.3 Wh | short 29.7 Wh |

### What the curve says — three answers

**(a) Smallest wing that closes d195 on the REAL pack A (80.6 Wh) or pack B (121 Wh): NONE of
them.** This is the important negative result. The pack-B shortfall goes
**33.2 → 22.4 → 18.6 → 19.2 → 24.8 → 29.7 Wh** across 2.5 → 5.0 m: it bottoms at b = 3.5 m and
then *gets worse*. **Wing growth alone never rescues the sealed aircraft onto a real pack.**

Why: a bigger wing buys harvest, but harvest was never what the pack is for. The pack covers the
**night**, and night load rises with the aircraft — more wing → more mass → bigger hull → more
wetted area and drag. Past ~3.5 m the added night load outruns the added daylight margin.

**(b) Smallest wing that closes d80 EQUINOX at all: b = 3.5 m.**

```
  b=3.5    min d80: pack  276.4 Wh  M 5.392 kg  V 4.38 m/s  load 19.89 W
           hull 3989.9 x 1330.0 mm (13.09 x 4.36 ft) 3.695 m3  cells 41  min_soc 0.050
```

At 2.5 m and 3.0 m equinox is *energy-negative* — no pack of any size closes it:

```
  b=2.5    min d80: NO -- energy-negative: load 16.05 W x 24 h = 385 Wh vs harvest 392 Wh
  b=3.0    min d80: NO -- energy-negative: load 23.44 W x 24 h = 563 Wh vs harvest 564 Wh
```

Note how tight b=3.0 is — 563 vs 564 Wh. It fails by less than a watt-hour of margin against the
round-trip efficiency and the 5% SOC floor. b=3.5 is the first span with real daylight.

**(c) Mass, hull and cell count per span:** in the table. Two different optima:

- **lightest aircraft: b = 3.0 m** (4.052 kg) — but it cannot do equinox at all.
- **smallest pack: b = 4.0 m** (151.9 Wh) — 1.04 kg heavier than b=3.0 for 15.5 Wh less pack.
- **best all-round: b = 3.5 m** — first span that closes equinox, near-minimum pack (153.5 Wh),
  smallest pack-B shortfall, 41 cells ($185 of C60), 4.504 kg.

### The conclusion that matters

The wing was *a* constraint but not *the* constraint. Growing it 2× in span (4× in cells, $94 →
$378 of solar) moves the d195 minimum pack only 250 → 152 Wh, and **never** reaches the 121 Wh
pack B the BOM buys. Meanwhile all-up mass goes 4.2 → 6.5 kg.

That points the finger at the sealed-hull mass itself — 70 g/m² of film plus tendons plus a 10%
gas reserve, compounded through the hull fixed point. **Section 3 tests that assumption against
the film that was actually sourced.**

---

## 3. CONFIG 1 — v2 SEALED (6-month no-refill), built on AS-BUILT masses

Run: **`V2_13_sealed.py 2.5 3.5` → `V2_13_sealed.out`, `V2_13_sealed_result.json`.**

Per the brief, this is built **on top of** the as-built masses — "v2 sealed AS-BUILT is the real
answer." So underneath every number here: pack at 197 Wh/kg, thruster group 120 g, Genasun GV-5
MPPT 57 g.

### The sealed deltas, each billed

| # | delta | mass | power |
|---|---|---|---|
| 1 | barrier film (10–100× lower He permeation) | **see below — this is the whole story** | — |
| 2 | tendons / lobes for superpressure | 0.01102 kg/m² of skin (scaled, not flat 100 g) | — |
| 3 | +10% gas as the 6-month permeation reserve | +10% gas mass | — |
| 4 | tilt-thrust servo | +20 g | +0.2 W |
| 5 | pitot (Matek ASPD-DLVR) | +10 g | ~0 W |
| 6 | regen ESC | +0 g *in this ledger* — see honesty flag H5 | 0 W |
| 7 | Iridium satcom (optional) | **+39 g** (real RockBLOCK 9603 w/ antenna, not the briefed 35 g) | +0.2 W |
| 8 | fus/boom/tail floor at the new carried mass | re-evaluated every iteration | — |

### THE FINDING: the film areal density *is* the configuration

The sealed spec assumed **2 × LLDPE = 70 g/m²**. Sourcing (`BOM_v2_deltas.csv`) found the real
barrier films are **lighter than that**: heat-sealable PET12/PE30 laminate ≈ **45 g/m²**
(`BOM_v2.csv` row 18), and bare 25.4 µm metallized PET measures ≈ 35 g/m² (CS Hyde, calculated).
Both were run at the same 2.5 m wing:

| film | min pack d195 | all-up | trim | load | hull |
|---|---|---|---|---|---|
| **45 g/m² (sourced laminate)** | **140.2 Wh** | **2.991 kg** | 4.48 m/s | 13.51 W | 3278.3 × 1092.8 mm, 2.050 m³ |
| 70 g/m² (spec assumption) | 250.4 Wh | 4.165 kg | 5.38 m/s | 23.18 W | 3660.9 × 1220.3 mm, 2.855 m³ |
| **difference** | **−110.2 Wh** | **−1.174 kg** | −0.90 m/s | −9.67 W | −0.805 m³ |

```
[min pack d195]  sealed AB b=2.5 laminate45 no satcom: pack   140.2 Wh (0.712 kg) M_allup 2.991 kg
   f=0.800 V 4.48 m/s [best-endurance] load 13.51 W (prop 10.00 + pay 3.51) D_w 0.40 D_e 0.79 N
   cd_vol 0.042 env 2.05 m3 3.28 x 1.09 m min_soc 0.050 closes=True
[min pack d195]  sealed AB b=2.5 spec70 no satcom: pack   250.4 Wh (1.271 kg) M_allup 4.165 kg
   f=0.800 V 5.38 m/s [best-endurance] load 23.18 W (prop 18.85 + pay 4.33) D_w 0.52 D_e 1.34 N
   cd_vol 0.039 env 2.85 m3 3.66 x 1.22 m min_soc 0.050 closes=True
```

**25 g/m² of film assumption is worth 110 Wh of battery and 1.17 kg of aircraft.** The hull
fixed point compounds it: heavier skin → bigger hull → more skin *and* more gas → more drag →
more power → more pack → heavier still. Section 2 blamed the sealed hull mass; this is the proof.

### The recommended sealed build: 3.5 m wing, 45 g/m² laminate

At the 2.5 m wing the sealed aircraft still **never closes equinox** (d80 is energy-negative:
17.38 W × 24 h = 417 Wh vs 392 Wh harvest). Combining the sourced film with the wing the sweep
identified gives the first sealed configuration that does everything:

```
---- laminate45 no satcom, span 3.5 m ----
[min pack d195]: pack 122.4 Wh (0.621 kg) M_allup 3.857 kg f=0.800 V 3.70 m/s load 12.21 W
   (prop 8.08 + pay 4.12) D_w 0.45 D_e 0.65 N cd_vol 0.043 env 2.64 m3 min_soc 0.050 closes=True
   hull 3568.2 x 1189.4 mm = 140.5 x 46.8 in (11.71 x 3.90 ft), 2.643 m3, 10.93 m2 skin, gas 471 g
[min pack d80 ]: pack 203.5 Wh (1.033 kg) M_allup 4.411 kg f=0.800 V 3.96 m/s load 14.77 W
   (prop 10.27 + pay 4.49) D_w 0.51 D_e 0.80 N cd_vol 0.042 env 3.02 m3 min_soc 0.050 closes=True
   hull 3731.5 x 1243.8 mm = 146.9 x 49.0 in (12.24 x 4.08 ft), 3.023 m3, 11.95 m2 skin, gas 539 g
[126 Wh d195 ]: pack 126.0 Wh M_allup 3.882 kg V 3.71 m/s load 12.32 W min_soc 0.068 closes=True
```

**This is the first sealed configuration in the whole study that closes both days.**

### Closure summary — all sealed variants

| span | film | satcom | min pack **d195** | min pack **d80** | 100 Wh @ d195 | 126 Wh @ d195 |
|---|---|---|---|---|---|---|
| 2.5 m | 45 g/m² | no | 140.2 Wh (2.991 kg) | **never** (17.38 W vs 392 Wh) | short 18.5 Wh | short 6.4 Wh |
| 2.5 m | 45 g/m² | +Iridium | 153.3 Wh (3.134 kg) | **never** (16.53 W vs 392 Wh) | short 23.7 Wh | short 11.9 Wh |
| 2.5 m | 70 g/m² | no | 250.4 Wh (4.165 kg) | **never** (16.05 W vs 392 Wh) | short 40.1 Wh | short 30.8 Wh |
| **3.5 m** | **45 g/m²** | **no** | **122.4 Wh (3.857 kg)** | **203.5 Wh (4.411 kg)** | short 14.0 Wh | **CLOSES, SOC floor 0.068** |
| 3.5 m | 45 g/m² | +Iridium | 129.0 Wh (3.954 kg) | 215.9 Wh (4.547 kg) | short 18.0 Wh | short **1.8 Wh** |
| 3.5 m | 70 g/m² | no | 153.5 Wh (4.504 kg) | 276.4 Wh (5.392 kg) | short 30.8 Wh | short 15.7 Wh |

**Cost of Iridium**, measured not assumed: at b=3.5 it is **+97 g all-up, +6.6 Wh of pack at
d195, +12.4 Wh at d80** — and it converts a d195 closure at 126 Wh into a **1.8 Wh miss**. One
extra P28A cell covers it. (The recurring cost is the real objection — see honesty flag H4.)

**Real pack B (121.0 Wh) against the b=3.5 sealed minimum of 122.4 Wh: short by 1.4 Wh.**
So close it is worth saying plainly — 2S7P (14 cells, 141.1 Wh, ~700 g, +$19.90 over pack B)
clears it with margin, or switch to Samsung 50E cells at 232 Wh/kg pack-level.

### SOC floors

`P.SOC_MIN` = 0.05 and the solver clamps there, so `min_soc 0.050` with `unserved > 0` means the
aircraft went *through* the floor — a failure, not a margin. The only sealed points with genuine
reserve are **b=3.5 / 45 g/m² / 126 Wh at d195: min_soc 0.068**.

### Fuselage / boom / tail floor — verified, no unbilled gap

```
  fus/boom/tail floor: v1 carried 0.473 kg -> floor 59.3 g;  v2 carried 1.018 kg -> floor 76.6 g
  (delta +17.3 g, re-evaluated at the new carried mass on EVERY fixed-point iteration and
  already inside the closure above -- no unbilled gap)
```

The floor is a function of carried mass and span, and `certify()` recomputes it on every
iteration of the mass fixed point. The v2 tail is **17.3 g heavier** than v1's and that 17.3 g is
already inside every closure verdict above. **Nothing to bill.**

### Sealed gas ledger — superpressure and 6-month permeation

At the b=2.5 / 45 g/m² design point (2.050 m³, 9.22 m² skin):

```
{
 "fill_superpressure_Pa": 10096.1,
 "peak_day_superpressure_Pa": 19581.1,
 "min_night_superpressure_Pa": 7928.7,
 "permeance_cm3_m2_day_atm": 100.0,
 "loss_180d_m3": 0.1729,
 "loss_180d_frac": 0.0767,
 "superpressure_after_180d_Pa": 1999.4,
 "superpressure_after_180d_cold_night_Pa": -1.8,
 "still_taut_after_180d": false
}
```

**The +10% reserve buys almost exactly 180 days and not one more.** It loses 7.67% of the gas in
six months at the assumed 100 cm³/m²/day/atm, and on a *cold night at day 180* the superpressure
is **−1.8 Pa** — the hull goes slack right at the six-month mark. The 6-month claim is true and
has zero margin. For real margin, carry +15% instead of +10%.

**Structural warning (honesty flag H7):** modelling the reserve as extra *moles in a fixed
volume* produces a **10.1 kPa** fill superpressure rising to **19.6 kPa** on a hot afternoon.
That is a genuine superpressure balloon, twenty to forty times the 500 Pa v1 hull, and the
0.011 kg/m² tendon allowance is an allowance, not a structural design.

### Delta vs the v1 catalogue design (b=3.5 / 45 g/m² / no satcom, d195 point)

| | v1 | v2 sealed (b=3.5) | delta |
|---|---|---|---|
| hull length | 2865.9 mm (112.8 in) | 3568.2 mm (140.5 in) | **+702.3 mm (+27.6 in)** |
| hull diameter | 955.3 mm (37.6 in) | 1189.4 mm (46.8 in) | **+234.1 mm (+9.2 in)** |
| hull volume | 1.3694 m³ | 2.643 m³ | +1.274 m³ |
| wing span | 2.5 m | 3.5 m | +1.0 m |
| cells | 21 | 41 | +20 |
| all-up | 1998.1 g | 3857 g | **+1859 g** |
| pack (d195) | 79.6 Wh | 122.4 Wh | +42.8 Wh |
| trim | 3.80 m/s | 3.70 m/s | −0.10 m/s |
| load | 7.87 W | 12.21 W | +4.34 W |

**In plain terms: sealing it for six months costs you 27.6 inches of hull length, 9.2 inches of
diameter, an extra metre of wingspan, twenty more solar cells, and it nearly doubles the
aircraft's mass.** That is the price of not refilling.

---

## 4. CONFIG 3 — CARGO

Runs: **`V2_14_cargo.py` → `V2_14_cargo.out`, `V2_14_cargo_result.json`** (take 2);
speed sweep from **`V2_12_cargo.out`** (take 1, same aircraft and same model).
Basis: v2 sealed on as-built masses at the sourced 45 g/m² film.

### 4a — 10 lb (4.536 kg) at 61 m (200 ft), 16.1 km (10 mi)

Hull resized to f = 0.80 **with the package aboard**, at a stated nominal 400 Wh pack (a
non-closing point is still a real aircraft — it needs a hull to be reported at all):

```
  cargo10 b=2.5 f=0.80: pack 400.0 Wh (2.030 kg) M_allup 10.736 kg f=0.800 V 8.46 m/s
     [best-endurance] load 122.58 W (prop 114.62 + pay 7.97) D_w 1.33 D_e 5.36 N
     cd_vol 0.033 env 7.05 m3 4.95 x 1.65 m min_soc 0.050 closes=False
   hull 4949.1 x 1649.7 mm = 194.8 x 64.9 in = 16.24 x 5.41 ft; 7.052 m3, 21.02 m2 skin, gas 1312 g
```

**Hull: 4949.1 × 1649.7 mm = 194.8 × 64.9 in = 16.24 × 5.41 ft, 7.052 m³, 21.02 m² of skin,
1312 g of helium.** (The brief expected 5.5–6.5 m³; the honest answer is **7.05 m³** — the extra
comes from the sealed skin and the 10% gas reserve compounding through the fixed point.)

| ledger (b=2.5, f=0.80, 400 Wh) | kg |
|---|---|
| wing structure | 0.738 |
| PV | 0.234 |
| **battery (400 Wh @ 197 Wh/kg)** | **2.030** |
| thruster group (200 W rating) | 0.162 |
| payload / avionics | 0.100 |
| tilt servo + pitot | 0.030 |
| MPPT | 0.057 |
| fuselage / boom / tail | 0.264 |
| film + tapes + tendons | 1.272 |
| helium | 1.312 |
| **CARGO** | **4.536** |
| **ALL-UP** | **10.736** |

**Cruise and power at 61 m: 8.46 m/s, 122.58 W total (114.62 W propulsive).**
**The 16.1 km leg: 0.53 h, 64.8 Wh. Round trip 129.6 Wh against 361.0 Wh of usable pack — it
carries both legs with zero sun.**

**Does the 24 h loop still close with cargo aboard at d195? NO — and not marginally.**

```
   24 h closure WITH the package: False -- unserved 1981.0 Wh/day;
      load 122.58 W x 24 h = 2942 Wh vs harvest 600 Wh
   min closing pack: NONE -- energy-negative: load 73.34 W x 24 h = 1760 Wh vs harvest 600 Wh
```

**Minimum closing pack at f = 0.80: there isn't one, at any size.** Growing the wing to 3.5 m
helps the trim a lot (V 8.46 → 6.44 m/s, load 122.58 → 71.68 W, unserved 1981 → 379 Wh) but still
does not close: 1720 Wh required against a 1176 Wh harvest.

#### Why — and the configuration that *does* loiter with 10 lb

f = 0.80 means the **wing** must fly 20% of an 11 kg aircraft — 2.32 kg of residual weight on
1.02 m² of wing. That is a wing loading the little planform can only meet by flying fast, and
drag goes as V². f is the wrong knob for cargo. Swept at b = 3.5 m:

| f | closes d195? | min pack | all-up | cruise | load | hull |
|---|---|---|---|---|---|---|
| 0.80 | **NO** (1915 Wh vs 1176 Wh) | — | 11.620 kg @400 Wh | 6.44 m/s | 71.68 W | 5081.3 × 1693.8 mm (16.67 × 5.56 ft), 7.633 m³ |
| 0.90 | **YES** | 359.0 Wh | 11.711 kg | 4.46 m/s | 33.93 W | 5298.7 × 1766.2 mm (17.38 × 5.79 ft), 8.655 m³ |
| 0.95 | **YES** | **165.2 Wh** | 10.575 kg | 2.95 m/s | 16.26 W | 5214.6 × 1738.2 mm (17.11 × 5.70 ft), 8.249 m³ |
| 0.98 | **YES** | **128.0 Wh** | 10.422 kg | 2.34 m/s | 12.72 W | 5243.3 × 1747.8 mm (17.20 × 5.73 ft), 8.386 m³ |

**A 10 lb package can be loitered indefinitely — at f ≈ 0.95, on a 165 Wh pack, at 2.95 m/s.**
Going from f = 0.80 to f = 0.95 costs 0.6 m³ of extra hull and *saves* 1.05 kg all-up and 55 W of
cruise power. For cargo the aircraft wants to be an airship that has a wing, not a wing that has a
balloon.

### 4b — 1 lb (0.454 kg) on the UNCHANGED as-built hull

The Config 2 pack-A hull exactly as certified (1.5574 m³, 295.7 g film), package added, hull
**not** resized — so f falls:

| pack | f with 1 lb | cruise | load | closes d195 | closes d80 |
|---|---|---|---|---|---|
| A, 80.6 Wh | 0.663 | 5.67 m/s | 19.21 W | NO, short 111.6 Wh | NO, short 174.6 Wh |
| 98.0 Wh | 0.642 | 5.94 m/s | 21.49 W | NO, short 119.6 Wh | NO, short 190.0 Wh |
| B, 121.0 Wh | 0.616 | 6.28 m/s | 24.63 W | NO, short 132.3 Wh | NO, short 212.8 Wh |

**Does it lift it in daylight? Yes, comfortably.** It trims and flies at 5.7–6.3 m/s drawing
16–21 W of propulsive power against a 100 W drive — roughly 20% of installed thrust. Carrying a
pound is never a lift problem for this aircraft; it is an *endurance* problem.

**Cruise, dash and range** (98 Wh pack; speed sweep from `V2_12_cargo.out`, same aircraft):

```
             V     CL_req   CD    D_wing  D_env   P_prop  P_tot   t(16.1km)  E(Wh)
             6.0   0.910  0.0543  0.593   1.130   18.60   21.79     0.75 h    16.2
             7.0   0.669  0.0392  0.583   1.488   25.59   28.78     0.64 h    18.4
             8.0   0.512  0.0313  0.607   1.890   34.86   38.05     0.56 h    21.3
            10.0   0.328  0.0240  0.729   2.822   61.16   64.35     0.45 h    28.8
            12.0   0.228  0.0207  0.905   3.918   98.90  102.09     0.37 h    38.0
```

- **cruise 5.94 m/s → 16.1 km in 0.75 h on 16.2 Wh**; round trip 32.4 Wh against 88.4 Wh usable
  → both legs on one charge, no sun.
- **dash 12.0 m/s (the fastest point inside the 100 W drive) → 16.1 km in 0.37 h on 38.0 Wh.**
- Below 6 m/s the polar has no valid row at the required CL and the model **refuses** rather than
  extrapolating — those rows are printed as refusals, not filled in.

**Round trips per day:** daylight 15.07 h, harvest 615.9 Wh/day →
**energy-limited 19.0 trips, daylight-time-limited 10.0 trips → the binding answer is 10 round
trips per day** (322 km of delivery flying).

**Does the night loop still close with 1 lb aboard? No.** On the 98 Wh pack it is 119.6 Wh short
at d195. Carrying a pound overnight costs about 12 W of extra cruise power, and that is more than
this airframe's night budget. **The 1 lb aircraft is a daytime shuttle, not a persistent
loiterer** — it must drop the package (or land) before sunset.

For reference, the same aircraft with the package *removed* is only 10.1 Wh short at d195 on the
98 Wh pack — the shortfall there is because the hull was sized at f=0.80 for the 80.6 Wh pack A,
so a heavier pack pulls f down to 0.769. Size the hull for the pack you fly.

### THE DROP PROBLEM — one honest paragraph

**It depends entirely on whether the package is bigger than the residual weight the wing was
already carrying, and the two cases here fall on opposite sides of that line.** For the **1 lb**
package on the as-built hull there is **no drop problem at all**: gross lift is 1.818 kg against
2.378 kg of remaining weight, so releasing it leaves the aircraft 0.560 kg *heavier* than air —
it does not rise, it simply flies more easily as the wing reverts to its design residual (the
0.454 kg package is smaller than the 1.014 kg the wing was already flying). For the **10 lb**
package the line is crossed decisively: gross lift 8.588 kg against 6.200 kg remaining leaves a
**+2.389 kg (23.43 N) net upward force the instant the package leaves**, and an uncontrolled
release means the constant-volume hull must climb until ρ_air = 0.879 kg/m³ — superpressure
rising the whole way, so **the envelope bursts long before equilibrium; release without a
mitigation is hull loss.** The mitigation menu, with numbers: **(a) ballast exchange** — take on
≥ 2.389 kg, i.e. 2.389 L of water, at the drop point; trim is unchanged and the mission
continues; cheapest and simplest, and the only one that scales to repeated drops. **(b)
tilt-prop thrust-down** — holding 23.43 N statically needs the 400 W drive rating (180 g, versus
the 200 W the flight case bills) and burns **398.1 W**, which a full 400 Wh pack sustains for
**54 minutes**; that is a holding action to buy time for a controlled descent, not a fix. **(c)
vent gas** — shedding 2.389 kg of net lift means venting **2.278 m³, 32.3% of the hull**, at
roughly **$97–161 per drop** at welding-refill prices, after which the hull is slack and any
sealed-6-month claim is over; an end-of-mission maneuver only. **Ballast exchange is the only
economically sane answer for a delivery aircraft, and it means every drop point needs water.**

---

## 5. RECOMMENDATION — build this first

**Build the AS-BUILT aircraft (Config 2) with a 98–121 Wh pack.** Concretely: the
**2991 × 997 mm (117.8 × 39.3 in) LLDPE hull**, the existing 2.5 m wing and 21 cells, real BOM
parts, and **pack A grown from 8 cells to 10** (2S5P, 100.8 Wh, ~512 g, +$19.90).

Why this one:

1. **It is the only configuration in this study that is both fully sourced and closes.** Every
   part has a vendor and a price in `BOM_v2.csv`. It closes d195 at 98.0 Wh with the hull resized
   to f = 0.80. Config 1's barrier film is a *specification with no small-lot vendor*
   (honesty flag H2), and Config 3 at the briefed f = 0.80 does not close at all.
2. **The fix is 17.4 Wh and $19.90.** Real pack A misses by 11.6 Wh. That is the cheapest gap in
   the document. Pack B (121 Wh) closes d195 outright with a genuine 0.164 SOC floor.
3. **It is 274 g and 5 inches from the design already drawn, cut and viewable** in
   `FINAL_PRODUCT/` — the STLs, gores and ribs are still the right shape; only the hull scale and
   the pack change.
4. **It de-risks everything else.** The sealed hull, the tilt-thrust servo, the regen ESC and the
   cargo geometry are all *upgrades to this airframe*. Fly it leaky first, refill it every few
   weeks, and learn what actually breaks before committing to a 3.5 m wing and a barrier laminate
   you cannot yet buy in small lots.

**The trade the operator actually has to make — light film + refills vs sealed + a bigger
aircraft:**

| | **light film + refills** (Config 2) | **sealed 6 months** (Config 1, b=3.5, 45 g/m²) |
|---|---|---|
| hull | 2991 × 997 mm (117.8 × 39.3 in) | 3568 × 1189 mm (140.5 × 46.8 in) |
| wing / cells | 2.5 m / 21 | 3.5 m / 41 |
| all-up | **2272 g** | 3857 g (**+1584 g, +70%**) |
| pack (d195) | 98.0 Wh | 122.4 Wh |
| closes equinox? | yes, on 180.3 Wh | yes, on 203.5 Wh |
| helium per fill | 253 g (1.56 m³) | 471 g (2.64 m³) |
| refills | every few weeks (LLDPE) | one fill per ~6 months — with **zero margin** (flag H3) |
| film cost | $66 commodity roll | ~$121 (2 CS Hyde rolls) or quote-only laminate |
| solar cost | $94 | $185 |
| buildable today? | **yes** | film is unsourced in small lots |

**Order of work.** (1) Build Config 2 with the 10-cell pack. (2) Fly it, measure the real helium
loss rate — that number decides whether sealing is worth 1.6 kg. (3) If it is, go to the 3.5 m
wing *and* the barrier film together; neither alone closes equinox. (4) Cargo is a different
aircraft — do not try to grow Config 2 into it; a 10 lb loiterer wants **f ≈ 0.95 and an 8.2 m³
hull**, which is an airship with a wing, not this vehicle.

**What NOT to do:** do not buy party helium (Section 1's negative check — 69% more power, does
not fly), and do not build the sealed hull at the 2.5 m wing (it never closes equinox at any
film weight).

---

## 6. HONESTY FLAGS

**H1 — The party-helium f is 0.703, not the 0.64 the brief predicted.** Net lift per m³ *does*
fall by exactly ×0.8000 (derived: ρ_mix/ρ_air = 0.8·0.13819 + 0.2 = 0.31055). But f = ρ_air·V /
M_allup, and the blend makes M_allup larger, so f does not scale with lift. The conclusion is
unchanged and stronger than the mechanism: **it does not fly.**

**H2 — The sealed config's film is a specification, not a sourced part.** No vendor with
published small-lot pricing sells the heat-sealable PET12/PE30 (or nylon/EVOH) laminate the
45 g/m² ledger assumes. IMPAK, Sorbent Systems, Caltex and Goodfellow all quote-only; Alibaba
mills quote 500–2000 m² MOQ. What *is* purchasable: CS Hyde 25.4 µm metallized PET at $7.83/m²
(35.3 g/m², **calculated** from thickness × density, not vendor-stated) — but it has no sealant
layer, so seams must be taped rather than heat-sealed. **Config 1's headline number rests on a
film you cannot currently buy in the right form.**

**H3 — The 6-month seal has zero margin.** At the assumed 100 cm³/m²/day/atm permeance the hull
loses 7.67% of its gas in 180 days and reaches **−1.8 Pa** superpressure on a cold night at day
180 — it goes slack exactly at the six-month mark. The claim is true and has no reserve. Carry
+15% gas instead of +10% for real margin.

**H4 — Iridium is a subscription, not a part.** The RockBLOCK 9603 is **39 g** including antenna
(vendor-stated), not the briefed 35 g. Recurring: $17.00/mo line rental plus credits at
$0.20–$0.10 each (1 credit = 50 bytes). One position report per hour ≈ $72–144/mo + rental; one
per 15 minutes ≈ $305/mo.

**H5 — The regen ESC is billed at +0 g and that is wrong.** The sourced regen-capable controller
(Flipsky Mini FSESC4.20 50A, VESC 4.12, $56) is **80 g** and replaces the 38 g Skywalker 30A —
a real **+42 g and +$38.68**. It is not in the Config 1 ledger. Adding it costs roughly the same
as the Iridium option (~+6 Wh of pack at d195).

**H6 — The MS4525DO is the wrong sensor for this airframe.** It is ±6895 Pa full scale, and this
aircraft cruises at 3.7–6.3 m/s where dynamic pressure is only 10–24 Pa — far inside a typical
±1% FS error band. Even the recommended DLVR-L10D (±2500 Pa) is marginal. **Airspeed sensing on a
4 m/s aircraft is an unsolved item in this BOM,** not a $50 line.

**H7 — "+10% gas headroom" as modelled makes this a real superpressure balloon.** The runs
implement it as **extra moles in a fixed volume**, giving 10.1 kPa fill superpressure rising to
19.6 kPa on a hot afternoon — 20–40× the 500 Pa v1 hull. The alternative reading (+10% *volume*,
filled at 500 Pa) has nearly the same mass but a vastly gentler structure. The 0.011 kg/m² tendon
allowance is an **allowance, not a structural design**, and no vent/ballonet is designed anywhere
in this study — that remains the single undesigned part gating a real sealed build.

**H8 — Trim solver fallbacks.** Most points solved with `bounds.reference_trim`
(`[best-endurance]`). The as-built pack-A point at d195/d80 fell back to the certified fast-trim
(`[fast-trim V=4.0]`) after the reference solver refused; that is the same fallback that
certified v1's pack B, not a new model. In the 1 lb speed sweep, points below 6 m/s are printed
as **refusals** — the polar has no valid row at the required CL and nothing was extrapolated.

**H9 — Superheat comes from a sphere thermal model on an ellipsoid hull.** The +25.6 K day /
−5.85 K night excursion driving the superpressure ledger is inherited from v1's
`BuoyancyVolume._thermal_step`, which is spherical. Carried forward with the same caveat v1
stated.

**H10 — Pack B is 121.0 Wh, not the 125.5 Wh v1 certified.** Twelve P28A cells land 3.6% short;
that shortfall is carried honestly through every pack-B number here rather than rounded up.

**H11 — The prop is 0.30 m in every configuration, including the 5 m-span and 10 lb cargo
cases.** The drive *rating* steps on the {100, 200, 400, 800} W ladder and the extra drive mass is
billed, but the propeller diameter is held at the v1 value. A real 11 kg cargo aircraft would want
a bigger disc; treating that properly would *improve* the cargo numbers, so the cargo results here
are conservative on this axis.

**H12 — Tendon mass is scaled, not designed.** 0.01102 kg/m² of hull skin, calibrated so a ~9 m²
sealed hull carries the 100 g the v2 spec allowed. It is applied by area so the big hulls do not
get a silent discount, but it is not a structural sizing.

**H13 — Wing structural mass is the Stender regression calibrated to one aircraft**
(AtlantikSolar AS-2, 1.478 kg/m²). It is range-checked and refuses outside the built envelope
(span ≤ 80 m, AR ≤ 40), and every span in the sweep is well inside it — but 3.5–5.0 m spans at
4–7 kg all-up are an interpolation on a single anchor, not a structural analysis.

**H14 — A transient package break interrupted this study and was reported, not worked around.**
The first cargo run died on `ImportError: cannot import name 'AMPRIUS_CYCLE_PREFACTOR'` while
another workflow was mid-edit in `aerosim/vehicle/electrochem/`. The harness retried five times at
120 s. The other workflow then landed its barrel fix, the import went green, and the run was
repeated intact. **No package file was touched by this study**, and no result was salvaged from
the broken interval.

---

## 7. Files

| file | what |
|---|---|
| `V2_00_common.py` | shared harness over `HYBRID_common` / `HYBRID_piecewise`; bounded RAM gate; span/area parameterisation |
| `V2_10_asbuilt.py` / `.out` / `_result.json` | **Config 2** — as-built + party-helium negative check |
| `V2_11_wing.py` / `.out` / `_result.json` | wing-growth sweep 2.5 → 5.0 m |
| `V2_13_sealed.py` / `.out` / `_result.json` | **Config 1** — sealed, 2 film weights, ± Iridium, 2 spans |
| `V2_14_cargo.py` / `.out` / `_result.json` | **Config 3** — 10 lb, f sweep, 1 lb, drop problem |
| `V2_12_cargo.out` | cargo take 1 — the 1 lb speed/dash sweep quoted in §4b |
| `FINAL_PRODUCT/BOM_v2_deltas.csv` | new parts, real part numbers, vendors, prices |
| `FINAL_PRODUCT/design_snapshot.json` | the v1 baseline every delta is measured against |

Superseded: `V2_01_certify.*`, `V2_01b_followup.*`, `V2_02_asbuilt.*` (prior attempts; `V2_02`
certified "as-built" on sealed-hull defaults — see the correction box in §1).
