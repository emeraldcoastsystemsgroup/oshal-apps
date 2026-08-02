# Intelligent Career — what is actually true

*Verified against the running system on 2026-07-30. Every number here was read off the live
stack that day, not remembered. §7 is the command that re-derives all of it.*

---

## 1. The one-paragraph answer

**The swarm app is the product and it works.** It is installed, active, running its own
nightly ingest, and 165 real job applications have been submitted through it. Its live store
today is **SQLite on the container volume** — a shared `corpus.db` plus one
`user-<sub>.db` per person. A **Postgres store with FORCE row-level security exists
alongside it**, fully populated and proven, but it is **not yet the live store**. The engine
chooses between them with `JOBHUNTER_STORE`, which defaults to `sqlite`.

If you read nothing else: **nothing is broken. The Postgres work is an upgrade in progress,
not a repair.**

---

## 2. Live state, 2026-07-30

| | |
|---|---|
| app | `career-hunter` **v1.5.0**, status `active` |
| display name | Intelligent Career |
| nightly cron | **ON** — 18:00 CT scrape+index, 07:00 CT digest |
| burst caps | `FIRST_SEEN_DAYS=3` · `CATCHUP_LIMIT=250` · `TITLE_PASS_LIMIT=60` |
| auto-submit | **OFF** — drafts go to Approvals, a human decides |
| store in use | **SQLite** (`JOBHUNTER_STORE` unset → `sqlite`) |

> The repo manifest says `version: 1.6.0` but the registered app says **1.5.0**. The bump has
> not been loaded. Harmless, but it means repo ≠ installed until the next load.

### The two stores, and the drift between them

| | SQLite (LIVE) | Postgres (staged) |
|---|---|---|
| postings | **1,428,432** | 1,427,675 |
| my signals / scores | 1,282,861 | 1,282,861 |
| applications | — | 2,467 |
| applied | 165 | 165 |
| recruiters | 192 | 192 |
| gap themes | 30 | 30 |
| companies | 1,313 | 1,313 |

**The postings counts already differ and the gap will grow.** The nightly scrape writes
SQLite, so Postgres is a point-in-time copy taken 2026-07-30. It is not a live mirror and
there is no sync running. Re-run the loader (§6) before trusting Postgres for anything
current, and do not treat the two as interchangeable.

---

## 3. What actually broke today (and what did not)

Worth separating, because they are not the same size.

**Genuinely broken, and now fixed:**

- **Every Windows `JobHunter*` scheduled task was `Disabled`.** The native pipeline had been
  dead since 2026-07-16, not slow. That is why the board looked stale.
- **The nightly AI scorer was a silent no-op.** It filtered freshness on `posted_date`, which
  is NULL for ~26% of postings and matched **32 rows out of 1.21M** for a ten-day window. It
  printed *"DONE — all fresh in-lane postings assessed"* nightly while scoring nothing, and
  left 107,668 in-lane roles unscored.
- **The swarm board was unusable.** `sqlite_stat1` was missing from both databases (ANALYZE
  had never run) and the corpus carried only single-column indexes on ~50%-selective flags.
  The company roll-up took **317 seconds**; `/api/career-hunter/board` timed out at 120s.

**Not broken, and never was:** the swarm app itself. It was installed, active, holding 1.3M
postings, and had submitted 165 applications. The Postgres/RLS work is an upgrade.

**Self-inflicted during the work, then fixed** — recorded so nobody repeats them:

- A **backup copy left inside `deployed-apps/`** silently re-registered the app at the OLD
  version. The loader scans every subdirectory and registers by manifest `name:` without
  deduping. No error.
- An index in migration 095 was named `idx_career_apps_status`, which **031 already owned on
  a different table**. Postgres index names are schema-unique, so `CREATE INDEX IF NOT
  EXISTS` did nothing — silently.
- The per-user Postgres tables were first written from **intuition instead of
  `PRAGMA table_info`** (`name` vs `firm`, `theme` vs `key`). A NOT NULL violation caught it;
  a looser schema would have written NULLs into every renamed column and looked fine.
- Uniqueness on `(user_sub, firm)` **silently dropped 3 real recruiter contacts** — the
  tracker holds one row per *recruiter*, and there are two people each at L3Harris, Noblis
  and Peraton. Only a 192-sent / 188-landed count mismatch exposed it.

**The pattern connecting all of them:** every single one looked like success. `IF NOT
EXISTS`, `ON CONFLICT DO NOTHING`, and a "DONE" log line each swallowed a real failure.
None went red. Every one was caught by a count that did not add up.

---

## 4. Which thing is which

| # | thing | where | status |
|---|---|---|---|
| 1 | **swarm package** — `career-hunter` / "Intelligent Career" | `oshal-apps/career-hunter` → `/app/workspace-shared/deployed-apps/career-hunter/` | **LIVE. This is the product.** |
| 2 | native Flask app | `C:\Users\you\OneDrive\Documents\Jobs 2026\job-hunter` | **DECOMMISSIONED.** Historic. Portal stopped, all tasks Disabled. Do not restart it. |
| 3 | core's `apps/career-hunter` | oshal core repo | **DELETED 2026-07-21.** Any doc pointing there is stale. |

Core keeps exactly one career file by design: `src/app/routes/career-brief-bridge.ts`, which
runtime-resolves the installed package so the morning brief can include a career section
without importing from a package that may be absent. That is framework glue, not app code.

⚠ **The `jobhunter` Python package exists in both #1 and #2 and the copies have DIVERGED.**
The same `posted_date` defect was found twice and fixed two different ways: the native app
replaced the meaning of `days`; the package added a separate `first_seen_days` and left
`days` alone. **A fix to one is not a fix to the other.** #2 is historic, so the package
copy (#1) is the one that matters.

---

## 5. The nightly chain

`routes/career-hunter-cron.js`, in-process, gated on `CAREER_HUNTER_CRON=1`.

| when (America/Chicago) | what |
|---|---|
| **18:00** | shared `scrape --all` once for ALL users → keyword-index every user → bounded AI score → title pass → draft enqueue |
| **07:00** | per-user digest |
| boot + 60s | one-shot catch-up, so a recreate past a window doesn't skip the day |

**Two switches, and neither is sufficient alone.** With `CAREER_HUNTER_CRON=1` but no user
opted in via `career_automation_settings.auto_generate`, the evening chain runs every night
and does **nothing at all** — no scrape, no score, no drafts — logged only at info level.
That combination looks perfectly healthy and produces no data.

Bounded by `CAREER_SCORE_FIRST_SEEN_DAYS` / `CAREER_SCORE_CATCHUP_LIMIT` /
`CAREER_TITLE_PASS_LIMIT`, plus persistent Postgres cursors (>20h) and a `.last-evening-run`
marker so recreates never double-spend and a killed mid-run scrape still recovers.

Two things that look like style but are load-bearing:

- **A scheduled task must invoke `powershell.exe`, never a bare `.cmd`.** Task Scheduler
  hangs launching a `.cmd` as a task's top-level process — two minutes without spawning
  python, while the same commands run in 0.7s from a normal shell.
- **Freshness keys off `first_seen_at`, never `posted_date`.** See §3. The cron already
  passes `--first-seen-days` everywhere; do not "simplify" it to `--days`.

---

## 6. The Postgres store (staged, not live)

Migrations `095` → `098`. **Shared, no RLS:** `career_companies`, `career_postings`.
**Per-user, FORCE RLS on `user_sub`:** `career_user_job_scores`,
`career_user_applications`, `career_user_recruiter_firms`, `career_user_gap_themes`,
`career_user_interview_assessments`.

The line between them is *"did the employer say it, or did we infer it for one person."*
Salary and description are the employer's → shared. A fit score is a judgement about one
person → private. `target_role` is private too, even though it reads like a property of the
job: a Principal Platform Engineer role is in-lane for one person and noise for another.

Résumés are **not** in the database. They are personal documents on the user's own storage
under `intelligent-career/`; the tables hold only a storage-relative path.

**Compatibility views** (`097`, `098`) named `postings`, `companies`, `recruiter_firms`,
`gap_themes`, `interview_assessments` mean the ~60 existing `FROM postings` readers work
verbatim against Postgres. Every one is declared **`WITH (security_invoker = true)`** — and
that is the single most important line in the whole schema. A normal Postgres view executes
as its *owner*, which bypasses FORCE RLS entirely and hands every caller the whole table.
`security_invoker` makes it execute as the *caller*, so the policy filters it with no WHERE
clause anywhere. **Get this wrong and it fails silently while appearing to work.**

**Isolation, verified as `oshal_app` — a NON-superuser** (a superuser silently bypasses RLS
and would pass a broken policy):

| context | scores | recruiters |
|---|---|---|
| as owner | 1,282,861 | 192 |
| as another user | 0 | 0 |
| **no `oshal.current_sub` set** | **0** | **0** |

That last row is the point: a missing GUC yields **zero rows, never every row**.

**Performance, same probes, both modes:**

| | Postgres | SQLite |
|---|---|---|
| board top-fit | **835ms** | 30,238ms |
| applied count | 141ms | 2,113ms |
| recruiters | 1.2ms | 0.7ms |

To move data SQLite → Postgres:
`node scripts/migrate-sqlite-to-postgres.js [--dry-run] [--only-user <sub>]`
(idempotent, read-only against SQLite, preserves ids, NULLs unparseable timestamps).

---

## 7. How to check any of this

```bash
bash scripts/verify-install.sh <user_sub>     # 23 checks, read-only
```

Every check exists because that exact failure happened. Do not trust this document over the
script — and do not trust the repo over the volume: v1.3.0 was once declared shipped while
the volume held v1.1.0 with **zero engine files**.

To exercise Postgres mode without changing anything:

```bash
docker exec -e JOBHUNTER_STORE=postgres -e OSHAL_USER_SUB=<sub> \
  -e PYTHONPATH=/app/workspace-shared/deployed-apps/career-hunter/engine \
  oshal-local-api python3 -c "
from jobhunter import db
with db.connect() as c:
    cur=c.cursor(); cur.execute('SELECT count(*) FROM postings'); print(cur.fetchone())"
```

⚠ `corpus.db` **cannot be opened standalone** — `company_view` hardcodes a `corpus.` prefix,
so a direct open reports `malformed database schema` on a perfectly healthy file. Always go
through the engine's `db.connect()`.

---

## 8. Honestly not done

1. **`JOBHUNTER_STORE` still defaults to `sqlite`.** Reads are proven, and as of 2026-07-31
   so are **per-user writes** — `user_set()` (the single chokepoint for every fit / status /
   path write) round-trips through both target tables, the value survives an explicit
   `commit()`, and RLS **refuses a write attributed to another `user_sub`**
   (`InsufficientPrivilege`). That commit test matters specifically: it is what would have
   caught `SET LOCAL` silently dropping the GUC mid-run.

   Still NOT exercised: the **ingest** writes — `upsert_posting` / `upsert_company` /
   `deactivate_missing` running a real `scrape --all` against Postgres, and the full nightly
   chain end to end in postgres mode. Per-user writes are proven; corpus writes are not.
2. **No AUTOMATIC sync.** Re-running the loader now genuinely converges (it upserts; it used
   to be insert-only, which silently skipped every changed row — see below), but nothing runs
   it on a schedule, so Postgres drifts from the moment the next scrape starts. Re-run it
   after a nightly chain if you intend to read from Postgres.
3. **All three real users are migrated.** 22 guest stores are untouched by choice — throwaway
   demo sessions holding ~113K rows each.
4. **`psycopg2-binary` is on branch `fix/psycopg2-dockerfile`, unmerged — needs a human.**
   Core `main` is protected and another session had ~84 uncommitted files in that tree, so it
   was pushed to its own branch rather than forced through. Until it lands, the next image
   rebuild produces an engine that cannot reach Postgres.
5. Manifest says 1.6.0; registered app says 1.5.0. Reconciling means reloading the app.

*(The `bin/oshal-jobhunter.js` duplicate join was fixed 2026-07-31 — it now compares
`first_seen_at` against a cutoff computed in JS, and runs in both backends.)*

### The convergence check, if you ever doubt the two stores

Compare the same query across both — not a row count, the actual product query through the
engine in each mode:

```powershell
foreach ($m in @("sqlite","postgres")) {
  docker exec -e JOBHUNTER_STORE=$m -e OSHAL_USER_SUB=<sub> `
    oshal-local-api node /app/workspace-shared/deployed-apps/career-hunter/bin/oshal-jobhunter.js query
}
```

2026-07-31 after the upsert fix: **sqlite 616 / postgres 617** freshHighFit, same top match.
Before it: **616 / 747**. That 131-row gap was scores the nightly chain wrote onto rows which
already existed, which the insert-only loader skipped while reporting success. An off-by-one
is a live-write boundary; a gap of 131 is a bug. This comparison is the cheapest way to tell
them apart.

⚠ Run it from PowerShell. Git-bash rewrites the `/app/...` argument into
`/app/C:/Program Files/Git/app/...` and you get MODULE_NOT_FOUND from a perfectly good file.
