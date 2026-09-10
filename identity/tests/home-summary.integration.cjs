/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Real PostgreSQL access/persistence and real Chromium acceptance for the Identity/Home slice.
 * Run from the core checkout with HOME_TEST_DATABASE_URL pointing to a disposable home_summary_test DB.
 */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const core = path.resolve(process.env.HOME_TEST_CORE || path.join(__dirname, '../../../oshal'));
const load = createRequire(path.join(core, 'package.json'));
process.env.TSX_TSCONFIG_PATH = path.join(core, 'tsconfig.json');
process.env.NODE_PATH = path.join(core, 'node_modules');
require('node:module').Module._initPaths();
load('tsx/cjs');
const { Pool } = load('pg');
const express = load('express');
const { chromium } = load('playwright');
const { wrapPoolWithGuc } = load(path.join(core, 'src/shared/services/database/guc-pool.ts'));
const { runWithRequestIdentity } = load(path.join(core, 'src/shared/services/database/request-identity.ts'));
const { buildOwnerRlsPolicyStatements } = load(path.join(core, 'src/shared/services/database/owner-rls-policy.ts'));
const { createAppHomePreferenceRoutes, readHomePreferences, saveHomePreferences } = load(path.join(core, 'src/app/routes/app-home-preferences.ts'));
const { createIdentitySummaryRoutes, identitySummary } = require('../routes/identity-summary.js');
const { buildHomePlan, readManifest } = load(path.join(core, 'src/features/swarm-apps/index.ts'));

async function main() {
  const url = new URL(process.env.HOME_TEST_DATABASE_URL || 'postgresql://localhost/invalid');
  assert.equal(url.pathname, '/home_summary_test', 'Use the dedicated disposable test database');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Test DB must be local');
  const tag = crypto.randomBytes(6).toString('hex'), schema = `home_${tag}`, role = `home_${tag}`;
  const admin = new Pool({ connectionString: url.href });
  let pool, browser, server;
  const as = (sub, fn) => runWithRequestIdentity({ sub, isOperator: false }, fn);
  try {
    await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${role} LOGIN PASSWORD 'fixture-only'; GRANT USAGE ON SCHEMA ${schema} TO ${role}; SET search_path TO ${schema}`);
    await admin.query('CREATE TABLE user_preferences (user_id text PRIMARY KEY, updated_at timestamptz DEFAULT now())');
    await admin.query(fs.readFileSync(path.join(core, 'scripts/migrations/126-app-home-preferences.sql'), 'utf8'));
    for (const sql of buildOwnerRlsPolicyStatements('user_preferences', 'user_id')) await admin.query(sql);
    await admin.query(`CREATE TABLE oshal_tenant_memberships (tenant_id uuid, user_sub text);
      CREATE TABLE oshal_connections (connection_id text, user_sub text, connected_by_sub text, tenant_id uuid,
      provider text, label text, account_key text, is_default boolean, account_email text, account_id text, scopes text,
      access_token text, refresh_token text, expiry timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role};
      REVOKE INSERT, UPDATE, DELETE ON oshal_connections, oshal_tenant_memberships FROM ${role}`);
    const tenant = '00000000-0000-4000-8000-000000000001';
    await admin.query('INSERT INTO oshal_tenant_memberships VALUES ($1,$2)', [tenant, 'viewer-a']);
    const fixture = [
      ['expired', 'viewer-a', null, 'mail', null, -1],
      ['renewable', 'viewer-a', null, 'mail', 'fixture-refresh', -1],
      ['soon', 'viewer-a', null, 'calendar', null, 2],
      ['shared', 'owner-c', tenant, 'storage', null, null],
      ['private-b', 'viewer-b', null, 'other', null, null],
    ];
    for (const [id, sub, shared, provider, refresh, days] of fixture) await admin.query(`INSERT INTO oshal_connections
      (connection_id,user_sub,tenant_id,provider,refresh_token,expiry,access_token) VALUES ($1,$2,$3,$4,$5,$6,'fixture-secret-never-return')`,
      [id, sub, shared, provider, refresh, days === null ? null : new Date(Date.now() + days * 86400000)]);
    const roleUrl = new URL(url); roleUrl.username = role; roleUrl.password = 'fixture-only';
    pool = wrapPoolWithGuc(new Pool({ connectionString: roleUrl.href, options: `-c search_path=${schema}` }));
    assert.deepEqual(await as('viewer-a', () => readHomePreferences(pool, 'viewer-a')), { preferences: { version: 1 }, revision: 0 });
    assert.equal(await as('viewer-a', () => saveHomePreferences(pool, 'viewer-a', { version: 1, hiddenApps: ['notes'] }, 0)), 1);
    assert.equal(await as('viewer-a', () => saveHomePreferences(pool, 'viewer-a', { version: 1 }, 0)), null);
    assert.equal((await as('viewer-b', () => readHomePreferences(pool, 'viewer-b'))).revision, 0);
    assert.equal((await as('viewer-b', () => pool.query('SELECT * FROM user_preferences'))).rows.length, 0, 'Actual RLS hides other users even without an owner predicate');
    await assert.rejects(as('viewer-b', () => saveHomePreferences(pool, 'viewer-a', { version: 1 }, 0)), /row-level security/);
    await as('viewer-a', () => saveHomePreferences(pool, 'viewer-a', { version: 1 }, 1));
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      const sub = /mock_user=([^;]+)/.exec(req.headers.cookie || '')?.[1] || 'viewer-a';
      req.oidc = { isAuthenticated: () => sub !== 'anonymous', user: { sub } };
      as(sub, () => next());
    });
    app.use('/api/home/preferences', createAppHomePreferenceRoutes({ pool }));
    app.use('/api/identity', createIdentitySummaryRoutes({ pool }));
    const manifest = readManifest(path.resolve(__dirname, '../oshal-app.yaml'));
    const entries = buildHomePlan([manifest, { name: 'notes', displayName: 'Notes', suite: 'ai-knowledge', ui: { static: [{ toolName: 'notes-home' }] } }, { name: 'archive', displayName: 'Archive', suite: 'ai-productivity' }]);
    app.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: entries }));
    app.get('/api/jarvis/tasks', (_req, res) => res.json({ tasks: [] }));
    app.use('/cockpit', express.static(path.join(core, 'src/pages/cockpit')));
    app.get('/', (_req, res) => res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home slice acceptance</title><link rel="stylesheet" href="/cockpit/css/apps-home.css"><style>:root{--bg-primary:#111827;--bg-card:#1b2638;--text-primary:#e5e7eb;--text-secondary:#adbbcd;--border-color:#435067;--accent-primary:#77baff;--status-warning:#ffcb77}body{margin:0;background:var(--bg-primary);color:var(--text-primary);font-family:system-ui}#navigation{padding:8px}</style></head><body><p id="navigation">Local acceptance fixture: mock sign-in, real PostgreSQL and package extractor.</p><main id="home"></main><script type="module">import {AppsHomeView} from '/cockpit/js/views/AppsHomeView.js';window.home=new AppsHomeView({navigateToView:id=>document.querySelector('#navigation').textContent=id});window.home.render(document.querySelector('#home'));</script></body></html>`));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const summary = await (await fetch(base + '/api/identity/summary')).json();
    const values = Object.fromEntries(summary.metrics.map(m => [m.id, m.value]));
    assert.deepEqual(values, { 'saved-accounts': '4', reconnect: '1', 'expires-7d': '1', 'shared-accounts': '1', providers: '3' });
    assert.ok(!JSON.stringify(summary).includes('fixture-secret'));
    assert.equal((await fetch(base + '/api/identity/summary', { headers: { cookie: 'mock_user=anonymous' } })).status, 401);
    const other = await (await fetch(base + '/api/identity/summary', { headers: { cookie: 'mock_user=viewer-b' } })).json();
    assert.equal(other.metrics[0].value, '1');
    assert.equal(identitySummary([], 0).metrics[0].value, '0');
    await admin.query('ALTER TABLE oshal_connections RENAME TO temporarily_unavailable');
    assert.equal((await fetch(base + '/api/identity/summary')).status, 503);
    await admin.query('ALTER TABLE temporarily_unavailable RENAME TO oshal_connections');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByText('Saved accounts', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-card]').count(), 3);
    await page.locator('[data-card="identity"] button[data-action="edit"]').click();
    await page.getByLabel('Providers saved', { exact: true }).uncheck();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('[data-card="identity"]').getByText('Providers saved', { exact: true }).count(), 0);
    await page.reload(); await page.getByText('Saved accounts', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-card="identity"]').getByText('Providers saved', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByLabel('Notes', { exact: true }).uncheck();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('[data-card="notes"]').count(), 0);
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('button', { name: 'Move archive up', exact: true }).click();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('[data-card]').first().getAttribute('data-card'), 'archive');
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('button', { name: 'Restore all defaults', exact: true }).click();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('[data-card]').count(), 3);
    assert.equal(await page.locator('[data-card="identity"]').getByText('Providers saved', { exact: true }).count(), 1);
    // Keyboard editing retains focus after persistence, and metric/suite ordering is real DOM order.
    await page.locator('[data-card="identity"] button[data-action="edit"]').click();
    await page.getByRole('button', { name: 'Move identity/providers up', exact: true }).click();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByLabel('Compact box', { exact: true }).focus();
    await page.keyboard.press('Space');
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    assert.equal(await page.getByLabel('Compact box', { exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('[data-card="identity"]').getAttribute('class'), 'apps-home-card is-compact');
    assert.equal((await page.locator('[data-card="identity"] .apps-home-tile-label').allTextContents())[3], 'Providers saved');
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('button', { name: 'Move ai-knowledge up', exact: true }).click();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('.apps-home-shelf-head h3').first().textContent(), 'AI Knowledge');
    await page.locator('.apps-home-shelf').first().getByRole('button', { name: 'Collapse', exact: true }).click();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    assert.equal(await page.locator('[data-card="notes"]').count(), 0);
    await page.locator('.apps-home-shelf').first().getByRole('button', { name: 'Expand', exact: true }).click();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('button', { name: 'Restore all defaults', exact: true }).click();
    await page.getByText('Display settings saved.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // A failed write must not leave an apparently saved layout behind.
    await page.route('**/api/home/preferences', async route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Test save unavailable"}' }) : route.continue());
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByLabel('Notes', { exact: true }).click();
    await page.getByText(/Your changes were not applied/).first().waitFor();
    assert.equal(await page.getByLabel('Notes', { exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.unroute('**/api/home/preferences');
    await page.reload(); await page.getByText('Saved accounts', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Saved accounts', { exact: true }).waitFor();
    const output = path.resolve(__dirname, '../../../oshal/output/home-summary-acceptance'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: real PostgreSQL RLS, revision conflicts, connection scope, honest failures, browser hide/order/reset/reload/save failure, desktop/mobile.');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
