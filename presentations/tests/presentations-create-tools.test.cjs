/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | deck-builder can make the file. Asked from Jarvis for a PowerPoint it called no tool (its one tool was presentations-list) and answered an outline of TBD lines. The manifest declares presentations-create-deck and presentations-create-document as automatic route writes onto POST /pptx and /docx, the exact body their inputSchema describes renders and saves through the compiled route, and the persona tells the bot to call them instead of sending the person to Generate.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A made file answers openUrl, and an open= link reopens that saved file in the studio (Jarvis never offered to open a deck it made).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }; }, raw: () => (_q, _s, next) => next && next() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': {
    PresentationEngine: class {}, renderPptx: async () => Buffer.from('PK'), renderDocx: async () => Buffer.from('PK'), renderXlsx: async () => Buffer.from('PK'),
    themeCatalog: () => [], layoutCatalog: () => [], isThemeId: () => false, DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}),
    brandTheme: () => { throw new Error('no brand in these cases'); },
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({}), listFolder: async () => ({ files: [] }), deleteStoredFile: async () => ({}),
    saveContent: async (_ctx, _sub, _kind, name) => ({ provider: 'oshal-local', location: `oshal/a0000000-0000-0000-0000-000000000042/${name}`, downloadUrl: '/dl/x' }),
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '[]' }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/slack-client': { uploadSlackFile: async () => ({}) },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');
test.after(() => { Module._load = original; });

const PKG = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');

/** One declared tool's block of the manifest, from its `- name:` line to the next tool or section. */
function toolBlock(name) {
  const start = manifest.indexOf(`  - name: ${name}\n`);
  assert.ok(start >= 0, `${name} is declared`);
  const rest = manifest.slice(start + 1);
  const end = rest.search(/\n {2}- name: |\n[a-z]/);
  return rest.slice(0, end < 0 ? undefined : end);
}

/** Call one compiled route with the body a tool sends. */
async function post(route, body) {
  const ctx = { pool: { query: async () => ({ rows: [], rowCount: 1 }) }, appPackageDir: PKG };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; }, setHeader() {} };
  await createBotPresentationRoutes(ctx).routes[route]({ oidc: { user: { sub: 'alice' } }, query: {}, params: {}, body }, res);
  return res;
}

for (const [name, kind] of [['presentations-create-deck', 'pptx'], ['presentations-create-document', 'docx']]) {
  test(`${name} is an automatic route write onto POST /${kind}`, () => {
    const block = toolBlock(name);
    assert.match(block, new RegExp(`apiEndpoint: "POST /api/presentations/sections/${kind}"`));
    assert.match(block, /defaultAuthMode: auto/);
    assert.match(block, /requiresApproval: false/);
    assert.match(block, /required: \[title, sections\]/);
  });

  test(`the body ${name} sends renders and saves a ${kind}`, async () => {
    const res = await post(`POST /${kind}`, { title: 'Q3 review', sections: [{ title: 'Where we are', content: 'revenue up\nchurn flat' }, { title: 'Next', content: 'hire two' }] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.slides, 2);
    assert.equal(res.body.savedTo, `oshal/a0000000-0000-0000-0000-000000000042/Q3 review.${kind}`);
    assert.equal(res.body.openUrl, `/cockpit/?app=presentations&open=${encodeURIComponent(`Q3 review.${kind}`)}`);
  });
}

test('the persona tells deck-builder to make the file instead of sending the person to Generate', () => {
  const persona = fs.readFileSync(path.join(PKG, 'personas', 'deck-builder.yaml'), 'utf8');
  assert.match(persona, /call `presentations-create-deck`/);
  assert.match(persona, /Do not ask them to click Generate/);
  assert.match(persona, /never say a file was made that the\s+tool did not return/);
});

test('an open= link reopens that saved file from My files in the studio', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'presentations.html'), 'utf8');
  assert.match(html, /const opening = p\.get\('open'\);/);
  assert.match(html, /async function openFromLink\(name\)/);
  assert.match(html, /fetch\('\/api\/presentations\/sections\/list'\)/);
  assert.match(html, /el\.onclick = \(\) => reopenDeck\(recent\[/, 'Jump back in and the link reopen the same way');
});

