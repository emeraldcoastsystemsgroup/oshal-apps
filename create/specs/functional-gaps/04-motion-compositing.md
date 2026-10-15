# CREATIVE-GAP-04 — Motion graphics and compositing

Priority: P2. Proposed owner: Proposed motion-studio package; Video consumes renders.

## Functional scope and acceptance

Existing foundation: generated brand graphics plus Scene Studio access to Blender/Godot. No dedicated editable 2D composition workspace was established by this review. Reuse suitable existing engines after a fit evaluation.

First delivery:
- Composition with raster, vector, text and nested composition layers; time ranges, masks, parenting and transform origins.
- Keyframed position, rotation, scale and opacity with linear, hold and cubic easing; editable motion paths.
- Solid/gradient backgrounds, blur, shadow and basic chroma key with explicit premultiplied-alpha semantics.
- Scrubbing, work-area preview and deterministic frame rendering; compositing runs locally without generation.

Model: composition dimensions, rational frame rate, integer frame duration, stable layer IDs, keyframes and immutable assets. Refuse composition/parent cycles. Sharing a keyframe schema with Video requires a tested contract; do not couple their project stores.

Formats: native composition JSON, PNG frame sequences with alpha and MP4 for opaque output. Transparent video codecs are a later explicit profile, not an assumed MP4 capability.

Acceptance: create a five-second animated logo with eased motion, a masked photo and editable caption; render a transparent PNG sequence and opaque MP4. Check first/middle/last reference frames, alpha fringes, nested timing and reproducibility. Save/reopen and undo retain animation curves. Video imports the result with source composition/revision lineage.

Later: rotoscoping, tracking, particles, expressions, advanced keying and 3D compositing.

## Shared delivery contract

Status: implementation in progress; compositor foundation is source-tested, application and installed acceptance remain open. Requested 2026-10-11.
Functional scope drives this spec; manual operation must work without an AI provider.

Reuse current application authorization, owner-qualified assets, revision conflicts,
undo/history, artifact handles, job cancellation and ledger where relevant. The same
validated model operations may be exposed to agents; that does not expand authority.
Recheck permissions at save/export and job completion. Never replace a newer revision
with an older result. Existing installed behavior is a regression gate.

Before implementation, freeze schema, route/tool catalog, migrations, engine choice,
format matrix and quotas in the owning package. Extend existing routes where suitable;
new project APIs use create/read/apply-operations/save-revision/export/job-status/cancel
with baseRevision and idempotency keys. Read/export/delete remain separate grants.
Do not add new kernel app-specific state.

Measure preview latency, peak memory, file size and export duration on the DGX arm64
host and a browser client. Publish supported dimensions/durations/object counts and
concurrency limits from those measurements. Acceptance requires real render/decode
fixtures, browser workflows, two-owner/permission-revocation checks, cancellation and
installed Test Lab receipts. Source-only proof is not installed acceptance.

## Current source evidence and remaining acceptance

The Motion Studio [source prototype](prototypes/motion-studio/README.md) uses the
pinned EffectCraft core/host/automation at
`67434e90388b6dca4417555346fa6850b6f96033`, retains licenses and the complete
admitted native graph format, and has real routes, narrow manual editing UI,
saved manual layer organization/parenting/timing/multi-layer nesting,
actual effect-schema controls and gradient/blur/shadow/chroma-key pixel proofs,
exact native current-time scene property observations/changed-only setters,
independentXYZtransforms and actual camera/light projection/lighting controls,
exact keyframe inspector/curve/path editor and native cubic pixel proofs,
saved work-area play/pause/loop/frame-step preview with exact rational ticks,
exact native multiline caption/typography/Unicode selection workflows,
saved native mask settings, exact-time animated Bezier vertex/tangent editing
and native variable feather points with real alpha/history/agent page proofs,
exact current-time native effect-instance observations, native UTF16 string patches,
section/file-based large human value editing and full original-principal agent value staging and changed-only animated parameter edits,
original-person authorization, thirty-eight declared source agent tools and a source
Test Lab. It is not yet a registered/installed marketplace application.

Verified source work includes actual masks/text/keys/owned footage, immutable
SQL revisions and precise native i64/u64 transport; private durable raster and
revision files with original source/tenant/principal/grant checks; full 64-large-
photo and 1000-file history cardinality; OS leases plus SQL commit fencing and
real package-child crash/revocation tests; and full-capacity portable archives
with atomic opposite-owner copies that remain editable after sender deletion.
Request-owned private staging now preserves the full 264MiB archive envelope
through bounded resumable chunks, fresh original authority, safe retry offsets
and uncertain metadata/SQL acknowledgements. Protected source HTTP, human
import/export and eight bounded agent transfer declarations are now connected;
Incremental browser checksums and optional verified native file-stream saves
avoid whole-file hashing buffers; installed acceptance remains pending.
Controlled source/role seams and explicit cardinality seeding do not stand in
for production authority, hosted agent approvals or installed acceptance.

The new render producer makes actual transparent PNG frame archives and opaque
H264 MP4 from a pinned composition/revision without replacing the native data.
Frame schedules use the composition's rational rate and exact native ticks,
and direct exact-tick compositor calls avoid floating-second rounding. Producer
receipts include document digest, composition id, project/revision, exact work
range, actual dimensions, rate/frame count and output digest/length. Export/read
and matching original caller are checked throughout rendering and backpressure.
Cancel/deadline/revocation stop production and terminate only its own encoder.
MP4 is opaque; odd dimensions are explicitly padded to even H264 dimensions.
Transparent video codecs remain a separate unimplemented profile.

The native preview/render profile still caps the longest side at 4096 and each
PNG at 8 MiB; producer output is bounded at 264 MiB and a request-owned source
run at five minutes. These are explicit source profiles, not proof of unlimited
Adobe dimensions/durations/fidelity or a public HTTP runtime guarantee. Compositor
input retains the current 6 MiB compressed owned-source ceiling. Performance,
full project/history combinations and larger graph fidelity still need evidence.

Remaining required work: admitted durable job lifecycle/status/cancel that does
not retain expired request callbacks; generic full-envelope original-reader
transport; public human/agent export and portable file interactions; real Video
import with retained editable composition/revision lineage; marketplace extraction
and @admin installation; and installed two-owner/source/grant/sandbox/host-drop,
browser/agent/Test Lab acceptance. A source render or container self-test does
not prove these gates. The entire product-by-product upstream/Adobe matrix stays
open and must be verified beyond this Motion implementation.

Large-caption source proof preserves60000letters/66000characters in an explicit
300x160native paragraph box, with full human inspection and a minimal native-range
content edit. The initial unbroken60000letter1px point-text probe produced an empty
optimized native preview and exceeded45seconds in debug; that specific2Dpoint-text case is resolved by the full-surface derivative below;
Per-character3Dfull-glyph/aggregate-surface handling now has source proofs below;
other layouts/3Dfeatures and debug performance remain open. Do not
use the bounded paragraph proof to close that distinct upstream/Adobe case.

Full point-text source surfaces now retain original native bounds instead of the
±20000coordinate/16384side clips. The unchanged60000letter1px source renders real
glyph pixels (~3.5s optimized source fixture); native viewport-reference and source
coordinate/alpha/history/export/owner tests verify the change. Complete surfaces
within32MP are allocated, and larger/invalid surfaces report a refusal before any
completed frame. The exact pinned render derivative retains44files/both licenses
with39unchanged and5documented modifications; source identity/BOM bind that origin.
This closes the reproduced2Dpoint-text loss within the declared source profile,
not all typography/source/effect/hardware/Adobe limits or installed acceptance.

A deterministic native extraction helper now produces the complete real package,
oshal-app.yaml and private source receipt for@dispatch/@admin review. The extracted
candidate itself passes the actual importer and owned native SQL/engine caption and
foreign/withdrawn/grant workflows. It does not register/install anything or establish
live/hosted approvals. Node24/node:sqlite, managed Sharp, private lasting storage and
matching private engine are explicit admin prerequisites; all remaining full-format,
job, Video lineage and installed acceptance gates are unchanged.

Current per-character3D source follow-up: full native glyph surfaces replace silent4096side clipping within the explicit32MP per-text-layer aggregate profile; native viewport/plane pixels, budget refusal/recovery and human mode/history are source-tested. Installation and complete3D/Adobe fidelity remain open.
