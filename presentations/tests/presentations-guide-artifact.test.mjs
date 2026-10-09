/**
 * Guide-to-artifact acceptance contract. This keeps the Guide's bounded action
 * vocabulary connected to the editor bridge and the real Office renderer without
 * contacting a provider, mailbox, or external recipient.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove a signed-in Guide turn reaches editor state, a real PPTX and an owner-scoped local receipt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the explicit framework fixture for the unchanged real-renderer contract on Linux and Windows.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Use the configured Store fixture instead of a Windows-only default; refuse absent framework bytes before the real-renderer contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameworkFixture, presentationEngine } from './framework-fixture.mjs';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

function fakeRouter() {
  const routes = new Map();
  const register = (method) => (routePath, ...handlers) => routes.set(`${method} ${routePath}`, handlers.at(-1));
  return { routes, get: register('get'), post: register('post'), put: register('put'), delete: register('delete') };
}

const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oshal-presentations-guide-'));
const saved = [];
const poolQueries = [];
let emailCalls = 0;
let deleteCalls = 0;

// The package route is loaded against the same compiled renderer used by the
// application. Only framework aliases and the storage boundary are disposable.
const originalLoad = Module._load;
const frameworkStubs = {
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/security/ssrf-guard': { isPrivateIp: () => false, assertPublicHttpUrl: async () => {} },
};
Module._load = function loadKernelSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(frameworkStubs, request)) return frameworkStubs[request];
  return originalLoad.call(this, request, ...rest);
};
const frameworkRoot = frameworkFixture();
const kernelPresentationGeneration = presentationEngine(frameworkRoot, frameworkStubs);

const STUBS = {
  express: { Router: () => fakeRouter(), raw: () => (_req, _res, next) => next?.() },
  '@/shared/logger': frameworkStubs['@/shared/logger'],
  '@/shared/services/database': {
    buildOwnerRlsPolicyStatements: () => [],
    runRuntimeSchemaBootstrap: async () => {},
  },
  '@/features/presentation-generation': kernelPresentationGeneration,
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({ provider: 'oshal-local', folder: 'files' }),
    saveContent: async (_ctx, sub, kind, fileName, content, _override, subfolder) => {
      assert.equal(kind, 'files');
      assert.equal(sub, 'auth0|guide-owner');
      const relative = path.join(subfolder, fileName);
      const filePath = path.join(artifactRoot, relative);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      const receipt = {
        provider: 'oshal-local',
        location: `oshal-local/${relative.replaceAll(path.sep, '/')}`,
        downloadUrl: `/api/files/download?name=${encodeURIComponent(fileName)}`,
        url: null,
      };
      saved.push({ ...receipt, filePath, bytes: content.length });
      return receipt;
    },
    listFolder: async () => ({ provider: 'oshal-local', files: [] }),
    deleteStoredFile: async () => { deleteCalls += 1; return { provider: 'oshal-local', removed: true }; },
  },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async () => ({ response: JSON.stringify({
      reply: 'I shaped the deck and selected the executive look.',
      actions: [
        { op: 'set_title', title: 'Quarterly review' },
        { op: 'set_outline', slides: [
          { title: 'What changed', bullets: ['Three bounded improvements', 'TBD :: confirm metric'] },
        ] },
        { op: 'add_slide', title: 'Next steps', bullets: ['Confirm owner', 'Schedule review'] },
        { op: 'set_theme', theme: 'executive' },
        { op: 'delete_all', path: '/tmp/should-not-cross' },
        { op: 'update_slide', index: 0, title: 'invalid index' },
      ],
    }) }),
  },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/slack-client': { uploadSlackFile: async () => { throw new Error('unexpected Slack upload'); } },
  '@/app/routes/email-routes': {
    sendGmail: async () => { emailCalls += 1; },
    sendOutlookMail: async () => { emailCalls += 1; },
  },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: () => false,
    confirmationRequiredPayload: () => ({ error: 'confirmation_required' }),
  },
};
Module._load = function loadRouteSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (Object.prototype.hasOwnProperty.call(frameworkStubs, request)) return frameworkStubs[request];
  return originalLoad.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');

function response() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.sendFile = () => res;
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; return res; };
  return res;
}

function editorStateFromActions(actions) {
  const state = { title: '', theme: 'executive', slides: [] };
  for (const action of actions) {
    if (action.op === 'set_title') state.title = action.title;
    if (action.op === 'set_theme') state.theme = action.theme;
    if (action.op === 'set_outline') state.slides = action.slides.map((slide) => ({ ...slide, bullets: [...slide.bullets] }));
    if (action.op === 'add_slide') state.slides.push({ title: action.title, bullets: [...action.bullets] });
    if (action.op === 'update_slide' && action.index >= 1) {
      const slide = state.slides[action.index - 1] || { title: '', bullets: [] };
      if (action.title != null) slide.title = action.title;
      if (action.bullets != null) slide.bullets = [...action.bullets];
      state.slides[action.index - 1] = slide;
    }
  }
  return state;
}

function routes() {
  const router = createBotPresentationRoutes({
    pool: { query: async (...args) => { poolQueries.push(args); return { rows: [], rowCount: 1 }; } },
    appPackageDir: path.resolve(here, '..'),
  });
  return {
    guide: router.routes.get('post /guide'),
    pptx: router.routes.get('post /pptx'),
  };
}

test.after(async () => {
  Module._load = originalLoad;
  await fs.rm(artifactRoot, { recursive: true, force: true });
});

test('Guide actions reach the editor, real PPTX renderer, and owner-scoped local receipt', async () => {
  const { guide, pptx } = routes();
  assert.ok(guide, 'POST /guide is not registered');
  assert.ok(pptx, 'POST /pptx is not registered');

  const guideResponse = response();
  await guide({ oidc: { user: { sub: 'auth0|guide-owner' } }, body: {
    message: 'shape this quarterly review and add next steps', title: '', slides: [], theme: 'executive',
  } }, guideResponse);
  assert.equal(guideResponse.statusCode, 200);
  assert.equal(guideResponse.body.reply, 'I shaped the deck and selected the executive look.');
  assert.deepEqual(guideResponse.body.actions, [
    { op: 'set_title', title: 'Quarterly review' },
    { op: 'set_outline', slides: [
      { title: 'What changed', bullets: ['Three bounded improvements', 'TBD :: confirm metric'] },
    ] },
    { op: 'add_slide', title: 'Next steps', bullets: ['Confirm owner', 'Schedule review'] },
    { op: 'set_theme', theme: 'executive' },
  ]);

  const editor = editorStateFromActions(guideResponse.body.actions);
  assert.deepEqual(editor, {
    title: 'Quarterly review',
    theme: 'executive',
    slides: [
      { title: 'What changed', bullets: ['Three bounded improvements', 'TBD :: confirm metric'] },
      { title: 'Next steps', bullets: ['Confirm owner', 'Schedule review'] },
    ],
  });

  const html = await fs.readFile(path.join(here, '..', 'tools', 'presentations.html'), 'utf8');
  assert.match(html, /set_field.*title/);
  assert.match(html, /set_content.*outline/);
  assert.match(html, /custom.*add_slide/);
  assert.match(html, /custom.*update_slide/);

  const artifactResponse = response();
  await pptx({ oidc: { user: { sub: 'auth0|guide-owner' } }, body: {
    title: editor.title,
    theme: editor.theme,
    sections: editor.slides.map((slide) => ({ title: slide.title, content: slide.bullets.join('\n') })),
  } }, artifactResponse);
  assert.equal(artifactResponse.statusCode, 200);
  assert.equal(artifactResponse.body.ok, true);
  assert.equal(artifactResponse.body.provider, 'oshal-local');
  assert.equal(artifactResponse.body.format, 'pptx');
  assert.equal(artifactResponse.body.slides, 2);
  assert.equal(artifactResponse.body.theme, 'executive');
  assert.equal(emailCalls, 0, 'Guide-to-artifact must not email or broadcast');
  assert.equal(deleteCalls, 0, 'Guide-to-artifact must not delete or recycle files');
  assert.equal(saved.length, 1);
  assert.match(saved[0].location, /^oshal-local\/oshal\/a0000000-0000-0000-0000-000000000042\/Quarterly review\.pptx$/);
  assert.ok(saved[0].bytes > 1000);

  const bytes = await fs.readFile(saved[0].filePath);
  assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'saved artifact must be a ZIP/PPTX');
  const JSZip = require(path.join(frameworkRoot, 'node_modules', 'jszip'));
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file('ppt/presentation.xml'), 'PPTX presentation part is missing');
  assert.ok(zip.file('ppt/slides/slide1.xml'), 'PPTX slide part is missing');
  assert.ok(zip.file('ppt/slides/slide2.xml'), 'second editor slide is missing');
  assert.ok(poolQueries.some(([sql]) => String(sql).includes('INSERT INTO oshal_presentations')));
});
