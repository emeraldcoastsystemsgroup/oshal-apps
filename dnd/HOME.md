# dnd on Home

Shows campaigns the caller owns or currently belongs to using the same campaign member ACL as the game. The latest archive beat must match that campaign owner. Shared story context can become an editable recap or meal plan; Home never rolls dice, advances combat, starts narration or shares an invitation code.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `campaigns-active` — Active campaigns | `active` in the SELECT below |
| `campaigns-archived` — Archived campaigns | `archived` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `dnd-table`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE status='active')::text AS active,count(*) FILTER(WHERE status='archived')::text AS archived FROM dnd_campaigns WHERE (owner_sub = $1 OR $1=ANY(member_subs)) AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT c.name,c.status,c.updated_at,a.content FROM dnd_campaigns c LEFT JOIN LATERAL (SELECT left(a.content,1300) AS content FROM dnd_archive a WHERE a.campaign_id=c.campaign_id AND a.owner_sub=c.owner_sub AND a.created_at<=$2 ORDER BY a.seq DESC LIMIT 1) a ON true WHERE (c.owner_sub = $1 OR $1=ANY(c.member_subs)) AND c.created_at<=$2 AND c.updated_at<=$2 ORDER BY c.updated_at DESC,c.campaign_id LIMIT 3
```
