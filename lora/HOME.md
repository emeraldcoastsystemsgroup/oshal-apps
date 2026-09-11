# lora on Home

Character ownership also scopes model and score rows. The latest registered model and its matching evaluation remain separate from the active version. No GPU dispatch or model promotion runs on Home; prepare a model card from recorded evidence.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `characters` — Saved characters | `characters` in the SELECT below |
| `training-active` — Queued / training | `active` in the SELECT below |
| `training-failed` — Failed versions | `failed` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `lora-studio`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS characters FROM oshal_lora_characters WHERE owner_sub = $1 AND created_at <= $2
```

```sql
SELECT count(*) FILTER (WHERE m.status IN ('queued','training'))::text AS active, count(*) FILTER (WHERE m.status='failed')::text AS failed FROM oshal_lora_models m JOIN oshal_lora_characters c ON c.id=m.character_id WHERE c.owner_sub = $1 AND c.created_at <= $2 AND m.created_at <= $2
```

```sql
SELECT c.display_name, c.active_version, m.version, m.status, m.created_at, s.overall::text, s.created_at AS evaluated_at FROM oshal_lora_characters c LEFT JOIN LATERAL (SELECT version, status, created_at FROM oshal_lora_models m WHERE m.character_id=c.id AND m.created_at <= $2 ORDER BY version DESC LIMIT 1) m ON true LEFT JOIN oshal_lora_scores s ON s.character_id=c.id AND s.version=m.version AND s.created_at <= $2 WHERE c.owner_sub = $1 AND c.created_at <= $2 ORDER BY c.created_at DESC, c.id LIMIT 3
```
