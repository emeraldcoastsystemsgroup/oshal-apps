# circuit-lab on Home

Caller-owned circuits and their runs. Home reads metadata only; it never runs the solver, reads a
waveform file, or contacts the engine container.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `designs-total` — Circuits | `total` in the first SELECT below |
| `designs-ran` — Solved circuits | `ran` in the first SELECT below |
| `runs-total` — Runs | `runs` (sum of run counts) in the first SELECT below |
| `designs-failed` — Failed runs | `failed` in the first SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No engine calls, schema bootstrap, AI generation, writes or retries run on Home. All
failed sources yield 503; individual failures retain available evidence and mark missing metrics
unavailable. Details open `circuit-lab`; continuation actions use the existing optional versioned
integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS total, count(*) FILTER (WHERE state = 'ran')::text AS ran, count(*) FILTER (WHERE state = 'failed')::text AS failed, coalesce(sum(run_count), 0)::text AS runs FROM circuit_design WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT title, state, run_count, report, source, updated_at FROM circuit_design WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, design_id LIMIT 3
```
