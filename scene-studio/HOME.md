# scene-studio on Home

Caller-owned Godot and Blender projects and their revisions. Home reads metadata only; it never
runs the engine, reads a project file, or contacts the engine container.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `projects-total` — Projects | `total` in the first SELECT below |
| `projects-godot` — Godot games | `godot` in the first SELECT below |
| `projects-blender` — Blender models | `blender` in the first SELECT below |
| `revisions-total` — Revisions | `revisions` (sum of current revision numbers) in the first SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query
timeout. No engine calls, schema bootstrap, AI generation, writes or retries run on Home. All
failed sources yield 503; individual failures retain available evidence and mark missing metrics
unavailable. Details open `scene-studio`.

```sql
SELECT count(*)::text AS total, count(*) FILTER (WHERE kind = 'godot')::text AS godot, count(*) FILTER (WHERE kind = 'blender')::text AS blender, coalesce(sum(revision), 0)::text AS revisions FROM scene_project WHERE owner_sub = $1 AND created_at <= $2
```

```sql
SELECT title, kind, revision, preview, last_run, updated_at FROM scene_project WHERE owner_sub = $1 AND created_at <= $2 ORDER BY updated_at DESC, project_id LIMIT 3
```
