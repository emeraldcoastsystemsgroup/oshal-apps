/**
 * Guide-bot surface contract. The route must turn a signed-in deck-builder turn into bounded,
 * editor-ready actions; arbitrary operations and malformed fields never cross the surface boundary.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-24 21:20:00 | maintainer@emeraldcoastsystemsgroup.com   | Prove the deck-builder guide reaches the editor through the validated action contract and denies anonymous callers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

function fakeRouter() {
  const routes = new Map();
  const register = (method) => (routePath, ...handlers) => routes.set(`${method} ${routePath}`, handlers.at(-1));
  return { routes, get: register('get'), post: register('post'), put: register('put'), delete: register('delete') };
}

const calls = [];
const STUBS = {
  express: { Router: () => fakeRouter(), raw: () => (_req, _res, next) => next?.() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': {
    PresentationEngine: class {}, renderPptx: async () => Buffer.alloc(0), renderDocx: async () => Buffer.alloc(0),
    renderXlsx: async () => Buffer.alloc(0), themeCatalog: () => [{ id: 'executive', mood: 'clear' }],
    layoutCatalog: () => [], isThemeId: (value) => value === 'executive', DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}),
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({ provider: 'test' }), saveContent: async () => ({}),
    listFolder: async () => ({ provider: 'test', files: [] }), deleteStoredFile: async () => ({}),
  },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (...args) => {
      calls.push(args);
      return { response: JSON.stringify({
        reply: 'I updated the outline.',
        actions: [
          { op: 'set_title', title: 'Quarterly review' },
          { op: 'add_slide', title: 'Next steps', bullets: ['Confirm owner', 7] },
          { op: 'update_slide', index: 2, bullets: ['bounded'] },
          { op: 'delete_all', path: '/tmp/should-not-cross' },
          { op: 'update_slide', index: 0, title: 'invalid' },
          { op: 'set_theme', theme: 'executive' },
        ],
      }) };
    },
  },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: () => false,
    confirmationRequiredPayload: () => ({ error: 'confirmation_required' }),
  },
};

const originalLoad = Module._load;
Module._load = function loadWithFrameworkSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');

function response() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.sendFile = () => res;
  return res;
}

function guideHandler() {
  const router = createBotPresentationRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: path.resolve(here, '..') });
  const handler = router.routes.get('post /guide');
  assert.ok(handler, 'POST /guide is not registered');
  return handler;
}

test('anonymous guide calls stop before bot execution', async () => {
  calls.length = 0;
  const res = response();
  await guideHandler()({ body: { message: 'make a deck' } }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'not_authenticated' });
  assert.equal(calls.length, 0);
});

test('deck-builder guide returns only validated editor operations', async () => {
  calls.length = 0;
  const res = response();
  await guideHandler()({ oidc: { user: { sub: 'auth0|guide-owner' } }, body: {
    message: 'make the next steps slide', title: 'Quarterly review', slides: [], theme: 'executive',
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, 'I updated the outline.');
  assert.deepEqual(res.body.actions, [
    { op: 'set_title', title: 'Quarterly review' },
    { op: 'add_slide', title: 'Next steps', bullets: ['Confirm owner', '7'] },
    { op: 'update_slide', index: 2, bullets: ['bounded'] },
    { op: 'set_theme', theme: 'executive' },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'a0000000-0000-0000-0000-000000000042');
  assert.equal(calls[0][3].userSub, 'auth0|guide-owner');
  assert.equal(calls[0][3].agenticMode, true);
  assert.equal(calls[0][3].direct, true);
});
