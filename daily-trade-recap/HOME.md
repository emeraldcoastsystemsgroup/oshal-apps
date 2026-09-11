# daily-trade-recap on Home

Counts exact-owner daily-trade-recap graph executions, with the latest same-owner recorded step. A completed workflow is not proof that an email arrived or a video was published. Review actions prepare a production handoff; Home never reruns the existing render/email pipeline.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `runs-active` — Recaps running | `active` in the SELECT below |
| `runs-review` — Recaps needing review | `review` in the SELECT below |
| `runs-failed` — Failed recap runs | `failed` in the SELECT below |
| `runs-completed-5d` — Runs completed / 5 days | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `recap-review`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE status='running')::text AS active, count(*) FILTER (WHERE status IN ('suspended','escalated'))::text AS review, count(*) FILTER (WHERE status='error')::text AS failed, count(*) FILTER (WHERE status='completed' AND finished_at > $2::timestamptz - interval '120 hours' AND finished_at <= $2)::text AS five FROM workflow_runs WHERE owner_sub = $1 AND ticket_type='daily-trade-recap' AND started_at <= $2 AND updated_at <= $2
```

```sql
SELECT r.workflow_name, r.status, r.started_at, r.finished_at, s.node_title, s.status AS step_status FROM workflow_runs r LEFT JOIN LATERAL (SELECT node_title, status FROM workflow_run_steps s WHERE s.run_id=r.run_id AND s.owner_sub = $1 AND s.created_at <= $2 ORDER BY seq DESC LIMIT 1) s ON true WHERE r.owner_sub = $1 AND r.ticket_type='daily-trade-recap' AND r.started_at <= $2 AND r.updated_at <= $2 ORDER BY r.started_at DESC, r.run_id LIMIT 3
```
