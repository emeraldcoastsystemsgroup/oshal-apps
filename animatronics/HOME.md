# animatronics on Home

Caller-owned rigs and their command log. Home reads metadata only; it never compiles a frame,
runs a rehearsal or talks to a controller.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `rigs-total` — Rigs | `total` in the first SELECT below |
| `rigs-armed` — Armed rigs | `armed` in the first SELECT below |
| `runs-total` — Logged commands | `runs` (sum of run counts) in the first SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No frame compilation, schema bootstrap, AI generation, writes or retries run on Home. All
failed sources yield 503; individual failures retain available evidence and mark missing metrics
unavailable. Details open `animatronics`; continuation actions use the existing optional versioned
integration receivers and leave drafts editable. An armed rig is shown with a warn tone.

```sql
SELECT count(*)::text AS total, count(*) FILTER (WHERE armed)::text AS armed, coalesce(sum(run_count), 0)::text AS runs FROM animatronic_rig WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT title, armed, run_count, source, updated_at FROM animatronic_rig WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, rig_id LIMIT 3
```
