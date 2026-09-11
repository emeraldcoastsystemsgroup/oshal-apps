# presentations on Home

Counts are saved document records in rolling 24/120 hours. Storage availability is checked when you open the document. Preparation copies a bounded saved outline; it does not send or render.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `saved-24h` — Documents saved / 24h | `day` in the SELECT below |
| `saved-5d` — Documents saved / 5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `presentations-studio`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five FROM oshal_presentations WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours'
```

```sql
SELECT title, format, provider, created_at, outline FROM oshal_presentations WHERE user_sub = $1 AND created_at <= $2 ORDER BY created_at DESC, id LIMIT 3
```
