# Create: parity audit against Photoshop and Canva

`create` 1.15.3 is a layered image and vector editor with saved revisions, templates and a brand kit, served as one responsive page, with the `create-editor` concierge beside it. It is measured against Adobe Photoshop (desktop, iPad, iPhone/Android, web), Adobe Express and Canva. Those products split by device and by plan: Photoshop on a phone gives layers, masks, Tap Select and Generative Fill for free, and charges for Object Select, Magic Wand, Remove Tool, Clone Stamp, advanced blend modes and PSD/TIFF export [A][B]. Acrobat, the owner's example, follows the same pattern: free mobile reads, comments and signs, while editing is paid and the full set is on desktop [J]. Create has no such split; every control is on the same page for everyone with the role.

## Table

How to read it:
- Our side comes from reading the snapshot. Nothing here was run. `editor.html` means `create/tools/create-editor.html`; other files are under `create/tools/editor/` unless a path is given.
- `apply-edits` means the `create-apply-edits` tool in `create/oshal-app.yaml`; the word after it is the operation in `forms` in `agent-tools.mjs`. Field limits come from `model-validation.mjs`.
- Letters in brackets are sources, listed at the end. [K] means a long-standing desktop feature stated from general product knowledge and not re-read: Adobe's help pages and Canva's own pages refused automated fetches (HTTP 403). "n/c" means not confirmed.
- Tier is the industry split: basic is free on Photoshop mobile or Canva/Express Free; pro is paid-only or desktop-only.

| # | Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|---|
| 1 | New blank canvas with size and background | basic | n/c | Photoshop, Canva: yes [K] | `#newProject`, then canvas settings, `editor.html` | `create-new-project` (up to 4096 px; the editor allows 8192) | both |
| 2 | List and open saved work | basic | n/c | yes [K] | `#openProjects`, `editor-projects.mjs` | `create-list-projects`, `create-read-project` | both |
| 3 | Save, with autosave | basic | n/c | yes [K] | automatic saving with the Saved caption; Save automatically in the document menu brings back `#saveProject`, `editor.html` | `apply-edits`: each approved batch saves one revision | both |
| 4 | Undo and redo | basic | n/c | yes [K] | `#undo`, `#redo`, Ctrl+Z/Y in `editor-interactions.mjs` | none | UX only |
| 5 | Version history and restore | pro | n/c | Photoshop History panel [K] | My projects, Revisions, Restore, `editor-projects.mjs` | none (the revision routes exist in `src-routes/create-project-routes.ts`; no tool is declared) | UX only |
| 6 | Save a copy; delete a project | basic | n/c | yes [K] | `#saveCopy` and Delete image in the document menu, `editor.html`; Delete project in My projects, `editor-projects.mjs` | none | UX only |
| 7 | Change canvas size, background, name | basic | n/c | yes [K] | Format with nothing selected (`editor-foundation-adapter.mjs`); `#projectName` in the document menu, `editor.html` | `apply-edits`: `project` | both |
| 8 | Start from a template | basic | Canva: yes [C]; Express Free: yes [D] | Canva, Express: yes [D] | `#templateDialog`, `editor.html`; `tools/create-new.html` | none (a concierge can only rebuild a design layer by layer) | UX only |
| 9 | Use brand colors, fonts, logo in a design | pro | n/c | Express: Premium [D]; Canva: limited Free, more on Pro [E] | `#brandPanel`, `#brandTemplates`, `editor.html`; `tools/create-brand.html` | none (persona says brand controls are not granted to it) | UX only |
| 10 | Resize one design to many formats in one action | pro | n/c | Express: Premium [D]; Canva: Pro [E] | none (canvas width/height changes one project) | none | missing |
| 11 | Stock photos and graphics | basic | Photoshop phone: free stock [A][B] | yes [K] | none | none | missing |
| 12 | Add an image: device, paste, own files | basic | Photoshop phone: yes [K] | yes [K] | `#uploadImage`, `#chooseArtifact`, `editor.html`; paste listener, `editor-files.mjs` | none usable: `apply-edits` `add` takes only an already owned reference, and no tool uploads or lists assets | UX only |
| 13 | Text: add, edit, font family, size, weight | basic | Photoshop phone: Type Layer [B] | yes [K] | `#addText`, `editor.html`; Format's Text, Font size, Weight (100 to 900) and Font, `editor-foundation-adapter.mjs` | `apply-edits`: `add`, `update` (weights 100 to 900) | both |
| 14 | Text alignment | basic | n/c | yes [K] | none (the field exists in the model; no control in `editor.html`) | `apply-edits`: `update` patch `align` | concierge only |
| 15 | Text styling: italic, underline, spacing, outline, shadow; typing on the canvas | basic | n/c | yes [K]; Express text effects on Free [D] | none (text is typed in the side panel) | none (`textFields` in `model-validation.mjs` has no such fields) | missing |
| 16 | Font library and font upload | pro | Photoshop phone: paid, 20,000+ and import [A] | Express: 5,000+ Free, 30,000+ Premium [D] | three generic faces plus brand fonts only, `brand-editor.mjs` | none for upload; `update` accepts a family name | missing |
| 17 | Rectangle and ellipse | basic | n/c | yes [K] | `#addRectangle`, `#addEllipse`, `editor.html` | `apply-edits`: `add` | both |
| 18 | Ready-made shapes: line, arrow, polygon, star, rounded rectangle | basic | n/c | yes [K] | none (can be hand-built with the pen) | none (can be hand-built as a path) | missing |
| 19 | Freehand drawing | basic | Photoshop phone: Paint free [L] | yes [K] | `#drawMode`, `editor.html` (starts purple, 5 px, in `editor-interactions.mjs`; change it afterwards) | `apply-edits`: `add` a freehand layer | both |
| 20 | Pen tool and node editing | pro | n/c; Photoshop web launched without pen [F] | Photoshop: yes [K] | `#vectorPen`, node fields, `editor.html`; `vector-editor.mjs` | `apply-edits`: `add`, `update` contours | both |
| 21 | Combine paths: union, subtract, intersect, exclude | pro | n/c | Photoshop: yes [K] | `#applyVectorBoolean`, `editor.html` | `apply-edits`: `boolean` (one per batch, 256 nodes) | both |
| 22 | Gradients | basic | n/c | yes [K] | `#applyVectorGradient`, paths only, two colors, `editor.html` | `apply-edits`: `update` gradient, paths only, several stops | both |
| 23 | Move, resize, rotate | basic | n/c | yes [K] | drag and one corner handle, `editor-interactions.mjs`; `#layerRotation` is a number field, no rotate handle | `apply-edits`: `update` | both |
| 24 | Flip, skew, perspective, warp | basic (flip), pro (rest) | n/c | yes [K] | none | none (no such field in `model-validation.mjs`) | missing |
| 25 | Layer stack: order, hide, lock | basic | Photoshop phone: free [A][B] | yes [K] | `#raiseLayer`, `#lowerLayer`, hide and lock buttons in `editor-view.mjs` | `apply-edits`: `reorder`, `update` | both |
| 26 | Group, ungroup, duplicate | basic | Photoshop phone: layer actions [B] | yes [K] | `#groupBelow`, `#ungroupLayer`, `#duplicateLayer`, `editor.html` | `apply-edits`: `group`, `ungroup`, `duplicate` | both |
| 27 | Align and distribute | basic | n/c | yes [K] | `#arrangeLayers`, `#arrangeMode`, `editor.html` | `apply-edits`: `arrange` | both |
| 28 | Select several layers and move or resize them together | basic | n/c | yes [K] | none (checkboxes feed Arrange only; one layer moves at a time) | `apply-edits`: one `update` per layer in a batch | concierge only |
| 29 | Copy and paste layers, also between projects | basic | n/c | yes [K] | none (paste only takes an image) | none | missing |
| 30 | Snap, rulers, guides | pro | n/c | yes [K] | grid snap only: `#snapGrid`, `#snapSpacing`, `editor.html`; no rulers or guides | none | UX only |
| 31 | Pinch to zoom and pan on touch | basic | n/c | n/a | none: `#zoom` is a dropdown; `#artboard` sets touch-action none and takes one pointer, `editor-interactions.mjs` | n/a | missing |
| 32 | Crop | basic | n/c | yes [K] | percent fields and `#applyCrop` only; no drag handles, `editor.html` | `apply-edits`: `update` patch `crop` | both |
| 33 | Brightness, contrast, looks, saturation, grayscale, sepia, blur | basic | Photoshop phone: sliders and effects [B]; Canva: filters [C] | yes [K] | `#imageProperties` sliders, `#filterLook`, `editor.html` | `apply-edits`: `update` values (no named-look shortcut) | both |
| 34 | Adjustment layers: exposure, levels, gamma, curves, saturation | basic | Photoshop phone: adjustment layers [B]; iPad: Curves [I] | yes [K] | `#addAdjustment`, `#adjustmentProperties`; curve is a typed text field, `editor.html` | `apply-edits`: `add` type adjustment | both |
| 35 | Hue, vibrance, temperature, sharpen | basic | Photoshop phone: sharpness slider [B] | yes [K] | none | none | missing |
| 36 | Blend modes and layer effects (shadow, glow) | pro | Photoshop phone: a few free, advanced paid [A][B] | yes [K] | none (`COMMON` in `model-validation.mjs` has no blend field) | none | missing |
| 37 | Manual selection: lasso, rectangle, ellipse | basic | Photoshop phone: free [A] | yes [K] | the Select tool `#regionMode` with its `#regionShape` option in the canvas bar, `editor.html` | none (the screen context reports a region, read-only, `editor-context.mjs`) | UX only |
| 38 | Automatic selection: Tap Select, Object Select, Magic Wand | basic (tap), pro (rest) | Photoshop phone: Tap Select free; others paid [A][B] | yes [K] | none | none | missing |
| 39 | Layer masks: brush, invert, feather, disable | basic | Photoshop phone: free [A] | yes [K] | `#imageProperties` mask section, `editor.html` | `apply-edits`: `mask`, `clearMask` | both |
| 40 | Generative fill: describe a change to a region, compare, accept | basic, with credits | Photoshop phone: yes, 10 free credits a month per one guide [A][B][L] | Photoshop web, desktop: yes [F][G] | `#regionSend`, `#regionCompare`, `region-edit-panel.mjs`; needs a configured image service | none (routes in `src-routes/create-region-edit-routes.ts`, no tool; persona says not granted) | UX only |
| 41 | Generative expand | basic, with credits | Photoshop phone: free [A] | Photoshop web, desktop: yes [F] | none | none | missing |
| 42 | Remove background in one action | basic | Photoshop phone: one tap [B]; Canva: yes [C] | Express Free: yes [D]; Canva Pro [E] | none (a region edit could be asked to do it; no direct control) | none | missing |
| 43 | Remove objects, spot heal, clone stamp | basic (spot heal), pro (rest) | Photoshop phone: Spot Healing free; Remove Tool, Clone Stamp paid [A][B] | yes [K] | none as such; only generative region edit (row 40) | none | missing |
| 44 | Generate an image from text inside the editor | pro | Photoshop phone: Generate Image, premium list [B] | Photoshop: yes [K] | none | none | missing |
| 45 | Export PNG and JPEG | basic | Photoshop phone: PNG free [L]; JPG paid [B][L] | Express Free: JPEG, PNG [D] | `#exportPng`, `#exportJpeg`, `editor.html` | none (contract says these stay editor controls; `create-export-document` is JSON only) | UX only |
| 46 | Editable project file: export and import | pro | Photoshop phone: PSD export paid [B] | yes [K] | `#exportJson`, `#importProject`, `editor.html` | `create-export-document` for export; no import tool | both |
| 47 | SVG import and export | pro | n/c | n/c | `#importVectorSvg`, `#exportSvg`, `editor.html` | none | UX only |
| 48 | Open a PSD | pro | n/c | yes [K] | `#importPsd`, `#choosePsdArtifact`, `#psdSource`, `editor.html` (8-bit RGB subset) | `create-inspect-psd`, `create-import-psd`, `create-psd-source` | both |
| 49 | Other exports and settings: PSD, PDF, TIFF, WebP, output size, JPEG quality | pro | Photoshop phone: PSD, TIFF, print quality, compression paid [B] | Express: PDF, 4K on Premium [D] | none: quality is fixed at 0.92 in `renderer.mjs`, no size option | none | missing |
| 50 | Assistant looks at the picture itself | pro | Photoshop phone: AI Assistant, early access [B] | n/c | n/a | none: persona works from saved layer data; no tool returns pixels | missing |

## Backlog

Ordered by what people hit first.

- **CREATE-TOOL-CREATE-01: The concierge can add an image the person has.** Add tools to list owned images and to place an uploaded one on the canvas.
  Done when: a person uploads a photo, says "put my last photo on this canvas", approves the card, and the photo appears as a layer after the editor refreshes.
- **CREATE-TOOL-CREATE-02: Text alignment control on screen.** Add left, center, right to the text properties.
  Done when: pressing Center moves the text, and a reload keeps it, with the same result as the concierge's `align` patch.
- **CREATE-TOOL-CREATE-03: Flip horizontally and vertically, by button and by tool.**
  Done when: a person flips a photo with a button and asks the concierge to flip it back, and the exported PNG matches each state.
- **CREATE-TOOL-CREATE-04: Text styling and typing on the canvas.** Italic, underline, line and letter spacing, outline, shadow; double-click to type in place.
  Done when: each style can be set on screen and by `apply-edits`, survives save and reopen, and appears in PNG and SVG exports.
- **CREATE-TOOL-CREATE-05: Remove background.** One button and one tool, with the original kept as a mask or a new revision.
  Done when: a photo of a person on a plain wall exports as a PNG with a transparent background, by either route, and undo restores it.
- **CREATE-TOOL-CREATE-06: Templates for the concierge.** List templates and start one, in the brand when a kit exists.
  Done when: "make me an event flyer from a template" produces an approval card and then an owned project with the same layers as the on-screen template.
- **CREATE-TOOL-CREATE-07: Finished image export through the concierge.** A server or worker render to PNG and JPEG returned as a file.
  Done when: "export this as a PNG" returns a file link whose pixels match the editor's own PNG export.
- **CREATE-TOOL-CREATE-08: Undo and restore through the concierge.** Tools to list revisions and to restore one as a new revision.
  Done when: after an approved edit, "undo that" produces a card, and approving it brings the earlier layers back as a new revision.
- **CREATE-TOOL-CREATE-09: Generative region edit through the concierge.** Propose, check, accept and reject tools over the existing region-edit routes, with the same cost consent.
  Done when: with a region selected, "replace this cup with a plant" shows the cost in a card, then the before and after, and nothing changes in the project until the person accepts.
- **CREATE-TOOL-CREATE-10: Brand kit for the concierge.** Read and change the kit; apply its colors and fonts to a project.
  Done when: "use my brand colors on this" produces a card listing each layer change, and the result matches the on-screen swatches.
- **CREATE-TOOL-CREATE-11: Blend modes and layer effects.** Multiply, screen, overlay and the common set; drop shadow and glow.
  Done when: a fixture layer in Multiply matches a reference image within a stated tolerance, set by screen or by tool, and survives save and reopen.
- **CREATE-TOOL-CREATE-12: Automatic selection.** Tap to select an object or subject, producing a normal region.
  Done when: a person taps a subject, sees the outline, and can turn it into a mask or a region edit. The concierge can ask for the same selection.
- **CREATE-TOOL-CREATE-13: Touch: pinch to zoom, two-finger pan, and a phone pass.**
  Done when: on a real phone at 412 px wide, a person pinches, pans, places an image, edits text, and exports, with no horizontal page scroll and no stray layer move.
- **CREATE-TOOL-CREATE-14: Remove objects, spot heal, clone stamp.**
  Done when: a person brushes out a small object with each tool, spot heal and clone work with no image service configured, undo restores the source, and the concierge can start the generative remove.
- **CREATE-TOOL-CREATE-15: Select and move several layers on screen.**
  Done when: Shift-click or a drag box selects three layers and one drag moves all three as one undo step.
- **CREATE-TOOL-CREATE-16: Copy and paste layers, also between projects, by screen and tool.**
  Done when: a layer with a mask pasted into another project looks the same and uses the same owned image.
- **CREATE-TOOL-CREATE-17: More color controls.** Hue, vibrance, temperature, sharpen, as image and adjustment fields.
  Done when: each can be set by slider and by `update`, and each changes exported pixels as a fixture test expects.
- **CREATE-TOOL-CREATE-18: Resize to many formats.** One action that makes copies for chosen sizes, by screen and tool.
  Done when: choosing square, story and banner makes three new projects with no text outside the canvas in a check of the eight templates.
- **CREATE-TOOL-CREATE-19: Fonts.** A real font list, plus upload of a font the person has the right to use.
  Done when: an uploaded font shows in the picker, renders in the PNG, and the concierge can set it by name.
- **CREATE-TOOL-CREATE-20: Ready-made shapes.** Line, arrow, polygon, star, rounded rectangle.
  Done when: each can be added by button and by `add`, and stays editable after save.
- **CREATE-TOOL-CREATE-21: Generative expand and text-to-image in the editor, by screen and tool.**
  Done when: a person extends a canvas with AI fill, or adds a generated image as a layer, sees the cost first, and can undo.
- **CREATE-TOOL-CREATE-22: Stock images.** A licensed or free source with attribution stored per asset.
  Done when: a person searches, places an image as an owned layer, and the licence shows on the layer. The concierge can do the same.
- **CREATE-TOOL-CREATE-23: More export formats and settings.** PDF, WebP, TIFF, PSD; output size; JPEG quality.
  Done when: each file opens in a standard viewer at the requested size. PSD export is checked against a real Photoshop or a named parser.
- **CREATE-TOOL-CREATE-24: Rulers, guides and smart guides.**
  Done when: a person drags a guide from a ruler and a layer snaps to it and to other layers' edges; guides stay out of exports.
- **CREATE-TOOL-CREATE-25: Skew, perspective, warp.**
  Done when: each can be set by handles and by a tool, keeps the original image, and survives save and reopen.
- **CREATE-TOOL-CREATE-26: Concierge file tools.** Save a copy, delete a project (held for approval), SVG import and export, project import.
  Done when: each runs from a chat request, with a card for any change, and gives the same result as its on-screen control.
- **CREATE-TOOL-CREATE-27: Selections as a tool.** The concierge can read the selected region's outline and make one.
  Done when: "mask the region I just drew" makes a mask matching the on-screen Mask from selected region result.
- **CREATE-TOOL-CREATE-28: The assistant can see the picture.** A bounded, owner-only render of the current project passed to a vision model, with the person's consent.
  Done when: asked "is the headline readable over the photo?", the answer changes correctly between a legible and an illegible fixture.
- **CREATE-TOOL-CREATE-29: Same size limit for the concierge.** `create-new-project` stops at 4096 px; the editor allows 8192.
  Done when: the same canvas size is accepted by both, or both refuse with the same words.

## Sources

Read directly unless marked. Adobe help pages and canva.com refused automated fetches, so Adobe and Canva facts lean on the app listings, launch reporting and one Adobe plan table. Launch reports date from 2025 and plans change.

- [A] TechCrunch, Photoshop iPhone launch, free and paid lists: https://techcrunch.com/2025/02/25/adobe-launches-a-photoshop-iphone-app/
- [B] Photoshop App Store listing: https://apps.apple.com/za/app/id1457771281
- [C] Canva App Store listing (names features, marks none as Pro): https://apps.apple.com/us/app/id897446215
- [D] Adobe Express plan table: https://www.adobe.com/express/fragments/pricing-table/individuals-ff-bundle.plain.html
- [E] Style Factory, Canva Pro vs Free (third party, search excerpt only; sources disagree on some limits): https://www.stylefactoryproductions.com/blog/canva-pro-vs-free
- [F] Adobe blog, Photoshop on the web (search excerpt; launch-era missing tools may have since shipped): https://blog.adobe.com/en/publish/2023/09/27/photoshop-streamlines-power-precision-web
- [G] Adobe help, generative features on the web (search excerpt): https://helpx.adobe.com/in_hi/photoshop/using/generative-ai-features-web.html
- [I] Digital Camera World, iPad 1.4 adds Curves (search excerpt): https://digitalcameraworld.com/news/photoshop-for-ipad-gets-curves-adjustments-finally-and-pencil-pressure-sensitivity-too
- [J] Adobe, Acrobat on mobile FAQ (search excerpt): https://helpx.adobe.com/acrobat/mobile/get-started/faqs.html
- [L] Secondary reports on free tools, credits and PNG export: https://www.igeeksblog.com/how-to-use-adobe-photoshop-app-on-iphone/ and https://www.cgchannel.com/?p=165231
- Android availability of Photoshop, headline only, fetch refused: https://www.neowin.net/news/adobe-releases-all-new-photoshop-app-for-android-devices/
