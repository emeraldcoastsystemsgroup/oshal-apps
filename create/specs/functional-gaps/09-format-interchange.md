# CREATIVE-GAP-09 — Creative format interchange

Priority: P1 scoped alongside image/vector work. Proposed owner: Owning editor imports/exports; shared Files provides transport.

## Functional scope and acceptance

Existing foundation: Create v1 JSON plus raster formats; Video native timeline/MP4; Office formats; CAD STEP/STL; Scene Studio engine-native files. Those remain existing capabilities. This gap covers unsupported professional creative formats and fidelity reporting.

First delivery:
- Publish a per-format/per-feature matrix with editable, rendered-only, flattened, unsupported and refused outcomes.
- Implement a bounded PSD import subset: pixel layers, groups, opacity, transforms and named supported blend modes. Preserve the original PSD; unsupported text/effects get an explicit report and optional rendered fallback.
- SVG import/export follows GAP-02. Native portable projects retain layers and references with no arbitrary network fetches.
- Add loss previews before accepting conversions, and source/revision lineage on returned artifacts.

Architecture: adapters belong to the editor package; parsing/rendering uses bounded workers and named codecs. External engines must pass licensing/dependency, arm64 and resource-budget evaluation. No ArtCraft library has been selected. Sharing code depends on an actual source/API/license assessment, not its feature list.

Acceptance: a small public/licensed fixture corpus covering each supported PSD feature and each explicit unsupported case. Import/edit/save/reopen/export and inspect actual editable properties, not only flattened screenshots. Report unsupported features deterministically. Compare rendered results against reference images with tolerances published per feature. Refuse corrupt, oversized and adversarial files without publishing partial projects.

Later: PSD export, Illustrator/AI, external video timelines, InDesign/IDML and other formats, each commissioned separately. Do not advertise round-trip compatibility until both editable semantics and rendered output are independently verified.

## Shared delivery contract

Status: SVG source subset implemented; other interchange additions and installed acceptance remain pending. Requested 2026-10-11.
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

## Source progress — 2026-10-11

Create 1.13.0 adds an explicit SVG import/export subset with geometry, cubic nodes,
strokes, local user-space gradients/clips and native text metadata. Actual pixel
and editable-property round-trip fixtures cover that subset. Unsupported features
refuse import/export rather than silently flatten. SVG hierarchy/font limitations
are in the editor format matrix. PSD and the other advanced format adapters remain
open. No upstream ArtCraft code has been selected or copied.


## Bounded PSD source progress — 2026-10-13

Create1.15.0 implements the explicit [PSD profile1](psd-format-matrix.md): editable
RGB8 PSDv1 pixel layers, normal isolated fixed-frame groups, opacity and placement;
raw/RLE planes only. Exact immutable originals and conversion findings share the
same original-owner transaction as normalized PNGs and revision1. Human review,
explicit flattened choice and original-owner held agent imports integrate with
existing image refs/history/current grants. Real binary/licensed/independent
pixels, atomic rollback/roles/full4MiB original/quota and desktop/phone/retry
source checks pass. Native route matcher/artifact/approval and installed acceptance
remain pending; unsupported semantic descriptors are preserved opaque, and no
full PSD validator/export/fidelity or Adobe product parity is claimed.
