/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Draft with AI carries what the screen records. The surface's own sendChat (and the
 *   code it calls), run as shipped with a stub DOM, must send the loaded preset's recorded verdict and boundary and the
 *   latest verdict card, and the real compiled POST /chat route must put them in the aero-designer prompt. Before, only
 *   the sliders went, and the concierge proposed 0.5 kg for the Tier-1 sketch whose record on the same page says ~0.694 kg
 *   is the smallest battery that closes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.6 (lane CHATCORE3): Draft with AI is the kernel's one chat window, so what the
 *   screen records travels in the screen the window is told of (aeroScreen), not appended to a message for POST /chat. The
 *   surface's own aeroScreen, screenRecord, beforeTurn and afterTurn, run as shipped with a stub DOM: the screen carries
 *   the sliders field by field, the loaded preset's recorded verdict and boundary and the latest verdict with its run
 *   status; beforeTurn sends the sliders to POST /draft/design and hands the window that screen; afterTurn shows only the
 *   changed fields of the draft the concierge offered (GET /draft) and nothing when none was offered.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.html'), 'utf8');
const TIER1_NOTE = html.match(/key: 'tier1'[\s\S]*?note: '([^']*)'/)[1];
const FIELDS = [{ k: 'battery_mass_kg', label: 'Battery mass', unit: 'kg' }, { k: 'aspect_ratio', label: 'Aspect ratio', unit: '—' }];

/** aeroScreen through screenRecord, exactly as shipped (beforeTurn and afterTurn between them). */
function surfaceCode() {
  const start = page.indexOf('function aeroScreen()');
  const end = page.indexOf('// screen-record:end');
  assert.ok(start > 0 && end > start, 'aeroScreen precedes the screen record in the surface');
  return page.slice(start, end);
}

/** Run the surface's window hooks once with a stub DOM; returns them, what they posted and the drafts they showed. */
function surface(state, dom = {}, answers = {}) {
  const els = { verdictCard: { textContent: '' }, runStatus: { textContent: '' }, draftBox: { scrollIntoView() {} }, ...dom };
  const posted = [];
  const shown = [];
  const api = async (method, url, body) => { posted.push({ method, url, body }); return answers[`${method} ${url}`] || {}; };
  const win = {};
  const doc = { body: { dataset: { view: dom.view || 'sizing' } } };
  const run = new Function('state', '$', 'api', 'showDraft', 'errText', 'D', 'window', 'document', surfaceCode() + '\nreturn { aeroScreen, beforeTurn, afterTurn };');
  const hooks = run(state, (id) => els[id], api, (changes) => shown.push(changes), String, { fields: FIELDS }, win, doc);
  return { ...hooks, posted, shown, win };
}

const baseState = () => ({ busy: false, design: { battery_mass_kg: 0.4, aspect_ratio: 12 } });

test('the screen the window is told of carries the sliders and the loaded preset\'s recorded verdict and boundary', () => {
  const screen = surface({ ...baseState(), presetRecord: { name: 'Tier-1 sketch', note: TIER1_NOTE } }).aeroScreen();
  assert.deepEqual([screen.title, screen.tab], ['Aero Lab: Sizing & flight envelope', 'Sizing & flight envelope']);
  const lines = screen.text.split('\n');
  assert.deepEqual(lines.slice(0, 3), ['# CURRENT DESIGN (the sliders; a draft starts from these)', 'battery_mass_kg = 0.4 kg (Battery mass)', 'aspect_ratio = 12 (Aspect ratio)']);
  assert.ok(lines.some((line) => /^WHAT THIS SCREEN SHOWS/.test(line)), screen.text);
  assert.match(screen.text, /Recorded boundary: ~0\.694 kg battery is the smallest single change that closes/);
});

test('a verdict on screen travels with its run status; nothing recorded adds nothing', () => {
  const shown = surface({ ...baseState(), verdictShown: true }, {
    verdictCard: { textContent: 'closed ✕  admissible ✕\n min SOC 0.0500  usable margin 0.9270' },
    runStatus: { textContent: 'evaluate done' },
  }).aeroScreen();
  assert.match(shown.text, /Latest engine run on this screen \(evaluate done\): closed ✕ admissible ✕ min SOC 0\.0500 usable margin 0\.9270$/);
  assert.equal(surface(baseState()).aeroScreen().text.split('\n').length, 3, 'the sliders alone');
  assert.equal(surface(baseState(), { view: 'vehicle' }).aeroScreen().tab, 'Vehicle record & build package');
});

test('beforeTurn sends the sliders and hands the window the screen; afterTurn shows only an offered draft\'s changes', async () => {
  const changes = [{ field: 'battery_mass_kg', from: 0.4, to: 0.6, move: 'up' }];
  const hooks = surface(baseState(), {}, { 'GET /draft': { draft: { say: 'More battery.', draft: { battery_mass_kg: 0.6 }, changes } } });
  const context = await hooks.beforeTurn();
  assert.deepEqual(hooks.posted[0], { method: 'POST', url: '/draft/design', body: { design: { battery_mass_kg: 0.4, aspect_ratio: 12 } } });
  assert.deepEqual(context, { screen_state: hooks.aeroScreen() });
  await hooks.afterTurn();
  assert.deepEqual(hooks.shown, [changes]);
  const none = surface(baseState(), {}, { 'GET /draft': { draft: null } });
  await none.afterTurn();
  assert.deepEqual(none.shown, [], 'nothing offered, nothing shown');
});
