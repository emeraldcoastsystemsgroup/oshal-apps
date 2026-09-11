# vids on Home

Done means the worker recorded completion, not social publication. Windows use last update because the ledger has no completion timestamp. Home does not drive the editor, retry jobs or consume rendering credits.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `jobs-active` — Queued / rendering | `active` in the SELECT below |
| `jobs-failed` — Failed jobs | `failed` in the SELECT below |
| `jobs-done-24h` — Done jobs updated / 24h | `day` in the SELECT below |
| `jobs-done-5d` — Done jobs updated / 5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `vids-studio`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE status IN ('queued','running'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed FROM vids_jobs WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT count(*) FILTER (WHERE updated_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five FROM vids_jobs WHERE user_sub = $1 AND created_at <= $2 AND status='done' AND updated_at <= $2 AND updated_at > $2::timestamptz - interval '120 hours'
```

```sql
SELECT idea, status, orientation, updated_at FROM vids_jobs WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY (status IN ('failed','queued','running')) DESC, updated_at DESC, job_id LIMIT 3
```
