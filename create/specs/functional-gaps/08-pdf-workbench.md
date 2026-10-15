# CREATIVE-GAP-08 — PDF workbench

Priority: P1 discovery, then P2 delivery. Proposed owner: Proposed PDF package integrated with existing Files and Print Ingest.

## Functional scope and acceptance

Evidence status: existing document intake/processing is confirmed; this review did not establish the full PDF editing surface. Inventory existing routes, engines and tests before implementation. Record which operations already exist and close/subdivide this gap accordingly.

First delivery after inventory:
- View, thumbnail, reorder, rotate, delete, merge, split and extract pages while preserving source files.
- Add text/highlight/ink annotations and fill standard AcroForm fields; save a new owned revision.
- Search selectable text and explicit OCR for scanned pages with language/quality reporting.
- True content redaction as a separately authorized operation, including hidden text, embedded images and metadata cleanup; visible rectangles alone are never called redaction.

Model: source PDF asset, revision, page identities and operation list; save creates a new artifact with lineage. Parse/render in bounded workers. Document signed/encrypted-file handling: signature-changing edits warn and create an unsigned derivative; unsupported encryption is refused. Digital signing is outside the first slice.

Formats: PDF input/output, annotations and standard forms according to a documented interoperability matrix. XFA, arbitrary original-text reflow and full Acrobat equivalence are deferred.

Acceptance: merge/reorder two fixtures, annotate, fill a form and reopen in an independent PDF reader. For redaction, extract text, enumerate objects/attachments and render the output to verify removed data is absent; test incremental-save remnants and metadata. If this proof is unavailable, ship the other operations without redaction. OCR reports uncertainty and never replaces the source silently.

Later: digital signatures, accessibility tagging, PDF/A, advanced forms and original-content editing.

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
