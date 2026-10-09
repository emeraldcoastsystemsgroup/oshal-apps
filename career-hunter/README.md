# Career Hunter — oshal app package

The job-hunting application carved out of the oshal kernel under ADR-085. Its TypeScript routes,
Node CLI wrapper, Python `jobhunter` engine, persona, migrations, and browser surfaces ship in this
package. The kernel supplies shared runtime capabilities and mounts the package; it does not own
Career Hunter domain code.

The workflow is: shared employer ATS scrape → per-user keyword match → AI scoring → title pass →
approval queue → apply-pipeline handoff. It also provides the morning digest, native board,
recruiters, strengthen, insights, approvals, settings, Resume Studio, Profile Studio, mobile swipe,
submissions, and the jobs knowledge graph.

Those surfaces reach the operator through a **sectioned ribbon**: Career Review and Mobile lead
ungrouped, then **Job Search** (Search Jobs, Job Board, Submissions, Recruiters, Insights), **Resume**
(Strengthen, Resume Studio), and **Presence** (Profile Studio plus a cross-app tile into the
separate `portrait-studio` package). Approvals, Companies, and Career Settings stay in the
ungrouped bottom tray. The `group:` key that drives this, and the rules a cross-app tile has to
follow, are written up in
[docs/ribbon-groups-adr-085-addendum.md](docs/ribbon-groups-adr-085-addendum.md).

Version 1.27.3 serves the native board at the package root and keeps generated routes aligned
with their TypeScript sources. Board summaries expose actual `applied` and `interviewing` counts
(the latter counts the existing `interview` status). Resume state retains its observed ingest and
profile fields; it does not report a fabricated active status or empty resume inventory.

The package now declares `member` and `admin` composite role templates selecting its corresponding
catalog roles. It has no required application dependencies; the optional Portrait Studio picker
remains separately authorized. Review/apply the current template after package installation when
an existing native assignment reports a stale source revision; package updates do not grant roles.

## Career worker rail (1.24.0)

**This release changes how an installed Career runs its AI scoring and tailoring.** Every model
call the Python engine makes — fit scoring, the title pass, tailored resumes and cover letters,
resume ingestion, profile augmentation, stories, interview prep and recruiter outreach — now runs
on the dedicated `career-bot` node (agent `cb000000-0000-0000-0000-000000000001`) instead of
inside the api container. The engine keeps its deterministic work (scrape, corpus, stores, PDF
rendering) where it was and sends each completion to the package route
`POST /api/career-hunter/engine/complete`, which hands it to the Career bot through the kernel's
accounted bot rail. What changes for an operator:

- **No career-bot, no scoring.** A deployment whose `career-bot` node is not running (core compose
  profile `career-node`), or whose heartbeat is stale, can no longer score or tailor. Such a run
  ends `failed` with reason `career-worker-unavailable`; it never falls back to another provider,
  and the nightly keyword-pass and title-pass cursors do not advance, so the work is retried.
- **No vendor logins or model keys in the engine.** The engine child no longer inherits the api
  container's mounted `~/.codex` / `~/.claude` logins for any user — the ADR-137 amendment-A
  demo-operator carve is retired — and is never handed a model-provider key. Which model answers
  is decided by the kernel's per-user brain resolution when it dispatches to the career-bot (the
  user's Settings → AI Providers); a user with nothing configured sees `no-configured-brain`.
- **Cost lands on the right user.** Each completion is one `executeBotOrInline` call to the Career
  bot with the run owner's `userSub` and task id `career-engine-<runId>`, so the kernel's budget
  gate and cost settlement apply per user.
- **The Career Settings Anthropic key is no longer given to the engine.** The card still saves and
  clears it; the Firecrawl key (web search) is still brokered.
- **Owners can see and stop their runs.** `GET /api/career-hunter/runs` lists the caller's own
  engine runs with `running` / `succeeded` / `failed` / `cancelled` and a reason;
  `POST /api/career-hunter/run/<runId>/cancel` stops one (another user's run answers 404). A manual
  `POST /run/score` whose run the rail ended answers with the rail's own status and code, the run id
  and its state (for example `503 career-worker-unavailable`, `504 career-worker-queue-timeout`).
- **Direct CLI calls stop at their first model call.** The manifest's `cli` tools (`career_score`,
  `career_draft`, …) and a hand-run `node bin/oshal-jobhunter.js` do not go through the runner,
  so they carry no run token and fail with `career worker unavailable: rail-not-configured`.

The rail's authentication, token, limits and failure signatures are in
[docs/operations.md §5](docs/operations.md#5-which-ai-credential-the-batch-uses-worker-rail-1240).

**Tested locally; not live-proven.** What runs for real in the guards: the compiled rail and runner
modules, the run registry (`lib/career-engine-runs.js`), loopback HTTP, and the production Python
engine (spawned as a real process by `tests/career-model-rail.test.mjs`). What is doubled, in
`tests/helpers/worker-rail-harness.mjs`: the kernel's trusted-subject decoder and the `auth: service`
mount guard (hand-written mirrors of `authz.ts` and `manifest-route-mounter.ts`, served over a
plain `node:http` server instead of Express), the Express `Router`, `BotNodeClient.hasEndpoint` and
the endpoint resolver, the heartbeat registry (`runtimeRegistryService`), and `executeBotOrInline`
(a recorder). `tests/career-worker-rail-isolation.test.mjs` also replaces the runner's spawn with
an in-memory child, so no engine process runs there, and stubs the user-store leaf. The real
companions (the kernel mount, `BotNodeClient` with the Redis heartbeat, a real spawned launcher
child, and the kernel's cost settlement) are the live acceptance below and the open items in
[BACKLOG.md](BACKLOG.md). The guards: `tests/career-worker-rail.test.mjs` (the route over loopback
HTTP, including the queue/deadline split), `tests/career-worker-rail-isolation.test.mjs` (two
users), `tests/career-model-rail.test.mjs` with `tests/career-model-rail-contract.py` (the engine,
with subprocess and provider-SDK tripwires, on a fixture host whose home and login directories are
empty and whose PATH holds only the Python interpreter, so no login or CLI of the test machine is
reachable), `tests/career-cron-cursor.test.mjs`, and the inverted
`tests/career-portal-logins-launcher.test.mjs`. Nothing here has been installed or run on a real
career-bot node, and no Career work has run on a real provider. Live acceptance is automated in core:
`scripts/operations/career-rail-live-proof.js` (core #876) runs the owner's own score through the
real route after staging and reads the Career bot's `chat_tasks` / `oshal_cost_events` attribution
for agent `cb000000-0000-0000-0000-000000000001` under the owner's RLS. Its `--complete` mode lets
the score run finish and then drives one approve -> draft on an application it plants and removes
(the seam below), and its `--worker-loss --announced-window` mode stops `oshal-local-career-bot`
mid-run, requires the run to end `failed` / `career-worker-unavailable`, and restarts the bot (core
#903). A second real user with their own configured brain is the check only an operator can make.

### The Test Lab application seam (1.27.0)

The approve -> draft half of the live acceptance needs an application the proof owns and can
remove, and until 1.27.0 nothing removed one: `POST /enqueue-drafts` creates durable tickets and
rows over the caller's best postings. Two owner-only routes, each bound once to `career.change`:

- `POST /test-lab/applications` with `{postingId, tag}` plants one application, awaiting approval,
  on one untouched posting of the caller (active, never worked, no packet, no application and no
  application ticket), through the same ticket and row writes the queue uses; the ticket records the
  run's tag as `test_lab_tag`. The shared jobs corpus is never written: the posting is a real one the
  caller's board already shows. Anything else answers 401, 400, 404 or 409 and writes nothing.
- `DELETE /test-lab/applications/:postingId/:tag` removes the caller's application for that posting
  only when its ticket carries the tag: the row, then the ticket (`TicketService.deleteTicket`). An
  unmarked application, another tag or another user's application answers 404; a `drafting` or
  `applied` one answers 409. A retry after a failed ticket delete finds the ticket by its
  deterministic key and finishes. The packet a draft leaves is removed by `DELETE /jobs/:id/packet`.

Guarded by `tests/career-test-lab-applications.test.mjs` (compiled routes, the caller's real SQLite
store, a disposable PostgreSQL database with the package's own application migrations, and one
approve round trip through the real handler, runner, launcher and engine); the kernel TicketService
is an in-memory double there. The catalog gains two bindings, so installing 1.27.0 needs its AUTH-07
review. Locally tested only; the installed run is core's `career-rail-live-proof.js --complete`.

### Stopping a run stops its engine (1.27.1)

A cancel (`POST /run/<runId>/cancel`), the runner's deadline and the lease-loss fence all stop a run
the same way: the runner kills the wrapper's process group (`process.kill(-wrapperPid, 'SIGKILL')`;
the runner always starts `bin/oshal-jobhunter.js` detached, so the wrapper leads that group). Until
1.27.1 the wrapper started the Python engine detached as well, so on Linux the engine led a group of
its own and only the wrapper died: a cancelled score run kept calling the rail (each call refused
`rail_grant_revoked`), and because the engine held the inherited stdout/stderr pipes the run stayed
`running`, holding the owner's `user-store` and the `global:corpus-write` slots, until the engine
exited by itself.

Under the runner's adopted lease the engine now starts inside the wrapper's group whenever `/proc`
proves the wrapper leads it, so the runner's group kill reaches the engine and everything it started,
and the run settles `cancelled` (or `failed` with reason `timeout`). The wrapper's own copy of the
deadline and lease-loss fence, which still acts when the runner's process is gone, kills every other
member of its group (`lib/career-process-group.js`) instead of itself, so its lease release and the
ingest terminal-state write still run. A direct CLI run, and a wrapper that does not lead its own
group, keep the engine in a group of its own as before; Windows still uses `taskkill /T`.

Guarded by `tests/career-cancel-engine-tree.test.mjs` (Linux; store-ci runs it on ubuntu): the
compiled runner launches the real wrapper for the manual `score` verb with a stand-in engine that
records its pid and its child's, holds the inherited stdout and never exits. After an owner cancel
the stand-in and its child have exited within 5 s and the run is `cancelled`; the runner deadline
and the lease-loss fence do the same while the wrapper is frozen, so only the runner's kill can act;
and an adopted wrapper left alone fences its engine itself and exits 124. Each check reads the
process state from `/proc/<pid>/stat`, because a killed orphan stays a zombie where node is PID 1.
`tests/career-process-group.test.mjs` covers the fence over a fixture procfs on every platform.
Locally tested in a disposable Linux node container; the installed proof is core's
`career-rail-live-proof.js --complete` after 1.27.1 is staged ([BACKLOG.md](BACKLOG.md)).

### 1.25.1: the catalog and the signed rail

**1.24.0 and 1.25.0 could not score on an enforce box.** Under the kernel's application-authorization
ENFORCE rollout (the default), core's real-boundary test `tests/unit/career-rail-enforce-posture.spec.ts`
(core #876) proved that the engine child's call to `POST /api/career-hunter/engine/complete` —
the fleet `X-Service-Secret`, an asserted `X-Oshal-User-Sub-B64` and the runner's bearer
`X-Career-Run-Token` — is refused `401 authorization_identity_required` before any package code
runs (`src/app/middleware/application-authorization-identity.ts`: a service-secret caller has no
verified identity). Every model call was refused, the engine's circuit tripped, and the run ended
`failed`. 1.25.1 fixes that with the pattern LoRA 1.7.0 shipped:

- **`authorization.yaml` (ADR-149).** The package now declares a permission catalog: one resource
  (`career`, own scope), five permissions (`app.open`, `career.read`, `career.change`,
  `career.execute`, `career.administer`) and two roles. **`member`** carries the whole app — every
  surface, read, write and engine run, the eight tools, the Career bot and the Send-to-Career
  action; **`admin`** adds `career.administer`, bound to the operator-only routes (the storage-cutover
  status, the portal Companies page and its list/seturl data). Every literal route the package registers
  is bound — `tests/career-catalog-route-bindings.test.mjs` enumerates `router.get/post/put/delete`
  in `src-routes/*.ts` under every manifest mount and requires exactly one binding under the kernel's
  segment rule, because `oshal-app validate` reads the catalog alone and passed while
  `GET /companies-admin` was unbound (the kernel then answers 403 `authorization_operation_unbound`).
  The one wildcard route (`GET /board/*boardPath`, a 308 to the native board for legacy bookmarks) is
  bound one depth at a time, one to four segments; a deeper legacy path is refused before the
  redirect. This mirrors the posture the catalog-less package had under enforce (app-admin holders
  only) without widening anything a user can do today: the handlers' own gates (owner-scoped stores,
  FORCE-RLS tables, the `isOperator` and `CAREER_HUNTER_ADMIN_SUBS` checks) are unchanged, and no
  role is `sensitive`. The package registers the `career` resource adapter from its route factories
  (`src-routes/career-authorization.ts`); without it the kernel refuses every catalog-bound request.
- **The engine rail on the kernel's signed-package-callbacks rail.** The rail route is now
  `auth: public` with `callbackVerifier: createCareerRailCallbackVerifier`, which the loader admits
  only because the catalog is declared. The runner mints a **per-run callback grant** for every
  engine child (`lib/career-engine-runs.js`: `<run id>.<secret>`, recording the owner's verified
  subject and issuer; the controller keeps only the derived key), the engine signs every completion
  with it (`engine/jobhunter/enrich.py`: HMAC over the method, path, a fresh timestamp, a single-use
  nonce and the body hash), and the kernel runs the verifier first, refreshes that owner and
  requires `career.execute` before the handler runs as them. **The fleet service secret is no longer
  forwarded to the engine child** — the runner and launcher have no name for it, and the guards go
  red if one reappears. The owner's issuer comes from the kernel's request identity for a route
  launch, and from the automation opt-in for a cron launch (migration 107 records it when the owner
  saves Career Settings automation; an opt-in saved before 1.25.1 has none and the cron skips that
  owner's model passes with a log line until they save again).

**Proven against the real kernel, not live.** `tests/career-rail-kernel-boundary.core.test.js`
activates the real package through the kernel's manifest reader, enforce-mode authorization runtime
and route mounter from a framework checkout (`OSHAL_CORE_ROOT`): a grant minted by the compiled
dispatch and runner under the kernel's real request identity is admitted when signed as the engine
signs it, the production Python engine's own signer is admitted the same way, and the exact 1.24.0
caller, an unsigned request, a browser session, a foreign owner, a tampered body, a replay, a
settled run, an owner without the `member` role, a revoked role and a deactivated owner are all
refused with no handler call and no database query. The named seams there are the principal
directory, request identity for browser routes, the Career bot node client and `executeBotOrInline`
(recorders). The bare-checkout suites (`tests/career-worker-rail.test.mjs`,
`tests/career-worker-rail-isolation.test.mjs`, `tests/career-model-rail.test.mjs`,
`tests/career-portal-logins-launcher.test.mjs`, `tests/career-cron-cursor.test.mjs`,
`tests/career-automation-issuer.test.mjs`) mirror the kernel's callback rail over loopback HTTP.
Nothing has run on the box yet.

### Installing 1.25.1 on an enforce box

A catalog-less package gaining a catalog is a **reviewed catalog migration** (core
`docs/security/application-authorization.md`, "Package upgrades that change the catalog";
`src/features/application-authorization/catalog-diff.ts`). Exactly what the first load does:

- Every assignment is stamped with the catalog revision it was granted under. The box's existing
  explicit `@app-admin` assignment for career-hunter carries the catalog-less revision of 1.23.0.
  When 1.25.1 activates with a catalog while that assignment carries the previous revision, the
  installer classifies the change: `diffAuthorizationCatalogs(null, next)` returns one change,
  `catalog added`, effect **breaking** ("The package now declares a permission catalog, so fallback
  app-admin grants lose their meaning"); a previous revision that was never recorded classifies the
  same way. Activation is refused with `authorization_catalog_migration_required` naming one stored
  review, and the box's routes for this app answer 503 `authorization_app_unavailable` until the
  review is applied or the package is rolled back — back up first.
- An administrator with application-wide assign lists the review with
  `GET /api/authorization/catalog-migrations?app=career-hunter` and approves it with
  `POST /api/authorization/catalog-migrations/apply` and `{previewId, idempotencyKey}` (same
  same-origin gate and idempotency as an access change; the sole swarm operator may approve their
  own change, core #871). The next activation of exactly that revision applies it.
- **The `@app-admin` assignment is removed, not carried**: a grant that names a role the new catalog
  does not define is dropped (`catalog-migration.ts` `carried()`), and the catalog defines only
  `member` and `admin`. Likewise the implicit app-admin a catalog-less package gave an explicit
  admin-tier caller (`policy.ts` `resolveGrantSet`, `!app.catalog && explicitTier === 'admin'`) no
  longer applies. Until someone is granted a catalog role, nobody — the install owner and the
  operator included — can open the app. If the box holds **no** assignment for career-hunter at all,
  the catalog loads without a review and the same grant step follows.
- Grant the operator `admin` (and each user `member`) through Access Administration or
  `POST /api/authorization/preview` + `POST /api/authorization/apply`; neither role is sensitive, so
  no approval reference is needed.

The deploy lane's recipe, in order (none of it is run by the change that ships 1.25.1):

1. Back up the box's 1.23.0 bytes: `docker cp oshal-local-api:/app/deployed-apps/career-hunter <backup-dir>/career-hunter-1.23.0`.
2. Stage: `bash scripts/deploy-store-package.sh career-hunter` (core; restarts only the api).
3. Expect `authorization_catalog_migration_required` in the api log; review and approve it
   (`GET /api/authorization/catalog-migrations?app=career-hunter`, then
   `POST /api/authorization/catalog-migrations/apply`; a 403 on self-approval points at the
   sole-operator rule, core #871), then let the package re-activate.
4. Grant the operator the `admin` role (`POST /api/authorization/preview` + `/apply`, or Access
   Administration → career-hunter → the operator → `admin`).
5. Save Career Settings automation once as each opted-in owner (records the issuer for the cron).
6. Run the acceptance: `OSHAL_VERIFY_ENV_FILE=C:/Projects/oshal/.env OSHAL_VERIFY_API_CONTAINER=oshal-local-api node scripts/operations/career-rail-live-proof.js` (core #876).
7. On `FAIL`: roll back — `docker cp <backup-dir>/career-hunter-1.23.0/. oshal-local-api:/app/deployed-apps/career-hunter/`
   and `bash scripts/deploy-store-package.sh career-hunter` from a 1.23.0 checkout (or restore the
   bytes and bounce the api). What the rollback does depends on whether step 3 was applied, because
   a catalog revision hashes the application, source and catalog — not the version — and every
   assignment is stamped with the revision it was granted under:
   - **Rolled back before the 1.25.1 review was applied** (1.25.1 refused, never activated; the
     box's assignments still carry the catalog-less revision): 1.23.0 activates with no review —
     `planCatalogMigration` finds no stale assignment (`status: 'current'`) — and serves under the
     existing `@app-admin` grant exactly as before staging.
   - **Rolled back after the review was applied and `admin` granted** (the case a `FAIL` in step 6
     covers): the assignments are stamped with the 1.25.1 revision, so activating catalog-less
     1.23.0 is itself a catalog change. `diffAuthorizationCatalogs(previous, null)` classifies it
     `removed` / **breaking** ("The package no longer declares a permission catalog, so every
     named-role grant loses its meaning"), `planCatalogMigration` returns `review`, and
     `validateRegistration` refuses 1.23.0 with `authorization_catalog_migration_required` until
     *that* review is approved through the same `GET`/`POST /api/authorization/catalog-migrations`
     steps as step 3. When it applies, `carried()` (next catalog `null`) keeps a grant only if it
     names `@app-admin` or a core management role *and* the 1.25.1 catalog defined it; `member` and
     `admin` are neither, so they are removed, and the box holds no `@app-admin` row (the 1.25.1
     migration removed it). Grant `@app-admin` to the operator again (`POST /api/authorization/preview`
     + `/apply`) before anyone can open 1.23.0.

## Job Board and open jobs search (1.21.0)

The Job Board now has a direct **Open jobs search** entry, with matching navigation back
to the board. In Cockpit, these links use the existing admitted Career tools. Standalone
pages use the package's existing authenticated routes. Search covers tracked openings
without requiring a resume; the board retains scored matches and application progress.

Both pages have a compact heading, readable job cards and mobile filter disclosures.
Computer readiness stays visible on the board; desktop submission setup and bulk tools
expand when needed. Existing resume, application provenance, filter, autofill, submission
and confirmation handlers remain available. Initial board loading is visible, reads time
out after 30 seconds, and failures offer **Retry** rather than reporting an empty result
or automatically starting another request. A retry uses the current filters.

The new browser recipe is registered in [AI Test Lab](tests/test-lab.yaml). Run it locally
with `node --test career-hunter/tests/browser/career-job-workspace-proof.mjs` and the same
`OSHAL_CORE_ROOT` setup below. It uses actual HTML/CSS and synthetic local HTTP, without
providers or business writes. Native installation acceptance is tracked separately in
[the package backlog](BACKLOG.md).

## Shared appearance (1.20.0)

All thirteen Career-owned screens use the portal palette, including Workspace. Change the
palette in Cockpit Settings and the open Career screen follows without reloading its iframe,
discarding a draft, or changing filters. Shared typography, heading accents and controls give
the board, search, studios, review, approvals and settings a consistent Career identity.
The existing layouts, actions and permissions remain in place. Resume paper and PDF previews
keep their white document background.

The portal's optional **Application colors** setting can use Career's declared Daylight default.
An explicit portal palette choice turns that option off and follows the user into other apps.
Career stores no separate color preference and does not force Daylight. This requires the core
shared appearance contract; the package stylesheet consumes canonical tokens through the
existing authenticated static route.

## AI Test Lab and focused verification

[tests/test-lab.yaml](tests/test-lab.yaml) registers eleven scenarios: the unchanged readiness
smoke, two real-screen Chromium proofs, the existing board/Search/Resume script contracts,
five groups covering the remaining legacy harnesses, and the two 1.24.0 worker-rail recipes
(`worker-rail`, a dependency-free node-test recipe, and `worker-rail-engine`, which needs Python
and the engine like the other Python harnesses). Every one of the 50 existing test
entries is registered, alongside both browser entries. Registration does not mean execution.
The legacy Python, filesystem and TypeScript/core-import harnesses remain explicitly pending
when those prerequisites are unavailable; no provider or production-business tests were run
for this appearance change.

From the package repository, with a core checkout and its browser dependencies installed:

```powershell
$env:OSHAL_CORE_ROOT = 'C:/path/to/oshal'
node --test career-hunter/tests/browser/career-theme-proof.mjs
node --test career-hunter/tests/board-surface.test.mjs career-hunter/tests/career-search-screen.test.mjs career-hunter/tests/career-resume-studio-bridge.test.mjs
```

The browser fixture serves actual package HTML and shared core CSS/JavaScript over isolated
loopback HTTP with synthetic records. It refuses mutations and off-origin traffic. It checks
13 saved/live palette transitions, draft and filter retention, optional application colors,
mobile bounds, all 12 primary-label contrasts and white resume paper. The 53 existing script
checks preserve filter, provenance, consent and bridge behavior. The 1.20.0 source checkpoint
passed all 18 Chromium cases and all 53 script checks; the same 53 also passed through the
actual installed catalog and sealed container runner with verified cleanup and zero missing
registrations. Historical installed/native acceptance for 1.20.0 is recorded in the
[workspace facelift release](https://github.com/emeraldcoastsystemsgroup/oshal/blob/e2c6d9575aaf47835838775bd7828de889881496/docs/releases/workspace-facelift-2026-09-12.md).
The subsequent [1.21.0 release](https://github.com/emeraldcoastsystemsgroup/oshal/blob/e2c6d9575aaf47835838775bd7828de889881496/docs/releases/career-navigation-2026-09-12.md)
records installed source `3395b937`, the native Board/search round trip, retained filters and
53 passing installed Node checks with verified cleanup. Browser recipes remain registered
with unavailable prerequisites in the installed Lab; their Chromium results are local.
[Release boundaries](BACKLOG.md).

**Operating it:** the nightly scrape, the AI scoring passes, the morning digest, the boot catch-up,
how to see whether each ran and for whom, how to trigger them by hand, and which AI credential the
batch uses on a demo box versus a multi-user deployment are all in
[docs/operations.md](docs/operations.md). Read it before diagnosing "no new jobs".

## Shape

- `oshal-app.yaml` declares the service-or-OIDC `/api/career-hunter` mount, OIDC graph mount,
  package bot, CLI tools, grouped ribbon surfaces, the `portrait-studio` app dependency,
  `career-application` workflow, migrations, and requested guest tier. Data routes still derive
  their subject from OIDC; only the admin refresh accepts a trusted service subject and then
  rechecks Career administration. `dependencies.connectors` is intentionally absent rather than
  `[]`: present means "the complete set of connectors my surfaces may offer", and this app
  reaches at least `anthropic`, `firecrawl`, `google`, and `twilio`, so an empty or partial list
  would silently strip working connectors off Career Settings and the digest.
- `src-routes/` contains small route-family registrars plus dependency leaves for user-store paths,
  brokered engine dispatch, process leases, transactional files, cron, feeds, scoring, studios,
  artifacts, job guide, graph, and onboarding. The canonical `oshal-app build` compiles every
  source module into `routes/`; package-relative imports must resolve inside that generated tree.
- `bin/oshal-jobhunter.js` and `engine/` are the package-owned CLI and Python domain engine.
  Mounted routes broker only the authenticated caller's provider credentials into finite
  asynchronous children; direct manifest tools enter the same user-store concurrency boundary.
- `tools/` contains the package surfaces and `career-hunter.css`, served from this package.
- `migrations/` contains the idempotent Career schema, RLS, corpus, compatibility-view, and
  interview-bank migrations.
- `tests/` contains Vitest and dependency-free `node --test` guards covering source and compiled
  runtime behavior, tenant paths, engine leases, bounded extraction, upload rollback, board
  planning, digest routing, graph ingestion, and resume preview behavior.
- `scripts/` contains graph and insights smoke checks.
- `docs/` contains the longer-form package notes, indexed by [docs/README.md](docs/README.md).

## Remote-only matching

Career Settings carries a **Remote only** toggle. When it is on, the *automated* match considers
only postings the ATS feed flags as remote:

- the nightly AI scoring pass skips on-site roles entirely, so no inference is spent on a job you
  would not take;
- your digest carries remote roles only;
- your job board defaults to remote — an explicit Any / Remote / On-site pill still wins.

**Job Search is deliberately not affected.** It is a browse surface over the whole corpus with its
own pills, not a match surface.

The preference lives on `career_score_settings.remote_only` (migration 104), is additive and
defaults to off, so nothing changes for anyone until they turn it on. A `remote` flag is derived per
posting by every ATS adapter (`_looks_remote`, plus explicit provider fields like `isRemote` and
`workLocationOption`).

## The story review (ADR-141 D7)

A bullet asserts; a story proves. **Strengthen** now walks your roles one at a time:

1. It asks about the first role with no story, quoting that role's **own** resume bullet, so the
   question is specific without spending a token.
2. Your answer is attached to that role and to the bullet it supports. A model may only cite a
   bullet the role actually carries — anything else falls back to the best word-overlap match, so a
   story can never point at a bullet that does not exist.
3. With no AI provider reachable the answer is kept **verbatim** with that same overlap match, so
   the review works on a box with no key at all. Each story records which path wrote it (`source`).

Stories live on the profile as `roles[].stories[]` and surface four ways: `GET /stories` (the
review state and the next question), `POST /stories/answer` (one answer, one role), the `stories`
readiness the Intelligent Career group's setup page reads, and an `EVIDENCE:` line per role in
`profile.summary()` — the dense profile the **scorer** reads, not the generator. A story the model
flags as carrying no real evidence is kept but never offered as proof.

The whole conversation is guarded by `tests/career-story-review-conversation.test.mjs`. It runs the
shipped Strengthen script against the compiled story and readiness routes over a three-role profile,
with no provider. Each turn goes through the real engine path:

- `career-engine-dispatch` claims the store lease, then runs the caller's Firecrawl brokerage query.
- `career-engine-runner` builds the child environment, hands over the run-lock adoption and registers
  the engine run.
- `bin/oshal-jobhunter.js` runs the Python `stories` verb.

It answers role by role until the card reads "Every role has a story". It then checks that every role
holds a verbatim story citing one of its own bullets and that readiness reports 3 of 3. A concurrent
turn gets 503 before brokerage. Anonymous calls get 401 with no brokerage or engine run. A second user
reaches only their own store.

The doubles are the page DOM, the Express router and body parser, the OIDC session, the logger, the
kernel trusted-service decoder (never trusted here), the unused SQLite driver, the Postgres pool and
the kernel token decryptor. The pool answers the brokerage query with no Firecrawl row, so the
decryptor, a tripwire, is never reached. No suite runs that query against a real Postgres. A
signed-in run on an installed box has not been recorded.

### Where the evidence goes (1.22.0)

The review only pays off if something downstream shows it and cites it. Until 1.22.0 nothing did.

- **The master resume document** (`resume base`, the document Resume Studio edits) carries each
  role's stories with the bullet each one supports, and the studio renders the story **under** that
  bullet. A story whose bullet a later edit rewrote is not dropped: it falls to the end of its role,
  where you can see the evidence that edit is about to strand.
- **A tailored packet** is generated from a prompt that carries the same evidence role by role, with
  the rule that a role holding a story must spend one of its bullets on it. Every citation the model
  returns is then verified against the story the profile actually holds **on the role it belongs
  to** — an invented story, a weak one, or one moved to another employer is dropped rather than
  trusted — and `application.json` records what survived as `stories_cited`.
- A profile that has never been through the review builds a **byte-identical** prompt to the one this
  package sent before. That is asserted, not assumed: `tests/career-story-evidence.test.mjs` compares
  it against `PROMPT.format(...)` directly.

### The live acceptance and its cleanup (1.26.0)

The review is proven on the installed package by an automated walk, not by hand:
`tests/stories-live-acceptance.mjs`, run as the operator automation identity after install
(`OSHAL_VERIFY_BASE_URL=http://localhost:35457 node career-hunter/tests/stories-live-acceptance.mjs`;
the PAT is read by name from `OSHAL_VERIFY_OPERATOR_PAT` or `OSHAL_VERIFY_ENV_FILE`, never printed).
It answers the Strengthen card's questions with answers that start with its own Test Lab mark
(`[oshal-test-lab:<tag>]`) until every role has a story, requires readiness to read "N of N roles
have a story." and the master document to show each marked story under its bullet, generates one
packet on an untouched posting on the Career bot rail and requires its `stories_cited` to be
non-empty, then removes the packet and exactly its marked stories and reads both back. An incomplete
cleanup fails the case. With Career auto-submit on, or no indexed resume, it writes nothing and
reports `unavailable`.

Two owner-scoped routes exist for that cleanup, each bound once to `career.change`:

- `DELETE /stories/test-lab/:tag` removes only the caller's stories whose recorded answer starts
  with that run's mark. The answer is kept verbatim whatever the distilled story became, so the mark
  survives the AI path. A tag that marks nothing answers 404.
- `DELETE /jobs/:id/packet` discards the caller's own packet folder and returns the caller's row to
  `new` with no paths. A posting the caller has no packet for answers 404; a posting applied or
  later answers 409 and keeps its packet, because that packet is the application record.

`GET /resume/doc?id=<posting>` also returns the packet's verified citations as `meta.storiesCited`.
Both removals run inside the leased engine child that owns the store. They are guarded by
`tests/career-test-lab-cleanup.test.mjs` on the SQLite store and on disposable FORCE-RLS PostgreSQL,
and the walk itself by `tests/stories-live-acceptance.test.mjs` against a loopback api. The catalog
gains two bindings, so installing 1.26.0 needs its AUTH-07 review. Locally tested only; no
installed run is recorded yet.

## Three board details that are not obvious from the code

**The feed is planned, not joined** (`career-board-feed`). Joining the full corpus to user signals
made the live multi-gigabyte corpus drag description text through the page cache even though the
board never renders it. The feed instead drives from `user_signals` through `idx_user_scored` in
sort-key order, bounds the candidate pool, and reaches the corpus only for that set. Signal-side
predicates remain inside the bounded pool. Keep predicates sargable (`p.target_role = 1`, not a
`COALESCE` wrapper), and do not add `p.description` to the board select. The supporting indexes and
`ANALYZE` setup live in `engine/jobhunter/db.py`; check `sqlite_stat1` first on a slow new install.

**There are two feeds, and the pre-resume one reads the corpus alone** (`career-browse-feed`).
`GET /jobs` answers "which of my scored matches", so it returns nothing for an account with no
signals database — which is every account before its first upload. `GET /browse` answers "what is
open at all" straight off the tenant corpus, and the board renders it in a score-free mode where
Apply becomes the resume-upload step. Its keyword search matches **titles only** and plans through
the covering `idx_corpus_browse (active, title)`; matching `p.description` there would reintroduce
the same page-cache problem the scored feed was replanned to remove. Guarded against a real SQLite
corpus in `tests/career-browse-feed.test.mjs`, including the query plan.

**The packet preview serves HTML, not the PDF** (`career-resume-preview`, `?as=html`). Mobile
browsers do not reliably render a PDF inside an iframe. The generator already writes the HTML
source beside the PDF, so preview serves that sibling with screen-only responsive CSS. A missing
HTML sibling returns 404 and must not silently fall back to an invisible embedded PDF. The PDF
remains the byte-identical artifact of record and every surface retains a top-level link to it.

## Runtime ownership and shared kernel rails

- **Package-owned:** the Python engine, templates, seeds, wrapper, routes, persona, migrations,
  and Career-specific browser assets in this directory.
- **Kernel-owned runtime:** the package loader, authenticated route mount, inline bot execution,
  connector-token cryptography, graph and notification skills, and the Python/Node interpreters.
  Career code reaches these through declared package imports and context rather than copying
  kernel implementations.
- **Data:** the shared corpus and per-user SQLite stores remain on the configured persistent
  Career data volume as the default backend; the staged PostgreSQL backend uses a shared corpus
  plus FORCE-RLS owner tables. `JOBHUNTER_STORE` accepts exactly `sqlite` or `postgres` and fails
  closed on every other value. Raw OIDC subjects remain the database/RLS identity; filesystem names use the
  package's reversible, contained user-segment mapper. An exact direct-child legacy raw-subject
  directory (for example Linux `auth0|abc`) remains an in-place compatibility alias, including its
  existing `user-<raw-sub>.db` basename, so database bytes and absolute artifact paths are not
  silently relocated. New unsafe identities use identity-marked encoded directories.
- **Cross-app rails:** the apply pipeline, apply operator, LinkedIn profile operator, Portrait
  Studio, and Profile Studio ingest callback remain shared integrations. Portrait Studio is now
  also a declared `dependencies.apps` entry and a Presence-group ribbon tile pointing at that
  package's own `/api/portrait-studio/app` surface — so its guest tier, not this package's,
  governs that tile.
- **Morning brief:** the kernel's `career-brief-bridge` consumes this package's hits and skips them
  cleanly when the package is absent.
- **Scrape targets — one portal table, one extension per user:** the shared `companies` corpus is
  the portal admin's table (the **Companies** surface, gated by `CAREER_HUNTER_ADMIN_SUBS`, seeded
  from `engine/seeds/`). Each user also owns a target list (`career_user_targets`, FORCE RLS) edited
  from Career Settings: a pasted careers URL is accepted only when the engine's own URL classifier
  (`python -m jobhunter classify`) matches a supported job-board pattern, otherwise it is rejected
  and never stored; accepted URLs are registered in the shared corpus with `user:<sub>` provenance
  and scraped once (`add-target`), after which the nightly chain carries them like any admin row.
  There is no TypeScript copy of the patterns — a guard proves the supported list equals the
  classifier's own literals. See [docs/operations.md](docs/operations.md#9-scrape-targets--the-portal-table-and-each-users-own-list).
- **AI credentials (worker rail, 1.24.0; signed since 1.25.1):** the engine child always sees an
  empty per-user login sandbox and only that user's brokered Firecrawl key; it holds no model-provider
  key, no vendor login and no fleet service secret for any user or deployment mode (the ADR-137
  amendment-A demo-operator carve is retired). Its model calls go to the career-bot through the
  worker rail, each signed with the run's own callback grant. Both the runner and the launcher
  are guarded; see [docs/operations.md](docs/operations.md#5-which-ai-credential-the-batch-uses-worker-rail-1240).
- **Permissions (ADR-149, 1.25.1):** `authorization.yaml` binds every route, tool, the Career bot
  and the Send-to-Career action to named permissions; `member` carries the whole app, `admin` adds
  the operator-only routes. See "Installing 1.25.1 on an enforce box" above.

<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document fail-closed credential recovery after removal of the public encryption-key fallback. -->
<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document the canonical framework build and dependency-free versus framework-backed Career validation commands. -->
<!-- 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | Document exact engine pins, the required dual-backend contract, convergence evidence, and the gated cutover runbook. -->
<!-- 2026-08-11 | maintainer@emeraldcoastsystemsgroup.com | Document the sectioned ribbon (Job Search / Resume / Presence), the cross-app Portrait Studio tile and its inherited guest tier, the deliberately absent connector allow-list, and the new docs/ index. -->
<!-- 2026-09-27 | maintainer@emeraldcoastsystemsgroup.com | Document the 1.24.0 Career worker rail: model work on the career-bot, the retired portal carve, owner run list/cancel, locally tested versus live-proven status, and the operator acceptance steps. -->
<!-- 2026-09-27 | maintainer@emeraldcoastsystemsgroup.com | Document the 1.25.0 storage-cutover tooling (outbox, reverse projector, rollback gate, observation window and status route) as locally tested, not live-proven. -->
<!-- 2026-09-27 | maintainer@emeraldcoastsystemsgroup.com | Name the end-to-end guard on the ADR-141 D7 story review conversation, the real dispatch/runner/launcher path it drives, its scoped doubles (including the Postgres pool and the decryptor tripwire), and that no signed-in installed run is recorded yet. -->
<!-- 2026-10-02 | maintainer@emeraldcoastsystemsgroup.com | Document 1.27.1: stopping a run (cancel, runner deadline, lease-loss fence) now stops its Python engine, because the engine runs inside the wrapper's process group under the runner's adopted lease; the wrapper's own fence spares itself; the Linux guard and its /proc reading. -->
<!-- 2026-09-29 | maintainer@emeraldcoastsystemsgroup.com | Document 1.27.0: the Test Lab application seam the approve -> draft live acceptance plants and removes, its guard and the AUTH-07 review its catalog revision needs; the worker-loss check is now automated in core (#903), leaving the second real user as the operator's. -->
<!-- 2026-09-28 | maintainer@emeraldcoastsystemsgroup.com | Document 1.26.0: the story review's automated live acceptance, the two owner-scoped removals it cleans up with, the packet citations in the studio document, and the AUTH-07 review the catalog revision needs on install. -->
<!-- 2026-09-28 | maintainer@emeraldcoastsystemsgroup.com | Document 1.25.1: the ADR-149 catalog, the engine rail on the kernel's signed-package-callbacks rail, the real-kernel enforce boundary proof, and what installing a catalog over the box's catalog-less app-admin assignment does (the reviewed migration, the dropped app-admin grant, the deploy recipe with backup and rollback). -->

## Build and validation

Compile route sources only through the framework builder, from the OSHAL kernel checkout:

```powershell
node scripts/oshal-app.js build ..\oshal-apps\career-hunter --framework .
```

The store release gate remains dependency-free and runs every `tests/*.test.mjs` file from the
package directory:

```powershell
node --test "tests/*.test.mjs"
```

`engine/requirements.txt` pins every Python engine dependency, including the PostgreSQL driver.
Store CI installs those exact pins and requires the same ATS/storage/nightly contract to pass on a
real temporary SQLite database and a disposable non-superuser PostgreSQL database. A developer
without PostgreSQL can run the SQLite half locally; CI is intentionally unable to skip the
PostgreSQL half.

Two multipart integration checks use the real framework-owned Multer/Busboy boundary. They run
automatically when a sibling kernel checkout exists; set `OSHAL_CORE_DIR` to an alternate kernel
checkout when the repositories are elsewhere. Dependency-free store CI reports those checks as
unavailable rather than substituting a fake parser.

## Storage promotion

[BACKEND-CUTOVER.md](BACKEND-CUTOVER.md) is the current promotion/rollback specification and names
every command. The loader is repeatable across corpus and per-user datasets, and
`engine/sync/report_convergence.py --require-convergence` produces count, canonical SHA-256, and
key-query evidence, naming each failing dataset. Since 1.25.0 migration 106 records every
PostgreSQL write to a Career table with a SQLite counterpart in an operator-only outbox,
`engine/sync/reverse_sync.py` projects it back into the SQLite stores (with a rollback gate), and
`engine/sync/observe_cutover.py` plus `GET /api/career-hunter/cutover/status` keep the seven-day
observation window. Locally tested on disposable PostgreSQL and synthetic SQLite stores
(`tests/career-convergence-contract.test.mjs`, `tests/career-reverse-sync.test.mjs`,
`tests/career-cutover-drill.test.mjs`, `tests/career-cutover-observation.test.mjs`); nothing is
live-proven. SQLite stays authoritative; this repository does not claim a live cutover, backup,
rollback drill or seven-day observation.

## `SESSION_SECRET` credential recovery

Mounted routes decrypt current kernel `v2:` connector values through the authenticated token
broker and stage only that caller's plaintext in the child environment. The CLI deliberately
rejects `v2:` database ciphertext when invoked without that broker. A real deployment
`SESSION_SECRET` is needed only to read an older unversioned AES-GCM envelope through the legacy
database fallback. Credentials written under the retired public fallback cannot be safely
recovered: reconnect Anthropic or Firecrawl under the real deployment secret. Never paste
ciphertext into an API-key field or restore the fallback.

<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document raw-subject compatibility aliases and collision recovery. -->

## User-store path upgrade

Back up the Career data volume before upgrading. Existing unsafe raw-subject directories remain
available only when their exact case-sensitive directory entry and legacy database/profile
signature prove ownership; case-folded, trailing-dot, device-name, symlink, and encoded-prefix
aliases fail closed. If both raw and encoded directories (or both legacy and canonical database
basenames) exist, startup fails closed instead of choosing one. Stop Career workers, preserve both
directories, determine the encoded target from the package root with the mapper command below,
reconcile the newer store from backup, and restart.

```text
node -e "console.log(require('./lib/user-store-path').userStoreSegment(process.argv[1]))" -- "<raw-subject>"
```

Legacy paths containing `/` or `\\`, and raw names in the reserved `~sub-` namespace, are never
adopted automatically because ownership is ambiguous. Move those stores into a freshly resolved,
identity-marked encoded directory only while every Career process is stopped, then rewrite any
stored absolute artifact paths to the new prefix before restart.

<!-- 2026-09-05 | maintainer@emeraldcoastsystemsgroup.com | Add the operations guide (docs/operations.md — batch schedule, admin checks, manual triggers, credential posture per ADR-137 amendment A, failure signatures, env knobs) and the credential-posture bullet after the 2026-08-10 → 09-05 scoring outage. -->

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| career-assistant | career assistant task | T4 | none | disable | not yet measured | none recorded |
| job-fit-scoring | job posting fit score | T2 | none | template | not yet measured | none recorded |
| application-packet | tailored resume and cover letter | T3 | none | disable | not yet measured | none recorded |
| resume-studio-guide | resume edit turn | T3 | none | disable | not yet measured | none recorded |
| job-guide | job guide turn | T3 | none | disable | not yet measured | none recorded |
| linkedin-profile-draft | profile draft turn | T2 | none | disable | not yet measured | none recorded |
| profile-ingest | resume or artifact ingest | T2 | none | disable | not yet measured | none recorded |
| story-review | story review answer | T2 | none | template | not yet measured | none recorded |
<!-- oshal-rating:end -->
