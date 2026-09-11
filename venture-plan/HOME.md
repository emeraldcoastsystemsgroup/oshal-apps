# venture-plan on Home

Venture counts are saved plans. Evidence count includes current model-estimate records. Model posture is saved at computation, not a freshness certification or a return forecast. Open the plan to validate its current assumptions.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `saved-ventures` â€” Saved ventures | `ventures` in the SELECT below |
| `estimated-assumptions` â€” Model estimates | `assumptions` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `venture-home`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS ventures FROM venture_ventures WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT count(*)::text AS assumptions FROM venture_assumptions a JOIN venture_ventures v ON v.id=a.venture_id AND v.owner_sub = $1 WHERE a.owner_sub = $1 AND a.created_at <= $2 AND a.superseded_by IS NULL AND a.source_kind = 'model-estimate'
```

```sql
SELECT v.name, v.idea_text, v.stage, v.updated_at, m.posture, m.can_publish, m.computed_at FROM venture_ventures v LEFT JOIN LATERAL (SELECT posture, can_publish, computed_at FROM venture_models m WHERE m.venture_id=v.id AND m.owner_sub = $1 AND m.scenario_id IS NULL AND m.computed_at <= $2 ORDER BY computed_at DESC, id LIMIT 1) m ON true WHERE v.owner_sub = $1 AND v.created_at <= $2 AND v.updated_at <= $2 ORDER BY v.updated_at DESC, v.id LIMIT 3
```
