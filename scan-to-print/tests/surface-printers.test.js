/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Printers with no object open: the packaged page keeps the printer list, the registration form, the Bambu help and the slicer engine note in a Printers panel that is never hidden and sits above the object list, outside the print step (which stays hidden until an object is reconstructed); its boot, run in a Node VM with explicit DOM and HTTP ports, reads GET /printers and lists them with nothing written. No browser, server or real data is used.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.html'), 'utf8');
const P2S = { printer_id: '22222222-2222-4222-8222-222222222222', label: 'Bambu Lab P2S', kind: 'bambu-lan', base_url: 'bambu://192.168.1.193', device_model: 'N7', auto_start: false, slice_profile: { nozzle: '0.4' } };

function response(status, body) { return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) }; }
function node() {
  return { hidden: true, textContent: '', className: '', children: [], listeners: {}, options: [], setAttribute() {}, removeAttribute() {},
    addEventListener(kind, fn) { this.listeners[kind] = fn; },
    appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; } };
}

/** The page's own boot, unchanged, over stub DOM and HTTP ports. */
function surface(answer) {
  const source = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.js'), 'utf8');
  const seam = "document.addEventListener('DOMContentLoaded', boot);";
  assert.equal(source.split(seam).length, 2, 'one boot seam exposes the unchanged production closures to isolated ports');
  const elements = new Map(), requests = [];
  const get = (id) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const context = vm.createContext({ document: { getElementById: get, createElement: node, createTextNode: (t) => ({ textContent: t }) },
    window: { location: { assign() {} }, addEventListener() {} }, location: { search: '' }, URLSearchParams,
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, init = {}) => { requests.push({ url, method: init.method || 'GET' }); return answer(url, init); } });
  vm.runInContext(source.replace(seam, 'globalThis.surface = { state, boot };'), context);
  return { ...context.surface, requests, get };
}

/** The markup of one element, from its opening tag to its matching close (nesting of the same tag counted). */
function blockOf(tag, id) {
  const start = HTML.indexOf(`<${tag} id="${id}"`);
  assert.ok(start >= 0, `the page has <${tag} id="${id}">`);
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(HTML))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return HTML.slice(start, m.index + m[0].length);
  }
  throw new Error(`<${tag} id="${id}"> is never closed`);
}

test('the printers panel is never hidden, sits above the object list, and holds what the print step used to', () => {
  const printStep = blockOf('section', 'print-step');
  const printers = blockOf('details', 'printers');
  for (const id of ['printer-list', 'printer-form', 'bambu-help', 'engine-note', 'p-host', 'p-code']) {
    assert.ok(printers.includes(`id="${id}"`), `${id} is in the Printers panel`);
    assert.ok(!printStep.includes(`id="${id}"`), `${id} is not inside the print step, which stays hidden until an object is reconstructed`);
  }
  const opening = printers.slice(0, printers.indexOf('>') + 1);
  assert.doesNotMatch(opening, /\bhidden\b/, 'the Printers panel itself is never hidden');
  const asideStart = HTML.indexOf('<aside>'), asideEnd = HTML.indexOf('</aside>');
  const inAside = HTML.indexOf('<details id="printers"');
  assert.ok(asideStart >= 0 && inAside > asideStart && inAside < asideEnd, 'the Printers panel is in the object-list column, visible with no object open');
  assert.ok(inAside < HTML.indexOf('<div id="job-list">'), 'it sits above the object list, so a long list cannot push it out of view');
  assert.doesNotMatch(HTML.slice(asideStart, inAside), /\bhidden\b/, 'nothing that wraps it is hidden');
  assert.match(printers, /Settings → Settings → LAN Only/, 'the Bambu help names the P2S and H2 path');
});

test('with no object open the boot reads the printers and lists them, writing nothing', async () => {
  const f = surface((url) => {
    if (url.endsWith('/capabilities')) return response(200, {});
    if (url.endsWith('/jobs')) return response(200, { jobs: [] });
    if (url.endsWith('/printers')) return response(200, { printers: [P2S], slicerConfigured: false });
    if (url.endsWith('/printers/profiles')) return response(200, { printers: [{ modelId: 'N7', printerModel: 'Bambu Lab P2S' }], plates: [], engine: { ready: true } });
    return response(404, { error: 'not_found' });
  });
  await f.boot();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.requests.some((r) => r.method === 'GET' && r.url === '/api/scan-to-print/printers'), 'the boot reads the printers');
  assert.deepEqual(f.requests.filter((r) => r.method !== 'GET'), [], 'nothing is written at boot');
  const rows = f.get('printer-list').children;
  assert.equal(rows.length, 1);
  assert.match(rows[0].children[0].textContent, /^Bambu Lab P2S \(Bambu Lab P2S, 192\.168\.1\.193\)/);
  assert.equal(f.state.job, null, 'no object is open');
  assert.equal(f.get('print-step').hidden, true, 'the print step itself still waits for a reconstructed object');
});
