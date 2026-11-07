/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (capability-ideation--capability-ideation-review, SPLIT):
 *   6,700px of repeated action strings sat before the composer, and the brief had no action. Guards the two views
 *   (Brief by default with the composer first, the Capability directory behind the second tab), one primary per view,
 *   Develop this idea sending the brief to the concierge (app-ask) and refusing an empty brief, Save draft keeping the
 *   brief on this device, the directory listing each application once with de-duplicated action chips, its search
 *   and suite filter, and Use in a brief filling the composer and opening Brief.
 *
 * Runs the page's module script (imports stripped, top-level await as an async function body) over a small fake DOM.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');
const body = html.slice(html.indexOf('<body>'));

/** A fake element: enough of the DOM for the page's module script, with its listeners kept so a test can fire them. */
function el(tag = 'div') {
  const e = {
    tag, value: '', textContent: '', className: '', id: '', type: '', hidden: false, disabled: false, children: [], dataset: {}, attrs: {}, listeners: {},
    append(...kids) { e.children.push(...kids); }, replaceChildren(...kids) { e.children = kids; },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; },
    addEventListener(type, fn) { (e.listeners[type] = e.listeners[type] || []).push(fn); },
    fire(type) { (e.listeners[type] || []).forEach((fn) => fn({})); }, focus() { e.focused = true; },
    createTHead() { const h = el('thead'); h.insertRow = () => { const r = el('tr'); r.insertCell = () => { const c = el('td'); r.append(c); return c; }; h.append(r); return r; }; e.append(h); return h; },
    createTBody() { const b = el('tbody'); b.insertRow = () => { const r = el('tr'); r.insertCell = () => { const c = el('td'); r.append(c); return c; }; b.append(r); return r; }; e.append(b); return b; },
  };
  return e;
}

const PLAN = { apps: [
  { displayName: 'Intelligent Career', suite: 'ai-productivity', integrationSources: [
    { offers: [{ label: 'Prepare a document', targetApp: 'presentations', state: 'available' }, { label: 'Prepare a document', targetApp: 'presentations', state: 'available' }] },
    { offers: [{ label: 'Prepare a document', targetApp: 'presentations', state: 'available' }, { label: 'Plan a trip', targetApp: 'travel', state: 'needs-connection' }] }] },
  { displayName: 'Aero Lab', suite: 'ai-engineering', integrationSources: [{ offers: [{ label: 'Prepare an analysis document', targetApp: 'presentations', state: 'available' }] }] },
] };

async function run({ hash = '', draft = null } = {}) {
  const nodes = new Map(), posted = [], stored = {}, replaced = [];
  const query = (sel) => { if (!nodes.has(sel)) nodes.set(sel, el()); return nodes.get(sel); };
  const doc = {
    querySelector: query, createElement: (t) => el(t),
    querySelectorAll: (sel) => (sel === '#loadedApps .dir-row' ? query('#loadedApps').children.filter((c) => c.className === 'dir-row') : []),
  };
  const fetchStub = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(url.includes('home-plan') ? PLAN : { metrics: [], items: [] }) });
  const win = { parent: { postMessage: (m, o) => posted.push([m, o]) }, location: { origin: 'http://local.test' } };
  const where = { pathname: '/api/capability-ideator/review', search: '', hash };
  const store = { getItem: (k) => (k in stored ? stored[k] : draft), setItem: (k, v) => { stored[k] = v; } };
  const open = html.indexOf('<script type="module">');
  const src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', 'location', 'history', 'localStorage', src)(
    win, undefined, doc, fetchStub, () => {}, () => Promise.resolve(), where, { replaceState: (a, b, u) => replaced.push(u) }, store);
  return { q: query, posted, stored, replaced };
}

test('the page has two views, Brief first and default, with the composer before the directory and one primary each', async () => {
  const brief = body.slice(body.indexOf('id="view-brief"'), body.indexOf('id="view-directory"'));
  const directory = body.slice(body.indexOf('id="view-directory"'), body.indexOf('<script'));
  assert.ok(body.indexOf('id="composer"') < body.indexOf('id="loadedApps"'), 'the composer comes before the directory');
  assert.equal((brief.match(/class="primary"/g) || []).length, 1);
  assert.match(brief, /class="primary" id="develop">Develop this idea</);
  assert.match(brief, /id="saveDraft">Save draft</);
  assert.equal((directory.match(/class="primary"/g) || []).length, 0);
  const r = await run();
  assert.equal(r.q('#view-brief').hidden, false);
  assert.equal(r.q('#view-directory').hidden, true);
  assert.equal(r.q('#tab-brief').getAttribute('aria-selected'), 'true');
  const d = await run({ hash: '#view=directory' });
  assert.equal(d.q('#view-directory').hidden, false, 'Reload keeps the directory view');
});

test('Develop this idea sends the brief to the concierge; an empty brief is refused in words', async () => {
  const r = await run();
  r.q('#develop').fire('click');
  assert.equal(r.posted.length, 0);
  assert.match(r.q('#status').textContent, /Write the brief first/);
  r.q('#title').value = 'Faster quotes';
  r.q('#notes').value = 'Quotes take two days; the intake form is retyped by hand.';
  r.q('#develop').fire('click');
  assert.equal(r.posted.length, 1);
  const [msg, origin] = r.posted[0];
  assert.equal(msg.type, 'app-ask');
  assert.equal(msg.app, 'capability-ideator');
  assert.match(msg.text, /Title: Faster quotes/);
  assert.match(msg.text, /Brief: Quotes take two days/);
  assert.equal(origin, 'http://local.test');
  assert.match(r.q('#status').textContent, /Sent to the concierge/);
});

test('Save draft keeps the brief on this device and a reload brings it back', async () => {
  const r = await run();
  r.q('#title').value = 'Draft title';
  r.q('#notes').value = 'Draft notes';
  r.q('#saveDraft').fire('click');
  const saved = r.stored['capability-ideator-brief-draft'];
  assert.deepEqual(JSON.parse(saved), { title: 'Draft title', notes: 'Draft notes', sourceUrl: '' });
  assert.match(r.q('#status').textContent, /Draft saved on this device/);
  const again = await run({ draft: saved });
  assert.equal(again.q('#notes').value, 'Draft notes');
});

test('the directory lists each application once, its actions de-duplicated, with search and a suite filter', async () => {
  const r = await run();
  const rows = r.q('#loadedApps').children.filter((c) => c.className === 'dir-row');
  assert.equal(rows.length, 2);
  const career = rows.find((row) => row.dataset.search.startsWith('intelligent career'));
  const chips = career.children[1].children.map((c) => c.textContent);
  assert.deepEqual(chips, ['Prepare a document → Presentations', 'Plan a trip → Travel (needs setup)']);
  assert.equal(career.children[1].hidden, true, 'rows open collapsed to name and count');
  assert.equal(career.children[0].children[0].children[0].textContent, 'Intelligent Career · 1 available action');
  r.q('#dirSuite').value = 'ai-engineering';
  r.q('#dirSuite').fire('change');
  assert.deepEqual(rows.filter((row) => !row.hidden).map((row) => row.dataset.suite), ['ai-engineering']);
  r.q('#dirSuite').value = '';
  r.q('#dirSearch').value = 'trip';
  r.q('#dirSearch').fire('input');
  assert.deepEqual(rows.filter((row) => !row.hidden).map((row) => row.dataset.suite), ['ai-productivity']);
});

test('Use in a brief fills the composer and opens the Brief view', async () => {
  const r = await run({ hash: '#view=directory' });
  const row = r.q('#loadedApps').children.find((c) => c.className === 'dir-row' && c.dataset.suite === 'ai-engineering');
  const use = row.children[0].children[1];
  assert.equal(use.textContent, 'Use in a brief');
  use.fire('click');
  assert.equal(r.q('#title').value, 'Business process using Aero Lab');
  assert.match(r.q('#notes').value, /Prepare an analysis document → presentations \(available\)/);
  assert.equal(r.q('#view-brief').hidden, false);
  assert.equal(r.q('#view-directory').hidden, true);
  assert.equal(r.replaced.at(-1), '/api/capability-ideator/review');
});
