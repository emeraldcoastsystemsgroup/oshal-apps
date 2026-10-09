# Video Studio (video) — OSHAL app package

1.9.1 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Make prompted short-form videos (TikTok / YouTube Shorts / Instagram Reels) from
an idea. The **video-director** bot drafts a scene-by-scene storyboard (LLM,
metered, inline on the api); the framework renders a REAL .mp4 deterministically
(one Veo clip per scene, TTS voiceover, burned-in captions, ffmpeg stitch) and
saves it to your Files storage. A SERIES (`video-series` ticket) is written by the
**screenplay-writer** bot, held at a human approval gate on the script, then
storyboarded and rendered one episode at a time on the remote Vids node (ADR-082
— the state-machine conductor is the runtime, not a workflow graph).

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the `/api/video` routes (storyboard / generate / list +
  the series lifecycle: create / approve / advance / write / storyboard / render),
  the studio surface (`tools/video.html`, self-served at `/api/video/ui`),
  package copies of the three personas for the registrar, migration COPIES of
  066/067 for fresh installs, and `tests/video-manifest-no-graph.spec.ts` (the
  ADR-082 graph-block-retirement guard, moved from the kernel with the manifest).
- **Stays in the OSHAL kernel:** the video-series **conductor engine**
  (`src/app/series-{pipeline,orchestrator,dispatch,drive}.ts`) + the
  `startSeriesReconciler` cron in server.ts; the `src/features/video-generation`
  slice (renderVideo, storyboard sanitizer, Veo cost model); the video-director
  (…048) + screenplay-writer (…052) **inline nodes** in BOTH
  `swarm-bot-registry` blocks + the kernel personas; kernel migrations 066/067;
  and the SHARED vids-operator remote-client desktop worker
  (`packages/oshal-vids-operator`) that renders episodes.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Video Studio | `/api/video/ui` | Storyboard → generate → My videos + the series pipeline (self-served by this package) |

## Series and season artifacts

The series panel lists the caller's episodes in ordinal order. A multi-episode season has a
watch link only when the conductor recorded its uploaded artifact URL. A cut that exists only on
the render node is labelled as such; an assembling season says it is still stitching. A single
episode normally has no separate season cut. Links accept only credential-free HTTP(S) URLs and
are escaped before rendering. This surface does not create a public share or change Drive access.

The separate owner-scoped season read tolerates PostgreSQL's missing-column error for frameworks
without migrations 098/153. Other database errors fail the request; a failed refresh clears old
links and displays a load error. It never presents a failed read as successful artifact delivery.

### Acceptance tests

```powershell
node ../oshal/node_modules/vitest/vitest.mjs run --config video/tests/season.config.mjs
node --test "video/tests/*.test.js" video/tests/season.core.spec.mjs
```

Run from the store checkout with sibling framework dependencies, Docker and Chromium, or set
`OSHAL_FRAMEWORK_ROOT`. The six browser/database tests use actual package routes, the whole studio,
fixture-owned PostgreSQL and non-bypass owner roles. They cover episode order, season states,
owner/anonymous refusal, real missing-column and permission errors, unsafe links and stale refreshes.
Identity, runtime bootstrap and unrelated library/brand panels are explicit fixture seams; provider
and render calls are forbidden. The test applies real package and framework migrations twice.
The existing compiled-route/VM tests run separately in the ordinary package gate.

The package Test Lab catalog registers the browser proof with disposable-engine prerequisites and
the read-only readiness smoke. Installation never runs the browser suite. None of these results
claims a live conductor render, uploaded Drive artifact or ffprobe stream/silence acceptance.

## Family audience view (1.6.1)

The Home shell opens the studio as `/api/video/ui?audience=family` (ADR-164 D6). The shared kit
(`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints the signed-in
account's saved series in plain words: how many series there are, scripts waiting for approval,
series in progress and videos saved in the last five days (the home summary's own counts), a title
that names the account's state, each series with where it stands, how many of its episodes are
finished and whether its season cut is ready or only on the render computer, and the episodes and
season cuts the studio saved a credential-free http(s) watch link for, each opening in a new tab.
On open it reads only `GET /series` and `GET /home-summary` under the caller's session. It never
reads `/list` (that scans the caller's connected storage), the joke pump, the render node or
Create's brand kit, and it never storyboards, renders, uploads, writes a series or approves a
script; single videos stay in the studio's My videos list. The one action and the escape open
Video Studio in the cockpit. A count the summary could not check, signed out, refused, a failed
read and an unreachable server are each named. Any other request runs the full studio unchanged:
its start steps (the control and joke-pump listeners, the videos and series reads, the brand-kit
read, the handoff listener and the connected-actions mount) run only when no audience view renders.

```bash
node --test video/tests/audience-view.test.cjs
OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs video
```

The first runs from the store root with no browser: the static kit contract and the view's
behaviour over the package's real compiled `/series` and `/home-summary` handlers (framework
imports as inert seams, a stub pool), plus the gated start paths. The second drives
`tests/audience-view.fixture.cjs` over the real page and the real kit in headless Chromium. The
first is registered as the `audience-view` case of the Lab catalog.

## Manual timeline editor (in progress, CREATE-EDIT-05)

The manual editor follows [the editor plan](EDITOR-PLAN.md). 1.6.2 shipped its pure half, and
1.7.0 adds persistence, owned media and routes. 1.8.0 adds export jobs, and 1.9.0 adds the editor
screen (all below).

- `tools/editor/timeline-validation.mjs` is the one document contract, shared by the browser and
  the server. A project is version 1 in the single `hd720p30` profile (1280x720, 30 fps,
  H.264/AAC, 48 kHz). It holds at most two video clips of up to 30 seconds (900 frames) each, one
  WAV bed of up to 60 seconds, 20 segments on one main track and 60 seconds (1800 frames) in
  total, plus at most ten titles on one track that never overlap. Every position is a whole
  number of frames in the 30 fps project time base. Media are referenced only by their uploaded
  UUID. Unknown fields, unsafe keys, paths, URLs, accessors and control or
  bidirectional-override text are refused.
- `tools/editor/timeline-model.mjs` provides the immutable operations: add and remove a source,
  append, trim, split, reorder and remove a segment, set clip volume, add, change and remove a
  title, and set the bed and its volume. None of them changes a source file. A split keeps both
  halves on the same source frames. When the timeline gets shorter, titles past the new end are
  dropped and titles running over it are cut to fit.
- `tools/editor/timeline-history.mjs` is a bounded, independent undo/redo history.
- `src-routes/video-edit-compiler.ts` (compiled to `routes/video-edit-compiler.js`) turns a
  validated timeline into one fixed FFmpeg argument array.
  - The only document values that reach the filter graph are range-checked integers.
  - Title text goes to server-named files that drawtext reads with expansion off.
  - Media are server-resolved local files, read through the file protocol with an explicit demuxer.
  - Nothing runs through a shell.

```bash
node --test video/tests/timeline-model.test.js video/tests/video-edit-compiler.test.js
```

Both suites are dependency-free, so they also run in the store-ci `video` job. They are
registered as the `timeline-model` and `timeline-compiler` Lab cases. The compiler suite inspects
the arguments and does not run FFmpeg; decoding a real export is covered by the export-job step
of the plan.

### Persistence, owned media and access (1.7.0)

- **Tables** (`migrations/068-video-edit-projects.sql`): `video_edit_projects`,
  `video_edit_revisions` (immutable), `video_edit_assets` (immutable) and
  `video_edit_revision_assets`.
  - Every row carries its verified `owner_issuer`/`owner_sub`.
  - Every table is ENABLEd and FORCEd with one exact-owner policy. The policy has two arms:
    this package's transaction-local `video.owner_*` stamp, and the platform `oshal.current_*`
    stamp that `/api/me` export and delete use. It has no operator arm.
  - The existing generation tables are not touched.
- **Routes** (`routes/video-editor-routes.js`, mounted at `/api/video` beside the studio):

  | Route | Purpose |
  |---|---|
  | `GET /editor/capabilities` | What this installation accepts |
  | `GET /editor/permissions` | Effective editor actions |
  | `POST /editor/media?kind=video` or `?kind=audio` | One multipart `media` part |
  | `GET /editor/media/:id` | Single-range playback |
  | `POST /editor/media/cleanup` | Remove uploads older than 24 hours that no retained revision uses |
  | `GET/POST /editor/projects` | List projects, or create one |
  | `GET/DELETE /editor/projects/:id` | Read a project, or delete it (optimistic `baseRevision`) |
  | `GET/POST /editor/projects/:id/revisions` | List history, or save optimistically on `baseRevision` |
  | `GET /editor/projects/:id/revisions/:revision` | Read one retained revision |

  - Identity comes only from the framework actor.
  - Tenant, owner, issuer and workspace selectors are refused.
  - Current named permissions are re-read before any body is read and again before commit.
- **Media**: an upload lands in a private temporary file first. Its container signature is
  checked, its actual bytes are hashed and it is probed with the runtime's `ffprobe`.
  - The probe uses the file protocol and a forced demuxer, runs from an argument array, and
    never uses a shell or the network.
  - Accepted clips: H.264 in MP4, at most 30 s, 100 MiB, 1920 px on the long side, 1080p's
    pixel count and 60 fps, with at most one AAC track.
  - Accepted beds: PCM in WAV, at most 60 s and 32 MiB.
  - Anything else is refused. An extra audio or subtitle stream is never silently dropped.
  - Accepted files are published as immutable `<uuid>.mp4|.wav` files in a per-owner directory
    under `VIDEO_EDIT_DATA_DIR`. If that is unset, they go to `<shared workspace>/video-edit`.
  - `FFPROBE_PATH` overrides the binary, as `FFMPEG_PATH` does for the core renderer.
  - Owners are held to 20 files and 500 MiB; a project to 200 MiB of media; a project's history
    to the newest 100 revisions.
- **Authorization** (`authorization.yaml`, Video's first named catalog):
  - **Studio:** `studio.view`, `studio.read`, `studio.generate` (spends provider money) and
    `pump.manage`.
  - **Editor:** `editor.view`, `editor.read`, `editor.create`, `editor.change`, `editor.delete`
    and `editor.export`.
  - **Roles:** viewer, reader, producer, showrunner, creator, editor, exporter and admin.
  - Every existing studio, series, pump, summary and readiness endpoint is bound; none of their
    route files changed.
  - Upload needs view plus create **or** change.
  - **Upgrade:** a legacy `@app-admin` assignment is not translated. Activating 1.7.0 where Video
    already has grants needs the reviewed AUTH-07 catalog migration
    (`GET /api/authorization/catalog-migrations?app=video`, then apply) and explicit named role
    grants.

```bash
OSHAL_CORE_ROOT=<core checkout> node --test video/tests/video-editor-api.test.mjs video/tests/video-editor-postgres.test.mjs video/tests/video-editor-media.test.mjs
OSHAL_CORE_ROOT=<core checkout> node <core>/node_modules/vitest/vitest.mjs run --config video/tests/video-editor-authorization.config.mjs
```

| Suite | Boundary it proves | What it stands in for |
|---|---|---|
| API | Admission, over real Express and Multer | A strict non-writing pool and the named `video-editor-fixture-prober` |
| PostgreSQL | A disposable `postgres:16-alpine`, migrated as the owning role | The same named prober |
| Media | Runs inside the local `oshal-bot:latest` image with its real FFmpeg/ffprobe: no network, read-only root and mount, unprivileged | Nothing |
| Authorization | The real core authorization runtime and route mounter | A refusing business pool and forbidden studio collaborators |

`SCHEMA.md` is generated from a reference database and is regenerated after install.

### Export jobs (1.8.0)

- **Requesting and managing jobs**:

  | Route | Needs | Purpose |
  |---|---|---|
  | `POST /editor/projects/:id/exports` with `{ revision, variant }` | `editor.export` | Render one saved revision. `variant` is `export` (1280x720, the default) or `preview` (640x360 with faster encoder settings), both from the same compiler. |
  | `GET /editor/exports/:id` | `editor.read` | Read one job and its live progress in frames |
  | `GET /editor/projects/:id/exports` | `editor.read` | List a project's jobs |
  | `POST /editor/exports/:id/cancel` | `editor.export` | Cancel an owned job |
  | `GET /editor/exports/:id/download` | `editor.export` | Download a success; add `?inline=1` to play it inline |

  Polling never creates or retries work.
- **Admission**: one active encode per Video process, one job per owner, and at most four queued
  with a 30-second queue deadline.
- **Per job**:
  - A job re-checks current authority when it starts, every five seconds while encoding, and
    before it publishes.
  - It re-reads its revision and requires the hash of the exact document text it was queued with.
  - It re-hashes every media file before the encoder sees it.
  - It encodes in its own private work directory, which is always removed. It spawns the
    runtime's FFmpeg (`FFMPEG_PATH`) from a fixed argument array, with two threads, 120 seconds
    of wall time and a 256 MiB output cap.
  - Titles use `VIDEO_CAPTION_FONT` (the core renderer's font).
- **Stopping**: cancel, timeout, revocation or shutdown sends TERM only to the job's own child,
  escalates to KILL after two seconds, and waits for the child to exit.
- **Publishing**:
  - A success is recorded only after the real output is decoded by ffprobe. It must have exactly
    the promised frames, canvas and H.264/AAC 48 kHz stereo, and a duration within two frames.
  - The output is then moved into the owner's `exports/` directory.
  - The success is recorded with a compare-and-set on status, process epoch and cancellation, so
    a cancelled, stale or deleted job never leaves a success behind.
- **After a restart**: an unfinished job from an earlier process reads as, and is recorded as,
  `interrupted`. It is never replayed.
- **Retention**:
  - A project keeps at most three exports: a new one and its two newest finished predecessors.
  - Revision retention never retires a revision an export is rendering.

```bash
node --test video/tests/video-edit-export.test.mjs
OSHAL_CORE_ROOT=<core checkout> node --test --test-concurrency=1 video/tests/video-editor-export-postgres.test.mjs
```

- **The first suite** runs the compiled runner inside the local `oshal-bot:latest` image with its
  real FFmpeg, then decodes the result.
  - It checks exact frames, segment order and source offsets by colour, the fitted pillarbox, the
    title only on its frames, and clip audio only under its clip with the bed under everything.
  - It proves cancel, timeout, revocation and a lost compare-and-set leave no output, work
    directory or FFmpeg process.
- **The second suite** drives the routes over a disposable PostgreSQL. It uses the named
  `video-editor-fixture-encoder` in place of FFmpeg.

### The editor screen (1.9.0)

The **Video editor** tile opens `/api/video/editor`. Create's **Edit video** card, quick start and
rail tile open the same screen. Create owns none of it: the screen, its routes and its access
belong to Video.

- **Media**: bring in up to two MP4 clips and one WAV music file with the native file picker.
  Each clip goes onto the timeline, and the first music file becomes the bed.
- **Editing**:
  - Select a segment to trim its start and end frames, split it at the playhead, move it earlier
    or later, remove it, or set its volume.
  - Titles are added at the playhead with a length, position and size.
  - The music bed has its own volume.
- **Keyboard**:

  | Key | Action |
  |---|---|
  | Space | Play or pause |
  | Left / Right | Move one frame (with Shift, one second) |
  | S | Split at the playhead |
  | `[` / `]` | Move the selected segment earlier or later |
  | Delete | Remove the selected segment |
  | Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
  | Ctrl+S | Save |

- **In-browser preview**: frame exact. It shows each segment's own source frame, the title
  overlay and the bed. If the browser cannot decode a clip, the screen says so and timing and
  titles keep working. The FFmpeg preview render is the authoritative comparison with the export.
- **Saving**: saves are optimistic on the revision you opened.
- **Your unsaved draft** is kept in memory and, per project, in this browser. It survives theme
  changes, failed requests, a reload and a conflict. On a conflict you can open the saved version
  or save your edits as a new project.
- **Export and preview** render the last saved revision.
- **Permissions**: the screen reads its effective permissions and disables what the person may
  not do.

```bash
OSHAL_CORE_ROOT=<core checkout> node --test --test-concurrency=1 video/tests/video-editor-browser.test.mjs
```

`DELETE /editor/media/:id` (`editor.delete`) removes one upload that no retained revision uses,
file first and then its row. An upload a revision still uses is refused with 409.

This runs real Chromium against the real screen, the real compiled routes, a disposable PostgreSQL
and the core's shared theme code. It checks the whole workflow above, including draft survival,
every portal palette, a 390 px phone layout and permission gating. It is registered as the
`editor-browser` Lab case.

## Install

```bash
node scripts/oshal-app.js install video
```

Requires `APP_PACKAGE_DYNAMIC_ROUTES=1` (the ADR-085 route mounter). Single clips
bill Veo per second under the director's agent id; series storyboards bill the
caller's own connectors (Google Drive for frames; gcp for Vertex images when
`STORYBOARD_IMAGE_PROVIDER=vertex`). Series renders need the Vids worker online:

```bash
npx oshal-vids worker   # on a machine with a screen + signed-in Chrome
```

### Acceptance on an installed box

Run `tests/editor-live-acceptance.mjs` after Video 1.9.0 is installed and its catalog migrated. It
drives the real editor routes as the operator automation identity. The token is
`OSHAL_VERIFY_OPERATOR_PAT`, read by name and never printed. The walk:

1. Uploads the committed one-second clip (`tests/fixtures/editor-acceptance-clip.mp4`, made by
   the runtime image's FFmpeg). The box's own ffprobe measures it.
2. Creates one uniquely tagged project.
3. Saves a second revision, then has a stale save refused.
4. Exports with the box's own FFmpeg and requires the verified 20-frame MP4 back.
5. Deletes the project, its export and the upload, and reads each back as 404.

It prints one `RESULT` line. An incomplete cleanup is a failure.

```bash
OSHAL_VERIFY_BASE_URL=http://localhost:35457 OSHAL_VERIFY_ENV_FILE=<box .env> node video/tests/editor-live-acceptance.mjs
```

`tests/editor-live-acceptance.test.mjs` proves the same function on loopback before any box runs
it. The committed clip's real ffprobe measurement is checked in `video-editor-media.test.mjs`.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| storyboard | storyboard | T2 | none | disable | not yet measured | none recorded |
| clip-render | short video | T2 | hosted | disable | not yet measured | none recorded |
| series-episode | series episode | T3 | hosted | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
