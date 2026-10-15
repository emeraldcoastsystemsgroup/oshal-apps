# CREATIVE-GAP-05 — RAW photography and photo library

Priority: P2. Proposed owner: Proposed photo-library package; Create receives developed images.

## Functional scope and acceptance

Existing foundation: portrait workflows, generic file picking and raster edits. No RAW development/library implementation was identified in the reviewed packages.

First delivery:
- Import a bounded, published camera/RAW-format support matrix; extract metadata and thumbnails while keeping originals immutable.
- Non-destructive exposure, white balance, highlight/shadow, tone curve, crop/straighten and denoise controls.
- Lens correction only for supported identified profiles; absent profiles are visible.
- Collections, rating, tags, search and batch application of development settings.

Model: content-hashed original, metadata, development recipe/revision and cached previews. Duplicates reference one original; deleting a collection does not delete originals. Select an existing maintained RAW engine after testing decoding, licensing, arm64 availability and color fidelity. Do not write a demosaicer for the first release.

Formats: explicitly list tested RAW variants; export sRGB JPEG/PNG initially. Specify input/output ICC handling, working space, bit depth and clipping. TIFF, wide-gamut and high-bit-depth export require separate fixtures.

Acceptance: use licensed sample RAWs from several supported cameras, including clipped highlights, low light and rotated metadata. Adjust/reopen/export with stable color and preserved originals. Unsupported camera/variant returns a useful refusal. Batch cancel preserves completed results and does not duplicate library entries. Test duplicate import and offline/missing originals.

Later: tethering, geolocation, face grouping, HDR merge and panorama stitching.

## Shared delivery contract

Status: specified backlog, not implemented or installed. Requested 2026-10-11.
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
