/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The Streams post editor (tools/switchboard-streams.html) in headless Chromium over the package's
 *   REAL compiled Streams routes (routes/switchboard-streams-routes.js) on real express, against a disposable PostgreSQL
 *   database built from migrations/002-switchboard-stream-posts.sql, with the REAL shared module
 *   /shared/ui/js/document-handoff.js from the platform checkout. A manual unsaved edit is saved by beginDocumentHandoff()
 *   and the context carries the post id and its updatedAt revision; an edit through PATCH /posts/:id (standing in for the
 *   concierge) is redrawn by refresh(); the next manual edit reaches the next handoff. Failure shapes: a body the person is
 *   still editing survives a refresh that found a concierge change, and a save the route would refuse stops the handoff
 *   with the record unchanged. Named seams: a signed-in caller stub for OIDC, a static empty workspace list, inert
 *   stand-ins for the framework logger, schema bootstrap (the migration builds the schema), system identity, the write
 *   confirmation guard and compose's publisher (nothing is published). Needs the store toolchain (express, pg,
 *   playwright with chromium), OSHAL_TEST_POSTGRES and the platform checkout (OSHAL_PLATFORM_ROOT).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = [process.env.STORE_CI_TOOLCHAIN, process.env.STORE_CI_TOOLCHAIN && path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'),
  path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules')].filter(Boolean)
  .find((dir) => ['express', 'pg', 'playwright'].every((name) => fs.existsSync(path.join(dir, name, 'package.json'))));
if (!TOOLCHAIN) throw new Error('express, pg and playwright require scripts/toolchain/node_modules or STORE_CI_TOOLCHAIN');
const express = require(path.join(TOOLCHAIN, 'express'));
const { Pool, Client } = require(path.join(TOOLCHAIN, 'pg'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const PLATFORM = path.resolve(process.env.OSHAL_PLATFORM_ROOT || path.join(PKG, '..', '..', 'oshal-kernel', 'platform'));
const SHARED_UI = path.join(PLATFORM, 'src', 'shared', 'ui');
if (!fs.existsSync(path.join(SHARED_UI, 'js', 'document-handoff.js'))) throw new Error(`the shared handoff module is missing under ${SHARED_UI}; set OSHAL_PLATFORM_ROOT`);
const DSN = process.env.OSHAL_TEST_POSTGRES;
if (!DSN) throw new Error('OSHAL_TEST_POSTGRES must name the disposable PostgreSQL server for this suite');
const SUB = 'handoff-person';

/** Load the compiled Streams routes with only the framework boundaries replaced. */
function loadStreams() {
  const file = path.join(PKG, 'routes', 'switchboard-streams-routes.js');
  const deps = {
    express, path,
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/shared/services/database/request-identity': { runWithSystemIdentity: async (fn) => fn() },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (body) => !!body && body.confirm === true,
      confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true.` }),
    },
    './switchboard-compose-routes': { publishTo: async () => { throw new Error('this suite never publishes'); } },
    './switchboard-streams-model': require(path.join(PKG, 'routes', 'switchboard-streams-model.js')),
  };
  const m = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(file, 'utf8'))((name) => {
    if (name in deps) return deps[name];
    throw new Error('unexpected require ' + name);
  }, m, m.exports, file, path.dirname(file));
  return m.exports;
}

/** A disposable database with the declared Streams schema; dropped when the test ends. */
async function database(t) {
  const name = 'sb_handoff_' + crypto.randomBytes(6).toString('hex');
  const admin = new Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(DSN); url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  t.after(async () => { await pool.end(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); });
  await pool.query(fs.readFileSync(path.join(PKG, 'migrations', '002-switchboard-stream-posts.sql'), 'utf8'));
  return pool;
}

/** The page, its real routes and one saved draft, opened in the editor. */
async function open(t) {
  const pool = await database(t);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.oidc = { user: { sub: SUB }, isAuthenticated: () => true }; next(); });
  app.use('/api/switchboard/streams', loadStreams().createStreamsRoutes({ pool, appPackageDir: PKG }));
  app.get('/api/switchboard/workspaces', (_req, res) => res.json({ workspaces: [] }));
  app.use('/shared/ui', express.static(SHARED_UI));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/switchboard/streams`;
  const send = async (method, route, body) => {
    const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    assert.ok(r.ok, `${method} ${route} -> ${r.status} ${await r.clone().text()}`);
    return (await r.json()).post;
  };
  const created = await send('POST', '/posts', { title: 'Launch note', body: 'First saved body', platforms: ['x'] });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base + '/');
  await page.waitForFunction(() => window.__oshalDocumentSession);
  return { page, id: created.postId, read: () => send('GET', '/posts/' + created.postId), edit: (body) => send('PATCH', '/posts/' + created.postId, body) };
}
async function openPost(page) {
  await page.locator('.prow').first().click();
  await page.waitForFunction(() => document.getElementById('eBody') && document.getElementById('eBody').value === 'First saved body');
}
async function begin(page) {
  return page.evaluate(async () => {
    const api = await import('/shared/ui/js/document-handoff.js');
    window.documentHandoff = await api.beginDocumentHandoff(); return window.documentHandoff.context;
  });
}
const xVariant = '.vcard[data-platform="x"] textarea';

test('an unsaved edit is saved before the concierge reads, its saved change is redrawn, and the next edit is handed off', { timeout: 120000 }, async (t) => {
  const { page, id, read, edit } = await open(t);
  await openPost(page);
  await page.locator('#eBody').fill('Manual body before handoff');
  await page.locator(xVariant).fill('Manual X variant');
  const first = await begin(page);
  let saved = await read();
  assert.equal(first.recordId, id);
  assert.equal(first.app, 'switchboard');
  assert.equal(first.fields.revision, saved.updatedAt);
  assert.equal(saved.body, 'Manual body before handoff');
  assert.equal(saved.variants.find((v) => v.platform === 'x').body, 'Manual X variant');
  await edit({ body: 'The concierge rewrote this body' });
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.locator('#eBody').inputValue(), 'The concierge rewrote this body');
  assert.equal(await page.locator(xVariant).inputValue(), 'Manual X variant');
  await page.locator('#eBody').fill('My next manual change');
  const second = await begin(page);
  saved = await read();
  assert.equal(second.recordId, id);
  assert.notEqual(second.fields.revision, first.fields.revision);
  assert.equal(second.fields.revision, saved.updatedAt);
  assert.equal(saved.body, 'My next manual change');
  const clean = await begin(page);
  assert.equal(clean.fields.revision, second.fields.revision, 'an unchanged editor hands off without another save');
});

test('a body the person is still editing survives a concierge refresh, and a refused save stops the handoff', { timeout: 120000 }, async (t) => {
  const { page, id, read, edit } = await open(t);
  assert.equal(await begin(page), null, 'no post is open, so no snapshot is handed off');
  await openPost(page);
  const handed = await begin(page);
  assert.equal(handed.recordId, id);
  await page.locator('#eBody').fill('Still typing this');
  await edit({ body: 'The concierge saved this meanwhile' });
  await assert.rejects(page.evaluate(() => window.documentHandoff.refresh()), /Your edits are still here/);
  assert.equal(await page.locator('#eBody').inputValue(), 'Still typing this');
  assert.match(await page.locator('#edErrMsg').textContent(), /Your edits are still here/);
  assert.equal((await read()).body, 'The concierge saved this meanwhile');
  await page.locator('#eBody').fill('   ');
  await assert.rejects(begin(page), /master body can't be empty/);
  assert.equal((await read()).body, 'The concierge saved this meanwhile', 'a refused save writes nothing');
});
