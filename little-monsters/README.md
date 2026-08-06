# Little Monsters — an oshal app package

Voice-first ADHD study companion for K‑12 students: record lectures, auto-generate
flashcards and quizzes, and chat with a Socratic tutor grounded in each class's
approved materials and the student's own private uploads via RAG.

Current store release: **1.0.9 (`ready`)**. Private dashboards and roster
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
| `ui/education.css` | Shared CSS for the app's surfaces. |
| `routes/` | 36 compiled-JS Express route modules, mounted in-process at activation. **Produced by the build — see [BUILD.md](BUILD.md).** |
| `tools/` | 36 bundled surfaces, helper scripts, visual assets, and tool modules. |
| `tests/` | Playwright browser/e2e coverage and eight dependency-free security suites (68 tests). |

## Dependencies

Little Monsters declares the platform capabilities it consumes under `uses` (RAG,
presentation generation, voice, storage, and tool-registry/model access). It has **no app
dependency**: the Presentations tab is this package's lecture picker and uses the kernel
`deck-generation` skill, so `dependencies.apps` is empty and installation does not require the
separately packaged AI Office surface.

## Theme

The package bundles its education CSS and declares `theme: little-monsters`. Package-contributed
theme registration remains framework work, so an installation currently renders within the
operator's registered cockpit theme while still loading the bundled shared education CSS.

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

## Security boundaries in 1.0.9

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

It runs all eight `tests/*.test.cjs` suites (68 tests): issuer binding,
dashboard/roster/tutor authorization, lecture artifact containment, study-set ownership,
calendar/notification/material and authoritative-progress controls, documentation contracts,
immutable roster audit, plus final-SQL/transaction TOCTOU guards. Store CI separately mounts the
compiled manifest entrypoint against disposable PostgreSQL under a least-privilege application role.
