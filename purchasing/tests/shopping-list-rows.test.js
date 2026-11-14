/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-05 (shop-lists, D): the List never filled because no on-screen control wrote to it. The List screen's Add an item field posts the text as a free-text entry, and each row ticks off and steps its quantity through the new POST /lists/:listId/items/:itemId, run here against the COMPILED route under the native writer admission: a tick sets status 'done' (checkout already takes only pending lines), unticking puts it back, a quantity clamps to the line cap, another shopper's row is refused with nothing changed, and an empty change is a 400. The manifest exposes exactly one tile, List, as the default view.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Regression (trial delivery 2026-11-06): taking the Assistant, Browse and Deals tiles off made Home (home-experience) component_unavailable for its holders, because Home required those surfaces, and left purchasing's own plan-purchase accept naming a tile that no longer existed, which makes the kernel's Home plan refuse the manifest. Every surface any store package composes from purchasing, and every surface purchasing's accepts name, must be a declared purchasing tile.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Shopping 1.5.0: Order replaces the rail-only Checkout button on the List screen; it is enabled while an item is left to buy.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, admittedPool, callAdmitted, loadRoutes, authed, call } = require('./shopping-routes-harness');

const ROOT = path.resolve(__dirname, '..', '..');
const yaml = require(path.join(ROOT, 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'purchasing', 'oshal-app.yaml'), 'utf8'));
const page = fs.readFileSync(path.join(ROOT, 'purchasing', 'tools', 'shopping-dashboard.html'), 'utf8');

function seed() {
  return { lists: [{ list_id: 'list-a', user_sub: 'shopper-a', name: 'My List', status: 'active' }],
    items: [{ item_id: 'item-1', list_id: 'list-a', user_sub: 'shopper-a', title: 'milk', quantity: 1, status: 'pending' },
      { item_id: 'item-2', list_id: 'list-a', user_sub: 'shopper-a', title: 'eggs', quantity: 1, status: 'removed' }] };
}
async function update(data, sub, itemId, body) {
  const pool = admittedPool(fakePool(data));
  const { handlers } = loadRoutes({ pool });
  return callAdmitted(handlers, pool, 'post', '/lists/:listId/items/:itemId', authed(sub, { params: { listId: 'list-a', itemId }, body }));
}

test('a tick sets the row done and unticking puts it back', async () => {
  const data = seed();
  let res = await update(data, 'shopper-a', 'item-1', { checked: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(data.items[0].status, 'done');
  res = await update(data, 'shopper-a', 'item-1', { checked: false });
  assert.equal(data.items[0].status, 'pending');
});

test('the stepper sets the quantity, clamped to whole numbers within the line cap', async () => {
  const data = seed();
  assert.equal((await update(data, 'shopper-a', 'item-1', { quantity: 3 })).statusCode, 200);
  assert.equal(data.items[0].quantity, 3);
  await update(data, 'shopper-a', 'item-1', { quantity: 0 });
  assert.equal(data.items[0].quantity, 1, 'never below one');
  await update(data, 'shopper-a', 'item-1', { quantity: 5000 });
  assert.ok(data.items[0].quantity <= 10 && data.items[0].quantity >= 1, `clamped, got ${data.items[0].quantity}`);
});

test('another shopper, a removed row and an empty change are refused with nothing changed', async () => {
  const data = seed();
  assert.equal((await update(data, 'shopper-b', 'item-1', { checked: true })).statusCode, 404);
  assert.equal(data.items[0].status, 'pending');
  assert.equal((await update(data, 'shopper-a', 'item-2', { checked: false })).statusCode, 404, 'a removed row stays removed');
  assert.equal(data.items[1].status, 'removed');
  assert.equal((await update(data, 'shopper-a', 'item-1', {})).statusCode, 400);
});

test('List is the one tile and the default view, and its Add an item field writes the text to the list', () => {
  assert.deepEqual(manifest.ui.static.map((t) => [t.toolName, t.label, t.iframeUrl]), [['shop-lists', 'List', '/api/purchasing/dashboard?view=lists']]);
  assert.equal(manifest.ribbon.defaultView, 'shop-lists');
  assert.equal(manifest.ribbon.hideChatPanel, undefined, 'the shell concierge is the one assistant entry');
  assert.match(page, /<input id="add-title" type="text" maxlength="300" placeholder="Add an item"/);
  assert.match(page, /api\('\/lists\/' \+ listId \+ '\/items', \{ method: 'POST', body: JSON\.stringify\(\{ title, quantity: 1 \}\) \}\)/);
  assert.match(page, /updateRow\(i, \{ checked: box\.checked \}\)/);
  assert.match(page, /updateRow\(i, \{ quantity: qty \+ 1 \}\)/);
  assert.match(page, /\$\('#order'\)\.disabled = !pending\.length;/, 'Order is ready while something is left to buy (1.5.0: it needs no rail)');
  assert.match(page, /font-size: 16px/, 'the field does not zoom on a phone');
});

test('every purchasing surface the store composes, and every accept, names a declared purchasing tile', () => {
  const tiles = new Set(manifest.ui.static.map((t) => t.toolName));
  for (const accept of manifest.integrations?.accepts || []) assert.ok(tiles.has(accept.surface), `accepts ${accept.id} lands on ${accept.surface}`);
  const composed = [];
  for (const dir of fs.readdirSync(ROOT)) {
    const file = path.join(ROOT, dir, 'oshal-app.yaml');
    if (!fs.existsSync(file)) continue;
    const other = yaml.load(fs.readFileSync(file, 'utf8'));
    for (const s of other?.experience?.surfaces || []) if (s.app === 'purchasing') composed.push(`${dir}:${s.surface}`);
  }
  assert.ok(composed.length > 0, 'Home composes Shopping');
  for (const ref of composed) assert.ok(tiles.has(ref.split(':')[1]), `${ref} is a declared purchasing tile`);
});

test('the Assistant address shows List', async () => {
  const { handlers } = loadRoutes({ pool: fakePool({}) });
  const res = await call(handlers, 'get', '/chat', authed('shopper-a', {}));
  assert.match(String(res.body), /shopping-dashboard\.html$/, 'GET /chat serves the List page');
  const route = fs.readFileSync(path.join(ROOT, 'purchasing', 'routes', 'purchasing-routes.js'), 'utf8');
  assert.doesNotMatch(route, /res\.redirect\(|setHeader\('Location'/, 'the native bridge drops redirects');
});

test('Shopping preferences edit in place and save on change', async () => {
  assert.match(page, /<details id="prefs" class="prefs">/);
  assert.match(page, /\$\('#pref-budget'\)\.addEventListener\('change', \(\) => \{ const n = Math\.round\(Number\(\$\('#pref-budget'\)\.value\)\); if \(Number\.isFinite\(n\) && n >= 0\) savePref\(\{ budgetMonthly: n \}\); \}\);/);
  assert.match(page, /savePref\(\{ dietary: /);
  assert.match(page, /api\('\/profile', \{ method: 'POST', body: JSON\.stringify\(body\) \}\)/);
  assert.match(page, /\$\('#pref-retailer-row'\)\.classList\.toggle\('hidden', !RAIL\);/, 'no store row without a retail rail');
  // A shop_profile double that enforces the table's NOT NULL columns the way Postgres and the native interpreter do.
  const rows = new Map();
  const NOT_NULL = { 3: 'dietary', 4: 'brands_love', 5: 'brands_avoid', 6: 'preferred_retailer', 10: 'onboarded' };
  const profilePool = admittedPool({ query: async (text, params = []) => {
    if (/^\s*UPDATE shop_profile SET/.test(text)) {
      const row = rows.get(params[0]); if (!row) return { rows: [], rowCount: 0 };
      if (params[8] !== null) row.budget_monthly = params[8];
      if (params[3] !== null) row.dietary = params[3];
      return { rows: [row], rowCount: 1 };
    }
    if (/^\s*INSERT INTO shop_profile/.test(text)) {
      for (const [i, col] of Object.entries(NOT_NULL)) if (params[i] === null || params[i] === undefined) throw new Error(`null value in column "${col}" violates not-null constraint`);
      const row = { user_sub: params[0], dietary: params[3], budget_monthly: params[8] }; rows.set(params[0], row); return { rows: [row], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } });
  const { handlers } = loadRoutes({ pool: profilePool });
  const save = (body) => callAdmitted(handlers, profilePool, 'post', '/profile', authed('shopper-a', { body }));
  let res = await save({ budgetMonthly: 250 });
  assert.equal(res.statusCode, 200, `a first partial save succeeds: ${JSON.stringify(res.body)}`);
  assert.equal(rows.get('shopper-a').budget_monthly, 250);
  res = await save({ dietary: ['no peanuts'] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([rows.get('shopper-a').budget_monthly, rows.get('shopper-a').dietary], [250, ['no peanuts']], 'a later save keeps the budget');
  const route = fs.readFileSync(path.join(ROOT, 'purchasing', 'routes', 'purchasing-routes.js'), 'utf8');
  assert.doesNotMatch(route.slice(route.indexOf("router.post('/profile'"), route.indexOf("router.get('/cart'")), /ON CONFLICT \(/);
});
