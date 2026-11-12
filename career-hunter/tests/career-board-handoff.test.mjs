/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | T63: the retired /board addresses answer a hand-off page to the native board. On the native kernel a package cannot redirect (no `redirect` on the response, no Location header relayed), so the 308 they answered was HTTP 500 there. The page holds one address on this site and no script, the route answers it through a response that has only what a kernel relays, and neither the source nor the compiled route calls a redirect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { handOffPage } = require('../routes/hand-off-page.js');

test('the retired board address hands the browser to the native board with one address and no script', () => {
  const page = handOffPage('/api/career-hunter/board-native', 'Open My jobs');
  assert.ok(page.includes('<meta http-equiv="refresh" content="0; url=/api/career-hunter/board-native">'), page);
  assert.ok(page.includes('<a href="/api/career-hunter/board-native">Open My jobs</a>'), page);
  assert.deepEqual([...page.matchAll(/(?:url=|href="|src=")([^">]+)/g)].map((m) => m[1]), ['/api/career-hunter/board-native', '/api/career-hunter/board-native']);
  assert.doesNotMatch(page, /<script|javascript:/i);
  for (const other of ['https://example.com/x', '//example.com/x', 'x', '']) assert.throws(() => handOffPage(other, 'x'), /stays on this site/, other);
});

test('the compiled route answers the page through a response with only what a kernel relays', () => {
  const routes = [];
  const router = { get: (path, ...handlers) => routes.push({ path, handler: handlers[handlers.length - 1] }), use() {}, post() {}, put() {}, delete() {} };
  const Module = require('node:module'), load = Module._load;
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };
  Module._load = function stubbed(request, ...rest) {
    if (request.startsWith('@/')) return new Proxy({ createChildLogger: () => quiet }, { get: (t, k) => (k in t ? t[k] : k === '__esModule' ? true : () => () => {}) });
    return load.call(this, request, ...rest);
  };
  let surfaces;
  try { surfaces = require('../routes/career-surface-routes.js'); } finally { Module._load = load; }
  surfaces.registerCareerClassicBoardRoutes(router, {});
  const sent = { status: 200, type: '', body: null, headers: [] };
  const kernelResponse = {
    status(code) { sent.status = code; return this; },
    type(kind) { sent.type = kind; return this; },
    setHeader(name) { sent.headers.push(String(name).toLowerCase()); return this; },
    set(name) { return this.setHeader(name); },
    send(body) { sent.body = body; return this; },
    end(body) { return this.send(body ?? ''); },
  };
  for (const path of ['/board', '/board/*boardPath']) {
    const route = routes.find((r) => r.path === path);
    assert.ok(route, path);
    route.handler({ params: {}, query: {} }, kernelResponse);
    assert.deepEqual([sent.status, sent.type, sent.headers], [200, 'html', []], path);
    assert.equal(sent.body, handOffPage('/api/career-hunter/board-native', 'Open My jobs'), path);
  }
  for (const file of ['src-routes/career-surface-routes.ts', 'routes/career-surface-routes.js']) {
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /res\.redirect\(/, file);
  }
});
