# spaces on Home

Caller-owned reconstruction queue and saved artifacts. Imported/edge captures and simulated scenes have separate ready counts. Home reads metadata only; it never starts reconstruction, a scan mission, or retrieves raw model files.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `scans-active` — Scans in progress | `active` in the SELECT below |
| `scans-failed` — Failed scans | `failed` in the SELECT below |
| `scans-ready` — Ready imports / captures | `ready` in the SELECT below |
| `sim-ready` — Ready simulations | `simulated` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `spaces-viewer`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*) FILTER(WHERE status IN ('queued','reconstructing'))::text AS active,count(*) FILTER(WHERE status='failed')::text AS failed,count(*) FILTER(WHERE status='ready' AND (provider='sim' OR source_kind='sim-mission'))::text AS simulated,count(*) FILTER(WHERE status='ready' AND provider IN ('edge','import') AND source_kind<>'sim-mission')::text AS ready FROM spatial_scans WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT title,status,source_kind,provider,gaussian_count,updated_at FROM spatial_scans WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY updated_at DESC,id LIMIT 3
```
