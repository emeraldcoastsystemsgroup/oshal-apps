# portrait-studio on Home

Saved generation states distinguish work in progress, failed work and completed portraits. The five-day window uses the last update, not a separate completion timestamp. Existing image review/export remains in Portrait Studio; document preparation sends only selected metadata.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `portraits-active` — Portraits generating | `active` in the SELECT below |
| `portraits-failed` — Failed portraits | `failed` in the SELECT below |
| `portraits-done-5d` — Portraits done / 5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, require portrait.view and portrait.read and bind the verified owner issuer and subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `portrait-studio`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE status IN ('queued','generating'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed, count(*) FILTER (WHERE status='done' AND updated_at > $2::timestamptz - interval '120 hours')::text AS five FROM ps_portraits WHERE user_sub = $1 AND owner_issuer = $3 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT mode, style, status, updated_at FROM ps_portraits WHERE user_sub = $1 AND owner_issuer = $3 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, portrait_id LIMIT 3
```
