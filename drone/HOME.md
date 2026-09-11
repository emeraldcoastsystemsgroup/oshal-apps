# drone on Home

Saved mission drafts and recorded execution starts. The source writes flown immediately after startMission, so Home calls this execution starts, never completed flights. Diagnostic handoff carries plan name and recorded state only; flight approval stays in Drone Ops.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `draft-missions` — Mission drafts | `drafts` in the SELECT below |
| `started-5d` — Execution starts / 5d | `started` in the SELECT below |
| `rejected-5d` — Rejected commands / 5d | `rejected` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `drone-ops`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE status='draft')::text AS drafts,count(*) FILTER(WHERE status='flown' AND last_flown_at<=$2 AND last_flown_at>$2::timestamptz-interval '120 hours')::text AS started FROM drone_missions WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT count(*) FILTER(WHERE outcome='rejected')::text AS rejected FROM drone_command_log WHERE user_sub = $1 AND created_at<=$2 AND created_at>$2::timestamptz-interval '120 hours'
```

```sql
SELECT name,status,source,updated_at,last_flown_at FROM drone_missions WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY updated_at DESC,mission_id LIMIT 3
```
