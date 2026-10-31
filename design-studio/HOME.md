# design-studio on Home

Caller-owned products, their phase chains and closures. Home reads metadata only; it never reads an
engine, computes a stage or writes a row.

All metrics default on and remain individually configurable.

| Metric | Source |
|---|---|
| `products-total` — Products | the count of the first SELECT below |
| `phases-total` — Phases in chains | the sum of each product's `phases` length (first SELECT) |
| `phases-closed` — Phases closed | distinct (product, phase) with a closure whose `step` is null (second SELECT) |
| `build-steps-ticked` — Build steps ticked | closures with a `step` (second SELECT) |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No engine calls, schema bootstrap, AI generation, writes or retries run on Home. All failed
sources yield 503; individual failures retain available evidence and mark missing metrics unavailable.
Details open `design-studio`. Sorting (newest change first) is done in code, never by the database.

```sql
SELECT id, name, phases, updated_at FROM design_project WHERE owner_sub = $1
```

```sql
SELECT project_id, phase, step FROM design_closure WHERE owner_sub = $1
```
