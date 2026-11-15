# Career Hunter — operations guide

## Native bare-metal installations

The native installation uses the daemon's shared-corpus scheduler and each
person's separately authorized matching and mailbox schedules. The legacy API
container cron described later in this guide does not operate these jobs.

The shared pull runs at the installation's configured cadence
(`OSHAL_CAREER_INGEST_CRON`, with `OSHAL_CAREER_INGEST_TIMEZONE`). It updates a
private corpus copy and publishes that copy atomically after success. A failed or
unfinished pull leaves the last published corpus available. Restarting the daemon
interrupts its running pull; check its actual state before a maintenance restart.

The nightly match counts one pass per pull cycle, and a cycle begins at the pull's time
of day. The kernel does not pass `OSHAL_CAREER_INGEST_CRON` into the package, so an
installation whose pull is not at 18:00 Central also sets the same plain daily cadence for
the package: `OSHAL_PACKAGE_ENV_CAREER_HUNTER__CAREER_INGEST_CRON="0 1 * * *"` in
`oshald.env`, then a daemon restart. Without it, cycles begin at 18:00, and a pull that
publishes before 18:00 waits for the next day's match.

In the nightly receipt (`nightly-match-success.json`), `skipped` counts slots of the 50 that
produced no score. On the native kernel the engine reads employer details only through the
Career rail (`lib/career-employer-detail.js`), and since 1.62.3 a job with no listing text, no
saved copy and no posting the rail can read is not selected at all. The rail reads exactly these,
each one GET with no credential, no redirect followed and at most 256 KiB:

| Source | Host (egress) | The one address admitted | Since |
|---|---|---|---|
| Workday | `*.myworkdayjobs.com` | `/wday/cxs/<tenant>/<site>/job/...` on the tenant's own host | 1.34.1 |
| Oracle Recruiting Cloud | `*.fa.oraclecloud.com`, `*.fa.us2.oraclecloud.com`, `*.fa.us6.oraclecloud.com`, `*.fa.ocs.oraclecloud.com` | `/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById;Id=%22<id>%22,siteNumber=<site>` | 1.63.0 |
| SmartRecruiters | `api.smartrecruiters.com` | `/v1/companies/<company>/postings/<digits>` | 1.63.0 |

An Oracle board on another host form (for example `*.fa.em2.oraclecloud.com`) is not admitted and
its jobs are left out like any other unreadable job; adding a host form means the guard, the
egress block, `oracle_orc.DETAIL_HOST` and `score._ORACLE_DETAIL_SUFFIXES` together, and their
test (`tests/career-employer-detail.test.mjs`). The Oracle and SmartRecruiters readers make one
read per job and never retry: a closed posting (Oracle answers an empty list, SmartRecruiters
`404`), a refusal or any other status marks nothing, and the job is tried again the next night.
A Workday job is skipped when Workday answers a redirect instead of the posting: during
Workday's maintenance every read is a `303` to `community.workday.com/maintenance-page`
(the kernel log shows `package_egress` with status 303). Such a job is tried again the next night.
Jobs of the other sources have no reader on the native kernel. Since 1.64.0 the pull keeps
their descriptions instead (next section), and a job with listing text is selected and scored
with no request at all.

### Jobs listed without a description (1.66.0)

A job of the person's nightly selection (their saved titles, area and remote choice, no score yet,
not removed) whose description cannot be had is marked "details needed" in that person's store:
`user_signals.ai_model = {"needsDetails":1,"at":...}`, `ai_fit_score` stays NULL, no model call.
On the native kernel the jobs the readable test above leaves out are marked after keyword matching
with no read at all, best title and keyword matches first, at most 200 a night
(`score.UNREAD_NIGHTLY_LIMIT`); a selected job whose one read is refused (`job_details_unavailable`)
is marked after that read. A close call and any scored job are never marked; a later score
replaces the mark. The engine's count line carries `needsDetails` (in the settled pass including
the jobs marked after a refused read); the receipts are unchanged. New matches lists and counts
marked jobs through the owner index `idx_user_needs_details` (`migrations/sqlite/002`, applied by
the engine's nightly matching and by writable owner opens, like `001`); an owner store without it
lists scored matches only. A person's pasted description is kept in their own
`job-context/<posting>.json` (basis `person-pasted`, 200 to 20,000 characters, mode 0600), never in
the corpus and never logged; `POST /jobs/:id/generate` refuses a marked job with no description and
nothing pasted with 409 `job_details_needed` before the engine starts. An unmarked job with no description
still starts the engine, which tries the employer page once; when that preparation stops with
`job_details_unavailable` (or `job_context_unavailable`, a saved copy that cannot be verified),
`GET /jobs/:id` carries `details_needed` with the same words as the 409 (since 1.66.1), which is what
the Concierge and Jarvis read after `career_draft`. To see how many a person has:
`SELECT COUNT(*) FROM user_signals WHERE ai_fit_score IS NULL AND ai_model GLOB '{"needsDetails":*'`
on their `user.db` (read-only).

### Descriptions the pull keeps (1.64.0)

Most job lists the pull reads give a title, a place and a link, not the description. The pull
runs with the network the kernel's ingest grants it (`crates/host-process/src/career_ingest.rs`:
the ingest namespace shares the host network; nothing about it changed), so once every list is
read it ends its job finding with a **description stage** (`engine/jobhunter/pull_details.py`):
it reads the job's own page, on the site the list came from, and keeps the description in the
corpus's listing text, the field scoring reads first. Scoring reaches nothing new: the rail's
table above and the package's `egress:` block are unchanged.

| Source kind | What the stage reads | Unreadable in-lane jobs on 2026-11-14 |
|---|---|---|
| Google | nothing: the results page the list already reads carries every job's description, which the reader now keeps | 166 |
| Eightfold | the posting page's JSON-LD `JobPosting` | 1,643 |
| Experis and other listed boards (`htmllist`) | JSON-LD | 1,286 |
| Radancy | JSON-LD | 736 |
| SuccessFactors | the schema.org microdata in the page (`itemprop=description` under its `itemprop=title`) | 362 |
| iCIMS | JSON-LD | 167 |
| Avature | JSON-LD, else the details article | 58 of 79 |
| Webflow | the rich-text body | 20 |
| Employers' own sites (`web`) | JSON-LD, microdata or the Avature details article, by plain HTTP | about 1,120 of 2,055 |

What it does not read: jobs whose site refuses a plain read with a browser check (Jacobs, CBRE,
Delta: `202`; Regeneron, SAIC, Verizon: `403`; 935 jobs on 2026-11-14), which would need one
browser launch per job; a page on another host than the list's (ManTech's 21 Avature jobs link
`careers.mantech.com`); Goldman Sachs (`gsroles`, 12) and Brassring (4); jobs outside the shared
lane (`target_role`); and jobs first seen more than seven days ago.

The bound. Only a full pull (`scrape --all`); only active in-lane jobs with no listing text,
first seen in the last seven days; a job read twice is never read again. Sources take turns one
page at a time within the newest day any of them still has, then the next day's, so the night's
budget reaches every source's newest jobs before older ones, and one site's one-second politeness
pause overlaps another's read. No page is read in parallel with another, and no host gets more
pages a pull than the per-source cap, however many sources share it. Each read is one GET on
public addresses only (`http.page_once`: never retried, no redirect followed, 2 MB at most,
15 s), and a text is kept only when the page names the job (its JSON-LD identifier or title, or
the page title for a layout read), whole up to 64,000 characters, markup stripped. A refused,
empty or failed read leaves the job as it is; the stage never fails the pull and never shortens
the lists, which are all read before it starts. Reads are recorded with their text every 25
pages, so a pull stopped in the stage continues without reading a page it kept. When no source
has a page left to read, the stage ends at once, however much of its budget is left.

Defaults and settings (1.64.1, owner 2026-11-14: "Yes let's increase the pull"). 600 pages a
source (and a host), 6,000 a pull, 80 minutes a pull (read time, counted across a stopped and
continued pull; one read in flight may finish past it); one source stops after 600 s of its own
reads or three refusals in a row. A run that has gone seven hours reads no more pages, which
leaves the kernel's eight-hour ceiling room to publish. An administrator changes them, or turns
the stage off, without a release: a source change on the Companies page's Resolve route, for any
listed employer, whose link is one of

    setting:descriptions=off                   (or on)
    setting:descriptions_per_source=600        (0-1000)
    setting:descriptions_per_pull=6000         (0-20000)
    setting:descriptions_minutes=80            (0-180)
    setting:descriptions_source_seconds=600    (0-3600)

The pull applies it before its lists, so the same night follows it, and keeps it in the corpus
(`pull_settings`) for every later pull. The Companies page shows the change's outcome:
`setting_saved`, or `bad_setting` for a name or value outside those (nothing changes).

What to look for after a pull: the summary line ends `Descriptions kept: N of M job pages read.`
(both counts cover the whole pull); the corpus holds one row per read in `source_detail_reads`
(`outcome` is `saved`, `not_named`, `refused`, `unreadable`, or `skipped` for a link on another
host). Estimated from the 2026-11-14 counts (aggregates only; latencies from one read per host
and the one-second pause), of the 5,551 reachable among the 6,530 unreadable jobs: the first
night reads about 6,000 pages in 74-80 minutes and describes 63-74 percent, the second 73-95
percent, the third about 98 percent (the range is how many new jobs arrive, 1,100 to 2,200 a
night). The largest single sources (Lockheed Martin on Eightfold, Experis) take their 600 pages a
night, so they clear on the third. Once the backlog is gone a night reads only its own new jobs
and the stage ends by itself: about 1,100 to 2,200 pages in 21 to 38 minutes (about 1,400 pages
in 25 minutes). No host gets more than 600 of the stage's pages in a night.

### Settled nightly scoring (since 1.65.0, off unless the installation turns it on)

Off, the nightly pass is exactly 1.63.0's: at most 50 jobs, newest first, one model call each, on the
package's own batch order (guard: `tests/fixtures/nightly-off-switch-1.63.0.json`, recorded from
1.63.0). On, each job is asked three times on byte-identical input and **settled**: all three runs have a
valid score, share one side of 70 and their median lies outside the band (64 to 75 at the default 6
points); the saved score is the median and its attribution lists the three runs (`settled.runs`).
Anything else with at least two valid runs is a **close call**: the runs disagree, the median is inside
the band, or one run gave no valid score (a failed run counts as no side). **Fewer than two valid runs:**
nothing is saved, the job reads **Not scored yet** and stays pending for the next night (`failed` in the
receipt). A run is failed when Career's call and its one retry both gave no valid score. An answer with no
text is one of those: the kernel refuses it as unavailable (`crates/inference/src/generic.rs`, "returned an
empty completion"; `package_bot_turn.rs`, "inference returned an empty answer"), the rail answers its usual
`503 career-worker-unavailable` with `detail: "empty-answer"`, and the settled pass counts that try as
unanswered and goes on; any other rail failure still ends the run as before. Switched off, an empty
answer still ends the pass, exactly as in 1.63.0. Measured on 50 made-up postings, see
[the measurement](settled-scoring-measurement.md).

**How a call's model is chosen, and why close calls are not sent to a stronger model yet.** Every call
the engine makes goes through the Career rail to the kernel's `bot_turn`, which takes no model, provider
or kind of work (`crates/oshald/src/package_bot_turn.rs` `input`). The kernel picks the order by the kind
of work: every call of a run a schedule keeps alive is background work
(`crates/oshald/src/package_runs.rs`: `Run.background`, and `inference::work::scoped(run.background, …)`
in `RunContinuation::serve`), so it reads `inference.order.background` (Career's own record, else the
installation's). A package cannot send one of those calls to another order. A close call is therefore
left **undecided**: no score is saved (so no screen can put it on a shortlist), the job's `ai_model`
keeps `{"undecided":<nights>,"runs":[…],"why":…,"at":…}`, it is asked again the next night once, and
after two nights it is left to the person's **Check my fit**, which runs as the person's own request and
reads the application-assistant order (`inference.order.concierges`).

**What the kernel would have to offer** for the close calls to go to a stronger model: a second order
for one of the package's own bots in background work. Concretely, the background order looked up by
package **and bot** (`crates/oshald/src/turn_background.rs` `order(base, settings, package)`, called
from `host_services.rs` `configured_bot_inference`, which today resolves before the bot is known; the bot
is resolved in `package_bot_turn.rs` `execute`, line 273), a settings holder for it in
`crates/api/src/model_orders.rs`, and the Career identity read accepting that second bot
(`host_services.rs` `career.model_identity` accepts no selectors; `package_bot_turn.rs` `CAREER_BOT` and
`is_career_bot`). Career would then declare a second node bot with the same persona and send close calls
to it.

**The settings** (per-package, `OSHAL_PACKAGE_ENV_CAREER_HUNTER__<NAME>` in `oshald.env`, then a
daemon restart; a duplicate key refuses the start):

| Setting | Default | Bounds | What it does |
|---|---|---|---|
| `CAREER_NIGHTLY_SETTLE` | unset (off) | `1` = on; anything else is off | The switch. Off is 1.63.0's pass and receipt. |
| `CAREER_NIGHTLY_LIMIT` | 400 | 1 to 2000 | Jobs a night (all runs of the night together). 400 is about 85 percent of what the measured 7.61 s a job at three at once fits in an hour (about 470). |
| `CAREER_NIGHTLY_CONCURRENCY` | 3 | 1 to 3 | Calls at once. The local model serves about three at a time and is shared with training. |
| `CAREER_NIGHTLY_BAND` | 6 | 0 to 15 | Points on either side of 70 that make a median a close call. |
| `CAREER_NIGHTLY_BUDGET_MINUTES` | 60 | 5 to 240 | The night's time, over all its runs. |

The rail's own limit also applies: `CAREER_WORKER_RAIL_CONCURRENCY` (default 2) admits at most that many
completions at once, so three at once needs it set to 3; at 2 the night runs at two thirds of the speed.

**The night is several kept runs.** The kernel keeps a run alive at most 1800 s (`package_runs.rs`
`MAX_SECONDS`) and publishes the owner's writes only when the run ends well, so one run takes at most 20
minutes (`NIGHTLY_RUN_SECONDS`): no job starts after that, a started job may finish its runs for 180 s
more and then stops between runs, and the run ends on its own with what it scored. The receipt then says
`continues: true`, and the next half-hourly check of the same pull cycle starts the next run with what is
left of the night's limit and time (it stops continuing with under two minutes left). The route keeps its
30-minute timeout, which is the kernel's 1800 s. At the defaults a night is three runs on three consecutive
half-hourly checks after the publication, about 470 jobs at three at once (about 315 at the rail's
default two).

**The order.** Within the pending, readable, in-lane jobs: how many of the person's saved titles the job's
title contains, then Career's keyword match (`fit_score`, from `match.rescore_new` earlier in the same
run), then the newest. No model call decides the order.

**The receipt** (`nightly-match-success.json`, `version: 2`, `mode: "settled"`): `scored`, `undecided`
(close calls), `unreadable` (employer details could not be read), `failed` (no run gave a valid score;
the job stays pending), `notReached` (pending candidates this run did not reach), `calls`, `runs`,
`usedSeconds` of `budgetSeconds`, `limit` and `continues`; totals are the night's, `notReached` is the
last run's. The engine's last line carries the same counts with `"mode":"settled"`. Career Settings →
Nightly résumé matches shows them in words; in My jobs a job not reached reads **Not scored yet** and an
undecided one **Close call, not settled yet**.

**To switch it on** (outside the nightly window): the batch order Career's calls read must be the local
model (Career's own `inference.order.background`, else the installation's). A call the kernel's local
connection cap (`inference.background.local_connections`, 3, shared by all background work) holds past
`inference.background.local_wait` goes to the order's next rail; with none it is refused, and a refused
call ends the engine's run (`enrich._rail_trip`), whose writes are then not published. So the order
either lists a fallback (each such call then costs it and is attributed `fallback: true`) or accepts that
a crowded run ends with nothing kept and the next half-hourly check starts it again. Then set
`CAREER_NIGHTLY_SETTLE=1` and `CAREER_WORKER_RAIL_CONCURRENCY=3` for the package and restart. It takes
effect at the next publication: a receipt already written for the current corpus is a finished night.
**To switch it off:** remove `CAREER_NIGHTLY_SETTLE` and restart; a settled receipt is then read as a
finished night, and the next publication runs 1.63.0's pass.

Career Settings and Jarvis's `career_refresh_status` read
`GET /api/career-hunter/run/refresh`. On a kernel with the safe observation port,
this requires normal Career read access and returns the following facts without
scanning posting descriptions or exposing the operator's jobs API:

| Field | Meaning |
| --- | --- |
| `status` | `running`, `idle`, `failed`, `disabled` or `unavailable` for this scheduler |
| `running` | Actual current scheduler state; `null` means unknown |
| `lastStartedAt` / `lastFinishedAt` | Current-process run observations, with durable terminal history used after restart where available |
| `lastPublishedAt` / `lastCompletedAt` | Most recent successful publication and its finished receipt, possibly from an earlier run |
| `lastPublication.counts` | Recorded new, refreshed and closed counts for that publication; missing evidence stays `null` |
| `lastPublication.sources` | Confirmed and unconfirmed sources for that publication; successful publication does not mean every source succeeded |
| `nextRunAt` | Next configured scheduler instant, when available |

Compare the current start with the successful completion before describing a
pull as finished. Prior publication counts are not partial progress for a running
pull. Native `corpusFreshAt` remains `null`: publication time is not the maximum
row last-seen timestamp. On an older kernel, observations stay unavailable; the
operator-only jobs view may still supply its own timer. Native manual shared
refresh is installation-managed and the application does not start another pull.

Matching and application-email monitoring are original-owner jobs. Their
enabled state, cadence and last HTTP outcome are visible in Career Settings;
the operator jobs screen has broader installation observations. A source update
can require these existing jobs to be reviewed again. Re-enable only their
unchanged authorized scope and cadence. Matching is separate from corpus
publication and does not establish that the current shared pull finished.

Personal score runs acknowledge a retained background task and publish bounded
count receipts after success. Native Stop remains pending until the process has
ended and its unpublished files and authority have retired. See
[Native engine run control](../NATIVE-RUN-CONTROL.md). Stopping a score run does
not stop the shared ingest or withdraw an application.

With the matching native model-identity port, scoring reads the dedicated Career
bot's configured primary, eligible ordered fallbacks and effective persona before
comparing cached fits. A matching policy and unchanged evidence use no model
completion. A guarded completion must still match that configuration before spend;
the saved fit records the actual selected provider, reported model and fallback
flag. A fallback fit remains reusable under the same allowed policy. The policy
digest does not identify immutable upstream model weights.

An older kernel or unavailable identity retains previous fits and reports that
scoring configuration is unavailable. Activate the matching kernel before this
application version. The probe follows the actual package-bot inference path,
which currently uses the native service's startup defaults; a later global chat
model change does not automatically replace that dedicated bot's configuration.
The native meter's existing different-model refusal still applies to upstream
responses, including changed aliases. Parser compatibility does not override it.

Automatic submission uses the dedicated private browser worker described in
[Native submission worker](../NATIVE-SUBMISSION.md). It requires approval of the
specific job and frozen packet; unknown outcomes require reconciliation before
any new submission. The mailbox schedule reconciles accepted native results
before checking employer email.

## Legacy API-container deployment reference

The remaining sections document the older API-container scheduler and its store
layout. These Docker commands and trusted-service headers do not describe native
bare-metal operation. Times below are **America/Chicago**
(the cron reads a Chicago clock; on this deployment 18:00 CT is 23:00Z).

## 1. What runs, and when

The scheduler lives in `src-routes/career-hunter-cron.ts` and runs **inside the api container**.
It exists only when `CAREER_HUNTER_CRON=1` (or `true`/`yes`); otherwise the boot log says
`career-hunter cron disabled` and nothing below happens. It ticks every 5 minutes and runs one
**catch-up** tick 60 seconds after every api boot.

| Window (CT) | Job | Who it runs for | What it does |
|---|---|---|---|
| 18:00–18:14, once a day | **Evening chain** `runEveningScrapeIndex` | Every user store, but only if at least one user has automation ON (`career_automation_settings.auto_generate`); otherwise the whole chain is skipped and logged | 1. `pull` — one **shared** scrape of the employers' ATS feeds into `corpus.db`, keyword-matched for the first user. 2. `match` — keyword-match every other user against the fresh corpus (one writer per user db, sequential). 3. Graph ingest per user (fire-and-forget). 4. `scoreAllUsers` — for each user with automation ON: the AI **keyword pass** (`score --min-keyword 40 --first-seen-days N`), the bounded **title pass**, then enqueue the top fresh drafts as approval tickets. 5. Write the completion marker `.last-evening-run` — **only if the scrape succeeded**. |
| Boot + 60 s | **Catch-up** | Same gating as above | If the marker predates the most recent 18:00 window, the chain was missed or killed by a container recreate: the **whole chain re-fires** (multi-hour). Otherwise, and only once per process per day, a **bounded catch-up score** runs for each opted-in user: `--limit CAREER_SCORE_CATCHUP_LIMIT`, `--first-seen-days CAREER_SCORE_FIRST_SEEN_DAYS`, and skipped entirely for a user whose `career_score_settings.last_cron_score_at` is less than ~20 h old. |
| 07:00–07:14, once a day | **Morning digest** `sendDigestsForAllUsers` | Every user, opt-out (default ON) | Emails or texts each user their new high-fit matches over **their own** connected channel (Gmail, else Twilio). Nothing is sent on a day with no new hits. Once per ~day, guarded by `career_digest_settings.last_digest_at` (>20 h), so a boot catch-up can never double-send; a catch-up boot fires it only at or after 07:00. |

Two more rules that decide what actually costs money:

- **The title pass** (`score-titles`) scores postings whose titles match the user's
  `career_score_settings.title_terms` (seeded from the parsed resume, editable in Career Settings),
  capped at `CAREER_TITLE_PASS_LIMIT` per run and guarded by its own >20 h cursor
  (`last_title_pass_at`). It exists because the keyword prefilter is calibrated to the first
  operator's profile and a second user's real roles can sit below the keyword floor.
- **The keyword-pass cursor advances only on success.** A failed pass logs
  `keyword score failed; cursor not advanced` and is retried at the next opportunity, so a
  broken engine does not silently mark a day as done.

## 2. Where the batch actually executes

```
api process (cron tick)
  └─ routes/career-engine-runner.js      builds the least-privilege child env, takes a filesystem lease
       └─ node bin/oshal-jobhunter.js <verb>    the launcher: validates identity, adopts the lease, builds the Python env
            └─ python3 -m jobhunter <verb>        the engine (engine/jobhunter/*.py)
                 └─ POST /api/career-hunter/engine/complete   one per model call (up to 8 threads)
                      └─ career-bot node (cb000000-…-0001)       the model call itself, cost-attributed to the user
```

- **Model work leaves the api (1.24.0).** The engine's deterministic work (scrape, corpus, stores,
  PDF rendering) runs in the api container as before; every model call it makes is a loopback POST
  to the package's worker rail, which runs it on the dedicated **career-bot** node through the
  kernel's accounted bot rail (`executeBotOrInline`, direct and non-agentic, the run owner's
  `userSub`, task id `career-engine-<runId>`). There is no `codex exec` or `claude -p` process in
  the api any more, and no model-provider key in the engine's environment.
- **The rail refuses a missing worker.** Before a call reaches the bot, the rail requires a
  dedicated career-bot endpoint and a fresh `online` heartbeat
  (`oshal:runtime-agent:cb000000-0000-0000-0000-000000000001`). A missing or stale heartbeat, or a
  transport failure, answers `503 career-worker-unavailable`; the engine stops at the first such
  answer and the run ends `failed` with that reason — it never falls back to another provider.

- Concurrency: `CAREER_HUNTER_MAX_RUNS` engine children at once (default 3); each per-user
  SQLite has exactly one writer; leases are heartbeat-backed directories under
  `<store>/default/.career-run-locks/` (an `owner.json` with a fresh mtime is a live run — never
  delete one by hand, stale ones are reaped automatically).
- Store layout (`JOBHUNTER_STORE_ROOT`, `/app/output/career-hunter-data` on the api, a persistent
  volume): `default/corpus.db` (shared corpus), `default/<user>/user-<user>.db` (per-user board),
  `default/.last-evening-run` (completion marker), `default/.career-run-locks/`.
- A refresh of the Resume Studio master document answers **409 inflight** while a chain holds the
  user's lease. That is the lease working, not a bug; it clears when the run finishes.

## 3. How to check on it

### 3.1 The log is the primary instrument

Everything the scheduler decides is one structured log line on the api (`docker logs
oshal-local-api`). Filter on the three modules and drop the guest stores:

```bash
docker logs oshal-local-api --since 24h 2>&1 \
  | grep -E '"module":"(career-hunter-cron|career-title-score|career-digest)"' \
  | grep -v '"userSub":"guest-'
```

| Line (`msg`) | Level | Meaning |
|---|---|---|
| `career-hunter cron enabled (scrape+index 18:00 CT, digest 07:00 CT, catch-up on start)` | info | Scheduler is on for this boot. Absent → `CAREER_HUNTER_CRON` is unset. |
| `evening scrape + index starting` `{users}` | info | The chain began (window, recovery, or admin refresh). |
| `scrape finished — indexing all users` `{ok}` | info | Shared pull done; `ok:false` means the scrape failed and the marker will not be written. |
| `evening chain skipped — no user has opted in to automation` | info | Nobody has automation ON; nothing scraped, scored, or drafted. |
| `evening scrape/index already in flight — skipped` | warn | A second trigger arrived while a chain was running. |
| `user skipped — automation opt-in is OFF` | info | That user is not scored or drafted (expected for guests and most accounts). |
| `scored + enqueued` `{keywordPass, titlePass, queued}` | info | Per-user result. `keywordPass` is `ran`, `skipped-cursor` (ran within ~20 h), or `failed`; `titlePass.ran` with a `reason` when not; `queued` = drafts enqueued. |
| `keyword score failed; cursor not advanced` | **error** | The AI keyword pass did not complete. Read the `career-title-score` line that follows: it carries the Python traceback (`err`). |
| `title pass: engine run failed` `{err}` | **error** | Title pass failed; `err` is the engine traceback — the fastest way to see *why* the engine refused. |
| `evening scrape + index complete` `{scrapeOk}` | info | The chain finished. `scrapeOk:true` also wrote `.last-evening-run`. |
| `career digest: user done` `{sent, hits, reason}` | info | Digest outcome per user: `no-new-hits`, `no-channel` (nothing connected), or sent. |

### 3.2 Is something running right now?

```bash
# the chain's own flag + corpus freshness (signed-in user, or the trusted service subject)
curl -s http://127.0.0.1:35457/api/career-hunter/run/refresh -H 'x-service-secret: …' -H 'x-oshal-user-sub: <admin sub>'
#   → {"running":true|false,"corpusFreshAt":"2026-09-05T08:54:31+00:00"}

# the processes themselves
docker exec oshal-local-api ps -eo pid,etime,args | grep -E 'jobhunter' | grep -v grep

# your own engine runs and their terminal states (signed-in user)
#   GET /api/career-hunter/runs → {"runs":[{"runId","verb","state":"running|succeeded|failed|cancelled","reason","railCalls",…}]}
```

A scoring run's model calls show up as `career rail completion` lines in the api log (one per
call, with the run id and status) and as work on the career-bot container. `railCalls` climbing in
`GET /runs` is proof of life for AI scoring; a run that ends `failed` with reason
`career-worker-unavailable` means the career-bot was down, stale or unreachable.

### 3.3 Did last night complete, and is the data moving?

```bash
# completion marker (ISO time; written only after a SUCCESSFUL scrape)
docker exec oshal-local-api cat /app/output/career-hunter-data/default/.last-evening-run

# live leases (a fresh owner.json = a run in progress)
docker exec oshal-local-api ls -la /app/output/career-hunter-data/default/.career-run-locks/
```

The corpus and the boards are SQLite. Open them read-only from an in-memory main and attach the
corpus **as `corpus`** (the schema has a view that references that name; a direct open fails):

```bash
docker exec oshal-local-api python3 - <<'EOF'
import sqlite3
c = sqlite3.connect(":memory:")
c.execute('ATTACH DATABASE "file:/app/output/career-hunter-data/default/corpus.db?mode=ro" AS corpus')
c.execute('ATTACH DATABASE "file:/app/output/career-hunter-data/default/<sub>/user-<sub>.db?mode=ro" AS u')
cur = c.cursor()
print("postings per day (last 7):", cur.execute(
  "select substr(first_seen_at,1,10), count(*) from corpus.postings_corpus "
  "where first_seen_at >= date('now','-7 days') group by 1 order by 1").fetchall())
print("board: last AI score, scored in last 24h, model:", cur.execute(
  "select max(ai_scored_at), sum(ai_scored_at >= datetime('now','-1 day')), group_concat(distinct ai_model) "
  "from u.user_signals").fetchone())
EOF
```

A healthy deployment shows a `first_seen_at` batch every night (the 23:00Z–03:00Z window) and, for
each opted-in user, `max(ai_scored_at)` within the last day.

### 3.4 The persistent cursors (Postgres, FORCE RLS → query as the superuser)

```bash
docker exec oshal-local-db psql -U oshal -d oshal -c "
  select user_sub, last_cron_score_at, last_title_pass_at, array_length(title_terms,1) as terms
  from career_score_settings order by last_cron_score_at desc nulls last;"
docker exec oshal-local-db psql -U oshal -d oshal -c "select user_sub, last_digest_at from career_digest_settings;"
docker exec oshal-local-db psql -U oshal -d oshal -c "select user_sub, auto_generate, auto_submit from career_automation_settings;"
```

`last_cron_score_at` moving forward each day is the single best "the batch is healthy" signal: it
only advances when the AI keyword pass **succeeded**. An application-role connection sees zero rows
here (row-level security), which is why the superuser is used for this read.

## 4. Triggering it by hand

| Action | How | Notes |
|---|---|---|
| Full data refresh (scrape + index everyone) | `POST /api/career-hunter/run/refresh` | **Career admin only** (`CAREER_HUNTER_ADMIN_SUBS`). Runs even with zero automation opt-ins because it is a data refresh; scoring and drafting stay per-user gated. Answers 202 `started`, 409 if a chain is already running. The route accepts the trusted service subject (`x-service-secret` + `x-oshal-user-sub`) and re-checks admin, so it is scriptable. Poll `GET /run/refresh`. |
| One verb for your own store | `POST /api/career-hunter/run/{pull\|score\|match}` | Signed-in user. `score` here is `--min-keyword 40` **unbounded** — on a large backlog it runs for hours; 429 when the slot is busy. |
| Bounded catch-up, the cron's own way | `docker restart oshal-local-api` | 60 s after boot: if last night's chain completed, every opted-in user gets the bounded catch-up score; if it did not, the whole chain re-fires. |
| Title pass now | Career Settings → title profile (run now) | Bypasses the >20 h guard for that user. |
| Turn automation on/off for a user | Career Settings → automation | `auto_generate` gates scoring and drafting; `auto_submit` gates submission. Default OFF. |

## 5. Which AI credential the batch uses (worker rail, 1.24.0)

**None, in the engine.** Since 1.24.0 the engine child in the api holds no vendor login and no
model-provider key, for every user and every deployment mode (the ADR-137 amendment-A "portal
fallback" for the demo operator is retired). Its login directories always point at an empty
per-user sandbox, the only brokered key it receives is the user's Firecrawl key (deterministic web
search), and every model call goes to the career-bot through the worker rail. Which model answers
is decided by the kernel's per-user brain resolution when it dispatches to the career-bot (the
user's Settings → AI Providers); a user with nothing configured gets `424 no-configured-brain` and
the run ends `failed` with that reason.

The rail itself:

- **Route:** `POST /api/career-hunter/engine/complete`, mounted `auth: public` with
  `callbackVerifier: createCareerRailCallbackVerifier` on the kernel's signed-package-callbacks
  rail (1.25.1). The kernel admits POST only, runs the package verifier before any other code,
  refreshes the grant owner through the platform directory and requires the `authorization.yaml`
  permission bound to the route (`career.execute`, held by the `member` and `admin` roles) before
  the handler runs as that owner. No browser session, service secret or asserted-subject header
  reaches the handler; under the ADR-149 enforce rollout the 1.24.0 service-secret caller was
  refused `401 authorization_identity_required` before package code, which is why this moved.
- **Callback grant:** minted per engine child when the runner launches it (`<run id>.<secret>`,
  handed to the child as `CAREER_RAIL_GRANT` beside `CAREER_RAIL_URL`, `CAREER_RAIL_RUN_ID` and
  `CAREER_RAIL_TIMEOUT_S`; read once by the engine and removed from its environment so no browser
  or subprocess inherits it). The controller keeps only the key derived from the secret and the
  owner's verified subject and issuer. Every completion is signed over its method, path, a fresh
  timestamp, a single-use nonce and the body hash; the grant is revoked the moment the child exits
  or is cancelled. The fleet service secret is never part of the child environment.
- **Owner issuer:** a route-launched run records the kernel's verified issuer for the request; a
  cron-launched run records the issuer the owner's automation opt-in stored (migration 107). An
  opt-in saved before 1.25.1 has none, and the cron skips that owner's model passes with a log
  line until the owner saves Career Settings automation again.
- **Limits:** `CAREER_WORKER_RAIL_CONCURRENCY` (default 2 concurrent completions on the bot),
  `CAREER_WORKER_RAIL_DEADLINE_MS` (default 300000; it covers one call from the moment the call
  holds a bot slot until the bot answers, and never includes time spent waiting for a slot;
  `504 career-worker-timeout` past it), `CAREER_WORKER_RAIL_QUEUE_WAIT_MS` (default 3600000; how
  long a call may wait for a slot; `504 career-worker-queue-timeout` past it, and such a call is
  never sent to the bot), `CAREER_WORKER_RAIL_HEARTBEAT_STALE_MS` (default 90000),
  `CAREER_WORKER_RAIL_MAX_BODY_BYTES` (default 1 MiB). All are clamped package defaults read from
  the api process environment. A scoring run sends up to 8 calls at once, so at the defaults most
  of its calls wait for one of the 2 slots; the queue ceiling is sized so two such runs can queue
  even when every call runs near the deadline. The engine's own HTTP client waits for the queue
  ceiling plus the deadline plus 30 s, so the rail's answer always arrives first. A call whose run
  is cancelled or ends while it waits stops waiting at once and is never sent to the bot.
- **Cancellation:** `POST /api/career-hunter/run/<runId>/cancel` (owner only — another user's run
  answers 404) revokes the token, aborts a waiting rail call with `409 run-cancelled` and
  terminates the engine's process tree; the run ends `cancelled`. The runner kills the wrapper's
  process group, and since 1.27.1 the Python engine runs inside that group, so the cancel reaches
  it (before 1.27.1 the engine led its own group, survived the cancel and kept the run `running`
  until it exited by itself). The runner deadline and the lease-loss fence stop a run the same way.
- **Manual runs:** a `POST /api/career-hunter/run/{pull|score|match}` whose run the rail ended
  answers with the rail's own status and code, plus the run id and state (`503
  career-worker-unavailable`, `504 career-worker-timeout`, `504 career-worker-queue-timeout`, `502
  career-worker-error`, `424 no-configured-brain`, `402 budget-cap-exceeded`, `403 not-entitled`);
  a cancelled run answers `409 cancelled`.

The guards: `tests/career-worker-rail.test.mjs` (the route), `tests/career-model-rail.test.mjs`
(the engine side, with provider tripwires), `tests/career-worker-rail-isolation.test.mjs` (two
users), and `tests/career-portal-logins-launcher.test.mjs` (no verb's engine environment carries a
login location or a model key, for the demo operator too).

A direct CLI invocation that does not come through the runner — `node bin/oshal-jobhunter.js score`
from a shell, or the manifest's `cli` tools — has no grant, so its model calls stop at once with
`career worker unavailable: rail-not-configured`; so does a runner launch that established no
verified owner issuer, because the kernel could never admit its callbacks.

The kernel boundary itself is crossed by `tests/career-rail-kernel-boundary.core.test.js` (run
with a framework checkout: `OSHAL_CORE_ROOT=<oshal checkout> node --test
tests/career-rail-kernel-boundary.core.test.js`): the real manifest reader, enforce-mode
authorization runtime and route mounter admit the signed completion and refuse the 1.24.0 caller.

## 6. Failure signatures

| You see | It means | Do |
|---|---|---|
| `career worker unavailable: career-worker-unavailable` in the engine stderr; run `failed` with that reason | The career-bot node is not running, its heartbeat is stale, or it was unreachable | Check `docker ps --filter name=oshal-local-career-bot` and that the `career-node` compose profile is enabled; the api log's `career worker unavailable` line carries the preflight detail (`no-dedicated-node`, `heartbeat-missing`, `heartbeat-stale`). |
| `career worker unavailable: career-worker-queue-timeout`; run `failed` with that reason | A call waited longer than `CAREER_WORKER_RAIL_QUEUE_WAIT_MS` for one of the rail's bot slots, so it was never sent to the bot | Other runs held the slots for that long. The api log's `career rail completion` lines carry each call's status and duration. |
| `career worker unavailable: no-configured-brain` | The user has no AI provider configured for the career-bot | The user connects one in Settings → AI Providers. |
| `career worker unavailable: rail-not-configured` | The engine ran without a runner-minted grant (a direct CLI or `cli` tool call), or the launch had no verified owner issuer | Start the work through the package routes or the cron instead; for the cron, the owner saves Career Settings automation again so the opt-in records their issuer (`model passes skipped` in the api log names it). |
| `career worker unavailable: callback_signature_invalid` | The kernel's signed rail refused the completion: the grant is unknown, revoked or settled, the owner does not match, the signature or timestamp is wrong, or the request was replayed | The api log's `career rail request refused` line carries the package reason (`rail_grant_invalid`, `rail_grant_revoked`, `rail_replayed`, `rail_timestamp_stale`, ...). A stale controller clock versus the engine child is the one environmental cause. |
| `career worker unavailable: callback_owner_unavailable` | The kernel could not refresh the run owner (account deactivated, or the recorded issuer no longer matches) | The owner signs in again; check the account in Users. |
| `career worker unavailable: authorization_permission_denied` (or another 403 body) | The owner no longer holds `career.execute` (the `member` or `admin` role) | Grant the role in Access Administration; see README "Installing 1.25.1 on an enforce box". |
| `keyword score failed; cursor not advanced` with no traceback line after it | The keyword pass died without the title pass running | Run `POST /run/score` for that user; the response carries the engine's `err` tail. |
| `evening chain skipped — no user has opted in` every night | Automation is OFF for everyone | Expected on a fresh install; turn it on in Career Settings for the accounts that want nightly scoring. |
| `already in flight — skipped` | A chain is still running (they are multi-hour) | Wait; check `GET /run/refresh`. |
| `scrapeOk:false` on the complete line | The employer feed scrape failed | Marker not written, so the chain re-fires at the next boot; read the `scrape finished` line and the engine stderr. |
| `.last-evening-run` older than a day while the log shows nightly `starting` lines | Chains are starting but never completing | Look for the api being recreated mid-run (the chain is in-process; a recreate kills it) — the boot catch-up recovers it, but a box that recreates every evening never finishes. |
| Board has no `ai_scored_at` newer than N days but `first_seen_at` is fresh | Scrape fine, scoring dead | Section 5. This exact shape hid the 2026-08-10 → 09-05 outage for 25 days. |

## 7. Environment knobs

| Variable | Default | Effect |
|---|---|---|
| `CAREER_HUNTER_CRON` | off | `1`/`true`/`yes` enables the scheduler. |
| `CAREER_SCORE_CATCHUP_LIMIT` | 300 | `--limit` for a boot catch-up keyword pass. |
| `CAREER_SCORE_FIRST_SEEN_DAYS` | 8 | `--first-seen-days` for the nightly and catch-up keyword pass (jobs NEW to the corpus, never a history re-drain). |
| `CAREER_TITLE_PASS_LIMIT` | 150 | Per-run cap of the title pass. |
| `CAREER_HUNTER_ADMIN_SUBS` | unset | Comma-separated exact subjects allowed to `POST /run/refresh` and the Companies admin surface. |
| `CAREER_HUNTER_MAX_RUNS` | 3 | Concurrent engine children (api and direct CLI share the same filesystem slots). |
| `CAREER_HUNTER_CLI_TIMEOUT_MS` | 2 h | Ceiling for one engine command. |
| `CAREER_HUNTER_PULL_TIMEOUT_MS` | 8 h | Ceiling for the shared scrape. |
| `JOBHUNTER_STORE_ROOT` | `apps/career-hunter/data` | Root of the corpus and per-user stores. |
| `JOBHUNTER_STORE` | `sqlite` | `sqlite` or `postgres`; anything else fails closed. |
| `CAREER_WORKER_RAIL_CONCURRENCY`, `CAREER_WORKER_RAIL_DEADLINE_MS`, `CAREER_WORKER_RAIL_QUEUE_WAIT_MS`, `CAREER_WORKER_RAIL_HEARTBEAT_STALE_MS`, `CAREER_WORKER_RAIL_MAX_BODY_BYTES` | 2 / 300000 / 3600000 / 90000 / 1 MiB | Worker-rail limits (section 5), read by the api process. The deadline starts when a call holds a bot slot; the queue wait is bounded separately. |
| `JOBHUNTER_USE_CODEX`, `JOBHUNTER_CODEX_MODEL`, `JOBHUNTER_SCORE_MODEL`, `JOBHUNTER_ANTHROPIC_MODEL` | engine | Standalone single-user engine only; the multi-user engine the package runs ignores them. |

## 9. Scrape targets — the portal table, and each user's own list

Where the nightly scrape looks is decided by two tables with two owners.

| Table | Owner | Where it is edited | What it is |
|---|---|---|---|
| Shared `companies` (in `corpus.db`; `career_companies` on the Postgres backend) | **Portal admin** (`CAREER_HUNTER_ADMIN_SUBS`) | **Companies** surface → paste the careers/jobs URL on a row and press **Resolve** (`POST /companies-admin/seturl`, engine verb `seturl`: detect the ATS, save, scrape now). Seeds come from `engine/seeds/`; `python -m jobhunter add-url --url …` bulk-adds from the CLI. | The corpus every user is matched against. A row is scraped nightly only when it has an `ats_type` and `ats_token`. |
| `career_user_targets` (Postgres, FORCE RLS, one row per user + URL) | **Each user** | **Career Settings → Target companies (your list)** — `GET/POST /settings/targets`, `DELETE /settings/targets/:id` | The user's extension of the portal table. |

**The acceptance rule.** A pasted URL is handed to the engine's own classifier
(`python -m jobhunter classify --url …`, pattern-only, no database, no page render). If it matches a
supported job-board shape the URL is stored as `accepted` and answered 202; if it does not, the
answer is 400 with `rejected: true`, the reason, and the supported list — and nothing is stored.
There is no second copy of the patterns in TypeScript: `resolve.PATTERN_ATS` is reported by the
verb, and a guard proves it equals the classifier's own return literals. Supported today:
workday, icims, eightfold, greenhouse, lever, ashby, smartrecruiters, workable, taleo, oracle_orc,
phenom, successfactors, jibe, avature, brassring, gdcareers, gsroles. A bare Workday host without a
job site is rejected with a hint to paste the full site URL.

**What happens after acceptance.** Detached from the request, `add-target --url … --source
user:<sub>` registers the employer in the shared `companies` table (or updates the existing row
when the name matches an already-seeded employer), records the provenance tag in `source_lists`,
and scrapes the board once. The user's row then reads `resolved` with the company and the posting
count, or `unresolved` with the engine's reason when the board could not be fetched. From then on
the nightly chain treats the company exactly like an admin-added one — so a target one user adds
enriches the shared corpus for everyone; each user's *matches* stay their own.

**Admin view.** The Companies surface marks rows that arrived this way with a **user-added** pill
(`source_lists` contains `"user:…"`). Removing a target from a user's list removes only their row;
the shared company stays until an admin decides otherwise — the portal table is the portal's.

**Knobs and checks.** `CAREER_TARGETS_MAX_PER_USER` (default 200) caps a list. Log module
`career-targets`: `url rejected` (with the reason), `url accepted`, `target resolved` /
`target unresolved`, `classifier unavailable` (503 to the user — the engine could not run).
Query as the superuser: `select user_sub, url, ats_type, status, company_name, postings, reason
from career_user_targets order by created_at desc;`.

## 8. A worked example: the 25-day silent outage

From 2026-08-10 the corpus kept growing every night (13–24k postings a day) while no posting was
AI-scored: the nightly `scored + enqueued` line reported `keywordPass: "failed"` and the title pass
traceback said `No AI auth found`. Store commit `20168c9` had introduced the per-user login sandbox
without a carve for the deployment's own logins, and the brokered key was never presented under the
name the engine reads. The fix landed in two steps, which is the lesson: 1.12.4 opened the carve in
the runner and a runner-level proof was green, but the launcher still applied its own sandbox and
the next live pass failed identically; 1.12.5 made the launcher honor the runner's verdict. Proof
that it was over: `ps` in the api showed `jobhunter score` with four `codex exec` workers, and the
operator's board gained AI-scored rows two minutes after the restart.
<!-- CHANGE LOG: 14 | maintainer@emeraldcoastsystemsgroup.com | Document 1.66.1: an unmarked job whose preparation stopped for missing details reads with details_needed, the 409's words. -->
