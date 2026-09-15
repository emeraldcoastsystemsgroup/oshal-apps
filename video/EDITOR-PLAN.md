<!-- CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Separate the proposed manual video editor from existing generation and record isolated FFmpeg feasibility and delivery gates.
-->
# Manual Video Editor plan

**Status: design and isolated engine feasibility only. No manual video editor is
installed or implemented by this document.** The intended experience is simple
direct editing with preserved revisions, followed by optional AI assistance that
understands the selected clip and time range. Full Canva or desktop-editor parity
is not the acceptance criterion for the first delivery.

## Current capability and missing work

| Area | Present in source | Work still required |
| --- | --- | --- |
| Video Studio | [The current screen](tools/video.html) accepts style, tone, aspect, target length, voice, captions and music preferences. Scene prompt, narration and caption text can be edited before generation. | Imported-clip selection, playhead, trim/split/reorder, titles and audio editing. Existing scene duration is displayed rather than edited through timeline handles. |
| Generation | [Video routes](src-routes/video-routes.ts) call the existing media-generation skill, then save an MP4 through the storage skill. Series and show-pump controls remain separate. | A deterministic imported-media timeline renderer that does not call Veo, TTS or another provider. |
| Engine | The core image includes FFmpeg and DejaVu fonts. Existing generation normalizes clips, burns text, concatenates and mixes audio. The isolated proof below exercises those primitives. | A validated timeline-to-filter compiler, job progress, cancellation, durable export state and production resource enforcement. |
| Persistence | Existing generated-video and series records; the separate [Create editor](../create/EDITOR.md) demonstrates immutable private projects and assets. | Video-owned issuer-qualified projects, revisions, immutable media, revision references and export jobs. Existing generated-video rows are not a manual project format. |
| Templates | [Six show recipes](shows/README.md) supply premise, cast, style and joke seeds. | Editable timeline templates; show recipes and Create's Video launch cards are not timeline templates. |
| Authorization | The present Video manifest has authenticated routes and no named editor catalog. A retained preflight snapshot recorded a legacy Video `@app-admin` assignment. | Reviewed migration to explicit named operations, preserving the existing generator/series/pump paths. The historical snapshot is not a fresh claim about current grants. |

Source boundaries are defined in the core
[kernel-skills contract](https://github.com/emeraldcoastsystemsgroup/oshal/blob/2739e2501f8f8919780c8c723dbfea4dd76eccd2/docs/apps/kernel-skills.md).
Video already declares `uses: [media-generation, storage]`. The core's current
`renderVideo` API generates scenes; its private FFmpeg helper is not an exposed,
cancellable manual-editor API. Keep timeline rules and business storage in Video.
Do not copy the generation service or add application code to core.

## Preferred first delivery

Import two local clips, trim their ends, split a segment without changing its
source, reorder and join the resulting segments, add one timed title and one
audio bed, preview, save and reopen, then export H.264/AAC MP4. Existing generated
shorts remain available through the current Studio. A future Create “Edit video”
entry should delegate to this Video-owned editor rather than repurpose the
existing “Short video” generation entry.

The first slice proposes these conservative bounds. They require real fixture and
load validation before becoming advertised limits; the small proof below is not
a benchmark for them.

- Two source clips, each at most 30 seconds, 1920 by 1080 and 60 fps; 100 MiB per
  clip and 200 MiB total imports per project. Start with decoded MP4/H.264 with AAC
  or no audio. Additional codecs need their own fixtures before being accepted.
- A contiguous main video track with at most 20 non-destructive segments and
  60 seconds total; one title track and one optional WAV audio bed. No transitions,
  speed changes, nested compositions or multiple simultaneous video tracks yet.
- One explicit output profile: 1280 by 720, 30 fps, square pixels, H.264/AAC with
  web playback metadata. Silent inputs become silence; unexpected audio is never
  silently dropped. Preserve aspect by fitting into the chosen canvas.
- Bounded project JSON, asset count, total owner storage and retained revisions.
  Proposed initial ceilings are 256 KiB JSON, 20 assets, 500 MiB per owner and 100
  retained revisions per project. Reject quota conflicts before publishing bytes.

## Package architecture and project contract

Keep the new screen and browser modules under `video/tools/editor/`; use the
existing shared theme bootstrap and semantic tokens. The editor must retain
unsaved edits during settings changes, failed network requests and imports. Use
the browser's media elements and Canvas for immediate editing feedback; a
lower-resolution FFmpeg preview using the same validated compiler provides the
authoritative comparison with export. Do not render a server preview on every
pointer move. Debounce explicit preview requests and cancel superseded previews.

Separate pure `timeline-model`, validation, history and compiler modules from
DOM controllers. A versioned document describes the output profile, ordered
segments, timed titles and audio references. Assets use opaque UUIDs plus verified
metadata; documents contain no filesystem paths, credentials, arbitrary URLs,
shell arguments or raw FFmpeg expressions. Store frame positions as bounded
integers in the chosen project time base and represent source trim boundaries
explicitly. Validate every arithmetic result and reject unknown fields.

Proposed Video-owned persistence:

| Record | Purpose |
| --- | --- |
| `video_edit_projects` | Current revision, title and exact verified owner issuer/subject. |
| `video_edit_revisions` | Immutable validated document and source/profile provenance. |
| `video_edit_assets` | Immutable uploaded media metadata, SHA256, size, duration, dimensions, codec and private path identifier. |
| `video_edit_revision_assets` | Owner-qualified references that retain assets used by any saved revision. |
| `video_edit_exports` | Explicit revision, snapshot hash, profile, status, cancellation state and immutable successful output metadata. |

Follow the established [Create migration](../create/migrations/001-create-projects.sql)
and [owner-qualified store](../create/src-routes/create-project-store.ts) patterns,
with separate Video tables and storage. Use owner-qualified SQL and foreign keys,
the established transaction-local identity/RLS pattern, immutable revisions and
optimistic `baseRevision` checks. Do not change ownership, grants or schema on
existing generation tables as a side effect. Migration account/RLS behavior must
be proved against a disposable PostgreSQL role, not inferred from a superuser test.

Private files belong under an operator-selected Video data directory outside the
installed package. Upload to a unique temporary file with bounded multipart
streaming, hash and probe its actual bytes, then publish an immutable UUID asset
only after metadata and ownership checks succeed. Never buffer a whole video in
browser storage or a shared process-wide media object. All read/download/range
requests first check current permission and exact owner. Reject symlinks and
unrecognized containers/protocols; never let an uploaded playlist fetch another
file or network URL. Native decoders receive only server-resolved local assets
with a restrictive protocol list and no network access.

Portable export needs media as well as JSON. A reference-only JSON file is a
same-install backup, not a self-contained project. Prefer a bounded archive with
one manifest and immutable media identified by hash; import remaps new owner UUIDs
and verifies all sizes/hashes before replacing the current draft. The core already
depends on JSZip and yauzl, so investigate their existing streaming interfaces
before proposing a dependency. Enforce compressed and expanded byte totals,
entry count and path rules. Archive handling and cross-install reopen are still
unimplemented and untested here.

## API, current authority and upgrade path

Proposed routes under the existing `/api/video` mount:

| Route | Behavior |
| --- | --- |
| `GET /editor`, `/editor/assets/:asset` | Fixed HTML/module allowlist; no user path resolution. |
| `GET /editor/capabilities`, `/editor/permissions` | Actual supported codecs/profiles/bounds and effective operations. |
| `POST /editor/media`, `GET /editor/media/:id` | Bounded immutable owner media and authenticated playback. |
| `GET/POST /editor/projects`, `GET/DELETE /editor/projects/:id` | Own project collection, creation, read and optimistic deletion. |
| `POST /editor/projects/:id/revisions`, `GET /editor/projects/:id/revisions/:revision` | Immutable optimistic save and exact historical read. |
| `POST /editor/projects/:id/exports`, `GET /editor/exports/:id` | Capture one saved revision, enqueue bounded work and report progress. |
| `POST /editor/exports/:id/cancel`, `GET /editor/exports/:id/download` | Cancel only the owned job; return output only after current read/export checks. |

Use explicit editor view/read/create/change/delete/export operations scoped to
`own`, with reader/creator/editor/exporter/admin role combinations; owning an
admin role must not grant access to someone else's media. A cleanup operation
requires the named delete permission. Cancellation can use owned export authority
without granting project deletion. Upload requires create OR change in the route;
if the catalog supports only `allOf`, its outer binding must not accidentally
require both. The actual core mounter and route must both be exercised in tests.

Obtain identity only from `ctx.authorization.currentActor()`, never a request
header/body owner, tenant selector or stored actor string. The current package
authorization interface exposes `currentActor`, `authorize` and resource
registration; it does not expose a durable credential or a restart-safe identity
replay facility. A bounded asynchronous job may retain the original verified
async execution context only while that request-created work remains alive.
Recheck current authority after queueing, before media access, during long work,
and before publishing output. An implementation must demonstrate that context
propagation and policy revocation work; it must not manufacture an actor after
restart or borrow an administrative service identity.

Persist job intent and outcome without holding a database client during probing
or encoding. Bind a job to its saved revision, source/catalog generation and
process epoch. On restart, expose unfinished prior-epoch jobs as interrupted;
an explicit newly authorized retry creates a fresh attempt. Do not automatically
replay jobs under serialized identities. If autonomous restart recovery becomes
required, review the existing framework execution authority contract separately
before adding any core facility.

Introducing the catalog can trigger the same
[AUTH-07 upgrade boundary](https://github.com/emeraldcoastsystemsgroup/oshal/blob/44c2aafbb7cdf80b4b4760a1b067c1dfd4275c55/docs/backlog/enterprise-authorization.md)
observed for Create. Preserve the exact working Video package/catalog, inventory
affected assignments, preview old/new permissions and explicit mappings, and
coordinate normal reviewed UAM actions. Keep existing generator/series/pump
bindings complete. Never silently convert a legacy management role into broader
editing or generation grants, remove a grant to force activation, or claim the
reviewed catalog-upgrade workflow already exists. Root owns that deployment plan.

## Engine, cancellation and resource decisions

Use an injectable Video-owned adapter around the existing runtime FFmpeg/ffprobe
binaries, with `spawn`/`execFile` argument arrays and fixed filters generated from
the validated model. [Scan-to-Print's image ingest](../scan-to-print/src-routes/image-ingest.ts)
is an existing package precedent for bounded direct FFmpeg use. It is a reference,
not a reason to import another package's private module. A reusable new core media
execution API would require a separate reviewed framework change; this plan makes
no such change and adds no dependency.

Proposed admission is one active encode for this Video process, one running job
per owner and at most four queued jobs, with a 30-second queue deadline. A global
short-lived advisory lock or explicit single-worker configuration is needed
before claiming the same bound across API replicas. Keep database transactions
short. Apply the proven Create write-admission pattern where current policy reads
share the same small pool; do not increase pool sizes to hide nested checkouts.

Proposed worker limits: two FFmpeg threads, bounded filter threads, 120 seconds
wall time, 256 MiB temporary workspace and bounded logs/progress. The isolated
proof used one CPU, 512 MiB memory, 128 PIDs and 128 MiB tmpfs; those Docker limits
are proof isolation, not limits that ordinary in-API child processes magically
inherit. Choose a supported OS/process limit facility or a reviewed worker
boundary before claiming a hard per-export memory ceiling. Do not give the
package a Docker socket or mount the live workspace into an encoder container.

Explicit cancel, timeout, policy revocation and package teardown must terminate
only the tracked child, escalate from TERM to KILL after a bounded grace period,
wait for process exit and remove only its private temporary directory. A cancelled
or stale generation may never publish an output. Write the success record only
after verifying the real output metadata and repeating authority/CAS checks.
Polling a job does not create or retry it. Enforce bounded cleanup for unattached
assets while retaining every file referenced by a saved revision or active job.

## Isolated FFmpeg evidence

The ignored core workspace proof uses the existing local image
`sha256:e3b80133a6de8289f905b4211bd008ca0d9e2d2e262d94f78e8477334e1556fd`,
not the installed API container. It has no network, credentials, published ports
or host bind mounts; it runs non-root with a read-only root and disposable tmpfs.
The image provides FFmpeg 8.0.1 and the required font without downloading anything.

The literal filter graph trims source B from 0.8 to 2.4 seconds, places it first,
then joins two non-destructive source-A segments (0.4–1.0 and 1.0–1.6). It adds a
title during the first second, retains each clip's audio and mixes a 220 Hz bed.
The proof exports real H.264/AAC MP4 and decodes the result for inspection.

- Output: 2.800 seconds, 70 video frames at 25 fps, 320 by 180; video and audio
  start at zero and both declare 2.800 seconds. Decoded AAC has 2.816 seconds of
  samples because of codec padding; this is recorded rather than called drift.
- Decoded frames show blue before red; 767 white title pixels at 0.4 seconds and
  none at 1.2 seconds. Audio analysis detects 880 Hz in the first clip and 440 Hz
  in the second, with the quieter 220 Hz bed in both windows.
- A separate real FFmpeg process is cancelled by TERM and observed closed before
  its 20-second workload finishes. Temporary files and the unique disposable
  container are removed. No service or business state is modified.

The first uniform-color proof only establishes filter/output ordering and total
duration. The revised proof adds source-frame counters and compares decoded source
and output pixels at selected offsets on both sides of the split. Its final
result and exact metrics are in `temp/create-video-editor-ffmpeg-proof-v2.json`,
with the actual export and preview under `temp/create-video-editor-proof-*-v2.*`.
All four sampled source positions matched; incorrect source offsets produced
larger pixel errors. The revised cancellation completed in 652 ms and both
temporary-file and container cleanup checks passed.
The earlier receipt remains immutable. These are operator-local ignored artifacts,
not shipped tests or an installed editor claim.

This is engine/filter feasibility, not a validated editable timeline compiler,
browser preview proof, durable project test, codec compatibility matrix, long-job
authorization proof or production performance measurement. Those remain required.

## Delivery sequence and done-when evidence

1. **Agree the boundaries:** approve initial codecs/profiles/limits, Video-owned
   process adapter, archive format and explicit catalog upgrade. No new dependency
   or core API is implied by this plan.
2. **Model, owned media and persistence:** validate real uploads, immutable owner
   assets, integer timing, split/trim/reorder operations, undo, optimistic revisions
   and portable round trips. Prove cross-issuer denial and conflicts using the
   actual core authorization plus disposable PostgreSQL, including a max-two pool.
3. **One usable editor path:** import two clips through the native file picker,
   trim/split/reorder, title/audio controls, keyboard equivalents, preview,
   save/reopen, export and cancel. Check actual decoded frames and audio as well
   as UI state, dirty-draft preservation, all shared palettes and narrow layouts.
4. **Install the reviewed slice:** register every shipped suite in Video's AI Test
   Lab catalog with honest FFmpeg/PostgreSQL/browser prerequisites; test legacy
   catalog migration in isolation before reviewed live activation. Preserve other
   package/configuration/grant records and clean disposable native projects.
5. **Add AI only after manual state is durable:** a proposal references the exact
   selected clip/range and revision, shows the change and cost, and creates a new
   revision after explicit acceptance. Keep original media and the accepted manual
   edit. Regional generation, advanced masks, stock/template libraries, multitrack
   editing and full desktop interchange remain later capabilities.
