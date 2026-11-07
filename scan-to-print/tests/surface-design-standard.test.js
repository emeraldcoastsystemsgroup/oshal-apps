/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.9.0, the design standard (kernel docs/ux/design-standard.md; Roger, 2026-11-06, F2, F3, F12; the reference products Polycam and KIRI Engine, CONVENTIONS.md §5.8). The served page declares its contract (a studio whose first action adds a photo, its work marked), has one primary on its first screen (New object is a menu item, Reconstruct and Send are secondary), asks every question in the page (no window.prompt, confirm or alert: DS-30), names an object for today without a prompt, and shows each function both references have and Scan to Print lacks as a greyed planned control in the place the references put it (DS-45, RP-SCN-01 to -06), loaded through the shared helper. The page script runs in a Node VM over stub DOM and HTTP ports; no browser, server or real data is used.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.10.0: replace all six RP-SCN-01..06 planned-control placeholders with live tested controls (Crop, Rotate/Lay-flat, Measure, GLB + USDZ exports, revocable Share sheet, and View in AR sheet) while preserving zero native dialogs and the single-primary contract.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.html'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.js'), 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body>'));

/** The markup of one element, from its opening tag to its matching close. */
function blockOf(tag, attr) {
  const start = HTML.indexOf(`<${tag} ${attr}`);
  assert.ok(start >= 0, `the page has <${tag} ${attr}>`);
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(HTML))) { depth += m[0].startsWith('</') ? -1 : 1; if (depth === 0) return HTML.slice(start, m.index + m[0].length); }
  throw new Error(`<${tag} ${attr}> is never closed`);
}

test('the page declares its contract: a studio, the first action adds a photo, and the work is marked', () => {
  assert.match(HTML, /<html [^>]*data-ds-category="studio"/);
  assert.match(HTML, /<html [^>]*data-ds-first-action="file:image"/);
  assert.match(JS, /root\.querySelector\('\.ef-viewport'\)\?\.setAttribute\('data-ds-work', ''\)/, 'the editor viewport is the work');
});

test('one primary on the first screen: New object is a menu item; Reconstruct and Send to printer are secondary', () => {
  const header = BODY.slice(0, BODY.indexOf('</header>'));
  assert.doesNotMatch(header, /class="[^"]*\bprimary\b/, 'the app row holds no primary');
  assert.match(header, /<button id="new-job"[^>]*role="menuitem"/, 'New object is an item of the Object menu');
  const primaries = [...BODY.matchAll(/<(?:button|a) id="([^"]+)"[^>]*class="[^"]*\bprimary\b/g)].map((m) => m[1]).sort();
  assert.deepEqual(primaries, ['download-stl', 'export-go', 'make-model', 'take-photos'], 'the capture row\'s one next step, and Export at the bottom of its own sheet');
  assert.match(BODY, /<button id="reconstruct" class="ghost">/);
  assert.match(BODY, /<button id="send" class="ghost">/);
  assert.match(BODY, /<button id="take-photos" class="primary">Take a photo<\/button>/, 'the first action is the standard\'s Take a photo');
});

test('no native alert, confirm or prompt anywhere in the page script', () => {
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /window\.(prompt|confirm|alert)\s*\(/);
  assert.doesNotMatch(code, /(^|[^.\w])(prompt|confirm|alert)\s*\(/m);
});

test('the steps read 1 Capture, 2 Scale, 3 Model, 4 Print, and the capture sources are one Photos, Video, LiDAR file choice', () => {
  const steps = [...BODY.matchAll(/<li data-step="(\w+)"[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[2]);
  assert.deepEqual(steps.slice(0, 4), ['1 Capture', '2 Scale', '3 Model', '4 Print']);
  const modes = blockOf('div', 'id="capture-modes"');
  assert.match(modes, /role="radiogroup"/);
  assert.deepEqual([...modes.matchAll(/data-mode="(\w+)"[^>]*>([^<]+)</g)].map((m) => m[2]), ['Photos', 'Video', 'LiDAR file']);
});

test('all six reference-product controls (RP-SCN-01..06) are live in their reference places with zero planned placeholders remaining', () => {
  assert.doesNotMatch(HTML, /data-ds-not-yet/, 'zero data-ds-not-yet attributes remain in scan-to-print.html');
  assert.doesNotMatch(HTML, /data-ds-backlog/, 'zero data-ds-backlog attributes remain in scan-to-print.html');
  assert.match(HTML, /<script src="\/api\/scan-to-print\/assets\/scan-to-print-tools\.js"><\/script>/);
  const tools = blockOf('div', 'class="viewer-tools"');
  const order = [...tools.matchAll(/<button id="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['tool-export', 'tool-print', 'tool-crop', 'tool-rotate', 'tool-measure'], 'Crop, Rotate and Measure follow Export and Print as live viewer tools');
  assert.match(blockOf('div', 'class="viewer-bar"'), /id="tool-share"[^>]*>Share</, 'live Share control sits in the viewer top bar');
  assert.match(blockOf('div', 'class="viewer-edge"'), /id="tool-ar"[^>]*>AR</, 'live AR control sits on the viewer right edge');
  assert.match(JS, /\['glb',\s*'GLB'/, 'GLB is a live row in EXPORTS');
  assert.match(JS, /\['usdz',\s*'USDZ'/, 'USDZ is a live row in EXPORTS');
  assert.match(blockOf('dialog', 'id="ar-sheet"'), /<a id="ar-quicklook" rel="ar"/, 'AR sheet carries iOS Quick Look rel="ar" anchor');
  assert.match(blockOf('dialog', 'id="share-sheet"'), /id="share-create"/, 'Share sheet carries link creation and revocation list');
});

function response(status, body) { return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) }; }
function node() {
  return { hidden: true, disabled: false, value: '', textContent: '', className: '', children: [], listeners: {}, open: false, style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {},
    setAttribute() {}, removeAttribute() {}, focus() {}, addEventListener(kind, fn) { this.listeners[kind] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; },
    appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; } };
}
/** The page's closures over stub DOM and HTTP ports; window has no prompt or confirm, so calling either throws. */
function surface(answer) {
  const seam = "document.addEventListener('DOMContentLoaded', boot);";
  assert.equal(JS.split(seam).length, 2, 'one boot seam');
  const elements = new Map(), requests = [];
  const get = (id) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const context = vm.createContext({ document: { getElementById: get, createElement: node, createTextNode: (t) => ({ textContent: t }) },
    window: { location: { assign() {} }, addEventListener() {} }, location: { search: '' }, URLSearchParams, sessionStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, init = {}) => { requests.push({ url, method: init.method || 'GET', body: init.body }); return answer(url, init); } });
  vm.runInContext(JS.replace(seam, 'globalThis.surface = { state, createJob, removeImage, settleAsk };'), context);
  return { ...context.surface, requests, get };
}
const JOB = { job_id: 'j1', title: 'Object · 6 Nov', state: 'capturing', source_kind: 'photos', known_dimensions: [], settings: {}, updated_at: '2026-11-06T00:00:00Z', created_at: '2026-11-06T00:00:00Z' };
const detail = () => response(200, { job: JOB, images: [{ image_id: 'i1', file_name: 'front.png', view: 'front', width: 10, height: 10, created_at: '2026-11-06T00:00:00Z' }], artifacts: {} });
const routes = (url, init) => {
  if (url.endsWith('/jobs') && init.method === 'POST') return response(201, { job: JOB });
  if (url.endsWith('/jobs')) return response(200, { jobs: [JOB] });
  if (url.endsWith('/calibration')) return response(200, { sourceSha: 'a', canEdit: true, canReconstruct: true, knownDimensions: [], settings: {} });
  if (url.endsWith('/submissions')) return response(200, { submissions: [] });
  if (url.endsWith('/printers')) return response(200, { printers: [], slicerConfigured: false });
  if (url.includes('/images/i1') && init.method === 'DELETE') return response(200, {});
  if (url.endsWith('/jobs/j1')) return detail();
  return response(404, { error: 'not_found' });
};

test('New object names the object for today and opens it, with no prompt', async () => {
  const f = surface(routes);
  await f.createJob();
  const post = f.requests.find((r) => r.method === 'POST' && r.url === '/api/scan-to-print/jobs');
  assert.ok(post, 'one POST /jobs');
  assert.match(JSON.parse(post.body).title, /^Object · /, 'named for today');
});

test('removing a photo asks in the page: Cancel removes nothing, Remove removes it', async () => {
  const f = surface(routes);
  f.state.job = JOB; f.state.detail = { job: JOB, images: [], artifacts: {} };
  const first = f.removeImage('i1');
  await new Promise((r) => setImmediate(r));
  assert.equal(f.get('ask-sheet').open, true, 'the in-page sheet asks');
  assert.match(f.get('ask-text').textContent, /^Remove this photo from "Object · 6 Nov"\?/);
  assert.equal(f.get('ask-yes').textContent, 'Remove');
  f.settleAsk(false); await first;
  assert.equal(f.requests.filter((r) => r.method === 'DELETE').length, 0, 'Cancel removes nothing');
  const second = f.removeImage('i1');
  await new Promise((r) => setImmediate(r));
  f.settleAsk(true); await second.catch(() => {});
  assert.equal(f.requests.filter((r) => r.method === 'DELETE' && r.url.endsWith('/images/i1')).length, 1, 'Remove removes it');
});
