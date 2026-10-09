# Career Hunter storage promotion and rollback specification

<!--
CHANGE LOG
-------------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com | Define evidence-driven PostgreSQL promotion, reverse synchronization, rollback, and seven-day observation without claiming a live cutover.
2 | maintainer@emeraldcoastsystemsgroup.com | Name the real commands (1.25.0): migration 106's outbox, engine/sync/reverse_sync.py and its rollback gate, engine/sync/observe_cutover.py and the operator status route, and the disposable rehearsal suites. Correct the checkpoint design: a transaction-id horizon plus per-row change ids, because change_id order is not commit order.
-->

This is the current runbook for moving Career Hunter from its SQLite corpus/user-store pair to
PostgreSQL. Historical production observations remain in `JOBHUNTER-CONFUSION.md`; they are not
authorization to mutate either live store.

## Invariants

- `JOBHUNTER_STORE` accepts only `sqlite` or `postgres`. Absence means `sqlite`; every other value
  stops startup before a database is opened.
- Before promotion, SQLite is authoritative. PostgreSQL accepts loader replays and read-only smoke
  traffic only. User and cron writes remain on SQLite.
- Shared employer facts have one row in `career_companies` / `career_postings`. Scores,
  applications, recruiters, gaps, and interviews remain owner-scoped behind FORCE RLS.
- A source row is never silently renamed, dropped, or invented to make a load green. Natural-key
  collisions, missing required titles, orphaned work, unmapped historical interviews, count
  differences, checksum differences, and key-query differences are promotion failures.
- No write cutover is allowed until the reverse projector below is caught up. The projector and
  its fault-injection proof exist in this package (1.25.0); nothing here claims they have run
  against the live stores.

## Commands

All commands run from the package directory inside the api container, where `DATABASE_URL` is the
app role (LOGIN, NOSUPERUSER, NOBYPASSRLS) and the Career data root is
`/app/output/career-hunter-data/default` (override with `CAREER_DATA_ROOT` / `--data-root`).

| Step | Command | Verdict |
|---|---|---|
| Replay SQLite into PostgreSQL | `node scripts/migrate-sqlite-to-postgres.js [--only-user <sub>]` | exit 0; its session is marked `sqlite-replay`, so the outbox records nothing |
| Compare the stores | `python engine/sync/report_convergence.py --output <evidence-dir>/career-convergence.json --require-convergence` | exit 0 converged; exit 2 names every failing dataset on stderr (`CAREER_CONVERGENCE_FAILED=`) |
| Project PostgreSQL writes back | `python engine/sync/reverse_sync.py --until-caught-up` (one catch-up) or `--follow` (the long-lived worker) | exit 0; 3 stopped on a change it refused; 4 another worker holds the lock; 5 still lagging |
| Projector metrics | `python engine/sync/reverse_sync.py --status --metrics-output <file>` | JSON: horizon, pending rows, lag seconds, row failures, per-table counts, outstanding claims |
| Rollback gate | `python engine/sync/reverse_sync.py --check-rollback-ready` | exit 0 only when caught up, zero outstanding claims and no failed projection; otherwise exit 2 with `CAREER_ROLLBACK_BLOCKED=` |
| Observation sample | `python engine/sync/observe_cutover.py` (after every nightly completion) | exit 0 in bounds; exit 2 when the sample reset the window |
| Observation status | `GET /api/career-hunter/cutover/status` (operator session) | the window and the latest sample; Test Lab smoke `cutover-status` |

## Repeatable pre-cutover evidence

Install the exact engine dependencies from `engine/requirements.txt`. The package suites prove the
whole sequence on synthetic stores built from the engine's own schema and a disposable PostgreSQL
database owned by a LOGIN, NOSUPERUSER, NOBYPASSRLS role with every package migration applied:

- `tests/career-storage-contract.test.mjs`: one ATS/storage/nightly contract on both backends,
  now with the 106 capture triggers installed.
- `tests/career-convergence-contract.test.mjs`: two real loader runs converge, the second changes
  zero observable rows, owner B never sees owner A's rows, and a broken posting, score,
  application and pre-103 interview make the reporter exit 2 naming each dataset.
- `tests/career-reverse-sync.test.mjs`: the outbox and the projector (see below).
- `tests/career-cutover-drill.test.mjs`: the promotion and rollback sequences end to end, plus
  real observation samples.

Store CI runs them against its PostgreSQL service with `CAREER_TEST_POSTGRES_ADMIN_URL` and
`CAREER_LOADER_NODE_PATH` (pg + better-sqlite3) and cannot skip them. Locally, point the admin URL
at a throwaway container on a free port, never at the deployment database:

```text
docker run -d --rm --name career-contract-pg -p 127.0.0.1:55460:5432 \
  -e POSTGRES_PASSWORD=career-contract-ci pgvector/pgvector:pg16
CAREER_TEST_POSTGRES_ADMIN_URL=postgresql://postgres:career-contract-ci@127.0.0.1:55460/postgres \
CAREER_LOADER_NODE_PATH=<kernel checkout>/node_modules \
  node --test tests/career-storage-contract.test.mjs tests/career-convergence-contract.test.mjs \
  tests/career-reverse-sync.test.mjs tests/career-cutover-drill.test.mjs
docker stop career-contract-pg
```

Migration `103-career-interview-source-identity.sql` gives replayed interviews their exact SQLite
`source_id`. Pre-103 PostgreSQL interviews stay visibly unmapped; the reporter blocks promotion
until an operator reconciles them from backup.

## Reverse synchronization

The reverse rail is an ordered PostgreSQL outbox plus an idempotent SQLite projector.

1. Migration `106-career-store-change-log.sql` adds `career_store_change_log(change_id, txid,
   schema_version, table_name, owner_sub, row_key, operation, row_after, committed_at)` and
   transaction-local AFTER ROW triggers on `career_companies`, `career_postings`,
   `career_company_reputation`, `career_user_job_scores`, `career_user_applications`,
   `career_user_recruiter_firms`, `career_user_gap_themes` and
   `career_user_interview_assessments`. The outbox row commits or rolls back with its source
   write; an UPDATE that changes nothing records nothing. The log and the projector checkpoint
   (`career_reverse_sync_checkpoint`) are operator-only under FORCE RLS; an owner session may only
   append rows for itself or the shared corpus. The loader's operator session is marked
   `oshal.career_change_origin = 'sqlite-replay'` and is not captured; an owner session setting
   the same marker is still captured.
2. `engine/sync/reverse_sync.py` is the single `career-reverse-sync` worker (a PostgreSQL advisory
   lock refuses a second one). `change_id` is allocated at write time, not commit time, so the
   highest change_id seen is not a safe checkpoint. The durable checkpoint is a transaction-id
   horizon: every row whose `txid` is below `txid_snapshot_xmin(txid_current_snapshot())` belongs to
   a finished transaction, so the window `[checkpoint, current xmin)` is complete when read. The
   worker applies the window in change_id order, commits SQLite, and only then advances the
   horizon. That horizon is cluster-wide: any write transaction still open anywhere on the
   PostgreSQL server, in any database, holds it. While one runs, rows committed after it stay
   pending, so the projector and the rollback gate both report `projector-lag`, and
   `--until-caught-up` exits 5 once its passes run out. Each SQLite file records, in the same
   SQLite transaction, the change_id that last wrote each source row
   (`career_reverse_sync_applied`), so a replayed or older change is a no-op.
3. Shared rows project to `corpus.db`; owner rows project only to that subject's
   `<data-root>/<sub>/user-<sub>.db`, resolved exactly as the loader and reporter enumerate stores.
   Unknown tables, unknown schema versions or columns, a foreign tenant, missing or ambiguous owner
   stores, source-key collisions, rows without a source identity, and SQLite tables without the
   expected columns stop the worker (exit 3) without moving the checkpoint; the reason is kept in
   `last_error` and counted in `row_failures`.
4. Application provenance is projected; `apply_run_id` is projected; `apply_claim_token` is always
   written cleared. The rollback gate refuses while any PostgreSQL application holds a claim token
   or an unsettled lease.
5. Metrics (`--status`): checkpoint horizon, last and latest change id, pending rows, lag seconds,
   last applied commit time, row failures, last error, per-table projected/pending counts,
   outstanding claims. The outbox is not pruned by the worker; retention must exceed the rollback
   window.

Proven in `tests/career-reverse-sync.test.mjs` against disposable PostgreSQL and real SQLite: the
worker killed before the SQLite commit, after it, and before the checkpoint commit replays to a
converged store with no duplicate and no lost lifecycle evidence; a full replay from horizon 0
changes nothing; a transaction that commits after a higher change_id is held back and then
delivered; each refusal above stops the worker with its checkpoint unmoved.

An interview row without a `source_id` stops the projector ("has no source_id") rather than
being guessed into SQLite.

## Promotion sequence

1. Confirm the package suites above, the migrations and the convergence report are green at the
   audited source SHA.
2. Quiesce Career user/cron writes and verify the worker/apply queues have no live claims.
3. Take independent, restorable backups of `corpus.db`, every user database, and PostgreSQL. Record
   hashes, sizes, timestamps, WAL/checkpoint position, and restore-test evidence outside the data
   directories scanned as applications.
4. Run the loader twice. The second run must change zero observable rows and
   `report_convergence.py --require-convergence` must exit 0, including zero unmapped interviews.
5. Enable PostgreSQL read-only smoke for authenticated test users. Exercise board, detail, search,
   recruiter, application, and nightly dry-run queries; compare latency and RLS-denial telemetry.
6. Start `reverse_sync.py --follow`, wait until `--status` reports `caughtUp: true`, and rerun
   convergence.
7. Enable PostgreSQL user writes for a canary cohort, then cron writes. Expand only while reverse
   lag is bounded and every comparison remains green. Start the observation window (below).

`tests/career-cutover-drill.test.mjs` rehearses steps 4-7 and the rollback below on synthetic
stores. No command in this document performs the live actions automatically: backup, quiescence,
promotion, and cohort expansion require an operator on the protected deployment path.

## Rollback sequence

1. Disable cron and user writes; drain or explicitly release every application claim.
2. Back up both stores and record the final outbox high-water mark (`--status` `latestChangeId`).
3. Run `reverse_sync.py --until-caught-up`, then `reverse_sync.py --check-rollback-ready` (exit 0)
   and `report_convergence.py --require-convergence` (exit 0). Any refusal stops rollback. The
   horizon is cluster-wide, so a long write transaction anywhere on the server (another database
   included) holds the projector and the gate at `projector-lag` and makes `--until-caught-up`
   exit 5.
4. Switch to `JOBHUNTER_STORE=sqlite` while writes remain disabled and run authenticated read-only
   smoke queries.
5. Re-enable user writes, then cron. Keep PostgreSQL and its outbox intact for investigation; do
   not run a forward loader over the newly authoritative SQLite until the incident decision says
   to resume promotion.

## Seven-day observation

After PostgreSQL writes begin, run `engine/sync/observe_cutover.py` after every nightly completion.
Each sample archives under `<data-root>/_cutover/` (or `--archive-dir`):

- the full convergence report, once per nightly completion marker (`reports/`);
- reverse-projector lag, failures and outstanding claims;
- the evening chain's completion marker (`<data-root>/.last-evening-run`, written by the package
  cron only after a successful scrape) and its age;
- an owner-isolation probe: as each owner with the operator setting off, every per-user table
  shows zero rows of anyone else and the outbox shows none;
- postings ingested and deactivated, rows scored, drafts generated, approvals queued, and
  application-state transitions since the previous sample.

`window.json` completes only after seven days of consecutive in-bounds samples. A gap longer than
`--max-sample-gap-hours` (26), a missing or stale nightly marker (`--max-nightly-age-hours`, 26),
convergence drift, projector lag above `--max-projector-lag-seconds` (900), a failed projection,
an isolation leak, or a `window.json` that exists but cannot be read (kept aside as
`window.unreadable-<stamp>.json`) resets it and records why; nothing is silently waived.
Operators read it at `GET /api/career-hunter/cutover/status`. Route latency percentiles and
database error rates come from the core monitoring stack, not from this sampler; the cron persists
a completion marker only, so there is no separate start marker to sample.
