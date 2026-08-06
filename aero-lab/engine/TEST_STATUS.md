# Aero Lab engine test status — 2026-08-06

This is the retained verification record for the accepted-state and backlog cleanup. It covers the
vendored engine under `aero-lab/engine` using `.venv/Scripts/python.exe`.

## Result

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

## Follow-on parity and export verification

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

## Real-drive assembly and storage-authority verification

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

## Expected warnings

- `IdealChemistryWarning` remains visible wherever legacy/reference builders deliberately default
  to the ideal bucket. The real ECM authority now exists behind an explicit chain choice; selecting
  and validating the candidate that can replace the ideal default remains in `../BACKLOG.md`
  section A.
- `test_aeropolar_robustness.py` is dual-use: its checks return evidence strings to its standalone
  reporter, so current pytest emits `PytestReturnNotNoneWarning`. The assertions all ran and passed.

## Newly pinned boundaries

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
