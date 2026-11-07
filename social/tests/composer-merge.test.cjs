/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | UX audit batch-7 (social--social-composer MERGE): verify social-composer stays in ui.static below social-workspace with label Compose so business-experience and prepare-post keep resolving it, /api/social/composer redirects to /api/social/workspace?view=compose outside AppView audience mode, Workspace Compose carries Composer's refine chips and free prompt, and neither surface prints '/utilities' or the 'Want a feed here?' callout.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | 1.7.0: Compose and Workspace are one application. ui.static carries one social-workspace tile and no social-composer tile; prepare-post and business-experience name social-workspace; tools/social-composer.html is gone; the compiled router answers GET /composer with a 302 to /api/social/workspace (view=compose, every query parameter kept); Workspace Compose carries every Composer capability (refine chips, free prompt, AI draft, LinkedIn/X/Facebook publish, prepare-post handoff and direct query prefill, connected-application offers), all gated on the full page.
 * -----------------------------------------------------------------------------
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(STORE, 'scripts', 'toolchain', 'node_modules');

/** @returns {Function} createSocialRoutes from the COMPILED router, with the platform imports stood in. */
function compiledRouter() {
  const express = require(path.join(TOOLCHAIN, 'express'));
  const silent = { error() {}, info() {}, warn() {}, debug() {}, child() { return silent; } };
  const stand = () => new Proxy({ createChildLogger: () => silent }, { get: (t, k) => (k in t ? t[k] : k === '__esModule' ? true : async () => null) });
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'express') return express;
    if (request.startsWith('@/')) return stand();
    return original.call(this, request, parent, isMain);
  };
  try {
    return { express, createSocialRoutes: require(path.join(PKG, 'routes', 'social-routes.js')).createSocialRoutes };
  } finally {
    Module._load = original;
  }
}

test('ui.static carries one Workspace tile and no Composer tile; prepare-post and Business name social-workspace', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /toolName: social-workspace\n\s+label: Workspace\n\s+icon: codicon codicon-layout\n\s+iframeUrl: \/api\/social\/workspace\n/);
  assert.doesNotMatch(manifest, /toolName: social-composer/, 'the duplicate Composer tile is gone');
  assert.match(manifest, /ribbon:[\s\S]*?defaultView: social-workspace/);
  assert.match(manifest, /accepts:[\s\S]*?id: prepare-post[\s\S]*?surface: social-workspace/);
  assert.doesNotMatch(manifest, /surface: social-composer/);

  const bizManifest = fs.readFileSync(path.join(STORE, 'business-experience', 'oshal-app.yaml'), 'utf8');
  assert.match(bizManifest, /- app: social\n\s+surface: social-workspace\n\s+audience: company/);
  assert.doesNotMatch(bizManifest, /social-composer/);
  const bizConfig = fs.readFileSync(path.join(STORE, 'business-experience', 'ui', 'config.js'), 'utf8');
  assert.match(bizConfig, /"app": "social",[\s\S]*?"surfaces": \[\s*"social-workspace"\s*\]/);
  assert.doesNotMatch(bizConfig, /social-composer/);
  assert.equal(fs.existsSync(path.join(PKG, 'tools', 'social-composer.html')), false, 'no second compose page ships');
});

test('the compiled router sends the old Composer address to Workspace Compose and keeps every query parameter', async (t) => {
  const { express, createSocialRoutes } = compiledRouter();
  const app = express();
  app.use('/api/social', createSocialRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: PKG }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const at = async (p) => { const r = await fetch(base + p, { redirect: 'manual' }); return [r.status, r.headers.get('location')]; };
  assert.deepEqual(await at('/api/social/composer'), [302, '/api/social/workspace?view=compose']);
  assert.deepEqual(await at('/api/social/composer?handoff=h123'), [302, '/api/social/workspace?handoff=h123&view=compose']);
  assert.deepEqual(await at('/api/social/composer?title=Launch&notes=Hi+there&audience=company'),
    [302, '/api/social/workspace?title=Launch&notes=Hi+there&audience=company&view=compose']);
  assert.deepEqual(await at('/api/social/composer?view=saved'), [302, '/api/social/workspace?view=saved'], 'an explicit view is kept');
  const ws = await fetch(base + '/api/social/workspace');
  assert.equal(ws.status, 200);
  assert.match(await ws.text(), /id="pubBtn"/);
});

test('Workspace Compose carries every Composer capability, all gated on the full page', () => {
  const ws = fs.readFileSync(path.join(PKG, 'tools', 'social-workspace.html'), 'utf8');
  for (const chip of ['Punchier', 'Shorter', 'More technical', 'Add CTA', 'End with a question']) {
    assert.ok(ws.includes(chip), `Workspace Compose carries refine chip: ${chip}`);
  }
  for (const id of ['refineInput', 'refineBtn', 'draftBtn', 'pubBtn', 'netsel', 'accounts', 'topic', 'text', 'count', 'connectedActions']) {
    assert.match(ws, new RegExp(`id="${id}"`), `Compose has #${id}`);
  }
  for (const call of ['/api/social/draft', '/api/social/content/refine', '/api/social/post', '/api/social/profiles']) {
    assert.ok(ws.includes(`'${call}'`), `Compose calls ${call}`);
  }
  assert.match(ws, /action:\s*'prepare-post'/);
  assert.doesNotMatch(ws, />\s*\/utilities\s*<\/a>/, 'Workspace never prints /utilities as link text');
  assert.doesNotMatch(ws, /Want a feed here\?/);
  assert.match(ws, /<a href="\/utilities" target="_top"[^>]*>Connect<\/a>/);

  const gate = ws.lastIndexOf('if (!window.AppView || !AppView.active()) {');
  assert.ok(gate > 0, 'the full-page start is gated');
  const start = ws.slice(gate, ws.indexOf('</script>', gate));
  for (const step of ["startParams.get('title')", "startParams.get('notes')", "startParams.get('sourceUrl')", "import('/cockpit/js/app-handoff.js')", "import('/cockpit/js/app-workflows.js')", 'mountConnectedActions', 'loadAccounts();']) {
    assert.ok(start.includes(step), `the gated start runs ${step}`);
  }
  assert.doesNotMatch(ws.slice(0, gate), /^\s*loadAccounts\(\);\s*$/m, 'no ungated start is left');
});
