# youtube-kids on Home

Shows the latest caller-uploaded history snapshot and already-saved parent brief. Imported watch records are not recent screen time; brief age and import age are separate. Explicit gift planning shares a bounded saved brief with Shopping for review, never raw watch history, and does not buy anything or generate a new profile.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `saved-import` — Saved history import | `imports` in the SELECT below |
| `imported-records` — Imported watch records | `watched` in the SELECT below |
| `saved-brief` — Saved parent brief | `briefs` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `youtube-kids`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS imports,coalesce(max(total_watched),0)::text AS watched,count(*) FILTER(WHERE nullif(trim(brief),'') IS NOT NULL AND brief_at<=$2)::text AS briefs FROM oshal_youtube_activity WHERE user_sub = $1 AND uploaded_at<=$2
```

```sql
SELECT uploaded_at,brief_at,left(brief,1400) AS excerpt,total_watched FROM oshal_youtube_activity WHERE user_sub = $1 AND uploaded_at<=$2
```
