# game-show on Home

Counts caller-hosted rooms by persisted lobby/live/ended state; live does not mean a connected player. Ended rooms updated within five days is not a completion timestamp. Plan refreshments or a host brief without starting a game, changing scores or exposing join codes or camera frames.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `hosted-lobbies` — Hosted lobbies | `lobby` in the SELECT below |
| `hosted-live` — Hosted live sessions | `live` in the SELECT below |
| `ended-updated-5d` — Ended rooms updated/5d | `ended` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `game-show-stage`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE status='lobby')::text AS lobby,count(*) FILTER(WHERE status='live')::text AS live,count(*) FILTER(WHERE status='ended' AND updated_at>$2::timestamptz-interval '120 hours')::text AS ended FROM gameshow_rooms WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT name,show_id,status,updated_at FROM gameshow_rooms WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY updated_at DESC,room_id LIMIT 3
```
