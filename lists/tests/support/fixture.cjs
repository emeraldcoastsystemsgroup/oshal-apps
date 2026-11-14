/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stand-ins for the Lists suites (1.0.0). memoryPool answers exactly the statements routes/lists-store.mjs issues (anything else throws), records every statement, and applies the native kernel's admission rule: while a GET runs, a statement that is not a query is refused with the kernel's own words. app() mounts the package's real router on the toolchain's Express with a stand-in for the signed-in person (a cookie), so the routes, the rules and the store are the package's own.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { AsyncLocalStorage } = require('node:async_hooks');

const PACKAGE = path.resolve(__dirname, '..', '..');
const STORE = path.resolve(PACKAGE, '..');
/** The native host's refusal of a write under read admission, verbatim (crates/packages/src/sql_transaction.rs). */
const WRITER_REFUSAL = 'SQL mutation requires original writer admission';

/** @description The store toolchain's node_modules, or a failed assertion naming the command that installs it. @returns {string} The folder. */
function toolchain() {
  const home = path.join(process.env.STORE_CI_TOOLCHAIN || path.join(STORE, 'scripts', 'toolchain'), 'node_modules');
  if (!fs.existsSync(path.join(home, 'express'))) throw new Error('BLOCKED: the store toolchain is not installed (npm ci --prefix scripts/toolchain)');
  return home;
}

/** @description One module of the store toolchain. @param {string} name The module. @returns {*} Its exports. */
function dependency(name) {
  return Module.createRequire(path.join(toolchain(), 'fixture.cjs'))(name);
}

/** @description Import one of the package's ESM route modules, with `express` resolved from the toolchain. @param {string} file Under routes/. @returns {Promise<object>} The module. */
async function load(file) {
  const home = path.join(toolchain(), 'express');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function resolveExpress(request, ...rest) { return resolve.call(this, request === 'express' ? home : request, ...rest); };
  try { return await import(pathToFileURL(path.join(PACKAGE, 'routes', file)).href); } finally { Module._resolveFilename = resolve; }
}

const rows = (list) => ({ rows: list.map((row) => ({ ...row })), rowCount: list.length });
const changed = (n) => ({ rows: [], rowCount: n });

/** @description The statements of routes/lists-store.mjs over two in-memory tables. @param {{lists: object[], items: object[]}} t The tables. @returns {Array<[RegExp, Function]>} Matchers and their answers. */
function statements(t) {
  const list = (p) => t.lists.filter((r) => r.user_sub === p[0] && r.id === p[1]);
  const item = (p) => t.items.filter((r) => r.user_sub === p[0] && r.id === p[1]);
  const set = (found, patch) => { found.forEach((row) => Object.assign(row, patch)); return changed(found.length); };
  return [
    [/^SELECT id, name, name_key, position, open_count, done_count, created_at, updated_at FROM lists_lists WHERE user_sub = \$1$/,
      (p) => rows(t.lists.filter((r) => r.user_sub === p[0]))],
    [/^INSERT INTO lists_lists \(id, user_sub, name, name_key, position, open_count, done_count, created_at, updated_at\) VALUES \(\$1, \$2, \$3, \$4, \$5, 0, 0, \$6, \$7\)$/,
      (p) => {
        if (t.lists.some((r) => r.id === p[0])) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        t.lists.push({ id: p[0], user_sub: p[1], name: p[2], name_key: p[3], position: p[4], open_count: 0, done_count: 0, created_at: p[5], updated_at: p[6] });
        return changed(1);
      }],
    [/^UPDATE lists_lists SET name = \$3, name_key = \$4, updated_at = \$5 WHERE user_sub = \$1 AND id = \$2$/, (p) => set(list(p), { name: p[2], name_key: p[3], updated_at: p[4] })],
    [/^UPDATE lists_lists SET open_count = \$3, done_count = \$4, updated_at = \$5 WHERE user_sub = \$1 AND id = \$2$/, (p) => set(list(p), { open_count: p[2], done_count: p[3], updated_at: p[4] })],
    [/^DELETE FROM lists_lists WHERE user_sub = \$1 AND id = \$2$/, (p) => { const n = list(p).length; t.lists = t.lists.filter((r) => !(r.user_sub === p[0] && r.id === p[1])); return changed(n); }],
    [/^SELECT id, list_id, title, done, note, quantity, due_on, position, created_at, updated_at, done_at FROM lists_items WHERE user_sub = \$1 AND list_id = \$2$/,
      (p) => rows(t.items.filter((r) => r.user_sub === p[0] && r.list_id === p[1]))],
    [/^INSERT INTO lists_items \(id, user_sub, list_id, title, done, note, quantity, due_on, position, created_at, updated_at\) VALUES \(\$1, \$2, \$3, \$4, false, \$5, \$6, \$7, \$8, \$9, \$10\)$/,
      (p) => {
        if (t.items.some((r) => r.id === p[0])) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        t.items.push({ id: p[0], user_sub: p[1], list_id: p[2], title: p[3], done: false, note: p[4], quantity: p[5], due_on: p[6], position: p[7], created_at: p[8], updated_at: p[9], done_at: null });
        return changed(1);
      }],
    [/^UPDATE lists_items SET title = \$3, note = \$4, quantity = \$5, due_on = \$6, updated_at = \$7 WHERE user_sub = \$1 AND id = \$2$/, (p) => set(item(p), { title: p[2], note: p[3], quantity: p[4], due_on: p[5], updated_at: p[6] })],
    [/^UPDATE lists_items SET done = \$3, done_at = \$4, position = \$5, updated_at = \$6 WHERE user_sub = \$1 AND id = \$2$/, (p) => set(item(p), { done: p[2], done_at: p[3], position: p[4], updated_at: p[5] })],
    [/^UPDATE lists_items SET position = \$3, updated_at = \$4 WHERE user_sub = \$1 AND id = \$2$/, (p) => set(item(p), { position: p[2], updated_at: p[3] })],
    [/^DELETE FROM lists_items WHERE user_sub = \$1 AND id = \$2$/, (p) => { const n = item(p).length; t.items = t.items.filter((r) => !(r.user_sub === p[0] && r.id === p[1])); return changed(n); }],
    [/^DELETE FROM lists_items WHERE user_sub = \$1 AND list_id = \$2 AND done = \$3$/,
      (p) => { const before = t.items.length; t.items = t.items.filter((r) => !(r.user_sub === p[0] && r.list_id === p[1] && r.done === p[2])); return changed(before - t.items.length); }],
    [/^DELETE FROM lists_items WHERE user_sub = \$1 AND list_id = \$2$/,
      (p) => { const before = t.items.length; t.items = t.items.filter((r) => !(r.user_sub === p[0] && r.list_id === p[1])); return changed(before - t.items.length); }],
  ];
}

/**
 * @description An in-memory pool for the Lists store. `mode()` names the admission of the request in flight
 * ('read' for a GET); a write under read admission is refused before it reaches the tables and recorded in `refused`.
 * @param {() => (string|undefined)} [mode] The admission of the request in flight.
 * @returns {{tables: object, sql: string[], refused: string[], query: Function}} The pool.
 */
function memoryPool(mode = () => undefined) {
  const tables = { lists: [], items: [] };
  const table = statements(tables);
  const pool = {
    tables, sql: [], refused: [],
    async query(text, values = []) {
      const statement = String(text && typeof text === 'object' ? text.text : text).trim().replace(/\s+/g, ' ');
      const params = text && typeof text === 'object' && text.values ? text.values : values;
      pool.sql.push(statement);
      if (mode() === 'read' && !/^SELECT\b/i.test(statement)) { pool.refused.push(statement.slice(0, 80)); throw new Error(`refused: ${WRITER_REFUSAL}`); }
      const hit = table.find(([shape]) => shape.test(statement));
      if (!hit) throw new Error(`the memory pool has no answer for: ${statement.slice(0, 120)}`);
      return hit[1](params);
    },
  };
  return pool;
}

/**
 * @description The package's real router on the toolchain's Express over loopback. The person is whoever the `person`
 * cookie names (no cookie: nobody is signed in). A GET runs under read admission, every other method as a writer.
 * @param {{pool?: object, shopping?: Function, clock?: () => Date}} [options] A pool (default: memoryPool), a stand-in for Shopping's routes, a clock.
 * @returns {Promise<object>} base, pool, call(method, route, body, person), close().
 */
async function app(options = {}) {
  const express = dependency('express');
  const admission = new AsyncLocalStorage();
  const pool = options.pool || memoryPool(() => admission.getStore());
  const { createListsRoutes } = await load('lists-routes.mjs');
  const router = createListsRoutes({ pool, appPackageDir: PACKAGE }, options.clock ? { now: options.clock } : {});
  const server = express();
  server.use(express.json());
  server.get('/shared/ui/:kind/:file', (_req, res) => res.type(_req.params.kind === 'css' ? 'css' : 'js').send(''));
  if (options.shopping) options.shopping(server);
  server.use('/api/lists', (req, res, next) => {
    const match = /(?:^|;\s*)person=([a-z0-9-]+)/.exec(req.headers.cookie || '');
    req.oidc = { user: match ? { sub: match[1] } : undefined, isAuthenticated: () => Boolean(match) };
    admission.run(req.method === 'GET' ? 'read' : 'write', () => router(req, res, next));
  });
  const listener = server.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  async function call(method, route, body, person = 'alice') {
    const response = await fetch(base + '/api/lists' + route, {
      method, headers: { ...(person ? { Cookie: `person=${person}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { status: response.status, body: parsed, text, type: response.headers.get('content-type') || '' };
  }
  return { base, pool, call, close: () => new Promise((resolve) => listener.close(resolve)) };
}

module.exports = { PACKAGE, STORE, WRITER_REFUSAL, toolchain, dependency, load, memoryPool, app };
