# Career Hunter storage promotion and rollback specification

<!--
CHANGE LOG
-------------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com | Define evidence-driven PostgreSQL promotion, reverse synchronization, rollback, and seven-day observation without claiming a live cutover.
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
- No write cutover is allowed until the reverse projector below is implemented, replay-tested, and
  caught up. This repository currently defines that projector; it does not claim it is deployed.

## Repeatable pre-cutover evidence

Install the exact engine dependencies from `engine/requirements.txt`. Store CI runs
`tests/career-storage-contract.py` through `tests/career-storage-contract.test.mjs` twice: a real
temporary SQLite database and a disposable PostgreSQL database owned by a LOGIN, NOSUPERUSER,
NOBYPASSRLS role. The shared contract crosses a loopback HTTP ATS, exercises company/posting
upserts, refresh, deactivation, job type, generated sequences, the fresh keyword-index step,
application lifecycle/provenance, and PostgreSQL owner isolation.

Replay the source without enabling application writes:

```text
node scripts/migrate-sqlite-to-postgres.js [--only-user <sub>]
```

Migration `103-career-interview-source-identity.sql` must be applied first. It gives new/replayed
interviews their exact SQLite `source_id`. Pre-103 PostgreSQL interviews stay visibly unmapped;
the reporter blocks promotion until an operator reconciles them from backup.

Produce a bounded-memory comparison after every replay:

```text
python engine/sync/report_convergence.py \
  --data-root <career-data-root> \
  --database-url <app-role-dsn> \
  --output <evidence-dir>/career-convergence.json \
  --require-convergence
```

The report contains source/target counts and canonical SHA-256 digests for companies, postings,
scores, applications, recruiters, gaps, and interviews. It also compares the top active board,
fresh high-fit count, and applied posting IDs for every user. It streams in primary-key order and
does not load the corpus into memory. Exit code 2 means a comparison failed; the promotion stops.

## Reverse synchronization required before PostgreSQL writes

The reverse rail is an ordered PostgreSQL outbox plus an idempotent SQLite projector:

1. Add `career_store_change_log(change_id BIGSERIAL, table_name, owner_sub, row_key, operation,
   row_after JSONB, committed_at)` and transaction-local triggers on all mutable Career tables.
   The outbox row commits in the same transaction as its source mutation.
2. A single `career-reverse-sync` worker reads strictly after its durable `change_id` checkpoint,
   applies rows to a stopped-writer SQLite snapshot by exact company/posting/source IDs, commits
   SQLite, and only then advances the checkpoint. Replaying the same `change_id` is a no-op.
3. Shared rows project to `corpus.db`; owner rows project only to that subject's
   `user-<sub>.db`. Unknown tables, unknown operations, missing owners, ambiguous paths, source-key
   collisions, and schema-version mismatches stop the worker rather than skipping a row.
4. Application provenance remains monotonic. `apply_run_id` is projected, but a live
   `apply_claim_token` is not used as rollback state. Promotion/rollback requires zero outstanding
   claims, so the projector writes a cleared token after the corresponding settlement is durable.
5. Nightly snapshots plus outbox retention extend beyond the rollback window. The worker exports
   checkpoint lag, last applied commit time, row failures, and per-table counts.

The implementation done condition is a fault-injection test that kills the worker before SQLite
commit, after SQLite commit, and before checkpoint commit, then proves replay converges without
duplicates or lost lifecycle evidence. Until that passes in disposable PostgreSQL and SQLite,
`JOBHUNTER_STORE=postgres` is read-only smoke only.

## Promotion sequence

1. Confirm protected-branch checks, exact dependency installation, both backend contracts, all
   package suites, migrations, and the convergence report are green at the audited source SHA.
2. Quiesce Career user/cron writes and verify the worker/apply queues have no live claims.
3. Take independent, restorable backups of `corpus.db`, every user database, and PostgreSQL. Record
   hashes, sizes, timestamps, WAL/checkpoint position, and restore-test evidence outside the data
   directories scanned as applications.
4. Run the loader twice. The second run must change zero observable rows and the convergence report
   must be fully green, including zero unmapped interviews.
5. Enable PostgreSQL read-only smoke for authenticated test users. Exercise board, detail, search,
   recruiter, application, and nightly dry-run queries; compare latency and RLS-denial telemetry.
6. Start the reverse projector, wait until its checkpoint equals the latest outbox `change_id`, and
   rerun convergence.
7. Enable PostgreSQL user writes for a canary cohort, then cron writes. Expand only while reverse
   lag is bounded and every comparison remains green.

No command in this document performs those live actions automatically. Backup, quiescence,
promotion, and cohort expansion require an operator on the protected deployment path.

## Rollback sequence

1. Disable cron and user writes; drain or explicitly release every application claim.
2. Back up both stores and record the final outbox high-water mark.
3. Wait until the reverse projector checkpoint reaches that mark. Run the convergence report with
   `--require-convergence`; any mismatch stops rollback.
4. Switch to `JOBHUNTER_STORE=sqlite` while writes remain disabled and run authenticated read-only
   smoke queries.
5. Re-enable user writes, then cron. Keep PostgreSQL and its outbox intact for investigation; do
   not run a forward loader over the newly authoritative SQLite until the incident decision says
   to resume promotion.

## Seven-day observation

For seven complete days after PostgreSQL writes begin, alert on corpus and per-user count drift,
digest/key-query checksum drift, reverse-projector lag or failure, p50/p95/p99 route latency,
database errors, RLS denials by table/subject, nightly start/completion markers, jobs ingested,
jobs deactivated, rows scored, drafts queued, and application-state transitions. Archive one signed
convergence report per nightly completion. Seven days without a sample, a failed nightly marker,
or an unexplained mismatch resets the observation window; it is not silently waived.
