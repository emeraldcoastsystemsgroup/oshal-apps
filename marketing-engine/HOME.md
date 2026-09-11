# marketing-engine on Home

Review counts reflect current saved content states. Publish counts come only from recorded published outcomes, not drafts or skipped attempts. Connected actions prepare editable drafts; destination consent and publishing controls still apply.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `content-drafts` — Drafts to review | `drafts` in the SELECT below |
| `content-approved` — Approved content | `approved` in the SELECT below |
| `published-24h` — Published / 24h | `day` in the SELECT below |
| `published-5d` — Published / 5 days | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `marketing-engine`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE c.status='draft')::text AS drafts, count(*) FILTER (WHERE c.status='approved')::text AS approved FROM oshal_marketing_content c WHERE c.user_sub = $1 AND c.created_at <= $2 AND c.updated_at <= $2 AND (c.campaign_id IS NULL OR EXISTS (SELECT 1 FROM oshal_marketing_campaigns p WHERE p.campaign_id=c.campaign_id AND p.user_sub = $1))
```

```sql
SELECT count(*) FILTER (WHERE outcome='published' AND ts > $2::timestamptz - interval '24 hours')::text AS day, count(*) FILTER (WHERE outcome='published')::text AS five FROM oshal_marketing_run_ledger WHERE user_sub = $1 AND ts <= $2 AND ts > $2::timestamptz - interval '120 hours'
```

```sql
SELECT c.title, c.body, c.channel, c.status, c.updated_at FROM oshal_marketing_content c WHERE c.user_sub = $1 AND c.created_at <= $2 AND c.updated_at <= $2 AND (c.campaign_id IS NULL OR EXISTS (SELECT 1 FROM oshal_marketing_campaigns p WHERE p.campaign_id=c.campaign_id AND p.user_sub = $1)) ORDER BY (c.status IN ('draft','approved')) DESC, c.updated_at DESC, c.item_id LIMIT 3
```
