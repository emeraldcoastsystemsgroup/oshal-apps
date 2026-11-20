# Career Hunter — oshal app package

## Current guides and intended buyers (1.60.9)

With saved-job preparation off, Prepare application records the selected job once and opens its tailoring workspace.
Open application returns to prepared work. An uncertain write offers a read-only
Check preparation; another preparation attempt requires a separate press.

Removing a Career pick moves it to Removed and clears Saved. Its application and
native ticket history are kept; removal does not cancel a running native workflow.

Home and navigation paint independently of optional background reads. New matches waits at most two seconds for an unknown résumé-status read; a known or late no-résumé/indexing reply retains the actual gate. Late replies cannot restore a page after it closes.

Career gives a job seeker an individual workspace for finding jobs, preparing
applications and recording what happened. Prospective buyers include
**outplacement firms, workforce boards and independent career coaches** deploying
those individual workspaces.

- [User guide](docs/user-guide.md): a day from replies and new matches through
  preparation, sending, interviews and an optional past-seven-days goal.
- [Deployment guide](docs/deployment.md): current roles, connections, native
  services and acceptance checks.
- [Documentation index](docs/README.md): the current guides and engineering
  references.

The current roles are **Job seeker** and **Job source administrator**. A coach
role, seeker-approved sharing and a shared client pipeline are unbuilt; the
administrator role does not grant access to another seeker's private search.
Optional applications and automatic submission require their own available,
authorized setup. The guides describe the current package, not a claim that it has
been installed or verified on every device.

The versioned sections below retain engineering and release history, including
older page names and workflows. Use the current guides for user and deployment
instructions.

## Source readers (1.60.13)

Oracle boards are read to their stated count with bounded retries and facet searches that reach
past their 10,000-result search window. Resolve verifies an actual sample promptly; the same pull
still enumerates the replacement source in full. Workday saves completed facet searches inside the ingest's
private scratch directory, so a restarted pull can reuse recent searches whose counts still
match. The anonymous page reader can finish AWS browser checks and follow Avature's next-page
controls. Failed, empty and incomplete reads retain existing jobs.

See [Source reader recovery](docs/source-readers.md) for source changes, limits and checks.

## Source decisions (1.59)

A Job source administrator can review an unresolved employer source in
**Companies → Needs you**. Career keeps one native ticket for that administrator
and exact source decision. **Archive** approves that ticket; **Keep trying**
cancels it. The application's native confirmation requires that original
person's current source-administrator authority. No worker or model is
dispatched by this decision workflow.

A confirmed choice is queued for the next source pull. It is shown as applied
only after the writer reports the matching result. A changed, recovered or
already answered source refuses an old decision. An uncertain acknowledgement
keeps the original ticket and reports the uncertainty. A Done or Cancelled
status without the matching native owner-decision receipt stays on hold.

The existing maintenance job can prepare the same decisions for its original
administrator after normal activation review. This update does not activate a
job. See [source maintenance](SOURCE-MAINTENANCE.md).

## Page names and roles (1.55.0)

Each page has one name, in a job seeker's words. The manifest's label, the page's title and heading, every link and every
answer that names a page say the same (`tests/career-page-names.test.mjs`). Ids, tool names, addresses, routes and file
names are unchanged.

| Page (tool name) | Name | Was |
|---|---|---|
| `career-search` | Find jobs | Search Jobs |
| `career-board` | My jobs | Job Board |
| `career-resume-studio` | My résumé | Resume Studio |
| `career-experience-library` | Other experience | Additional experience |
| `career-strengthen` | Improve my résumé (Improve it in Career's own bar, under Résumé) | Strengthen |
| `career-profile-studio` | LinkedIn profile | Profile Studio |
| `career-settings` | Settings | Career Settings |
| `career-master-record` | Download my data | Master record |
| `career-insights` | Job market | Insights |

The résumé every application starts from is the **main résumé** (was master résumé); the value routes and tools carry for
it is still `master`. Sections below that were written for an earlier version keep the names the pages had then.

Two roles, named for people. The role templates' ids, versions and members are unchanged, and so is `authorization.yaml`:

| Role (template id) | Label | Holds |
|---|---|---|
| `member` | Job seeker | everything about their own search |
| `admin` | Job source administrator | the same, and `career.administer`: the Companies page and source health |

Career's bar shows the person's role beside their name. It is read from the person's own profile: the kernel lists the
Companies page there only for a person it would admit to it, and that page is bound to `career.administer`
(`tests/career-role-label.test.mjs`). Settings shows the job-source controls (Sources and pull health, Pull jobs now, Jobs
per score pass, the AI model, the Firecrawl key) only to a person the Companies route admits; everyone else has one button
under Check for new jobs now (`tests/career-settings-administrator.test.mjs`). That is presentation: no route or binding
changed.

## Job search workflow (1.60.3)

**Find jobs** searches public openings. **Save** keeps a selected opening in **My jobs → Saved** after its favorite write is acknowledged; with saved-job preparation off, it starts no scoring request or score poll. Existing scores remain visible and missing scores read **Not scored yet**. Choose **Check my fit** for an assessment, or **Prepare application** to open the job's draft and request documents with **Generate**.

The queue offers document previews, PDFs and customization before an explicit submission action. Stars stay independent of application status; Saved and application views retain explicitly chosen jobs outside the current matching area or after a posting closes.

A desktop submission ticket does not mean an application was submitted. The recorded worker outcome supplies that evidence. For applications completed elsewhere, **I applied** retains the manual-assertion provenance.

Application status activates the original person's `career-application-updates` schedule, every
15 minutes. It reads the connected Gmail mailbox through native credential custody and requires
that mailbox to match the resume's submission email. The monitor starts with the past seven days
of submitted applications, retains those applications for later updates, and never reads other
owners' stores, sends mail or submits jobs. Exact employer/title matches can record acknowledgements,
interviews, offers or rejections. Ambiguous matches remain for review. Email receipts do not upgrade
manual submission provenance to verified employer acceptance. Connection failures remain visible;
open **Settings → Accounts** to connect or reconnect Gmail through native authorization.
Saved authorization metadata does not prove mail-read access: the same section shows the dated
last successful mailbox check separately. Connecting never starts a mailbox check or sends mail.
Use **Email updates** for the existing monitor controls. LinkedIn profile updates use your
signed-in browser; optional Social account flows remain in the admitted Social Workspace.

Private `job-board-state.json` holds stars/preparation receipts; `application-email-state.json`
holds bounded message identifiers, subjects, dates, mailbox and update classifications, pagination
and retry state. Both publish with the owner's native generation. Preparation domain failures publish
an explicit failed receipt; a completed engine process alone never means documents are ready.

## Native nightly resume matching

The native `career-nightly-matches` owner schedule checks every 30 minutes in America/Chicago.
Enable or pause it in Career Settings. It runs against the published shared corpus, after the
installation's separate shared pull succeeds. The ingest's private working copy is never read.

One kept owner run keyword-matches the recent 14-day window to the saved resume, then AI-scores
up to 50 previously unscored target-title jobs posted in the last seven days (first-seen fallback
for undated jobs). The saved local-radius/remote preference applies to AI selection. Matching and
scoring share the owner's existing score lease. The job creates no application submissions.

On the native kernel the AI selection leaves out a job nothing there can describe (1.62.3): no
listing text, no saved private copy, and no posting the Career rail can read through the kernel's
egress. Such a job could only be skipped, and because the nightly pass takes pending jobs newest
first, it took one of the 50 slots again every night ahead of jobs that could be scored. The rail
reads a Workday posting, and since 1.63.0 an Oracle Recruiting Cloud requisition (on the
candidate-site hosts `*.fa.oraclecloud.com`, `*.fa.us2.oraclecloud.com`, `*.fa.us6.oraclecloud.com`
and `*.fa.ocs.oraclecloud.com`) and a SmartRecruiters posting (`api.smartrecruiters.com`), each by
one documented anonymous GET (`lib/career-employer-detail.js`). A job whose read is refused, for
example by Workday's maintenance redirect (`303`) or a closed posting, is skipped after that one
read and tried again the next night.

Since 1.64.0 most other jobs are selected and scored too, with no request at scoring time: the
full pull keeps their descriptions in the corpus's listing text. Google's results page already
carries every job's description; for Eightfold, Experis and other listed boards, Radancy,
SuccessFactors, iCIMS, Avature, Webflow and employers' own sites, a description stage after every
list is read fetches the job's own page on the list's site, under caps an administrator can change
or turn off without a release (`engine/jobhunter/pull_details.py`; see the operations guide,
"Descriptions the pull keeps"). Sites behind a browser check (Jacobs, CBRE, Delta, Regeneron, SAIC,
Verizon) are not read.

`nightly-match-success.json` is private to the owner and publishes with their scores only after
the child succeeds. The published corpus version prevents repeating a finished pass; each corpus
belongs to the pull cycle that began at the most recent pull time in America/Chicago, with one successful
pass per cycle. A catch-up publication inside the same cycle therefore cannot consume the next pull's
publication. The pull time comes from the per-package setting `CAREER_INGEST_CRON`, which the operator sets
to the same plain daily `minute hour * * *` cadence as `OSHAL_CAREER_INGEST_CRON` (in `oshald.env`, as
`OSHAL_PACKAGE_ENV_CAREER_HUNTER__CAREER_INGEST_CRON`): the kernel clears the package's environment, so the
pull's own variable never reaches the route. With no setting, or any other shape, cycles begin at 18:00.
Failed runs remain eligible at a later check. The native job receipt records dispatch; Career Settings separately shows the
completed keyword/scoring counts. Enabling the schedule does not enable auto-submit or change
draft generation settings.

**Settled nightly scoring (1.65.0, off unless the installation sets `CAREER_NIGHTLY_SETTLE=1`).** Each job is
asked three times on byte-identical input and keeps the median only when all three runs share one side of 70
and the median is outside 64 to 75; a close call is left undecided (no score, asked again the next night once,
then left to Check my fit), because a package cannot send one call of a kept scheduled run to a stronger model
order. Fewer than two valid runs score nothing (Not scored yet, pending); an answer with no text is one unanswered
try and never ends the pass. Up to `CAREER_NIGHTLY_LIMIT` (400) jobs a night, best candidates first (saved titles in the title, the
keyword match, the newest), at most three calls at once, in kept runs of at most 20 minutes continued by the next
half-hourly checks until `CAREER_NIGHTLY_BUDGET_MINUTES` (60) is spent. Its receipt is version 2 (scored,
undecided, unreadable, failed, not reached). Off, the pass, its inputs and its receipt are 1.63.0's. Settings,
what the kernel would need for close calls, and how to switch it: [docs/operations.md](docs/operations.md);
the measurement: [docs/settled-scoring-measurement.md](docs/settled-scoring-measurement.md).

**Jobs Career cannot read still reach New matches (1.66.0).** A job of the person's nightly selection whose
description cannot be had is marked "details needed" in their store (no score, no model call): on the native
kernel the jobs no reader there can describe, with no read, best title and keyword matches first, at most 200 a
night; a job whose one read is refused, after that read. New matches lists them as **Details needed** with the
warning and **Open the posting**. In **Prepare application**, step **1 · Tailor** takes the description the
person pastes from the posting (200 to 20,000 characters), kept as their own copy of that job (never the shared
corpus) and used for **Check my fit** and generation; **Generate résumé & cover letter** waits for it, and
`POST /jobs/:id/generate` refuses such a job with nothing pasted (`job_details_needed`), so Jarvis and the
Concierge say where to paste it. Since 1.66.1 a job the nightly pass did not mark whose preparation stopped for
missing details reads the same: `GET /jobs/:id` carries `details_needed` with those words, and the off
**Generate** is drawn off (greyed, `aria-disabled`). Details: [docs/operations.md](docs/operations.md), "Jobs listed without a description".

## Nightly source review (1.47.6)

Each full pull ends with a bounded review of the sources it could not read. It moves a source only
when the employer's own page points at a board that returns jobs, reports name-only matches as
suggestions, leaves an employer that refuses alone, and reads only public addresses. The Companies
page shows what was repaired, what needs a person, what the pull did and what is still broken. See
[the nightly source review](SOURCE-REVIEW.md).

A pull a restart stops continues from the last employer it finished. See
[a stopped pull continues](SOURCE-MEMORY.md#a-stopped-pull-continues). Resolve and Accept on the Companies page take effect at
the next pull, and the page shows what happened. See [changing a source](SOURCE-MEMORY.md#changing-a-source).

## Fresh job-search cycle (1.29.0)

On the Job Board's **Ready for submission** tab, **Review Ready items older than 7 days** previews
the exact queue count and packet date range. The separate purge button permanently removes only
those old generated packets and the caller's matching score/application rows. It leaves applications,
Promoted, Needs you and Dismissed rows, other users' data, and the shared openings corpus intact.
The server rechecks the seven-day cutoff and exact preview count before it commits, and restores
packet folders if the database transaction fails. The store adds a partial composite index on
`status, generated_at` for SQLite and `user_sub, generated_at` for PostgreSQL.

This adds an owner-scoped `career.change` catalog binding. Installing it creates a catalog revision
that needs the normal AUTH-07 review.

The job-hunting application carved out of the oshal kernel under ADR-085. Its TypeScript routes,
Node CLI wrapper, Python `jobhunter` engine, persona, migrations, and browser surfaces ship in this
package. The kernel supplies shared runtime capabilities and mounts the package; it does not own
Career Hunter domain code.

## Search responsiveness (1.28.1)

Jobs load before optional map assets. List view downloads the map only when Map is
selected. Typing waits 150 milliseconds before searching, cancels superseded requests,
and keeps the previous cards and pins visible with an updating status. A failed update
leaves those results explicitly labeled; only a successful search updates remembered criteria.

## Local jobs and Career experience (1.28.0)

Open `https://<your-host>/cockpit/?app=career-hunter` for the Career experience;
`?app=intelligent-career` retains the grouped front door. The experience uses the
existing authenticated Open jobs search page. Configuration and Sources & pull health
are visible beside search, and the group also has a Configuration navigation band.
Existing catalog permissions and role templates are unchanged.

Enter a US town and state or a five-digit ZIP, or press **Use my location** to request
browser location permission. Set a radius from 1 to 250 miles. The same filters drive
the list and the map; radius filtering happens before candidate limits and pagination.
Invalid locations produce an error rather than silently returning nationwide jobs.
GPS is requested only when pressed, and a denied request leaves manual location usable.

Map pins group postings at their recorded city/base coordinates. They are approximate,
not exact workplaces. Radius distances are straight-line miles, not commuting routes.
Listings without usable coordinates remain available outside radius searches. The map
shows the current result page and uses locally packaged Leaflet with OpenStreetMap
background tiles; the list remains usable when tiles cannot load. See
[offline geo data and query contract](GEO-SOURCES.md) for provenance and index provisioning.

Your last successful search and named searches are remembered for your signed-in account
**in this browser**. They restore location, radius, filters, sorting and map/list choice.
An explicit search URL takes precedence over browser memory. Clearing browser data removes
these searches; they are not synchronized across devices. Storage failures are shown.

The salary menu includes $140,000. **Include jobs without listed pay** keeps unknown pay
visible when a minimum is selected; it does not treat unknown pay as meeting the target.
Estimated salaries are labeled. Other filters continue to narrow the same feed.

### Private LinkedIn leads

In Configuration, import the **Saved Jobs CSV** extracted from your own
[LinkedIn data download](https://www.linkedin.com/help/linkedin/answer/a1339364).
Save recommended matches on LinkedIn first if you want them in that export. The private
lead list is separate from résumé/profile enrichment and from the shared employer corpus;
an imported lead is not marked applied and has no invented pay or location.
This does not automatically retrieve LinkedIn's personalized recommendations.

### Sources and pull health

Configuration links to the shared administrator source list, including per-employer attempts,
successes, unconfirmed pulls and new/changed/unchanged/closed counts. History starts when the
updated ingest runs; older snapshots explicitly report missing history. Sites that supply
HTTP validators can avoid downloading unchanged single-page feeds. Other sites still require
full listing reads, while content hashes avoid rewriting unchanged posting bodies. See
[source memory and completeness rules](SOURCE-MEMORY.md).

The native installation manages shared-source refreshes through its corpus writer. Configuration
reports that mode and disables the separate legacy refresh button. This preserves writer
coordination and does not acknowledge a job the app cannot run. Per-person scoring remains
separate.

The [reviewed Emerald Coast directory](LOCAL-SOURCES.md) includes supported college and county
feeds plus official school-district hiring links. Where the application manages source writes,
Configuration offers **Add supported feed**. Native Configuration shows enrollment managed by
the installation and identifies included feeds for administrators. Other sites are labeled external only. These are regional sources;
location/radius searches themselves accept US towns, ZIP areas or explicit coordinates.

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

**Resume Studio's master resume is a Word document** (1.49.0): it opens in AI Office's own editor with
AI Office's standard Concierge beside it, and **Save to master resume** writes it back through the
whitelisted `resume base-save`. The heading contract and the rules each assistant follows are in
[docs/career-and-office.md](docs/career-and-office.md). Since 1.51.0 saving the document never changes the
master by itself: the Skills line is read back only on the " · " the document writes (a semicolon is part
of a skill), and the credential line shown in place of an empty headline is never saved as the headline.
Also since 1.51.0 a résumé upload works on the native kernel, whose request arrives as one bounded Buffer with
no stream events: the upload route bounds that body (8 MiB plus the multipart envelope) and no longer waits for
`req.once('aborted')`, as the artifacts upload has since 358d21a9 (guards: `tests/career-resume-native-upload.test.mjs`,
`tests/native/career-resume-bridge-proof.mjs`).

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
review state and the next question, read from the profile file by `lib/career-stories-state.js`
with the same projection as the engine's `stories.state()`, so it starts no engine child), `POST /stories/answer` (one answer, one role), the `stories`
readiness the Intelligent Career group's setup page reads, and an `EVIDENCE:` line per role in
`profile.summary()` — the dense profile the **scorer** reads, not the generator. A story the model
flags as carrying no real evidence is kept but never offered as proof.

The whole conversation is guarded by `tests/career-story-review-conversation.test.mjs`. It runs the
shipped Strengthen script against the compiled story and readiness routes over a three-role profile,
with no provider. Each answer goes through the real engine path (a review read starts none):

- `career-engine-dispatch` claims the store lease, then runs the caller's Firecrawl brokerage query.
- `career-engine-runner` builds the child environment, hands over the run-lock adoption and registers
  the engine run.
- `bin/oshal-jobhunter.js` runs the Python `stories` verb.

It answers role by role until the card reads "Every role has a story". It then checks that every role
holds a verbatim story citing one of its own bullets and that readiness reports 3 of 3. A concurrent
answer gets 503 before brokerage while a review read is still served. `tests/career-stories.test.mjs`
checks that the JavaScript read answers exactly what the engine's `stories.state()` answers for the
same profile file. Anonymous calls get 401 with no brokerage or engine run. A second user
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
Apply becomes the resume-upload step. Both screens put a keyword box and Search button directly
below the heading. Open search matches **titles, descriptions and employers** without a resume;
advanced title-only and description-only inputs narrow those results independently. The matched
board searches the signed-in owner's scored jobs by title and description. Both use the corpus's
FTS index before fetching result rows, so a rare keyword does not scan historical descriptions.
Legacy corpora without FTS retain the bounded LIKE fallback. Guarded by the real SQLite feed and
screen-script tests, including description-only matches, original-owner scope and query plans.

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

## Client engagements under an employer

Career 1.68.12 lets you place an existing Work history entry under its employer. Edit the client entry, choose the employer, and save. Each entry keeps its own title, dates, bullets and story. Removing the relationship makes the entry independent again; Undo restores the previous saved revision. Choose the optional **Selected Client Engagements** heading on the employer when useful.

The employer stays at the main left margin. Client headings sit a quarter inch inward, their bullet text a further 0.175 inch inward, and dates share the original right margin. The saved relationship carries through My résumé, tailored packets, Word, PDF and plain text. Grouping comes from your explicit choice.

Deploy AI Office 2.20.9 before Career 1.68.12 so its document model and exporters preserve the indentation and heading continuity. Existing entries remain flat until you group them.

Career 1.68.13 adds **Tab in**, **Tab out** and **Add sub-engagement** beside each Work history entry’s existing actions. Tab in places an entry under the preceding employer group; Tab out makes it independent again. Add sub-engagement opens a separate entry under that employer. While editing, these controls update the form until you Save; Cancel retains the previous saved relationship. Existing dates, bullets and Undo remain available. An ambiguous or unavailable parent is explained instead of silently choosing another entry.

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
| interview-preparation | interview guide or practice feedback | T3 | none | disable | not yet measured | none recorded |
| linkedin-profile-draft | profile draft turn | T2 | none | disable | not yet measured | none recorded |
| profile-ingest | resume or artifact ingest | T2 | none | disable | not yet measured | none recorded |
| story-review | story review answer | T2 | none | template | not yet measured | none recorded |
<!-- oshal-rating:end -->

### Interview preparation and practice

Choose **Interview preparation** on a Job Board card. The job-specific guide links
to exact experience recorded in the candidate profile, suggests varied practice
questions and identifies gaps to discuss honestly. Answer in your own words to save
private feedback and an exact quote from that answer. Preparing a fresh guide keeps
earlier practice available. A changed job/profile or a different guide requires
fresh preparation before another practice answer is assessed.

Jarvis uses `career_interview_prepare`, `career_interview` and
`career_interview_practice` through the same original-owner background runs and
saved receipts as the UI. An acknowledged run is not a finished guide. Practice
answers do not update the candidate profile or send anything to an employer.

### Search size and location with Jarvis

Open jobs search and Job Board offer 25, 50, 100 or 200 results per page, with Previous/Next navigation. The selected size is remembered with the search filters. A displayed page is not the total number of matching jobs.

Jarvis can call the read-only `career_database` tool with search filters with explicit city/state or ZIP (`near`) and `radiusMiles`, or `useHome: true` to use the acting user's saved Career Matching area. For example: “Find developer opportunities within 50 miles of my home.” Home references that saved city/ZIP center; it does not infer a street address. A temporary search does not change the saved matching preference. Distances are approximate straight-line distances, and postings without coordinates cannot satisfy a radius search. The tool returns public openings, source freshness, pagination facts and an Open jobs search link; it does not score, pull sources or submit applications.


### Pay ranges and missing employer pay

Search Jobs and Job Board accept `min_pay`, `max_pay`, and `pay_period` (`year`, `hour`,
`month`; defaults to annual), in USD. Both bounds are optional. A posting matches when
its pay interval overlaps the requested interval, inclusively; a single published
endpoint acts as a point. Other currencies and other pay periods are not compared
or converted into the selected basis. Invalid or reversed bounds return HTTP 400.

Employer-listed pay is preserved. For missing pay or the old generic heuristic, the
read path uses a reviewed title-to-occupation mapping and the **25th–75th percentile**
of BLS OEWS **May 2025 national wages**. The source, survey, occupation, national
geography, method and low confidence travel in `salary_estimate`, and cards label
these numbers as estimates with a source link. This is a title-based inference,
not an employer offer or a local/seniority adjustment. Annual estimates are not
assigned to part-time jobs, adjunct/per-course roles, interns, or apprentices.
Foreign/unspecified locations and unmatched titles receive no invented default.
Unresolved jobs are excluded from a pay-filtered search unless
`include_unknown_pay=1`; this does not admit a known incompatible currency or unit.

The pinned public extract is `lib/career-pay-benchmarks.json`, with the official
ZIP URL and its SHA256. Refresh deliberately after reviewing a new BLS release:
`python3 career-hunter/scripts/update-pay-benchmarks.py --year 2025` from the repo
root. The script uses only the Python standard library. Estimates require no model
calls, user-store writes, corpus migration, or external request at search time.

### Selected job details and Jarvis document preparation

Preparing a selected job resolves missing or short feed descriptions through the
employer connector. The fuller description stays in the original owner's private
`job-context` store, bound to the listing ID, employer, title, URL and description
hash. Scoring, documents, job details and interview preparation reuse that context
even when the shared corpus is read-only. An unavailable description stops
preparation; a remaining short summary is explicitly identified as limited source
material. No requirements are inferred from omitted text.

Each new packet's `application.json` retains the gated source profile, employer
description and prompt truncation metadata. Scoring includes up to 16,000 employer
characters and document generation up to 24,000. Native private completions accept
the full profile within a 256 KiB request bound and preserve the engine's requested
output allowance, up to 8,192 tokens.

Jarvis uses the same native routes to save/star a job, promote it, start a draft,
read its preparation receipt and inspect its saved documents. A background start
is not a finished packet. Final employer submission still requires approval of the
specific packet and uses the enrolled browser worker.

The native Python sandbox has no external network. Selected Workday details use
the same run's signed callback and the kernel's declared anonymous Workday egress,
limited to structured job-detail GETs. The bridge never sends the profile, caller
headers or employer credentials, and refuses redirects, unrelated paths and hosts.
Other unsupported detail hosts retain their explicit listing-summary limitation.

Private fit scoring uses the complete compact recorded profile, including every
role, deliverable, skill, education entry and certification. It no longer uses the
3,500-character overview, which could remove most of those facts before inference.
Independent work is retained for private scoring and remains separately gated for
employer documents. A scoring profile above 128 KiB stops with an explicit error;
it is never silently shortened. Each new score records a fingerprint of the complete
scoring evidence, considered description, source limitations, scoring contract and
resolved model. Bounded batch passes reuse matching scores and can refresh legacy
or changed inputs. They inspect at most ten times the model-call limit per pass,
with a private scan cursor so unchanged early results cannot hide later changed
jobs. Existing title, area, age and workflow-state restrictions still apply; a
score refresh never changes an application's status.
The native rail currently reports the logical `oshal-career-bot` model identity.
An operator changing its underlying provider/model must also change the exposed
identity or bump the scoring contract version to invalidate existing fingerprints.

Resume and career-material intake preserve supported source statements for
education, certifications and licenses, including pending, expired and date
modifiers. Additive updates retain existing facts, backups and audit records.
Supported extracted text is read completely up to 32,000 characters; oversized or
unsupported evidence is refused before publishing instead of silently dropping
the document tail. Ordinary name/credential and contact/clearance headers remain
supported. A failed qualification check leaves the prior profile unchanged.

Career Settings exposes the original owner's matching and application-email
routines separately. Both offer enable, pause and check controls, including fresh
review after a package update suspends the saved source. These controls preserve
the caller's existing schedule identity and authority; email monitoring reads the
connected submission mailbox and sends no messages or applications.

### Reading and refining job results (1.45.6)

The Job Board fetches one selected-size batch at a time. **Load more** appends
the next batch while keeping existing cards and expanded documents mounted.
**Next** and **Previous** replace the page and return to its top. Filters retain
the previous results while the request runs; a failed refresh offers Retry.
Stable posting identifiers break ranking ties, and indexed open search can
continue past the former 2,000-result ceiling.

**Not interested** is available in Search Jobs and the Job Board. Hide only the
opening, a title phrase such as general manager, the selected company, a
location, or a keyword in job titles/employer industries such as retail. Rules
are saved under the original owner and applied before pagination in open search,
active matches and Jarvis reads. **Hidden preferences** lists the rules and
lets the owner remove them. Explicit saved/queue/application history remains
accessible; these preferences do not delete applications or change the corpus.
Repeated links to the same employer opening are consolidated within loaded
results after removing tracking parameters; distinct requisition parameters
remain separate.

### Application flow (1.55.0)

One route takes a job from found to applied. Each step names the button a person presses.

1. **Find jobs**: search, and press **Save** on a job. It is now in **My jobs**, under Saved. Jobs Career picked for the
   person lead that list, marked "Career picked this for you"; **Remove** declines one.
2. **My jobs**: press **Prepare application** on a saved or picked job. That moves the job to Getting ready and opens
   its application page. It generates nothing and sends nothing.
3. **1 · Tailor**: the main résumé is the starting point. Write what this employer should understand, optionally tick
   entries from **Other experience**, then press **Generate résumé & cover letter**.
4. **2 · Review documents**: read both documents, use **Edit documents** if something should change, then press
   **Continue to send**.
5. **3 · Send**: **Open the employer's form** (the posting's own address, in a new tab), **Download résumé and cover
   letter**, and, once the form is in, **I applied**. Career records the application as the person's own word and says
   so: "You marked this as applied yourself. Career has no confirmation that it was sent." **Pressed I applied by
   mistake?** on that page puts the job back in Getting ready.
   With a computer connected, **Send it for me from my computer** follows those three buttons and opens the exact
   documents and details to approve (**Approve & submit**). With none connected the page says so, offers no button
   that needs one, and **How to set up your computer** explains the steps.
6. **Applications**: the job is under Applied, with one line that says how Career knows. The line leads with Applied
   for a job the person marked themselves, and with Sent only when their computer reported it or Career holds the
   confirmation page. Interviewing, Offer and Closed are the other stages there. A reply from the inbox shows on the job's row, and **Prepare for
   interview** is on its application page. While Career is sending something from the person's computer, or a send
   did not go through, that job leads Applied (Waiting, Sending, Needs your answer or Did not go through) and one
   link, **Follow what is being sent**, opens the activity page.

Select a job's title to read its posting and fit assessment. There is no separate To approve stage:
`/api/career-hunter/approvals` and `?view=approve` still answer, and open My jobs on Career's picks.

### Other experience (1.46.0)

The Additional experience library holds independent products/projects, other
employment, volunteering and optional skills separately from the core résumé.
Existing independent portfolio evidence is read only from that same owner's
profile and appears as a selectable entry; it is never copied from another
user or added to the core by opening the library. Save facts in the library,
select their entries per application, or archive/restore an entry. Generation
checks the selected library revision and preserves entry IDs and titles in
the packet. Relevant selected work is rendered in **Additional Experience**;
skills-only entries do not become fabricated jobs. Unselected optional work
is absent from document prompts. Private fit scoring may consider recorded
active optional skills/work; that does not opt it into employer documents.

The owner APIs are GET/POST `/experience-bank` and GET `/experience-library`.
They retain the existing read/change/open permissions. `career_experience_bank`
provides summary IDs and revision to Jarvis; `career_draft` accepts explicitly
selected IDs/revision. The legacy portfolio draft tool remains an opt-in alias.

### The saved portfolio's Edit form (1.68.7)

The saved portfolio (`oss_portfolio` in the main résumé, the `saved-portfolio` entry the list makes from it) is
what job scoring reads, and what a résumé or letter uses when the person ticks the entry. Before 1.68.7 nothing
changed it: the list's own form saved a copy into the Other experience file, which résumés then used while job
scoring kept the old portfolio. Now:

- Opening the entry on Other experience shows its own form (`tools/career-experience-portfolio.js`): organization or
  product, your role, dates, your site, product site, product link, bullets, technology, applications and skills one
  per line, the summary for job scoring, a short label and a private note.
- The form reads the portfolio whole with the main résumé's exact revision (`GET /resume/master-section?field=portfolio`,
  engine `portfolio.read_section`), and **Save portfolio** sends it whole as one main-résumé edit
  (`POST /resume/master-edit` with `{op: 'set', field: 'portfolio', value}`, engine `portfolio.apply_edit`). Every field is
  checked first (at most 20 bullets of 1,500 characters, 60 items of 100 characters per list, http or https links, no
  control characters), then one write goes through the same backup, audit and atomic publish as every main-résumé edit.
  An empty text removes its key; keys the form does not show are kept. With no portfolio saved yet, the same edit
  writes one when the form holds anything (the list then offers it); the page offers the form only for a saved one.
  A main résumé that moved since the form read it
  is refused (409) and read again, and a save that would grow the main résumé past what job scoring reads (128 KB) is
  refused in words. **Undo** puts the earlier version back (`POST /resume/master-undo`).
- No new route and no new binding: the read and the save use the existing `career.read` and `career.change` routes.
- The list's own form no longer saves the entry while it still comes from the main résumé (409, "has its own Edit
  form"). A copy saved there before 1.68.7 keeps that form, and the portfolio form refuses a save that would leave the
  two apart.

Guarded by `tests/career-portfolio-edit.test.mjs` (Test Lab case `portfolio-edit`; red on store main 6467ca6d).

### Concierge pressed early (1.68.8)

Career's bar draws **Concierge** before Career's concierge has mounted: `tools/career-concierge.mjs` and the kernel's
shared assistant are still on their way, which on a busy or just-started installation takes seconds. Until 1.68.8 a
press in that window reached no handler and the button did nothing (the coordinator's one-chat-window live check on the
test slot, 2026-11-17, at 412 right after a restart). Now `tools/career-frame.js` keeps such a press
(`data-career-concierge="wanted"`, the button `aria-busy`) and the concierge opens as soon as it mounts.

Guarded by `tests/career-concierge-early-press.test.mjs` (Test Lab case `concierge-early-press`; red on 1.68.7) and, on
the test slot, by the kernel's `ops/audit/one_chat_window_live.cjs`, which presses Concierge at 412 while Career's
concierge module is still held back.

## Master record (1.51.0)

**Master record** (Resume, next to Additional experience; Resume Studio's **⋯** (More) menu, "Master record
(everything saved)"; `/cockpit/?app=career-hunter&screen=career-master-record`) shows everything Career keeps
for the signed-in person, top to bottom:

- the counts;
- the profile: name, credential, headline, location, citizenship, clearance, contact, links, headline
  options, summary and core competencies;
- **Experience**: each role with its numbered bullets, the skills tagged on it and its stories;
- **Skills** by group, with each group's proficiency;
- **Additional experience**: the library's entries, including the saved independent portfolio;
- **Education and certifications** (and licenses when there are any);
- **Evidence**: metrics, the project ledger, named accounts, speaking and employers;
- **History, newest first**: the date, what was added and the person's own words (a Resume Studio save is
  labelled as one), then the Strengthen answers and the dates of the snapshots taken before a change;
- **Linked documents**: the résumé and the detailed work addendum the profile links, kept outside Career;
- last, on screen only, the notes Career keeps for writing (framing notes, gaps to collect, locked facts).

**Download** saves one Markdown file of all of it except those writing notes (the page builds the file,
because the kernel does not pass a package's download header). **Print or save as PDF** is in the page's
**⋯** (More) menu. The mailing address used on application forms is not part of the record.

The page reads only the caller's own folder: `career_db.json`, `enrichment_log.jsonl`, `experience-bank.json`,
the `gap_themes` table of the owner database (opened read-only, immutable on the native kernel's pin) and the
names of the files in `backups/` (a snapshot is never opened). Nothing is written, no engine runs and no model
is called; a person with no store gets an empty record and no folder is made for them. A source that is a
link, or larger than Career's own writers keep it, refuses the whole record instead of showing one that
silently lacks it.

The concierge reads the same record through `career_master_record`: `GET /master-record?page=N`, pages whose
whole JSON answer is at most 12 KB, whose texts together are exactly the Download, each with the counts, the
page link and a `revision`. Asked for everything, the Career bot answers with the counts and the page link
rather than pasting the record. The page (`GET /master-record-ui`) is bound to `app.open`, the data route and
the tool to `career.read`: no permission or role changed. Guards: `tests/career-master-record.test.mjs`,
`tests/career-master-record-routes.test.mjs`, `tests/browser/career-master-record-proof.mjs`,
`tests/career-persona-wording.test.mjs`, `tests/career-catalog-route-bindings.test.mjs`.

<!-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Document 1.60.5 preparation, Open application and explicit recovery. -->

Saved-job preparation in 1.60.6 is OFF by default. Settings offers per-application
review or automatic preparation to Ready to submit; both use the person's own
records and stop before sending. Failures stay in Getting ready with a reason.
See [the user guide](docs/user-guide.md#choose-saved-job-preparation) for the working
controls and [deployment](docs/deployment.md#saved-job-preparation-1606) for the
owner writer, background batch and authorization bindings.

<!-- CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Document 1.60.6 saved preparation and its ready-only automatic boundary. -->


Career 1.60.7 serves existing private match rows. Nightly matching scores only
previously unmatched jobs, including entries missed by a failed night; existing AI
fits are retained. Explicit fit checks still refresh selected evidence. Saved now
offers **Remove**: it hides the row immediately and retains a relationship tombstone
so the next nightly pass cannot bring that posting identity back. A refused command
restores the row for an explicit retry. Preparation records remain available.
Owner-only pipeline ordering indexes migrate on a writable owner open or nightly
pass; read-only older generations retain their existing query plans.

<!-- CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Document 1.60.7 incremental matching, durable removal and writable index migrations. -->

## Concierge résumé check (1.60.8)

Career uses the shared `/shared/ui/js/editor-assistant.js` panel used beside AI Office's
Word document. The native shell and cockpit yield their old rail and application strip
while Career owns the frame. The document's own Concierge remains the editor on My résumé.

`career_resume_read` now returns presence, revision, populated section headings and the
My résumé destination from the original caller's `career_db.json`, without an engine
launch or résumé text. `career_resume_section` still returns requested text. The ordinary
`GET /resume/doc?id=master` editor read is unchanged; the tool uses `&view=status`.
Automatic facts preserve a saved profile even before a corpus or owner SQLite exists.
AI Office's separately saved document does not automatically replace the Career master.

Synthetic replay counts: one tool call and two scripted model completions before/after;
status removes one engine launch and the full-content observation. No live model timing
or installed identity acceptance is claimed. See the Test Lab concierge cases.

<!-- CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Document 1.60.8 owner status, read semantics and shared panel. -->

## Concierge module served (1.60.9)

The shared concierge that 1.60.8 introduced is a module script (`career-concierge.mjs`). Career's `/static` route now serves `.mjs` files as it serves `.js`, so the concierge opens on a deployed kernel; in 1.60.8 the route refused it and the concierge did not load. Every module script a shipped page imports from `/static` is checked by `tests/career-native-surface-contract.test.mjs`.

<!-- CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | Document the 1.60.9 module-script fix. -->

## One concierge, one résumé (1.62.0)

**One concierge.** `career-concierge` is the one assistant a person meets in Career: the pane on every page
(`tools/career-concierge.mjs` names it and no other bot), Jarvis's hand-off (the kernel's default is `chatBot`) and the
Intelligent Career group. A page with no document of its own hands the pane the person's Career record (`recordId`
`master`, the record My résumé and Work history hand over) with the page's surface, name, open job and the tools that
page's work uses, so the kernel keeps one conversation (`doc:career-hunter:master`) for every page.

It carries a tool for everything a person does in Career: 59 in all (the kernel offers at most 64 route tools). Each
route tool is bound in `authorization.yaml` to exactly its route's permission. The kernel shows a turn the twelve tools
whose descriptions fit the message best and reads `description` and `inputSchema` only, so each description says what
its tool is for; the first eight display names are what Jarvis's catalog lists for Career.

`career-hunter` is the engine's worker: it ranks and classifies jobs and drafts an application's documents inside
Career's runs and tickets. Its persona `perspective` is not edited, not even for wording: the kernel hashes that text
into the scoring model identity, and a change makes every saved fit score read as another configuration's
(`tests/career-concierge-tools.test.mjs` holds its digest). The manifest's `role` says what each bot is, and since 1.62.1
`career-hunter` and `career-submission-browser` carry `conversation: false`: a kernel with `210edbc7` leaves a marked bot
out of Jarvis's catalog and the bot list and answers a person's message to it with `career-concierge`, while the
package's own turns still run on it. An earlier kernel ignores the key.

**The live walk.** `tests/career-one-concierge-live-proof.mjs` waits for each whole concierge turn on its loopback base
(no `Prefer: respond-async`): a turn answered pending is saved without its tool trace, and the walk grades by that trace.
Two cards from one reading are two calls, the second written after the first's answer: the kernel runs the first tool
call of a model reply, so the persona says so.
`career_resume_patch`'s description and its `value` field say a month is written `YYYY-MM`: the kernel shows a turn a
tool's description and input schema, never its `usageInstructions`.

**One résumé.** The main résumé (`career_db.json`) is the source of truth. The Word document on My résumé is a view of
it: its first page's id names the main résumé revision it was made from, and `CareerResumeOffice.settle()`
(`tools/career-resume-office.js`) is the one way every page brings the two together. A document that is only behind is
rewritten; typed text is saved into the main résumé, merged field by field and bullet by bullet with what changed there;
a document Career cannot place is left for the person; a document near AI Office's 100-revision limit is replaced.
`GET /resume/doc?id=master&earlier=<revision|recent>` answers the document as it read earlier (the engine's
`resume base-earlier`, from the backups Undo reads) under the existing read binding.

**Approve.** `master_edit.apply_edits` no longer refuses a card whose revision moved. `card_rebase` applies it to the
version it read to learn which job and item each change names, finds each in the main résumé as it is now (the job by
title and employer, a bullet by its whole text, a removed job whole, a moved job or bullet in the order read) and
applies it all or nothing with a note; otherwise the refusal names the change and the job (409).

**Confirmed applications, age truth and long bullets (1.67.0).** Every job and application read (`GET /jobs`, `GET /jobs/:id`,
`GET /applications`, `GET /submission-queue`, `career_database`) carries `companySentCount` — the owner's distinct applications
recorded as sent for that normalized company, including applications later archived after sending and excluding unapplied drafts or
removed jobs — rendered as `✓ N sent` beside the employer name on **My jobs**, the posting sheet and **Prepare application** when
`N >= 1`. Responses also carry `asOfDate` (`YYYY-MM-DD`) and per-application `daysSinceSent`, `daysSinceApplied`, `ageDays` and
`olderThan30Days` so the concierge never estimates calendar age across months. Main-résumé and guided-edit bullet limits allow up to
`4,096` characters per bullet (and inline bullet-glyph splitting on pasted single-line drafts), and **My résumé** displays an active
document banner distinguishing **Main résumé** (`Synced with Work history · revision …`) from a **Tailored résumé** (`Back to main résumé`).

**Manifest readiness budget (1.67.1).** Historical manifest release notes and architectural commentary live verbatim in
[`CHANGELOG.md`](CHANGELOG.md) so `oshal-app.yaml` stays well within the `128 KiB` (`131,072`-byte) `package-smoke` readiness ceiling,
guarded by `tests/career-package-smoke.test.mjs`.

**My résumé on a phone (1.67.2).** On a phone the résumé starts in the top quarter of the screen under one document bar, as
Google Docs and Word give a document: the résumé's name (the picker) with its save state under it, **Edit** while it is open to
read (**Undo** and **Redo** once editing), **Save**, then **More**. The section tabs are one row that scrolls sideways. AI Office
opens with `?header=host` (AI Office 2.20.6) and draws no app row of its own there: the bar presses that row's buttons, and **More**
holds its **Export**, its document menu (version history, rename and the rest) and **Your AI Office documents**, with the banner's
words for the main résumé at the top. Once the person scrolls into the résumé, Career's bar and the tabs slide away; scrolling up
brings them back. A tailored résumé keeps its banner, and a computer or tablet keeps the page as before. Guarded by
`tests/browser/career-resume-header-phone.test.cjs` (run in the gate through `tests/career-resume-header-phone.test.mjs`); on an
installed Career, `tests/career-resume-header-live-proof.mjs check` measures the same bar read-only as a test person on the test slot.

**Every résumé carries the current role (1.67.3).** A résumé Career generates or tailors carries each role the main résumé
records as current (no end date, or an end of Present or current) and every role that ended within the last 20 years, most recent
first, with the title and employer Work history records; older roles stay the model's choice (condensed or left out). The model
gets a **ROLES TO CARRY** list in its prompt, and `engine/jobhunter/role_plan.py` checks its answer: a role it left out comes back
from its recorded title, employer, dates and bullets (none naming the embargoed open-source work unless that is opted in), a
current role's dates run to Present, and `application.json` records what the check did as `roles_carried`. A résumé prepared
before this check that leaves a required role out is not ready: **Prepare application** opens on step 1 · Tailor with a notice
naming the role and **Generate résumé & cover letter**, and review and sending wait until it is generated again
(`lib/career-resume-roles.js`, the engine's rules, in `lib/career-application-draft.js`). A submitted application keeps its
documents as the record. Guarded by `tests/career-resume-roles.test.mjs` and `tests/career-resume-current-role-route.test.mjs`.

**Where each job is, and near me, on My jobs (1.67.4).** A saved job is a reference to its posting, so My jobs reads where it
is from the posting every time it draws the list: the place the posting names (or **Location unknown**), **Fully remote**,
**Hybrid** or **On-site** when the posting's own title or place says so (fully remote is the board's existing rule), and the miles
from home ("24.9 mi from home"), straight-line from the city point Find jobs maps to the person's home. Home is their saved
**Matching area** (Settings, What I'm looking for), the place Career's "near home" job search already uses; a fully remote job
has no trip to measure. **Within** (Any distance, 10, 25, 50 or 100 miles, Remote only) and the sort **Distance from home** are
answered by the server over every page, on the stages of My jobs. With no home one line under the search row says so with
**Set your home**, which opens Settings on Matching area (`?section=matching`, since Today passes a page its query, never its
hash), and the choices that need a home are off. For any other view of the same jobs, `GET /jobs` answers per job `location`
(text or null), `workplaceType` (`remote`, `hybrid`, `onsite` or null), `lat` and `lon` (or null) and `distanceMiles` (one decimal,
or null with no home, no point or a fully remote job), and `home` (`known`, `label`, `radiusMiles`, `line`, `settingsUrl`);
`within=<1-250>`, `within=remote` and `sort=distance` filter and order, and a distance with no home answers 400
`home_location_required` rather than widening. `GET /jobs/:id` carries the same fields. A posting that names no place gets no
point and no distance; nothing guesses one. A corpus published before the place columns still lists jobs, without them, and
refuses a distance (`places_unavailable`). There is no write backfill, because there is no stored copy to fill:
`python3 -I career-hunter/scripts/saved-job-places.py <career data root>` counts, read-only, what every person's saved jobs will
show (counts only, `would_write` 0). Guarded by `tests/career-saved-job-place.test.mjs` (compiled routes over real SQLite) and
`tests/career-saved-job-place-browser.test.mjs`; on an installed Career, `tests/career-saved-job-place-live-proof.mjs check`
compares My jobs with Find jobs as a test person on the test slot.

**Bulk select on My jobs (1.68.0).** Saved, Getting ready, Removed and the four Applications stages have a **Table** beside the
**List**; the choice is remembered per person in their own browser. One row per job: Company, Title, Location ("Remote", "Location
unknown", or the place with its miles from home when Career knows home), Match, Stage, Saved and Résumé. Every column sorts, and
the table's own filters are distance (within 10, 25, 50 or 100 miles, or Remote), résumé (prepared or not) and, on Saved, stage.
Each row has a checkbox; the header box chooses every job the filters show (Shift chooses a range) and the bar counts them. The bar
holds the stage's bulk actions: on Saved **Prepare applications**, **Remove** and **Move to** Getting ready; on Getting ready **Send
from my computer** (only while a computer is connected), **Prepare applications** and **Remove**; on Removed **Put back in Saved**
and **Prepare applications**; on Applied, Interviewing, Offer and Closed **Move to** the others. Prepare asks first (1.68.1, below),
then runs each job's own writes (its tailoring with the chosen Other experience, `POST /jobs/:id/status` promoted, then
`POST /jobs/:id/generate` with that choice), at most two at a time; the
native kernel lets one run hold a person's Career files, so in practice they run one after another, and a write refused while
Career works on the account waits and is tried again. Progress shows on each row and overall (queued, preparing, prepared, failed
with the reason in words); what is queued can be cancelled, three failures in a row with one reason pause the rest until **Resume**,
and **Prepare the failed ones again** queues them anew. The queue is kept in the person's browser storage, so it survives a reload,
and it runs while My jobs is open. **Send from my computer** reads each job's exact packet, then asks once with the count and the
companies and sends nothing until the person ticks the approval; each send is one job's own approve, bind and start
(`CareerSubmit.approveAndStart`). At phone width the table is a selectable list with the same bar. Guarded by
`tests/career-bulk-queue.test.mjs` and `tests/career-jobs-table-browser.test.mjs`; on an installed Career,
`tests/career-bulk-select-live-proof.mjs check` drives it as a test person on the test slot.

**Other experience is asked before any résumé is generated (1.68.1).** Prepare application never generates a résumé before
the person has had the chance to choose the Other experience for that application. Step 1 · Tailor shows the **Other experience ·
optional** boxes, ticked with the job's own choice, else with the choice the person prepared their last application with ("Ticked
as in the last application you prepared."), and **Generate résumé & cover letter** sends exactly the boxes ticked at that moment.
A job whose documents were made without a choice (1.68.0's bulk Prepare, saved-job preparation, an older packet) opens on step 1
with a notice, and **Review generated documents** still opens them as they are. **Prepare applications** in the Table asks once
before anything is queued: the same boxes under "Include in every selected application", the count ("Prepare 4 applications")
and the jobs left out; **Cancel** queues nothing. Each queued job's tailoring gets the choice before it is moved and prepared, so
its preparation uses it whichever way it starts; a preparation queued before 1.68.1 has no choice and is cancelled with words.
With **Prepare saved jobs for me** on, a job is prepared with its own choice, else the last one; a person who has other
experience and never chose is asked first (the job waits, and Settings says how many). The choice is kept per job
(`experienceChosen` on its tailoring) and per person (`experience-choice.json`, answered as `last` by `GET /experience-bank`).
Ticking the open-source entry (`saved-portfolio`) is the one switch that includes that work, as 1.67.3's role check reads it.
Guarded by `tests/career-prepare-other-experience-browser.test.mjs` (1440x900 and 412x915) and
`tests/career-prepare-other-experience-route.test.mjs` (with `career-prepare-other-experience-contract.py`); on an installed
Career, `tests/career-prepare-other-experience-live-proof.mjs check` drives it as a test person on the test slot.

**Expanded experience on Work history (1.68.4).** A person's client engagements and client accounts were always in their
main résumé (`career_db.json`: `project_ledger`, each `{project, role, industry, duration_months, tech, public}`, and
`named_accounts`, `{group: [names]}`), and no screen but Download my data's Evidence lines read them. Work history now shows
them: the line under its heading counts jobs, client engagements and client accounts, each a link; an engagement placed under a
job shows on that job's card under **Client engagements (N)**; the rest are under **Expanded experience**, **Not placed under a
job yet**, with **Place all under** [job] **Place them**; each shows its name, role, industry, months or length, technology,
bullets and **Marked not public**, and **Edit** opens it as a form (client or project, role, industry, start and end month and
year, length in months, technology, **Done under**, marked not public, bullets) with **Move up**, **Move down** and **Remove this
engagement**; **Add an engagement**; client accounts show by group, **Edit** takes one name per line, **Add a group**; the link
to a detailed work addendum the profile keeps outside Career is there too. The data stays in the same keys (no migration): an
entry gains `start`, `end` (`YYYY` or `YYYY-MM`), `bullets` and `job` (the `id` of the `roles[]` entry it was done under) only
when the person writes them, and a key the page does not know is kept as saved. `GET /resume/doc?id=master` answers `expanded`
(`engagements`, `accounts`, `addendum`; every entry whole at any count) beside the document, and `POST /resume/master-edit`
takes `engagement`, `engagement-bullet` and `accounts` edits (add, set, move, remove; named by place and exact current name),
all or nothing with the patch, backed up, audited and undoable. Such a patch is refused when the main résumé moved after the
page read it (409, the page reads it again), and refused in words when it would grow the main résumé past the 128 KiB job
scoring reads. Download my data's engagement line carries the months, the job and every bullet. No route, permission or
migration changed; staticFiles adds `career-work-history-engagements.js`. Guarded by `tests/career-engagements-engine.test.mjs`
and `tests/career-engagements-page.test.mjs` (1440, 412, 360); on an installed Career, `tests/career-engagements-live-proof.mjs
check` reads it as a test person with 20 made-up engagements on the test slot.

**Years by skill on Work history (1.68.24).** Résumés and cover letters state a person's own years where the person gave
them (`years_by_skill`, a list of `{skill, years}`, and `career_years`, in the main résumé; read by
`engine/jobhunter/years_truth.py` since 1.68.22). Work history's **Years by skill** section, under the jobs, is where a person
gives them. Each skill has **From your roles** (the years counted from the roles' dates), **Your figure** (empty is none) and
**Used on résumés**; **Add a skill** adds one the roles do not name; **Years of experience in total** has the same three;
**Save years** saves the whole form and **Undo** puts the earlier version back. **Used on résumés** comes from the table
generation reads: your figure exactly (`11 years`); for a skill counted from your roles, the most a résumé may state
(`Up to 3 years`), or `No year count (under 2 years)`; for the total with no figure of yours, the least a résumé may state and
the one rounded phrasing left standing (`At least 23 years, or "over 20 years"`). The years counted from your roles are the
main résumé's own; an application that also carries Other experience you ticked may count more. `GET
/resume/master-section?field=years` answers the rows with the main résumé's revision, and the save is an edit of field `years`
of `POST /resume/master-edit`: at most 40 skills, a name of 1 to 60 characters named once, years from 0.5 to 60 in steps of 0.5,
a total from 1 to 70 in steps of 0.5 or empty; one bad row refuses the whole save in words that name the row; exactly those two
keys are written, backed up, audited and undoable (`POST /resume/master-undo`); a main résumé that moved after the form read it
is refused (409) and read again. No route, permission or migration changed; staticFiles adds `career-years-by-skill.js`.
Guarded by `tests/career-years-edit.test.mjs` and `tests/career-years-by-skill-page.test.mjs` (1440, 412); on an installed
Career, `tests/career-years-by-skill-live-proof.mjs check` drives it as a test person on the test slot.

**Letters and résumés say only what your records support (1.68.5).** Until 1.68.5 the rules that kept letters honest were
instructions to the model: the person-specific ones moved in July 2026 into an optional `prompt_framing` block, the cover editor
was told to "surface ... depth even when it lives in an EARLIER role", and nothing after the model call checked a claim, so a
local model could mirror a tool from the posting and reach back to a first job. Now `engine/jobhunter/letter_evidence.py` ranks
every recorded role, client engagement (the main résumé's `project_ledger`, dated by its own months, else by the job it was
done under or the job whose record names the client) and selected Other experience entry by how much of the posting it speaks
to and how recent it is, and the generation prompt and the cover editor both get the top five as **COVER LETTER EVIDENCE**;
work the person marked not public is never offered. After the model answers, `engine/jobhunter/claims_check.py` reads every letter sentence about the
candidate and every résumé claim the same way whichever model wrote them (and every letter sentence about the job for tools): a
tool the records never name, a level they do not state
(expert, advanced, deep, strong ...), a years count the recorded dates do not add up to, a title or employer they do not hold, a
tool put under the wrong job, and a letter sentence drawn from older work outside the evidence (a first job, or a tool only a first
job records). `engine/jobhunter/claims_fix.py` tones a level or a years count down to what the records say, puts a résumé job's
title back, and takes out the rest; a letter that lost a sentence is written again once with the problems named, and one still too
thin to send is marked **needs your review**. `application.json` records what the check did as `claims_check`. On **Prepare
application**, step 2 · Review documents lists what Career took out; a letter that needs review shows its problems with **Edit
documents** and **I checked the cover letter** in place of **Continue to send**, automatic preparation never marks it ready, and
a connected computer will not send it until the person edits it or confirms that exact letter (`lib/career-letter-claims.js`,
`lib/career-application-draft.js`). Guarded by `tests/career-letter-truth.test.mjs`, `tests/career-letter-truth-route.test.mjs`
and `tests/career-letter-truth-page.test.mjs`; on an installed Career, `tests/career-letter-truth-live-proof.mjs check` prepares
one job as a test person with a made-up long-form résumé on the test slot.

**A job's description on My jobs (1.68.6).** The posting sheet (a job's title on any stage of My jobs, or New matches) shows
the description Career holds for the job: the list's own text, the copy Career read from the employer's posting (it says **Read
from the employer's posting.**) or the one the person pasted. Workday lists carry no description, and the pull's description stage
leaves Workday, Oracle Recruiting Cloud and SmartRecruiters jobs to each person's own reads, so the shared corpus held none for
those jobs (none of Torch Technologies' 889 postings on 2026-11-16). When the job has none, the sheet says **Reading the job
description from** the employer while `POST /jobs/:id/details` reads it once through the kernel's egress, at the one structured
address the engine's readers use (a Workday posting's cxs detail, an Oracle requisition's ById details, a SmartRecruiters posting;
`lib/career-employer-detail.js` admits it), from the same fields, with its paragraph and list breaks kept as the pull keeps a
description. The text is kept as the person's own copy in the engine's format (`job-context/<id>.json`, basis employer-detail, bound
to the listing), so the sheet, the Concierge and Jarvis (`GET /jobs/:id`), preparation and scoring use it without another read; a job
the nightly pass marked **Details needed** loses the mark. While Career is preparing the person's applications a write waits, so the
sheet asks `GET /jobs/:id?details=read`, which reads for that view and keeps nothing. A job Career cannot read says so plainly, never
"No description was provided.": **Career could not read this job's description from** the employer and why (the posting is no
longer there, the site refused or did not answer, or the posting has no description), or **Career has no description for this job**
when its site is not one Career can read, with **Open the posting** and **Paste it in Prepare application**, which opens step 1 ·
Tailor and its paste box. For the jobs already in the corpus, `python3 -I career-hunter/scripts/backfill-job-descriptions.py`
re-reads one employer's open postings that have no description, once, into the shared corpus for every person: `dry-run <career
data root> --company <id>` reads and prints counts only; `plan`, `prepare` and `publish` keep exactly the descriptions that read, in
an edited copy proven to differ only there, under the pull's lock, with the old corpus kept as `corpus.before.db`. A refused, closed
or empty read leaves the posting as it was, and a second run fills nothing it filled. Guarded by `tests/career-job-details.test.mjs`
(compiled routes over real SQLite, the saved real Torch Technologies, Oracle and SmartRecruiters answers, and the engine holding the
reader, the backfill and every kept copy to its own reading), `tests/career-job-details-sheet-browser.test.mjs` and
`tests/career-job-descriptions-backfill.test.mjs`; on an installed Career, `tests/career-job-details-live-proof.mjs check` reads
and shows a Torch Technologies posting as a test person on the test slot.

**A tailored résumé's chat is Career's concierge (1.68.9).** Roger, 2026-11-16, "for the last time": every chat surface is the
core Jarvis chat window, with its model menu (a model for one request), New conversation, Recent conversations, Files, Tap to talk,
Keep trying, its formatting and its steps. My résumé drew a chat of its own for a job's tailored résumé, and for the main résumé
where AI Office's Word editor is not available: the résumé editor, a transcript, a text box and Send whose turns went to
`POST /resume/guide`, while Career's Concierge was hidden there. The page draws none now. On a computer **Concierge** in Career's
bar opens the concierge docked beside the résumé; on a phone **Edit with AI** opens it between Career's bars (the bar does not
offer it a second time), and where Career's frame is off, Edit with AI mounts it first. The page declares the résumé it has open
(`<html data-career-record>`: `master` or the posting id), so the window opens that résumé's own conversation
(`doc:career-hunter:<posting id>`) and its help line speaks of the job's résumé and cover letter. The registered document handoff
is unchanged: an edit not yet saved is saved before each turn, and the résumé is read again after the turn and after an approved
card. A tailored résumé's context names `career_documents` and `career_resume_save`, the concierge's own tools that read a job's
saved résumé and cover letter and change them on a card (saved, its PDF made again); after the save before a turn, Save follows
what is still unsaved. No route, tool, permission or binding changed: `POST /resume/guide` stays served, and nothing on the page
calls it. Needs a kernel whose shared assistant is the one chat window (`/shared/ui/js/jarvis-chat-frame.js`, `00c62f98` or later).
Guarded by `tests/career-hunter-one-chat-window.test.mjs` (1440x900, 412x915 and Career's frame off, the window served from a
kernel platform export).

<!-- CHANGE LOG: 6 | maintainer@emeraldcoastsystemsgroup.com | Document 1.62.0: one concierge with every tool, the one-résumé rule and the card applied on the current revision. -->
<!-- CHANGE LOG: 7 | maintainer@emeraldcoastsystemsgroup.com | Document 1.62.1: the two workers' conversation: false, the live walk's whole-turn wait, one call per card and the month format. -->
<!-- CHANGE LOG: 8 | maintainer@emeraldcoastsystemsgroup.com | Document 1.62.2: a nightly match cycle begins at the installation's pull time (CAREER_INGEST_CRON), else 18:00. -->
<!-- CHANGE LOG: 9 | maintainer@emeraldcoastsystemsgroup.com | Document 1.62.3: on the native kernel the nightly AI selection leaves out a job no reader there can describe; a Workday redirect is tried again the next night. -->
<!-- CHANGE LOG: 10 | maintainer@emeraldcoastsystemsgroup.com | Document 1.63.0: the native rail also reads Oracle Recruiting Cloud requisitions and SmartRecruiters postings, so their jobs are scored. -->
<!-- CHANGE LOG: 11 | maintainer@emeraldcoastsystemsgroup.com | Document 1.64.0: the full pull keeps the descriptions most job lists leave out, so those jobs are scored with no request at scoring time. -->
<!-- CHANGE LOG: 12 | maintainer@emeraldcoastsystemsgroup.com | Document 1.65.0: settled nightly scoring, off unless the installation turns it on. -->
<!-- CHANGE LOG: 13 | maintainer@emeraldcoastsystemsgroup.com | Document 1.66.0: jobs Career cannot read reach New matches as Details needed, and a pasted description prepares them. -->
<!-- CHANGE LOG: 14 | maintainer@emeraldcoastsystemsgroup.com | Document 1.66.1: an unmarked job whose preparation stopped for missing details carries details_needed; the off Generate is drawn off. -->
<!-- CHANGE LOG: 15 | maintainer@emeraldcoastsystemsgroup.com | Document 1.67.0: per-company confirmed-sent counts and badge, deterministic application age fields, 4,096-character bullet preservation and Main vs Tailored résumé banner. -->
<!-- CHANGE LOG: 16 | maintainer@emeraldcoastsystemsgroup.com | Document 1.67.1: historical manifest release notes moved verbatim to CHANGELOG.md to keep oshal-app.yaml within the 128 KiB package-smoke ceiling. -->
<!-- CHANGE LOG: 17 | maintainer@emeraldcoastsystemsgroup.com | Document 1.67.2: My résumé on a phone, one document bar, one row of tabs, AI Office's row folded into the bar, and the bars slide away once the person scrolls into the résumé. -->
<!-- CHANGE LOG: 18 | maintainer@emeraldcoastsystemsgroup.com | Document 1.67.3: every generated résumé carries the current role and the roles of the last 20 years, most recent first; an earlier résumé that leaves one out is not ready until it is generated again. -->
<!-- CHANGE LOG: 19 | maintainer@emeraldcoastsystemsgroup.com | Document 1.67.4: My jobs says where each job is from its posting (place, workplace, point, miles from the saved Matching area), Within and Distance from home over every page, the no-home line, the GET /jobs place fields, and the read-only count in place of a backfill. -->
<!-- CHANGE LOG: 20 | maintainer@emeraldcoastsystemsgroup.com | Document 1.68.0: My jobs' Table view, bulk select and the bulk actions of each stage, the bulk preparation queue and the one confirmation before a bulk send. -->
<!-- CHANGE LOG: 21 | maintainer@emeraldcoastsystemsgroup.com | Document 1.68.1: Prepare application and bulk Prepare ask about Other experience before any résumé is generated (last choice ticked, exactly what is ticked is sent, one step before bulk Prepare queues, the choice on each queued job's tailoring), and saved-job preparation waits for a person who never chose. -->
<!-- CHANGE LOG: 22 | maintainer@emeraldcoastsystemsgroup.com | Document 1.68.4: Expanded experience on Work history (client engagements under their jobs, Place all under, client accounts by group), the `expanded` answer, the engagement edits and their guards. -->
<!-- CHANGE LOG: 23 | maintainer@emeraldcoastsystemsgroup.com | Document 1.68.5: letters and résumés say only what the records support; the letter draws on the work ranked most relevant and recent; a letter that still cannot is marked needs your review. -->
<!-- CHANGE LOG: 24 | maintainer@emeraldcoastsystemsgroup.com | Document 1.68.6: the My jobs posting sheet reads a job's missing description through the kernel's egress and keeps it as the person's copy, says plainly why it cannot, and the one-employer description backfill for the shared corpus. -->
<!-- CHANGE LOG: 25 | maintainer@emeraldcoastsystemsgroup.com | Document 1.68.7: My résumé draws no chat of its own; a tailored résumé's chat is Career's concierge, the kernel's one chat window (Concierge on a computer, Edit with AI on a phone), in that résumé's own conversation, with the tools that read and change it on its context. -->
<!-- CHANGE LOG: 26 | maintainer@emeraldcoastsystemsgroup.com | Document 1.68.24: Years by skill on Work history, where a person gives their own years per skill and in total; what Used on résumés shows; the `years` section read and the `years` edit of the main-résumé edit, and their guards. -->
