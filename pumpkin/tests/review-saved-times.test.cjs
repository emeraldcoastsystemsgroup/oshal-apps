/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: Pumpkin Review showed a saved line's time as a raw UTC instant
 *   ('mischief / saved 2026-10-13T10:55:35.857Z', 05:55 for a person in Chicago). The real compiled home-summary route
 *   feeds the page's own refresh, run as shipped over a stub DOM in the America/Chicago zone: the detail reads the
 *   local date and time and no raw instant.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The review page lists records as a sortable table (2026-10-29 UX standard): the stub DOM learns the
 *   table API the page uses (createTHead, createTBody, insertRow, insertCell, setAttribute) and the detail is read from each
 *   body row's second cell. The intent is unchanged: a saved instant reads as the local date and time, never as UTC text.
 */
'use strict';
process.env.TZ = 'America/Chicago';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

/** The compiled route with an express Router stand-in; returns its GET handler. */
function summaryHandler(pool) {
  let handler = null;
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'express') return { Router: () => ({ get: (_p, fn) => { handler = fn; } }) };
    return original.call(this, request, ...rest);
  };
  try {
    const file = require.resolve('../routes/home-summary.js');
    delete require.cache[file];
    require(file).createHomeSummaryRoutes({ pool });
  } finally { Module._load = original; }
  return handler;
}

/** Run the page's refresh over a stub DOM, with fetch answered by the route's JSON; returns the record details. */
async function pageDetails(body) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');
  const start = html.indexOf('const localInstants=');
  const end = html.indexOf("document.querySelector('#refresh')", start);
  assert.ok(start > 0 && end > start, 'the page formats instants before refresh');
  const made = [];
  const node = () => { const n = { children: [], textContent: '', className: '', attributes: {}, append: (...c) => n.children.push(...c), replaceChildren: (...c) => { n.children = c; }, addEventListener() {},
    setAttribute(name, value) { n.attributes[name] = value; }, createTHead: () => { const h = node(); n.children.push(h); return h; }, createTBody: () => { const b = node(); n.children.push(b); return b; },
    insertRow: () => { const r = node(); n.children.push(r); return r; }, insertCell: () => { const c = node(); n.children.push(c); return c; } }; made.push(n); return n; };
  const list = node(), metrics = node();
  const document = { createElement: () => node(), querySelector: (q) => (q === '#records' ? list : metrics) };
  const fetch = async () => ({ ok: true, json: async () => body });
  await new Function('document', 'fetch', 'fill', 'status', 'app', `${html.slice(start, end)}\nreturn refresh();`)(document, fetch, () => {}, {}, 'pumpkin');
  assert.ok(list.children.length && made.some((n) => n.className === 'records' && n.children[1] && n.children[1].children.length), `the page listed records: ${list.textContent}`);
  // The records are the rows of the table's body (the table sits in a scroll wrapper; thead first, tbody second); the detail is each row's second cell.
  const table = made.find((n) => n.className === 'records'), tbody = table.children[1];
  return tbody.children.map((row) => row.children[1] && row.children[1].textContent);
}

test('a saved line reads its local date and time on Pumpkin Review, not a UTC instant', async () => {
  const pool = { query: async ({ text }) => ({ rows: /count\(\*\)::text AS presets/.test(text) ? [{ presets: '0' }]
    : /AS lines/.test(text) ? [{ lines: '1', pinned: '0' }]
      : [{ say: 'Boo', expression: 'mischief', source: 'manual', updated_at: '2026-10-13T10:55:35.857Z' }] }) };
  const res = { status() { return this; }, setHeader() {}, json(b) { this.body = b; } };
  await summaryHandler(pool)({ oidc: { isAuthenticated: () => true, user: { sub: 'p1' } } }, res);
  assert.equal(res.body.items[0].detail, 'mischief / saved 2026-10-13T10:55:35.857Z', 'the summary carries the instant');
  const details = await pageDetails(res.body);
  assert.match(details[0], /^mischief \/ saved Oct 13, 2026, 5:55\s?AM$/);
  assert.doesNotMatch(details.join('\n'), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});
