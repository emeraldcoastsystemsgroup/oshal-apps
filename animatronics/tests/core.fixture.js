/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The loopback fixture both framework-coupled suites share: bare
 *                     |                             | requires (express, playwright) resolve from the framework
 *                     |                             | checkout (OSHAL_CORE_DIR), the two `@/` modules the package
 *                     |                             | imports are doubled, an in-memory pool answers exactly the
 *                     |                             | package's SQL, and startApp() mounts the COMPILED routes on
 *                     |                             | express. The caller is the `x-test-sub` header, or a default
 *                     |                             | subject for the browser. No docker, no database, no serial.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Answer /favicon.ico with 204. The Test Lab runner image's Chromium requests the origin's favicon and logs the 404 as a console error, which the spec counts as a page error - so every no-errors assertion failed in the sandbox while passing on a host browser that does not ask. The page itself requests no favicon.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
const PKG = path.resolve(__dirname, '..');

/** @description Resolve bare requires from the framework checkout and double the `@/` modules. @returns {Function} The checkout's require. */
function frameworkRequire() {
  if (!fs.existsSync(path.join(CORE, 'node_modules', 'express'))) throw new Error(`OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
  const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
  if (Module._load.animatronicsPatched) return coreRequire;
  const STUBS = {
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error(obj, msg) { const err = obj && typeof obj === 'object' && obj.err; console.error('[package]', msg || obj, err instanceof Error ? err.stack : err || ''); } }) },
    '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: (body) => Boolean(body && typeof body === 'object' && body.confirm === true), confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, action }) },
  };
  const originalLoad = Module._load;
  const patched = function patched(request, parent, isMain) {
    if (STUBS[request]) return STUBS[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
    return originalLoad.call(this, request, parent, isMain);
  };
  patched.animatronicsPatched = true;
  Module._load = patched;
  return coreRequire;
}

/** @description An in-memory database that answers exactly the package's SQL. @returns {{tables: object, query: Function}} The pool. */
function fakePool() {
  const tables = { animatronic_rig: [], animatronic_run: [] };
  const now = () => new Date().toISOString();
  const cols = (list) => list.split(',').map((c) => c.trim());
  const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const out = (row, names) => Object.fromEntries(names.map((n) => [n, row[n] === undefined ? null : row[n]]));
  const evalWhere = (text, p) => {
    const where = /WHERE\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|\s+RETURNING|$)/.exec(text)[1];
    return (row) => where.split(/\s+AND\s+/).every((c) => {
      const m = /^(\w+)\s*(=|<=)\s*\$(\d+)$/.exec(c.trim());
      if (!m) throw new Error(`fake pool cannot evaluate: ${c}`);
      const value = p[Number(m[3]) - 1];
      return m[2] === '=' ? row[m[1]] === value : row[m[1]] <= (value instanceof Date ? value.toISOString() : value);
    });
  };
  const update = (rows, text, p, returning, matches) => {
    const sets = /SET\s+([\s\S]+?)\s+WHERE/.exec(text)[1].split(',').map((s) => s.trim());
    const hit = rows.filter(matches);
    hit.forEach((r) => {
      for (const s of sets) {
        const m = /^(\w+) = \$(\d+)(::jsonb)?$/.exec(s);
        if (m) r[m[1]] = m[3] ? j(p[Number(m[2]) - 1]) : p[Number(m[2]) - 1];
        else if (s === 'armed_at = now()') r.armed_at = now();
        else if (s === 'armed_at = NULL') r.armed_at = null;
      }
      r.updated_at = new Date(Date.now() + 1).toISOString();
    });
    return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length };
  };
  return {
    tables,
    async query(sql, params = []) {
      const text = (typeof sql === 'string' ? sql : sql.text).trim();
      const p = typeof sql === 'string' ? params : sql.values;
      const table = /(?:FROM|INTO|UPDATE)\s+(animatronic_\w+)/.exec(text)[1];
      const rows = tables[table];
      const returning = /RETURNING\s+([\s\S]+)$/.exec(text);
      if (/^INSERT INTO animatronic_rig/.test(text)) {
        const row = { rig_id: randomUUID(), owner_sub: p[0], title: p[1], rig: j(p[2]), poses: j(p[3]), scenarios: j(p[4]), armed: false, armed_at: null, current_pose: j(p[5]), run_count: 0, last_report: null, source: j(p[6]), created_at: now(), updated_at: now() };
        rows.push(row);
        return { rows: [out(row, cols(returning[1]))], rowCount: 1 };
      }
      if (/^INSERT INTO animatronic_run/.test(text)) {
        rows.push({ rig_id: p[0], run: p[1], owner_sub: p[2], kind: p[3], scenario: p[4], report: j(p[5]), frames: p[6], created_at: now() });
        return { rows: [], rowCount: 1 };
      }
      const matches = evalWhere(text.replace(/FILTER \(WHERE [^)]*\)/g, ''), p);
      if (/^SELECT count\(\*\)/.test(text)) {
        const hit = rows.filter(matches);
        return { rows: [{ total: String(hit.length), armed: String(hit.filter((r) => r.armed).length), runs: String(hit.reduce((a, r) => a + r.run_count, 0)) }], rowCount: 1 };
      }
      if (/^SELECT/.test(text)) {
        let hit = rows.filter(matches);
        if (/ORDER BY run DESC/.test(text)) hit = hit.slice().sort((a, b) => b.run - a.run);
        if (/ORDER BY updated_at DESC/.test(text)) hit = hit.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
        if (/report->'verdict'->>'summary' AS verdict/.test(text)) return { rows: hit.map((r) => ({ run: r.run, kind: r.kind, scenario: r.scenario, frames: r.frames, created_at: r.created_at, verdict: r.report?.verdict?.summary ?? null })), rowCount: hit.length };
        const names = cols(/^SELECT\s+([\s\S]+?)\s+FROM/.exec(text)[1]);
        return { rows: hit.map((r) => out(r, names)), rowCount: hit.length };
      }
      if (/^DELETE/.test(text)) {
        const keep = rows.filter((r) => !matches(r));
        const removed = rows.length - keep.length;
        tables[table] = keep;
        tables.animatronic_run = tables.animatronic_run.filter((r) => tables.animatronic_rig.some((d) => d.rig_id === r.rig_id));
        return { rows: [], rowCount: removed };
      }
      if (/^UPDATE animatronic_rig SET run_count = run_count \+ 1/.test(text)) {
        const hit = rows.filter(matches);
        hit.forEach((r) => { r.run_count += 1; r.updated_at = now(); });
        return { rows: hit.map((r) => ({ run_count: r.run_count })), rowCount: hit.length };
      }
      if (/^UPDATE animatronic_rig SET/.test(text)) return update(rows, text, p, returning, matches);
      throw new Error(`fake pool cannot answer: ${text.slice(0, 80)}`);
    },
  };
}

/**
 * @description Mount the compiled routes on express over loopback.
 * @param {{defaultSub?: string}} [opts] - A subject used when the request carries no `x-test-sub` header (the browser).
 * @returns {Promise<{baseUrl: string, pool: object, coreRequire: Function, stop: Function}>} The running app.
 */
async function startApp(opts = {}) {
  const coreRequire = frameworkRequire();
  const express = coreRequire('express');
  const { createAnimatronicsRoutes } = require(path.join(PKG, 'routes', 'animatronics-routes.js'));
  const { createHomeSummaryRoutes } = require(path.join(PKG, 'routes', 'home-summary.js'));
  const pool = fakePool();
  const ctx = { pool, appPackageDir: PKG };
  const app = express();
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { const sub = req.get('x-test-sub') || opts.defaultSub; if (sub) req.oidc = { user: { sub }, isAuthenticated: () => true }; next(); });
  app.use('/shared/ui', (_req, res) => res.status(204).end());
  app.use('/api/animatronics/home-summary', createHomeSummaryRoutes(ctx));
  app.use('/api/animatronics', createAnimatronicsRoutes(ctx));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, pool, coreRequire, stop: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { CORE, PKG, frameworkRequire, fakePool, startApp };
