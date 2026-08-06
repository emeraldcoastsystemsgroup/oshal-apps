# Little Monsters — build and package state (ADR-085)

**Historical carve record (2026-07-10; superseded deployment note 2026-08-05).** Little Monsters
was removed from the then-private core in commits `8481a864`…`091ba920` (tag
`appstore-v0.3.0`), and this package became its canonical source. Current installations consume
this package's `oshal-app.yaml` through `scripts/oshal-app.js`; they do not restore the former
kernel-resident manifest. What's here is the complete app:

| Path | State |
|---|---|
| `oshal-app.yaml` | Complete manifest (bots, UI, routes, 17 migrations, workflow, theme, settings, and kernel-skill declarations; no app dependency). |
| `personas/` | The 6 bots + `education-foundation`. |
| `routes/*.js` | **COMPILED IN** — 36 education route modules, compiled from the 36 files in `src-routes/` with `@/` framework imports preserved (resolved at runtime by the loader's alias registration). Core-relative requires were rewritten to `@/app/routes/...`. |
| `src-routes/*.ts` | The TypeScript sources (the developer-readable source of truth). |
| `tools/` | 36 bundled student/teacher surfaces, helper scripts, visual assets, and tool modules (including 20 HTML surfaces). |
| `migrations/` | The 17 install migrations (019–021 and 024–037; 022–023 are historical gaps) + `uninstall.sql` (explicit opt-in teardown). |
| `ui/` | `education.css` (manifest `sharedCss`) and `little-monsters.css` (the requested cockpit skin). The floating tutor is declarative `ui.assistant`; the package ships no cockpit-origin assistant script. |
| `docs/` | install / user guide / runbook / support / school-deployment / ship-review. |
| `tests/` | Package-local Playwright browser/e2e specs plus dependency-free `node:test` security suites over compiled and source authorization boundaries. |

## Rebuilding `routes/*.js` after editing `src-routes/`

One command (from an oshal core checkout):

```bash
node scripts/oshal-app.js build C:\Projects\oshal-apps\little-monsters --framework .
```

It copies the sources in transiently (collision-guarded), compiles with plain tsc (@/ preserved),
harvests, verifies self-containment + factories, and cleans up. The 36-module artifact was
release-validated on 2026-08-06, followed by all 68 dependency-free package security tests.
The required store CI gate separately runs the mounted two-tenant PostgreSQL authorization proof.

## Known integration gaps (framework work, tracked in ADR-085)

- **Migration runner: BUILT + live-proven 2026-07-10** — the loader applies this package's 17
  migrations in order at activation (flag `APP_PACKAGE_MIGRATIONS`), tracked in
  `app_package_migrations`, idempotent across restarts.
- **Per-class icon privacy: RESOLVED** — the manifest's dynamic UI declaration points the
  generic visibility hook at `/api/education/class-tool-keys`; that endpoint returns only the
  authenticated caller's tenant-bound accessible class keys and fails closed to an empty list.
- **Cockpit skin:** `theme: little-monsters` refers to a skin the core no longer registers;
  the bundled `ui/little-monsters.css` ships here, but package-contributed theme registration
  is framework roadmap. Until then the app renders in the operator's theme.
- **Jarvis catalog:** the LM handoff entry was removed from the hardcoded roster; installed
  apps are discovered from `swarm_applications`, so LM reappears there once installed.
- **Presentation capability: RESOLVED through kernel skills** — presentation generation is
  declared under `uses`, and the ribbon opens this package's `/api/education/presentation`
  lecture picker. `dependencies.apps` is intentionally empty, so installation does not pull the
  separately packaged AI Office surface for a capability already supplied by the kernel.
- **Google Calendar bridge: FAILS CLOSED** — authenticated status/push/pull calls return HTTP 410
  with `TENANT_CALENDAR_CREDENTIALS_REQUIRED`. Re-enable only after credentials and remote
  calendar identifiers are stored and resolved per tenant; controller-wide OAuth profiles must
  never be reused for a school's calendar.
