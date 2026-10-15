# Creative functional gaps — backlog and delivery map

Requested 2026-10-11. Status: mixed source delivery and specified backlog; installed acceptance remains open. This inventory
compares functionality, not interaction style. Existing manual and generated work
is retained. ArtCraft is a comparison input, not a selected dependency or a verified
implementation: its current lineup labels applications early alpha/in development.

## Backlog

| ID | Functional gap | Priority | Owning area | Specification |
|---|---|---|---|---|
| CREATIVE-GAP-01 | Advanced image editing | P1 | Create image editor | [Scope and acceptance](01-image-depth.md) |
| CREATIVE-GAP-02 | Vector illustration | P1 | Create vector document mode | [Scope and acceptance](02-vector-editing.md) |
| CREATIVE-GAP-03 | Multitrack video editing | P1 | Video Studio | [Scope and acceptance](03-video-depth.md) |
| CREATIVE-GAP-04 | Motion graphics and compositing | P2 | Proposed motion-studio package; Video consumes renders | [Scope and acceptance](04-motion-compositing.md) |
| CREATIVE-GAP-05 | RAW photography and photo library | P2 | Proposed photo-library package; Create receives developed images | [Scope and acceptance](05-raw-photography.md) |
| CREATIVE-GAP-06 | Multipage layout and print production | P2 | AI Office/presentations publishing mode; Create launches it | [Scope and acceptance](06-page-publishing.md) |
| CREATIVE-GAP-07 | Audio recording, editing and mixing | P2 | Proposed audio-studio package; Video uses rendered mixes | [Scope and acceptance](07-audio-production.md) |
| CREATIVE-GAP-08 | PDF workbench | P1 discovery, then P2 delivery | Proposed PDF package integrated with existing Files and Print Ingest | [Scope and acceptance](08-pdf-workbench.md) |
| CREATIVE-GAP-09 | Creative format interchange | P1 scoped alongside image/vector work | Owning editor imports/exports; shared Files provides transport | [Scope and acceptance](09-format-interchange.md) |

## Sequence and dependencies

1. Establish current baseline: Create region edits and Video timeline have source
   progress but retain installed/live gates in their existing records. Finish those
   gates under CREATE-EDIT-04/-05; they are not duplicate new features.
2. GAP-01 image masks/adjustments and GAP-02 vectors can proceed as separate bounded
   extensions. GAP-09 supplies their explicit interchange contracts and fixture corpus.
3. GAP-03 extends the installed Video foundation. GAP-04 follows a shared timing/
   keyframe contract and engine evaluation; it does not require a new video generator.
4. GAP-08 starts with discovery because existing PDF coverage is not fully established.
   Deliver basic page operations before commissioning true redaction.
5. GAP-05, -06 and -07 are separately commissioned capabilities. Publishing reuses AI
   Office; audio integrates with Video; photography sends developed images to Create.

These rows decompose CREATE-EDIT-08; they do not supersede the existing baseline,
brand-kit, handoff or region-generation rows. Priorities express proposed order,
not calendar commitments. CAD and Office generation already exist and are not
recorded as missing applications. A complete absence claim for PDF/audio/photo
requires the initial owner inventory across installed packages and engine bridges.

## Definition of ready and done

Ready: owning package and gap inventory confirmed; schema/operation semantics,
format subset, migration and engine/dependency decision reviewed; fixtures and
measured performance envelope specified. Engine investigation should inspect
ArtCraft source only for a concrete candidate capability; validate correctness,
license, platform support and maintainability before adopting code.

Done: manual task acceptance in each spec passes on actual output; private save,
reopen, undo, cancellation and permission behavior pass; supported/lossy formats
are documented; installed receipts exist; old projects and installed workflows
remain compatible. Record source proof, installed proof and live provider proof
separately. Do not close a feature from an advertised upstream checklist.

## Evidence and limitations

Local baseline: [Create editor](../../EDITOR.md), [Create backlog](../../BACKLOG.md),
[Video plan](../../../video/EDITOR-PLAN.md), [Video timeline compiler](../../../video/src-routes/video-edit-compiler.ts),
[AI Office](../../../presentations/README.md), [CAD Studio](../../../cad-studio/README.md),
[Scene Studio](../../../scene-studio/README.md), [Print Ingest](../../../print-ingest/README.md).

External comparison, consulted 2026-10-11: [ArtCraft app lineup](https://getartcraft.com/apps)
and [PhotoCraft source/README](https://github.com/storytold/photocraft). The latter
advertises masks, adjustments and PSD work; this planning pass has not audited
upstream implementations or selected them as dependencies.

## Source delivery and agent integration

Image depth, vector editing/SVG and multitrack video have first-delivery source
implementations. Create 1.14.0 and Video 1.11.0 add dedicated editing agents and
bounded original-owner API tools over those existing models. Format interchange
has only its SVG portion. Motion/compositing, RAW, publishing, audio production
and PDF remain specified, unbuilt additions. No entry is fully closed until its
installed/manual acceptance passes. Agent declarations are source deliveries,
not evidence of a live model turn or deployment.

## Full completion goal

Roger's active goal requires the original completion standard to become true:
usable human/agent workflows, verified product-by-product functional coverage,
editable integrations and installed end-to-end acceptance. The first-delivery
scope is an implementation sequence, not a substitute for that goal. The
[coverage and evidence matrix](coverage-matrix.md) tracks the broader work and
keeps unverified requirements open.
