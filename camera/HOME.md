# camera on Home

Your recorded camera commands, including rejected attempts. Simulation and hardware commands share this audit log; it cannot establish physical success. Prepare a diagnostic brief from selected metadata without transferring captures or issuing commands.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `commands-24h` — Commands logged / 24h | `day` in the SELECT below |
| `commands-5d` — Commands logged / 5d | `five` in the SELECT below |
| `rejected-5d` — Rejected commands / 5d | `rejected` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `camera-ops`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE created_at>$2::timestamptz-interval '24 hours')::text AS day,count(*)::text AS five,count(*) FILTER(WHERE outcome='rejected')::text AS rejected FROM camera_command_log WHERE user_sub = $1 AND created_at<=$2 AND created_at>$2::timestamptz-interval '120 hours'
```

```sql
SELECT camera_id,op,outcome,created_at FROM camera_command_log WHERE user_sub = $1 AND created_at<=$2 ORDER BY created_at DESC,log_id LIMIT 3
```
