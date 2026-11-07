/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (eats-browse, eats-concierge): the delivery address typed on Order Food came back empty on every open.
 *   Two causes, both guarded here. (1) A diner's FIRST POST /profile sent NULL for dietary and favorite_cuisines, which are NOT NULL, and the
 *   native store refused it ("invalid: SQL NOT NULL constraint failed", seen on the trial 2026-11-06), so even Use location never saved an address.
 *   The compiled route over a pool that refuses NULL in those columns the way the store does: a first save sends empty lists and sticks, a later
 *   save of only the address keeps the saved diet. A second save of an existing row failed the same way (the proposed row is checked before ON
 *   CONFLICT), so the row always carries lists and the update keeps the saved ones through $9/$10. (2) The page saved an address only from Use location; a typed address used by a search or a
 *   concierge turn is now saved once (the page's own rememberAddress and search, run over a recording fetch), and the boot read never saves.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, loadRoutes, authed, call } = require('./eats-routes-harness.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'eats-app.html'), 'utf8');

/**
 * The harness pool with the profile upsert answered the way the store answers it: the proposed row is checked for NULL in
 * the NOT NULL list columns BEFORE ON CONFLICT (the trial refused a second save of an existing row exactly so, 2026-11-06),
 * and the update keeps the saved lists unless $9/$10 name new ones.
 */
function strictPool(seed) {
  const pool = fakePool(seed);
  const query = pool.query.bind(pool);
  pool.query = async (text, p = []) => {
    const s = String(text).trim();
    if (!/^INSERT INTO eats_profile/.test(s)) return query(text, p);
    pool.sql.push({ text: s, params: p });
    if (p[2] === null || p[2] === undefined || p[3] === null || p[3] === undefined) throw new Error('invalid: SQL NOT NULL constraint failed');
    const old = pool.tables.profiles[p[0]];
    const row = old
      ? { ...old, display_name: p[1] ?? old.display_name, dietary: p[8] ?? old.dietary, favorite_cuisines: p[9] ?? old.favorite_cuisines,
          default_address: p[4] ?? old.default_address, budget_per_order: p[5] ?? old.budget_per_order, notes: p[6] ?? old.notes, onboarded: Boolean(p[7]) || old.onboarded }
      : { user_sub: p[0], display_name: p[1], dietary: p[2], favorite_cuisines: p[3], default_address: p[4], budget_per_order: p[5], notes: p[6], onboarded: Boolean(p[7]) };
    pool.tables.profiles[p[0]] = row;
    return { rows: [row], rowCount: 1 };
  };
  return pool;
}

test('a diner\'s first saved address sticks: the new profile row carries empty lists, not NULL', async () => {
  const pool = strictPool();
  const { handlers } = loadRoutes({ pool });
  const saved = await call(handlers, 'post', '/profile', authed('diner-new', { body: { defaultAddress: '1 Synthetic Way, Pensacola, FL' } }));
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.profile.default_address, '1 Synthetic Way, Pensacola, FL');
  const read = await call(handlers, 'get', '/profile', authed('diner-new'));
  assert.equal(read.body.profile.default_address, '1 Synthetic Way, Pensacola, FL', 'the next open reads it back');
});

test('a second save of only the address succeeds and keeps the diet the diner already saved', async () => {
  const pool = strictPool({ profiles: { 'diner-a': { user_sub: 'diner-a', dietary: ['vegetarian'], favorite_cuisines: ['thai'], default_address: 'Old St', onboarded: true } } });
  const { handlers } = loadRoutes({ pool });
  const saved = await call(handlers, 'post', '/profile', authed('diner-a', { body: { defaultAddress: 'New St' } }));
  assert.equal(saved.statusCode, 200);
  assert.deepEqual([saved.body.profile.default_address, saved.body.profile.dietary, saved.body.profile.favorite_cuisines], ['New St', ['vegetarian'], ['thai']]);
  const insert = pool.sql.filter((q) => /^INSERT INTO eats_profile/.test(q.text)).pop();
  assert.deepEqual([insert.params[2], insert.params[3]], [[], []], 'the proposed row never carries NULL lists');
  assert.deepEqual([insert.params[8], insert.params[9]], [null, null], 'the update is told to keep the saved lists');
  assert.match(insert.text, /dietary=COALESCE\(\$9, eats_profile\.dietary\)/);
  assert.match(insert.text, /favorite_cuisines=COALESCE\(\$10, eats_profile\.favorite_cuisines\)/);
  const named = await call(handlers, 'post', '/profile', authed('diner-a', { body: { dietary: ['vegan'] } }));
  assert.deepEqual([named.body.profile.dietary, named.body.profile.default_address], [['vegan'], 'New St'], 'a named list still replaces the saved one');
});

/** The page's own address functions, run over recording doubles. */
function pageFunctions(profile) {
  const pick = (name) => { const i = HTML.indexOf(name); const end = HTML.indexOf('\n}\n', i) + 3; assert.ok(i > 0, name); return HTML.slice(i, end); };
  const posts = [], els = {};
  const $ = (sel) => (els[sel] = els[sel] || { value: '', textContent: '', hidden: false, innerHTML: '', style: {}, classList: { toggle() {}, remove() {} } });
  const state = { profile };
  const src = pick('async function rememberAddress(') + pick('function showHero(');
  const run = new Function('$', 'state', 'API', 'postJson', `${src}; return { rememberAddress, showHero };`);
  const api = run($, state, '/api/eats', async (url, body) => { posts.push({ url, body }); return { httpStatus: 200, profile: {} }; });
  return { ...api, posts, state, els };
}

test('the page saves a typed address once, and never an empty or unchanged one', async () => {
  const p = pageFunctions({ default_address: '' });
  assert.equal(await p.rememberAddress('  12 Typed Rd, Destin, FL '), true);
  assert.deepEqual(p.posts, [{ url: '/api/eats/profile', body: { defaultAddress: '12 Typed Rd, Destin, FL' } }]);
  assert.equal(p.els['.location-title'].hidden, true, 'with an address saved the first-visit headline goes');
  assert.equal(await p.rememberAddress('12 Typed Rd, Destin, FL'), false, 'the same address is not written again');
  assert.equal(await p.rememberAddress('   '), false);
  assert.equal(p.posts.length, 1);
});

test('a search the person asks for and a concierge turn save the address; the boot read does not', () => {
  const search = HTML.slice(HTML.indexOf('async function search('), HTML.indexOf('\n}\n', HTML.indexOf('async function search(')));
  assert.match(search, /if \(!readOnly\) rememberAddress\(address\);/);
  const chat = HTML.slice(HTML.indexOf('async function sendChat('), HTML.indexOf('\n}\n', HTML.indexOf('async function sendChat(')));
  assert.match(chat, /rememberAddress\(\$\('#address'\)\.value\);/);
  assert.match(HTML, /await search\('', false, true\);/, 'boot still reads with readOnly');
});
