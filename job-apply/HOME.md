# job-apply on Home

Uses the authoritative Apply V2 ledger, not workflow completion. Verified counts are distinct posting IDs in each rolling completion window with retained confirmation path/hash; no private path is exposed. Active, failed/unknown and manually marked runs remain separate. Review in Career or prepare a follow-up document; Home never retries a submission.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `runs-active` — Submission runs active | `active` in the SELECT below |
| `runs-review` — Failed / unknown runs | `review` in the SELECT below |
| `manual-marks` — Manually marked runs | `manual` in the SELECT below |
| `verified-24h` — Verified submissions/24h | `day` in the SELECT below |
| `verified-5d` — Verified submissions/5d | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `job-apply-review`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE state IN ('claimed','queued_to_worker','acknowledged','running'))::text AS active,count(*) FILTER(WHERE state IN ('failed','unknown_outcome'))::text AS review,count(*) FILTER(WHERE state='manual_mark')::text AS manual FROM apply_runs WHERE owner_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT count(DISTINCT posting_id) FILTER(WHERE finished_at>$2::timestamptz-interval '24 hours')::text AS day,count(DISTINCT posting_id)::text AS five FROM apply_runs WHERE owner_sub = $1 AND state='submitted_verified' AND confirmation_path IS NOT NULL AND confirmation_sha256 IS NOT NULL AND finished_at<=$2 AND finished_at>$2::timestamptz-interval '120 hours'
```

```sql
SELECT r.posting_id,r.state,r.updated_at,p.title,c.name AS company FROM apply_runs r LEFT JOIN career_postings p ON p.id=r.posting_id LEFT JOIN career_companies c ON c.id=p.company_id WHERE r.owner_sub = $1 AND r.created_at<=$2 AND r.updated_at<=$2 ORDER BY (r.state IN ('failed','unknown_outcome')) DESC,r.updated_at DESC,r.run_id LIMIT 3
```
