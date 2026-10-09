# Career presentation

## 1.27.1 Stopping a run stops its engine — open items

The engine now runs inside the wrapper's process group under the runner's adopted lease (README
"Stopping a run stops its engine (1.27.1)"), proven in a disposable Linux container. Still open:

- **Stage 1.27.1.** Done when: the package is staged on the box (no catalog revision: no route,
  binding or migration changed) and `GET /api/career-hunter/runs` answers the operator.
- **Run the whole-workflow proof.** Done when: core's
  `scripts/operations/career-rail-live-proof.js --complete` prints PASS on the box with no cleanup
  errors, started while `GET /api/career-hunter/run/refresh` answers `running: false` and early
  enough to end before the 18:00 CT evening chain. It also needs core's own proof fix (it must keep
  polling `GET /runs` after its held POST drops at about 300 s).

## 1.27.0 Test Lab application seam — open items

The seam is in source and proven locally (README "The Test Lab application seam (1.27.0)"). Still
open:

- **Install 1.27.0 with its catalog review.** Done when: the package is staged, the catalog revision
  (`POST /test-lab/applications`, `DELETE /test-lab/applications/:postingId/:tag`, both
  `career.change`) passes its AUTH-07 review and is approved, and `GET /api/career-hunter/applications`
  answers the operator.
- **Run the approve -> draft live acceptance.** Done when: core's
  `scripts/operations/career-rail-live-proof.js --complete` prints `career-worker-rail-complete PASS`
  on the box as the operator automation identity, with the draft run `succeeded` in `GET /runs`, the
  Career bot's ledger rows under the owner, and cleanup complete.

## 1.26.0 Story review live acceptance — open items

The two owner-scoped removals and the live walk are in source and proven locally (README "The live
acceptance and its cleanup (1.26.0)"). Still open:

- **Install 1.26.0 with its catalog review.** Done when: the package is staged, the catalog revision
  (two new DELETE bindings, `career.change`) passes its AUTH-07 review and is approved, and
  `GET /api/career-hunter/stories` answers the operator.
- **Run the live walk.** Done when: `tests/stories-live-acceptance.mjs` prints `RESULT` with state
  `pass` and `cleanup: deleted` on the box, as the operator automation identity.

## 1.25.0 PostgreSQL storage cutover — open items

The outbox (migration 106), the reverse projector and its rollback gate, the observation sampler
and the operator status route are in source and proven on disposable PostgreSQL with synthetic
SQLite stores (BACKEND-CUTOVER.md, "Commands"). SQLite remains authoritative. Still open:

- **Stage 1.25.0 and run the installed smoke.** Done when: the package is staged with migration 106
  applied, and Test Lab case `cutover-status` passes with the operator automation identity's PAT
  (state `not-started`).
- **Live promotion and rollback drill (operator).** Done when: BACKEND-CUTOVER.md promotion steps
  1-7 and rollback steps 1-5 have run on the real stores with restorable backups taken first, the
  loader's second run changed nothing, `report_convergence.py --require-convergence` and
  `reverse_sync.py --check-rollback-ready` both exited 0, and the evidence (hashes, reports,
  metrics) is archived outside the data directories.
- **Seven-day observation (elapsed time).** Done when: after PostgreSQL writes begin,
  `observe_cutover.py` runs after every nightly completion and `GET /api/career-hunter/cutover/status`
  reports `state: complete`, with route latency and database errors in bounds on the core
  monitoring stack for the same seven days.
- **Schedule the sampler and the worker.** Done when: `reverse_sync.py --follow` and a post-nightly
  `observe_cutover.py` run are started by the deployment (not by hand) once writes are promoted.

## 1.25.1 Authorization catalog and signed engine rail — open items

The catalog, the signed rail, the resource adapter and the recorded automation issuer are in
source and proven against the real kernel in enforce mode (`tests/career-rail-kernel-boundary.core.test.js`;
README "1.25.1: the catalog and the signed rail"). Still open:

- **Staged on the box with the reviewed catalog migration and the live proof green.** Done when:
  1.25.1 is staged over the box's catalog-less install following README "Installing 1.25.1 on an
  enforce box" (backup, `deploy-store-package.sh career-hunter`, the
  `authorization_catalog_migration_required` review approved, the operator granted `admin`), and
  core `scripts/operations/career-rail-live-proof.js` (core #876) prints `RESULT ... PASS` with the
  Career bot's `chat_tasks` rollup and `oshal_cost_events` rows for the operator. Recorded with a
  date. On FAIL the box is rolled back to 1.23.0 the same way.
- **Automation opt-ins saved before 1.25.1 record no issuer.** The cron skips those owners' model
  passes (`model passes skipped` in the api log). Done when: every opted-in owner on the box has
  saved Career Settings automation once after staging (the log line stops appearing), or a
  one-time operator action records the issuer for existing rows and its guard exists.
- **Real-boundary audit row (core docs).** Done when: core
  `docs/governance/real-boundary-regression-audit.md` names `career-rail-kernel-boundary` as the
  real companion of the worker-rail harness doubles (kernel callback rail, request identity), and
  lists what that suite still doubles (the principal directory, request identity for browser
  routes, the Career bot node client and `executeBotOrInline`) with their live companions.

## 1.24.0 Career worker rail — open items

The rail, the engine change, owner cancel/run list and their guards are in source and tested
locally (see the README section "Career worker rail (1.24.0)"). Still open:

- **Live acceptance (automated, not yet run).** Done when: core
  `scripts/operations/career-rail-live-proof.js` (core #876) passes on the box after 1.25.1 is
  staged (above); it drives the owner's own manual score run through the real route, cancels it
  after the first admitted rail call and reads the Career bot's attribution under the owner's RLS.
  Stopping `oshal-local-career-bot` mid-run turning the run `failed` / `career-worker-unavailable`,
  and a second real user with their own configured brain, remain the operator's two live checks
  (a real node outage and a second real account cannot be scripted); recorded with a date.
- **Real-boundary audit row (core docs).** Done when: core
  `docs/governance/real-boundary-regression-audit.md` has a row for the worker-rail specs
  (`career-worker-rail`, `career-worker-rail-isolation`, `career-model-rail`) that lists each scoped
  double with its real companion:
  - the kernel trusted-subject decoder and `auth: service` mount guard (mirrored in
    `tests/helpers/worker-rail-harness.mjs`, over `node:http` with a recording `Router`) → the real
    `getTrustedServiceUserSub` and `manifest-route-mounter.ts` serving this route, i.e. the engine's
    POST through the running api in the live acceptance above;
  - `BotNodeClient.hasEndpoint`, the endpoint resolver and `runtimeRegistryService` (the heartbeat
    preflight) → the real registry resolver and Redis heartbeat, i.e. the live step that stops
    `oshal-local-career-bot` mid-run;
  - the runner's spawn (an in-memory child in the isolation spec) and the user-store leaf → a real
    spawned `bin/oshal-jobhunter.js` child per user whose Python environment is read back;
  - `executeBotOrInline` (a recorder) → `settleBotNodeCostTask` plus the live two-user receipt.
- **ADR-137 Amendment A (core docs).** Core `docs/adr/137-deploy-modes.md` still records
  Amendment A's store half ("Store, career-hunter 1.12.4 — the engine child inherits the mounted
  vendor logins …") as accepted and built, and its status line says the same. Done when: a core
  docs change records in ADR-137 Amendment A that Career 1.24.0 retires that engine carve in favour
  of the worker rail (the engine child holds no vendor login or model key for any subject; model
  calls run on the career-bot), and the amendment's guard list no longer cites
  `career-no-sync-api.test.mjs` as proof of the carve.
- **`cli` tools bypass the runner.** The model-bearing tools `career_score`, `career_draft` and
  `career_draft_oshal` are `cli` executors, so they run the engine without a run token and stop at
  their first model call with `rail-not-configured`. Done when: the model-bearing tools reach the
  engine through a package route that goes through the runner, with a test that the tool path
  mints a run.
- **Board surfacing.** Done when: the Job Board shows the caller's running engine run with a
  Cancel control (`POST /run/<runId>/cancel`) and renders a `failed` / `career-worker-unavailable`
  run as a visible state, covered by the board browser recipe.
- **Career Settings Anthropic card.** The card still saves the key, but since 1.24.0 the engine is
  not given it. Done when: the card's copy says what the key is (and is not) used for, or the card
  is removed with its allow-list entry.

## 1.21.0 Job Board and open search

The board and standalone search now expose each other directly through the existing
Career surface routes and admitted Cockpit tool bridge. The board emphasizes matches
and application progress; open search remains a browse view with no resume requirement.
Mobile pages show results before optional filter fields. Desktop submission tools are
expandable, while computer readiness stays visible. Existing workflow actions and
provider/ownership boundaries remain unchanged.

The initial board now paints a loading status. Its existing feed and resume-status
requests have a 30-second bound; errors are distinct from valid empty matches and offer
an explicit Retry with current filters. Failed initial reads do not trigger an automatic
duplicate request. Older results cannot overwrite a newer filter request.

The registered `job-workspace-browser` recipe uses actual package screens/shared styles
with synthetic loopback data. It covers navigation, mobile results and filters, exact
queries, provenance/detail links, no-resume browsing, cancelled bulk confirmation, held
loading/timeout, retry, HTTP errors and valid empty results. Browser/core prerequisites
remain explicit; this recipe does not become an executable Node suite.

Focused source acceptance passed 90/90 checks: 19 new Chromium behaviors, all 18 existing
palette cases and 53 Board/Search/Resume script contracts. Before checks reproduced the
missing search entry, mobile results below the filter form and blank initial loading area.
The extracted inline scripts and changed test/fixture files pass scoped lint, including
undefined/unreachable code and the 50-line function limit. No route or engine build changed.

Package installation and native acceptance completed on 2026-09-12 from source `3395b937`.
The [Career navigation release](https://github.com/emeraldcoastsystemsgroup/oshal/blob/e2c6d9575aaf47835838775bd7828de889881496/docs/releases/career-navigation-2026-09-12.md)
records 80 Board results, the 50-result Open jobs search and return, retained filters, exact
installed bytes and 53 passing installed Node checks with cleanup. No generated document,
job application or business write was performed. Legacy harness prerequisites and the
pending package security audit remain unchanged.

## 1.20.0 source checkpoint

The thirteen Career-owned HTML screens now share the portal's selected palette and a small,
token-based Career stylesheet. The older parent-color copying and fixed Review palette are
removed. Existing screens, routes, permissions, draft workflows and white document previews
are preserved. The code-less Intelligent Career group borrows those member screens; its
manifest remains 1.0.0.

The new registered Chromium proof uses actual HTML and shared core theme code with synthetic
read-only HTTP data. It covers saved/live colors, application-color opt-in, drafts and filters,
mobile bounds and primary-label contrast. The unchanged board, Search and Resume script
contracts provide 53 focused checks. The original Review page failed the new saved-palette
regression before the fix. Final focused acceptance passed 18/18 Chromium cases and 53/53
existing script checks. The actual installed catalog also executed the 53 script checks in
the sealed container runner, with verified cleanup and no missing registrations.

Historical installed acceptance completed with the corresponding core appearance change on
2026-09-12. The [workspace facelift release](https://github.com/emeraldcoastsystemsgroup/oshal/blob/e2c6d9575aaf47835838775bd7828de889881496/docs/releases/workspace-facelift-2026-09-12.md)
records source `1eecfe1b`, native Career palette changes and installed Lab run
`bd66ffe0-c64a-4b1d-848e-3a1509319671` passing 53 checks with cleanup. This proves the documented
appearance flow; it does not claim every Career workflow, provider operation or job application
was exercised. The package security audit remains pending.

## Remaining test-harness work

The current catalog accounts for all 50 earlier test entries and both new browser entries. Five
legacy groups explicitly require the original complete package, Python engine or legacy core
import layout. Making those harnesses portable to the sealed runner is separate work; their
registration must not turn unavailable dependencies into a pass. No engine or business source
was changed as part of this presentation release.
