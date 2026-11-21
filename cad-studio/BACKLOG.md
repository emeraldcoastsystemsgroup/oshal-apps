# CAD Studio — backlog

Each entry has done-when criteria. An entry is open until its status line says otherwise; the
README and ARCHITECTURE describe only what is built.

## B1 — Sketch-driven features: revolve, sweep, loft — DONE (CAD Studio 0.5.4)

The kernel does them; the contract exposes and verifies them end to end.

Done when: `revolve` (sketch + axis + angle), `sweep` (profile + path polyline) and `loft`
(two or more sketches at offsets) are feature types in both `cad_worker.py` and
`feature-contract.ts`, each with a real-kernel test to an analytic volume and a contract test
naming the field on refusal.

**Done (0.5.4):** Real-kernel execution completed and verified 100% green inside `oshal-cad-studio-engine:local` (CadQuery 2.8.0 / OCCT 7.9, matching `cad-studio/engine/cad_worker.py` byte-for-byte):
- **Real-kernel suite (`engine/tests/test_cad_worker.py`):** `28/28` PASS (`Ran 28 tests in 2.133s — OK`), including all 10 `SketchFeatures` cases:
  - `revolve`: `test_revolve_touching_the_axis_cuts_a_cylinder`, `test_revolve_annulus_is_pappus`, `test_revolve_about_the_planes_first_axis`, `test_revolve_partial_angle` (90° quarter cylinder) — all verified to analytic volume within `1 mm³`.
  - `sweep`: `test_sweep_straight_path_is_a_prism`, `test_sweep_mitred_corner_is_area_times_centreline` — both verified to analytic volume and extents.
  - `loft`: `test_loft_between_two_squares_is_a_frustum`, `test_loft_three_ruled_sections_are_two_frustums` — both verified to analytic frustum volumes and extents.
  - Refusals & capabilities: `test_worker_refusals_are_per_feature` (4 per-feature worker refusals) and `test_hello_publishes_the_new_types_and_plane_axes` (`revolve`, `sweep`, `loft`, `planeAxes`, `maxSections`).
- **Contract & parity suites (`node --test "tests/*-*.test.js"`):** `65/65` PASS, including `tests/contract-features.test.js` (17 revolve/sweep/loft refusal cases each naming its exact field, plus source parity against `cad_worker.py` `FEATURES` and `PLANE_AXES`) and `tests/worker-logic.test.js` (every revolve/sweep/loft refusal caught before invoking the kernel).

## B2 — Click-to-place in the viewer

The form takes numbers; a tap on the model should fill them in.

Done when: the WebGL viewer reports the picked point and face normal on click, the feature form
pre-fills `x`/`y`/`z` and `axis` from it, and a browser fixture proves a hole placed by click
lands within one STL tolerance of the picked point.

**Status (2026-09-14): open, blocked on a core change.** The viewer is core's shared
`src/shared/ui/js/stl-viewer.js`: it publishes `OSHALStlViewer = { apiVersion: 1, mount, parseStl }`
and `mount()` returns `{ load, clear, resize, parseStl, dispose }` — no pick and no camera, so the
package cannot ray-cast a click itself. First step: a core viewer API version 2 with a pick
(screen point → model point + face normal), approved as a core change. The package half is then
small: `tools/cad-studio-gl.js` adapts it, the form pre-fills, and
`tests/surface-lifecycle.core.fixture.mjs` already serves the core viewer with a synthetic STL.

## B3 — Send an STL to Scan to Print for printing — DONE (CAD Studio 0.5.2)

**Done (0.5.2):** CAD Studio now declares `artifacts.provides` (`GET /api/cad-studio/artifacts`, caller-scoped `{ items, folders, nextCursor }` with `Cache-Control: private, no-store` for built revision STL/3MF/OBJ/STEP files), loads `/api/artifacts/send-to.js`, and renders **"Print in Scan to Print"** with ADR-139 `data-artifact-source` / `data-artifact-type="model/stl"` / `data-artifact-name` attributes on every revision row in `#revisions`. Clicking **Print in Scan to Print** opens the Print sheet targeted to that revision and hands the STL to Scan to Print's `/api/scan-to-print/service/print` (`multipart` field `model`) behind explicit user confirmation (`app.ask(...)`), keeping auto-start governed by Scan to Print's printer settings. Guarded by `tests/b3-print-handoff.test.js`. (Note: Scan to Print's own `artifacts.accepts` remains `image/*` for photo-scan jobs; direct STL printing uses Scan to Print's `/api/scan-to-print/service/print` endpoint.)

## B4 — Threads and text — DONE (CAD Studio 0.5.5)

Done when: `thread` (ISO metric profile on a hole or boss, by nominal size and pitch) and `text`
(embossed / debossed, a bundled font) are feature types with real-kernel tests and the STL of a
threaded boss passes the mesh validator.

**Done (0.5.5):** Implemented end-to-end across `engine/cad_worker.py`, `src-routes/feature-contract.ts` (+ compiled `routes/feature-contract.js`), `src-routes/engine-build-hash.ts`, `engine/container/cad_engine_bridge.py`, `tools/cad-studio.js`, `personas/cad-studio-designer.yaml`, and verified on the real OCCT kernel inside `oshal-cad-studio-engine:local`:
- **Bundled open-licensed font:** Shipped `engine/fonts/LiberationSans-Regular.ttf` (SIL Open Font License 1.1) alongside `engine/fonts/LICENSE.txt`, hashed in `RUNTIME_FILES` by both `engine-build-hash.ts` and `cad_engine_bridge.py` and advertised as `bundledFont` in `hello()` and `/capabilities`.
- **`thread` (ISO 68-1 metric helical thread on external boss or internal hole):** Validates `kind` (`external|internal`), `nominalDiameterMm` (`2..200`), `pitchMm` (`0.35..6.0`, `< nominalDiameterMm * 0.5`), `lengthMm` (`1..300`, `>= pitchMm`), `axis` (`x|y|z`), `x/y/z/from`, `handedness` (`right|left`), and `clearanceMm` (`0..0.5`). Sweeps a true 60° truncated ISO metric profile with an axial guide spine (`mode=aux_spine, isFrenet=False`), fuses onto the core before clipping to exact length for clean planar end caps.
- **`text` (embossed / debossed):** Validates `text` (`1..64` printable trimmed chars), `sizeMm` (`2..200`), `depthMm` (`0.2..50`), `mode` (`emboss|deboss`), `face` (`top|bottom|front|back|left|right`), `x`, `y`, and `angleDeg` (`-360..360`), rendering with `Workplane.text(..., fontPath=BUNDLED_FONT_PATH)` and non-coplanar face overlap.
- **Real-kernel & mesh-validator proof:**
  - `engine/tests/test_cad_worker.py`: `34/34` PASS (`4.811s`) inside `oshal-cad-studio-engine:local` (CadQuery 2.8.0 / OCCT 7.9), including 6 new `ThreadAndTextFeatures` cases covering M10×1.5 external boss, M8×1.25 left-hand clearance boss on X, M10×1.5 internal hole, embossed top text (`vol > 32000`), debossed angled front text (`vol < 32000`), and per-feature refusals.
  - Threaded M10×1.5 boss STL (40×40×20 base + 10 mm M10×1.5 external boss) cross-validated directly against `scan-to-print/routes/engine/geometry/mesh-validate.js` (`validateMesh`): `valid: true`, `watertight: true`, `boundaryEdges: 0`, `nonManifoldEdges: 0`, `openEdges: 0`, `consistentWinding: true`, `outwardFacing: true`, `degenerate: 0`, `eulerCharacteristic: 2`, `volumeMm3: 32651.233`, `8144` triangles.
  - Node suites (`tests/*-*.test.js` + `tests/audience-view.test.cjs`): `72/72` PASS, including `tests/b4-thread-text-mesh.test.js`, expanded `tests/contract-features.test.js`, and pre-kernel refusal checks in `tests/worker-logic.test.js`.

## B5 — Per-feature timing budget and cancellation — DONE (CAD Studio 0.5.3)

A very slow boolean on a large mesh base holds the worker for the whole request timeout.

Done when: the worker reports per-feature `ms` (it does) AND refuses a single feature past a
configurable budget with a `budget_exceeded` status, and the api exposes a cancel that closes
the connection mid-rebuild and records the last good revision.

**Done (0.5.3):** Completed end-to-end across worker, bridge, native/socket engine client, rebuild service, UI, and real-kernel verification:
- **Worker & real-kernel proof:** `cad_worker.py` enforces `featureBudgetMs` (whole ms, `1..600000`), returning `{ok:false, code:"budget_exceeded", ms, error}` and discarding the slow feature's result while continuing subsequent features. All 28 real-kernel tests in `engine/tests/test_cad_worker.py` (including all 4 `FeatureBudget` cases) passed (`28/28`) inside `oshal-cad-studio-engine:local`.
- **Bridge kill-on-close & native cancellation:** `EngineClient` supports tagged cancellation in both TCP socket mode (closing the connection so `cad_engine_bridge.py` `Session.close()` / `stop_worker()` SIGKILLs the hung worker process group and frees its slot) AND native `engine.exchange` mode (aborting the active build immediately, freeing the active slot, discarding any late reply, and recording the cancel while preserving `lastGoodRevision`). `rebuildModel` surfaces structured `budgetExceeded` entries naming `featureId`, `index`, and `ms`.
- **UI:** `tools/cad-studio.html` and `tools/cad-studio.js` render per-feature `ms` badges (highlighting `budget_exceeded` overruns), expose the configurable `#feature-budget-ms` input in Base settings with dirty-draft preservation, and show **Stop rebuild** (`POST /models/:id/cancel`) while a rebuild is in flight.
- **Evidence:** `tests/b5-budget-cancel.test.js` (`4/4`, including real `cad_engine_bridge.py` SIGKILL of a hung worker PID + slot release, native `engine.exchange` cancel + late-reply discard, `budgetExceeded` telemetry, and UI checks), `tests/engine-client.test.js` (`11/11`), `tests/worker-logic.test.js` (`4/4`), `tests/routes.core.test.js` (`12/12`), and `engine/tests/test_cad_worker.py` (`28/28` in `oshal-cad-studio-engine:local`).

## B6 — Store-side execution of the framework-coupled suite and the real-kernel suite — CLOSED 2026-09-14 (manual gate)

`tests/routes.core.test.js` needs a core checkout; `engine/tests/test_cad_worker.py` needs the
engine image. Both are excluded from the store-CI wildcard and registered in the Test Lab with
their real prerequisites.

Done when: both are registered with the store's framework-coupled runner (or an equivalent gate)
and a red case fails a PR.

**Resolved 2026-09-14 — the operator decided: no paid CI; gates run manually.** So "a red case fails a PR"
through billed GitHub Actions is off the table by decision, and the equivalent gate is the manual
framework-coupled runner, `scripts/security/run-framework-coupled-tests.mjs` (run by
`.github/workflows/security.yml`, `workflow_dispatch`, or locally:
`node scripts/security/run-framework-coupled-tests.mjs --store . --framework <core>`).

That runner now discovers every `<package>/tests/*.core.test.js` by glob — cad-studio's `routes.core.test.js`
among 14 across 8 packages — runs each against the framework checkout, names every red suite, and refuses
to pass when it finds none. Wiring cad-studio in exposed that NO framework-coupled suite had been run by any
gate; one (daily-trade-recap) had been red for hours unnoticed. Against the real store and core: 14 suites
GREEN. It also fixed an exit-code trap: a `node --test` child inheriting `NODE_TEST_CONTEXT` reports a
failing suite as exit 0.

Still manual by design: the real-kernel suite (`engine/tests/test_cad_worker.py`) needs the engine image,
so it is run with the engine container, not by the node gate.

Split out, not part of B6: 20 Test Lab prerequisite declarations across store catalogs
(`framework-checkout:oshal-core-dir` ×16, `framework-checkout:oshal-core` ×4) name something core's node
runner does not recognise — it knows only `fixture:core-checkout` — so `packageTestRecipePending` holds those
cases pending forever and the Lab never runs them. **Fixed 2026-09-14** (`fix/test-lab-core-checkout-vocabulary`): node-test cases now declare `fixture:core-checkout` and browser cases `harness:oshal-core-root`; 16 of the 20 can run. This package's browser case is B7.

**Original status (2026-09-14): open — needs an operator decision on CI minutes; not unblocked.**
- The store's framework-coupled runner (`scripts/security/run-framework-coupled-tests.mjs`) runs
  only in `.github/workflows/security.yml`, which is `workflow_dispatch` only by the operator's
  2026-08-06 decision (its header: this repository is private and every minute is billed). A red
  case there fails no PR.
- `store-ci.yml` does run on `pull_request`, but as a bare checkout: making these two suites fail
  a PR means adding to it (a) a core checkout plus `npm ci` for `routes.core.test.js` and the
  browser spec, and (b) a build of `engine/container/Dockerfile` (a CadQuery pip install) plus
  `python -m unittest discover -s tests` for the kernel suite — billed minutes on every such PR.
  Proposed shape for that decision: one job per suite, run only when the PR touches
  `cad-studio/**` (a changed-paths step), with the new commands added to
  `scripts/security/store-test-command-inventory.json`.
- In the Test Lab, `routes-http` declares `framework-checkout:oshal-core-dir`, but the node
  runner recognises only `runner:node-test` and `fixture:core-checkout`
  (`oshal/src/features/swarm-apps/services/package-test-snapshot.ts`), so the case reports its
  prerequisite as unverified. `python3` (contract-features, worker-logic) is in the same position.
- Until then the kernel half of B1 and B5 (28 cases) is proven only by a manual run in the engine
  image, which this lane did not do (live box).

## B7 — Run the surface-lifecycle browser case in the Test Lab

The `surface-lifecycle` Test Lab case is registered but stays pending with the reason
`Additional prerequisites require verification: harness:core-test-fixtures.` Its fixture imports
`stl-viewer.ts` and `isolated-browser.ts` from the framework checkout's `tests/fixtures/`, and the runner image ships no `tests/`
tree (checked 2026-09-14 in `oshal-local-api`: `ls /app/tests` — no such directory). Declaring only
`harness:oshal-core-root` would make the Lab run it straight into a module-not-found failure, so
the case names the missing capability instead.

It is not unguarded: `tests/surface-lifecycle.core.spec.mjs` runs in the manual framework-coupled gate
(`scripts/security/run-framework-coupled-tests.mjs`), green on 2026-09-14 (16 pass).

**Done when:** core's Test Lab runner image carries the shared browser fixtures behind a
probe-verified prerequisite (a core change that needs operator approval), this case declares that
prerequisite in place of `harness:core-test-fixtures`, and one Lab run of it passes on the box — a
real run of a few seconds, not a sub-second decline under load.

When it can run: the runner image's Chromium requests `/favicon.ico` and logs a 404 as a console error, so the fixture server must answer it (204), as animatronics' and circuit-lab's fixtures do - otherwise every "no page errors" assertion fails in the sandbox and passes on a host browser.

## The assistant cannot call its route-backed tools yet (2026-10-06)

**CLOSED 2026-11-19 (version 0.5.2).** The 2026-10-06 `401` refusal occurred on the retired TypeScript core before `oshald` (`package_api_tools.rs`) executed route-backed `executorType: api` tools directly under the caller's verified principal (`200 OK`, zero `401`). `0.5.2` verifies explicit `posture: inline` + `chatBot: cad-studio-designer`, adds explicit object `inputSchema` declarations to `cad-capabilities` and `cad-list-models`, checks `personas/cad-studio-designer.yaml` plain-prose and ```` ```tool_call ```` `{"tool": ...}` rules, and guards manifest, persona, and route execution in `tests/bot-tools-contract.test.js`.

## Future: ADR-149 `authorization.yaml` catalog adoption (coordinated migration)

Adopting an ADR-149 `authorization.yaml` catalog + `builtinKey: package` tools for `cad-studio` requires coordinated role migration across the five experience packs (`business-experience`, `commons-experience`, `jarvis-experience`, `orbit-experience`, `studio-experience`) and active production `@app-admin` assignments so existing users are not locked out.
