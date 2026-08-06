/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard HTML packet previews and prevent surfaces from silently falling back to embedded PDFs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Cover sibling-prefix, linked-path, and nonregular-file rejection for both PDF and HTML serving.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
// Against the COMPILED module — that is what the api loads.
const preview = require('../routes/career-resume-preview.js');

const here = dirname(fileURLToPath(import.meta.url));
const readSurface = (name) => readFileSync(join(here, '..', 'tools', name), 'utf8');
const inlineJs = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n;\n');

const board = readSurface('career-board.html');
const mobile = readSurface('career-mobile.html');
const boardRoutes = readFileSync(join(here, '..', 'src-routes', 'career-board-routes.ts'), 'utf8');

/** A throwaway store laid out like a real one: <userDir>/applications/<Company__id>/<packet>. */
function fixtureStore({ withHtml = true } = {}) {
  const userDir = mkdtempSync(join(tmpdir(), 'career-preview-'));
  const appDir = join(userDir, 'applications', 'Acme__1');
  mkdirSync(appDir, { recursive: true });
  const pdf = join(appDir, 'Resume_ATS.pdf');
  writeFileSync(pdf, '%PDF-1.4 fake');
  if (withHtml) {
    writeFileSync(join(appDir, 'Resume_ATS.html'),
      '<!doctype html><html><head><style>body{margin:0}</style></head><body>RESUME BODY</body></html>');
  }
  return { userDir, pdf };
}

test('the HTML sibling is a pure extension swap in the same directory', () => {
  assert.equal(preview.htmlSiblingOf('/store/u/applications/Acme__1/Resume_ATS.pdf'),
    '/store/u/applications/Acme__1/Resume_ATS.html');
  assert.equal(preview.htmlSiblingOf('/store/u/CoverLetter.PDF'), '/store/u/CoverLetter.html');
  // Anything that is not a packet PDF has no preview — never guess at a path.
  assert.equal(preview.htmlSiblingOf('/store/u/notes.txt'), null);
});

test('a missing sibling resolves to null — the route must 404, never fall back to the PDF', () => {
  const { userDir, pdf } = fixtureStore({ withHtml: false });
  assert.equal(preview.resolvePreviewPath(pdf, userDir), null,
    'silently serving the PDF here is exactly the invisible-preview bug');
});

test('a present sibling resolves inside the caller\'s own directory', () => {
  const { userDir, pdf } = fixtureStore();
  const p = preview.resolvePreviewPath(pdf, userDir);
  assert.ok(p && p.endsWith('Resume_ATS.html'));
  assert.ok(p.startsWith(userDir), 'resolved preview escaped the user directory');
});

test('the preview cannot be walked out of the user directory', () => {
  const { userDir } = fixtureStore();
  // The file OUTSIDE the caller's directory must really exist, otherwise the existence check
  // rejects it and containment is never exercised — a guard that passes for the wrong reason.
  const otherUser = mkdtempSync(join(tmpdir(), 'career-other-'));
  const otherApp = join(otherUser, 'applications', 'Rival__9');
  mkdirSync(otherApp, { recursive: true });
  writeFileSync(join(otherApp, 'Resume_ATS.pdf'), '%PDF-1.4 someone else');
  writeFileSync(join(otherApp, 'Resume_ATS.html'), '<!doctype html><body>SOMEONE ELSE</body>');
  const foreignPdf = join(otherApp, 'Resume_ATS.pdf');
  assert.ok(preview.resolvePreviewPath(foreignPdf, otherUser), 'fixture is wrong: its own owner must resolve it');
  assert.equal(preview.resolvePreviewPath(foreignPdf, userDir), null,
    'another user\'s packet resolved through the preview path');
  // And a relative walk out of the caller's own directory.
  assert.equal(preview.resolvePreviewPath(join(userDir, '..', '..', 'etc', 'shadow.pdf'), userDir), null);
});

test('sibling-prefix paths are outside the authorization boundary for PDF and HTML', () => {
  const parent = mkdtempSync(join(tmpdir(), 'career-prefix-'));
  const userDir = join(parent, 'user');
  const siblingDir = join(parent, 'user-backup');
  mkdirSync(userDir);
  mkdirSync(siblingDir);
  const pdf = join(siblingDir, 'Resume_ATS.pdf');
  writeFileSync(pdf, '%PDF-1.4 sibling');
  writeFileSync(join(siblingDir, 'Resume_ATS.html'), '<!doctype html><body>sibling</body>');
  assert.equal(preview.resolveContainedRegularFile(pdf, userDir), null);
  assert.equal(preview.resolvePreviewPath(pdf, userDir), null);
});

test('linked paths cannot redirect PDF or HTML reads outside the caller store', () => {
  const userDir = mkdtempSync(join(tmpdir(), 'career-link-owner-'));
  const foreignDir = mkdtempSync(join(tmpdir(), 'career-link-target-'));
  const applications = join(userDir, 'applications');
  mkdirSync(applications);
  writeFileSync(join(foreignDir, 'Resume_ATS.pdf'), '%PDF-1.4 foreign');
  writeFileSync(join(foreignDir, 'Resume_ATS.html'), '<!doctype html><body>foreign</body>');
  const linkedDir = join(applications, 'linked');
  symlinkSync(foreignDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedPdf = join(linkedDir, 'Resume_ATS.pdf');
  assert.equal(preview.resolveContainedRegularFile(linkedPdf, userDir), null);
  assert.equal(preview.resolvePreviewPath(linkedPdf, userDir), null);
});

test('directories and other nonregular packet paths are never served', () => {
  const userDir = mkdtempSync(join(tmpdir(), 'career-nonregular-'));
  const appDir = join(userDir, 'applications', 'Acme__1');
  mkdirSync(join(appDir, 'Packet.pdf'), { recursive: true });
  mkdirSync(join(appDir, 'Packet.html'));
  assert.equal(preview.resolveContainedRegularFile(join(appDir, 'Packet.pdf'), userDir), null);
  assert.equal(preview.resolvePreviewPath(join(appDir, 'Packet.pdf'), userDir), null);
});

test('the board sends PDF paths through the shared containment resolver', () => {
  assert.match(boardRoutes, /resolvePacketPath\(filePath, userDir\)/);
  assert.match(boardRoutes, /resolveContainedRegularFile\(filePath, userDir\)/);
  assert.doesNotMatch(boardRoutes, /\.startsWith\(safeRoot\)/);
});

test('the served preview is the artifact plus screen-only CSS, unmodified', () => {
  const { userDir, pdf } = fixtureStore();
  const html = preview.buildPreviewHtml(preview.resolvePreviewPath(pdf, userDir));
  assert.ok(html.startsWith('<!doctype html>'), 'the original document must be served verbatim first');
  assert.ok(html.includes('RESUME BODY'));
  assert.ok(html.includes(preview.PREVIEW_SCREEN_CSS), 'screen CSS must be appended, not merged in');
});

test('every preview rule is screen-only, so the printed PDF is untouched', () => {
  const css = preview.PREVIEW_SCREEN_CSS;
  assert.match(css, /@media screen\s*\{/);
  // The whole block lives inside @media screen: the first rule opens after it and the outer
  // brace closes last. A rule outside it would change the artifact the employer receives.
  const screenAt = css.indexOf('@media screen');
  const firstRule = css.search(/html\s*\{/);
  assert.ok(screenAt > -1 && firstRule > screenAt, 'a rule escaped the @media screen block');
  assert.match(css, /max-width:\s*560px/, 'phone-width rules are what make it readable at ~310px');
});

test('NO surface points a preview frame at the PDF endpoint', () => {
  // This is the whole bug. A PDF in a subframe renders on every desktop and on no phone, so it
  // cannot be caught by looking at it on a laptop — only by asserting the string is gone.
  for (const [name, src] of [['career-board.html', board], ['career-mobile.html', mobile]]) {
    const frames = [...src.matchAll(/<iframe[^>]*>/gi)].map((m) => m[0]);
    for (const f of frames) {
      assert.ok(!/src\s*=\s*["'`][^"'`]*\/resume\?[^"'`]*["'`]/.test(f)
        || /as=html/.test(f), `${name}: iframe src points at the PDF endpoint -> ${f}`);
    }
    // And no JS assigns a PDF url to a frame's src either.
    assert.ok(!/\.src\s*=\s*[^;\n]*\/resume\?(?![^;\n]*as=html)/.test(src),
      `${name}: assigns the PDF endpoint to an iframe src`);
  }
});

/**
 * The body of the function that builds a packet preview, so assertions land on THAT code rather
 * than anywhere in a 600-line surface. Both files contain a dozen other `!r.ok` fetch checks; a
 * file-wide regex would happily match one of those while the preview's own check was deleted.
 */
function previewFn(src, name) {
  const start = src.indexOf(name);
  assert.ok(start > -1, `preview function ${name} is gone`);
  const body = src.slice(start, start + 2200);
  const end = body.indexOf('\n}');
  return end > -1 ? body.slice(0, end) : body;
}

const PREVIEW_FNS = [
  ['career-board.html', previewFn(board, 'async function rzPreview')],
  ['career-mobile.html', previewFn(mobile, 'async function renderPacketPane')],
];

test('both surfaces request the HTML preview and render it via srcdoc', () => {
  for (const [name, fn] of PREVIEW_FNS) {
    assert.match(fn, /as=html/, `${name}: never asks for the HTML preview`);
    assert.match(fn, /\.srcdoc\s*=/, `${name}: does not render the fetched preview`);
    // Fetching is what makes a missing preview DETECTABLE — an iframe fires load even on a 404,
    // so a src-based preview cannot tell a rendered document from an error page.
    assert.match(fn, /if\s*\(\s*!r\.ok\s*\)\s*throw/, `${name}: does not check the preview response`);
  }
});

test('the preview frame is fully sandboxed on both surfaces', () => {
  for (const [name, src] of [['career-board.html', board], ['career-mobile.html', mobile]]) {
    assert.match(src, /setAttribute\('sandbox',\s*''\)/,
      `${name}: preview frame must carry sandbox="" (opaque origin, no scripting)`);
  }
});

test('both surfaces keep a link to the PDF that actually gets submitted', () => {
  // Reviewing HTML and submitting a PDF you never saw is its own trap; and opening the PDF in a
  // new tab is a TOP-LEVEL navigation, the one PDF path phones handle natively.
  assert.match(board, /Open the exact PDF that gets submitted/);
  assert.match(board, /class="rzpdf"/);
  assert.match(mobile, /Open the exact PDF/);
  assert.match(mobile, /packet-pdf/);
  for (const [name, src] of [['career-board.html', board], ['career-mobile.html', mobile]]) {
    assert.match(src, /target="_blank"/, `${name}: PDF link must open top-level, not in the frame`);
  }
});

test('a failed preview degrades to a real action, not a blank box', () => {
  for (const [name, src] of [['career-board.html', board], ['career-mobile.html', mobile]]) {
    assert.match(src, /No inline preview/, `${name}: no fallback message`);
    assert.match(src, /catch\s*\(\s*e\s*\)/, `${name}: no fallback path at all`);
  }
});

test('the board preview box is viewport-relative, never a fixed 640px slab', () => {
  assert.match(board, /\.rzbox\s*\{[^}]*height:\s*min\(640px,\s*60vh\)/);
  assert.match(board, /@media \(max-width: 640px\)[\s\S]*?\.rzbox\s*\{\s*height:\s*min\(460px,\s*55vh\)/);
  // The old fixed height is what made an unrendered preview cost 640px of phone screen.
  assert.ok(!/height:640px/.test(board), 'the fixed 640px preview height is back');
});

test('the mobile packet pane can actually size its frame', () => {
  // .tabpane iframe is height:100%, which resolves to 0 unless the wrapper has a definite height.
  assert.match(mobile, /\.tabpane\.pdf\{[^}]*display:flex[^}]*flex-direction:column/);
  assert.match(mobile, /\.packet-frame\{[^}]*flex:1 1 auto;min-height:0/);
});

test('both surfaces still parse', () => {
  for (const [name, src] of [['career-board.html', board], ['career-mobile.html', mobile]]) {
    assert.doesNotThrow(() => new vm.Script(inlineJs(src), { filename: name }));
  }
});
