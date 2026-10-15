/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: after a failed AI draft every generate button stayed disabled until the page was reloaded
 *   (generate() returned on a refused answer before turning them back on). The shipped page's generate(), run against button and
 *   fetch doubles, turns all four buttons back on and clears the status after a refused answer, a thrown network error and a
 *   success, shows the server's plain refusal words, and shows a cut-off note beside a saved draft.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'presentations.html'), 'utf8');

/** One top-level function's source, cut out of the shipped page by brace depth. */
function cut(signature) {
  const start = HTML.indexOf(signature);
  assert.ok(start >= 0, `the page defines ${signature}`);
  let depth = 0;
  for (let i = HTML.indexOf('{', start); i < HTML.length; i += 1) {
    if (HTML[i] === '{') depth += 1;
    else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

/** Run the page's generate() once with the given fetch double; answer the buttons, status and result it left. */
async function run(fetchDouble) {
  const els = {};
  const $ = (id) => (els[id] ||= { id, disabled: false, textContent: '', value: '' });
  const shown = [];
  const context = {
    $, fetch: fetchDouble, JSON, Promise, Error,
    res: (html, ok) => shown.push({ html, ok }),
    deckOpts: () => ({}), esc: (v) => String(v), PROV_NAME: {}, THEMES: [],
    fillDrafted: () => {}, showTab: () => {}, loadDecks: () => {},
  };
  vm.createContext(context);
  vm.runInContext(`${cut('async function generate(body, label, fmt){')}\nthis.generate = generate;`, context);
  await context.generate({ topic: 'sweep12 deck' }, 'Drafting…', 'pptx');
  const buttons = ['genBtn', 'genAlt1', 'genAlt2', 'aiBtn'].map((id) => $(id).disabled);
  return { buttons, status: $('status').textContent, shown };
}

const answer = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('a refused draft turns every generate button back on and shows the plain refusal', async () => {
  const words = "The deck builder's outline came back cut off, so no deck was made. Try again, or ask for fewer slides.";
  const out = await run(answer(502, { error: words, code: 'outline_cut_off' }));
  assert.deepEqual(out.buttons, [false, false, false, false]);
  assert.equal(out.status, '');
  assert.deepEqual(out.shown.at(-1), { html: `Failed: ${words}`, ok: false });
});

test('a network error and a success also leave the buttons on', async () => {
  const thrown = await run(async () => { throw new Error('offline'); });
  assert.deepEqual(thrown.buttons, [false, false, false, false]);
  assert.deepEqual(thrown.shown.at(-1), { html: 'Error: offline', ok: false });
  const saved = await run(answer(200, { ok: true, provider: 'oshal-local', slides: 5, note: 'The outline came back cut off, so this file has the 5 complete slides.' }));
  assert.deepEqual(saved.buttons, [false, false, false, false]);
  assert.match(saved.shown.at(-1).html, /is saved to oshal-local\.<br>The outline came back cut off, so this file has the 5 complete slides\./);
});
