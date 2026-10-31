/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D9, lane @ds-plant: the fourth table (design_mechanism, one jsonb row per project, cascaded on delete) joins the in-memory pool.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203, lane @ds-app: the loopback harness the route suite and the browser proof share - express resolved from the framework checkout (OSHAL_CORE_ROOT, as the Test Lab sets it, or OSHAL_CORE_DIR), the exact framework double the package imports (the logger), and a SQL-dispatching in-memory pool that answers the package's own statements (owner-scoped INSERT / SELECT / UPDATE / DELETE over the three tables, the FK cascade on delete, jsonb parameters parsed). The owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');

/** Errors the package logs are the diagnostics of a suite; everything else stays quiet. */
const logger = { debug() {}, info() {}, warn() {}, error(obj, msg) { const err = obj && typeof obj === 'object' && obj.err; if (process.env.DESIGN_STUDIO_TEST_LOG) console.error('[package]', msg || obj, err instanceof Error ? err.stack : err || ''); } };
const STUBS = { '@/shared/logger': { createChildLogger: () => logger } };

/**
 * Install the framework doubles into the module loader and load the compiled routes through them.
 * Returns the factories, express from the framework checkout and a `restore` that lifts the patch.
 */
function loadRoutes() {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (STUBS[request]) return STUBS[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
      return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const express = coreRequire('express');
  const { createDesignStudioRoutes } = require(path.join(PKG, 'routes', 'design-studio-routes.js'));
  const { createHomeSummaryRoutes } = require(path.join(PKG, 'routes', 'home-summary.js'));
  const { createPackageSmokeRoutes } = require(path.join(PKG, 'routes', 'package-smoke.js'));
  return { express, createDesignStudioRoutes, createHomeSummaryRoutes, createPackageSmokeRoutes, restore: () => { Module._load = originalLoad; } };
}

const TABLES = ['design_project', 'design_binding', 'design_closure', 'design_mechanism', 'design_order'];
const cols = (list) => list.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
const stripCast = (expr) => expr.replace(/::jsonb/g, '').trim();

/** An in-memory database that answers exactly the package's SQL: owner-scoped CRUD over the three tables. */
function fakePool() {
  const tables = { design_project: [], design_binding: [], design_closure: [], design_mechanism: [], design_order: [] };
  const j = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return v; } };
  const value = (expr, p) => { const m = /^\$(\d+)$/.exec(stripCast(expr)); if (!m) throw new Error(`fake pool cannot evaluate value ${expr}`); return p[Number(m[1]) - 1]; };
  const where = (text, p) => {
    const w = /WHERE\s+([\s\S]+?)(?:\s+RETURNING|$)/.exec(text);
    if (!w) return () => true;
    const conds = w[1].split(/\s+AND\s+/).map((c) => c.trim());
    return (row) => conds.every((c) => { const m = /^(\w+)\s*=\s*\$(\d+)$/.exec(c); if (!m) throw new Error(`fake pool cannot evaluate: ${c}`); return row[m[1]] === p[Number(m[2]) - 1]; });
  };
  const cascade = () => { const ids = new Set(tables.design_project.map((r) => r.id)); for (const t of ['design_binding', 'design_closure', 'design_mechanism', 'design_order']) tables[t] = tables[t].filter((r) => ids.has(r.project_id)); };
  return {
    tables,
    async query(sql, params = []) {
      const text = (typeof sql === 'string' ? sql : sql.text).trim();
      const p = typeof sql === 'string' ? params : sql.values;
      const table = /(?:FROM|INTO|UPDATE)\s+(design_\w+)/.exec(text)[1];
      if (!TABLES.includes(table)) throw new Error(`fake pool knows no table ${table}`);
      const rows = tables[table];
      if (/^INSERT INTO/.test(text)) {
        const m = /\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/.exec(text);
        const names = cols(m[1]); const values = m[2].split(',').map((v) => value(v, p));
        const row = Object.fromEntries(names.map((n, i) => [n, /^(brief|phases|artifact|mechanism|input|result)$/.test(n) ? j(values[i]) : values[i]]));
        rows.push(row); return { rows: [], rowCount: 1 };
      }
      const matches = where(text, p);
      if (/^SELECT/.test(text)) {
        const names = cols(/^SELECT\s+([\s\S]+?)\s+FROM/.exec(text)[1]);
        const hit = rows.filter(matches);
        return { rows: hit.map((r) => Object.fromEntries(names.map((n) => [n, r[n] === undefined ? null : r[n]]))), rowCount: hit.length };
      }
      if (/^UPDATE/.test(text)) {
        const sets = /SET\s+([\s\S]+?)\s+WHERE/.exec(text)[1].split(',').map((s) => s.trim());
        const hit = rows.filter(matches);
        hit.forEach((r) => { for (const s of sets) { const [col, expr] = s.split('=').map((x) => x.trim()); const v = value(expr, p); r[col] = /^(brief|phases|artifact|mechanism|input|result)$/.test(col) ? j(v) : v; } });
        return { rows: [], rowCount: hit.length };
      }
      if (/^DELETE/.test(text)) {
        const keep = rows.filter((r) => !matches(r)); const removed = rows.length - keep.length;
        tables[table] = keep; cascade(); return { rows: [], rowCount: removed };
      }
      throw new Error(`fake pool cannot run: ${text.slice(0, 90)}`);
    },
  };
}

/** The session the mount's `auth: oidc` would have stamped: a signed-in person, or none. */
function session(sub) {
  return (req, _res, next) => { if (sub) req.oidc = { user: { sub }, isAuthenticated: () => true }; next(); };
}

module.exports = { CORE, PKG, coreRequire, loadRoutes, fakePool, session };
