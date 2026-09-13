# cad-studio on Home

Caller-owned parametric parts and their revisions. Home reads metadata only; it never runs the
kernel, reads a model file, or contacts the engine container.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `models-total` — Parts | `total` in the first SELECT below |
| `models-built` — Built parts | `built` in the first SELECT below |
| `revisions-total` — Rebuilds | `revisions` (sum of revision numbers) in the first SELECT below |
| `models-failed` — Failed rebuilds | `failed` in the first SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No engine calls, schema bootstrap, AI generation, writes or retries run on Home. All
failed sources yield 503; individual failures retain available evidence and mark missing metrics
unavailable. Details open `cad-studio`; continuation actions use the existing optional versioned
integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS total, count(*) FILTER (WHERE state = 'built')::text AS built, count(*) FILTER (WHERE state = 'failed')::text AS failed, coalesce(sum(revision), 0)::text AS revisions FROM cad_model WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT title, state, revision, report, source, updated_at FROM cad_model WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, model_id LIMIT 3
```
