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
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.html'), 'utf8');
const TIER1_NOTE = html.match(/key: 'tier1'[\s\S]*?note: '([^']*)'/)[1];

/** sendChat through the end of the code before addMsg, exactly as shipped (screenRecord included when present). */
function surfaceCode() {
  const start = page.indexOf('async function sendChat()');
  const end = page.indexOf('/** @description Append a chat bubble.');
  assert.ok(start > 0 && end > start, 'sendChat precedes addMsg in the surface');
  return page.slice(start, end);
}

/** Run the surface's sendChat once with a stub DOM; returns the body it posted to /chat. */
async function send(state, typed, dom = {}) {
  const els = { chatInput: { value: typed }, chatSend: {}, draftBox: { style: {} }, verdictCard: { textContent: '' }, runStatus: { textContent: '' }, ...dom };
  const posted = [];
  const api = async (method, url, body) => { posted.push({ method, url, body }); return { say: 'ok', draft: null }; };
  const run = new Function('state', '$', 'api', 'addMsg', 'showDraft', 'errText', surfaceCode() + '\nreturn sendChat();');
  await run(state, (id) => els[id], api, () => {}, () => {}, String);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, '/chat');
  return posted[0].body;
}

const baseState = () => ({ chat: [], busy: false, design: { battery_mass_kg: 0.4 } });

test('the loaded preset\'s recorded verdict and boundary travel with the question', async () => {
  const state = { ...baseState(), presetRecord: { name: 'Tier-1 sketch', note: TIER1_NOTE } };
  const body = await send(state, 'Smallest battery change that closes this?');
  assert.match(body.message, /^Smallest battery change that closes this\?\n\nWHAT THIS SCREEN SHOWS/);
  assert.match(body.message, /Recorded boundary: ~0\.694 kg battery is the smallest single change that closes/);
  assert.deepEqual(state.chat, [{ role: 'user', content: 'Smallest battery change that closes this?' }, { role: 'assistant', content: 'ok' }],
    'the conversation keeps what the person typed');
});

test('a verdict on screen travels with its run status; nothing recorded adds nothing', async () => {
  const state = { ...baseState(), verdictShown: true };
  const body = await send(state, 'Why not?', {
    verdictCard: { textContent: 'closed ✕  admissible ✕\n min SOC 0.0500  usable margin 0.9270' },
    runStatus: { textContent: 'evaluate done' },
  });
  assert.match(body.message, /Latest engine run on this screen \(evaluate done\): closed ✕ admissible ✕ min SOC 0\.0500 usable margin 0\.9270$/);
  assert.equal((await send(baseState(), 'Hello')).message, 'Hello');
});

test('the real POST /chat route puts the recorded boundary in the aero-designer prompt', async () => {
  const body = await send({ ...baseState(), presetRecord: { name: 'Tier-1 sketch', note: TIER1_NOTE } }, 'Close it');
  const STUBS = {
    express: { Router: () => { const routes = {}; const add = (m) => (p, ...f) => { routes[`${m} ${p}`] = f[f.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} }; } },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.call(this, request, ...rest);
  };
  try {
    const routes = require('../routes/aero-lab-routes.js');
    const prompts = [];
    const ctx = { orchestrator: { processMessage: async (_id, prompt) => { prompts.push(prompt); return { response: '{"say":"ok","draft":null}' }; } } };
    const adapter = { capabilities: async () => ({ capabilities: { hybrid: false }, bounds: null }), engineStatus: () => ({ present: false }) };
    const router = routes.createAeroLabRoutes({ adapter, ctx });
    await new Promise((resolve) => {
      const res = { status() { return this; }, json() { resolve(); return this; } };
      router.routes['POST /chat']({ body: { ...body, design: { ...routes.DEFAULT_DESIGN, battery_mass_kg: 0.4 } }, oidc: { user: { sub: 'p1' } } }, res);
    });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Designer: Close it\n\nWHAT THIS SCREEN SHOWS[\s\S]*~0\.694 kg battery is the smallest single change that closes/);
  } finally { Module._load = original; }
});
