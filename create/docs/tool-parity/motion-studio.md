# Motion Studio (`motion-studio`) parity audit

## 1. What it is

`motion-studio` (0.1.4) is a layered motion graphics editor built on the EffectCraft compositor. Its screen is `tools/workbench.html` with `tools/workbench.mjs`. It is measured against Adobe After Effects (desktop only: community and third-party sources say there is no native iPad or phone app) and Canva's animation tools (phone and desktop, aimed at beginners). The engine holds far more than the screen shows: 433 commands and 306 effects, read directly from the built engine with `{"op":"catalog"}`. The concierge can call any admitted command through `motion-apply-edits`. The screen reaches the same commands through one generic form called "More editing commands" (`#advanced`).

**How to read the table.**

- "Form" in the UX column means the only on-screen route is that generic form, with one text box per parameter. It sends most values as plain text, because 1,322 of the 1,361 parameters in the catalog declare no type (`commandFields` in `workbench.mjs`).
- I tested what the form would send against the built engine binary. Text layer names and numbers worked. Parameters that need a list were refused: `shape.newPath` vertices, `puppet.addPin` position and `roto.stroke` points. `layer.style.dropShadow` with `layers` given as text was also refused. A status of "both" with "Form" means a person can do it only by typing parameter values by hand. Count it as weak.
- I tested the engine directly, not through the installed package routes. "Accepted" means the engine returned ok, and "pixels changed" means a preview frame hash changed. The manifest and the workbench are read from code; I did not walk this screen on a live box.
- "Yes†" means general product knowledge not re-checked against a source in this audit.
- `motion-apply-edits` is abbreviated to "apply". The exact-text sibling `motion-apply-exact-edits` does the same work.

## 2. Parity table

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| New composition (size, rate, length) | basic | Canva: Yes† | AE and Canva: Yes | `workbench.html` `#new` | `motion-new-project` | both |
| Change composition settings later | basic | Canva: Yes† | AE: Yes† | Form: `comp.settings` (accepted with text values) | apply `comp.settings` | both |
| Open, duplicate and delete compositions | basic | Canva: Yes† | Yes† | `#projects`, `#duplicate`, `#delete` | `motion-list-projects`, `motion-read-project`, `motion-fork-project`, `motion-delete-project` | both |
| Undo | basic | Canva: Yes† | Yes† | `#undo` (restores the previous revision) | `motion-restore-revision` | both |
| Redo | basic | Canva: Yes† | Yes† | none in `workbench.html` | `motion-restore-revision` to a later revision | concierge only |
| Browse version history | pro | not confirmed | AE: Yes† | none. `open()` takes a revision from the URL, with no list control | `motion-revision-history`, `motion-read-revision` | concierge only |
| Add text | basic | Canva: Yes | Yes | `#add` (Text) | apply `layer.newText` | both |
| Edit text style (font, size, fill, stroke, tracking, alignment, paragraph) | basic | Canva: Yes† | Yes | `#textEdit` | apply `text.patchAt`, `motion-read-text`, `motion-list-fonts` | both |
| Bring in your own font | basic to pro | Canva Pro† | AE: Yes† | none (fonts are bundled in the engine) | none | missing |
| One-click text animation presets | basic | Canva: Yes | AE: Yes† | Form: `layer.applyTextPreset` (pixels changed) | apply `layer.applyTextPreset` (8 presets) | both |
| Per-character text animators | pro | No† | AE: Yes† | Form: `layer.addTextAnimator` (one property as text accepted) | apply `layer.addTextAnimator`, `addTextSelector` | both |
| Solid colour and background layers | basic | Canva: Yes† | Yes | `#add` | apply `layer.newSolid` | both |
| Rectangle shape | basic | Canva: Yes† | Yes | `#add` (Vector rectangle) | apply `layer.newShape`, `layer.addShapeItem` | both |
| Draw a free path, stars, shape modifiers | pro | Canva draw† | AE: Yes | none that works. Form refuses `shape.newPath` vertices sent as text | apply `shape.newPath` (pixels changed), `layer.addShapeItem` | concierge only |
| Add a photo | basic | Canva: Yes | Yes | `#image`, `#assets`, `#reuse` | apply `asset.import`, `motion-list-assets` (photo must already be uploaded) | both |
| Add video footage | basic | Canva: Yes† | Yes | none. `#image` takes PNG, JPEG and WebP only | none. `asset.import` is raster only (`engine/src/lib.rs`) | missing |
| Add audio, audio-driven animation | basic | Canva: Yes† | Yes† | none | none. `keys.audioToKeyframes` is accepted but no audio can be added | missing |
| Templates and stock media | basic | Canva: Yes | AE: partial† | none | none. `anim.applyPreset` and `essential.import*` are refused by `check_command` | missing |
| Move, scale and rotate by typed numbers | basic | Canva: Yes† | Yes | `#transform` | apply `properties.patchAt`, `prop.set`, `motion-read-properties` | both |
| Drag a layer on the canvas | basic | Canva: Yes† | Yes† | none. `#preview` is an image with no pointer handler; the only pointer drag in `workbench.mjs` is on motion-path handles | none (a gesture) | missing |
| Add and edit keyframes | basic | Canva: not confirmed | AE: Yes | `#key`, `#editKey`, `.keyButton` in `#timeline` | apply `prop.addKey`, `keys.addExact`, `keys.patchExact`, `motion-read-keyframe` | both |
| Easing (linear, hold, easy ease) | basic | Canva: movement style† | Yes | `#key` and `#editKey` `ease` | apply `keys.easyEase`, `keys.interpolation` | both |
| Graph editor, drag speed curves | pro | No† | AE: Yes† | none. `#keyCurve` draws a sampled curve, with no handles | apply `keys.velocity` | concierge only |
| Edit a motion path | pro | Canva: path (sources disagree) | AE: Yes | `#motionPath` draggable points, `#spatialFields` | apply `keys.patchExact`, `keys.setSpatialTangents` | both |
| Record a movement by dragging | basic | Canva: "Create an animation" (sources disagree) | AE: Yes† | none | none | missing |
| One-click animate a whole design | basic | Canva: Magic Animate | Canva: Magic Animate | none | none | missing |
| Layer order, duplicate, delete, rename, visibility | basic | Canva: Yes† | Yes | `#layerUp`, `#layerDown`, `#duplicateLayer`, `#deleteLayer`, `#layerSettings` | apply `layer.arrange`, `edit.duplicate`, `edit.clear`, `layer.rename`, `layer.setSwitch` | both |
| Parenting | pro | No† | AE: Yes | `#layerSettings` Parent | apply `layer.setParent` | both |
| Null layers | pro | No† | AE: Yes† | Form: `layer.newNull` | apply `layer.newNull` | both |
| Precompose (nest) | pro | No† | AE: Yes† | `#nest` | apply `layer.precompose` | both |
| Layer timing by typed seconds | basic | Canva: Yes (timing) | Yes | `#layerTiming`, `#workArea` | apply `layer.timing`, `comp.workArea` | both |
| Drag clips on a timeline | basic | Canva: Yes† | AE: Yes† | none. `#timeline` lists layers and key buttons, with no drag | none (a gesture) | missing |
| Masks: rectangle, ellipse, settings | pro | No† | AE: Yes | `#mask`, `#maskSettings` | apply `layer.addMask`, `layer.mask.set`, `motion-read-mask` | both |
| Mask vertices, feather, animated path | pro | No† | AE: Yes | `#maskVertex`, `#addFeather`, `#editFeather`, `#keyMaskPath` (typed, the path preview is not draggable) | apply `mask.patchAt`, `mask.setVertex`, `mask.featherPoint.*` | both |
| Track mattes | pro | No† | AE: Yes† | Form: `layer.setTrackMatte` (pixels changed) | apply `layer.setTrackMatte` | both |
| Blend modes | pro | Canva: not confirmed | AE: Yes† | Form: `layer.setBlendMode` (accepted; pixels did not change in my one test scene) | apply `layer.setBlendMode` | both |
| Effects library | pro | Canva: filters† | AE: Yes | `#addEffect`, `#effectParams`, `#effectUp`, `#removeEffect` | apply `effect.apply`, `motion-list-effects`, `motion-effect-schema`, `motion-read-effect-properties` | both |
| Layer styles (shadow, glow, bevel) | basic to pro | Canva: shadow† | AE: Yes† | none that works. Form refused `layers` sent as text | apply `layer.style.*` (pixels changed) | concierge only |
| Expressions | pro | No† | AE: Yes | Form: `prop.setExpression` (pixels changed) | apply `prop.setExpression` | both |
| Cameras, lights and 3D layers | pro | No† | AE: Yes† | `#threeDLayer`, `#newSceneLayer`, `#sceneProperties` | apply `layer.newCamera`, `layer.newLight`, `properties.patchAt` | both |
| 3D primitives | pro | No† | AE: Yes† | Form: `layer.new3dPrimitive` | apply `layer.new3dPrimitive` (pixels changed) | both |
| Motion tracking and stabilising | pro | No† | AE: Yes | Form: `track.motion` is accepted on a still, not confirmed useful | apply `track.*` is accepted; not confirmed useful with no video footage | missing |
| Rotoscope and Roto Brush | pro | No† | AE: Yes | none that works. Form refuses `points` sent as text | apply `roto.stroke` (pixels changed on a still layer; video not possible) | concierge only |
| Puppet pins | pro | No† | AE: Yes† | none that works. Form refuses `position` sent as text | apply `puppet.addPin` (accepted; effect on the frame not confirmed) | concierge only |
| Content-Aware Fill | pro | No† | AE: Yes | none | none usable. `layer.newContentAwareFill` only returned `{"frontend":"window.panel"}` | missing |
| Markers | basic to pro | No† | AE: Yes† | Form: `comp.addMarker` | apply `comp.addMarker`, `layer.addMarker` | both |
| Scrub and play the preview | basic | Canva: Yes† | Yes | `#time`, `#play`, `#previousFrame`, `#nextFrame`, `#loop` (frames render one at a time; the screen warns it may be slower than real time) | none. No tool returns a frame, so the concierge cannot see its work | UX only |
| Render MP4 or transparent PNG sequence | basic | Canva: MP4† | Yes | `#renderStart`, `#renderFormat`, `#renderCancel`, `#renderDownload` | `motion-start-render`, `motion-render-status`, `motion-cancel-render`, `motion-list-renders` | both |
| Render GIF or video with transparency | basic to pro | Canva: GIF† | AE: Yes† | none. Format is `mp4` or `png-sequence` (`routes/render-export.mjs`) | none | missing |
| Export and import an editable project | pro | not confirmed | AE: Yes† | `#export`, `#importDocument`, `#bundleExport`, `#importBundle` | `motion-export-document`, `motion-export-bundle`, `motion-begin-bundle-import` and siblings | both |

**The mobile and basic/pro picture.** `workbench.css` has breakpoints at 900 px and 560 px, so the page reflows to one column. It is still one very long page of forms: 433 commands sit in one dropdown, on the same page as masks, cameras and feather points. There is no basic mode. Canva's position is a small set of one-tap actions on a phone. After Effects has no phone version at all, so a usable phone mode would go past the desktop standard, but beginners currently cannot find the basics here.

## 3. Backlog (ordered by what people hit first)

- **CREATE-TOOL-MOTION-STUDIO-01: Drag on the canvas.** Done when: a person drags, scales and rotates a selected layer directly on the preview with mouse and touch, and the saved values match the handles.
- **CREATE-TOOL-MOTION-STUDIO-02: Add video and audio.** Done when: an MP4 and an MP3 upload to a composition, play in preview, and the rendered MP4 has both picture and sound. The same import works through a concierge tool.
- **CREATE-TOOL-MOTION-STUDIO-03: Basic mode and one-tap animation.** Done when: at 412 px a person sees text, photo, a list of named animations and Export, and turns a photo plus a caption into an animated MP4 with no number box.
- **CREATE-TOOL-MOTION-STUDIO-04: Drag on the timeline.** Done when: a person drags a layer bar and a keyframe in `#timeline` with mouse and touch, and the new timing is saved.
- **CREATE-TOOL-MOTION-STUDIO-05: Let the concierge see a frame.** Done when: a `motion-preview` tool returns one rendered frame the model can read, and the persona checks its own edit before reporting it done.
- **CREATE-TOOL-MOTION-STUDIO-06: Fix the generic form's parameter types.** Done when: every catalog parameter that needs a list or number is sent as one, `shape.newPath`, `puppet.addPin`, `roto.stroke` and `layer.style.dropShadow` succeed from the form, and a test runs each through the real route.
- **CREATE-TOOL-MOTION-STUDIO-07: Named controls for the common form-only actions.** Done when: blend mode, track matte, text presets, markers, layer styles and null layers each have a labelled control with choices, not a typed parameter box.
- **CREATE-TOOL-MOTION-STUDIO-08: Templates and presets.** Done when: a person picks a starter composition and a preset from a gallery, and the concierge can apply the same preset by name. `anim.applyPreset` is admitted through an owned-asset adapter.
- **CREATE-TOOL-MOTION-STUDIO-09: Screen history and redo.** Done when: the screen lists revisions with a Restore button, Redo returns the undone revision, and both match what the concierge tools report.
- **CREATE-TOOL-MOTION-STUDIO-10: Pen tool.** Done when: a person draws and edits a bezier shape and a mask path by dragging on the preview, and the path round-trips through `motion-inspect-project`.
- **CREATE-TOOL-MOTION-STUDIO-11: Graph editor.** Done when: a person drags speed-curve handles and the concierge's `keys.velocity` reads back the same numbers.
- **CREATE-TOOL-MOTION-STUDIO-12: GIF, transparent video and own fonts.** Done when: a composition renders to GIF and to video with an alpha channel, a person uploads a font and a text layer renders with it, each on screen and by tool.
- **CREATE-TOOL-MOTION-STUDIO-13: Decide tracking, roto, puppet and fill.** Done when: each of these either works on video after CREATE-TOOL-MOTION-STUDIO-02, proven by a render test, or is removed from the catalog shown to people and to the concierge. `layer.newContentAwareFill` must no longer report success with no effect.

## 4. Sources

- After Effects has no native iPad app: https://vagon.io/blog/the-best-ways-to-run-adobe-after-effects-on-ipad and https://community.adobe.com/questions-529/adobe-after-effects-on-ipad-pro-39383 (third-party and community sources; check Adobe's own page before relying on this)
- After Effects Content-Aware Fill: https://helpx.adobe.com/after-effects/using/content-aware-fill.html
- After Effects tracking: https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/track-motion/tracking-stabilizing-motion-cs5.html
- After Effects expressions: https://helpx.adobe.com/after-effects/desktop/work-with-expressions/expression-language-reference/expression-language-reference.html
- After Effects masks and shape paths: https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/animate-shape-paths-and-masks/animating-shape-paths-masks.html
- After Effects rotoscoping: https://www.adobe.com/products/aftereffects/rotoscoping.html
- Canva animation help (could not be fetched directly; seen through search): https://www.canva.com/help/animate-designs/
- Canva Create an animation on phone (community guide): https://nerdschalk.com/create-animation-canva/
- Canva Magic Animate page: https://www.canva.com/ko_kr/pro/animator/ (I could not confirm from a primary source that it is Pro-only)
