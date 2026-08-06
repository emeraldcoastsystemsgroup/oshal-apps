"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Serve generated HTML siblings for reliable in-surface resume previews while retaining PDFs as the submitted artifacts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Require lexical and real-filesystem containment and reject linked or nonregular packet paths before serving either format.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREVIEW_SCREEN_CSS = void 0;
exports.htmlSiblingOf = htmlSiblingOf;
exports.buildPreviewHtml = buildPreviewHtml;
exports.resolveContainedRegularFile = resolveContainedRegularFile;
exports.resolvePreviewPath = resolvePreviewPath;
/**
 * Career Hunter in-surface resume preview.
 *
 * The generator writes self-contained HTML before printing the submitted PDF. Mobile browsers do
 * not reliably render a PDF iframe, so surfaces preview that HTML sibling inside `sandbox=""` and
 * keep a top-level PDF link. Both artifacts remain caller-scoped filesystem reads.
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
function isNestedPath(root, candidate) {
    const relative = path_1.default.relative(root, candidate);
    return relative !== ''
        && relative !== '..'
        && !relative.startsWith(`..${path_1.default.sep}`)
        && !path_1.default.isAbsolute(relative);
}
function isLinkFreeRegularPath(root, candidate) {
    const relative = path_1.default.relative(root, candidate);
    let current = root;
    const rootStat = fs_1.default.lstatSync(current, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
        return false;
    for (const segment of relative.split(path_1.default.sep)) {
        current = path_1.default.join(current, segment);
        const stat = fs_1.default.lstatSync(current, { throwIfNoEntry: false });
        if (!stat || stat.isSymbolicLink())
            return false;
        if (current === candidate)
            return stat.isFile();
    }
    return false;
}
/**
 * @description Resolves an existing caller-owned artifact only after both its lexical path and
 *   real filesystem target remain beneath the caller directory. Every path component is checked
 *   with `lstat` so a symlink or junction cannot redirect a later read after a string-only check.
 * @param filePath - Stored artifact path proposed for serving.
 * @param userDir - Caller-owned store directory that forms the authorization boundary.
 * @returns The canonical regular-file path, or null when containment or file type is invalid.
 */
function resolveContainedRegularFile(filePath, userDir) {
    const root = path_1.default.resolve(userDir);
    const candidate = path_1.default.resolve(filePath);
    if (!isNestedPath(root, candidate) || !isLinkFreeRegularPath(root, candidate))
        return null;
    const realRoot = fs_1.default.realpathSync(root);
    const realCandidate = fs_1.default.realpathSync(candidate);
    return isNestedPath(realRoot, realCandidate) ? realCandidate : null;
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
    return sibling ? resolveContainedRegularFile(sibling, userDir) : null;
}
//# sourceMappingURL=career-resume-preview.js.map