/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.9.4 review-fix fail-first contract for the four shared-chat review blockers of
 *     |                                         | 1.9.4, in Chromium over the real Operations page and the kernel's one chat
 *     |                                         | window with a held stand-in provider: (1) an accepted packet over the
 *     |                                         | window's turn limit arrives whole as valid JSON with marked omissions, never
 *     |                                         | silently cut; (2) a direct window turn that settles while an outer Ask is
 *     |                                         | held never resolves that Ask; (3) the shared Stop during console planning
 *     |                                         | runs no local plan and no Kubernetes read, and the console stays usable;
 *     |                                         | (4) a direct reply that lands after an access clear stages nothing.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { fixture, loadExperience, root } = require('./fixtures/intake.cjs');

const OUTER_COMMAND = ['aws', 'eks', 'list-clusters', '--region', 'us-east-1'];
const DIRECT_COMMAND = ['aws', 'sts', 'get-caller-identity'];
let helper, env, browser;

function answerTurn(ask) {
  const message = String(ask.message || '');
  const command = (argv) => ({ answer: 'Command staged for review.', structured: { say: 'Command staged for review.', command: { tool: 'aws', argv, reason: 'read-only', readOnly: true, risk: 'none', verify: 'JSON prints.' } } });
  if (message.startsWith('DIRECT')) return command(DIRECT_COMMAND);
  if (message.includes('cli-helper-v1')) return command(OUTER_COMMAND);
  if (message.includes('console-plan-v1')) return { answer: 'Plan ready.', structured: { say: 'Reading pods.', steps: [{ argv: ['kubectl', 'get', 'pods', '-A'], reason: 'pods' }] } };
  return 'Noted.';
}

/** The shared window's stand-in kernel, able to hold a turn's result and to honour the window's Stop. */
function heldKernel() {
  const base = helper.windowKernel({ answer: answerTurn });
  const held = new Map();
  let holdIf = () => false;
  function handle(req) {
    const p = req.url.pathname, id = req.url.searchParams.get('jobId');
    if (req.method === 'POST' && p === '/api/jarvis/ask/stop') { const h = held.get(id); if (h) h.stopped = true; return { status: 200, json: { stopped: Boolean(h) } }; }
    if (req.method === 'GET' && p === '/api/jarvis/ask/result' && held.has(id)) {
      const h = held.get(id);
      if (h.stopped) return { status: 200, json: { status: 'error', code: 'stopped', error: 'Stopped at your request.', jobId: id } };
      if (!h.released) return { status: 200, json: { status: 'pending', steps: [{ kind: 'model', status: 'running' }], moreSteps: 0 } };
    }
    const out = base.handle(req);
    if (out && req.method === 'POST' && out.json?.jobId) { const ask = base.asks.at(-1); if (holdIf(ask)) held.set(out.json.jobId, { ask, released: false, stopped: false }); }
    return out;
  }
  return {
    asks: base.asks, answerFor: base.answerFor, handle,
    hold(predicate) { holdIf = predicate; },
    release(predicate) { for (const h of held.values()) if (predicate(h.ask)) h.released = true; },
  };
}

function kubeStandIn(web, counts) {
  web.get('/connectors', (_req, res) => res.json({ connections: [{ connector: 'kubernetes', account: 'primary', shared: false, status: 'connected' }], httpServices: [{ connector: 'kubernetes', configured: true }] }));
  web.post('/confirmations', (_req, res) => { counts.confirmations++; res.json({ confirmation: randomUUID() }); });
  web.post('/connectors/kubernetes/actions/:op', (req, res) => {
    counts.kube.push(req.params.op);
    const at = new Date().toISOString();
    if (req.params.op === 'kubernetes-list-nodes') return res.json({ transport: 'native_kubernetes', observedAt: at, items: [{ uid: 'n1', name: 'lab-node', ready: true, pressure: [], roles: [], allocatable: { cpu: '4', memory: '8Gi', pods: '110' }, kubelet: 'v1.34.0' }] });
    return res.json({ transport: 'native_kubernetes', observedAt: at, items: [] });
  });
}

async function startFixture() {
  const db = await fixture();
  const express = helper.toolchain('express');
  const platform = helper.kernelPlatform(path.resolve(root, '../../oshal-kernel/platform'));
  const kernel = heldKernel();
  const counts = { confirmations: 0, kube: [] };
  const flags = { denyRecords: false };
  const web = express();
  web.use(express.json({ limit: '1mb' }));
  helper.mountWindow(web, { platform, kernel });
  kubeStandIn(web, counts);
  web.use((req, _res, next) => { req.oidc = { user: { sub: 'alice' } }; next(); });
  const routes = loadExperience().createOperationsExperienceRoutes({ pool: db.caller('alice'), appPackageDir: root, authorization: { registerResource() {} }, store: { query: async () => [], put: async () => {} } });
  web.use('/api/intelligent-operations', (req, res, next) => (flags.denyRecords && req.path === '/records' ? res.status(403).json({ refused: 'not_permitted' }) : next()), routes);
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  return { origin: `http://127.0.0.1:${server.address().port}`, kernel, counts, flags,
    close: async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await db.close(); } };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  env = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true, args: ['--disable-gpu'] });
});
test.after(async () => { await browser?.close(); await env?.close(); });

async function openPage(hash) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${env.origin}/api/intelligent-operations/app#${hash}`);
  await page.locator('#status', { hasText: /^Updated / }).waitFor();
  return { context, page, errors };
}
async function waitFor(check, what, timeout = 15000) {
  for (const until = Date.now() + timeout; !(await check());) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}
const askWhere = (predicate) => env.kernel.asks.find(predicate);

test('an accepted packet over the window limit arrives as whole JSON with marked omissions, never silently cut', { timeout: 90000 }, async () => {
  env.kernel.hold(() => false);
  const { context, page, errors } = await openPage('commands');
  try {
    await page.locator('#commands-tool').selectOption('aws');
    await page.locator('#commands-goal').fill('G'.repeat(1990) + 'GOALEND');
    await page.locator('#commands-context').fill('C'.repeat(3988) + 'CONTEXTEND');
    await helper.chatWindow(page, '#commands-concierge iframe.jarvis-chat-frame');
    const before = env.kernel.asks.length;
    await page.locator('#commands-ask').click();
    await waitFor(() => env.kernel.asks.length > before, 'the packet turn');
    const message = String(env.kernel.asks.at(-1).message);
    assert.ok(message.length <= 4000, 'the turn fits the window limit');
    const packet = JSON.parse(message.slice(message.indexOf('Packet: ') + 'Packet: '.length));
    assert.equal(packet.version, 'cli-helper-v1');
    assert.equal(packet.executionAuthority, false, 'the closing fields survive');
    assert.match(JSON.stringify(packet), /characters omitted/, 'every cut is marked inside the packet');
    await page.locator('#commands-proposal').getByText(OUTER_COMMAND.join(' ')).waitFor();
    assert.match(await page.locator('#commands-status').textContent(), /omitted/, 'the person is told evidence was trimmed');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a direct window turn that settles while an outer Ask is held never resolves that Ask', { timeout: 90000 }, async () => {
  const isOuter = (ask) => String(ask.message).includes('cli-helper-v1');
  const isDirect = (ask) => String(ask.message).startsWith('DIRECT');
  env.kernel.hold((ask) => isOuter(ask) || isDirect(ask));
  const { context, page, errors } = await openPage('commands');
  try {
    await page.locator('#commands-tool').selectOption('aws');
    await page.locator('#commands-goal').fill('list my EKS clusters');
    const chat = await helper.chatWindow(page, '#commands-concierge iframe.jarvis-chat-frame');
    await chat.locator('#typein').fill('DIRECT check identity');
    await chat.locator('#typer button[type=submit]').click();
    await waitFor(() => askWhere(isDirect), 'the held direct turn');
    await page.locator('#commands-ask').click();
    await waitFor(() => askWhere(isOuter), 'the held outer turn');
    env.kernel.release(isDirect);
    await chat.locator('#convo .msg.bot .bx', { hasText: 'Command staged for review.' }).first().waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('#commands-ask').isDisabled(), true, 'the outer Ask is still waiting for its own turn');
    env.kernel.release(isOuter);
    await waitFor(async () => !(await page.locator('#commands-ask').isDisabled()), 'the outer Ask to settle');
    assert.match(await page.locator('#commands-proposal pre').textContent(), /aws eks list-clusters/, 'the outer Ask staged its own answer');
    assert.deepEqual(errors, []);
  } finally { await context.close(); env.kernel.hold(() => false); }
});

test('the shared Stop during console planning runs no local plan and no Kubernetes read; the console stays usable', { timeout: 90000 }, async () => {
  env.kernel.hold((ask) => String(ask.message).includes('console-plan-v1'));
  const { context, page, errors } = await openPage('console');
  try {
    await page.locator('#console-tree .console-leaf').first().waitFor();
    const chat = await helper.chatWindow(page, '#console-concierge iframe.jarvis-chat-frame');
    await page.waitForTimeout(500);
    const kubeBefore = env.counts.kube.length, confirmBefore = env.counts.confirmations;
    await page.locator('#console-input').fill('are my pods healthy?');
    await page.locator('#console-input').press('Enter');
    await waitFor(() => askWhere((a) => String(a.message).includes('console-plan-v1')), 'the held planning turn');
    await chat.locator('#convo [data-stop-turn]').last().click();
    await page.locator('#console-output', { hasText: /Stopped/ }).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(env.counts.kube.length, kubeBefore, 'no Kubernetes read after Stop');
    assert.equal(env.counts.confirmations, confirmBefore, 'no confirmation after Stop');
    assert.doesNotMatch(await page.locator('#console-output').textContent(), /planning locally/, 'Stop is not treated as an unavailable analyst');
    env.kernel.hold(() => false);
    await page.locator('#console-input').fill('kubectl get nodes');
    await page.locator('#console-input').press('Enter');
    await waitFor(() => env.counts.kube.length > kubeBefore, 'the next request to run');
    assert.deepEqual(errors, []);
  } finally { await context.close(); env.kernel.hold(() => false); }
});

test('a direct reply that lands after an access clear stages nothing', { timeout: 90000 }, async () => {
  env.kernel.hold((ask) => String(ask.message).startsWith('DIRECT'));
  const { context, page, errors } = await openPage('commands');
  try {
    await page.locator('#commands-tool').selectOption('aws');
    const chat = await helper.chatWindow(page, '#commands-concierge iframe.jarvis-chat-frame');
    const before = env.kernel.asks.length;
    await chat.locator('#typein').fill('DIRECT late reply');
    await chat.locator('#typer button[type=submit]').click();
    await waitFor(() => env.kernel.asks.length > before, 'the held direct turn');
    env.flags.denyRecords = true;
    await page.locator('#refresh').click();
    await page.locator('#status', { hasText: /role does not permit/ }).waitFor();
    env.kernel.release((ask) => String(ask.message).startsWith('DIRECT'));
    await chat.locator('#convo .msg.bot .bx', { hasText: 'Command staged for review.' }).last().waitFor();
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#commands-proposal').evaluate((n) => n.childElementCount), 0, 'nothing is staged after the clear');
    assert.deepEqual(errors, []);
  } finally { env.flags.denyRecords = false; env.kernel.hold(() => false); await context.close(); }
});

test('the three specialist screens carry one byte-identical correlated window helper', () => {
  const fs = require('node:fs');
  const block = (file) => { const s = fs.readFileSync(path.join(root, 'experience', file), 'utf8'); const a = s.indexOf('/* SPECIALIST WINDOW (shared copy'), b = s.indexOf('/* END SPECIALIST WINDOW */'); assert.ok(a >= 0 && b > a, file + ' carries the helper'); return s.slice(a, b); };
  const reference = block('command-helper.js');
  for (const file of ['console.js', 'pod-console.js']) assert.equal(block(file), reference, file + ' matches command-helper.js');
  for (const file of ['command-helper.js', 'console.js', 'pod-console.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, 'experience', file), 'utf8'), /hookWindowFetch|querySelectorAll\('#convo \.msg\.bot/, file + ' no longer settles from the last bubble');
});
