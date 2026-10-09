# sports-edge on Home

Shows the caller's followed teams and upcoming cached previews, which must match a followed team; preview time remains visible because schedules can change. Prepare a watch-party meal or trip discussion, without refreshing odds, placing bets or booking travel. Fantasy leagues moved to the Fantasy Football app (0.11.0), whose own Home card reports them.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `followed-teams` — Followed teams | `teams` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `sports-edge-home`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS teams FROM sports_followed_teams WHERE user_sub = $1 AND created_at<=$2
```

```sql
SELECT p.league,p.home_team,p.away_team,p.game_date,p.generated_at FROM sports_previews p WHERE p.generated_at<=$2 AND p.game_date>=$2 AND p.game_date<=$2::timestamptz+interval '7 days' AND EXISTS(SELECT 1 FROM sports_followed_teams f WHERE f.user_sub = $1 AND f.created_at<=$2 AND f.league=p.league AND f.team IN (p.home_team,p.away_team)) ORDER BY p.game_date,p.event_id LIMIT 3
```
