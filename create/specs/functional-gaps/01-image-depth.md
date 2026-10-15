# CREATIVE-GAP-01 — Advanced image editing

Priority: P1. Proposed owner: Create image editor.

## Functional scope and acceptance

Existing foundation: owned raster/text/shape/freehand layers, crop, transforms, basic filters, revisions and raster/portable JSON exports. Region selection and candidate regeneration exist in source; installation and provider acceptance are separately pending. These are not new gaps.

First delivery:
- Add persistent per-layer grayscale masks with brush/erase, invert, feather and disable; mask geometry uses source pixels and survives crop/transform.
- Add non-destructive adjustment layers for exposure, levels, curves and saturation with explicit whole-stack or clipped-to-layer scope.
- Add rectangular, elliptical and freehand selections with add/subtract/intersect, feather and selection-to-mask.
- Add group layers with deterministic opacity and transform semantics. Define whether group blending is isolated before implementation.

Model: introduce an explicitly versioned document migration. Masks reference immutable owned raster assets; adjustments store validated parameters, never baked replacement pixels. Preserve stable layer IDs and source assets. Existing v1 projects render identically after migration; older clients refuse unsupported versions rather than dropping properties.

Formats: first release supports the native project format plus PNG/JPEG output. PSD support belongs to GAP-09. Do not infer editable objects from a flattened image.

Acceptance: use a fixed layered fixture with text, a masked photo, two clipped adjustments and a transformed group. Save/reopen must retain every property; undo/redo returns exact state. Export and preview agree within a declared color/rounding tolerance. Brush strokes after zoom/rotation affect the intended source pixels. Disabled masks restore the source; changing adjustments does not modify source hashes. Test transparent edges and nested group opacity.

Later: smart objects, advanced blend modes, healing, perspective warp and high-bit-depth workflows. Implement blend modes only with reference pixels and documented color-space math.

## Shared delivery contract

Status: first-delivery source implemented; installed acceptance and qualification remain pending. Requested 2026-10-11.
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

## Delivery progress — 2026-10-11

Create 1.10.0 implements the first polygon-mask slice in source: region-to-mask,
invert, feather, disable/remove, version 2 persistence and shared preview/export.
Brush/erase, mask arithmetic, adjustment layers and group layers remain open.
Installed acceptance is pending; this does not close CREATIVE-GAP-01.

The first mask slice has local proof through the shared model, real Canvas pixels,
actual editor UI, actual HTTP router and disposable PostgreSQL. Native installation
and the remaining image-depth features still require their separate gates.

Create 1.11.0 extends the source delivery with bounded grayscale brush/erase
coverage, mask arithmetic, ellipse selections and non-destructive stack/clipped
exposure, levels, curves and saturation layers. V3 persists these properties
through the existing private project model. Group layers and installed acceptance
remain open. The mask implementation persists editable source-space operation
lists rather than adding a separate uploaded mask asset; normalization and source
ownership stay in the existing validator/store.

Create 1.12.0 adds isolated groups with ordered child IDs, bounded nesting,
ancestor locks and uniformly composed transforms. The first-delivery functional
set now exists in source: grayscale brush masks, mask arithmetic and shape
selection, stack/clipped adjustments, and isolated groups. Groups use uniform
resize and a fixed clipped frame; duplication and frame editing are deferred.
Manual child coordinates are local. Native installed acceptance and broader
performance/memory qualification remain pending; do not mark this gap complete
until its installed acceptance gate passes.

## Source followup — 2026-10-13

Nested isolated groups can now be duplicated through the existing human control
and the same validated agent operation. Copies preserve child coordinates, masks,
isolated opacity, transforms and immutable owned image references. Descendant IDs
and clipped adjustment targets are remapped inside the copy; only its root receives
the requested offset. Locked descendants, identifier collisions and existing layer,
group and geometry budgets refuse atomically. This supersedes the earlier deferred
group-duplication note; group frame editing remains open.

Source proof includes actual narrow-screen Duplicate/undo/redo/save/reopen, native
Canvas pixels for copied masked/clipped groups, independent copied adjustments and
agent batch atomicity. Browser storage and permission APIs in these source tests
are named synthetic fixtures, not installed acceptance. Live human/agent acceptance
remains required under the creative lane's installation handoff.
