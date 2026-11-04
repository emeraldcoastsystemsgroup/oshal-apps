# pdf-workbench: parity audit against Adobe Acrobat

Audited 2026-11-03 from the frozen store snapshot (package version 0.1.6). Read-only.

## 1. What it is

PDF Workbench keeps an uploaded PDF as an unchanged original and saves page, form and annotation edits as new numbered revisions; a person uses the three-pane page in `tools/workbench.html`, and the `pdf-editor` concierge uses the same stored operations through 15 declared tools. It is measured against Adobe Acrobat: free Reader, paid Standard and Pro, on desktop, the mobile app and the web. Today it covers Acrobat's Organize Pages tools and part of Reader's comment and fill tools, and it refuses many ordinary PDFs at the door.

**How Adobe splits it.** Free mobile and Reader cover viewing, comments, fill and sign, and sharing [A3][A4]. Paying unlocks editing, export, page organizing and protection on mobile [A4], and Standard adds the same on desktop [A1][A2]. Pro alone holds redaction, compare and scan-to-editable text [A1], plus Bates numbering and preflight [T1][A18]. Building form fields stays on desktop [A10]. Our package has no free tier split: everything it has is open to the role, and most of what it lacks sits in Adobe's Standard tier, not only Pro.

## 2. Parity table

How to read it:

- **Concierge tools** are the `tools:` entries in `oshal-app.yaml`. "`annotate`", "`merge`" and the like are operations of `pdf-apply-operations`, validated by `apply()` in `routes/model.mjs` and `engine/worker.py`.
- **typed** means the control exists but the person types numbers. There is no tap, drag or draw on the page.
- **Status** counts a typed control as a UX control. Rows that depend on one are named in the UX column so nobody reads them as finished.
- **Industry cells:** a [tag] points to Sources. **unchecked** means common knowledge that no page I read states. **not confirmed** means I looked and found no statement.
- `not confirmed` on our side would mean I could not prove it from code. No row needed that. Engine behaviour was read in code, not run: `pypdf` is not installed on this machine.

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Open and page through a PDF | basic: Reader | yes, free [A3][A4] | yes [A2] | Page cards in `#pages`, `render()` in `tools/workbench.mjs` | `pdf-read-document` (page list and sizes, no page picture) | both |
| Open an ordinary PDF that has a web link, a signature field or a password | basic: Reader | yes, free, unchecked for each case | yes, unchecked for each case | none. `safe_reader()` in `engine/worker.py` walks every object and refuses any with `/A`, `/AA`, `/JS`, `/XFA`, `/EmbeddedFiles`, also any `/Sig` field and any encrypted file | none, same refusal for `pdf-import-artifact` | missing |
| Work on a file over 4 MiB or 32 pages | basic: web tools | not confirmed | web: 1,500 pages merged, 100 MB rearranged [A21][A23] | none. `LIMITS` in `routes/model.mjs`, `MAX_BYTES` and `MAX_PAGES` in `engine/worker.py` | none, same limits | missing |
| Zoom, fit to width, jump to a page | basic: Reader | yes, unchecked | yes, unchecked | none. Fixed preview image in each card | none | missing |
| Phone reading view that reflows text | basic: Reader | yes, free: Liquid Mode [A3] | not confirmed | none. `tools/workbench.css` only collapses panes at 1180px and 760px | none | missing |
| Find text | basic: Reader | yes, free [A5] | yes, unchecked | `#search`, `#search-button` in `tools/workbench.html`; prints whole matching pages, no highlight on the page | `pdf-read-page-text` (reads text; the model does the finding) | both |
| Select and copy text from a page | basic: Reader | yes, unchecked | yes, unchecked | none. The page is a PNG preview | `pdf-read-page-text` | concierge only |
| Print | basic: Reader | not confirmed | yes [A2] | none. Download only | none | missing |
| Download the PDF | basic: Reader | yes, unchecked | yes, unchecked | `#download` in `tools/workbench.html` | none. Route `/documents/:id/revisions/:n/content` has no `tools:` entry | UX only |
| Share a link, send for review, open from cloud storage | basic: Reader | yes, free [A3][A8] | yes [A2] | none | none | missing |
| Highlight | basic: Reader | yes, free [A8] | yes [A2] | Annotation panel, Kind = Highlight, typed `#annotation-rect` (a rectangle, not a text selection) | `annotate` kind `highlight` | both |
| Underline and strikethrough | basic: Reader | yes, free [A8] | yes [A2] | none. Engine accepts only text, highlight, ink | none | missing |
| Add a text note to a page | basic: Reader | yes, free [A8] | yes [A2] | Kind = Text note, typed `#annotation-rect`; printable ASCII only | `annotate` kind `text`; printable ASCII only | both |
| Freehand drawing | basic: Reader | yes, free [A8] | yes [A2] | Kind = Ink stroke, typed `#annotation-points` (`x,y;x,y`); no finger or pen drawing | `annotate` kind `ink` | both |
| See the list of annotations | basic: Reader | yes, unchecked | yes, unchecked | none. Marks show only in the preview after saving | `pdf-read-model-part` part `annotations` | concierge only |
| Delete an annotation | basic: Reader | yes, free [A8] | yes, unchecked | none. `remove-annotation` appears nowhere in `tools/workbench.mjs` | `remove-annotation` | concierge only |
| Move or edit an annotation; reply to or resolve a comment | basic: Reader | edit yes [A8]; replies not confirmed | yes, unchecked | none | none. `apply()` only adds or removes | missing |
| Fill form fields | basic: Reader | yes, free [A9] | yes [T1] | `#forms` and `#fill` in `tools/workbench.html` | `fill`; `pdf-read-model-part` part `form-fields` with `query` | both |
| Fill form fields with non-English text, or any form not using Helvetica | basic: Reader | not confirmed | not confirmed | none. `fields_of()` marks non-Helvetica fields unsupported; `derive()` allows printable ASCII only | none, same rule | missing |
| Sign with a drawn, typed or picture signature | basic: Reader | yes, free [A9] | yes [T1] | none. An ink stroke is not a signature | none | missing |
| Send for signature, including bulk | basic: Standard; bulk pro | not confirmed | yes; Reader limited; bulk Pro [A2] | none | none | missing |
| Certificate digital signature | not confirmed | not confirmed | yes, unchecked | none. Footnote in `tools/workbench.html` says unsupported | none. `unsupported` in `CONTRACT`, `routes/model.mjs` | missing |
| Build form fields | basic: Standard | no, desktop only [A10] | yes [T1] | none | none | missing |
| Reorder pages | basic: Standard | yes, paid [A4] | yes [T1]; free on web [A23] | Move earlier and Move later on each page card; one step at a time, no drag | `reorder` | both |
| Rotate pages | basic: Standard | yes, paid [A4] | yes [T1]; free on web [A23] | `#rotate` (90 degrees per press) | `rotate` (90, 180, 270) | both |
| Delete pages | basic: Standard | yes, paid [A4] | yes [T1]; free on web [A23] | `#remove` | `remove` | both |
| Keep only chosen pages | basic: Standard | yes, paid [A4] | yes [T1] | `#extract` | `extract` | both |
| Extract chosen pages to a new file | basic: Standard | yes, paid [A4] | yes [T1] | `#split`; refuses edited pages or pages from more than one original | `pdf-create-document` with `indices`; from an original only | both |
| Combine files | basic: Standard | yes, paid [A12] | yes [T1]; free on web [A21] | `#merge`: appends one whole original at the end | `merge` | both |
| Insert at a chosen position, or only some pages of another file | basic: Standard | not confirmed | yes, unchecked | none. `#merge` always sends position = end and no `indices` | `merge` with `position` and `indices` | concierge only |
| Replace a page, insert a blank page | basic: Standard, unchecked | not confirmed | replace yes [A19]; blank unchecked | none | none | missing |
| Crop pages | basic: Standard, unchecked | yes, paid [A11] | yes, unchecked | none | none | missing |
| Edit existing text | basic: Standard | yes, paid [A6] | yes [A2][T1] | none. Footnote says unsupported | none. `original content editing` in `CONTRACT.unsupported` | missing |
| Add or change images and text as real page content | basic: Standard | yes, paid [A7][A4] | yes [A2] | none. A text note is an annotation, not page content | none | missing |
| Watermark | not confirmed | not confirmed | yes [A16] | none | none | missing |
| Header, footer, page numbers | not confirmed | not confirmed | yes [A17] | none | none | missing |
| Bates numbering | pro | not confirmed | yes [A18][T1] | none | none | missing |
| Bookmarks and links | basic: Standard, unchecked | not confirmed | yes, unchecked | none. `derive()` calls `writer.append(..., import_outline=False)`, so bookmarks in the source are dropped from every revision; links are refused at the door | none | missing |
| Export to Word, Excel, PowerPoint | basic: Standard | yes, paid [A4][A3] | yes [A1] | none | none | missing |
| Create a PDF from images or Office files | basic: Standard | yes, paid [A4] | yes [A1] | none. Upload accepts PDF only | none | missing |
| Scan with the camera | basic: separate Adobe Scan app | yes [A3][A14] | not applicable | none | none | missing |
| OCR a scanned page | pro | yes, paid [A13] | yes, Pro [A1][T1] | `#ocr`, `#ocr-results`; result is separate text; English; at most 10 pages per job | `pdf-start-ocr`, `pdf-job-status`, `pdf-read-ocr-text`; same limits | both |
| Compress a file | not confirmed | not confirmed | free on web [A22] | none | none | missing |
| Password protect | basic: Standard | yes, paid [A4] | yes [A1][T1] | none. Encrypted input is refused | none | missing |
| Redact | pro | not confirmed; help is desktop only [A15] | yes, Pro [A1][A15] | none. Footnote says a highlight does not remove content | none. `redaction` in `CONTRACT.unsupported` | missing |
| Compare two PDFs | pro | not confirmed | yes, Pro [A1] | none | none | missing |
| PDF/A and preflight checks | pro | not confirmed | yes, Pro [T1] | none | none | missing |
| Undo and redo before saving | basic, unchecked | not confirmed | yes, unchecked | `#undo`, `#redo` | none. Tools have no draft | UX only |
| Saved version history and restore | not confirmed | not confirmed | not confirmed | `#history`, `#open-history`, `#restore` | `pdf-restore-revision`; `pdf-read-document` returns history | both |
| Ask questions of the document, summarize | add-on: AI Assistant | paid add-on [A3] | not confirmed | none. Chat panel is the concierge; no button | `pdf-read-page-text`, `pdf-read-model-part` read the text; the answer itself is model reasoning, not a tool | concierge only |

Outside the table because no Acrobat row applies: bringing a file in works both ways (`#upload` for a person, `pdf-import-artifact` for the concierge); deleting a document works both ways (`#delete-document`, `pdf-delete-document`); deleting an original is UX only (`#delete-source`, route `DELETE /sources/:source`, no tool); cancelling a job works both ways (`#cancel-job`, `pdf-cancel-job`).

## 3. Backlog, in the order people hit it

Every entry must end with a control on screen and a concierge operation, per the owner's rule.

- **CREATE-TOOL-PDF-WORKBENCH-01.** Accept ordinary PDFs: web links, unsigned signature fields, and a password the person supplies. Keep the refusal only for what actually runs code.
  Done when: a PDF with a clickable web link and an empty signature field uploads, previews, saves a revision with the link still working, by button and by concierge; a bank statement with a password opens after typing it.
- **CREATE-TOOL-PDF-WORKBENCH-02.** Raise the 4 MiB and 32 page limits to something near Acrobat's web limits, in store, engine and tool schemas (`pageIds`, `indices`, `page` maximums).
  Done when: a 200-page, 50 MB PDF uploads, previews lazily, and has page 150 moved to page 1 by button and by the concierge.
- **CREATE-TOOL-PDF-WORKBENCH-03.** A real reader: zoom, fit width, page jump, selectable text on the page, print, and a phone view.
  Done when: at 412 px wide a person pinches to zoom, types a page number to jump, long-presses to copy a sentence and prints from the browser; a concierge `pdf-go-to-page` moves the same view.
- **CREATE-TOOL-PDF-WORKBENCH-04.** Mark up by touching the page: select text to highlight, underline or strike; drag a note; draw with a finger. Replace the typed rectangle and points.
  Done when: a person highlights a sentence on a phone without typing a number, and `annotate` accepts the same underline and strikeout kinds. Saved marks reopen in Acrobat as real annotations.
- **CREATE-TOOL-PDF-WORKBENCH-05.** Show the annotation list on screen with delete, edit and move; add an `update-annotation` operation.
  Done when: a person deletes one highlight from a list with a button, and the concierge can move the same note by id; both produce a new revision.
- **CREATE-TOOL-PDF-WORKBENCH-06.** Sign: draw, type or pick a saved signature and place it. Add the matching `annotate` kind.
  Done when: a person signs a one-page form on a phone and downloads it; the concierge places a saved signature after an approval card.
- **CREATE-TOOL-PDF-WORKBENCH-07.** Non-English text in notes and forms, and forms that do not use Helvetica.
  Done when: `José Núñez` goes into a text field of a form using Arial, by field and by `fill`, and reads correctly in Acrobat.
- **CREATE-TOOL-PDF-WORKBENCH-08.** Fill the concierge gaps: `pdf-export` and `pdf-delete-source` tools.
  Done when: asked "give me the PDF", the concierge returns a guarded download link after approval; asked to delete an unused original, it does so and refuses one in use.
- **CREATE-TOOL-PDF-WORKBENCH-09.** Fill the UX gaps in page work: insert at a position, take chosen pages from another file, drag to reorder, rotate either way.
  Done when: a person drags page 5 before page 2 and inserts pages 2-3 of another original after page 1 with no concierge help.
- **CREATE-TOOL-PDF-WORKBENCH-10.** Crop, insert blank page, replace page. Add operations `crop`, `insert-blank`, `replace-page`.
  Done when: each works by control and by tool; undo restores; the crop survives reopen in Acrobat.
- **CREATE-TOOL-PDF-WORKBENCH-11.** Edit existing text and images, and add new page content.
  Done when: a person taps a line, retypes it and the font matches; the concierge does the same through an operation with an exact page and text anchor; the original stays unchanged.
- **CREATE-TOOL-PDF-WORKBENCH-12.** Compress.
  Done when: a 3 MB image-heavy PDF saves as a smaller revision by button and tool, with the sizes shown, and still reopens.
- **CREATE-TOOL-PDF-WORKBENCH-13.** Convert: export to Word and Excel; create a PDF from images and Office files; scan with the phone camera.
  Done when: a phone photo becomes a PDF document; a PDF exports to a .docx that opens in Word with text intact; both by button and tool.
- **CREATE-TOOL-PDF-WORKBENCH-14.** OCR that adds a hidden text layer to a new revision, plus more languages and more than 10 pages per job.
  Done when: after OCR the new revision's text is found by `#search` and selectable in Acrobat; Spanish works.
- **CREATE-TOOL-PDF-WORKBENCH-15.** Keep bookmarks through every revision; add a bookmark and link editor.
  Done when: a source with 10 bookmarks has 10 after a rotate; a person adds one; the concierge adds one.
- **CREATE-TOOL-PDF-WORKBENCH-16.** Watermark, header and footer, page numbers, Bates numbering.
  Done when: each is applied to chosen pages by control and by operation, and appears in the downloaded file.
- **CREATE-TOOL-PDF-WORKBENCH-17.** Password protect output.
  Done when: a downloaded revision asks for the password in Acrobat; by button and tool.
- **CREATE-TOOL-PDF-WORKBENCH-18.** True redaction.
  Done when: redacted text cannot be found by `pdftotext` or by copy in the output and the bytes are gone from the file; by control and tool; preview before apply.
- **CREATE-TOOL-PDF-WORKBENCH-19.** Build form fields.
  Done when: a person adds a text box and a checkbox to a flat PDF and fills them in Acrobat; the concierge adds fields by operation.
- **CREATE-TOOL-PDF-WORKBENCH-20.** Sharing and review: link, comment replies, resolve.
  Done when: a second person opens a link, replies to a note, and the owner resolves it.
- **CREATE-TOOL-PDF-WORKBENCH-21.** Request signatures, certificate signing.
  Done when: a signer gets a request by the existing mail connector and the signed result validates in Acrobat.
- **CREATE-TOOL-PDF-WORKBENCH-22.** Compare two revisions or files; PDF/A check.
  Done when: changed text is listed by page by control and tool; a known bad PDF/A file reports its failures.

## 4. Sources

Adobe help pages under helpx.adobe.com refused direct fetch (HTTP 403), so those cells rest on Adobe's own text as returned by web search, not a full page read. The mobile tier page has regional copies with the same text. On [A2] the checkmark columns did not extract with labels, so the plan mapping is my reading of them. Third-party tables and Adobe's pages disagree in places on Standard against Pro; where they did, I used Adobe's plans page [A1].

- [A1] Adobe Acrobat plans: https://www.adobe.com/acrobat/plans.html
- [A2] Adobe compare versions: https://www.adobe.com/acrobat/pricing/compare-versions.html
- [A3] Acrobat Reader mobile: https://www.adobe.com/acrobat/mobile/acrobat-reader.html
- [A4] Acrobat on mobile subscriptions: https://helpx.adobe.com/acrobat/mobile/subscription-refunds/about-subscriptions.html
- [A5] Acrobat mobile FAQ: https://helpx.adobe.com/acrobat/mobile/get-started/faqs.html
- [A6] Edit text on mobile: https://helpx.adobe.com/acrobat/mobile/edit-text-images/edit-text.html
- [A7] Add text on mobile: https://helpx.adobe.com/acrobat/mobile/edit-text-images/add-text.html
- [A8] Review and annotate on mobile: https://helpx.adobe.com/acrobat/mobile/review-files/review-documents.html
- [A9] Fill and sign on mobile: https://helpx.adobe.com/acrobat/mobile/e-sign-documents/fill-sign.html
- [A10] PDF forms on mobile: https://helpx.adobe.com/acrobat/mobile/e-sign-documents/pdf-forms.html
- [A11] Crop on mobile: https://helpx.adobe.com/acrobat/mobile/organize-pdfs/crop-pages.html
- [A12] Combine on mobile: https://helpx.adobe.com/acrobat/mobile/view-manage-files/combine-files.html
- [A13] Scanned files on mobile: https://helpx.adobe.com/acrobat/mobile/edit-text-images/edit-scanned-files.html
- [A14] Adobe Scan FAQ: https://helpx.adobe.com/mobile-apps/help/adobe-scan-faq.html
- [A15] Redact in Acrobat Pro: https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/redact-text.html
- [A16] Watermarks: https://helpx.adobe.com/acrobat/desktop/edit-documents/add-backgrounds-and-watermarks/add-watermarks.html
- [A17] Headers and footers: https://helpx.adobe.com/acrobat/desktop/edit-documents/use-headers-and-footers/add-header-footer.html
- [A18] Bates numbering: https://helpx.adobe.com/acrobat/desktop/edit-documents/apply-bates-numbering/add-bates.html
- [A19] Replace pages: https://helpx.adobe.com/acrobat/desktop/edit-documents/organize-pages/replace-pages.html
- [A21] Merge online: https://www.adobe.com/acrobat/online/merge-pdf.html
- [A22] Compress on the web: https://helpx.adobe.com/acrobat/web/share-review-and-export/export-and-print/compress-pdfs.html
- [A23] Rearrange online: https://www.adobe.com/acrobat/online/rearrange-pdf.html
- [T1] Mapsoft, third party, Reader vs Standard vs Pro: https://mapsoft.com/posts/acrobat-standard-vs-pro.html

Our side, all under `store-snapshot/pdf-workbench/`: `oshal-app.yaml`, `tools/workbench.html`, `tools/workbench.mjs`, `tools/workbench.css`, `routes/application.mjs`, `routes/model.mjs`, `routes/form-lookup.mjs`, `engine/worker.py`, `personas/pdf-editor.yaml`.
