# scan-to-print on Home

Caller-owned scan jobs, drawings and print submissions. Home reads metadata only; it never
reconstructs, reads a model file, or contacts a printer.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `jobs-total` — Objects scanned | `total` in the first SELECT below |
| `jobs-printable` — Printable models | `printable` in the first SELECT below |
| `jobs-failed` — Failed reconstructions | `failed` in the first SELECT below |
| `prints-week` — Sent to a printer (7 days) | `sent` in the third SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All
failed sources yield 503; individual failures retain available evidence and mark missing metrics
unavailable. Details open `scan-to-print`; continuation actions use the existing optional
versioned integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS total, count(*) FILTER (WHERE state = 'reconstructed')::text AS reconstructed, count(*) FILTER (WHERE state = 'reconstructed' AND (report->>'printable') = 'true')::text AS printable, count(*) FILTER (WHERE state = 'failed')::text AS failed FROM scan_print_job WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT title, state, source_kind, report, updated_at FROM scan_print_job WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, job_id LIMIT 3
```

```sql
SELECT count(*)::text AS sent FROM scan_print_submission WHERE owner_sub = $1 AND created_at <= $2 AND created_at > $2 - interval '7 days' AND state <> 'failed'
```
