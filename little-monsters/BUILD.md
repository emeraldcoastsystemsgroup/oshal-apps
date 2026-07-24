# Little Monsters — build & carve-out state (ADR-085 P2)

**The carve-out happened (2026-07-10).** Little Monsters was fully removed from the OSHAL
core (`open-shal` commits `8481a864`…`091ba920`, tag `appstore-v0.3.0`) and this package is
now its ONLY home. What's here is the complete app:

| Path | State |
|---|---|
| `oshal-app.yaml` | Complete manifest (bots, UI, routes, 10 migrations, workflow, theme, settings, `dependencies: [presentations]`). |
| `personas/` | The 6 bots + `education-foundation`. |
| `routes/*.js` | **COMPILED IN** — the 11 education route modules, compiled from `src-routes/` with `@/` framework imports preserved (resolved at runtime by the loader's alias registration). Core-relative requires were rewritten to `@/app/routes/...`. |
| `src-routes/*.ts` | The TypeScript sources (the developer-readable source of truth). |
| `tools/` | The 42 education tool + HTML surface files. |
| `migrations/` | The 10 owned migrations (019–030) + `uninstall.sql` (explicit opt-in teardown). |
| `ui/` | `education.css` (sharedCss), `little-monsters.css` (the cockpit skin), `lm-concierge.js` (the floating concierge). |
| `docs/` | install / user guide / runbook / support / school-deployment / ship-review. |
| `tests/` | The app's Playwright + vitest specs (run against a swarm with LM installed). |

## Rebuilding `routes/*.js` after editing `src-routes/`

One command (from an OSHAL checkout):

```bash
node scripts/oshal-app.js build <this dir> --framework .
```

It copies the sources in transiently (collision-guarded), compiles with plain tsc (@/ preserved),
harvests, verifies self-containment + factories, and cleans up. 12 modules, proven live 2026-07-10.

## Known integration gaps (framework work, tracked in ADR-085)

- **Migration runner: BUILT + live-proven 2026-07-10** — the loader applies this package's 10
  migrations in order at activation (flag `APP_PACKAGE_MIGRATIONS`), tracked in
  `app_package_migrations`, idempotent across restarts.
- **Per-class icon privacy:** the core's generic `/api/tools/dynamic` no longer scopes
  `lm-class-*` icons to the caller's enrollment (that filter was LM-specific and left with
  the carve-out). Until the generic manifest-declared visibility hook exists, per-class icons
  are visible to any signed-in user of the app.
- **Cockpit skin:** `theme: little-monsters` refers to a skin the core no longer registers;
  the bundled `ui/little-monsters.css` ships here, but package-contributed theme registration
  is framework roadmap. Until then the app renders in the operator's theme.
- **Jarvis catalog:** the LM handoff entry was removed from the hardcoded roster; installed
  apps are discovered from `swarm_applications`, so LM reappears there once installed.
- **presentations dependency: RESOLVED at install** — `oshal-app install little-monsters`
  resolves `dependencies.apps` (found `presentations` as a core app; would install a missing
  dep from the store recursively, fail-closed) and records it in `.oshal-install.json`.
