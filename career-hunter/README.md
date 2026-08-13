# Career Hunter — oshal app package

The job-hunting application carved out of the oshal kernel under ADR-085. Its TypeScript routes,
Node CLI wrapper, Python `jobhunter` engine, persona, migrations, and browser surfaces ship in this
package. The kernel supplies shared runtime capabilities and mounts the package; it does not own
Career Hunter domain code.

The workflow is: shared employer ATS scrape → per-user keyword match → AI scoring → title pass →
approval queue → apply-pipeline handoff. It also provides the morning digest, native board,
recruiters, strengthen, insights, approvals, settings, Resume Studio, Profile Studio, mobile swipe,
submissions, and the jobs knowledge graph.

Those surfaces reach the operator through a **sectioned ribbon**: Mobile leads ungrouped as the
pinned front door, then **Job Search** (Job Board, Submissions, Recruiters, Insights), **Resume**
(Strengthen, Resume Studio), and **Presence** (Profile Studio plus a cross-app tile into the
separate `portrait-studio` package). Approvals, Companies, and Career Settings stay in the
ungrouped bottom tray. The `group:` key that drives this, and the rules a cross-app tile has to
follow, are written up in
[docs/ribbon-groups-adr-085-addendum.md](docs/ribbon-groups-adr-085-addendum.md).

## Shape

- `oshal-app.yaml` declares the service-or-OIDC `/api/career-hunter` mount, OIDC graph mount,
  package bot, CLI tools, grouped ribbon surfaces, the `portrait-studio` app dependency,
  `career-application` workflow, migrations, and requested guest tier. Data routes still derive
  their subject from OIDC; only the admin refresh accepts a trusted service subject and then
  rechecks Career administration. `dependencies.connectors` is intentionally absent rather than
  `[]`: present means "the complete set of connectors my surfaces may offer", and this app
  reaches at least `anthropic`, `firecrawl`, `google`, and `twilio`, so an empty or partial list
  would silently strip working connectors off Career Settings and the digest.
- `src-routes/` contains small route-family registrars plus dependency leaves for user-store paths,
  brokered engine dispatch, process leases, transactional files, cron, feeds, scoring, studios,
  artifacts, job guide, graph, and onboarding. The canonical `oshal-app build` compiles every
  source module into `routes/`; package-relative imports must resolve inside that generated tree.
- `bin/oshal-jobhunter.js` and `engine/` are the package-owned CLI and Python domain engine.
  Mounted routes broker only the authenticated caller's provider credentials into finite
  asynchronous children; direct manifest tools enter the same user-store concurrency boundary.
- `tools/` contains the package surfaces and `career-hunter.css`, served from this package.
- `migrations/` contains the idempotent Career schema, RLS, corpus, compatibility-view, and
  interview-bank migrations.
- `tests/` contains Vitest and dependency-free `node --test` guards covering source and compiled
  runtime behavior, tenant paths, engine leases, bounded extraction, upload rollback, board
  planning, digest routing, graph ingestion, and resume preview behavior.
- `scripts/` contains graph and insights smoke checks.
- `docs/` contains the longer-form package notes, indexed by [docs/README.md](docs/README.md).

## Three board details that are not obvious from the code

**The feed is planned, not joined** (`career-board-feed`). Joining the full corpus to user signals
made the live multi-gigabyte corpus drag description text through the page cache even though the
board never renders it. The feed instead drives from `user_signals` through `idx_user_scored` in
sort-key order, bounds the candidate pool, and reaches the corpus only for that set. Signal-side
predicates remain inside the bounded pool. Keep predicates sargable (`p.target_role = 1`, not a
`COALESCE` wrapper), and do not add `p.description` to the board select. The supporting indexes and
`ANALYZE` setup live in `engine/jobhunter/db.py`; check `sqlite_stat1` first on a slow new install.

**There are two feeds, and the pre-resume one reads the corpus alone** (`career-browse-feed`).
`GET /jobs` answers "which of my scored matches", so it returns nothing for an account with no
signals database — which is every account before its first upload. `GET /browse` answers "what is
open at all" straight off the tenant corpus, and the board renders it in a score-free mode where
Apply becomes the resume-upload step. Its keyword search matches **titles only** and plans through
the covering `idx_corpus_browse (active, title)`; matching `p.description` there would reintroduce
the same page-cache problem the scored feed was replanned to remove. Guarded against a real SQLite
corpus in `tests/career-browse-feed.test.mjs`, including the query plan.

**The packet preview serves HTML, not the PDF** (`career-resume-preview`, `?as=html`). Mobile
browsers do not reliably render a PDF inside an iframe. The generator already writes the HTML
source beside the PDF, so preview serves that sibling with screen-only responsive CSS. A missing
HTML sibling returns 404 and must not silently fall back to an invisible embedded PDF. The PDF
remains the byte-identical artifact of record and every surface retains a top-level link to it.

## Runtime ownership and shared kernel rails

- **Package-owned:** the Python engine, templates, seeds, wrapper, routes, persona, migrations,
  and Career-specific browser assets in this directory.
- **Kernel-owned runtime:** the package loader, authenticated route mount, inline bot execution,
  connector-token cryptography, graph and notification skills, and the Python/Node interpreters.
  Career code reaches these through declared package imports and context rather than copying
  kernel implementations.
- **Data:** the shared corpus and per-user SQLite stores remain on the configured persistent
  Career data volume as the default backend; the staged PostgreSQL backend uses a shared corpus
  plus FORCE-RLS owner tables. `JOBHUNTER_STORE` accepts exactly `sqlite` or `postgres` and fails
  closed on every other value. Raw OIDC subjects remain the database/RLS identity; filesystem names use the
  package's reversible, contained user-segment mapper. An exact direct-child legacy raw-subject
  directory (for example Linux `auth0|abc`) remains an in-place compatibility alias, including its
  existing `user-<raw-sub>.db` basename, so database bytes and absolute artifact paths are not
  silently relocated. New unsafe identities use identity-marked encoded directories.
- **Cross-app rails:** the apply pipeline, apply operator, LinkedIn profile operator, Portrait
  Studio, and Profile Studio ingest callback remain shared integrations. Portrait Studio is now
  also a declared `dependencies.apps` entry and a Presence-group ribbon tile pointing at that
  package's own `/api/portrait-studio/app` surface — so its guest tier, not this package's,
  governs that tile.
- **Morning brief:** the kernel's `career-brief-bridge` consumes this package's hits and skips them
  cleanly when the package is absent.

<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document fail-closed credential recovery after removal of the public encryption-key fallback. -->
<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document the canonical framework build and dependency-free versus framework-backed Career validation commands. -->
<!-- 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | Document exact engine pins, the required dual-backend contract, convergence evidence, and the gated cutover runbook. -->
<!-- 2026-08-11 | maintainer@emeraldcoastsystemsgroup.com | Document the sectioned ribbon (Job Search / Resume / Presence), the cross-app Portrait Studio tile and its inherited guest tier, the deliberately absent connector allow-list, and the new docs/ index. -->

## Build and validation

Compile route sources only through the framework builder, from the OSHAL kernel checkout:

```powershell
node scripts/oshal-app.js build ..\oshal-apps\career-hunter --framework .
```

The store release gate remains dependency-free and runs every `tests/*.test.mjs` file from the
package directory:

```powershell
node --test "tests/*.test.mjs"
```

`engine/requirements.txt` pins every Python engine dependency, including the PostgreSQL driver.
Store CI installs those exact pins and requires the same ATS/storage/nightly contract to pass on a
real temporary SQLite database and a disposable non-superuser PostgreSQL database. A developer
without PostgreSQL can run the SQLite half locally; CI is intentionally unable to skip the
PostgreSQL half.

Two multipart integration checks use the real framework-owned Multer/Busboy boundary. They run
automatically when a sibling kernel checkout exists; set `OSHAL_CORE_DIR` to an alternate kernel
checkout when the repositories are elsewhere. Dependency-free store CI reports those checks as
unavailable rather than substituting a fake parser.

## Storage promotion

[BACKEND-CUTOVER.md](BACKEND-CUTOVER.md) is the current promotion/rollback specification. The
loader is repeatable across corpus and per-user datasets, and
`engine/sync/report_convergence.py --require-convergence` produces count, canonical SHA-256, and
key-query evidence. PostgreSQL user/cron writes must not be enabled until the documented reverse
projector is implemented, fault-tested, and caught up; this repository does not claim a live
cutover, backup, or seven-day observation.

## `SESSION_SECRET` credential recovery

Mounted routes decrypt current kernel `v2:` connector values through the authenticated token
broker and stage only that caller's plaintext in the child environment. The CLI deliberately
rejects `v2:` database ciphertext when invoked without that broker. A real deployment
`SESSION_SECRET` is needed only to read an older unversioned AES-GCM envelope through the legacy
database fallback. Credentials written under the retired public fallback cannot be safely
recovered: reconnect Anthropic or Firecrawl under the real deployment secret. Never paste
ciphertext into an API-key field or restore the fallback.

<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document raw-subject compatibility aliases and collision recovery. -->

## User-store path upgrade

Back up the Career data volume before upgrading. Existing unsafe raw-subject directories remain
available only when their exact case-sensitive directory entry and legacy database/profile
signature prove ownership; case-folded, trailing-dot, device-name, symlink, and encoded-prefix
aliases fail closed. If both raw and encoded directories (or both legacy and canonical database
basenames) exist, startup fails closed instead of choosing one. Stop Career workers, preserve both
directories, determine the encoded target from the package root with the mapper command below,
reconcile the newer store from backup, and restart.

```text
node -e "console.log(require('./lib/user-store-path').userStoreSegment(process.argv[1]))" -- "<raw-subject>"
```

Legacy paths containing `/` or `\\`, and raw names in the reserved `~sub-` namespace, are never
adopted automatically because ownership is ambiguous. Move those stores into a freshly resolved,
identity-marked encoded directory only while every Career process is stopped, then rewrite any
stored absolute artifact paths to the new prefix before restart.
