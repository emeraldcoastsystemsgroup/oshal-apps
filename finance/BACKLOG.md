# finance — BACKLOG

Open work on the packaged finance app. Every entry has a done-when so scope does not have to be
guessed later.

---

## A. Schema DDL runs on every request and queues behind any long lock — RESOLVED in `1.8.4`

Resolved in `finance` `1.8.4` (`src-routes/finance-routes.ts` / `routes/finance-routes.js`):

- Removed all per-request `ensureFinanceSchema(ctx.pool)` calls from every HTTP route handler (`GET /status`, `POST /exchange`, `POST /link-sandbox`, `POST /demo-data`, `POST /sync`, `GET /summary`, `GET /brief`, `POST /brief/refresh`, `POST /pay`, `GET /payments`); no request path issues DDL.
- On PostgreSQL pools, `createFinanceRoutes(ctx)` runs a one-time mount check via `ensureFinanceSchema`, which reads `information_schema.columns` and `pg_class` (`relrowsecurity` + `relforcerowsecurity`) first and issues zero DDL when the four tables and forced RLS policies already match.
- When PostgreSQL DDL is needed, `ensureFinanceSchema` executes inside a transaction with `SET LOCAL lock_timeout = '2s'`, rolling back, logging a warning and releasing the checked-out client immediately if a concurrent lock (`55P03`) holds a table.
- Guarded by `finance/tests/finance-routes-no-ddl.test.cjs` (`test-lab.yaml` id `finance-routes-no-ddl`).
