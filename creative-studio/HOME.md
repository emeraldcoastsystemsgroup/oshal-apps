# creative-studio on Home

Shows only the caller’s Vids story pipeline jobs, never generic clip or brand jobs. A completed story job records the worker outcome; it does not prove social publication or current remote file availability. Prepare an editable next episode or production document.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `stories-active` — Story jobs in progress | `active` in the SELECT below |
| `stories-failed` — Failed story jobs | `failed` in the SELECT below |
| `stories-done-5d` — Stories done / 5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `creative-studio`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE status IN ('queued','running'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed, count(*) FILTER (WHERE status='done' AND updated_at > $2::timestamptz - interval '120 hours')::text AS five FROM vids_jobs WHERE user_sub = $1 AND insert_mode='story' AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT idea, status, updated_at FROM vids_jobs WHERE user_sub = $1 AND insert_mode='story' AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, job_id LIMIT 3
```
