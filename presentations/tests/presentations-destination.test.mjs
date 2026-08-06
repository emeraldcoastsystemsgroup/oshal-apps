/**
 * AI Office save-target suite. It loads the compiled route bytes mounted by the framework and
 * replaces only framework seams at the CommonJS require boundary. Assertions use handler calls
 * and outputs, not source substrings, except for the separate browser wiring contract.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Pin ADR-043 destination visibility: authenticated default resolution, side-effect-free override previews, fail-closed provider validation, 502 on preference failure, and live surface refresh wiring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

/** Minimal Router double that keeps each final handler addressable by method and path. */
function fakeRouter() {
  const routes = new Map();
  const register = (method) => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers.at(-1));
  };
  return {
    routes,
    get: register('get'),
    post: register('post'),
    put: register('put'),
    delete: register('delete'),
  };
}

/** Mutable storage seam; calls prove authorization and override behavior at the boundary. */
const storage = {
  resolveCalls: [],
  next: { provider: 'google-drive', folder: 'Decks' },
};

const STUBS = {
  express: { Router: () => fakeRouter(), raw: () => (_req, _res, next) => next?.() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': {
    buildOwnerRlsPolicyStatements: () => [],
    runRuntimeSchemaBootstrap: async () => {},
  },
  '@/features/presentation-generation': {
    PresentationEngine: class {},
    renderPptx: async () => Buffer.alloc(0),
    renderDocx: async () => Buffer.alloc(0),
    renderXlsx: async () => Buffer.alloc(0),
    themeCatalog: () => [],
    layoutCatalog: () => [],
    isThemeId: () => false,
    DEFAULT_THEME_ID: 'executive',
    importOffice: async () => ({}),
  },
  '@/features/agent-management': {
    BotNodeClient: class {},
    createRegistryEndpointResolver: () => () => null,
  },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async (_ctx, sub, kind) => {
      storage.resolveCalls.push({ sub, kind });
      if (storage.next instanceof Error) throw storage.next;
      return storage.next;
    },
    saveContent: async () => ({ provider: 'test', location: 'test' }),
    listFolder: async () => ({ provider: 'test', files: [] }),
    deleteStoredFile: async () => ({ provider: 'test', removed: true }),
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '[]' }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => body?.confirm === true,
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, action }),
  },
};

const originalLoad = Module._load;
Module._load = function loadWithFrameworkSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');

/** Pool double records queries so a read-only preview can prove it caused no database action. */
function makePool() {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params });
    return { rows: [], rowCount: 0 };
  };
  return pool;
}

function makeResponse() {
  const response = { statusCode: 200, body: undefined };
  response.status = (statusCode) => { response.statusCode = statusCode; return response; };
  response.json = (body) => { response.body = body; return response; };
  response.sendFile = () => response;
  return response;
}

function mount() {
  const pool = makePool();
  const router = createBotPresentationRoutes({ pool, appPackageDir: path.resolve(here, '..') });
  const handler = router.routes.get('get /destination');
  assert.ok(handler, 'GET /destination is not registered');
  return { pool, handler };
}

async function call({ sub = 'auth0|deck-owner', query = {} } = {}) {
  storage.resolveCalls.length = 0;
  const { pool, handler } = mount();
  const before = pool.calls.length;
  const req = { query, oidc: sub ? { user: { sub } } : undefined };
  const res = makeResponse();
  await handler(req, res);
  return { res, dbActions: pool.calls.length - before };
}

test('anonymous destination requests stop before preference lookup', async () => {
  storage.next = { provider: 'dropbox' };
  const { res } = await call({ sub: null });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'not_authenticated' });
  assert.equal(storage.resolveCalls.length, 0);
});

test('default destination resolves the caller Files target and real bot subfolder', async () => {
  storage.next = { provider: 'google-drive', folder: 'Decks' };
  const { res } = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, 'google-drive');
  assert.equal(res.body.folder, 'Decks');
  assert.equal(res.body.isDefault, true);
  assert.deepEqual(storage.resolveCalls, [{ sub: 'auth0|deck-owner', kind: 'files' }]);
  assert.match(String(res.body.subfolder), /^oshal\/[0-9a-f-]{36}$/);
});

test('GitHub defaults expose repository and folder so the destination is findable', async () => {
  storage.next = { provider: 'github', repo: 'office-artifacts', folder: 'decks' };
  const { res } = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.repo, 'office-artifacts');
  assert.equal(res.body.folder, 'decks');
  assert.equal(res.body.isDefault, true);
});

test('a valid override previews without reading preferences or touching the database', async () => {
  storage.next = { provider: 'google-drive', folder: 'Decks' };
  const { res, dbActions } = await call({ query: { provider: 'dropbox' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, 'dropbox');
  assert.equal(res.body.isDefault, false);
  assert.equal(storage.resolveCalls.length, 0);
  assert.equal(dbActions, 0);
});

test('unknown providers degrade to the resolved default rather than being promised', async () => {
  storage.next = { provider: 'google-drive', folder: 'Decks' };
  for (const provider of ['evil-corp', 'DROPBOX; DROP TABLE', '../../etc', '']) {
    const { res } = await call({ query: { provider } });
    assert.equal(res.statusCode, 200, `provider=${JSON.stringify(provider)}`);
    assert.equal(res.body.provider, 'google-drive', `provider=${JSON.stringify(provider)}`);
    assert.equal(res.body.isDefault, true);
  }
});

test('every provider offered by the surface survives endpoint validation', async () => {
  const html = readFileSync(path.resolve(here, '..', 'tools', 'presentations.html'), 'utf8');
  const select = /<select id="saveTo"[\s\S]*?<\/select>/.exec(html);
  assert.ok(select, 'the surface no longer exposes #saveTo');
  const offered = [...select[0].matchAll(/<option value="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean);
  assert.ok(offered.length >= 4, 'the surface lost destination choices');
  for (const provider of offered) {
    storage.next = { provider: 'google-drive' };
    const { res } = await call({ query: { provider } });
    assert.equal(res.body.provider, provider);
    assert.equal(res.body.isDefault, false);
  }
});

test('preference-store failure returns 502 without guessing a provider', async () => {
  storage.next = new Error('preference store unavailable');
  const { res } = await call();
  assert.equal(res.statusCode, 502);
  assert.ok(res.body.error);
  assert.equal(res.body.provider, undefined);
});

test('surface resolves on boot, refreshes on override changes, and renders a destination chip', () => {
  const html = readFileSync(path.resolve(here, '..', 'tools', 'presentations.html'), 'utf8');
  assert.match(html, /id="destChip"/);
  assert.match(html, /id="destText"/);
  assert.match(html, /'\/api\/presentations\/sections\/destination'/);
  assert.match(html, /\[name, destination\.repo, destination\.folder\]\.filter\(Boolean\)\.join\(' \/ '\)/);
  assert.match(html, /renderKinds\(\); renderTemplates\(\); loadThemes\(\); loadDecks\(\); refreshDest\(\);/);
  assert.match(html, /\$\('saveTo'\)\.addEventListener\('change', refreshDest\)/);
});

test.after(() => { Module._load = originalLoad; });
