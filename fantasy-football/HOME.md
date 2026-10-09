# fantasy-football on Home

Shows the caller's own linked fantasy leagues and the grading state of the start/sit calls registered for their team. Opening Home never reads ESPN, refreshes a projection, changes a lineup or submits a claim.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `fantasy-leagues` — Linked fantasy leagues | `leagues` in the SELECT below |
| `calls-ungraded` — Ungraded start/sit calls | `pending` in the SELECT below |
| `graded-5d` — Start/sit calls graded/5d | `graded` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Both tables are under forced exact-owner row-level security with no operator arm, so a Home shell can only ever show a person their own team. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `fantasy-football`.

```sql
SELECT count(*)::text AS leagues FROM ff_leagues WHERE user_sub = $1 AND linked_at<=$2
```

```sql
SELECT count(*) FILTER(WHERE settled=false)::text AS pending,count(*) FILTER(WHERE settled=true AND graded_at<=$2 AND graded_at>$2::timestamptz-interval '120 hours')::text AS graded FROM ff_calls WHERE user_sub = $1 AND created_at<=$2
```
