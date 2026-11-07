/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (@ux-career's shape from sports-edge): the review is off the menu and the app opens on game-show-stage; the review page's module script, run with stub platform modules, keeps "Your next brief" hidden and offers no "Use this evidence" when no connected action is rendered, shows both when one is, and puts the route's long contract note in one line.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'tools', 'review.html'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');

test('the review is off the menu and the default view is game-show-stage', () => {
  const tiles = manifest.slice(manifest.indexOf('\nui:\n'), manifest.indexOf('\nroutes:\n')).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(tiles, /toolName: game-show-review/);
  assert.match(tiles, /toolName: game-show-stage/);
  assert.match(manifest, /defaultView: game-show-stage/);
});

/** Run the page's module script against stub elements and stub platform modules. */
async function run(actions) {
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) els.set(sel, { hidden: sel === '#briefPanel', value: '', textContent: '', children: [], listeners: {}, className: '',
      append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; }, addEventListener(t, f) { this.listeners[t] = f; },
      querySelector() { return actions ? {} : null; }, setAttribute() {}, classList: { toggle() {} },
      createTHead() { const row = el(Symbol('tr')); return { insertRow: () => row }; },
      createTBody() { const body = el(Symbol('tbody')); body.insertRow = () => { const r = el(Symbol('tr')); r.insertCell = () => el(Symbol('td')); body.children.push(r); return r; }; return body; } });
    return els.get(sel);
  };
  const module = html.slice(html.lastIndexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
  const body = module.replace(/^import .*$/gm, '');
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('document', 'window', 'fetch', 'receiveHandoff', 'mountConnectedActions', 'AppView', body);
  const document = { querySelector: el, createElement: () => el(Symbol('x')) };
  const items = [{ text: 'Synthetic room', detail: 'live / updated 2026-11-05T20:00:00Z', actions: [{ integration: 'plan-meal', context: { title: 'Synthetic room', notes: 'n' } }] },
    { text: "Counts caller-hosted rooms by persisted lobby/live/ended state; live does not mean a connected player. The rest of the note." }];
  const fetch = async () => ({ ok: true, json: async () => ({ metrics: [], items }) });
  await fn(document, {}, fetch, () => {}, async () => {}, undefined);
  const all = [...els.values()];
  const buttons = all.filter((e) => e.textContent === 'Use this evidence');
  return { brief: el('#briefPanel'), records: el('#records'), buttons };
}

test('with no connected action the brief stays hidden, no row offers Use this evidence, and the contract is one line', async () => {
  const { brief, records, buttons } = await run(false);
  assert.equal(brief.hidden, true);
  assert.equal(buttons.length, 0);
  assert.deepEqual(records.children.filter((p) => p.className === 'hint').map((p) => p.textContent), ['Counts are the rooms you host; marked live means a game was started and not ended.']);
});

test('with a connected action the brief is shown and a row offers Use this evidence', async () => {
  const { brief, buttons } = await run(true);
  assert.equal(brief.hidden, false);
  assert.equal(buttons.length, 1);
});
