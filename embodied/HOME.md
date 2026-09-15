# embodied on Home

Caller-owned physical tasks drafted and run against the simulated kitchen. Home reads task
metadata only; it never touches the world, a node, or the command authority.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `tasks-total` — Physical tasks drafted | `total` in the first SELECT below |
| `tasks-done` — Completed in simulation | `done` in the first SELECT below |
| `tasks-stopped` — Failed or aborted | `stopped` in the first SELECT below |
| `commands-refused` — Commands refused (7 days) | `refused` in the third SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All
failed sources yield 503; individual failures retain available evidence and mark missing metrics
unavailable. Details open `embodied`.

```sql
SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'done')::text AS done, count(*) FILTER (WHERE status IN ('failed', 'aborted'))::text AS stopped, count(*) FILTER (WHERE status = 'executing')::text AS executing FROM embodied_task WHERE owner_sub = $1 AND created_at <= $2
```

```sql
SELECT title, status, current_step, failure, updated_at FROM embodied_task WHERE owner_sub = $1 AND created_at <= $2 ORDER BY updated_at DESC, task_id LIMIT 3
```

```sql
SELECT count(*)::text AS refused FROM embodied_command_log WHERE owner_sub = $1 AND created_at <= $2 AND created_at > $2 - interval '7 days' AND outcome = 'refused'
```

Every item carries the reminder that the tasks ran in simulation, never on a real arm or drone.
