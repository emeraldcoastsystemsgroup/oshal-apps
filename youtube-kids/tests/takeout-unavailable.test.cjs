/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | "Find my Takeout in Dropbox" called /api/takeout/dropbox/list, which the native kernel answers 404 {detail:'application is not installed', refused:'not_found'}, and the page printed "undefined" (it read only message/error); a dropped .zip went to /api/takeout/ingest-zip and failed the same way. The page's own script runs here over DOM and fetch doubles: when the archive service answers not installed, the Dropbox button never appears, the page offers watch-history.json only and says why, a dropped .zip is refused in words without a request, and any refusal shows its detail.
 * -----------------------------------------------------------------------------
 *
 * @module takeout-unavailable.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'youtube-kids-dashboard.html'), 'utf8');
const SCRIPT = [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const NOT_INSTALLED = { detail: 'application is not installed', refused: 'not_found' };

/** Element doubles keyed by id; `firstChild` stands for the element innerHTML just created. */
function dom() {
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || {
    id, innerHTML: '', textContent: '', className: '', hidden: undefined, style: {}, attrs: {},
    firstChild: { textContent: '' }, classList: { add() {}, remove() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, click() {},
  });
  return { nodes, node };
}

/** Load the page with `routes` answering fetches; returns the sandbox, its nodes and the requests made. */
async function page(routes) {
  const { nodes, node } = dom();
  const asked = [];
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    fetch: async (url, init) => {
      asked.push({ url: String(url), method: (init && init.method) || 'GET' });
      const [status, body] = routes[String(url).split('?')[0]] || [404, NOT_INSTALLED];
      return { ok: status < 400, status, json: async () => body };
    },
    console, setTimeout, encodeURIComponent, Promise,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: 'youtube-kids-dashboard.html' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { sandbox, nodes, asked };
}

const NO_DATA = { '/api/youtube-kids/status': [200, { hasData: false }] };

test('with no Takeout archive service the upload screen offers watch-history.json only and says why', async () => {
  const { nodes } = await page(NO_DATA);
  assert.match(nodes.main.innerHTML, /<button class="btn ghost" id="dbxBtn" hidden>/, 'the button starts hidden');
  assert.notEqual(nodes.dbxBtn.hidden, false, 'and is never shown');
  assert.match(nodes.dbxSection.innerHTML, /not available on this installation/);
  assert.match(nodes.dbxSection.innerHTML, /Takeout archive service is not installed/);
  assert.equal(nodes.file.attrs.accept, '.json,application/json');
  assert.match(nodes.zipStep.innerHTML, /watch-history\.json/);
});

test('a dropped .zip is refused in words, with no request to the missing service', async () => {
  const { sandbox, nodes, asked } = await page(NO_DATA);
  asked.length = 0;
  await sandbox.upload({ name: 'takeout-20261011.zip', size: 1048576 });
  assert.match(nodes.upmsg.textContent, /cannot unpack a \.zip/);
  assert.deepEqual(asked.filter((a) => /ingest-zip/.test(a.url)), []);
});

test('a refusal shows its detail, never "undefined"', async () => {
  const { sandbox, nodes } = await page(NO_DATA);
  await sandbox.listDropbox();
  assert.equal(nodes.dbxList.firstChild.textContent, 'application is not installed');
  assert.equal(sandbox.refusalText({}, 'fallback'), 'fallback');
  assert.equal(sandbox.refusalText({ detail: 'd' }, 'f'), 'd');
});

test('when the service is installed the Dropbox button is offered', async () => {
  const { nodes } = await page({ ...NO_DATA, '/api/takeout/dropbox/list': [200, { candidates: [] }] });
  assert.equal(nodes.dbxBtn.hidden, false);
  assert.ok(!nodes.dbxSection || !/not available/.test(nodes.dbxSection.innerHTML));
  assert.equal(nodes.dbxList.innerHTML, '');
});
