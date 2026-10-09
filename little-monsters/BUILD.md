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
| `routes/*.js` | **COMPILED IN** — 40 modules compiled from `src-routes/`, including structural authorization adapters, with `@/` framework imports preserved (resolved at runtime by the loader's alias registration). Core-relative requires were rewritten to `@/app/routes/...`. |
| `src-routes/*.ts` | The TypeScript sources (the developer-readable source of truth). |
| `tools/` | The 19 student/teacher surfaces and 6 mini-games, the design system (`education.css`), the page frame (`lm-mascot.js`), mascot and read-aloud helpers, visual assets, and legacy tool modules. |
| `migrations/` | The 17 install migrations (019–021 and 024–037; 022–023 are historical gaps) + `uninstall.sql` (explicit opt-in teardown). |
| `ui/` | `education.css` (manifest `sharedCss`, a copy of the design system) and `little-monsters.css` (the package skin the cockpit wears while the app is focused; the classroom palette). The floating tutor is declarative `ui.assistant`; the package ships no cockpit-origin assistant script. |
| `docs/` | install / user guide / runbook / support / school-deployment / ship-review. |
| `tests/` | Package-local Playwright browser/e2e specs plus dependency-free `node:test` security suites over compiled and source authorization boundaries. |

## Rebuilding `routes/*.js` after editing `src-routes/`

One command (from an oshal core checkout):

```bash
node scripts/oshal-app.js build C:\Projects\oshal-apps\little-monsters --framework .
```

It copies the sources in transiently (collision-guarded), compiles with plain tsc (@/ preserved),
harvests, verifies self-containment + factories, and cleans up. The earlier 36-module artifact was
release-validated on 2026-08-06, followed by its then-current 68 dependency-free package security tests.
Version 1.4.4 contains 40 source modules and registers fourteen `node:test` suites (126 tests: the
compiled security suites, the class-material import outcomes, the page-frame and surface-presentation contracts and the tool-visibility answer) and the core-backed
structural-role suite in AI Test Lab. Rebuild before running the
compiled suites; source-only success is not deployed evidence. See [roles and record access](docs/authorization.md)
for the reviewed catalog-migration sequence and still-pending live acceptance.
The required store CI gate separately runs the mounted two-tenant PostgreSQL authorization proof.
Version 1.4.5 adds three framework-coupled suites under `tests/authorization/` (groups and delegation, PostgreSQL record rights, the permission-aware UI) and their shared two-school fixture. The suites are registered in AI Test Lab and are not part of the bare-checkout `tests/*.test.cjs` job. The source modules are unchanged, so there is nothing to rebuild.
Version 1.4.6 changes one source module, `education-materials-routes.ts` (the import-artifact redeem hands over its request), and its compiled twin, emitted with the framework tsconfig and checked identical to a transpile of the unchanged 1.4.5 source first.

## Known integration gaps (framework work, tracked in ADR-085)

- **Migration runner: BUILT + live-proven 2026-07-10** — the loader applies this package's 17
  migrations in order at activation (flag `APP_PACKAGE_MIGRATIONS`), tracked in
  `app_package_migrations`, idempotent across restarts.
- **Per-caller tool visibility: RESOLVED** — the manifest's visibility rule (`pattern: lm-*`) points the
  generic hook at `/api/education/class-tool-keys`, which now returns the static surfaces the caller's
  school role may see (learners never get the teacher-only Teacher and Record tabs) plus the caller's
  tenant-bound accessible class keys, and fails closed to an empty list. Since core PR #839 the same
  rule filters the static rail in the ribbon profile, so every host (cockpit, classroom experience,
  standalone top bar) shows the same admitted set. The route kept its name because a new binding
  changes the catalog revision, which cannot be activated where assignments already exist.
- **Class-material import: BOUND in 1.4.4, activation waits for the catalog migration** — `POST /import-artifact`
  and the `class-material` artifact action are bound (`material.create` + `material.share`). Binding them
  moves the catalog revision, so an installation with existing assignments must run the migration in
  docs/authorization.md before 1.4.4 activates. That migration needs a second management actor or an
  approval verifier for an operator's own sensitive assignment; the dev box had neither when 1.4.2 was
  refused on 2026-09-27 (store #282). Until the migration runs, the installed 1.4.3 keeps answering the
  hand-off with 403 `authorization_operation_unbound`.
- **Cockpit skin: served, not relied on.** The framework serves `ui/little-monsters.css` at `/api/swarm/apps/little-monsters/theme.css` (the ribbon profile carries `themeCssUrl`). Whether the cockpit applies it while the app is focused is framework behaviour: measured on the dev box on 2026-09-27, `/cockpit/?app=little-monsters` kept the operator's cockpit theme and injected no package stylesheet. The pages never depend on it: they follow whatever skin the host wears through the shared theme bootstrap, and wear the classroom skin on their own. The file is kept in the classroom palette so that, where a framework does apply it, the app still has one look.
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
