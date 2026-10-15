# Product coverage and completion evidence

Requested completion standard: all referenced functionality usable by a human and
an agent, with editable integrations and installed end-to-end acceptance. This
matrix preserves that scope. The bounded first-delivery specs are intermediate
milestones. A shipped command name, source test, advertised upstream feature or
working standalone editor does not establish product parity.

Comparison checkpoint: 2026-10-11 (America/Chicago). Upstream engines are pinned
independently; their current websites may describe a different commit.

| Product family | GitHub comparison | Adobe comparison | OSHAL owner / candidate | Current evidence and open work |
|---|---|---|---|---|
| Raster editing | PhotoCraft | Photoshop / Photoshop Express / Fresco | Create | Masks, adjustments, groups and image UX/tools are source-tested. Advanced painting/retouch, smart objects, high-bit-depth/color management, PSD fidelity and installed receipts are open. |
| Vector illustration | VectorCraft | Illustrator | Create | Cubic paths, booleans and bounded SVG are source-tested. Full typography, appearance/brushes, trace, interchange and installed acceptance are open. |
| Video editing | FilmCraft | Premiere | Video | V2 multitrack source, linked audio, titles/captions, fades, keys and export proofs exist. Professional codec/project exchange, grading, tracking, multicam and installed native V2 exports remain unverified/open. |
| Photo development/library | LightCraft | Lightroom / Lightroom Classic / Bridge | Photo library (not built) | Owned RAW originals, real camera fixtures, library/rating/search/batch development, metadata/color and human/agent workflows still required. |
| Motion/compositing | EffectCraft | After Effects | Motion Studio (engine integration in progress) | [Current Motion source evidence](04-motion-compositing.md): real manual layers/keys/masks/parenting/nesting, exact current-time independentXYZtransforms and native camera/light projection/lighting controls, typed exact-current-time effect-instance observations/native UTF16 string patches/atomic full human value saves/full agent value staging/changed-only parameter edits and gradient/blur/shadow/chroma-key pixel proofs, saved mask modes/feather/opacity/expansion, exact-time animated native Bezier/variable-feather edits and complete paged agent geometry reads, exact keyframe inspection/editing and visual cubic paths, saved work-area playback/loop/frame stepping and exact native caption/typography/Unicode selections and full point-text/per-character3Dsurface/viewport pixel proofs and explicit aggregate surface refusal, exact native numbers, owned durable photos/history, crash recovery, recipient-owned editable archives, full-capacity private resumable bundle staging and protected source human/agent transfer bindings with incremental checksums, optional verified file-stream saves, fresh original authority and uncertain-reply retries, and PNG/MP4 render producer are source-tested. A complete extracted native candidate/receipt passes real importer and candidate-owned SQL/engine source workflows. Durable render/export jobs and admitted large agent-only artifact transport, Video lineage, registration/install, hosted agent approval and installed acceptance remain open. Full upstream/Adobe fidelity/file/hardware coverage is not established. |
| Publishing/layout | DesignCraft | InDesign | AI Office publishing (not built) | Pages/master pages, linked text, typography, linked editable graphics, print preflight and actual PDF output require implementation and receipts. |
| Audio workstation | SoundCraft | Audition | Audio Studio (not built) | Recording/waveforms, destructive/non-destructive edits, automation, mixer/bus/DSP, MIDI/plugin/surround comparison and lossless exports still open. Video audio tracks do not close this row. |
| PDF workbench | PdfCraft | Acrobat Pro / Reader / Fill & Sign / Scan | PDF workbench (inventory/open) | Existing intake is not proof of an editor. Inventory page/text/forms/signing/OCR/redaction/security and build missing operations. Verify actual removal for redaction and actual signature semantics. |
| Word processing | WordCraft | Cross-suite document workflows | AI Office | Existing generation is confirmed; interactive document editing, tables/styles/review/export, human/agent parity and installed cross-app tasks require comparison evidence. |
| Presentations | DeckCraft | Cross-suite presentation workflows | AI Office | Existing deck generation is confirmed. Full slide editing, layouts, animations/presentation/export and editable exchange require evidence. |
| CAD/drafting | CADCraft | Cross-suite design/3D workflows | CAD Studio | Existing app/engine is confirmed; compare the upstream command/format/workflow inventory and verify installed tasks rather than assume closure. |
| Spreadsheets | GridCraft | Cross-suite spreadsheet workflows | AI Office | Existing workbook generation is confirmed. Formula/grid editing, charts, pivots, imports/exports and human/agent task coverage remain to audit. |
| 2D/character animation | No dedicated lineup row established | Animate / Character Animator | Motion / animation integration | Timeline motion alone is insufficient. Rigging, capture, lip-sync, symbols/tweening, interactive/web exports and installed task coverage are not proven. |
| Encoding and review | FilmCraft/EffectCraft export components | Media Encoder / Frame.io workflows | Video / shared media | Queue/cancel/progress, transparent/high-bit-depth formats, hardware/output validation and cross-app review lineage require explicit proof. |
| Creative generation/templates | ArtCraft studio / template surfaces | Firefly / Express | Create / member studios | Existing provider routes/templates are not full parity. Inventory actual offered generation/edit/variation/brand workflows, permissions/cost consent and live receipts. |
| 3D materials/sculpting | Engine/interchange sources to inventory | Substance 3D family | Scene Studio / CAD / motion | Owning inventory, actual product functionality and format/asset handoffs are still open; no equivalent assumed from a Blender launcher. |
| Web authoring and publishing | No dedicated lineup row established | Dreamweaver / Portfolio | Web/source/publishing apps to inventory | Product comparison and actual human/agent site authoring/publish receipts are missing. |
| Shared assets/ecosystem | Launcher / app interchange | Capture / Libraries / Fonts / Stock / Behance / plugins | Shared Files/artifacts / brand / creative apps | Editable asset reuse, fonts/color licensing, format compatibility, plugin execution, review/publishing and owner/lineage receipts need explicit coverage. No claim to Adobe's proprietary assets/catalogue. |

The Adobe Creative Cloud product page and ArtCraft lineup establish inventory,
not feature completeness. Any further Adobe product offered by the user-referenced
scope remains unclosed until inventoried; this table is not an exclusion list.

For every product expand commands, import/export formats, behavior, performance,
UX tasks and handoffs into individually traceable rows. A row closes only with:

1. A primary-source benchmark entry pinned by version/commit and a reproducible
   task/fixture, with expected real output and declared fidelity tolerances.
2. Current OSHAL source paths, tests and build hash; actual render/decode/data
   evidence (not a count of supported names).
3. Installed human workflow on normal/narrow screens, save/reopen/history,
   cancellation and failures. Record actual application/source/catalog versions.
4. Installed agent workflow over the same operations, original actor/grants,
   explicit write approval where the existing kernel requires it, stale revision
   handling and honest completion/results.
5. Two-owner and revoked-access proofs, input/resource limits, cleanup and
   artifact/source lineage. Verify that the receiving editor preserves the
   supported editable structure; a flattened render is labeled as such.
6. Regression receipts for the old installed workflows. Missing, indirect or
   uncertain evidence keeps the row open.

## Evidence sources

- [ArtCraft lineup](https://getartcraft.com/apps)
- [Adobe Creative Cloud product inventory](https://www.adobe.com/creativecloud/all-apps.html)
- [After Effects current help inventory](https://helpx.adobe.com/after-effects/desktop.html)
- [EffectCraft pinned source](https://github.com/storytold/effectcraft/tree/67434e90388b6dca4417555346fa6850b6f96033)
- [EffectCraft known gaps](https://github.com/storytold/effectcraft/blob/67434e90388b6dca4417555346fa6850b6f96033/docs/gaps.md)
- [EffectCraft parity evidence](https://github.com/storytold/effectcraft/blob/67434e90388b6dca4417555346fa6850b6f96033/docs/target-app-parity.md)

Native activation stays coordinated through the kernel COLLABORATE.md. This
inventory does not certify installations, upstream behavior or completed parity.
