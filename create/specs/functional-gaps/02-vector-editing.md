# CREATIVE-GAP-02 — Vector illustration

Priority: P1. Proposed owner: Create vector document mode.

## Functional scope and acceptance

Existing foundation: basic shapes and freehand paths. That is not a general vector illustration engine.

First delivery:
- Pen tool with cubic Bezier paths; node insertion/deletion, smooth/corner conversion and independent handles.
- Fill/stroke, cap/join/dash controls, clipping paths, gradients and deterministic z-order.
- Union, subtract, intersect and exclude for closed paths; preserve editable inputs until an explicit flatten operation.
- Align/distribute, snapping and numeric transforms; text remains editable with missing-font warnings.

Model: owned document containing stable object IDs, path segments, transforms, paint definitions and references. Boolean operations produce a new object and retain source operands in revision history. Specify winding rule, curve tolerance and coordinate precision. Reuse Create persistence and selection rather than a second project store.

Formats: allow a documented SVG subset: paths, groups, shapes, text, gradients and clip paths. Strip/refuse scripts, event handlers, external URLs and unsupported filters with an import report. Native JSON preserves editor semantics; SVG exports supported vector content; PNG is explicitly flattened. AI files and arbitrary SVG fidelity are outside the first release.

Acceptance: edit a curved logo, subtract a hole and export/reimport SVG. Verify topology, bounds, paint and text retention. Cover self-intersections, coincident edges, negative scales, nested transforms and missing fonts. Compare rendered SVG against native output with declared tolerances; unsupported content must be reported rather than silently lost.

Later: text on path, advanced typography, symbols, variable-width strokes and print color support.

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

## Source delivery — 2026-10-11

Create 1.13.0 integrates cubic pen/node/handle editing, smooth/corner conversion,
De Casteljau insertion, stroke cap/join/dash, linear gradients, polygon clips,
four bounded worker booleans and root alignment/distribution/grid movement.
Original boolean operands remain hidden editable layers; curve flattening uses
0.1 canvas-pixel tolerance. Cubic extrema bound arrangements/groups.
The implemented SVG matrix is in the editor guide: supported geometry, user-space
gradients/clips and native text round-trip; unsupported dialects refuse. Unclipped
opacity-1 SVG groups flatten with a warning; other group imports are deferred.
Local vector/UI/actual-pixel proof exists. Installed acceptance and full external
format compatibility remain open; do not close the gap solely from source proof.
