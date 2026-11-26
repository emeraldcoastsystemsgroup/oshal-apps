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
- **The four shipped presets are certified on the real chain (1.4.0) and all four fail, each for a
  structured reason** (the engine's `certify` command, `engine/certify_reference.py`, reasons from
  the closed set in `engine/aerosim/validity.py`, measured 2026-09-27 on fingerprint
  `7cb4ddce5d711136`): `tier1` and `hybrid80` `negative_airframe_mass` (the catalogued real parts
  outweigh the all-up mass the vector bills), `fixedwing` `soc_not_persistent` (1.0000 -> 0.9318 over
  24 h, certified aero), `r7winner` `param_out_of_bounds` (declared cell efficiency 0.2918 outside the
  C60 diode band [0.2240, 0.2440]). `engine/tests/test_reference_certification.py` pins these
  outcomes, so a re-sized candidate moves that record and the README together.

**Done when:** a real candidate passes cases A-D and the 72 h mission with certified aero, zero
unserved bus demand, SOC persistence and all mass/technology bounds; then make that validated real
chain the default and regenerate the recorded outputs with explicit provenance.

---

## B. Engine resolution — CLOSED 2026-09-16 (the vendored engine is the default)

The package points at an engine tree via `AERO_LAB_ENGINE_DIR`. Two trees exist and they disagree:

| tree | fingerprint | behaviour |
|---|---|---|
| vendored snapshot (`aero-lab/engine/`) | `7cb4ddce5d711136` | the ideal `evaluate` answers all four presets (fixedwing and r7winner close); the real-chain `certify` fails all four for structured reasons (section A) |
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

**The gate itself exists (1.4.0):** every export carries a `buildCertification` block in
`design_snapshot.json` and `BUILD_SHEET.md` that reads **not certified** and lists the pressure,
material, purity and mass evidence the exported design needs; `engine/build_certification.py`
`reconcile_build_evidence(snapshot, evidence)` is the only path to certified, and each fact below is
one of its refusal cases in `engine/tests/test_build_certification_gate.py`. What stays open is the
physical evidence, not the rule.

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
  ideal chain and is not a valid ranking once section A closes. The driver now ships:
  `engine/sweep_real.py` (seeded sha256 sampler over `service.BOUNDS` with the seed and sample hash
  in the header, `build_solar_cruise(chain="real")`, structured reasons, every record stamped with
  the tree fingerprint, resumable JSONL, `verify_survivor` on the top-N;
  `engine/tests/test_sweep_real_determinism.py`). On the pinned 20-design subset every design
  refused at build (11 `pack_claim_outside_catalogue_band`, 6 `technology_beyond_catalogue`,
  3 `param_out_of_bounds`; `engine/TEST_STATUS.md`).
  **Done when** the 30k run is complete and recorded with its fingerprints:

  ```sh
  cd aero-lab/engine
  .venv/Scripts/python.exe sweep_real.py --out output/sweep-real-30k.jsonl --n 30000 --seed 20260927 --resume
  .venv/Scripts/python.exe sweep_real.py --out output/sweep-real-30k.jsonl --n 30000 --seed 20260927 --resume --verify-top 10 --report
  ```

  (`output/` is gitignored store-wide), and `engine/TEST_STATUS.md` carries the report (outcome
  counts, reason-code histogram, top-N with their verify records) against the header's
  `treeFingerprint`.
- **`node scripts/check-store-separation.mjs .` fails repo-wide** on a top-level `_walkthrough-shots/`
  directory (gitignored screenshot debris). Pre-existing and unrelated to this package; aero-lab
  itself passes.

---

## E. The engine container is installed and updated by hand — DONE 1.4.7

**Done (1.4.7):** `src-routes/engine-installer.ts` (`EngineAutoInstaller`) and `src-routes/engine-adapter.ts` now automatically run `engine/install-engine.sh` on the first missing or out-of-date container call whenever a Docker socket is reachable (`AERO_LAB_AUTO_INSTALL=0` disables), coalescing concurrent calls behind a single-flight lock with a post-failure cooldown and retrying once after a successful build/start/selftest. On the native Rust kernel (`oshald`), `GET /capabilities` also probes `engine.status` (`nativeStatus(ctx)`) to trigger lazy image preparation without starting a container. When no Docker socket is reachable or `install-engine.sh` fails, the refusal path is unchanged (`capability_unavailable`, `capabilities: null`, the exact `installHint` command, zero fabricated numbers). Guarded by `tests/aero-engine-auto-install.test.cjs`.

---

## F. The Floater record (ADR-160 S4) — what 1.3.0 left open

1.3.0 put a record around the generator (`GET /api/aero-lab/vehicles`, `migrations/001-aero-lab.sql`):
the Floater reads `sized` at the committed vector with evaluation 1 (the export run) behind it, and
the mass budget is **red at +274.3 g** — real parts (`V2_CONFIG.md` as-built 2272.4 g) against the
certified ledger (`BOM.csv` 1998.1 g). Open:

- **The budget has to close before `parts-complete`.** Re-size the design vector at the real parts
  (section A's real-chain promotion is the same work seen from the engine side), record the
  evaluation at that vector through the record, and the check goes green. Done when an evaluation at
  the current vector carries a green budget check and the stage reads `parts-complete`.
- **A new export run is not yet recorded as an evaluation.** `POST /export` still writes files to a
  per-run temp dir and forgets them; the record's evaluation 1 is the committed folder read back.
  Done when an export run posts itself as evaluation N with the same fingerprints and hashes.
- **No parts model.** `parts-complete` also needs every part printed (material, print notes, mass, a
  CAD program) or bought (mass, price, a source line); `BOM_v2.csv` is the bought half as prose.
- **The cross-lab shape guard (ADR-160 S5b).** The record's column set, the stage enum and the medium
  ids here must not drift from ocean-lab's record when it lands; a read-only store-root check, not a
  runtime import.

---

## The assistant cannot call its route-backed tools yet (2026-10-06) — DONE (CLOSED 2026-11-19, 1.4.7)

**CLOSED 2026-11-19 (version 1.4.7).** The 2026-10-06 `401` refusal occurred on the retired TypeScript core before `oshald` (`package_api_tools.rs`) executed route-backed `executorType: api` tools directly under the caller's verified principal (`200 OK`, zero `401`). `1.4.7` declares explicit `posture: inline` + `chatBot: aero-designer`, adds an explicit object `inputSchema` to `aero-capabilities`, verifies `personas/aero-designer.yaml` plain-prose and ```` ```tool_call ```` `{"tool": ...}` rules, and guards the manifest, persona, and route handler execution in `tests/aero-bot-tools-contract.test.cjs`.

## Future: ADR-149 `authorization.yaml` catalog adoption (coordinated migration)

Adopting an ADR-149 `authorization.yaml` catalog + `builtinKey: package` tools requires coordinated operator role migration so active production `@app-admin` role assignments for `aero-lab` are not locked out.
