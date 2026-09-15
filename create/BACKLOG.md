# Create: visual creation and editing roadmap

Requested 2026-09-11. **The operator activated the advanced editor as a parallel
track on 2026-09-12. The Create 1.5.0 foundation checkpoint was installed from source
`b92013b48d6f705138617b5816c7d49581a28257`, implementing the first manual image/project slice.
All 163 local checks pass, as do final native acceptance and four installed Lab
runs totaling 45 checks.** The existing
launcher, theme and Scan-to-Print work remain delivered.

Completed compatibility correction **1.2.2 (2026-09-12)**: existing Home and New surfaces
follow the portal palette and preserve the original skin through Application colors.
Nine real Chromium cases cover palette changes, retained search/document state,
cross-tab synchronization and readable labels. This correction does not implement any
of the deferred editing phases below. [Registered proof](tests/test-lab.yaml).

## Home and New layout checkpoint (1.3.0)

Home now presents a compact introduction and one template-catalog action, then saved
work, quick-start formats and actual studio cards. New has a direct Home return,
one card per published template, and format/purpose filtering. Responsive wrapping
keeps controls within 320px, 768px and desktop viewports. Keyboard section jumps
and regenerated filters retain focus; search Enter preserves the chosen format.
Current studio access, summary failures, Office queries and palette behavior remain
covered by the real-page fixture.

Ten added Chromium cases and the nine existing palette cases cover this slice;
the existing twenty Node/HTTP checks remain required. This is a partial delivery
of CREATE-EDIT-01's launcher/navigation portion. That 1.3.0 acceptance did not include an active editor. The 1.5.0 image
canvas, assets and properties are a separately commissioned slice; video timelines
and regional AI editing remain open.

## Scan-to-Print launcher (1.4.0)

The existing 3D Scan-to-Print application is part of the Studios rail, Home's
studio/quick-start catalog and the New screen's **3D & print** category. It retains
its own capture, reconstruction, review and confirmed printer workflow. Create
reuses existing access checks and its owner-scoped summary, with no artifact
parameters or automatic camera/job/print actions. The registered real-page
browser recipe covers navigation, denied access and summary failures. This
addition does not implement the image/video editing phases below.

Installation and native launcher acceptance completed on 2026-09-12 at source `4244a002`.
The [installed acceptance record](README.md#installed-acceptance-2026-09-12) identifies the
version, scope, registered recipes and passing installed Node runs. Physical printing and
the deferred editing phases are outside that acceptance.

## Image editor checkpoint (1.5.0)

The active parallel track delivers image/text/shape/freehand layers, direct
movement and resizing, source crop, rotation/opacity/basic adjustments,
visibility/locking/order, owned assets, immutable revisions, autosave, undo,
reopen and portable JSON/PNG/JPEG export. [Editor contract](EDITOR.md).

All 14 Lab cases are registered: 13 declared recipes plus generated readiness. The
[installation status](README.md#image-editor-installation-status) records the
installed source/core/image, final import/save/reopen/export/delete workflow,
four passing installed runs and strict cleanup/preservation. It keeps the 45
installed checks separate from 163 local checks and retains the earlier native
save at `6a49721e` and reopen/export/delete at `8df99d58`. Other linked browser
and host-dependent runners remain unavailable in the installed Lab.

This advances CREATE-EDIT-01, -02, -03 and -07 for manual images. Those broader
rows remain open for Jarvis selection, AI lineage, masks and video requirements.
CREATE-EDIT-04 is the next image milestone: selected-region regeneration into a
candidate child revision, preserving manual text and locked objects. A separate
video track can implement CREATE-EDIT-05 with the Video owner. No complete
Canva/Adobe feature parity or provider editing is claimed by this slice.

## Image handoff and context checkpoint (1.7.0)

The next integration slice reuses the shared artifact receiver and surface bridge.
An image opened in Create reaches the editor as an editable image layer. Delayed
imports cannot overwrite a different project or a newer draft. Jarvis receives
bounded project and selected-layer context; it cannot mutate the document through
this read-only integration. Two browser recipes are registered in the package
catalog and can run together through the core's `test:package` command.

This advances CREATE-EDIT-01 and -03. Region regeneration, candidate review,
automatic edits and video remain open. Create 1.7.1 is published and installed:
one native Lab batch passes all five registered Node recipes, 58 checks, with
verified cleanup. Both new browser recipes pass 28 checks in one host batch;
their installed browser prerequisites remain pending. The [editor contract](EDITOR.md)
and README distinguish those results and preserve the earlier failed batch.

## Product outcome

The 2026-09-13 UTC engineering request adds a parallel **editable CAD** track.
The [CAD Studio plan](../scan-to-print/CAD-PLAN.md) records the actual scan/mesh
baseline, engine recommendation, optional SOLIDWORKS adapter and CAD-01 through
CAD-10 with acceptance gates. The first product checkpoint is an editable plate
with holes, parameter changes, save/reopen and independently verified STEP/STL
exports. Create owns the consistent entry; the proposed CAD application owns
its documents and worker. This is planned work; the delivered Scan-to-Print
launcher does not provide CAD editing. Video remains an independent active track.

The [product brief](PRODUCT.md) translates the requested “Canva but better”
direction into tasks, workspace behavior, parallel ownership and release gates.
Create 1.6.0 is installed at `54c1e789`, adding eight original editable image
templates. Source checks and native standalone editing, 58 installed Node checks
and strict preservation are recorded separately in the README. The parallel
[Video editor plan](../video/EDITOR-PLAN.md) has passed an isolated FFmpeg
feasibility proof. Video's timeline UI, storage and export jobs remain open.

Make Create a cohesive creative workspace with Canva-style ease of use: start
from an idea, template, upload or saved artifact; generate with AI or edit by
hand; point at what should change; review a new version; keep editing. Jarvis and
direct manipulation work on the same selected project, object, image region or
video segment. A person can finish a small change without another generation.

The supplied editor screenshot establishes the interaction direction: an asset
and template rail, a large central canvas, nearby editing controls, and a timeline
for video. The first product improvement is clearer page layout and working space.
Professional image/video editing depth is a later target, after the basic loop is
usable. The requested examples are circling an image area for a change, adding a
title, applying a simple filter, joining two videos, and adding sound.

## Existing capabilities to reuse

- Create owns New/Home, studio discovery, recent-work summaries,
  access-aware entry and a bundled theme. The commissioned 1.5.0 slice adds
  a private layered-image project store and reusable manual renderer. [Current package](README.md), [Home contract](HOME.md).
- Portrait Studio owns uploads, the shared artifact picker, local crop and face
  boxes, camera input, reference-image generation, a protected gallery and image
  exchange. Its prompt choices called layers are not independently editable
  canvas objects. [Portrait](../portrait-studio/README.md).
- AI Office owns structured document editing and editable Office outputs. Keep
  presentations, documents and workbooks in that application.
  [AI Office](../presentations/README.md).
- Video owns scene/storyboard, voice/music and rendering behavior. Extend that
  owner for media editing and export. [Video](../video/README.md).
- Reuse the registered artifact source/destination exchange and current user
  permissions for handoffs. Its temporary handles transport an authorized asset;
  durable projects need their own saved asset and revision references.
  [Authoring contract](../BUILDING-EXTENSIONS.md#joining-the-artifact-exchange--send-to-adr-139).

## Next steps (2026-09-14)

The brand kit's first slice is released at store `df09dd73` and documented in
[BRAND-KIT.md](BRAND-KIT.md), which carries the ordered steps and their commands. In short:

1. The local box needs its Docker engine started and `scripts/oshal-up.sh` run; every container is
   stopped as of 03:40 UTC.
2. Create 1.8.0 is **not** installed there. It needs the AUTH-07 sequence, because a release that adds
   routes changes the authorization catalog and the runtime refuses to activate it while an assignment
   holds the previous revision: revoke the role in Access, install and restart once, grant the role
   again. Create on the box is the restored 1.7.1 until then; AI Office 2.12.0, Portrait 1.15.0 and
   Video 1.5.0 are staged and inert.
3. The next slices are CREATE-EDIT-11 through CREATE-EDIT-15 below. CREATE-EDIT-11 (several kits)
   changes the stored shape, so it comes before CREATE-EDIT-12 and CREATE-EDIT-13 if several are taken.
4. Drawing a deck, document or workbook in the brand's exact colors and faces is a core change,
   specified in the core backlog on 2026-09-14 and not started; it needs the operator's approval.

## Phased backlog

| ID | Sequence | Deliverable | Done when |
|---|---|---|---|
| CREATE-EDIT-01 | First | Clear Create page and workspace layout | New, recent projects and templates have consistent navigation; an active project has a prominent canvas, asset panel and contextual properties; the video timeline appears for video work. Jarvis remains available beside the selection. Normal laptop and narrow layouts, keyboard use, focus and light/dark contrast pass browser acceptance. |
| CREATE-EDIT-02 | Foundation | Durable editable projects and revisions | A project retains canvas size, assets, editable objects/tracks, source links and revisions in the owning application's store. Autosave, undo/redo, reopen, explicit duplicate and conflict handling preserve work across refresh/restart. AI outputs reference the exact source revision and never silently overwrite later manual edits. |
| CREATE-EDIT-03 | Basic image editing | Image canvas with direct manipulation | A user can open an upload, existing artifact or generated image; crop, resize, rotate, place/edit text and simple shapes, draw annotations, apply basic adjustments/filters, and arrange supported objects. Undo/reopen preserves the editable state; exported PNG/JPEG matches the preview. These manual operations need no generation call. |
| CREATE-EDIT-04 | AI editing loop | Point, describe, regenerate, compare, accept | A user circles/brushes a region or selects an object, enters an instruction, and receives a candidate child revision. The request includes the source revision and structured region/object context. Accept, reject, compare and undo work; cancel/provider failure preserves the last accepted version. Two complete generate/edit/regenerate/edit cycles retain the person's intended manual changes. |
| CREATE-EDIT-05 | Basic video editing | Small timeline and audio editor | A user imports two clips, trims/splits, reorders and joins them, adds a title and audio, adjusts timing/volume, and previews the result. Save/reopen retains the timeline and export produces a real playable video with correct duration and audio synchronization. Simple fades/filters are scoped capabilities, with unsupported formats clearly reported. |
| CREATE-EDIT-06 | Integration | Open in another editor and return | Images/videos generated in one studio open in a compatible registered editor with source/project/version context. The returned edit becomes a linked revision available for further generation. Destination discovery, reads and writes recheck current permissions. Editable content travels in a supported project format; an export that flattens it explains the loss before handoff. |
| CREATE-EDIT-07 | Later | Layered image projects | Text, shapes, placed images and supported masks remain independent objects with order, visibility, locking, opacity and transforms. Import/export preserves each feature the selected format supports. A flat AI image starts as a raster layer; optional segmentation is a separate reviewed operation, with its limitations visible. |
| CREATE-EDIT-08 | Advanced, deferred | Deeper image and video editing | Commission bounded additions such as advanced masks, vector paths, adjustment layers, richer typography, multitrack video/audio, transitions, keyframes, color controls and captions. Each addition has an interoperability matrix, practical performance budget and a real export/reopen test. Advanced desktop-editor format compatibility needs separate evidence per format and feature. |
| CREATE-EDIT-09 | Delivered in 1.6.0 | Original editable image templates | Eight useful designs have actual rendered previews, search/category filters, accessible selection and fresh independent projects. Dirty cancellation and modal keyboard/paste isolation preserve the entire draft; permissions apply; save/reopen and real exports preserve the editable composition. Installed standalone acceptance, Lab results and the separate recovered origin interruption are recorded in the README. |
| CREATE-EDIT-10 | First slice delivered in 1.8.0 | Brand kits and reusable template sets | Delivered: one private kit per person (role colors, Office faces, logo, voice) with its own permissions, branded templates, brand swatches, faces and logo in the editor, and the kit read by AI Office, Portrait and Video. Open: several kits per person, duplicating private templates, adapting a design to related formats, and a deck drawn in the brand's exact colors and fonts (needs the core renderer to accept a custom look). |
| CREATE-EDIT-11 | After the brand kit | Several brand kits and a brand set | A person keeps more than one kit (a company, a side project, a client), names them, and chooses which one a design, a deck or a portrait uses. The store keys on owner plus kit id with the same exact-owner rules; every consumer names the kit it applied; deleting a kit never alters designs already made. A kit can be duplicated as the starting point of another. No sharing between accounts is implied. |
| CREATE-EDIT-12 | After the brand kit | The remaining studios read the kit | Vids, Stories, Scan-to-Print and LoRA offer the brand the same way Portrait and Video do, and the New screen draws its cards in the person's colors. Each studio fails closed and silent when the kit is refused, adds nothing to a generation request the person did not accept, and states in words what it applied. |
| CREATE-EDIT-13 | After the brand kit | Logo variants and placement rules | A kit holds a primary logo, a variant for dark surfaces and a square mark. A template picks the variant by the contrast of the surface it places it on, and the editor offers the three. Uploads keep the existing owned-image path, quota and normalization; a missing variant never blocks a design. |
| CREATE-EDIT-14 | Home polish | Recent work with real previews | Home shows each recent piece with a picture, not only a title: each studio publishes a small preview with its Home summary, Create renders what it is given and falls back to the current text card when a studio offers none. Previews respect the same access checks as the summary and are never fetched for a locked studio. |
| CREATE-EDIT-15 | New screen | Blank starts and one-tap formats | New offers a blank start for each shape (document, workbook, deck, canvas) beside the purpose cards, and the common social sizes open Portrait or Video already sized. A blank start creates nothing until the person acts in the studio it opens. |

## Shared interaction requirements

1. **One selection context.** Pointer/keyboard selection and Jarvis refer to the
   same asset revision, object IDs, region coordinates or clip/time range. Zoom,
   crop and rotation must not move the requested edit to the wrong pixels.
   An ambiguous or stale selection is resolved before applying a change.
2. **Preserve editable work.** Keep original assets and the current accepted
   project. A regenerated background can replace that layer while a manually
   added title remains editable and locked objects remain unchanged. Show any
   operation that must flatten content before applying it.
3. **Honest provider capabilities.** The inspected storyboard provider contract
   currently supports a prompt and one anchor image. Region masks, selective
   regeneration or multiple references require explicit supported capabilities.
   A whole-image rewrite must not be presented as an exact selected-region edit.
   Where exact outside-region preservation is required, verify it at the actual
   compositing/provider boundary.
4. **Reversible AI actions.** Show which selection and revision will be sent,
   reuse existing generation authorization/cost controls, and make candidate
   acceptance explicit. Late jobs cannot replace a newer manual revision.
5. **Editable output and final output.** Save the native project independently
   from flattened images or rendered video. Keep asset dimensions, timing,
   orientation, audio and provenance sufficient for another editing pass.
6. **Consistent handoffs.** Both directions work: generate then edit, and create
   manually then send to image/video generation or another editor. Return to
   the same project with a visible new revision and current source ownership.

## Ownership and implementation boundaries

Create owns the coherent experience and navigation. Image editing should be a
reusable application-owned component available to Create and Portrait; video
editing/rendering stays with the video owner. Decide and document which owning
application persists each project before introducing storage, so multiple
studios do not create competing copies of the same project.

Keep document editing in AI Office. Reuse core artifact transport, current
application/function/record authorization, framework theme/navigation and the
accounted generation path. Provider credentials stay in their existing brokered
server operations. Creating a project, changing it, generating, exporting and
sharing are separately authorized actions; loading Create grants none of them.

Extend core only for a demonstrated reusable transport or provider-capability
gap. Define editor integration through advertised formats and capabilities;
choose libraries, rendering engines and native interchange formats during the
relevant implementation slice after dependency/license and boundary evaluation.
No framework, codec, PSD compatibility or external-editor connector is selected
by this backlog entry.

## Acceptance and AI Test Lab coverage

The manual-image slice ships its real suites in `tests/test-lab.yaml`; the broader
requirements below remain acceptance criteria for future phases. Every phase
must register its tests in the same change. Installation must discover the cases.
Keep unit, real browser,
media-rendering, database and live provider evidence distinct; missing fixtures
remain pending. Do not create catalog entries pointing to nonexistent suites.

| Coverage | Required proof |
|---|---|
| Layout and direct editing | Real browser interactions for selection, text, crop, masks, keyboard/focus and responsive layout; inspect the saved project and actual exported pixels. |
| Project history | Real store tests for autosave/reopen, undo/redo, concurrent changes, failed jobs and stale AI results; original assets and accepted revisions remain intact. |
| Region edits | Coordinate transformations and selected/locked-layer behavior, plus actual mask/compositing boundary tests. Provider-fixture success does not establish live provider fidelity. |
| Video/audio | Actual media engine export of known short clips and audio; inspect duration, ordering, output frames, synchronization, cancellation and temporary-file cleanup. |
| Handoffs and layers | Real artifact exchange into/out of the selected editor, supported layer/track round-trip, unsupported-feature disclosure and expired-handle recovery through current authority. |
| Access and generation | Two-user/project isolation across UI, API, tools, previews, jobs and exports; revoked access and denied writes refuse. Manual editing does not spend generation tokens; generation uses the existing accounted path. |

Release a phase only after a person can complete its example workflow from the
installed Create entry and reopen the result. Update the owning package's
version, inline documentation, README, backlog and recorded acceptance together.
