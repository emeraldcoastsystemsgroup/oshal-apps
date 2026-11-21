# Career presentation

## UX audit 2026-11-06 — open items

These come from the coordinator decisions in Roger's UX audit (2026-11-05). They were measured, not built tonight.

- **Highest salary ranks pay across currencies (shipped in 1.68.16).** `lib/career-pay.js` (`annualUsdPayExpr`) normalizes
  salary sorting to annual USD equivalents across all supported currencies (USD, GBP, CHF, EUR, SGD, CAD, AUD, NZD, AED,
  PLN, BRL, CNY, DKK, HKD, SEK, NOK, MXN, ZAR, INR, JPY) and pay periods (`year`/`month`/`hour`) while preserving raw
  displayed salary & currency verbatim. `engine/jobhunter/db.py` (`PAY_USD_INDEX_SQL` / `_ensure_pay_usd_index`)
  builds `idx_corpus_pay_usd` on writable ingests (skipping read-only snapshots),
  `src-routes/career-browse-feed.ts` walks `idx_corpus_pay_usd` with zero temp B-tree sort (retaining `idx_corpus_pay`
  fallback on pre-index read-only corpora), and `src-routes/career-board-feed.ts` applies the same currency-aware order on
  My jobs. Guard: `tests/career-currency-salary-sort.test.mjs`.
- **The Discover swipe deck as the Job Board's phone layout (built in 1.69.0; its check on the test slot is not run yet).**
  At 640px and under, New matches is the deck (`tools/career-match-deck.js`): one job at a time, Pass and Save by button
  or swipe, Undo and More. Its writes are the board's own (`POST /jobs/:id/status`: `favorite: true`, `status: dismissed`),
  Undo reverses the last one on the same route (`status: new`, `favorite: false`) after reading the job, and
  `GET /api/career-hunter/mobile` answers a hand-off page to the stage. Guards: `tests/career-match-deck-routes.test.mjs`,
  `tests/career-match-deck-page.test.mjs`. Still open: `tests/career-match-deck-live-proof.mjs check` on the test slot once
  1.69.0 is installed there.
- **Remove the Mobile page that no route serves.** Since 1.69.0 `tools/career-mobile.html` is reached by no address (`/mobile`
  hands off to New matches), but it is still in the package and these suites read it as a page (`career-mobile-screen`,
  `career-mobile-score`, `board-surface`, `resume-preview`, `career-salary-parser`, `career-words`, `career-frame`, and the
  Mobile case of `browser/career-swipe-deck-proof`). Its Ready and Status lists are the board's Getting ready and Applied
  stages. Done when: the file is gone, each of those cases is removed or pointed at the page that took its part over, and
  `tests/test-lab.yaml` no longer registers a Mobile case.
- **Screen aliases for merged tools (needs a kernel change).** A cockpit address naming a removed tool
  (`?screen=career-submissions`, `career-application-status`, `career-mobile`) opens Career's default screen, and
  `?screen=career-approvals` opens the kernel's own Approvals screen where a person has it. Checked against the kernel at
  `7a2f3f1e` and the pinned platform `2816eff1`: the shell answers only a registered view
  (`requestedView` in `platform/src/pages/cockpit/js/components/RibbonNav.js`; its one alias, `career-approvals`, is written
  into that function), and a manifest tile (`OshalAppRibbonTile` in `crates/packages/src/importer.rs`: `toolName`, `label`,
  `icon`, `iframeUrl`, `section`, `group`, `visibilityToolName`) has no key for a former name, so nothing a package declares
  reaches the shell. Registering the old names as tiles again would put four duplicate entries back in the menu, which is what
  1.48.1 removed. The kernel change: a tile key naming its former tool names, each with the query of the stage it became
  (for `career-board`: `career-submissions` with `view=queue`, `career-application-status` with `view=status`,
  `career-approvals` with `view=approve`, `career-mobile` with `view=matches`); the profile carrying it to the shell; and
  `requestedView` resolving `?screen=<former name>` to that registered view with the query handed to its frame the way an
  `app-navigate` message's `query` already is (`sanitizeToolQuery`). In-package links and the addresses `/approvals` and
  `/mobile` already open the board on its stage. Done when: an old `?screen=` address opens the Job Board on its stage,
  through a kernel-supported alias.

## 1.72.0 Résumé for upload forms — open items

Built (lane APPLY-H): every generation writes `Resume_Parse.docx`, the job's résumé as labelled lines for an employer's
parser; Step 3 · Send offers it as For upload forms (.docx); Fill it in on my Chrome uploads it on every site. Guards:
`tests/career-parse-resume.test.mjs` (the real parse against the executive Word résumé), `career-parse-resume-route.test.mjs`,
`career-apply-packet.test.mjs`, `career-apply-by-hand.test.mjs`.

- **Live proof on the test slot.** Done when `node career-hunter/tests/career-parse-resume-live-proof.mjs check
  http://127.0.0.1:38798 <person file> <out folder>` exits 0 with 1.72.0 installed: the download is named for the job, has
  no tab, table or header, and the plain reader recovers every job on that job's résumé exactly at 1440x900 and 412x915.
- **A role's location.** Career records no location on a role (Work history edits title, employer, start and end), so
  `Location:` is printed only for a role whose record carries a `location`. Done when Work history and the concierge's
  patch can set a role's location (revision-checked, with Undo) and the parse résumé prints it under `Company:`.

## 1.70.0 Fill it in on my Chrome — open items

Career's side is built (design APPLY-ORBIT, lane E): packet v2, approval, attempts and Go on, sync, receipt, kept answers
and months, Saved answers, the Send step and Submission activity. Guards: `tests/career-apply-packet.test.mjs`,
`career-apply-sync.test.mjs`, `career-apply-send-step.test.mjs`, `career-apply-receipt.test.mjs`,
`career-apply-saved-answers.test.mjs`. It does nothing on an installation until the kernel runs executor `orbit-apply-v1`.

- **The kernel reports browser-apply to Career.** Done when `GET /api/apply-operator/workers` lists `features` on each
  Orbit computer (today it lists `tools` only), so Fill it in on my Chrome appears for a computer whose Orbit reports
  `browser-apply`, and the kernel routes a `career-apply` ticket to the same computer (the chosen Job Apply device, else the
  only connected Orbit computer that reports it).
- **Show me.** Done when the kernel offers a route the person's page can call to focus the run's Chrome window, and Ready
  for you to submit shows a Show me button that calls it. Today the line says to check the Chrome window.
- **Live proof on the test slot** (lane F, `tests/live/career-apply-*`). Done when its variants a to d pass on blue with
  the stand-in's log, the kernel's work record and Career's receipt agreeing.
- **Any employer site and more engines** (1.71.0, lane APPLY-G). Built: the generic site for any host Career names no
  engine for, embedded Greenhouse, Lever, Ashby and SmartRecruiters forms approved at their own address, and profiles for
  SuccessFactors, BrassRing, Amazon, Eightfold, SmartRecruiters, iCIMS, Oracle Recruiting Cloud and Taleo, each with a
  stand-in shape (`tests/live/career-apply-standin-forms.cjs`) proved through the real add-on in Chromium. Done when the
  live proof's variants g, sf, br, am, ef, sr, ic, or and tl pass on blue (kernel apply-g delivered, blue's
  CAREER_APPLY_SITE_HOSTS naming each engine's stand-in host). The engine profiles are written from each engine's known
  page words, not read from a real employer's site; his first run on each real engine is its first proof there, and a
  label that does not match is a card, not a guess.
- **Attestations** (design open question 1): answered by the owner ("its configuration") and built in 1.70.0 as two
  switches under Saved answers, off by default, carried as `task.attest`. Done when the live proof on the test slot shows
  the terms box ticked and the signature typed only with the switch on, and handed back with it off.

## Nightly source review — next stages

[The review](SOURCE-REVIEW.md) rechecks failing sources, repairs on evidence and reports. These are not built.

- **An agent that works the report.** Each night an agent reads the latest report, writes fixes for what repeats (a
  broken connector, a limit on how many jobs a source returns, a board the review could not reach), tests them and opens
  pull requests. It uses the installation's model account and changes code unattended, so it needs an explicit go-ahead.
  Done when: seven nightly reports exist and show which failures repeat; the owner has approved the model spend; the agent
  works only on a branch and never merges, delivers or changes production; every pull request carries a regression test
  that fails without the fix and names the report entry it answers; and a night's work has a spending limit that stops it.
- **Read limited sources whole.** The report's `stuck` list names sources returning the same round count every pull. They
  are partial, so they close nothing, and jobs past the limit are never seen. Accenture is the Workday case: splitting by
  facet read 32,158 of its 41,399 jobs on 2026-11-03 and then met a search it could not divide further. Done when: each
  connector on the list either reads every job or is recorded as limited with the reason.
- **Close what is really gone on partly verified sources.** Their jobs never close, so listings that have gone stay open.
  Done when: each connector can prove a whole feed, or a job not seen for a stated time closes, and the report shows how
  many open jobs are affected.
- **Workday list rows that have no title.** A Workday list can hold a row with a path and no title. The pull counts it as an
  invalid row, records that employer's read as partial (`invalid_feed_rows`) and closes nothing for it. Measured 2026-11-10
  in the published corpus: 12 of 236 Workday sources are recorded that way, holding 64,797 open jobs (Accenture 38,586, Target
  14,209, Jabil 2,305, Johnson & Johnson 1,907, Salesforce 1,585, United Rentals 1,276, State Street 1,197, Home Depot 976,
  Mastercard 959, Motorola Solutions 889, Copart 557, IFF 351); a repeated id is recorded the same way. The invalid rows
  themselves were read on two boards, and they are of two kinds. On Clorox's (`clorox:wd1:Clorox`, read the same day) the row's own page answers 404: the posting
  was taken down. On Copart's (`/job/_JR107671`, `/job/_JR106820`) the page answers 200 with a blank title and takes
  applications: the posting is open. Leaving every such row out would let a board close jobs while an open posting is
  missing from the feed.
  Done when: the invalid rows of each of the 12 sources are classified by what their own page answers; a row whose page
  answers 404 no longer stops its board closing what is gone; a row whose page is open is stored or named in the nightly
  report; and a regression case holding both kinds fails on the present reader.
- **Job lists that show no place beside a job.** A reader that takes jobs from a board's list stores the place the list shows,
  and none where the list shows none. Measured 2026-11-10: Experis (`https://www.experis.com/en/all-jobs`, page-list reader)
  2,090 of 2,092 jobs with no place; Deloitte (`apply.deloitte.com`, Avature) 1,067 of 1,441, whose list says "Multiple
  Locations" for a job offered in several places; Trader Joe's (`traderjoes.avature.net`) 190 of 190, whose list shows a
  shop number and street. These jobs are stored and found by title, and never by place. Where each board states the place
  of such a job (the job's own page, a search by place) was not read for this entry. Done when: each of the three boards'
  jobs is stored with the place the employer states for it, or the board is recorded as stating none; a job offered in
  several places is found from each of them; the added requests per pull are counted and bounded; and a regression case
  holding a list row with no place fails on the present readers.
- **Stop the page reader following a redirect to a private address (shipped in 1.68.16).** `engine/jobhunter/browser_read_policy.cjs`
  (`createReadProxy`, `checkDestination`, hardened `publicAddress`) and `engine/jobhunter/browser_fetch.cjs` now route all
  Chromium traffic (including `301`/`302`/`303`/`307`/`308` navigation and subresource redirects) through an ephemeral
  loopback policy proxy with `bypass: '<-loopback>'` so redirects to loopback (`127.0.0.1`, `::1`, `localhost`), RFC1918,
  link-local / cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), ULA, and 6to4 addresses are
  refused fail-closed before a connection is opened. Guard: `tests/career-browser-redirect-ssrf.test.mjs`.
- **Find employers not yet in the corpus.** The review only rechecks employers already listed. Done when: new employers
  come from a stated, reviewed list, each passing the same evidence rules, and the report shows how many were added.
- **Check existing sources against their employer.** Older discovery accepted name matches, and at least one source (Crown
  Castle) points at another company's board. Done when: every source returning jobs either has evidence from the employer's
  own page or is listed in the report for a person to check.

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
