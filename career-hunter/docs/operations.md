# Career Hunter — operations guide (batch processes, from the admin's chair)

This is the as-built description of everything Career Hunter does on its own, when it does it, for
whom, how to tell whether it ran, and what to do when it did not. Times are **America/Chicago**
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
                 └─ codex exec … / Anthropic API   the AI calls, one worker per scored posting (up to 8)
```

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
docker exec oshal-local-api ps -eo pid,etime,args | grep -E 'jobhunter|codex exec' | grep -v grep
```

Seeing `python3 -m jobhunter score …` together with `codex exec --json --ephemeral …` workers is
proof of life for AI scoring: the workers only appear once the engine has found a usable login.

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

## 5. Which AI credential the batch uses (ADR-137 amendment A)

The engine finds a provider in this order: **codex** (`~/.codex/auth.json`, or `OPENAI_API_KEY`;
set `JOBHUNTER_USE_CODEX=0` to skip) → **Anthropic** (`ANTHROPIC_API_KEY`, else the Claude Code
login file `~/.claude/.credentials.json`) → **OpenAI**. What the child is *allowed to see* depends
on the deployment posture:

| Posture | Who | What the engine child sees |
|---|---|---|
| **Demo / dev / test** — `DEMO_MODE` truthy | the **exact** operator subject in `OSHAL_OPERATOR_SUBS` | The deployment's own mounted logins (`/root/.codex`, `/root/.claude`) — the "portal fallback". The runner states this as `OSHAL_PORTAL_LOGINS=1`; the launcher lifts its sandbox only on that exact value. |
| Everyone else, and every non-demo deployment | any user | An empty per-user sandbox for the login directories, plus **only that user's own keys** brokered from their Career Settings connections (`anthropic`, `firecrawl`), presented as `ANTHROPIC_API_KEY` / `FIRECRAWL_API_KEY`. The controller's own keys never reach a child. |

There are **two** places that enforce the sandbox — the runner (`career-engine-runner.ts`) and the
launcher (`bin/oshal-jobhunter.js`) — and both must agree. A fix to one of them alone changes
nothing for Python; the guard `tests/career-portal-logins-launcher.test.mjs` pins the launcher
half, `tests/career-no-sync-api.test.mjs` the runner half.

**"No AI auth found. Log into Claude Code, or set ANTHROPIC_API_KEY."** in a title-pass traceback
means the child found none of the above. Check, in order: (1) the api container has `DEMO_MODE`
and `OSHAL_OPERATOR_SUBS` set and the user *is* that exact subject; (2) `/root/.codex/auth.json`
or `/root/.claude/.credentials.json` exists inside the api container (they are host mounts);
(3) for a non-operator user, an Anthropic key is saved in Career Settings; (4) the deployed package
is at least 1.12.5.

## 6. Failure signatures

| You see | It means | Do |
|---|---|---|
| `No AI auth found` | Credential posture (section 5) | Walk the four checks above. |
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
| `DEMO_MODE`, `OSHAL_OPERATOR_SUBS` | kernel | The two gates of the portal fallback (section 5). |
| `JOBHUNTER_USE_CODEX`, `JOBHUNTER_CODEX_MODEL`, `JOBHUNTER_SCORE_MODEL`, `JOBHUNTER_ANTHROPIC_MODEL` | engine | Provider ladder and models used for scoring and drafting. |

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
