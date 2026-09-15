/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The loopback harness the route suite and the browser proof share: express resolved from the framework checkout (OSHAL_CORE_DIR), the exact framework doubles the package imports (logger, explicit-write confirmation), and the SQL-dispatching in-memory pool that answers the package's own statements. Extracted from routes.core.test.js so the browser fixture mounts the SAME compiled routes the same way.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | B20: the node-rail mount (createEmbodiedNodeRoutes) is loaded through the same doubles.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | trustedSubMirror: the mounter's trusted user-sub header resolution for the bare nodes mount, so a node double's owner reaches the fleet as it does on the box.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | B23: `@/shared/artifact-exchange` is doubled by a FAITHFUL MIRROR of the kernel's redeem (src/shared/artifact-exchange/redeem.ts) — the same ref shape, the same two loopback fetches on the caller's own port with the service secret and user-sub headers, the same 404/502/413 statuses — and `artifactRelayDouble` is the handle store the suite mounts on that same port. The redemption the scene-import route performs therefore crosses a REAL socket to a REAL handle endpoint; only the kernel's handle table is doubled.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
/** Exactly the `@/` modules the package imports, doubled. */
const STUBS = {
  '@/shared/logger': { createChildLogger: () => logger },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => !!body && typeof body === 'object' && body.confirm === true,
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true. No write was attempted.` }),
  },
  '@/shared/artifact-exchange': { redeemArtifactViaRelay },
};

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
/** The kernel's own name sanitisation set: CR, LF, double quote, backslash, forward slash. */
const NAME_UNSAFE = new RegExp('[' + String.fromCharCode(13, 10, 34, 92, 47) + ']', 'g');

/**
 * A faithful mirror of the kernel's shared ADR-139 redeem (src/shared/artifact-exchange/redeem.ts):
 * the service secret from the environment, the caller's own listening port, the `art_…` ref shape,
 * then two real loopback fetches (metadata, then content) with the service headers, the 404/502
 * mapping and the byte ceiling. The suite mounts `artifactRelayDouble` on that same port, so the
 * route under test redeems over a real socket — the doubled part is the handle table, not the transport.
 */
async function redeemArtifactViaRelay({ port, callerSub, ref, maxBytes }) {
  const cap = Math.min(DEFAULT_MAX_BYTES, Math.max(1, maxBytes || DEFAULT_MAX_BYTES));
  const secret = (process.env.SWARM_SERVICE_SECRET || '').trim();
  if (!secret) return { ok: false, status: 503, error: 'artifact relay unconfigured' };
  if (!port) return { ok: false, status: 503, error: 'artifact relay port unavailable' };
  if (!/^art_[A-Za-z0-9_-]{8,64}$/.test(String(ref))) return { ok: false, status: 400, error: 'a valid artifact ref is required' };
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'x-service-secret': secret, 'x-oshal-user-sub': callerSub };
  try {
    const meta = await fetch(`${base}/api/artifacts/handles/${encodeURIComponent(ref)}`, { headers });
    if (!meta.ok) return { ok: false, status: meta.status === 404 ? 404 : 502, error: meta.status === 404 ? 'artifact handle not found — it may have expired; use Send to… again' : 'artifact lookup failed' };
    const info = await meta.json();
    const content = await fetch(`${base}/api/artifacts/handles/${encodeURIComponent(ref)}/content`, { headers });
    if (!content.ok) return { ok: false, status: 502, error: 'artifact source unavailable' };
    const buffer = Buffer.from(await content.arrayBuffer());
    if (buffer.length > cap) return { ok: false, status: 413, error: 'artifact exceeds this destination’s size limit' };
    return {
      ok: true,
      name: String(info.name || 'artifact').replace(NAME_UNSAFE, '_').slice(0, 120),
      type: String(info.type || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100),
      buffer,
    };
  } catch (error) {
    return { ok: false, status: 502, error: `artifact relay failed: ${error.message}` };
  }
}

/**
 * The kernel's handle endpoints, doubled: owner-bound rows keyed by ref, served only to the service
 * secret and only to the owner the header names (another owner's handle is a 404, as the kernel's is).
 * `put(ref, {sub, name, type, body})` seeds one. Mount at /api/artifacts on the SAME app under test.
 */
function artifactRelayDouble(express, secret) {
  const handles = new Map();
  const router = express.Router();
  const guard = (req, res) => {
    if (req.headers['x-service-secret'] !== secret) { res.status(401).json({ error: 'bad_secret' }); return null; }
    const row = handles.get(req.params.ref);
    if (!row || row.sub !== req.headers['x-oshal-user-sub']) { res.status(404).json({ error: 'not_found' }); return null; }
    return row;
  };
  router.get('/handles/:ref', (req, res) => { const row = guard(req, res); if (row) res.json({ name: row.name, type: row.type, bytes: row.body.length }); });
  router.get('/handles/:ref/content', (req, res) => { const row = guard(req, res); if (row) res.type(row.type).send(row.body); });
  return { router, put: (ref, row) => handles.set(ref, { ...row, body: Buffer.isBuffer(row.body) ? row.body : Buffer.from(String(row.body)) }), handles };
}

/**
 * Install the framework doubles into the module loader and load the compiled routes through them.
 * Returns the routes, express from the framework checkout and a `restore` that lifts the patch.
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
  const routes = require(path.join(PKG, 'routes', 'embodied-routes.js'));
  const nodeRoutes = require(path.join(PKG, 'routes', 'embodied-node-routes.js'));
  return { express, createEmbodiedRoutes: routes.createEmbodiedRoutes, createEmbodiedNodeRoutes: nodeRoutes.createEmbodiedNodeRoutes, NODE_MANIFESTS: routes.NODE_MANIFESTS, restore: () => { Module._load = originalLoad; } };
}

/** An in-memory database that answers exactly the package's SQL. */
function fakePool() {
  const tasks = []; const log = []; let logSeq = 0;
  const now = () => new Date().toISOString();
  return {
    tasks, log,
    async query(sql, params = []) {
      const text = typeof sql === 'string' ? sql : sql.text;
      const p = typeof sql === 'string' ? params : sql.values;
      if (/^INSERT INTO embodied_task/.test(text)) {
        const row = { task_id: randomUUID(), owner_sub: p[0], task: p[1], title: p[2], plan: JSON.parse(p[3]), rehearsal: JSON.parse(p[4]), status: 'draft', current_step: -1, failure: null, created_at: now(), updated_at: now() };
        tasks.push(row); return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/^SELECT .* FROM embodied_task WHERE owner_sub = \$1 AND task_id = \$2/.test(text)) { const r = tasks.filter((t) => t.owner_sub === p[0] && t.task_id === p[1]); return { rows: r.map((t) => ({ ...t })), rowCount: r.length }; }
      if (/^SELECT .* FROM embodied_task WHERE owner_sub = \$1 ORDER BY/.test(text)) { const r = tasks.filter((t) => t.owner_sub === p[0]).slice(0, p[1]); return { rows: r.map((t) => ({ ...t })), rowCount: r.length }; }
      if (/^UPDATE embodied_task SET status/.test(text)) { const hit = tasks.filter((t) => t.owner_sub === p[0] && t.task_id === p[1]); hit.forEach((t) => { t.status = p[2]; t.current_step = p[3]; t.failure = p[4]; t.updated_at = now(); }); return { rows: [], rowCount: hit.length }; }
      if (/^INSERT INTO embodied_command_log/.test(text)) { logSeq += 1; log.push({ log_id: logSeq, owner_sub: p[0], task_id: p[1], sim_ms: p[2], actor: p[3], node_id: p[4], command: p[5], params: JSON.parse(p[6]), outcome: p[7], reason: p[8], created_at: now() }); return { rows: [], rowCount: 1 }; }
      if (/^SELECT .* FROM embodied_command_log WHERE owner_sub = \$1/.test(text)) { const r = log.filter((l) => l.owner_sub === p[0]).sort((a, b) => b.log_id - a.log_id).slice(0, p[1]); return { rows: r, rowCount: r.length }; }
      throw new Error(`fake pool cannot run: ${text.slice(0, 90)}`);
    },
  };
}

/**
 * The mounter's trusted service user-sub resolution (X-Oshal-User-Sub-B64 → req.oshalCallerSub), mirrored for suites that
 * mount the nodes route bare. The secret check itself is the mounter's guard; the route suite asserts the manifest's posture.
 */
function trustedSubMirror() {
  return (req, _res, next) => {
    const h = req.headers['x-oshal-user-sub-b64'];
    if (typeof h === 'string' && /^[A-Za-z0-9_-]+$/.test(h)) req.oshalCallerSub = Buffer.from(h, 'base64url').toString('utf8');
    next();
  };
}

module.exports = { trustedSubMirror, CORE, PKG, coreRequire, loadRoutes, fakePool, artifactRelayDouble, redeemArtifactViaRelay };
