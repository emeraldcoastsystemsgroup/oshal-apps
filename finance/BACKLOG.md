# finance — BACKLOG

Open work on the packaged finance app. Every entry has a done-when so scope does not have to be
guessed later.

---

## A. Schema DDL runs on every request and queues behind any long lock

`ensureFinanceSchema` (`src-routes/finance-routes.ts:79`) runs `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS oshal_finance_items_user` and `ALTER TABLE oshal_finance_items ENABLE ROW
LEVEL SECURITY` on the request path (called at lines 252, 288 and 306). `ALTER TABLE` needs an
exclusive lock on the table, so one long-lived share lock queues the ALTER, every later finance
statement queues behind the ALTER, and the api's connection pool fills with blocked finance
statements.

Measured on 2026-10-02, 08:33-08:59 UTC, when a restore-smoke `pg_dump` of the live database held
share locks for the whole 13 GB copy: `pg_stat_activity` at 08:36 showed pid 3437 (the ALTER) waiting
on pid 3591 (pg_dump), and pids 2480/3191/3255 (CREATE INDEX) and 2635/3382/3383/3438
(`SELECT count(*) FROM oshal_finance_items`) waiting on 3437; 8 of the api pool's connections were
stuck; the api's `cli-tokens` middleware failed with "timeout exceeded when trying to connect"
79-87 times a minute; every bearer request on the box answered 401 for 25 minutes, the Node app's
polling included. The dump half is the core backlog entry "The evidence refresh's restore smoke locks
the live database for the whole dump".

Done when:

- the schema is ensured once, at mount or boot (or by a migration), never on a request path; a
  request issues no DDL;
- the ensure step tolerates a concurrent long lock without holding a pool connection for its
  duration (a `lock_timeout` with a logged skip, or a check that issues nothing when the schema
  already matches);
- a test proves the request paths issue no DDL statement.
