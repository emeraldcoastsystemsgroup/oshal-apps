# publishing-studio: parity audit against Adobe InDesign and Affinity Publisher

Audited 2026-11-03 from the frozen store snapshot (package version 0.1.1). Read-only.

## 1. What it is

Publishing Studio lays out short English print pieces with linked text frames, named styles and master pages, and renders them to a PDF through Typst; a person works in `tools/workbench.html`, and the `publishing-editor` concierge uses 14 declared tools over the same revision store. It is measured against Adobe InDesign (Windows and macOS only [I11], one subscription) and Affinity Publisher, now the Layout side of Affinity by Canva (free on Mac and Windows, and on iPad from 3 November 2026). Its concierge side is close to its screen side; both are small next to the industry applications, and it refuses non-ASCII text, including a curly quote.

## 2. Parity table

How to read it:

- **Concierge tools** are the `tools:` entries in `oshal-app.yaml`. The named operations (`set-frame`, `replace-layout` and so on) go through `publishing-apply-edits`, validated by `apply()` and `validate()` in `routes/model.mjs`. `operationsJson` is capped at 15,000 characters, so `replace-layout`, which carries every page, can stop fitting on a fuller document.
- **Tier:** neither product sells a pro tier. I use **basic** for everyday layout and **pro** for long-document and print-production work.
- **Industry mobile:** InDesign has no mobile app that I could find; Adobe's own page points to a separate companion for phones and tablets [I12]. Affinity has an iPad app with a Layout mode [F1][F2]; I could not confirm individual features on it. Below, **"ID none; Aff iPad?"** means exactly that, and I do not repeat it per row with a source.
- **Industry desktop:** a [tag] points to Sources. **unchecked** means common knowledge that no page I read states. **not confirmed** means I looked and found no statement.
- **typed** means a text or JSON box instead of a control on the page.

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Type accented letters, curly quotes, dashes, other languages | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none. `text()` in `routes/model.mjs` refuses anything outside tab, line feed and printable ASCII | none, same validator | missing |
| New document with page count and size | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | `#new` (title, pages), then Trim width and height in Page, guides and master | `publishing-create-document`; `set-page` | both |
| More than 8 pages | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked; books [I10][F8] | none. `LIMITS.pages` is 8 | none, same limit | missing |
| Add or remove a page | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | `#add-page`, `#remove-page` | `replace-layout` | both |
| Reorder pages | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none. `#page-rail` only selects | `replace-layout`; linked frames must be relinked in the same edit, because `validate()` refuses backward reading order | concierge only |
| Facing pages | basic | ID none; Aff iPad? | ID: unchecked. Aff: yes [F1] | `#page-view` | `set-view` | both |
| Margins, bleed, guides | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | `#page-properties`; guides typed as comma lists | `set-page` | both |
| Edit master page items | basic | ID none; Aff iPad? | ID: yes [I1]. Aff: yes [F1] | `#master-objects`: typed JSON, then `#apply-master` | `set-master` | both |
| Create a new master or apply one per page | basic | ID none; Aff iPad? | ID: yes [I1]. Aff: yes [F1] | Apply yes, in `#master`; create none. `initial()` makes one master, no control adds another | `replace-layout` adds a master; `set-page` applies | concierge only |
| Page numbers | basic | ID none; Aff iPad? | ID: yes [I1]. Aff: unchecked | Place an object, Kind = Page number | `replace-layout`, `set-master` | both |
| Linked text frames | basic | ID none; Aff iPad? | ID: unchecked. Aff: unchecked [F6] | Kind = Linked text frame; `#next-frame`, `#link-frame` | `set-link`, `set-frame`, `replace-layout` | both |
| Move and resize items | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | Drag on the page moves (`tools/workbench.mjs`); size typed in `#geometry` | `set-frame`, `set-object` | both |
| See real text while laying out | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none. Canvas shows outlines; text appears only after `#render` | not applicable | missing |
| Write and replace story text | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | `#story-text`, `#replace-story`; one paragraph and one character style for the whole story | `replace-story` | both |
| Mixed styles inside a story: a bold word, a heading paragraph then body | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none. `#replace-story` writes one style to every line, and discards existing runs | `replace-story` with per-paragraph and per-run `style` | concierge only |
| Change character and paragraph styles | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | Typography panel: `#character-properties`, `#paragraph-properties` | `set-character-style`, `set-paragraph-style` | both |
| Create a new named style | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none. Selects list existing styles only | `set-character-style` or `set-paragraph-style` with a new name | concierge only |
| Fonts other than Libertinus Serif | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none. `#font` is a field, but `validate()` refuses anything else | none, same validator | missing |
| Place a picture | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | `#asset-upload`, Kind = Image; PNG and JPEG to 4 MiB | `publishing-import-artifact`, `publishing-list-assets`, `replace-layout` | both |
| Replace a picture or recolour a placed item | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none. `set-object` from the screen sends position and size only; remove and place again | `set-object` with `assetId`, `color` | concierge only |
| Crop or fit a picture inside its frame | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none | none. Object has no crop field | missing |
| Shapes beyond rectangles; lines; stroke; opacity | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | Rectangle only, filled | Rectangle only, `kind` closed in `validate()` | missing |
| Text wrap | basic | ID none; Aff iPad? | ID: yes [I2]. Aff: not confirmed | none | none | missing |
| Columns in a frame, layers, stacking order, groups | basic | ID none; Aff iPad? | ID, Aff: yes, unchecked | none | none | missing |
| Tables | pro | ID none; Aff iPad? | ID: unchecked. Aff: mentioned for import [F1] | none. `CONTRACT.unsupported` | none | missing |
| Footnotes, table of contents, index, books, cross-references | pro | ID none; Aff iPad? | ID: footnotes [I3], contents [I4], books [I10]. Aff: books [F1], contents and index [F8], cross-references [F4] | none. `CONTRACT.unsupported` names footnotes | none | missing |
| Preflight | pro | ID none; Aff iPad? | ID: yes [I6]. Aff: yes [F7] | `#render`, `#preflight`; checks text overflow, fonts, image resolution, geometry (`engine/worker.py`) | `publishing-start-render`, `publishing-job-status` | both |
| Export PDF and page pictures | basic | ID none; Aff iPad? | ID: yes [I7]. Aff: yes [F1] | `#export-pdf`, `#export-layout`; no button for one PNG page | `publishing-export` (`pdf`, `layout`, `preview`) | both |
| CMYK, PDF/X, spot colour | pro | ID none; Aff iPad? | ID: PDF/X [I7]. Aff: PDF/X and CMYK [F5] | none. RGB only | none | missing |
| Package, IDML, EPUB, data merge | pro | ID none; Aff iPad? | ID: package and IDML [I5], EPUB [I8], merge [I9]. Aff: IDML import only, merge [F1]; EPUB not confirmed | none. Layout JSON download only | none | missing |

Outside the table because no industry row applies: saved history works both ways (`#history`, `#restore-history`, `publishing-restore-revision`); undo and redo of a draft is UX only (`#undo`, `#redo`); deleting a publication works both ways (`#delete-document`, `publishing-delete-document`); deleting an unused asset is UX only (Delete in `#asset-list`, route `DELETE /assets/:asset`, no tool); cancelling a render works both ways (`#cancel-render`, `publishing-cancel-render`).

## 3. Backlog, in the order people hit it

Every entry must end with a control on screen and a concierge operation, per the owner's rule.

- **CREATE-TOOL-PUBLISHING-STUDIO-01.** Accept real text: curly quotes, dashes, accents, and at least Latin-script languages, in the validator, the concierge path and the render.
  Done when: pasting `“café — naïve”` into a story saves, renders and shows the same characters in the PDF, by `#replace-story` and by `replace-story`. Text a font cannot draw gets a named error, not a blanket refusal.
- **CREATE-TOOL-PUBLISHING-STUDIO-02.** Show real text on the page while editing, not outlines until a render.
  Done when: typing in a frame shows wrapped text within a second and matches the rendered PDF's line breaks; overflow shows on the frame before Render.
- **CREATE-TOOL-PUBLISHING-STUDIO-03.** Edit text inside the frame, with bold, italic and style per selection, and a per-paragraph style choice. Stop discarding runs on Apply text.
  Done when: a person selects one word, presses Bold, keeps every other run, and the PDF shows it; the concierge's `replace-story` round-trips the same runs.
- **CREATE-TOOL-PUBLISHING-STUDIO-04.** More fonts: an included set and a person's uploaded font, with embedding rights checked.
  Done when: a person chooses a sans serif and uploads an OTF, and the PDF embeds both; `set-character-style` accepts them; a missing font is named.
- **CREATE-TOOL-PUBLISHING-STUDIO-05.** More than 8 pages, and no 15,000-character wall for the concierge on full documents: add page-scoped operations `add-page`, `remove-page`, `move-page`, `add-object`, `remove-object` so it stops resending the whole layout.
  Done when: a 64-page booklet is built, rendered and exported; the concierge adds a page to it in one small edit.
- **CREATE-TOOL-PUBLISHING-STUDIO-06.** Page and master controls on screen: drag to reorder pages, create and name a master, edit master items on the canvas rather than JSON.
  Done when: a person does each with no typed JSON; the JSON box can be hidden.
- **CREATE-TOOL-PUBLISHING-STUDIO-07.** Style and object controls on screen: new named style; recolour, retext or replace a placed item in place.
  Done when: a person changes a placed rectangle's colour and swaps a picture without removing it; a new style appears in both style lists.
- **CREATE-TOOL-PUBLISHING-STUDIO-08.** Pictures: crop, fit to frame, more file types.
  Done when: a person drags a crop on the page and the PDF matches; an operation does the same; a SVG or TIFF places.
- **CREATE-TOOL-PUBLISHING-STUDIO-09.** Text wrap and frame columns.
  Done when: text flows around a placed picture and across two columns in the render, set by control and by operation.
- **CREATE-TOOL-PUBLISHING-STUDIO-10.** Shapes, lines, strokes, opacity, layers, stacking, groups.
  Done when: each is available by control and by operation and renders in the PDF.
- **CREATE-TOOL-PUBLISHING-STUDIO-11.** Tables.
  Done when: a person inserts a table in a story, edits cells, and it flows across two frames; a concierge operation does the same.
- **CREATE-TOOL-PUBLISHING-STUDIO-12.** Print output: CMYK, PDF/X, spot colour.
  Done when: a PDF/X file passes an external validator such as veraPDF or a named preflight tool, chosen by a control and a tool parameter.
- **CREATE-TOOL-PUBLISHING-STUDIO-13.** Long documents: footnotes, table of contents, index, cross-references, books.
  Done when: a table of contents updates after a heading moves; footnotes number across frames; by control and by operation.
- **CREATE-TOOL-PUBLISHING-STUDIO-14.** Interchange and reuse: IDML import, package for print, EPUB, data merge.
  Done when: a person imports a simple IDML with its text frames intact, downloads a package with fonts and images, and merges a CSV into a card template; each has a concierge tool.
- **CREATE-TOOL-PUBLISHING-STUDIO-15.** Close the small concierge and screen gaps: `publishing-delete-asset` tool; a Download page PNG button.
  Done when: the concierge deletes an unused asset and refuses one in use; a person downloads the PNG of page 2.

## 4. Sources

Adobe help pages under helpx.adobe.com refused direct fetch (HTTP 403), so those cells rest on Adobe's text as returned by web search, not a full page read. [F7] and [F8] are from the older Affinity Publisher era and may not match the merged app; the iPad details come from press reports and the product page.

- [I1] InDesign parent pages: https://helpx.adobe.com/indesign/desktop/create-and-organize-pages/create-and-manage-parent-pages/create-parent-pages.html
- [I2] InDesign text wrap: https://helpx.adobe.com/africa/indesign/using/text-wrap.html
- [I3] InDesign footnotes: https://helpx.adobe.com/indesign/using/footnotes.html
- [I4] InDesign table of contents: https://helpx.adobe.com/indesign/using/creating-table-contents.html
- [I5] InDesign package: https://helpx.adobe.com/indesign/desktop/print/preflight/package-files-for-output.html
- [I6] InDesign preflight: https://helpx.adobe.com/africa/indesign/using/preflighting-files-handoff.html
- [I7] InDesign PDF export, PDF/X: https://helpx.adobe.com/indesign/using/exporting-publishing-pdf.html
- [I8] InDesign EPUB: https://helpx.adobe.com/indesign/using/export-content-epub-cc.html
- [I9] InDesign data merge: https://helpx.adobe.com/indesign/desktop/automation-and-scripting/merge-data/merge-data.html
- [I10] InDesign books: https://helpx.adobe.com/in/indesign/desktop/print/print-production-and-file-creation/print-or-export-book-files.html
- [I11] InDesign system requirements (Windows, macOS): https://helpx.adobe.com/indesign/system-requirements.html
- [I12] What is InDesign, Adobe page naming the phone and tablet companion: https://www.adobe.com/africa/learn/indesign/web/what-is-indesign
- [F1] Affinity page layout: https://www.affinity.studio/page-layout-software
- [F2] Thurrott, Affinity for iPad: https://www.thurrott.com/?p=343278
- [F4] Affinity cross-references: https://www.affinity.studio/help/advanced-about-crossrefs/
- [F5] Affinity print guide, PDF/X and CMYK: https://www.affinity.studio/blog/print-design-everything-you-need-to-know
- [F6] Affinity text frame setup: https://www.affinity.studio/help/text-frame-setup/
- [F7] Affinity Publisher feature list, older: https://affinity.serif.com/en-us/publisher/full-feature-list/
- [F8] Serif, books, contents and indexes, older: https://affinity.serif.com/en-us/press/newsroom/serif-raises-the-bar-with-huge-update-to-affinity-apps/

Our side, under `store-snapshot/publishing-studio/`: `oshal-app.yaml`, `tools/workbench.html`, `tools/workbench.mjs`, `routes/application.mjs`, `routes/model.mjs`, `engine/worker.py`, `personas/publishing-editor.yaml`, `PROFILE.md` (limits only; each was checked in the code named).
