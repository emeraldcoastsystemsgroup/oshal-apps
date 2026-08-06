/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add APP-05 real-Chromium coverage for the compiled Kalshi Settings/Alerts route and surface through a signed local-session boundary, including caller-scoped persistence, operator-only deployment settings, cross-user isolation, and fail-closed anonymous/forged requests.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PACKAGE_DIR, 'routes', 'kalshi-routes.js');
const COOKIE_NAME = 'kalshi_fixture_session';
const DEPLOYMENT_SCOPE = '__deployment__';
const scanConfig = require(path.join(PACKAGE_DIR, 'routes', 'kalshi-scan-config.js'));

const ACCOUNTS = Object.freeze({
  member: Object.freeze({ password: 'member-browser-contract', sub: 'auth0|kalshi-member', operator: false }),
  victim: Object.freeze({ password: 'victim-browser-contract', sub: 'auth0|kalshi-victim', operator: false }),
  operator: Object.freeze({ password: 'operator-browser-contract', sub: 'auth0|kalshi-operator', operator: true }),
});

/** Resolve a test dependency from an explicit module, this checkout, or the sibling framework. */
function resolveDependency(name, explicitEnv) {
  const dependencyRoot = process.env.KALSHI_BROWSER_DEPS;
  const candidates = [
    explicitEnv,
    name,
    dependencyRoot ? path.join(dependencyRoot, 'node_modules', name) : '',
    path.resolve(__dirname, '../../../oshal/node_modules', name),
    path.join('c:/Projects/oshal/node_modules', name),
  ].filter(Boolean);
  const failures = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error.code || error.message}`);
    }
  }
  throw new Error(
    `BLOCKED: ${name} is required for the Kalshi browser contract. ` +
    `Set KALSHI_BROWSER_DEPS or ${name.toUpperCase()}_MODULE. Tried ${failures.join('; ')}`,
  );
}

/** Build the manifest-shaped schema needed by the real surface from the package's pure config. */
function buildSettingsSchema() {
  const labels = {
    scanIntervalMinutes: 'Scan every (minutes)',
    notifyOutward: 'Also send to my notification channel',
    alertMaxPerDay: 'Maximum alerts per day',
  };
  return Object.fromEntries(Object.entries(scanConfig.SCOPE_OF).map(([key, scope]) => {
    const value = scanConfig.KALSHI_SCAN_DEFAULTS[key];
    const spec = { default: value, label: labels[key] || key, scope };
    if (key === 'alertMinStrength') return [key, { ...spec, type: 'string', enum: ['monster', 'strong', 'playable'] }];
    if (typeof value === 'boolean') return [key, { ...spec, type: 'boolean' }];
    if (typeof value === 'number') return [key, { ...spec, type: key === 'alertMinEdgeCents' ? 'number' : 'integer' }];
    return [key, { ...spec, type: 'string' }];
  }));
}

/** Create deterministic collaborators outside the route/UI/auth boundary under test. */
function createFixtureState() {
  return {
    schema: buildSettingsSchema(),
    settings: new Map(),
    writes: [],
    alerts: new Map([
      [ACCOUNTS.member.sub, [{
        ticker: 'KXMEMBER-YES', strength: 'strong', edge_net: 0.061, channel: 'jarvis',
        delivered: true, created_at: '2026-08-06T10:00:00.000Z',
        detail: { title: 'Member-only inflation market', side: 'yes' },
      }]],
      [ACCOUNTS.victim.sub, [{
        ticker: 'KXVICTIM-NO', strength: 'playable', edge_net: 0.032, channel: 'jarvis',
        delivered: true, created_at: '2026-08-06T11:00:00.000Z',
        detail: { title: 'Victim-only jobs market', side: 'no' },
      }]],
    ]),
  };
}

/** Resolve the same deployment-then-user configuration layering as the package store. */
function resolvedConfig(state, sub) {
  const layers = [{ patch: state.settings.get(DEPLOYMENT_SCOPE) || {}, scope: 'deployment' }];
  if (sub) layers.push({ patch: state.settings.get(sub) || {}, scope: 'user' });
  return scanConfig.resolveScanConfig(layers);
}

/** Build the small persistence/provider seam used while the actual compiled router handles HTTP. */
function buildRouteCollaborators(state) {
  const engine = {
    DEPLOYMENT_SCOPE,
    manifestSettingsSchema: () => state.schema,
    readSettingsRow: async (_pool, key) => ({ ...(state.settings.get(key) || {}) }),
    resolveConfig: async (_ctx, sub) => resolvedConfig(state, sub),
    writeSettingsRow: async (_pool, key, scope, value) => {
      const stored = scanConfig.scopedPatch(value, scope);
      state.settings.set(key, { ...stored });
      state.writes.push({ key, scope, stored: { ...stored } });
      return stored;
    },
    listAlerts: async (_pool, sub, limit) => (state.alerts.get(sub) || []).slice(0, limit),
    readSnapshot: async () => null,
    loadCalibration: () => ({ table: null, mtime: null }),
  };
  const cron = {
    ALERT_TOPIC: 'kalshi-edge',
    startKalshiScanCron: () => undefined,
    scanRuntimeStatus: () => ({ running: false, startedAt: null, lastError: null, lastMs: null, lastSource: null, cyclesRun: 0 }),
    manualRunAllowed: () => ({ allowed: true, retryAfterSeconds: 0 }),
    scanNow: async () => undefined,
  };
  return { engine, cron };
}

/** Load the production compiled route while substituting only its out-of-boundary collaborators. */
function loadCompiledRoute(express, state) {
  const originalLoad = Module._load;
  const { engine, cron } = buildRouteCollaborators(state);
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'express') return express;
    if (request === '@/shared/logger') return { createChildLogger: () => logger };
    if (request === '@/shared/middleware/authz') return { isOperator: (req) => req.kalshiFixtureSession?.operator === true };
    if (request === '@/app/routes/connectors-routes') return { getValidAccessToken: async () => null };
    if (request === '@/app/routes/trading-routes-helpers') return routeHelpers();
    if (request === '@/features/prediction-markets') return predictionMarketSeam();
    if (request === './kalshi-scan-engine' && parent?.filename === ROUTE_FILE) return engine;
    if (request === './kalshi-scan-cron' && parent?.filename === ROUTE_FILE) return cron;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[ROUTE_FILE];
  try {
    return require(ROUTE_FILE).createKalshiRoutes;
  } finally {
    Module._load = originalLoad;
  }
}

/** Provide the framework helpers used by the package route without replacing route behavior. */
function routeHelpers() {
  return {
    callerSub: (req) => req.oidc?.user?.sub || null,
    servePage: (dir, file) => (_req, res) => res.sendFile(path.join(dir, file)),
  };
}

/** Provide inert market/provider operations; Settings and Alerts never call these operations. */
function predictionMarketSeam() {
  return {
    exchangeTradingActive: async () => false,
    getScorecard: async () => [],
    kalshiLiveOrdersEnabled: () => false,
    parseKalshiSecret: () => { throw new Error('not configured in browser contract'); },
    getKalshiPortfolio: async () => { throw new Error('not configured in browser contract'); },
    validateOrderRequest: () => { throw new Error('orders are outside this contract'); },
    placeKalshiOrder: async () => { throw new Error('orders are outside this contract'); },
    cancelKalshiOrder: async () => { throw new Error('orders are outside this contract'); },
  };
}

/** Compare two strings without early-exit timing differences. */
function safeTextEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Issue an HMAC-authenticated, short-lived local browser session. */
function signSession(account, secret) {
  const body = Buffer.from(JSON.stringify({
    sub: account.sub,
    operator: account.operator,
    exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/** Verify and decode a local session cookie; malformed, expired, or forged values return null. */
function verifySession(token, secret) {
  try {
    const [body, supplied] = String(token || '').split('.');
    if (!body || !supplied) return null;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (!safeTextEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

/** Read one cookie value from an HTTP Cookie header. */
function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

/** Add the fixture's signed-session issuer and fail-closed session verifier. */
function installSessionBoundary(app, express, secret) {
  app.post('/__fixture/session', express.json(), (req, res) => {
    const account = ACCOUNTS[String(req.body?.account || '')];
    if (!account || !safeTextEqual(req.body?.password, account.password)) {
      res.status(401).json({ error: 'invalid fixture credentials' });
      return;
    }
    const token = signSession(account, secret);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ authenticated: true, sub: account.sub, operator: account.operator });
  });
  return (req, res, next) => {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    const session = verifySession(token, secret);
    if (!session) { res.status(401).json({ error: 'authentication required' }); return; }
    req.oidc = { user: { sub: session.sub } };
    req.kalshiFixtureSession = session;
    next();
  };
}

/** Start a real ephemeral Express server with the actual compiled Kalshi router mounted. */
async function startFixture(express, state) {
  const app = express();
  const secret = crypto.randomBytes(32);
  const requiresSession = installSessionBoundary(app, express, secret);
  const createKalshiRoutes = loadCompiledRoute(express, state);
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  app.use(express.json());
  app.use('/api/kalshi', requiresSession, createKalshiRoutes({ pool, appPackageDir: PACKAGE_DIR }));
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

/** Close a fixture listener and any idle keep-alive connections. */
async function stopFixture(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

/** Establish a browser context through the real signed-cookie login endpoint. */
async function loginContext(browser, base, accountName) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const account = ACCOUNTS[accountName];
  const response = await context.request.post(`${base}/__fixture/session`, {
    data: { account: accountName, password: account.password },
  });
  assert.equal(response.status(), 200, `${accountName} fixture login must succeed`);
  return context;
}

/** Prove every relevant HTTP entry point closes before a missing/forged session can mutate state. */
async function assertUnauthorized(playwright, base, state) {
  const request = await playwright.request.newContext();
  const before = state.writes.length;
  try {
    assert.equal((await request.get(`${base}/api/kalshi/`)).status(), 401);
    assert.equal((await request.get(`${base}/api/kalshi/settings`)).status(), 401);
    assert.equal((await request.get(`${base}/api/kalshi/alerts`)).status(), 401);
    assert.equal((await request.put(`${base}/api/kalshi/settings`, {
      data: { scope: 'user', settings: { alertMaxPerDay: 48 } },
    })).status(), 401);
    const forged = await playwright.request.newContext({
      extraHTTPHeaders: { cookie: `${COOKIE_NAME}=forged.payload` },
    });
    try {
      assert.equal((await forged.get(`${base}/api/kalshi/settings`)).status(), 401);
    } finally {
      await forged.dispose();
    }
    assert.equal(state.writes.length, before, 'unauthorized requests must not reach settings storage');
  } finally {
    await request.dispose();
  }
}

/** Drive the member Settings/Alerts tabs and prove caller-scoped storage and alert isolation. */
async function exerciseMemberBrowser(browser, base, state) {
  const context = await loginContext(browser, base, 'member');
  const page = await context.newPage();
  try {
    await page.goto(`${base}/api/kalshi/`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-tab="settings"]').click();
    await page.locator('#set-f-notifyOutward').waitFor();
    assert.equal(await page.locator('#set-f-scanIntervalMinutes').isDisabled(), true);
    await page.locator('#set-f-notifyOutward').check();
    await page.locator('#set-f-alertMaxPerDay').fill('2');
    await page.locator('#set-save').click();
    await page.locator('#set-msg').filter({ hasText: 'Saved' }).waitFor();
    const settingsResponse = await context.request.get(`${base}/api/kalshi/settings`);
    const settings = await settingsResponse.json();
    assert.equal(settings.overrides.user.notifyOutward, true);
    assert.equal(settings.overrides.user.alertMaxPerDay, 2);
    assert.equal(settings.editable.deployment.length, 0);

    await page.locator('[data-tab="alerts"]').click();
    await page.locator('#alert-rows tr').first().waitFor();
    const alertsText = await page.locator('#alert-rows').innerText();
    assert.match(alertsText, /Member-only inflation market/);
    assert.doesNotMatch(alertsText, /Victim-only jobs market/);

    const denied = await context.request.put(`${base}/api/kalshi/settings`, {
      data: { scope: 'deployment', settings: { scanIntervalMinutes: 5 } },
    });
    assert.equal(denied.status(), 403);
    assert.equal(state.settings.has(DEPLOYMENT_SCOPE), false);
  } finally {
    await context.close();
  }
}

/** Prove a body-supplied subject cannot redirect a user-scope write to another owner. */
async function assertSubjectSubstitutionBlocked(browser, base, state) {
  const member = await loginContext(browser, base, 'member');
  const victim = await loginContext(browser, base, 'victim');
  try {
    const write = await member.request.put(`${base}/api/kalshi/settings`, {
      data: { scope: 'user', user_sub: ACCOUNTS.victim.sub, settings: { alertTopN: 9 } },
    });
    assert.equal(write.status(), 200);
    const victimRead = await victim.request.get(`${base}/api/kalshi/settings`);
    const victimSettings = await victimRead.json();
    assert.equal(victimSettings.config.alertTopN, scanConfig.KALSHI_SCAN_DEFAULTS.alertTopN);
    assert.equal(state.settings.has(ACCOUNTS.victim.sub), false);
    assert.equal(state.writes.at(-1).key, ACCOUNTS.member.sub);
  } finally {
    await member.close();
    await victim.close();
  }
}

/** Drive an operator save and prove deployment settings become the shared lower-precedence layer. */
async function exerciseOperatorBrowser(browser, base) {
  const operator = await loginContext(browser, base, 'operator');
  const member = await loginContext(browser, base, 'member');
  const page = await operator.newPage();
  try {
    await page.goto(`${base}/api/kalshi/`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-tab="settings"]').click();
    await page.locator('#set-f-scanIntervalMinutes').waitFor();
    assert.equal(await page.locator('#set-f-scanIntervalMinutes').isEnabled(), true);
    await page.locator('#set-f-scanIntervalMinutes').fill('15');
    await page.locator('#set-save').click();
    await page.locator('#set-msg').filter({ hasText: 'Saved' }).waitFor();
    const sharedResponse = await member.request.get(`${base}/api/kalshi/settings`);
    const shared = await sharedResponse.json();
    assert.equal(shared.deploymentConfig.scanIntervalMinutes, 15);
    assert.equal(shared.config.scanIntervalMinutes, 15);
  } finally {
    await operator.close();
    await member.close();
  }
}

test('Kalshi Settings/Alerts hold through Chromium, HTTP, route, and signed-session boundaries', { timeout: 60_000 }, async (t) => {
  const playwright = resolveDependency('playwright', process.env.PLAYWRIGHT_MODULE);
  const express = resolveDependency('express', process.env.EXPRESS_MODULE);
  const state = createFixtureState();
  const fixture = await startFixture(express, state);
  const browser = await playwright.chromium.launch({ headless: process.env.KALSHI_HEADED !== '1' });
  t.after(async () => {
    await browser.close();
    await stopFixture(fixture.server);
  });

  await t.test('anonymous and forged sessions fail closed before storage', () =>
    assertUnauthorized(playwright, fixture.base, state));
  await t.test('member browser saves own settings, sees own alerts, and cannot edit deployment scope', () =>
    exerciseMemberBrowser(browser, fixture.base, state));
  await t.test('a body-substitution attempt remains bound to the authenticated caller', () =>
    assertSubjectSubstitutionBlocked(browser, fixture.base, state));
  await t.test('operator browser saves the deployment cadence shared by members', () =>
    exerciseOperatorBrowser(browser, fixture.base));
});
