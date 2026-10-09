# Aero Lab engine test status — 2026-09-27

This is the retained verification record for the vendored engine under `aero-lab/engine`, run with
the engine venv's `python.exe` (Python 3.11.9). The 2026-09-27 section is newest; the 2026-08-06
accepted-state and backlog-cleanup record follows it unchanged.

## 2026-09-27 — real-chain certification, structured reasons, anchors, build gate, sweep driver

Engine fingerprint `7cb4ddce5d711136` (`service._fingerprint()`), aero-lab 1.4.0. The collection is
now **376 tests** (`pytest --collect-only`): the 320 below plus 56 new.

| Command scope | Result | Elapsed |
|---|---:|---:|
| accepted-state + mission flight + electrochem ECM | 56 passed | 67.58 s |
| real-drive authority + parameter bounds + mass closure + materials + no-free-energy + aging | 96 passed | 71.03 s |
| aeropolar robustness + billing + floors + harness | 43 passed | 142.51 s |
| BEMT + PV/MPPT + screen + solver validity + UIUC + usable ledger + wing mass + hull/permeation | 79 passed | 88.10 s |
| sweep integrity + adversarial validation gate + export mesh | 46 passed | 69.87 s |
| validity reasons + reference certification + anchors + build certification + fingerprint docs | 45 passed | 179.94 s |
| real-chain sweep determinism (pinned 20-design subset + `verify_top`) | 11 passed | 492.47 s |
| **Total** | **376 passed** | |

The five legacy partitions ran before `integrate.py`'s import gained its flat-layout fallback (the
direct `python aerosim/integrate.py` self-test had started failing on the new relative import). After
that one-import change: the self-test reports `RESULT: 20 passed, 0 failed, out of 20 checks`, the
integrate-dependent suites (accepted-state, solver validity, screen, sweep integrity) rerun
`27 passed in 107.34s`, and the new suites above ran on the final tree. The complete Aero Lab vitest
run (routes, surface, adapter, container, dir resolution, parity, vehicle record, live engine) is
`Tests 93 passed (93)` in 8 files; the vehicle-RLS suite needs the disposable PostgreSQL fixture and
was not rerun (migration and store unchanged).

**Measured outcomes on the real chain** (`certify`, 24 h / 60 s, the evaluate chain's window):

| preset | outcome | first structured reason |
|---|---|---|
| tier1 | fail (build) | `negative_airframe_mass`: elements 1.6619 kg vs as-flown 1.5890 kg, remainder -0.0728 kg |
| fixedwing | fail (flight) | `soc_not_persistent`: 1.0000 -> 0.9318, min 0.1873, certified aero, pack nca_21700 6s6p 633.6 Wh |
| hybrid80 | fail (build) | `negative_airframe_mass`: elements 1.6619 kg vs as-flown 1.5047 kg, remainder -0.1572 kg |
| r7winner | fail (build) | `param_out_of_bounds`: PVArrayDiode.cell_efficiency_stc 0.2918 outside [0.2240, 0.2440] |

The public `evaluate` (ideal chain, unchanged) on the same presets: fixedwing closes (min SOC
0.3600, usable 1.0446), r7winner closes (0.4366, 1.0586), tier1 and hybrid80 do not (both 0.0500).
The live adapter still reproduces the R7 default at min SOC 0.4365 / usable 1.0586, so the reason
codes changed no verdict.

**Named anchors** (`tests/test_verification_anchors.py`): cold usable/R_int, C60 worst-bin STC MPP,
He permeation through 38 um LLDPE, and the mission ledger reconciled on the REAL chain (DESIGN_A,
3 h from sunset): drive chain useful + prop + motor + ESC + harness equals the drive's electrical
energy within 1 % with zero unattributed energy; a 6 h probe of the same path reconciled to
4.9e-6 relative.

**Sweep driver** (`sweep_real.py`): on the pinned 20-design subset (seed 20260927) every design
refused at build: 11 `pack_claim_outside_catalogue_band`, 6 `technology_beyond_catalogue`,
3 `param_out_of_bounds`. The 30k run has not been launched (BACKLOG section D has the command).
Because nothing on that subset passes, `verify_top` is driven by two crafted-pass files over the
fixedwing preset vector: the fresh-subprocess verdict reproduces the in-process real-chain score
(not closed, min SOC 0.1873, `soc_not_persistent`; the ideal chain would close it at 0.3600), one
verify record is appended for the top pass only, and `agrees` follows the record's metrics both
ways. The determinism row above is the rerun with those two cases on a loaded host; the two
cases alone took 172.07 s.

**Mutation proofs** (each applied to the tree, the focused guard run, the exact bytes restored):

| mutation | guard result |
|---|---|
| one byte appended to `aerosim/aeropolar.py` | fingerprint docs: 2 failed, 1 passed |
| drop the `unmet_thrust` code emission in `integrate_energy` | validity reasons: 2 failed (13 reasons.append vs 12 codes.append) |
| raise the mass-closure refusal without its reason | reference certification: 2 failed (tier1 becomes `error`) |
| ignore helium purity in the gate | build certification: 1 failed (party helium certified) |
| export block says certified | build certification: 1 failed |
| BOM helium back to "balloon-grade He fill" | build certification: 1 failed |
| resume ignores a stale tree fingerprint | sweep determinism: 1 failed |
| no mid-run tree check | sweep determinism: 1 failed |
| `verify_top` drops `chain="real"` | sweep determinism: 2 failed (the verdict closes on the ideal chain) |
| `verify_top` writes `agrees: true` regardless | sweep determinism: 1 failed, 1 passed |
| LLDPE helium permeability doubled | anchors: 1 failed (0.0693 vs 0.034 +-10 %) |
| one preset number drifted in `reference_presets.json` | surface contract (vitest): 1 failed, 15 passed |

## 2026-08-06 record

### Result

The original cleanup baseline collected **308 tests**. All 308 passed in bounded, non-overlapping
module partitions:

| Tests | Result | Elapsed |
|---|---:|---:|
| accepted-state integration | 3 passed | 94.79 s |
| solver validity + electrochem ECM + hull permeation/UV | 56 passed | 22.35 s |
| mission flight | 20 passed | 28.83 s |
| aeropolar robustness + billing + floors + harness | 43 passed | 224.90 s |
| mass closure + materials + no-free-energy + pack aging + parameter bounds | 90 passed | 72.31 s |
| BEMT + PV/MPPT + screen + UIUC integrity + usable ledger + wing mass | 56 passed | 95.57 s |
| sweep integrity | 6 passed | 34.80 s |
| validation gate | 34 passed | 102.87 s |
| **Total** | **308 passed** | **676.42 s partition total** |

The monolithic command was also attempted with a 600-second ceiling and timed out without a test
result. That is aggregate runtime, not an untested gap: the partitions above are the same complete
collection and each completed with exit code 0. The mission-test harness bypasses only the
production free-RAM wait; this host had 0.77 GB free, which otherwise added 180 seconds to each
mission invocation. Production `_footprint_guard()` remains enabled and unchanged.

### Follow-on parity and export verification

The browser/server parity and STL self-intersection work added six engine tests, so the current
collection is **314 tests** (`pytest --collect-only`, 2026-08-06). Every test in that collection has
passing evidence: the 308-test baseline above plus the new six-test module. The directly affected
legacy gates were also re-run independently after the change:

| Tests | Result | Elapsed |
|---|---:|---:|
| export mesh validation + production-resolution boundary sweep | 6 passed | 25.03 s |
| sweep integrity / mutation isolation | 6 passed | 54.02 s |
| adversarial validation gate | 34 passed | 118.44 s |
| complete Aero Lab Vitest suite (routes, surface, adapter, parity, live engine) | 44 passed | 70.36 s |

The 46-test combined Python invocation hit a 300-second host-contention ceiling without producing a
result; its three constituent modules then passed independently as listed above. The focused
browser/server comparison executes both shipped runtimes over four shared vectors and holds span,
mean chord and pack capacity to `1e-12` relative/absolute tolerance, including the legal input-box
corner where raw span exceeds the server's 79.9 m ceiling.

### Real-drive assembly and storage-authority verification

The real-drive slice adds six focused tests, bringing the engine collection from 314 to **320
tests**. It closes architecture without disguising candidate performance:

| Command scope | Result | Elapsed |
|---|---:|---:|
| real-drive authority + existing 72 h real-pack guard | 7 passed | 34.72 s |
| mission flight + electrochem ECM + accepted-state integration | 56 passed | 158.26 s |
| DESIGN_A real chain, 600 s / 60 s accepted steps | certified run | 48.10 s |
| DESIGN_A real chain, 72 h / 600 s accepted steps | certified, correctly not closed | 49.09 s |

The 72 h diagnostic used the shipped `build_solar_cruise(DESIGN_A, chain="real")` assembly and
`integrate_energy`, not a stand-in. It completed 432 accepted PackEcm intervals with zero unmet
thrust and zero uncertified aero steps. The honest verdict remains red: minimum SOC `0.0920`,
endpoint `1.0000 -> 0.9307`, so `closed=False` with reason `accepted real-ECM state of charge does
not return`. The result is retained here and in `../BACKLOG.md` rather than converting a successful
execution into a false persistence claim.

After registering the new public elements with the reflection-based bound guard, the complete
**320-test** collection passed across retained partitions. Counts below are unique; focused reruns
also repeated the affected guards after each hardening change:

| Current collection partition | Result | Elapsed |
|---|---:|---:|
| mission flight + electrochem ECM + accepted-state integration | 56 passed | 158.26 s |
| real-drive authority (also covered by the final authority/parameter rerun) | 6 passed | 34.28 s combined rerun |
| aeropolar robustness + billing + floors + harness | 43 passed | 482.24 s |
| mass closure + materials + no-free-energy + aging + parameter bounds | 90 passed | 278.06 s |
| BEMT + PV/MPPT + screen + solver/UIUC/ledger/wing integrity | 79 passed | 379.78 s |
| sweep integrity + adversarial validation + export mesh | 46 passed | 392.65 s |
| **Total unique collection** | **320 passed** | **all partitions exit 0** |

The generic guard usefully found one constructor-order defect while onboarding BEMTThruster:
`n_rotors=+/-inf` reached `int()` before the finite range check and leaked `OverflowError`. The
constructor now routes those inputs through `ParamBoundsError`; its focused module passes 19 tests
and the 90-test adversarial partition above confirms the repair.

The final hygiene pass also made explicit Ns/Np topology fail before integer conversion. The
combined authority/parameter rerun passed **25 tests in 34.28 s**, including fractional, NaN and
infinite topology probes; this did not add a test function, so collection size remains 320.

### Expected warnings

- `IdealChemistryWarning` remains visible wherever legacy/reference builders deliberately default
  to the ideal bucket. The real ECM authority now exists behind an explicit chain choice; selecting
  and validating the candidate that can replace the ideal default remains in `../BACKLOG.md`
  section A.
- `test_aeropolar_robustness.py` is dual-use: its checks return evidence strings to its standalone
  reporter, so current pytest emits `PytestReturnNotNoneWarning`. The assertions all ran and passed.

### Newly pinned boundaries

- BEMT thrust, torque and efficiency converge at 25/51/101 radial stations under a measured
  absolute-plus-relative swirl tolerance.
- The real Floater f = 0.2/0.4/0.6/0.8 sweep converges at the unchanged `1e-8` relative trim
  tolerance; rejected probes consume no envelope time.
- Floater 4.4 and 4.5 m/s points certify both live Reynolds brackets without widening a gate.
- A 72-hour cold mission advances exactly 864 accepted real-pack electrical steps and 864 thermal
  steps, returns the live PackEcm SOC, produces a non-constant temperature trace and bills non-zero
  heater energy.
- The real builder has exactly one storage authority and explicit, non-duplicated diode-PV,
  heater/parasite and BEMT/motor/ESC/harness components; the ideal builder stays explicitly named.
- BEMT drive power is strictly ordered shaft < motor < ESC < bus, includes positive harness loss,
  respects the actuator-disk floor, and cannot ask a battery-direct PWM ESC to boost voltage.
- UIUC inputs match their SHA-256 manifest, fail on a one-byte mutation and cannot be silently
  overwritten after drift.
- The mutation audit runs only in disposable copies; concurrent live-tree fingerprints and screen
  verdicts remain unchanged.
- Intersecting closed edge-manifold shells are rejected before STL write, coplanar overlap is
  detected, and five nominal/boundary wings pass at the production chordwise resolution.
