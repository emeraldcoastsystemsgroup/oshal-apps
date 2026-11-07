/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Pumpkin Review's "Your next brief" took text and lost it,
 *   because mountConnectedActions renders nothing with no connected target. Runs the page's module script with stub
 *   elements and a stub mount: with no action the brief stays hidden and no "Use this evidence" button is added; with an
 *   action the brief shows. The detail still goes through localInstants (scripts/home-summary.test.cjs case 15).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');

async function run(actions) {
  const els = new Map();
  const made = [];
  const node = (key) => ({ key, hidden: key === '#briefPanel', value: '', textContent: '', className: '', children: [], listeners: {},
    append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; }, addEventListener(t, f) { this.listeners[t] = f; },
    setAttribute() {}, querySelector() { return actions ? {} : null; },
    createTHead() { const h = node('thead'); h.insertRow = () => { const r = node('tr'); r.insertCell = () => node('td'); return r; }; return h; },
    createTBody() { const b = node('tbody'); b.insertRow = () => { const r = node('tr'); r.insertCell = () => node('td'); return r; }; return b; } });
  const el = (sel) => { if (!els.has(sel)) els.set(sel, node(sel)); return els.get(sel); };
  const module = html.slice(html.lastIndexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
  const body = module.replace(/^import .*$/gm, '');
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('document', 'window', 'fetch', 'receiveHandoff', 'mountConnectedActions', 'AppView', body);
  const document = { querySelector: el, createElement: (t) => { const n = node(t); made.push(n); return n; } };
  const fetch = async () => ({ ok: true, json: async () => ({ metrics: [], items: [{ text: 'Boo line', detail: 'saved 2026-11-06T08:00:00Z', actions: [{ context: { title: 'Boo', notes: 'n' } }] }] }) });
  await fn(document, {}, fetch, () => {}, async () => {}, undefined);
  return { brief: el('#briefPanel'), buttons: made.filter((n) => n.textContent === 'Use this evidence') };
}

test('with no connected action the brief stays hidden and no evidence button is offered', async () => {
  const { brief, buttons } = await run(false);
  assert.equal(brief.hidden, true);
  assert.equal(buttons.length, 0);
});

test('with a connected action the brief is shown and each saved row offers its evidence', async () => {
  const { brief, buttons } = await run(true);
  assert.equal(brief.hidden, false);
  assert.equal(buttons.length, 1);
  assert.match(html, /detail\.textContent=localInstants\(item\.detail/);
});
