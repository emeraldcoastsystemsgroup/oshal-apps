/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.6 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window). Draft with AI is the kernel's one chat window, so no request carries the sliders and no reply comes back to
 *   POST /chat. Through the COMPILED routes: the page's POST /draft/design keeps the person's sliders (an invalid design is
 *   refused); the concierge's propose-aero-draft (POST /draft) is checked against them exactly as a /chat reply's draft is
 *   (only its own fields move, in bounds, its declared direction agreeing, a named site and season held) and is offered
 *   only then; GET /draft gives it to that person alone; DELETE /draft and the next turn's sliders clear it; with no
 *   sliders sent no draft is offered. Red on 1.4.5: no /draft routes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...f) => { routes[`${m} ${p}`] = f[f.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const routes = require('../routes/aero-lab-routes.js');
test.after(() => { Module._load = original; });

const TIER1 = { ...routes.DEFAULT_DESIGN, area_m2: 0.52, battery_mass_kg: 0.4, pack_Wh_per_kg: 250, cell_eff: 0.227, latitude_deg: 47.6, day_of_year: 195 };
const adapter = { capabilities: async () => ({ capabilities: { hybrid: false }, bounds: null }), engineStatus: () => ({ present: false }) };

/** One router (one visit's memory) and a caller that answers each route as the named person. */
function lab() {
  const router = routes.createAeroLabRoutes({ adapter, ctx: {} });
  return async (person, key, body) => {
    const handler = router.routes[key];
    if (!handler) throw new Error(`no route ${key}`);
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; resolve(); return this; } };
    handler({ body, oidc: { user: { sub: person } } }, res);
    await done;
    return res;
  };
}

test('a draft is offered against the sliders the page sent, shown to that person alone, and cleared once applied', async () => {
  const call = lab();
  assert.equal((await call('p1', 'POST /draft/design', { design: TIER1 })).statusCode, 200);
  const offered = await call('p1', 'POST /draft', { draft: { battery_mass_kg: 0.5 }, moves: { battery_mass_kg: 'up' }, say: 'More battery for the night.', said: 'What battery would close this?' });
  assert.equal(offered.statusCode, 200, JSON.stringify(offered.body));
  assert.equal(offered.body.offered, true);
  assert.deepEqual(offered.body.changes, [{ field: 'battery_mass_kg', from: 0.4, to: 0.5, move: 'up' }]);
  const shown = (await call('p1', 'GET /draft')).body.draft;
  assert.deepEqual(shown.changes, offered.body.changes);
  assert.equal(shown.draft.area_m2, 0.52, 'an undrafted field keeps the person\'s value');
  assert.equal((await call('p2', 'GET /draft')).body.draft, null, 'another person sees no draft');
  await call('p1', 'DELETE /draft');
  assert.equal((await call('p1', 'GET /draft')).body.draft, null, 'applied, it is gone');
});

test('a draft whose numbers move against its advice, or out of bounds, is withheld with the reason', async () => {
  const call = lab();
  await call('p1', 'POST /draft/design', { design: TIER1 });
  const against = await call('p1', 'POST /draft', { draft: { battery_mass_kg: 0.3 }, moves: { battery_mass_kg: 'up' }, say: 'More battery.' });
  assert.equal(against.statusCode, 422);
  assert.equal(against.body.error, 'draft_withheld');
  assert.match(against.body.message, /No draft was offered: it would move battery_mass_kg down \(0\.4 to 0\.3\) while the advice moves it up/);
  const wild = await call('p1', 'POST /draft', { draft: { latitude_deg: 120 }, moves: { latitude_deg: 'up' }, say: 'Fly north.' });
  assert.equal(wild.statusCode, 422);
  assert.match(wild.body.message, /did not fit the design form/);
  assert.equal((await call('p1', 'GET /draft')).body.draft, null, 'nothing reaches the sliders');
});

test('a site and season the person names hold the draft', async () => {
  const call = lab();
  await call('p1', 'POST /draft/design', { design: TIER1 });
  const offered = await call('p1', 'POST /draft', { draft: { battery_mass_kg: 0.5 }, moves: { battery_mass_kg: 'up' }, say: 'More battery for October.', said: 'a craft that survives a cloudy day at 47N in October' });
  assert.equal(offered.statusCode, 200, JSON.stringify(offered.body));
  const shown = (await call('p1', 'GET /draft')).body.draft;
  assert.equal(shown.draft.day_of_year, 288, 'October is the mission, held by the route');
  assert.ok(shown.changes.some((change) => change.field === 'day_of_year' && change.to === 288), JSON.stringify(shown.changes));
});

test('with no sliders sent no draft is offered, a new turn clears an unapplied one, and an invalid design is refused', async () => {
  const call = lab();
  const none = await call('p1', 'POST /draft', { draft: { battery_mass_kg: 0.5 }, moves: { battery_mass_kg: 'up' } });
  assert.equal(none.statusCode, 409);
  assert.equal(none.body.error, 'no_design');
  await call('p1', 'POST /draft/design', { design: TIER1 });
  await call('p1', 'POST /draft', { draft: { battery_mass_kg: 0.5 }, moves: { battery_mass_kg: 'up' } });
  await call('p1', 'POST /draft/design', { design: { ...TIER1, battery_mass_kg: 0.45 } });
  assert.equal((await call('p1', 'GET /draft')).body.draft, null, 'the next turn starts from the sliders as they are');
  const bad = await call('p1', 'POST /draft/design', { design: { ...TIER1, wingspan_furlongs: 3 } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error, /unknown design field "wingspan_furlongs"/);
});
