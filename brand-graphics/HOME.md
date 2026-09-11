# brand-graphics on Home

Only Vids jobs explicitly attributed as brand builds are counted. Completion is a saved worker result, not a publication. Review or edit the brand brief before explicitly starting a render; a connected draft consumes no rendering credits.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `brand-active` — Brand jobs in progress | `active` in the SELECT below |
| `brand-failed` — Failed brand jobs | `failed` in the SELECT below |
| `brand-done-5d` — Done jobs updated / 5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `brand-graphics`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE status IN ('queued','running'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed, count(*) FILTER (WHERE status='done' AND updated_at > $2::timestamptz - interval '120 hours')::text AS five FROM vids_jobs WHERE user_sub = $1 AND insert_mode='brand' AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT idea, status, updated_at FROM vids_jobs WHERE user_sub = $1 AND insert_mode='brand' AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, job_id LIMIT 3
```
