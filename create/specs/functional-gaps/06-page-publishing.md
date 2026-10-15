# CREATIVE-GAP-06 — Multipage layout and print production

Priority: P2. Proposed owner: AI Office/presentations publishing mode; Create launches it.

## Functional scope and acceptance

Existing foundation: generated documents/decks, layouts, themes and brand kits. This gap is precise editable publishing, not basic document creation.

First delivery:
- Facing/single pages, page sizes, margins, bleed, guides, master pages and page numbering.
- Linked text frames, overflow indicators, paragraph/character styles and placed owned images.
- Numeric object positioning, alignment, reusable styles and font substitution reports.
- Export with trim/bleed marks and a preflight report for missing fonts/assets, text overflow and inadequate image resolution.

Model: document pages and master references, stable frame IDs, ordered text stories and layout rules. Text linking must reject cycles and preserve reading order. Font metrics and shaping must match preview/export; choose one authoritative layout renderer.

Formats: native layout project plus PDF export with embedded permitted fonts. PDF/X and CMYK/spot-color claims are deferred until ICC conversion, output intent and independent validator proof exist. InDesign interchange is separately scoped.

Acceptance: build a four-page brochure with linked story, master header and bleed image. Reopen preserves layout; exported page dimensions, text order, embedded fonts and image positions match preview. Deliberately overflow a frame and remove a font; preflight catches both before a clean export is claimed. Verify actual print-scale output.

Later: tables, footnotes, complex scripts, PDF/X, spot colors and packaging linked resources.

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
