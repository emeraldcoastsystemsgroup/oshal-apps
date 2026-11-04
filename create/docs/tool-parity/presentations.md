# presentations (AI Office): parity audit against PowerPoint, Word, Excel, and Google Slides, Docs, Sheets

Audited 2026-11-03 from the frozen store snapshot (package version 2.16.0). Read-only.

## 1. What it is

AI Office keeps one text outline (a title plus lines of light markup per section) and exports it as a .pptx, .docx or .xlsx, with a separate on-screen editor for each kind in `tools/presentations.html`. It is measured against Microsoft PowerPoint, Word and Excel (desktop and mobile) and Google Slides, Docs and Sheets. It is a generator with an editor on top, not a file editor: opening a file reads its text into the outline, and every export writes a new file from the outline, so anything the outline cannot say is lost.

## 2. Parity tables

How to read them:

- **Concierge has two levels here, and they are very different.** A `tools:` entry works from Jarvis and needs no open editor; there are exactly three: `presentations-list`, `presentations-create-deck`, `presentations-create-document`. None edits a saved file, and none makes a spreadsheet. A **Guide op** (`set_title`, `set_theme`, `set_outline`, `update_slide`, `add_slide`, `update_cell`) is not a `tools:` entry. It is a proposal validated by `cleanActions()` in `src-routes/bot-presentation-routes.ts`, offered only from the rail inside the open studio, and applied only when the person presses Apply changes (`tools/office-assistant.mjs`). I count it toward Status because a validator accepts it and it does change the draft; every such cell says `Guide:`. The final counts also give the number that rests on a Guide op alone.
- **typed** means no button: the person types the markup (`| a | b |`, `Q3: 240`) in a text box. The markup is listed on screen under "Slide syntax + the 20 layouts". Status counts it as a UX control.
- **Guide limits.** `cleanSlides()` keeps 30 sections and 12 lines of 300 characters per section, both ways, so the Guide neither sees nor can rewrite more than that.
- **Engine** means `crates/host-process/native-runtime/core-sources/src/features/presentation-generation/services/` in `oshal-kernel`, the kernel skill the package calls. Read in code, not run.
- **Industry cells:** "PPT:", "Slides:" and so on name the product. A [tag] points to Sources. **unchecked** means common knowledge that no page I read states. **not confirmed** means I looked and found no statement. Microsoft's mobile tables are old, and some disagree with its newer mobile page; the Sources section says which. "Paid" on Microsoft mobile means a Microsoft 365 subscription; core editing is free on screens up to 10.1 inches [M2].

### 2a. Decks: PowerPoint and Google Slides

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Make a new deck | basic | PPT: yes, free [M2]. Slides: yes [G1] | PPT, Slides: yes, unchecked | `#officeFormat`, Add slide, `#genBtn` (`tools/presentations.html`, `tools/slide-workspace.mjs`) | `presentations-create-deck` | both |
| Open an existing .pptx | basic | PPT, Slides: yes, unchecked | PPT, Slides: yes, unchecked | `#openBtn` to `POST /sections/import`. Text, tables and numbers only: the engine's `office-import.ts` reads no pictures; `importOfficeBlob` keeps title and content, so speaker notes are dropped | none. The "Open in AI Office" artifact is a send-to, not a tool | UX only |
| Add a slide | basic | PPT: yes, unchecked. Slides: yes [G1] | yes, unchecked | Add slide (`slide-workspace.mjs`) | Guide: `add_slide`; `sections[]` on create | both |
| Duplicate a slide | basic | PPT: unchecked. Slides: unchecked | yes, unchecked | Duplicate | Guide: `set_outline` only (rewrites the whole outline) | both |
| Delete a slide | basic | Slides: yes [G1]. PPT: unchecked | yes, unchecked | Delete | Guide: `set_outline` only | both |
| Reorder slides | basic | Slides: drag, yes [G1]. PPT: unchecked | yes, unchecked | Move earlier, Move later; no drag | Guide: `set_outline` only. `serializeHelperSlides` merges images by position, so an image stays at the old slot, not with its slide | both |
| Edit a slide's title and points | basic | yes, unchecked | yes, unchecked | Inline on the canvas (`contentEditable`), Slide title, Slide text | Guide: `update_slide` | both |
| Choose a layout | basic | Slides: yes [G3]. PPT: unchecked | yes, unchecked | `.office-slide-layout-select` over 20 layouts, plus `#autoLayout` | `#layout:` line in `sections[].content`; Guide: `update_slide` | both |
| Change the theme | basic | PPT: yes [M1]. Slides: yes [G3] | PPT: yes [M1]. Slides: yes [G3] | `#themes` gallery, 10 looks | `theme` on both create tools; Guide: `set_theme` | both |
| Use the brand kit | not confirmed | not confirmed | not confirmed | "Your brand" look when a Create kit exists | none. Create tools declare no `brand`; `set_theme` passes only `isThemeId` | UX only |
| Put a text box anywhere | basic | PPT: yes [M1]. Slides: yes [G4] | PPT: yes [M1]. Slides: yes [G4] | none. The layout places all text | none | missing |
| Font, size, colour, bold on chosen text | basic | PPT: yes; custom colours paid [M2]. Slides: unchecked | yes, unchecked | none. Theme only | none | missing |
| Add a picture | basic | PPT: yes [M1]. Slides: yes [G5] | yes [M1][G5] | Add image, Replace image, Remove image; PNG, JPEG, GIF, WebP to 8 MB (`readImageFile`) | `#image: https://...` line only; no upload path; create tools, Guide: `update_slide` | both |
| Picture caption | basic | unchecked | unchecked | Caption field | `#caption:` line | both |
| Move, resize, crop a picture | basic | Slides: yes [G6]. PPT: Change Picture absent, dated [T3] | yes, unchecked | none. Layout decides | none | missing |
| Shapes and lines | basic | PPT: yes [M1]. Slides: yes [G4] | PPT: yes [M1]. Slides: yes [G4] | none | none | missing |
| Tables | basic | PPT: yes [M1]. Slides: not confirmed | yes [M1] | typed `\| a \| b \|` in Slide text; exports a real table | same lines in `content`; Guide: `update_slide` | both |
| Charts | pro on mobile | PPT: chart elements paid [M2]; older table says no [M1]. Slides: not confirmed | PPT: yes [M1] | typed `Q3: 240`; exports a native chart. No chart editor | same lines in `content`; Guide: `update_slide` | both |
| Timeline, process, KPI, comparison graphics | pro on mobile | PPT: SmartArt paid on Android [M2]. Slides: not confirmed | PPT: yes [M1] | typed `::` and `##` lines, or Layout picker | same lines in `content`; Guide: `update_slide` | both |
| Speaker notes | basic | PPT: yes [M1]. Slides: yes [G7] | PPT: yes [M1]. Slides: yes [G7] | none. `parseOutline` carries title and content only | `sections[].notes` on `presentations-create-deck`; no Guide op | concierge only |
| Slide numbers on or off | basic | unchecked | unchecked | `#slideNumbers` | none. `slideNumbers` not in the tool's `inputSchema` | UX only |
| Cover subtitle | basic | unchecked | unchecked | none | `subtitle` on `presentations-create-deck` | concierge only |
| Cover byline | basic | unchecked | unchecked | `#byline` | none. Not in `inputSchema` | UX only |
| Transitions | basic | PPT: yes [M1]; Morph paid [M2]. Slides: no, computer only [G8] | PPT: yes [M1]. Slides: yes [G8] | none | none | missing |
| Animations | basic | PPT: yes [M1]. Slides: no, computer only [G8] | PPT: yes [M1]. Slides: yes [G8] | none | none | missing |
| Present full screen | basic | PPT: yes, dated [T3]. Slides: yes [G7] | yes, unchecked; Slides [G7] | none. Draft tab and Quick look are static cards | none | missing |
| Presenter view | pro | PPT: paid [M2]; older table says no [M1]. Slides: notes while casting [G7] | PPT: yes [M1] | none | none | missing |
| Record a presentation | pro | PPT: no [M1] | PPT: yes [M1] | none | none | missing |
| Comments | basic | PPT: yes [M1]. Slides: not confirmed | PPT: yes [M1] | none | none | missing |
| Share a link, edit together | basic | PPT: yes [M1]. Slides: yes [G10] | PPT: yes [M1] | none | none | missing |
| Export to PDF | basic | Slides: yes [G9]. PPT: unchecked | yes, unchecked | none. "pdf" appears nowhere in the studio files | none | missing |
| Email the file | basic | unchecked | unchecked | `#emailBtn`, `#emailSend` | none | UX only |
| Post the file to Slack | not an industry row | not applicable | not applicable | none. No button in `tools/presentations.html` | none. Route `POST /sections/slack` exists with no `tools:` entry | missing |
| Choose where it saves | basic | unchecked | unchecked | `#saveTo`, `#destChip` | none. `saveTo` not in `inputSchema` | UX only |
| Video and audio | pro on mobile | PPT: iOS yes, Android no [M1]. Slides: video [G5] | PPT: yes [M1] | none | none | missing |
| Edit the slide master | pro | PPT: not confirmed [M1]. Slides: not confirmed | PPT: yes on PC and Mac [M1] | none. Masters are generated | none | missing |
| Draft a whole deck from a topic | add-on: Copilot, Gemini | not confirmed | not confirmed | `#aiBtn`, `#wzDraft` | `presentations-create-deck` (the model writes, the tool saves); Guide: `set_outline` | both |
| Rewrite the selected slide with AI | add-on: Copilot, Gemini | not confirmed | not confirmed | `#chatIn`, `#chatChips`, review card with Apply changes and Discard | Guide: `update_slide` | both |
| Undo and redo | basic | unchecked | unchecked | Undo, Redo | none | UX only |
| Dictate a request or topic | basic | unchecked | unchecked | `#micChat`, `#wzMicTopic` (these fill the chat box and the topic box, not the slide) | not applicable to a tool | UX only |
| Start from a template | basic | Slides: yes [G3]. PPT: unchecked | yes, unchecked | `#tpls` from `GET /sections/starters` | none. No tool reads or takes a starter | UX only |
| See saved files | basic | unchecked | unchecked | My files (`#tabDecks`) | `presentations-list` | both |
| Reopen a saved deck and change it | basic | yes, unchecked | yes, unchecked | Edit & regenerate (`#fEdit`) | none. `presentations-list` returns the outline, but the only write makes another file | UX only |
| Delete a saved file | basic | unchecked | unchecked | `#fDel` | none. `DELETE /sections/file` has no `tools:` entry | UX only |

### 2b. Documents: Word and Google Docs

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Make a new document | basic | Word: yes, free [M2]. Docs: yes [G11] | yes, unchecked | Format = Document, Add section, `#genBtn` | `presentations-create-document` | both |
| Open an existing .docx | basic | yes, unchecked | yes, unchecked | `#openBtn`. The engine's `office-import.ts` clips every line to 300 characters and every section to 8,000, reads no pictures | none | UX only |
| Headings | basic | Word: styles apply [M4]. Docs: Heading 1-6 [G12] | Word: yes [M3]. Docs: yes [G12] | Section heading field; level 2 typed `## Heading` | `sections[].title`; Guide: `update_slide` | both |
| Body paragraphs | basic | yes, unchecked | yes, unchecked | none that works. The on-screen note says write paragraphs normally, but the engine's `slideBlocks()` in `docx-renderer.ts` sends each plain line to `bullet()`, which adds a bullet and cuts it at 600 characters | none. Same renderer | missing |
| Bulleted lists | basic | Docs: unchecked. Word: unchecked | yes, unchecked | Section content box: each line is a bullet | lines in `content`; Guide: `update_slide` | both |
| Numbered lists | basic | unchecked | unchecked | none. Only one bullet list format in `docx-renderer.ts` | none | missing |
| Bold, italic, font, colour | basic | Word: yes, unchecked. Docs: yes [G12] | yes, unchecked | none | none | missing |
| Tables | basic | Word: yes [M4]. Docs: yes [G13] | Word: yes [M3]. Docs: yes [G13] | typed `\| a \| b \|` in Section content | same lines in `content`; Guide: `update_slide` | both |
| Pictures | basic | Word: yes [M4]. Docs: yes [G5] | Word: yes [M3]. Docs: yes [G5] | Add image, Replace image, Remove image (`documentDesignRow`) | none in effect. `imageBlock()` in `docx-renderer.ts` embeds data URIs only and the model never holds image bytes, so an `#image: https://...` line draws nothing | UX only |
| Picture captions | basic | unchecked | Word: yes [M3] | none. Deliberately no control: the exporter does not draw `#caption:` | none | missing |
| Custom header and footer, page numbers | basic | Word: paid [M2]. Docs: yes [G14] | Word: yes [M3] | none. The exporter adds its own footer with the title and page number | none | missing |
| Page size, margins, orientation | basic | Word: orientation paid [M2]. Docs: yes [G15] | yes, unchecked | none | none | missing |
| Columns and section breaks | pro on mobile | Word: paid [M2] | Word: columns yes, section break yes [M3] | none | none | missing |
| Table of contents | basic | Word: view only, dated [M4]. Docs: not on Android [G12] | Word: yes [M3]. Docs: yes [G12] | none | none | missing |
| Footnotes | basic | Word: view yes; add not clear [M4]. Docs: yes [G14] | Word: yes [M3] | none | none | missing |
| Track changes, suggestions | pro on Word mobile | Word: paid [M2]. Docs: review suggestions [G11] | Word: yes [M3] | none | none | missing |
| Comments | basic | Word: yes [M4]. Docs: yes [G16] | Word: yes [M3] | none | none | missing |
| Find and replace | basic | Word: yes [M4]. Docs: not confirmed | not confirmed | none | none | missing |
| Spell check, word count | basic | not confirmed | Word: yes [M3] | none in the app. Browser's own only | none | missing |
| Named styles | basic | Word: apply and add, not customize [M4]. Docs: built-in list [G12] | Word: yes [M3] | none. Theme sets them | none | missing |
| Change the theme | basic | not confirmed | not confirmed | `#themes` gallery | `theme`; Guide: `set_theme` | both |
| Add a section | basic | yes, unchecked | yes, unchecked | Add section | Guide: `add_slide` | both |
| Delete or move a section | basic | yes, unchecked | yes, unchecked | typed, in "Outline and advanced content" only (`#outline`). No button in the Document view | Guide: `set_outline` only | both |
| Cover page | basic | unchecked | unchecked | `#title`, `#byline`; cover drawn on export | `title`, `subtitle` on create | both |
| Hyperlinks | basic | unchecked | unchecked | none | none | missing |
| Export to PDF | basic | Word: iOS yes, Android conflicting [M4]. Docs: yes [G9] | Word: yes [M3] | none | none | missing |
| Email the file | basic | Word: yes [M4] | unchecked | `#emailBtn` | none | UX only |
| Dictate into the document | basic | Word: unchecked. Docs: voice feature is plan-gated [G17] | Word: yes [M3] | none. `#micChat` fills the chat box only | none | missing |
| Draft a whole document from a topic | add-on: Copilot, Gemini | not confirmed | not confirmed | `#aiBtn` | `presentations-create-document`; Guide: `set_outline` | both |
| Rewrite the selected section with AI | add-on: Copilot, Gemini | not confirmed | not confirmed | `#chatIn`, review card | Guide: `update_slide` | both |
| Start from a template | basic | unchecked | unchecked | `#tpls`: resume, flyer, letter, report starters | none | UX only |
| Compare documents | pro | Word: no [M4] | Word: yes [M3] | none | none | missing |
| Mail merge | pro | not confirmed | Word: yes [M3] | none | none | missing |
| Citations and bibliography | pro | not confirmed | Word: yes [M3] | none | none | missing |
| Version history | basic | not confirmed | Word: yes [M3] | none. Each Generate writes a file; no history of a document | none | missing |
| Share a link, edit together | basic | Word: invite and links yes [M4]. Docs: yes [G10] | Word: yes [M3] | none | none | missing |
| Undo and redo | basic | unchecked | unchecked | `#documentUndo`, `#documentRedo` | none | UX only |
| See saved files | basic | unchecked | unchecked | My files | `presentations-list` | both |
| Reopen a saved document and change it | basic | yes, unchecked | yes, unchecked | Edit & regenerate | none. Only write makes another file | UX only |
| Delete a saved file | basic | unchecked | unchecked | `#fDel` | none | UX only |

### 2c. Spreadsheets: Excel and Google Sheets

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Make a new workbook | basic | Excel: yes, free [M2]. Sheets: yes [G18] | yes, unchecked | Format = Spreadsheet, Add sheet, `#genBtn` (`tools/sheet-workspace.mjs`) | none. `POST /sections/xlsx` has no `tools:` entry; Guide: `set_outline` fills an open draft but no tool makes the file | UX only |
| Open an existing .xlsx | basic | Excel: yes [M7]. Sheets: yes [G18] | yes, unchecked | `#openBtn`. `xlsxTableLines()` keeps 30 data rows and 8 columns, adding "(+N more rows)"; formulas become their stored result | none | UX only |
| Type into a cell | basic | yes, unchecked | yes, unchecked | Grid plus `.sheet-value` and Apply | Guide: `update_cell` (rows to 999, no pipe character or line breaks) | both |
| Formulas that calculate | basic | Excel: yes, some newer functions missing [M5]. Sheets: not confirmed on the page read | Excel: yes, also on web [M10] | none. On-screen notice says formulas save as text; `cellValue()` in `xlsx-renderer.ts` writes the string | none. Same | missing |
| A live total | basic | yes, unchecked | yes, unchecked | typed: a numeric `Label: Value` sheet gets one `SUM` total on export, no other formula | Guide: `set_outline` | both |
| Fill a column or row by dragging | basic | Excel: yes [M7] | Excel: yes, also on web [M10] | none | none | missing |
| Add a row or column at the end | basic | yes, unchecked | yes, unchecked | Add row, Add column | Guide: `update_cell` past the last row | both |
| Insert or delete a row or column in the middle | basic | yes, unchecked | Excel: yes, also on web [M10] | typed, in Source inspector only | Guide: `set_outline` only | both |
| Add, rename, duplicate, remove sheets | basic | yes, unchecked | Excel: yes, also on web [M10] | Add sheet, Rename, Duplicate, Remove | Guide: `add_slide`, `update_slide`, `set_outline` | both |
| Reorder sheets | basic | unchecked | yes, unchecked | typed, in `#outline` only | Guide: `set_outline` only | both |
| Number, currency, date formats | basic | not confirmed | Excel: yes, also on web [M10] | none. Bare numbers become numbers; "$1.2M" and "94%" stay text | none | missing |
| Cell font, fill, border | basic | Excel: fonts [M7]. Sheets: yes [G18] | Excel: yes, also on web [M10] | none. Theme only | none | missing |
| Merge cells | basic | Sheets: yes [G19] | Excel: yes, also on web [M10] | none | none | missing |
| Wrap and align | basic | unchecked | Excel: alignment yes, also on web [M10] | none | none | missing |
| Column width, row height | basic | unchecked | yes, unchecked | none. Export fits widths itself (`fitColumns`) | none | missing |
| Freeze rows or columns | basic | Sheets: yes [G19]. Excel: not confirmed | Excel: yes, also on web [M10] | none. Export always freezes the header row | none | missing |
| Sort | basic | Sheets: yes [G20]. Excel: not confirmed outside PivotTables [M6] | Excel: yes, also on web [M10] | none | none | missing |
| Filter | basic | Sheets: yes [G20]. Excel: not confirmed outside PivotTables [M6] | Excel: yes, also on web [M10] | none | none | missing |
| Find and replace | basic | unchecked | Excel: find on web, replace desktop only [M10] | none | none | missing |
| Conditional formatting | pro on Excel mobile | Excel: view only [M6]. Sheets: yes [G21] | Excel: yes, also on web [M10] | none | none | missing |
| Dropdowns and data validation | pro on Excel mobile | Excel: view and pick only [M6]. Sheets: yes [G22] | Excel: yes, also on web [M10] | none | none | missing |
| Charts in the workbook | basic | Excel: yes [M7]. Sheets: yes [G23] | Excel: yes, also on web [M10] | none. `xlsx-renderer.ts` draws no chart; a series becomes numbers | none | missing |
| Pivot tables | pro | Excel: view, no new ones [M6]. Sheets: no, computer only [G24] | Excel: yes, also on web [M10]. Sheets: yes [G24] | none | none | missing |
| Comments | basic | Excel: yes [M6]. Sheets: yes [G16] | Excel: yes, also on web [M10] | none | none | missing |
| Share a link, edit together | basic | Sheets: yes [G18]. Excel: yes [M7] | Excel: yes, also on web [M10] | none | none | missing |
| Download the .xlsx | basic | unchecked | Excel: yes, also on web [M10] | Generate, then Download on the result card | none | UX only |
| Export to PDF or CSV | basic | Sheets: PDF, unchecked | yes, unchecked | none | none | missing |
| Print setup | basic | Sheets: print yes [G25] | Excel: yes, also on web [M10] | none | none | missing |
| Undo and redo | basic | unchecked | Excel: yes, also on web [M10] | Undo, Redo | none | UX only |
| Change the theme | basic | not confirmed | not confirmed | `#themes` gallery | Guide: `set_theme` | both |
| Start from a template | basic | unchecked | unchecked | `#tpls`: budget, plan, tracker, invoice starters | none | UX only |
| Draft a workbook from a topic | add-on: Copilot, Gemini | Excel Copilot chat only on phones [M8]. Gemini: charts by prompt [G26] | Excel Copilot edits [M8] | `#aiBtn` | Guide: `set_outline` only; no tool writes the file | both |
| Change a selected cell with AI | add-on: Copilot, Gemini | Excel Copilot chat only on phones [M8] | Excel Copilot edits [M8] | `#chatIn`, review card | Guide: `update_cell` | both |
| Email the file | basic | unchecked | unchecked | `#emailBtn` | none | UX only |
| Macros and scripts | pro | VBA no on iOS, Android [M9] | Excel: desktop only, web cannot create [M10][M9] | none | none | missing |
| Goal Seek, Solver, data tables | pro | Excel: Solver add-in topic [M7], not confirmed otherwise | Excel: desktop only, web shows results [M10] | none | none | missing |
| See saved files | basic | unchecked | unchecked | My files | `presentations-list` | both |
| Reopen a saved workbook and change it | basic | yes, unchecked | yes, unchecked | Edit & regenerate | none. No tool writes a workbook | UX only |
| Delete a saved file | basic | unchecked | unchecked | `#fDel` | none | UX only |

## 3. Backlog, in the order people hit it

Every entry must end with a control on screen and a concierge operation, per the owner's rule.

- **CREATE-TOOL-PRESENTATIONS-01.** Word documents export real paragraphs, not a bullet per line cut at 600 characters.
  Done when: a 900-character paragraph typed in the Document view opens in Word as one unbulleted paragraph with every character; a test unzips the .docx and checks there is no `numPr` on it. The same text through `presentations-create-document` gives the same result.
- **CREATE-TOOL-PRESENTATIONS-02.** Opening a file keeps its content: no 30-row, 8-column, 300-character or 8,000-character cuts, pictures come through, and notes survive in the studio.
  Done when: a 500-row, 12-column workbook opens with all rows; a Word paragraph of 1,000 characters is whole; a deck's pictures and speaker notes are still there after open and Generate. Add a concierge `presentations-open-file` tool that does the same from an artifact handle.
- **CREATE-TOOL-PRESENTATIONS-03.** Spreadsheet formulas calculate on screen and export live.
  Done when: typing `=SUM(A2:A4)` in the grid shows the sum, the downloaded cell holds a formula that recalculates in Excel, and `update_cell` writes the same.
- **CREATE-TOOL-PRESENTATIONS-04.** `presentations-create-workbook` tool, matching the deck and document tools.
  Done when: "make a budget spreadsheet" from Jarvis saves a real .xlsx and answers with its link and `openUrl`.
- **CREATE-TOOL-PRESENTATIONS-05.** Concierge edits a saved file. Add `presentations-read-file` and `presentations-apply-edits` tools, with the Guide ops as their operations and no 30-section or 12-line limit. Today edit works only as a proposal inside an open studio.
  Done when: from Jarvis, "change slide 3's title in my Q3 deck" shows an approval card and the saved file changes as a new version, with no studio open.
- **CREATE-TOOL-PRESENTATIONS-06.** Text formatting: bold, italic, font, size, colour, numbered lists, hyperlinks, for decks and documents. Add to the outline model and to the Guide ops.
  Done when: a person selects a word, presses Bold and sees it bold on screen and in the exported file; the concierge does the same on a named word.
- **CREATE-TOOL-PRESENTATIONS-07.** Spreadsheet basics: sort, filter, number and date formats, cell fill and font, merge, wrap, column width, freeze, insert and delete rows and columns, find and replace, drag fill. Each as a button and an operation.
  Done when: a person sorts a column, formats it as currency and inserts a row in the middle with no typed markup, and all of it is in Excel after download; the concierge does each by a named operation.
- **CREATE-TOOL-PRESENTATIONS-08.** Speaker notes on screen.
  Done when: a person types notes under a slide, they export to the .pptx notes page, and they survive open and Edit & regenerate. `update_slide` accepts `notes`.
- **CREATE-TOOL-PRESENTATIONS-09.** Export to PDF in all three formats.
  Done when: a PDF button exists next to Generate and a tool makes the same file; the PDF matches the export's pages.
- **CREATE-TOOL-PRESENTATIONS-10.** Present a deck full screen, phone and desktop, with notes for the presenter.
  Done when: Present runs through the deck with swipe or arrow keys at 412 px wide and on a desktop; the concierge can offer a Present link.
- **CREATE-TOOL-PRESENTATIONS-11.** Free placement on a slide: text boxes, shapes, lines, move, resize and crop pictures.
  Done when: a person drags a text box and a resized picture on the canvas, both land in the same place in PowerPoint, and an operation does the same by coordinates.
- **CREATE-TOOL-PRESENTATIONS-12.** Real controls for table and chart instead of typed markup, and charts inside workbooks.
  Done when: Insert table and Insert chart buttons add them with no markup; a chart edits by data grid; an .xlsx has a real chart; the concierge has `insert-table` and `insert-chart` operations.
- **CREATE-TOOL-PRESENTATIONS-13.** Document page work: page size, margins, orientation, custom header and footer, table of contents, footnotes, captions, section move and delete buttons, find and replace, word count, dictation in the Document view.
  Done when: each is a control in the Document view and a named operation, and each appears in Word; a table of contents updates when a heading changes.
- **CREATE-TOOL-PRESENTATIONS-14.** Concierge reach for what only the screen can do: delete a file, email, use a starter, byline, slide numbers, save location, brand look, document image from a file. Fix image order when `set_outline` moves a slide.
  Done when: each works from a tool under approval where it sends or deletes; after moving slide 2 to slide 5 by the Guide, its picture is on slide 5.
- **CREATE-TOOL-PRESENTATIONS-15.** UX reach for what only the concierge can do: a cover subtitle field.
  Done when: Subtitle is on screen and in the exported cover.
- **CREATE-TOOL-PRESENTATIONS-16.** Comments and tracked changes.
  Done when: a person comments on a slide, section or cell and reads it back; Word opens tracked changes as tracked; the concierge reads and adds comments.
- **CREATE-TOOL-PRESENTATIONS-17.** Share a link, edit together, version history.
  Done when: a second person opens a link and edits with the first in view; a person restores yesterday's version.
- **CREATE-TOOL-PRESENTATIONS-18.** Transitions and animations.
  Done when: chosen transitions and build animations are in the .pptx and play in PowerPoint, by control and operation.
- **CREATE-TOOL-PRESENTATIONS-19.** Conditional formatting, dropdowns, pivot tables.
  Done when: each is built on screen, by operation, and works in Excel.
- **CREATE-TOOL-PRESENTATIONS-20.** Slack delivery reachable: a button and a `presentations-send-slack` tool for the route that exists.
  Done when: a person sends the file to a channel from the studio and the concierge does so under the route's explicit confirmation.
- **CREATE-TOOL-PRESENTATIONS-21.** Pro desktop tools: slide master editing, video and audio, recording, compare, mail merge, citations, macros or scripts, Goal Seek and Solver.
  Done when: each has its own entry split out, with its control and operation, before any is built; none is treated as finished under this umbrella.

## 4. Sources

Microsoft's mobile tables below are dated and do not always agree with its newer mobile page; where they conflict the cell shows both. [M2] sets the free or paid rule. [T3] is from January 2020. Google's Android help is written for phones and tablets; I found no page that compares mobile and web as a whole.

- [M1] Compare PowerPoint features on different platforms: https://support.microsoft.com/en-us/office/compare-powerpoint-features-on-different-platforms-90986850-227c-4b25-938e-1c5838166b8b
- [M2] Microsoft 365 mobile apps: https://support.microsoft.com/en-US/Office/foundations-experiences/microsoft-365-mobile-apps
- [M3] Compare Word features on different platforms (desktop and web): https://support.microsoft.com/en-us/office/compare-word-features-on-different-platforms-5e00dfba-3d7c-4222-b850-a0527ff7b066
- [M4] What's new in Word on mobile platforms: https://support.microsoft.com/en-gb/topic/what-s-new-in-word-on-mobile-platforms-238a50f3-fc2a-48b5-b35c-89e1a612760b
- [M5] What's new in Excel on mobile platforms: https://support.microsoft.com/en-us/excel/what-s-new-in-excel-on-mobile-platforms
- [M6] Excel for iPhone features: https://support.microsoft.com/en-us/office/excel-for-iphone-features-faac09c9-51af-4b3c-8c20-16c10145eff3
- [M7] Excel for Android phones help: https://support.microsoft.com/en-us/office/excel-for-android-phones-help-f818cb37-bfac-485d-8480-363b3da40596
- [M8] Get started with Copilot in Excel: https://support.microsoft.com/en-us/excel/copilot/get-started-with-copilot-in-excel
- [M9] Office Scripts and VBA differences: https://learn.microsoft.com/en-us/office/dev/scripts/resources/vba-differences
- [M10] Excel for the web service description: https://learn.microsoft.com/en-us/office365/servicedescriptions/office-online-service-description/excel-online
- [T3] BrightCarbon, PowerPoint for Android review, January 2020: https://www.brightcarbon.com/blog/powerpoint-for-android/
- [G1] Slides: add, delete, organize, Android: https://support.google.com/docs/answer/1694830?hl=en-nz&co=GENIE.Platform%3DAndroid
- [G3] Slides: theme, background, layout, Android: https://support.google.com/docs/answer/1705254?hl=en&co=GENIE.Platform%3DAndroid
- [G4] Slides: insert text, shapes, lines, Android: https://support.google.com/docs/answer/1696521?hl=en&co=GENIE.Platform%3DAndroid
- [G5] Insert images and videos, Android: https://support.google.com/docs/answer/97447?hl=en&co=GENIE.Platform%3DAndroid
- [G6] Crop and adjust images, Android: https://support.google.com/docs/answer/4600160?hl=en-GB&co=GENIE.Platform%3DAndroid
- [G7] Present slides, Android: https://support.google.com/docs/answer/1696787?hl=en&co=GENIE.Platform%3DAndroid
- [G8] Animations and transitions, Android: https://support.google.com/docs/answer/1689475?hl=en&co=GENIE.Platform%3DAndroid
- [G9] Create, view, download, Android: https://support.google.com/docs/answer/49114?hl=en&co=GENIE.Platform%3DAndroid
- [G10] Tips to share your files: https://support.google.com/a/users/answer/13004062?hl=en
- [G11] How to use Google Docs, Android: https://support.google.com/docs/answer/7068618?hl=en&co=GENIE.Platform%3DAndroid
- [G12] Title, heading, table of contents, Android: https://support.google.com/docs/answer/116338?hl=en&co=GENIE.Platform%3DAndroid
- [G13] Add and edit tables, Android: https://support.google.com/docs/answer/1696711?hl=en-as&co=GENIE.Platform%3DAndroid
- [G14] Headers, footers, page numbers, footnotes, Android: https://support.google.com/docs/answer/86629?hl=en-AU&co=GENIE.Platform%3DAndroid
- [G15] Page settings, Android: https://support.google.com/docs/answer/10296604?hl=en&co=GENIE.Platform%3DAndroid
- [G16] Comments, Android: https://support.google.com/docs/answer/65129?amp=&co=GENIE.Platform%3DAndroid&hl=en
- [G17] Generate documents with voice: https://support.google.com/docs/answer/17256297
- [G18] How to use Google Sheets, Android: https://support.google.com/docs/answer/6000292?hl=en-BW&co=GENIE.Platform%3DAndroid
- [G19] Freeze, group, hide, merge, Android: https://support.google.com/docs/answer/9060449?hl=en&co=GENIE.Platform%3DAndroid
- [G20] Sort and filter, Android: https://support.google.com/docs/answer/3540681?hl=en&co=GENIE.Platform%3DAndroid
- [G21] Conditional formatting, Android: https://support.google.com/docs/answer/78413?hl=en&co=GENIE.Platform%3DAndroid
- [G22] In-cell dropdown, Android: https://support.google.com/docs/answer/186103?hl=en&co=GENIE.Platform%3DAndroid
- [G23] Add and edit a chart, Android: https://support.google.com/docs/answer/63824?hl=en-ID&co=GENIE.Platform%3DAndroid
- [G24] Pivot tables, Android: https://support.google.com/docs/answer/1272900?hl=en&co=GENIE.Platform%3DAndroid
- [G25] Print a file, Android: https://support.google.com/docs/answer/143346?hl=en-GB&co=GENIE.Platform%3DAndroid
- [G26] Gemini in Sheets, Android: https://support.google.com/docs/answer/14356410?hl=en&co=GENIE.Platform%3DAndroid

Our side, under `store-snapshot/presentations/`: `oshal-app.yaml`, `tools/presentations.html`, `tools/slide-workspace.mjs`, `tools/sheet-workspace.mjs`, `tools/office-assistant.mjs`, `src-routes/bot-presentation-routes.ts`, `personas/deck-builder.yaml`. Engine, under `oshal-kernel/crates/host-process/native-runtime/core-sources/src/features/presentation-generation/services/`: `docx-renderer.ts`, `xlsx-renderer.ts`, `pptx-renderer.ts`, `office-import.ts`, `slide-content-parser.ts`, `image-source.ts`.
