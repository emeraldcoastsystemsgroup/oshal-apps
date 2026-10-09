# Little Monsters — an oshal app package

Voice-first ADHD study companion for K‑12 students: record lectures, auto-generate
flashcards and quizzes, and chat with a Socratic tutor grounded in each class's
approved materials and the student's own private uploads via RAG.

Package version: **1.4.8**. Named student/teacher/admin structural roles and the test
catalog are included; installed migration and live acceptance are separate release steps.
1.3.3 reads the OIDC issuer from the verified `req.oidc.idTokenClaims` before the filtered
`req.oidc.user` view (express-openid-connect strips `iss` from `user` by default), which
1.3.2 did not: on a live box every real browser session failed 401 while the mock-OIDC suites
stayed green. Both identity readers now share one exported `resolveSessionIssuer`.
Private dashboards and roster
management enforce student/teacher/tenant-admin boundaries. Identity is bound to
the verified OIDC `(iss, sub)` pair, and the release gate mounts the compiled
runtime bytes against disposable PostgreSQL for two-school positive and negative cases.

This is an **oshal app package** ([ADR-085](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/085-remote-app-packages-and-registries.md)) —
a self-contained folder installed from git into a swarm and hot-loaded, with **nothing
compiled into the core image**. It was the first app carved out of the oshal monolith to
prove the format.

## What's in the package

| Path | What it is |
|---|---|
| `oshal-app.yaml` | The manifest — bots, toolbar/UI, 17 migrations, workflow, theme, settings, kernel skills, and app dependencies. Every path inside is package-relative. |
| `personas/` | The 6 education bots + the shared `education-foundation` persona. |
| `migrations/` | The app's 17 install migrations (`019`–`021`, `024`–`037`) plus explicit opt-in teardown, applied idempotently on activation. |
| `ui/education.css`, `ui/little-monsters.css` | The design-system stylesheet the manifest declares as `sharedCss` (a copy of `tools/education.css`) and the package skin the cockpit wears while the app is focused. |
| `routes/` | 40 compiled-JS modules, including route factories and authorization helpers. **Produced by the build — see [BUILD.md](BUILD.md).** |
| `tools/` | The surfaces (19 pages and 6 mini-games), the design system (`education.css`), the page frame (`lm-mascot.js`), the mascot and read-aloud helpers, visual assets, and legacy tool modules. |
| `tests/` | Fourteen dependency-free `node:test` suites (126 tests: security, documentation, the class-material import outcomes, the page-frame contract and the surface presentation contract), the core-backed structural-role suite, and registered legacy browser/Vitest suites with explicit pending prerequisites. |
| `authorization.yaml` | Imported structural roles and explicit HTTP, bot and artifact-destination (Tutor, File into a class) permission bindings; existing school record checks remain authoritative. |

## Dependencies

Little Monsters declares the platform capabilities it consumes under `uses` (RAG,
presentation generation, voice, storage, and tool-registry/model access). Its complete
learning workspace now also requires **AI Office (`presentations`)** and **Circuit Lab**.
The local Presentations tab still uses the kernel deck-generation engine; this product
bundle also supplies the full document/spreadsheet/presentation editor and the study-plan
handoff, so users receive the integrated tools they need.

Choose one native **Student**, **Teacher** or **School administrator** application role in
Access. The manifest’s `authorization.roleTemplates` includes that exact Little Monsters
role plus the package-scoped Office and Circuit Lab compatibility roles in one atomic,
reviewed assignment. There are no component-selection checkboxes. A missing required app
or exact role blocks the entire bundle. Both connector allow-lists remain explicitly empty
so the child-facing ribbon does not expose the general connector catalog.

This requires a core that supports native application composites (`experience-roles`).
The role catalog, routes and migrations are unchanged; the new composite needs a fresh
review before it broadens an existing user’s assignments. Existing direct LM roles do not
silently acquire the new components. School identity, teacher roster, class enrollment,
provider/voice configuration and personally connected accounts are still established by
their normal setup flows. No application bundle grants portal/swarm administration.

## Look and feel

Every surface loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` +
`/shared/ui/js/surface-theme.js` with the classroom skin as its standalone default), then the
package design system (`tools/education.css`: every color is an alias of a framework theme token,
so the operator's chosen skin reaches the page in every host) and the page frame
(`tools/lm-mascot.js`). Hosted in the cockpit or in the classroom experience, the host owns
navigation and the frame relays the app's navigation requests to it; opened on its own, the frame
draws a top bar from the caller's ribbon profile. The manifest declares `theme: little-monsters`
(`ui/little-monsters.css`, the same playful classroom palette), which the framework serves at
`/api/swarm/apps/little-monsters/theme.css`; whether a cockpit applies it while the app is focused is
framework behaviour (the 2026-09-27 dev box did not), and the pages never depend on it.
Home renders a learner view or a teacher view from the caller's real role; actions the server only
accepts from teachers or admins (recording, transcript processing, flashcard generation, class
management) are offered only to them. `tests/lm-surface-conventions.test.cjs` holds every page to
this contract.

## Install

An authenticated operator installs the catalog-pinned package through the current remote-app
rail:

```http
POST /api/swarm/apps/install-remote
Content-Type: application/json

{ "name": "little-monsters" }
```

The equivalent package helper is run inside the local controller so its workspace environment
targets the shared `deployed-apps/` volume:

```bash
docker compose -f docker-compose.oshal-local.yml exec oshal-api \
  node scripts/oshal-app.js install little-monsters
```

For local package development, rebuild the committed `routes/*.js` artifact from the oshal core
checkout, then validate and run the package contracts before installing a committed store ref:

```bash
node scripts/oshal-app.js build C:/Projects/oshal-apps/little-monsters --framework .
node scripts/oshal-app.js validate C:/Projects/oshal-apps/little-monsters
node --test "C:/Projects/oshal-apps/little-monsters/tests/*.test.cjs"
```

See [BUILD.md](BUILD.md) for the artifact contract and [the local runbook](docs/runbook.md) for
the restart and port-35457 verification sequence.

## Security boundaries

The package now declares named **student**, **teacher** and **admin** structural roles for
Access Administration. These open functions while existing issuer-bound roster, school,
enrollment and ownership checks continue to restrict every record. Installing a catalog never
grants a role or changes a student's school role. See [roles and record access](docs/authorization.md)
for the adoption boundary, exact test registration and pending live acceptance work.

- OIDC accounts resolve by exact issuer plus subject. Email can claim only an unbound,
  same-tenant roster placeholder (or a one-time same-tenant legacy row) under transaction locks.
- Class, roster, dashboard, lecture, material, assignment, calendar, notification, study, tutor,
  and analytics access is tenant- and current-relationship scoped. High-risk mutations revalidate
  role/ownership/enrollment in final SQL and lock multi-row authorization graphs.
- Roster provisioning, enrollment, and removal append database-timestamped actor/student/class/action
  facts in the same transaction as the mutation. Migration 037 rejects audit update, delete, and
  truncate operations. The enforced live proof grants its disposable application role only
  append-only audit privileges and verifies that the database owner is still trigger-blocked.
- Each successfully grounded material uses an exact RAG collection. Private/requested/denied
  material grounds only its uploader; classmates can retrieve it only while its database state is
  `approved`. Share and delete decisions lock the live actor/class/material boundary. Deletion
  removes the exact collection, when present, and contained file before its SQL pointer; an
  external cleanup failure aborts the row deletion so an operator can retry safely.
- Material uploads are capped at 10 MiB each and 50 MiB per authenticated student in a rolling
  24-hour window. Server-side locks serialize concurrent quota checks.
- Images and PDFs sent from the cockpit can use **File into a class**. The dashboard shows only
  classes the caller may access, redeems the owner-bound handoff on the server, and records the
  material through the normal lifecycle: a teacher/admin upload is approved immediately while a
  student upload remains a teacher-review request. The existing Tutor destination remains the
  context-free attachment path.
- Generated quizzes return no answer key. The server stores a 30-minute, tenant-bound attempt,
  grades submitted answer indexes once, and deduplicates the resulting XP.
- Google Calendar status/push/pull endpoints authenticate and then return HTTP 410 with
  `TENANT_CALENDAR_CREDENTIALS_REQUIRED` until OAuth credentials are tenant-bound.

## Authorization release gate

The dependency-free package security gate runs in store CI after generated runtime bytes are
committed:

```bash
node --test "tests/*.test.cjs"
```

It runs all fourteen `tests/*.test.cjs` suites (126 tests; set `OSHAL_ROOT` to a core checkout for the TypeScript-backed guard): issuer binding,
dashboard/roster/tutor authorization, lecture artifact containment, study-set ownership,
calendar/notification/material and authoritative-progress controls, documentation contracts,
immutable roster audit, final-SQL/transaction TOCTOU guards, the page-frame contract, the presentation contract every surface follows, and the per-caller tool visibility answer. Store CI separately mounts the
compiled manifest entrypoint against disposable PostgreSQL under a least-privilege application role.

Little Monsters 1.4.0 is the full UX release: one design system (`tools/education.css`) and page frame (`tools/lm-mascot.js`) across every surface and mini-game, the shared theme bootstrap with the classroom skin as the standalone default, a Home that renders a learner view or a teacher view from the caller's real role, plain Home and Voice labels, the frame's asset route and its authorization bindings, and the package skin aligned with the classroom palette. No route, schema, data or permission semantics changed; `tests/lm-frame.test.cjs` and `tests/lm-surface-conventions.test.cjs` guard the frame contract and the presentation contract. 1.4.1 carries the page frame inside the already-bound mascot script (`/api/education/mascot.js`) instead of a new route, because a changed authorization catalog is refused with `authorization_catalog_migration_required` until an operator migrates the installed assignments; the catalog is therefore unchanged from 1.3.x

1.4.2 tried to change the authorization catalog (binding `POST /import-artifact`, the `class-material` artifact action and a new `GET /tool-keys`) and could not be activated on the dev box: a changed catalog needs the assignment migration in docs/authorization.md, and this build wires no approval verifier, so the operator's own `admin` assignment (a sensitive self-change) cannot be revoked and re-applied by anyone. 1.4.3 therefore keeps `authorization.yaml` at the bytes installations were granted under and ships what needs no catalog change: the per-caller visibility answer on the already-bound `GET /class-tool-keys` (static surfaces by school role plus accessible classes; the manifest rule uses `pattern: lm-*`, so with core #839 learners are not offered the teacher-only Teacher and Record tabs in any rail), and `lm_rewards` as migration 038. **Still waiting for an operator-run catalog migration:** the "File into a class" hand-off (`POST /import-artifact`) is refused as `authorization_operation_unbound` until its binding can be activated..

1.4.4 binds the "File into a class" hand-off: `POST /import-artifact` and the `class-material` artifact action, both requiring `material.create` and `material.share`, because every import files a material and asks to share it (approved at once for the class teacher or an admin, a teacher-review request for an enrolled student). `tests/lm-artifact-import-behavior.test.cjs` drives the compiled receiver over loopback HTTP for those outcomes and for the write-free refusals; `tests/authorization/catalog.test.cjs` proves the bindings through the real core policy and HTTP guard. **Installing 1.4.4 moves the catalog revision:** where assignments already exist, run the migration in docs/authorization.md first. When 1.4.2 made the same change on 2026-09-27 the dev box could not complete that migration for the operator's own sensitive `admin` assignment (store #282), so keep the installed 1.4.3 until the migration can run.

1.4.5 adds the enterprise-authorization pilot suites. They cover directory-group grants and the delegated-AI execution guard, record rights on a disposable PostgreSQL through the compiled routes, and permission-aware pages in Chromium. All are registered in AI Test Lab as isolated evidence; none is live acceptance. `authorization.yaml`, routes, pages and migrations are unchanged from 1.4.4, so installing 1.4.5 over 1.4.4 needs no new catalog migration. See [roles and record access](docs/authorization.md#enterprise-authorization-pilot-145-isolated-evidence).

1.4.6 fixes the "File into a class" import on an installed box. The route now hands its own request to core's `redeemArtifactViaRelay`, so the loopback redeem presents the caller's session or PAT. Core binds every Send-to handle to the verified principal (subject and issuer) and refuses the service rail, which carries no issuer, so 1.4.5 answered 404 "artifact handle not found" for a handle minted seconds earlier (the 2026-09-28 live-acceptance sweep). It needs a core that carries the request-carrying redeem; on an older core the import still answers 404. `authorization.yaml`, pages and migrations are unchanged, so installing it does not move the catalog revision.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| lecture-study-materials | lecture study pack | T2 | none | disable | not yet measured | none recorded |
| lecture-recording-pipeline | lecture recording ticket | T4 | none | disable | not yet measured | none recorded |
| study-set-generation | flashcard set or quiz | T2 | none | disable | not yet measured | none recorded |
| tutoring-turn | tutoring turn | T3 | hosted | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->

### Native shared-school storage

`storage/relationships.json` declares the trusted relationship policy for authoritative school rows. The native operator installs and validates that policy and its schemas in tenant metadata before native shared-school use; app data cannot authorize itself. Migrated deployments reconcile existing issuer/subject bindings and school membership before installation. Person-only projections are retired so teacher edits and enrollments use the same records. New user provisioning is an explicit write, and classroom dependency permissions remain in `oshal-app.yaml`.
