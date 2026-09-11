# career-hunter on Home

Separates pending application approvals, recently updated personal scores, tracked application records and recorded interviews. Shared job-corpus size is not personal progress. Selected job title/company and score metadata can prepare an Office research brief or a reviewed Social networking draft. No application submission or public post is triggered.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `approval-review` — Application approvals | `review` in the SELECT below |
| `scored-24h` — Scores updated / 24h | `day` in the SELECT below |
| `scored-5d` — Scores updated / 5d | `five` in the SELECT below |
| `tracked-applications` — Tracked applications | `tracked` in the SELECT below |
| `interviews-5d` — Recorded interviews / 5d | `interviews` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `career-review`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE status='approval_required')::text AS review FROM career_hunter_applications WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT count(*) FILTER(WHERE scored_at>$2::timestamptz-interval '24 hours')::text AS day,count(*)::text AS five FROM career_user_job_scores WHERE user_sub = $1 AND scored_at<=$2 AND scored_at>$2::timestamptz-interval '120 hours'
```

```sql
SELECT count(*)::text AS tracked,count(*) FILTER(WHERE interview_at IS NOT NULL AND interview_at<=$2 AND interview_at>$2::timestamptz-interval '120 hours')::text AS interviews FROM career_user_applications WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT p.title,c.name AS company,s.fit_score,s.ai_fit_score,s.scored_at,s.ai_scored_at FROM career_user_job_scores s JOIN career_postings p ON p.id=s.posting_id JOIN career_companies c ON c.id=p.company_id WHERE s.user_sub = $1 AND s.scored_at<=$2 AND s.target_role=true ORDER BY s.scored_at DESC,s.posting_id LIMIT 3
```
