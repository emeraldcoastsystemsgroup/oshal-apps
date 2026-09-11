# print-ingest on Home

Counts saved, deduplicated owner intake records. Fully ingested and partially ingested stay distinct; receipt is not filing. Explicit document preparation transfers a bounded text excerpt into Office without approving any knowledge-base destinations.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `intake-review` — Awaiting filing approval | `review` in the SELECT below |
| `intake-needs-attention` — Failed / partial filing | `failed` in the SELECT below |
| `intake-5d` — Received / 5 days | `five` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `print-ingest`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER (WHERE state='awaiting_approval')::text AS review, count(*) FILTER (WHERE state IN ('failed','partially_ingested'))::text AS failed, count(*) FILTER (WHERE created_at > $2::timestamptz - interval '120 hours')::text AS five FROM print_intake WHERE owner_sub = $1 AND created_at <= $2 AND (decided_at IS NULL OR decided_at <= $2)
```

```sql
SELECT title, state, text_chars, left(text_body,1400) AS excerpt, created_at FROM print_intake WHERE owner_sub = $1 AND created_at <= $2 AND (decided_at IS NULL OR decided_at <= $2) ORDER BY (state IN ('awaiting_approval','failed','partially_ingested')) DESC, created_at DESC, intake_id LIMIT 3
```
