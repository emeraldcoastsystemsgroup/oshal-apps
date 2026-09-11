# storage on Home

Shows explicitly saved target preferences. Automatic means the Files service chooses its configured fallback at use time. A saved target is not evidence of a live connection, a successful export or provider free space. Browse and export through the existing Files surface.

All metrics default on and remain individually configurable.

| Metric | Source column / period |
|---|---|
| `code-target` — Saved code target | `code_provider` in the SELECT below |
| `files-target` — Saved file target | `files_provider` in the SELECT below |

## Sources and access

Reads authenticate the session, bind its owner subject, and use SELECT only with an 1800 ms query timeout. Every child lookup also checks the parent owner. No provider calls, schema bootstrap, AI generation, writes or retries run on Home. All failed sources yield 503; individual failures retain available evidence and mark missing metrics unavailable. Details open `storage-settings`; continuation actions use the existing optional versioned integration receivers and leave drafts editable.

```sql
SELECT code_provider, files_provider, updated_at FROM oshal_storage_prefs WHERE user_sub = $1 AND updated_at <= $2
```
