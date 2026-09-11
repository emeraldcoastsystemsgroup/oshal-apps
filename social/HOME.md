# social on Home

Caller-owned social-category inbox notifications, counted by received time after ingestion. They are not unread totals, a complete social feed, or posting analytics. Selected saved snippets continue into a reviewed Switchboard post or Office document. No live feed fetch, organization model call or publication happens on Home.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `notifications-24h` — Social notices / 24h | `day` in the SELECT below |
| `notifications-5d` — Social notices / 5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `social-signals`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE received_at>$2::timestamptz-interval '24 hours')::text AS day,count(*)::text AS five FROM oshal_inbox_messages WHERE user_sub = $1 AND category='social' AND received_at<=$2 AND ingested_at<=$2 AND received_at>$2::timestamptz-interval '120 hours'
```

```sql
SELECT subject,snippet,received_at,source FROM oshal_inbox_messages WHERE user_sub = $1 AND category='social' AND received_at<=$2 AND ingested_at<=$2 ORDER BY received_at DESC,msg_id LIMIT 3
```
