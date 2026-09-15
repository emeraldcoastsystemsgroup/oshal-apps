# CAD Studio — backlog

Each entry has done-when criteria. An entry is open until its status line says otherwise; the
README and ARCHITECTURE describe only what is built.

## B1 — Sketch-driven features: revolve, sweep, loft

The kernel does them; the contract does not expose them yet.

Done when: `revolve` (sketch + axis + angle), `sweep` (profile + path polyline) and `loft`
(two or more sketches at offsets) are feature types in both `cad_worker.py` and
`feature-contract.ts`, each with a real-kernel test to an analytic volume and a contract test
naming the field on refusal.

**Status (2026-09-14, 0.2.0): built; the real-kernel half is written but NOT yet executed.**
- Built: the three types in `cad_worker.py` and `feature-contract.ts` (+ compiled
  `routes/feature-contract.js`), the `path` / `sections` parameter kinds, the revolve
  axis-in-plane rule, `planeAxes` / `maxSections` published by both `hello` and `/capabilities`,
  and the studio form (JSON `path` / `sections`, `pathPlane` select, boolean `ruled`).
- Proven here: `node --test "tests/*-*.test.js"` 15/15 (17 new refusal cases each naming its
  field, plus a parity guard that reads the worker's `FEATURES` / `PLANE_AXES` from source and
  was shown to go red when `loft` is removed from the worker only);
  `tests/surface-lifecycle.core.spec.mjs` 15/15 (the new form case is red against the HEAD
  surface); `tests/routes.core.test.js` 8/8.
- NOT proven: the ten new `SketchFeatures` cases in `engine/tests/test_cad_worker.py`
  (cylinder through the axis, Pappus annulus, revolve about the plane's first axis, a 90° quarter,
  straight and mitred-L sweeps, two- and three-section lofts, per-feature refusals, hello). The
  engine container was deliberately not started (live box). The CadQuery 2.5.2 call shapes were
  checked against the pinned wheel's source (`revolve` takes the axis in workplane-local
  coordinates; `sweep` wires a Workplane path itself and uses the profile in place; `loft` pops
  every pending wire), not against the kernel. Closes when `python -m unittest discover -s tests`
  in `oshal-cad-studio-engine` passes 24/24 — which is the B6 gate.

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

## B3 — Send an STL to Scan to Print for printing

Printing stays behind Scan to Print's confirmation; the hand-off is a download today.

Done when: Scan to Print's `artifacts.accepts` takes `model/stl` and opens a job with the mesh
as its model (no reconstruction), and CAD Studio's revision row offers "Print in Scan to Print"
through the ADR-139 picker.

**Status (2026-09-14): open.** The first half is Scan to Print's: its manifest accepts only
`image/*` (`scan-to-print/oshal-app.yaml`, `artifacts.accepts`), and a job that starts from a
mesh with no reconstruction is its pipeline's change. CAD Studio's half waits for it — a "Print in
Scan to Print" entry before Scan to Print takes an STL would offer a destination that refuses the
file.

## B4 — Threads and text

Done when: `thread` (ISO metric profile on a hole or boss, by nominal size and pitch) and `text`
(embossed / debossed, a bundled font) are feature types with real-kernel tests and the STL of a
threaded boss passes the mesh validator.

**Status (2026-09-14): open, not started.** What it needs that B1 did not: a font file shipped in
the engine tree (the image installs `libfontconfig1` / `libfreetype6` but no fonts — `engine/
container/Dockerfile`), and a licence note for it; a helical sweep for the thread (B1's `sweep`
takes polylines only); and "the mesh validator" is Scan to Print's
`src-routes/engine/geometry/mesh-validate.ts` — decide whether CAD Studio's test imports it or
the check is re-stated here. Every assertion is real-kernel, so none of it can be proven outside
the engine image.

## B5 — Per-feature timing budget and cancellation

A very slow boolean on a large mesh base holds the worker for the whole request timeout.

Done when: the worker reports per-feature `ms` (it does) AND refuses a single feature past a
configurable budget with a `budget_exceeded` status, and the api exposes a cancel that closes
the connection mid-rebuild and records the last good revision.

**Status (2026-09-14, 0.2.0): built; the real-kernel budget cases are written but NOT executed.**
- Worker: `rebuild` takes `featureBudgetMs` (whole ms, 1..600 000). A feature that returns after
  it is `{ok:false, code:"budget_exceeded", ms, error}`, its result discarded, and the next
  feature still runs. The api sends `settings.featureBudgetMs` (default 60 000; PATCH refuses a
  bad value with `field: settings.featureBudgetMs`).
- The budget is read when a feature RETURNS: one OCCT call holds the worker's interpreter, so the
  budget does not interrupt a boolean mid-call. For the motivating case (one very slow boolean)
  what frees the worker is the cancel below, or the request wall clock.
- Api: `POST /models/:id/cancel`, owner-scoped. Queued: dropped. In flight: the engine connection
  is closed — `cad_engine_bridge.py` `Session.close()` then `stop_worker()` SIGKILLs that
  worker's process group — and other callers' queued requests are re-sent on a fresh connection.
  The triggering request answers 409 `cancelled`; the part is recorded `failed` at its last good
  revision before the cancel replies. The studio shows **Stop rebuild** while the selected part
  rebuilds.
- Proven here: `tests/engine-client.test.js` 9/9 (the two cancel cases fail against the HEAD
  client); `tests/worker-logic.test.js` 4/4 (the worker's real orchestration with CadQuery
  stubbed out: budget refusal and discard, the budget parse, and no revolve/sweep/loft refusal
  reaching the kernel — shown red with the old interleaved loft); `tests/routes.core.test.js`
  10/10; `tests/surface-lifecycle.core.spec.mjs` Stop case.
- NOT proven: the four `FeatureBudget` cases in `engine/tests/test_cad_worker.py` (engine image;
  the suite is now 28 cases), and the bridge's kill-on-close was read in its source, not run.

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
