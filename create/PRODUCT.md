# Create: easy to start, precise to finish

Product direction requested 2026-09-12: **“think Canva but better.”** This is a
design target, not a claim of current feature parity. Use original designs and
OSHAL's existing navigation, theme chooser and application permissions.

The promise is a short path from an idea to something useful: start from a
template, upload or generation; edit directly; ask AI to change the selected
part; compare the result; keep working in the same saved project. A title should
remain editable after the background changes. Joining two clips should not
require generating another video.

## What makes the experience better

| Person's task | Product behavior | Delivery state |
| --- | --- | --- |
| Start without a blank page | Search original templates by purpose, see the actual composition, then change its independent objects. | Eight image designs delivered in Create 1.6.0; README records installed acceptance and its limits. |
| Make a small correction | Select, move, resize, crop, recolor or edit text directly; undo and reopen saved revisions. | Manual images delivered in 1.5.0. |
| Tell AI exactly what to change | Select an object, brush a region or choose a clip/time range; the instruction carries that selection and source revision. | Planned; current drawing layers are not AI masks. |
| Keep the parts already right | Regeneration produces a candidate revision; locked objects and manual titles survive. Compare, accept or reject without replacing newer work. | Planned. |
| Assemble a short video | Import, trim, split, reorder and join clips, add timed text and sound, preview and export a playable MP4. | Engine feasibility verified; timeline UI and project workflow remain open. |
| Make a coordinated set | Reuse permitted brand colors, typography, logos and templates; adapt a design to another format with a reviewable layout. | Brand kit delivered in 1.8.0 (templates, swatches, faces and logo in the editor; AI Office, Portrait and Video read it). Format adaptation remains planned. |
| Use existing OSHAL work | Open a permitted generated image, video or business asset in its owning editor and return a linked revision. | Image artifact input exists; the complete round trip remains open. |

“Better” means fewer lost edits, clearer selection, reusable editable work and
shorter task completion. It does not mean putting more buttons on the first
screen. AI remains available beside the work; manual editing works without a
generation provider.

## Workspace layout

Keep the major workspace tabs in the cockpit header and avoid duplicate app
navigation. Create's Home emphasizes recent work. New answers what to make and
offers templates; the editor emphasizes the active canvas.

- A compact left rail holds templates, uploads and objects. Search and purpose
  filters belong with that content.
- A large central canvas shows the actual design. Contextual properties describe
  the selected object; the layer stack remains accessible.
- Project name, save state, history and export stay in predictable positions.
- Video uses a timeline beneath its preview. Image projects do not show an empty
  timeline.
- Jarvis can use the current selection and prepare changes. Costly generation
  and outward publication retain their existing review and authorization paths.

All surfaces follow the portal theme chooser and optional application colors.
Narrow screens, readable contrast, keyboard navigation, focus restoration and
modal isolation are release requirements. Opening a picker must not change the
canvas through background shortcuts.

## Next delivery order and parallel ownership

The requested engineering extension is now a parallel track in the
[CAD Studio delivery plan](../scan-to-print/CAD-PLAN.md). It starts with a real
parametric part and bounded worker, preserving scan provenance and editable
source separately from manufacturing exports. SOLIDWORKS is an optional adapter
with its own actual-workstation acceptance. This does not replace the image and
video milestones below or claim a currently installed CAD editor.

1. **Editable image templates (CREATE-EDIT-09).** Eight useful original designs,
   real previews, filtering and independent new projects. Installed standalone
   edit/save/reopen/export, Test Lab and preservation acceptance are complete;
   the wider origin-loading issue remains separately tracked.
2. **Manual video workflow (CREATE-EDIT-05).** Video owns the timeline, media,
   projects and export jobs. The [Video editor plan](../video/EDITOR-PLAN.md)
   defines the first two-clip delivery and its limits. Develop alongside images.
3. **Selected AI changes (CREATE-EDIT-04).** Introduce exact selection and candidate
   revisions before adding providers. Prove preservation outside the intended
   change, cancellation and rejection of stale results.
4. **Brand kits and useful template sets (CREATE-EDIT-10).** Save permitted colors,
   logos and font choices, duplicate a private template and prepare related
   social, presentation and video assets without accidental sharing.
5. **Complete editing handoffs (CREATE-EDIT-06).** Generate, edit, regenerate and
   return to the same project with source lineage and current permissions.

Professional masks, vectors, multitrack compositing, keyframes and desktop format
interchange remain later bounded additions. Each supported format needs actual
round-trip and export evidence before it is advertised.

## Acceptance through real tasks

- Choose an announcement template, change its title and color, add an image,
  save, reopen and export. The original template stays reusable.
- Import two clips, trim away known source frames, reorder, add a timed title
  and audio, save/reopen and export. Verify decoded frames, duration and sound.
- Select a background region, request a change, compare and accept it, then edit
  again. The title remains an editable object; a late result cannot replace a
  newer revision.
- Repeat as a second user and with revoked permissions: private projects,
  previews, assets and exports remain protected.

Register tests with each implemented feature in its owning application's AI Test
Lab catalog. Keep source tests, installed execution and live-provider evidence
distinct. See [the phased backlog](BACKLOG.md) and [editor guide](EDITOR.md) for
current implementation details and release evidence.
