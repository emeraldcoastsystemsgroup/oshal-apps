# pumpkin on Home

Shows caller-saved custom looks and dialogue, with pinned lines first. No current projector liveness is claimed from saved settings. Selected dialogue can prepare a Vids clip draft; Home does not speak, animate, record audio or trigger the physical prop.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `saved-looks` — Saved custom looks | `presets` in the SELECT below |
| `saved-lines` — Saved response lines | `lines` in the SELECT below |
| `pinned-lines` — Pinned response lines | `pinned` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `pumpkin-control`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS presets FROM pumpkin_presets WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT count(*)::text AS lines,count(*) FILTER(WHERE pinned)::text AS pinned FROM pumpkin_responses WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2
```

```sql
SELECT say,expression,source,updated_at FROM pumpkin_responses WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2 ORDER BY pinned DESC,updated_at DESC,id LIMIT 3
```
