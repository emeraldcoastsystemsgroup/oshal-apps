/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The control and remote pages loaded pumpkin-face.js and pumpkin-audio.js from the
 *   framework's /pumpkin/ page directory, which the native kernel does not serve: /api/pumpkin/app answered with two
 *   404s and then "window.PumpkinFace is not a constructor". Every script a bundled page loads must be served by this
 *   package's own router from a file in tools/ (shared framework UI under /shared/ stays the kernel's), the compiled route must hand that exact file to sendFile, and running
 *   the shipped file must define the constructor the page calls.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const PAGES = ['pumpkin-app.html', 'pumpkin-remote.html'];

/** Build the compiled router with inert framework stand-ins, keeping each GET handler by path. */
function compiledGetRoutes() {
  const routes = new Map();
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'express') {
      const record = (method) => (routePath, ...handlers) => { if (method === 'GET') routes.set(routePath, handlers[handlers.length - 1]); };
      return { Router: () => ({ get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE'), use() {} }) };
    }
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === '@/shared/services/database') return { buildOwnerRlsPolicyStatements: () => [] };
    if (request === '@/shared/middleware/authz') {
      return { hasValidServiceSecret: () => false, getTrustedServiceUserSub: () => null, getCaller: () => ({}), isOperatorIdentity: () => false };
    }
    if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null };
    if (request === '@/app/routes/inline-bot-execution') return { executeBotOrInline: async () => ({ response: '{}' }) };
    return original.call(this, request, ...rest);
  };
  try {
    const target = path.join(PKG, 'routes', 'pumpkin-routes.js');
    delete require.cache[require.resolve(target)];
    require(target).createPumpkinRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: PKG });
  } finally {
    Module._load = original;
  }
  return routes;
}

/** Every external script a bundled page loads. */
function pageScripts(page) {
  const html = fs.readFileSync(path.join(PKG, 'tools', page), 'utf8');
  return [...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map((m) => m[1]);
}

test('every script a bundled page loads is served by this package from a file in tools/', async () => {
  const routes = compiledGetRoutes();
  const seen = [];
  for (const page of PAGES) {
    for (const src of pageScripts(page)) {
      assert.doesNotMatch(src, /^\/pumpkin\//, `${page} loads ${src} from the framework's page directory`);
      // Shared framework UI (/shared/ui/...) is the kernel's; the pumpkin's own scripts are this package's.
      if (!/\/pumpkin-[a-z]+\.js$/.test(src)) continue;
      assert.match(src, /^\/api\/pumpkin\/assets\/pumpkin-[a-z]+\.js$/, `${page} loads ${src} from outside this package`);
      const routePath = src.replace(/^\/api\/pumpkin/, '');
      const handler = routes.get(routePath);
      assert.ok(handler, `${page} loads ${src}, which no GET route registers`);
      const sent = await new Promise((resolve) => handler({}, { sendFile: (file) => resolve(file), status() { return this; }, send() {} }));
      assert.equal(sent, path.join(PKG, 'tools', path.basename(src)), `${src} is served from the package's tools/`);
      assert.ok(fs.existsSync(sent), `${sent} ships in the package`);
      seen.push(path.basename(src));
    }
  }
  assert.deepEqual([...new Set(seen)].sort(), ['pumpkin-audio.js', 'pumpkin-face.js']);
});

test('the shipped scripts define the constructors the pages call', () => {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  for (const file of ['pumpkin-face.js', 'pumpkin-audio.js']) {
    vm.runInContext(fs.readFileSync(path.join(PKG, 'tools', file), 'utf8'), sandbox, { filename: file });
  }
  assert.equal(typeof sandbox.window.PumpkinFace, 'function');
  assert.equal(typeof sandbox.window.PumpkinAudio, 'function');
});
