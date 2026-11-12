/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.56.0, T6: Find jobs' searches follow the account. Two browsers (two devices) of one person go through the compiled route into one real per-person file: the last search and a named search made on one are there on the other, a browser's searches from before 1.56.0 are handed to an account that holds none and never over one that does, another person sees nothing, a read makes no folder, and the refusals (no person, unknown operation, a save with no name) change nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { create, account } = require('../tools/career-search-memory.js');

function loadRoutes() {
  const Module = require('node:module'), load = Module._load;
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };
  const kernel = { createChildLogger: () => quiet, getTrustedServiceUserSub: (req) => req.sub || null, callerSub: () => null };
  Module._load = function stubbed(request, ...rest) {
    if (request.startsWith('@/')) return new Proxy(kernel, { get: (t, k) => (k in t ? t[k] : k === '__esModule' ? true : () => () => {}) });
    // The route never opens a database; the gate's Career step has no driver on its module path.
    if (request === 'better-sqlite3') return function NoDatabase() { throw new Error('no database in this test'); };
    return load.call(this, request, ...rest);
  };
  try { return require('../routes/career-search-memory-routes.js'); } finally { Module._load = load; }
}

function harness(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-search-memory-'));
  const prior = process.env.JOBHUNTER_STORE_ROOT;
  process.env.JOBHUNTER_STORE_ROOT = root;
  t.after(() => { if (prior === undefined) delete process.env.JOBHUNTER_STORE_ROOT; else process.env.JOBHUNTER_STORE_ROOT = prior; rmSync(root, { recursive: true, force: true }); });
  const routes = {};
  loadRoutes().registerCareerSearchMemoryRoutes({ get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } });
  /** One call through the route as the kernel hands it: the person's subject and a JSON body. */
  async function call(sub, method, body) {
    const sent = { status: 200, body: null };
    const res = { status(code) { sent.status = code; return this; }, json(value) { sent.body = value; return this; } };
    await routes[method + ' /search-memory']({ sub, body, params: {}, query: {} }, res);
    return sent;
  }
  /** A browser of this person: its own storage, asking the account through the route. */
  function browser(sub) {
    const data = new Map(), storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    const memory = create(storage, 'default:' + sub);
    const request = async (method, body) => { const r = await call(sub, method, body); if (r.status !== 200) throw new Error(r.body?.message || r.body?.error); return r.body; };
    return { memory, link: account(memory, request) };
  }
  return { root, call, browser };
}

const local = { near: 'a regional federal hub, FL', radius_miles: '35', remote: '0', min_pay: '140000', pay_period: 'year', view: 'map' };

test('a search remembered and saved on one device is there on the next device the person signs in on', async (t) => {
  const { call, browser, root } = harness(t);
  const empty = await call('alice', 'GET');
  assert.deepEqual([empty.status, empty.body], [200, { last: null, saved: [], stored: false }]);
  assert.equal(existsSync(join(root, 'default')), false, 'reading makes no folder');

  const laptop = browser('alice');
  assert.equal(await laptop.link.pull(), 'empty');
  laptop.memory.remember(local); await laptop.link.send('remember', { criteria: local });
  await laptop.link.send('save', { name: 'Local IT', criteria: { ...local, unexpected: 'dropped' } });
  const phone = browser('alice');
  assert.equal(phone.memory.last(), null, 'the phone starts with nothing of its own');
  assert.equal(await phone.link.pull(), 'account');
  assert.deepEqual(phone.memory.last(), local, 'the phone opens on the laptop\'s last search');
  assert.deepEqual(phone.memory.list().map((row) => [row.name, row.criteria]), [['Local IT', local]], 'and has its saved search, cleaned');

  // The phone removes it; the laptop's next visit sees that.
  await phone.link.send('remove', { id: phone.memory.list()[0].id });
  assert.equal(await laptop.link.pull(), 'account');
  assert.deepEqual(laptop.memory.list(), []);
  assert.deepEqual(laptop.memory.last(), local);

  const file = (await import('node:child_process')).execFileSync('find', [root, '-name', 'job-search-memory.json']).toString().trim();
  assert.ok(file, 'kept in the person\'s own Career folder');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /unexpected/);

  const bob = await call('bob', 'GET');
  assert.deepEqual(bob.body, { last: null, saved: [], stored: false }, 'another person sees none of it');
});

test('a browser\'s searches from before the account kept them are handed over once, never over the account\'s own', async (t) => {
  const { browser } = harness(t);
  const old = browser('carol');
  old.memory.save('Older', { near: '32542' }); old.memory.save('Newer', { near: '32578' }); old.memory.remember(local);
  assert.equal(await old.link.pull(), 'adopted');
  const other = browser('carol');
  assert.equal(await other.link.pull(), 'account');
  assert.deepEqual(other.memory.list().map((row) => row.name), ['Newer', 'Older'], 'the order is kept');
  assert.deepEqual(other.memory.last(), local);

  const stale = browser('carol');
  stale.memory.save('Stale', { near: '99999' });
  assert.equal(await stale.link.pull(), 'account', 'the account holds a copy, so it wins');
  assert.deepEqual(stale.memory.list().map((row) => row.name), ['Newer', 'Older']);
  const again = await stale.link.send('adopt', { state: { saved: [{ id: 'x', name: 'Stale', criteria: {} }] } });
  assert.deepEqual(again.saved.map((row) => row.name), ['Newer', 'Older'], 'adopt never lands on an account that holds a copy');
});

test('the refusals change nothing: no person, an unknown operation, a save with no name', async (t) => {
  const { call } = harness(t);
  assert.equal((await call(null, 'GET')).status, 401);
  assert.equal((await call(null, 'POST', { op: 'remember', criteria: local })).status, 401);
  const unknown = await call('dave', 'POST', { op: 'drop-everything' });
  assert.deepEqual([unknown.status, unknown.body.error], [400, 'unknown_operation']);
  const nameless = await call('dave', 'POST', { op: 'save', name: '  ', criteria: local });
  assert.equal(nameless.status, 400); assert.match(nameless.body.message, /name/);
  assert.deepEqual((await call('dave', 'GET')).body, { last: null, saved: [], stored: false });
});

test('Find jobs reads the account\'s copy before its first search, and Save and Delete go to the account', () => {
  const page = readFileSync(new URL('../tools/career-search.html', import.meta.url), 'utf8');
  const start = page.slice(page.indexOf('async function startSearch(){'));
  const pull = start.indexOf('accountMemory.pull()'), firstFill = start.indexOf('fill(explicit ?');
  assert.ok(pull > 0 && firstFill > pull, 'the account is read before the criteria are filled');
  assert.match(page, /accountMemory\.send\('save', \{ name, criteria: value \}\)/);
  assert.match(page, /accountMemory\.send\('remove', \{ id \}\)/);
  assert.match(page, /accountMemory\?\.send\('remember', \{ criteria: value \}\)/);
  assert.match(page, /fetch\('\/api\/career-hunter\/search-memory'/);
});
