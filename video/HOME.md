# video on Home

Series and episode states are saved pipeline evidence. Saved video rows count completed saves, not current remote file availability. Script review stays explicit; preparing a continuation never starts rendering.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `scripts-review` — Scripts needing approval | `review` in the SELECT below |
| `series-active` — Series in progress | `active` in the SELECT below |
| `series-failed` — Failed series | `failed` in the SELECT below |
| `videos-saved-5d` — Videos saved / 5 days | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `video-studio`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE status='awaiting_approval')::text AS review, count(*) FILTER (WHERE status IN ('scripting','rendering','assembling'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed FROM video_series WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT count(*)::text AS five FROM oshal_videos WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours'
```

```sql
SELECT s.title, s.premise, s.status, s.updated_at, (SELECT count(*) FROM video_episodes e WHERE e.series_id=s.series_id AND e.user_sub = $1 AND e.status='assembled' AND e.created_at <= $2 AND e.updated_at <= $2)::text AS assembled FROM video_series s WHERE s.user_sub = $1 AND s.created_at <= $2 AND s.updated_at <= $2 ORDER BY (s.status IN ('awaiting_approval','failed')) DESC, s.updated_at DESC, s.series_id LIMIT 3
```
