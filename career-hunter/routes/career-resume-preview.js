"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREVIEW_SCREEN_CSS = void 0;
exports.htmlSiblingOf = htmlSiblingOf;
exports.buildPreviewHtml = buildPreviewHtml;
exports.resolvePreviewPath = resolvePreviewPath;
/**
 * Career Hunter — in-surface résumé preview
 *
 * The board and the mobile surface both showed the packet by pointing an `<iframe>` at
 * `GET /resume?id=…`, which serves the generated **PDF** (`user_signals.resume_path` is always a
 * `.pdf` — `engine/jobhunter/generate.py:624` and `career-resume-studio-routes.ts:214` both write
 * that extension, and 1,765 of 1,765 rows on the live store are `.pdf`).
 *
 * No mobile browser renders a PDF in a subframe. iOS has no in-page PDF renderer at all — WebKit
 * hands PDFs to a native viewer that is only instantiated for top-level navigations, so every
 * browser on iOS (all WKWebView) paints the frame's CSS box and draws nothing in it. Chrome and
 * Firefox on Android likewise have no subframe viewer and fall back to a download hand-off. The
 * `load` event still fires, so the page cannot even detect the failure. The result is exactly the
 * operator's report: **the preview takes up screen space but shows nothing.** It works on desktop
 * (PDFium / pdf.js / PDFKit all render inline), which is why this survived several rounds of
 * reports unfixed.
 *
 * The fix does not need a PDF renderer: the generator writes the HTML *first* and prints the PDF
 * from it (`generate.py` — `hp.write_text(html)` then `_render_pdf(hp, pp)`), so a byte-exact HTML
 * source of every PDF is already sitting next to it on disk. This module serves that sibling for
 * preview. The PDF stays the artifact of record — every surface keeps a link to open it.
 *
 * The templates are self-contained by construction: no `<script>`, no external stylesheet, no
 * remote font or image, and Jinja renders them with `autoescape=select_autoescape(["html"])` so
 * the model-authored résumé text is escaped. Surfaces still frame it with `sandbox=""` (no tokens
 * at all), which puts the document in an opaque origin with scripting disabled.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Fix the operator-reported invisible résumé preview on phones: serve the generated HTML sibling of the packet PDF for in-surface preview (`?as=html`), since no mobile browser renders a PDF in an iframe and the frame kept its box while painting nothing. Screen-only CSS is appended so the print-targeted template reflows to a phone-width frame; the PDF remains the artifact of record.
 *
 * @module career-resume-preview
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Screen-only chrome for the preview. The templates target print: `@page { size: Letter;
 * margin: 0.8in }` is ignored on screen and `body { margin: 0 }`, so without this the résumé text
 * runs edge-to-edge against the frame. `.role-h` is a `justify-content:space-between` flex row
 * whose `.role-s` date is `white-space:nowrap`, which overflows a ~360px frame — so both relax at
 * phone width. `@media screen` keeps every rule out of the printed PDF, and these selectors are
 * this package's own templates (engine/jobhunter/templates/), not a third party's.
 */
exports.PREVIEW_SCREEN_CSS = `
<style>
@media screen {
  html { background: #fff; -webkit-text-size-adjust: 100%; }
  body { padding: 18px 20px; overflow-wrap: anywhere; }
  @media (max-width: 560px) {
    body { padding: 12px 14px; }
    /* The header is sized for an 8.5in page: at ~310px the 20pt name wraps to five lines and
       fills the whole frame before a single bullet is visible. Scale the masthead only — body
       copy at 10.5pt is already ~14px and reads fine. */
    .name { font-size: 14pt; line-height: 1.15; }
    .headline { font-size: 10pt; }
    .contact { font-size: 8.6pt; }
    h2 { font-size: 10pt; margin: 12px 0 5px; }
    .role-h { flex-wrap: wrap; gap: 2px; }
    .role-s { white-space: normal; }
  }
}
</style>`;
/**
 * @description Maps a packet PDF path to its generated HTML sibling. The generator writes
 *   `<name>.html` and prints `<name>.pdf` from it into the same directory, so the sibling is a
 *   pure extension swap — never a lookup, and never a different directory.
 * @param pdfPath - Absolute path to the stored packet PDF.
 * @returns The sibling `.html` path, or null when the input is not a `.pdf`.
 */
function htmlSiblingOf(pdfPath) {
    if (!/\.pdf$/i.test(pdfPath))
        return null;
    return pdfPath.replace(/\.pdf$/i, '.html');
}
/**
 * @description Reads a generated packet HTML and appends the screen-only stylesheet. Appending
 *   (rather than rewriting the document) keeps the artifact byte-identical to what the PDF was
 *   printed from — a later `<style>` simply wins on the cascade for the handful of screen rules.
 * @param htmlPath - Absolute path to the generated `.html`.
 * @returns The document to serve.
 */
function buildPreviewHtml(htmlPath) {
    return fs_1.default.readFileSync(htmlPath, 'utf8') + exports.PREVIEW_SCREEN_CSS;
}
/**
 * @description Resolves the HTML preview for a stored packet PDF, applying the same containment
 *   rule the PDF path uses: the resolved file must sit inside the caller's own directory.
 *
 *   A missing sibling returns null and the route MUST 404 rather than quietly serving the PDF —
 *   a silent fallback would reproduce the original invisible-preview bug with no way to tell it
 *   had happened, which is how this defect survived being reported more than once.
 * @param pdfPath - The stored `resume_path` / `cover_path`.
 * @param userDir - The caller's own store directory; nothing outside it may be served.
 * @returns The absolute HTML path, or null when absent or out of bounds.
 */
function resolvePreviewPath(pdfPath, userDir) {
    const sibling = htmlSiblingOf(pdfPath);
    if (!sibling)
        return null;
    const safeRoot = path_1.default.resolve(userDir);
    const resolved = path_1.default.resolve(sibling);
    if (!resolved.startsWith(safeRoot))
        return null;
    return fs_1.default.existsSync(resolved) ? resolved : null;
}
