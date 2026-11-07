/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Sports Edge Review, grade D): the app opens on Sports Edge (the review left the menu, its route stays), and the review page's module script, run with stub platform modules, keeps "Your next brief" hidden when no connected action is rendered and shows it when one is; the internal contract paragraph becomes one line.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'tools', 'review.html'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');

test('the app opens on Sports Edge: the review is off the menu and the default view is home', () => {
  const ui = manifest.slice(manifest.indexOf('\nui:\n'), manifest.indexOf('\nribbon:\n'));
  assert.doesNotMatch(ui, /toolName: sports-edge-review/);
  assert.match(ui, /toolName: sports-edge-home/);
  assert.match(manifest, /defaultView: sports-edge-home/);
});

/** Run the page's module script against stub elements and stub platform modules. */
async function run(actions) {
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) els.set(sel, { hidden: sel === '#briefPanel', value: '', textContent: '', children: [], listeners: {},
      append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; }, addEventListener(t, f) { this.listeners[t] = f; },
      querySelector() { return actions ? {} : null; }, setAttribute() {}, classList: { toggle() {} } });
    return els.get(sel);
  };
  const module = html.slice(html.lastIndexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
  const body = module.replace(/^import .*$/gm, '');
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('document', 'window', 'fetch', 'receiveHandoff', 'mountConnectedActions', 'AppView', body);
  const document = { querySelector: el, createElement: () => el(Symbol('x')) };
  const fetch = async () => ({ ok: true, json: async () => ({ metrics: [], items: [{ text: "Shows the caller's followed teams and upcoming cached previews, which must match a followed team." }] }) });
  await fn(document, {}, fetch, () => {}, async () => {}, undefined);
  return { brief: el('#briefPanel'), records: el('#records') };
}

test('with no connected action the brief stays hidden, and the contract is one line', async () => {
  const { brief, records } = await run(false);
  assert.equal(brief.hidden, true);
  assert.deepEqual(records.children.map((p) => p.textContent), ['Previews come from your followed teams; nothing here places a bet.']);
});

test('with a connected action the brief is shown', async () => {
  const { brief } = await run(true);
  assert.equal(brief.hidden, false);
});
