# lora ("LoRA Studio") — an OSHAL app package

1.7.4 makes `GET /characters` a pure read. It used to save the caller's starter character first, which the native
host refuses on a GET, so the studio's character list failed for every account. An account with no characters now
sees an explicit "Add the starter character" action, `POST /characters/starter` (bound to `lora.configure`; owner-bound
and idempotent). Proven by `tests/lora-ownership.spec.ts` under a double of the native admission rule and by
`tests/lora-character-browser.spec.ts` over Chromium and forced-RLS PostgreSQL (Test Lab case `character-console`).

1.7.3 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Train and iteratively improve a reusable character (a "sprite") so it stays consistent across
many generated images and short videos. Every trained version is validated on a fixed held-out
matrix and scored objectively — "better" is a number, and the improve loop regenerates data
aimed at the weak cells.

Carved out of OSHAL core 2026-07-17 (ADR-085 Wave 1 carve #3, design: ADR-071). This package is
the app's only home. **First package to exercise the D2 split-mountPath auth shape** (see below).

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | Manifest: the inline lora-director bot, split-auth route mounts, the worker mount's `callbackVerifier`, owner-enabled nightly schedule, ribbon tile, `indigo` skin, `suite: ai-creative`, migrations and `lora-train` workflow. |
| `authorization.yaml` | The ADR-149 catalog (1.7.0): one `lora` resource, `app.open`/`lora.read`/`lora.configure`/`lora.execute`, the `viewer` and `trainer` roles, and a binding for every route, the worker callbacks and the director bot. |
| `src-routes/` | TypeScript sources: the studio router, the worker callback mount and its kernel verifier (`lora-ingest-routes.ts`), per-dispatch callback grants (`lora-callback-grants.ts`), the catalog's resource adapter and verified-issuer reader (`lora-authorization.ts`), the ADR-139 dataset destination (`lora-dataset-ingest.ts`), the vendored box-dispatch (`lora-train-dispatch.ts`), and the vendored scorecard math (`scorecard.ts` — was `src/features/lora-studio/`). |
| `routes/` | **Compiled JS** the loader mounts (`oshal-app build` output). |
| `personas/lora-director.yaml` | The director bot's persona. |
| `tools/lora.html` | The studio surface, served by `GET /api/lora/ui` from this package dir. |
| `migrations/058-lora-studio.sql` | Fresh-install schema with mandatory per-subject ownership and forced row-level security. |
| `migrations/100-lora-owner-rls.sql` | Idempotent upgrade for installations that already recorded migration 058; legacy rows become operator-only rather than being guessed onto a user. |
| `migrations/102-lora-character-identity.sql` | The character's negative prompt and contrastive structural pair. |
| `migrations/101-lora-cell-images.sql` | `oshal_lora_cell_images` — the bounded validation thumbnail behind each scorecard cell, cascade-deleted with its character, expiring on its own clock, under the same forced owner RLS. |
| `migrations/103-lora-dataset-images.sql` | `oshal_lora_dataset_images` — owner-scoped queued/ready receipts for image/caption pairs written to the character's immutable worker `curated/` directory. |
| `migrations/104-lora-dataset-staging.sql` | `oshal_lora_dataset_staging` — the checked image bytes behind a queued receipt, bounded to 10 MiB PNG/JPEG/WebP, expiring, cascade-deleted with the receipt, under the same forced owner RLS. |
| `migrations/105-lora-callback-grants.sql` | `oshal_lora_callback_grants` and `oshal_lora_callback_nonces` — one grant per dispatch (owner, character, ticket, callback kinds, derived signing key, expiry, revocation) and each verified request's single-use nonce, under forced owner RLS. |
| `migrations/106-lora-callback-identity.sql` | The issuer half of the owner a worker callback runs as: `owner_issuer` on each grant and `autonomous_issuer` on each character (the owner who enabled autonomous mode). Nullable; nothing is backfilled or guessed. |
| `tests/` | Scorecard/dispatch tests plus owner-scoping, callback-grant, schedule, and command-boundary guards. |

## Auth shape (the split-mountPath pattern)

Core mounted one path two ways (public ingest before the OIDC wall + OIDC studio). The loader
forbids mixing auth modes on one mountPath, and its own comment names the sanctioned carve
shape — split the mounts:

- `/api/lora/ingest` — `auth: public` on the kernel's **signed-package-callbacks** rail
  (1.7.0, `uses: signed-package-callbacks`, `callbackVerifier: createLoraCallbackVerifier`).
  The GPU worker has no browser or PAT identity, so under ADR-149 enforce a plain public route
  answered it `authorization_identity_required` before LoRA's own check ran (1.6.0 on the live
  box). The rail admits **POST only** and runs the package verifier first; the verifier returns
  only the grant owner's stored subject and issuer, the kernel refreshes that owner, requires
  the catalog permission bound to the route (`lora.execute`) and runs the handler as that owner.
  Every refusal is answered `401 callback_signature_invalid` (the reason is logged); a revoked
  role or inactive owner is `403`. The worker routes are:
  - `POST /api/lora/ingest` and `POST /api/lora/ingest/cell-image` — the box scripts' callbacks,
    at the same URLs as before.
  - `POST /api/lora/ingest/dataset-download/:id` — the staged-image download, an empty signed
    POST (was `GET /dataset/:id`); it serves only that owner's queued, unexpired image for the
    grant's character.
  There is no GET probe any more. The fleet `SWARM_SERVICE_SECRET` is not a callback credential.
- `/api/lora/...` — `auth: oidc` (the studio + surface), authorized against `authorization.yaml`.

The package also registers an ADR-139 `image/*` destination. Send-to opens the LoRA Studio with an
owner-bound image handle; the operator chooses the named character and caption in the console, then
`POST /api/lora/dataset/import`:

1. redeems the handle **as the signed-in caller** — it reads core's `/api/artifacts/handles/:ref`
   and `/content` with the caller's own cookie or PAT (never the fleet secret), so core's
   authenticated relay (`uses: authenticated-artifacts`) rechecks the exact principal, the source
   application's permission and its registration. A service-rail-only request cannot redeem;
2. refuses anything that is not a PNG, JPEG or WebP by its magic bytes, or is over 10 MiB, before
   any write, and names the file with the extension its bytes support;
3. stages the bytes in `oshal_lora_dataset_staging` (forced owner RLS, expiring after
   `LORA_DATASET_STAGING_TTL_HOURS`, default 24) beside a `queued` receipt, and queues one worker
   write.

The GPU worker downloads the staged bytes with a signed POST to `/api/lora/ingest/dataset-download/:id`, which needs the
import's callback grant and serves only a queued, unexpired image of the grant's character. It checks the
magic bytes and size again, writes the image and its `.txt` caption into that character's immutable
`curated/` directory, and reports `ready`; any failed download, check or write reports `failed`
from a catch. Either callback deletes the staged bytes and revokes the grant; an expired image fails its receipt. `GET
/api/lora/dataset?subject=` shows the owner-scoped receipts. Source and package tests do not claim
that a live portrait artifact reached a GPU box.

Characters, models, and scorecards are owner-scoped in route predicates and by
forced PostgreSQL RLS. Each authenticated owner can add an isolated copy of the starter
character (`POST /characters/starter`, which the studio offers when the account has none;
`GET /characters` never writes), so identical character subjects can safely exist for different users.
The studio treats callback/database fields as untrusted text, binds actions without
inline JavaScript arguments, and accepts only parsed credential-free HTTP(S) gallery URLs.

## A character is a row, not a source edit

The box scripts hold no character constants. Everything they need — trigger word, locked hero,
identity sentence, negative prompt, contrastive structural pair, checkpoint — comes from that
character's `oshal_lora_characters` row and is passed on the command line by the dispatch.

Open **Create a character** in the studio to set the subject, display name, trigger, hero image,
identity sentence, negative prompt, structural pair and checkpoint. Saving only stores the
configuration: it starts no training, creates no ticket and enables no schedule. Selecting the
saved character after reload shows all persisted identity fields and its immutable curated-set
destination. Cancel clears an unsaved draft without a request; a failed save retains the draft,
and a pending save disables repeat submission. Hero/checkpoint names refer to files on the worker;
the form does not upload files or claim that they exist.

- `POST /api/lora/characters` creates one of the caller's own characters. `subject` must be a slug
  (the public name, not the worker directory), `heroImage` and `identPrompt` are required
  because they *are* the identity, and `identityStructure`/`identityViolation` are a pair: give
  both or neither. Half a pair silently disables the structural check.
- A new character may **not** reuse another of the caller's characters' hero image or identity
  sentence. A reused one trains and scores the new character as the old one, which is exactly the
  failure the per-character work exists to stop.
- Creation accepts text fields only, at most 2048 UTF-8 bytes per field, without NUL characters.
  The server enforces the same bounds even without the console. Reuse-check and insert share a
  read-committed transaction with an owner-scoped PostgreSQL advisory lock, so simultaneous API
  requests cannot both pass the check. Lock waits stop after five seconds with a retryable 503;
  an insertion failure rolls back. Another owner may use the same identity values.
- A character that declares no structural pair is not probed structurally. That is correct:
  scoring it against another character's anatomy multiplied its quality by 0.55 on every cell.

Each character owns a directory on the box — `LORA_BOX_ROOT/lora-<UUID without dashes>`
(default `%USERPROFILE%\lora-characters\lora-<UUID without dashes>`) holding `img/`, `curated/`,
`curated.zip` and `validate/`. The owner-only characters response includes `storage_key`.
This immutable name also prefixes staged training and new model files; public subjects that are
identical across owners, differ only in Windows case, or name Windows devices do not collide.
The explicit trigger remains the character's configured trigger, not its storage key.

Callbacks resolve the immutable key under the exact authenticated owner. Legacy public-subject
callbacks still resolve; ambiguous keys are refused. Existing model rows retain their original
paths: validation uses their saved basename (or the historical subject/version basename for an
imported row without a path). A legacy overnight starting model is validated into the immutable
scorecard directory before the loop starts; failed preparation stops the dependent command.
New training never writes to the old subject-named directories or overwrites their model files.
Installation does not copy or delete existing worker data. An operator transferring a legacy
curated set must first establish its owner and place it under that character's `storage_key`;
the training judge still refuses a missing/unjudged dataset. Deployment of the compatible worker
scripts and live GPU acceptance remain separate from package command tests.

### Worker storage acceptance

`node --test lora/tests/worker-storage.core.test.js` runs four command regressions and six real
PostgreSQL/HTTP cases through the framework test runner. Both owner roles are non-bypass roles,
real migrations run twice, and creation, train dispatch, validation and callbacks use the actual
package routes, including score/thumbnail callbacks feeding the public-name gallery. Only session identity, bootstrap after migration, ticket creation and remote
enqueue are fixture seams; no command is executed on a GPU. The Test Lab catalog declares its
framework/disposable database requirements. Live worker deployment is not claimed by these tests.

`node --test lora/tests/character-console.core.spec.mjs` runs ten additional console/storage cases
using real PostgreSQL, package HTTP, Chromium and the shared framework theme assets. It proves
all-field save/reload, exact-owner persistence, invalid type/NUL/byte bounds, concurrent hero and
identity reuse refusal, rollback, lock-timeout recovery, cancellation, duplicate-submit suppression
visible refusal with draft preservation, and migration replay preserving custom characters that
share the starter's public name. Starter backfill requires its actual trigger, hero and identity
sentence, not its subject alone. The race fixture holds real inserts at a database
barrier until all callers are waiting. A fixture-only connection rendezvous admits all four callers
before BEGIN, including one deliberately delayed by 5.5 seconds; this prevents connection setup
from consuming the product lock deadline before the race starts. It does not change SQL, lock
timeouts or database responses. A separate contention case exercises the unmodified five-second
timeout and retry. Failure diagnostics include actual HTTP outcomes and database waiter states. Session identity
and bootstrap after twice-applied migrations are fixture seams, while GPU and ticket ports throw
if invoked. Test Lab registers this separately from the gallery and worker-command cases.

## Scorecard images

A scorecard cell renders a thumbnail the CONTROLLER hosts, not a path on the GPU box. The box
posts one bounded image per cell to `POST /api/lora/ingest/cell-image`, signed with the same
callback grant as the scorecard, each with its own nonce; the bytes are checked (PNG or JPEG by
magic bytes, at most 256 KiB) before any write and stored against the caller owner character.

- `GET /api/lora/cell-image?subject=&version=&cell=` serves one thumbnail, behind OIDC, only to
  the character owner, and only while it is unexpired — the expiry is part of the read predicate,
  not a sweep that may not have run.
- `GET /api/lora/scorecard` returns `hostedCells`, the cell indexes with a live image. The studio
  builds each `<img src>` from the selected subject/version/index, so a string the box supplied
  never becomes an image source.
- `DELETE /api/lora/models/:subject/:version` deletes a run: its thumbnails, its scorecard and its
  version row. A database foreign key also cascades images when the model is deleted directly;
  delayed uploads cannot recreate images for a missing model. Deleting a character cascades the same way.
- Thumbnail access ends 30 days after the model run was created. Re-uploading a cell never extends
  that deadline. Reads and writes also bind the source filename to the current scorecard's exact cell,
  so a revalidation cannot display an old image under a changed score. Missing/expired images have no
  external-URL fallback. Existing orphan thumbnail rows cause schema upgrade to refuse rather than purge data.

### Gallery acceptance

From the store checkout with the sibling framework dependencies, Chromium and Docker available:

```powershell
node ../oshal/node_modules/vitest/vitest.mjs run --config lora/tests/gallery.config.mjs
```

Set `OSHAL_FRAMEWORK_ROOT` for another framework checkout. The package Test Lab catalog names these
prerequisites; installation runs only the existing read-only readiness smoke. The gallery suite uses
a new disposable PostgreSQL server, real non-superuser/non-bypass owner roles, package HTTP routes,
and the actual studio in Chromium. Colored PNG fixtures prove decoded cell pixels, not just image
tags. It covers expiry, direct/HTTP deletion, delayed callbacks and changed scorecard cells. Cookie
identity is a fixture, runtime bootstrap is replaced after applying real migrations twice, and GPU
dispatch is forbidden. This does not claim training on a live GPU or a production owner scorecard.

## The family view (Home shell, 1.7.2)

The Home (Jarvis) shell opens the studio's first surface, `/api/lora/ui`, with `?audience=family`. The
page then paints the signed-in account's saved characters through the shared audience-view kit
(ADR-164 D6) instead of the studio: three counts (saved characters, versions waiting or training,
versions that did not finish), the newest character's recorded score, and the three newest
characters with their latest version, its status in plain words and when that version was recorded
(a registration time, not a training finish). One action and the kit's escape open LoRA Studio in
the cockpit, where everything is done.

On open the view makes exactly one read, `GET /api/lora/home-summary` (bound to `lora.read` in the
unchanged authorization catalog; owner-scoped SELECTs, no side effect). It never reads
`/characters` (the studio's own list), and so none of
the studio reads that need a character (`/models`, `/scorecard`, `/cell-image`, `/dataset`); it never
trains, validates, improves, imports, promotes or deletes. Signed out, refused, partial, empty and
failed answers each read as what they are. The studio's control wiring and its character-list start
run only when no audience view renders; without the parameter the studio runs unchanged.

Tests: `node --test lora/tests/audience-view.test.cjs` (static kit contract, the view's reads and
states against a stub kit and stub fetch, and the gated studio start run against recording stubs;
Test Lab case `audience-view`), and the browser proof over the real page and the real kit,
`OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs lora` from the store root
(fixture `lora/tests/audience-view.fixture.cjs`: synthetic data, no writes, full page untouched
without the parameter).

## The GPU box

Heavy work never runs on the api: dataset generation + validation drive the box's ComfyUI HTTP
API, kohya training runs via the worker node's **gated `shell.exec`** (ADR-070) through the
shared remote-client registry. Box-side scripts (`train-lora.py`, `validate-lora.py`,
`make-targeted-batch.py`, `make-overnight-hq.py`, `make-curate.py`, `overnight-loop.py`) live in the **framework repo's**
`scripts/comfyui-edge/` (shared with Video Studio, deployed to the box's repo clone) — the
vendored dispatch references them by name on the box. Env (deployment-level, documented in the
framework `.env.example`): `LORA_CONTROLLER_URL`, `LORA_EDGE_CLIENT_ID`, `LORA_EDGE_HOSTNAME`
(+ code-read `LORA_BOX_REPO`, `LORA_BOX_VENV_PY`, `LORA_BOX_ROOT`). Note
`LORA_CONTROLLER_URL` is also read as a *fallback* by the apply/profile-studio dispatches —
the name is not lora-exclusive.

### Autonomous overnight improvement

The console's **Improve overnight** switch is the only eligibility gate for the package's declared
`0 2 * * *` framework schedule. On each tick, the deterministic service handler reads only
characters with `autonomous=true`, requires a trained/scored starting version, and starts at most
one running overnight loop per character: it skips a character whose NEWEST overnight ticket is
still open and younger than its budget plus two hours. The owner subject is copied from the
character row into the ticket, command and callback grant, and the grant's owner issuer is the one
recorded when that owner enabled **Improve overnight** (a character enabled before 1.7.0 has none
and is skipped as not ready until its owner switches the mode off and on again); the worker's final review callback must
name that dispatch ticket, completes it, revokes the grant and creates a separate
`approval_required` morning-review ticket. Nothing is promoted automatically. A missing worker
cancels the dispatch ticket and the next cadence may retry; a lost worker becomes retryable after
the configured budget plus that grace period.

The schedule cadence is a package default rather than a per-character user setting. `max_hours`
and `plateau_epsilon` remain console-configurable per character. Installed scheduler registration
and real GPU execution are separate deployment evidence; package tests do not claim those receipts.

### Callback grants (1.6.0; kernel rail 1.7.0)

Every train, validate, improve, overnight and dataset-import dispatch mints one grant in
`oshal_lora_callback_grants`, bound to the owner, the character, the ticket and the callback kinds
that job may send (train/improve: `training`; validate: `score`, `cell-image`; overnight: those
plus `review`; dataset import: `dataset-download`, `dataset`). It lives
`LORA_CALLBACK_GRANT_TTL_HOURS` (default 12, 1-72) for one-shot jobs, the loop's `max_hours` plus
that for an overnight loop, and the staging lifetime for a dataset import; a dispatch no worker
accepts revokes its grant at once. Since 1.7.0 a grant also records its owner's verified issuer —
from the kernel's actor for a console dispatch, from `autonomous_issuer` for the schedule — and a
dispatch with no verified issuer mints and sends nothing.

The worker receives `<grant id>.<secret>` in `OSHAL_LORA_CALLBACK_GRANT`, set by a PowerShell
assignment at the head of its shell task, so it is never a box script argument. The shell-task
envelope does carry it; the grant is short-lived and scoped. The controller stores only
SHA-256(`oshal-lora-callback-grant-v1:` + secret), the HMAC key. Each request sends
`x-lora-callback-grant`, `x-lora-callback-owner` (base64url owner), `x-lora-callback-timestamp`,
`x-lora-callback-nonce` and `x-lora-callback-signature` = HMAC-SHA256 over
`METHOD|path?query|timestamp|nonce|sha256(body)`; JSON callbacks travel as
`application/vnd.oshal.lora-callback+json` so the exact signed bytes reach the verifier. The
framework's `scripts/comfyui-edge/lora_callback.py` is the box-side signer; the dataset command
signs in PowerShell.

The verifier runs as the asserted owner under forced RLS and refuses (401) a missing grant, the
fleet secret alone, a bad signature, a timestamp more than `LORA_CALLBACK_SKEW_SECONDS` (default
300) from the controller clock, an expired or revoked grant, a grant with no recorded issuer (every
1.6.0 grant), and a replayed nonce; another owner's grant is invisible and refused the same way. A callback kind the dispatch was not granted, another
character, or a review naming another ticket is refused (403) with no write. The GPU box's clock
must be within the skew of the controller's.

### Kernel boundary acceptance

`node --test lora/tests/signed-callback-boundary.core.test.js` (and `box-producers-boundary.core.test.js`)
activate this package through the framework's real manifest reader, ADR-149 enforce-mode
authorization runtime and route mounter, over disposable forced-RLS PostgreSQL. A grant minted by a
real studio dispatch is admitted and served as its owner; unsigned, fleet-secret-only, tampered,
replayed, expired, issuer-less, foreign-owner, GET and revoked-role requests are refused with no
write; and the framework's Python box signer and the dataset command's PowerShell download and
ready callback pass the same boundary. Set `OSHAL_CORE_ROOT` to the framework checkout. Request
identity, the principal directory, tickets and GPU enqueue are fixture seams; no live worker runs.

## Install

```bash
node scripts/oshal-app.js install lora     # from an OSHAL checkout
```

### 1.7.1: the dataset import expands the box root on the worker

**What was wrong.** The first live gallery-to-dataset import on LoRA 1.7.0 (the automated
`lora-gallery-dataset-import` acceptance, GPU node online) failed after 3 s: the worker task exited 1
with PowerShell `New-Item ... -Path '$env:USERPROFI...' → ObjectNotFound: ($env:String) [New-Item],
DriveNotFoundException`. `buildDatasetImportCommand` (`src-routes/lora-train-dispatch.ts`) wrapped the
curated directory, image and caption paths in `psLiteral()` (single quotes), so the default box root
`$env:USERPROFILE/lora-characters` reached the box as literal text and was never expanded — the
training and validation commands had always double-quoted the same root. The defect shipped in 1.5.0
and was never exercised live before (1.5.0 and 1.6.0 failed earlier for other reasons), and every
existing PowerShell proof pointed `LORA_BOX_ROOT` at a literal temp directory, which no quoting breaks.

**What changed.** Box-side paths go through one validating helper, `psBoxPath()`: it admits exactly an
optional leading `$env:NAME` followed by letters, digits, space and `_ . : ( ) - / \`, refuses every
`"`, backtick, further `$`, wildcard, newline, control character and `..`, and emits the path as a
PowerShell double-quoted expandable string. The interpreter, script, `--box-root`, `--dataset`,
`New-Item -Path`, `Move-Item -Destination` and `WriteAllText` paths all use it; captions, URLs and
names stay single-quoted literals. `Move-Item` takes the temp file by `-LiteralPath`. Neither
`authorization.yaml` nor the catalog changed, so 1.7.1 stages over 1.7.0 without an AUTH-07 sequence.

**What the guard proves.** `tests/lora-dataset-box-path.spec.ts` (Test Lab case
`dataset-artifact-destination`) keeps the DEFAULT root, runs the shipped directory/move/write
statements through real `powershell.exe -NoProfile -NonInteractive -Command` with the child's
`USERPROFILE` pointed at a fresh temporary directory, and asserts that the curated directory, the image
and the caption (exact UTF-8 bytes, no BOM) exist at the EXPANDED path; with the three sites reverted to
`psLiteral` the same case fails on the live `DriveNotFound` line. A non-Windows host prints one
`PLATFORM SKIP` line for that case rather than passing it. `tests/lora-dataset-ingest.spec.ts` pins the
double-quoted paths in the full command and that no `'$env:` appears anywhere in it.

### Upgrading to 1.7.0: the authorization catalog is new

1.7.0 is the first LoRA version with an `authorization.yaml`. Once it is active, every LoRA route,
the director bot and the worker callbacks need a catalog role: assign `trainer` (or `viewer`) to
each LoRA user in Access. A worker callback runs as the grant owner and needs that owner's current
`lora.execute`. The kernel refuses to activate a package whose catalog revision differs from one
that existing assignments reference (`authorization_catalog_migration_required`,
`validateRegistration` in core `src/features/application-authorization/service.ts`); an `@app-admin`
assignment made for catalog-less LoRA is such an assignment, so it must be removed before 1.7.0 is
staged and the roles granted after. Migration 106 must run with the package.
Ships `status: active` (parity with core — the app was live when carved). Data note: the three
`oshal_lora_*` tables stay in place across the carve (no drop); on a fresh deployment the
package migration creates them.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| training-ticket-review | training loop ticket | T2 | local | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
