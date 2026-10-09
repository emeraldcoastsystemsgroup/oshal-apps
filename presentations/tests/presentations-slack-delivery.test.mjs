/**
 * Approval-gated AI Office Slack delivery contract. The Slack connector and HTTP
 * transport are injected so this test never contacts an account or recipient.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove explicit confirmation, owner token lookup and one rendered Office upload handoff without Slack network traffic.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the explicit framework fixture for the unchanged real-renderer contract on Linux and Windows.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Name the owner token fixture without a vendor credential prefix. The literal began with Slack's user-token prefix, which the public store build's vendor-prefix gate (scripts/build-store-public.sh, Gate A) correctly refuses, so every nightly publish stopped on this test file. The assertion is unchanged: the upload carries exactly the token the connector returned.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Resolve the explicit configured Store framework rather than a Windows-only fallback, keeping the real renderer and delivery refusal assertions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameworkFixture, presentationEngine } from './framework-fixture.mjs';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));
/** The owner's Slack token as the connector double returns it; deliberately not vendor-prefixed. */
const OWNER_TOKEN = 'slack-owner-token-fixture';

function fakeRouter() {
  const routes = new Map();
  const register = (method) => (routePath, ...handlers) => routes.set(`${method} ${routePath}`, handlers.at(-1));
  return { routes, get: register('get'), post: register('post'), put: register('put'), delete: register('delete') };
}

function response() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.sendFile = () => res;
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; return res; };
  return res;
}

const uploads = [];
const originalLoad = Module._load;
const logger = { error() {}, warn() {}, info() {}, debug() {} };
Module._load = function loadFrameworkSeams(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => logger };
  if (request === '@/shared/security/ssrf-guard') return { isPrivateIp: () => false, assertPublicHttpUrl: async () => {} };
  return originalLoad.call(this, request, ...rest);
};
const frameworkRoot = frameworkFixture();
const kernelPresentationGeneration = presentationEngine(frameworkRoot, {
  '@/shared/logger': {createChildLogger: () => logger},
  '@/shared/security/ssrf-guard': {isPrivateIp: () => false, assertPublicHttpUrl: async () => {}},
});
const stubs = {
  express: { Router: () => fakeRouter(), raw: () => (_req, _res, next) => next?.() },
  '@/shared/logger': { createChildLogger: () => logger },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': kernelPresentationGeneration,
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({ provider: 'oshal-local', folder: 'files' }),
    saveContent: async () => null,
    listFolder: async () => ({ provider: 'oshal-local', files: [] }),
    deleteStoredFile: async () => ({ provider: 'oshal-local', removed: true }),
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '{}' }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async (_pool, _sub, provider) => provider === 'slack' ? OWNER_TOKEN : null },
  '@/app/routes/slack-client': {
    uploadSlackFile: async (token, input) => {
      uploads.push({ token, input });
      return { fileId: 'F123', channelId: input.channelId, permalink: 'https://slack.invalid/files/F123' };
    },
  },
  '@/app/routes/email-routes': { sendGmail: async () => {}, sendOutlookMail: async () => {} },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => body?.confirm === true,
    confirmationRequiredPayload: (operation) => ({ error: 'confirmation_required', operation }),
  },
};
Module._load = function loadStubs(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');

const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
const router = createBotPresentationRoutes({ pool, appPackageDir: path.resolve(here, '..') });
const slack = router.routes.get('post /slack');
assert.ok(slack, 'POST /slack is not registered');

test.after(() => { Module._load = originalLoad; });

test('Slack delivery refuses before confirmation and performs no upload', async () => {
  uploads.length = 0;
  const res = response();
  await slack({ oidc: { user: { sub: 'auth0|office-owner' } }, body: {
    channelId: 'C123', title: 'Quarterly review', sections: [{ title: 'One', content: 'Two' }],
  } }, res);
  assert.equal(res.statusCode, 428);
  assert.equal(uploads.length, 0);
});

test('confirmed Slack delivery renders one Office artifact and hands it to the owner token', async () => {
  uploads.length = 0;
  const res = response();
  await slack({ oidc: { user: { sub: 'auth0|office-owner' } }, body: {
    confirm: true, channelId: 'C123', title: 'Quarterly review', format: 'pptx',
    comment: 'Confirmed for the review channel', sections: [{ title: 'One', content: 'Two' }],
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, via: 'slack', channelId: 'C123', fileId: 'F123',
    permalink: 'https://slack.invalid/files/F123', format: 'pptx', fileName: 'Quarterly review.pptx',
  });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].token, OWNER_TOKEN);
  assert.equal(uploads[0].input.channelId, 'C123');
  assert.equal(uploads[0].input.title, 'Quarterly review');
  assert.ok(uploads[0].input.content.length > 1000);
  assert.equal(uploads[0].input.initialComment, 'Confirmed for the review channel');
});
