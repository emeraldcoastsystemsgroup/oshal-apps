# drone-relay on Home

Caller-owned relay-chain designs and their last simulated run. Home reads metadata only; it never
simulates, never builds an envelope, and never commands a vehicle.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `plans-total` — Relay chains | `total` in the first SELECT below |
| `plans-feasible` — Feasible plans | `feasible` in the first SELECT below |
| `plans-simulated` — Simulated | `simulated` in the first SELECT below |
| `plans-holding` — Held or restored | `holding` in the first SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No engine calls, schema bootstrap, AI generation, writes or retries run on Home. All
failed sources yield 503; individual failures retain available evidence and mark missing metrics
unavailable. Details open `drone-relay`; continuation actions use the existing optional versioned
integration receivers and leave drafts editable.

```sql
SELECT count(*)::text AS total, count(*) FILTER (WHERE (plan->>'feasible') = 'true')::text AS feasible, count(*) FILTER (WHERE last_sim IS NOT NULL)::text AS simulated, count(*) FILTER (WHERE (last_sim->'metrics'->>'verdict') IN ('held', 'restored'))::text AS holding FROM drone_relay_plan WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2
```

```sql
SELECT title, spec, plan, (last_sim->'metrics') AS last_metrics, updated_at FROM drone_relay_plan WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, plan_id LIMIT 3
```
