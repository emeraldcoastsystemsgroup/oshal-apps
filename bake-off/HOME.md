# bake-off on Home

Benchmark jobs and runs are owner-scoped through their parent job, and each result must match the same owner. A missing or zero observed lane cost stays unknown, never free. The selected lane is only the best scored successful observation in that run, not a universal model recommendation. Prepare a comparison document without running a benchmark or changing providers.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `saved-benchmarks` — Saved benchmarks | `jobs` in the SELECT below |
| `runs-active` — Benchmarks running | `active` in the SELECT below |
| `runs-failed` — Failed benchmark runs | `failed` in the SELECT below |
| `completed-5d` — Runs completed / 5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `bake-off-home`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS jobs FROM bake_off_jobs WHERE owner_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT count(*) FILTER(WHERE r.status='running')::text AS active,count(*) FILTER(WHERE r.status='failed')::text AS failed,count(*) FILTER(WHERE r.status='complete' AND r.finished_at<=$2 AND r.finished_at>$2::timestamptz-interval '120 hours')::text AS five FROM bake_off_runs r JOIN bake_off_jobs j ON j.id=r.job_id AND j.owner_sub = $1 WHERE r.owner_sub = $1 AND r.started_at<=$2
```

```sql
SELECT j.name,r.status,r.started_at,r.lanes_requested,r.lanes_completed,x.observed_model,x.judge_score::text,x.judge_mode,x.cost_usd::text FROM bake_off_runs r JOIN bake_off_jobs j ON j.id=r.job_id AND j.owner_sub = $1 LEFT JOIN LATERAL (SELECT observed_model,judge_score,judge_mode,cost_usd FROM bake_off_results x WHERE x.run_id=r.id AND x.owner_sub = $1 AND x.created_at<=$2 AND x.ok=true ORDER BY x.judge_score DESC NULLS LAST,x.created_at DESC LIMIT 1) x ON true WHERE r.owner_sub = $1 AND r.started_at<=$2 ORDER BY r.started_at DESC,r.id LIMIT 3
```
