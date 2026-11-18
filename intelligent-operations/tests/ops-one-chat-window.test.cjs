/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Intelligent Operations 1.9.4 (Roger, 2026-11-16/17: one concierge chat window everywhere):
 *     |                                         | verify in Chromium at 1440x900 and 412x915 (touch) over the real Operations
 *     |                                         | experience routes and a kernel platform export that (1) Cloud & SSH commands
 *     |                                         | (#commands-concierge), Console (#console-concierge) and Pod console
 *     |                                         | (.pod-concierge on #systems) mount /shared/ui/js/jarvis-chat-frame.js as
 *     |                                         | intelligent-operations / ops-rca-specialist with model menu, conversations,
 *     |                                         | Files, Tap to talk and Keep trying, pass live screen_state, and stage
 *     |                                         | proposed commands without auto-executing; and (2) Intelligent Operations
 *     |                                         | inside Today (/cockpit/?app=intelligent-operations&screen=operations-estate)
 *     |                                         | opens the one chat window with ops-concierge.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { fixture, loadExperience, root } = require('./fixtures/intake.cjs');

const CONCIERGE_BOT_ID = '0be32215-3a5a-43cd-9f84-afc659aa1d65';
const SPECIALIST_BOT = 'ops-rca-specialist';
const FRONT_ANSWER = 'Zero critical alerts are firing across your monitored installations.';

let helper, todayHost, env, browser;

function answerTurn(ask) {
  if (ask.context?.app !== 'intelligent-operations') return 'Wrong application.';
  if (ask.bot === 'ops-concierge' || ask.bot === CONCIERGE_BOT_ID) return FRONT_ANSWER;
  if (ask.bot !== SPECIALIST_BOT) return 'Unexpected bot.';
  if (ask.context?.screen === 'command-helper') {
    return {
      answer: 'Safe read-only EKS check staged for review.',
      structured: {
        say: 'Safe read-only EKS check staged for review.',
        command: {
          tool: 'aws',
          argv: ['aws', 'eks', 'list-clusters', '--region', 'us-east-1'],
          reason: 'read-only cluster listing',
          readOnly: true,
          risk: 'none',
          verify: 'Cluster names print as JSON.'
        }
      }
    };
  }
  if (ask.context?.screen === 'ops-console') {
    return {
      answer: 'Lab cluster has 1 node ready; inspect pods next.',
      structured: { next: [{ argv: ['kubectl', 'get', 'pods', '-A'], reason: 'inspect pods' }] }
    };
  }
  return {
    answer: 'Container health reviewed; id check suggested for separate review.',
    structured: { say: 'Container health reviewed; id check suggested for separate review.', command: { argv: ['id'], reason: 'check uid' } }
  };
}

function buildGraph() {
  const at = '2026-10-23T00:00:00.000Z';
  return {
    assets: [
      { id: 'c1', provider: 'kubernetes', scope: 's1', kind: 'cluster', nativeId: 's1', name: 'lab', health: 'healthy', observedAt: at, properties: {} },
      { id: 'ns1', provider: 'kubernetes', scope: 's1', kind: 'namespace', nativeId: 'ns1', name: 'demo', health: 'healthy', observedAt: at, properties: { namespace: 'demo' } },
      { id: 'p1', provider: 'kubernetes', scope: 's1', kind: 'pod', nativeId: 'pod-uid-1', name: 'web-1', health: 'degraded', observedAt: at, properties: { namespace: 'demo', phase: 'Running' } }
    ],
    relationships: [],
    asOf: at,
    collections: [{ id: 's1/demo', complete: true, observedAt: at }],
    revision: 'r1',
    scanIds: [],
    limits: { scans: 200, assets: 2000, relationships: 5000 }
  };
}

function attachKubeStandIn(web, execCalls) {
  const proofs = new Set();
  web.get('/connectors', (_req, res) => res.json({
    connections: [{ connector: 'kubernetes', account: 'primary', shared: false, status: 'connected' }],
    httpServices: [{ connector: 'kubernetes', configured: true }]
  }));
  web.post('/confirmations', (_req, res) => {
    const id = randomUUID();
    proofs.add(id);
    res.json({ confirmation: id });
  });
  web.post('/connectors/kubernetes/actions/:op', (req, res) => {
    assert.ok(proofs.delete(req.headers['x-oshal-confirm']));
    if (req.params.op === 'kubernetes-exec') execCalls.push(req.body);
    if (req.params.op === 'kubernetes-list-nodes') {
      return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: new Date().toISOString(), items: [{ uid: 'n1', name: 'lab-node', ready: true, pressure: [], roles: ['control-plane'], allocatable: { cpu: '4', memory: '8Gi', pods: '110' }, kubelet: 'v1.34.0' }] });
    }
    if (req.params.op === 'kubernetes-list-pods') {
      return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: new Date().toISOString(), items: [{ uid: 'pod-uid-1', name: 'web-1', namespace: 'demo', phase: 'Running', node: 'lab-node', ready: true, restarts: 0, containers: [{ name: 'web', ready: true, restarts: 0 }] }] });
    }
    return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: new Date().toISOString(), pod: { uid: 'pod-uid-1', name: 'web-1', namespace: 'demo', phase: 'Running', containers: [{ name: 'web', ready: true, restarts: 0 }] } });
  });
}

async function startFixture() {
  const db = await fixture();
  const express = helper.toolchain('express');
  const platform = helper.kernelPlatform(path.resolve(root, '../../oshal-kernel/platform'));
  const kernel = helper.windowKernel({ answer: answerTurn });
  const execCalls = [];
  const graph = buildGraph();
  const web = express();
  web.use(express.json({ limit: '1mb' }));
  helper.mountWindow(web, { platform, kernel });
  attachKubeStandIn(web, execCalls);
  web.use((req, _res, next) => { req.oidc = { user: { sub: 'alice' } }; next(); });
  const routes = loadExperience().createOperationsExperienceRoutes({
    pool: db.caller('alice'),
    appPackageDir: root,
    authorization: { registerResource() {} },
    store: { query: async () => [], put: async () => {} }
  });
  web.use('/api/intelligent-operations', (req, res, next) => {
    if (req.path === '/topology') return res.json(graph);
    next();
  }, routes);
  todayHost.mountToday(web, { platform, apps: ['intelligent-operations'] });
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    kernel,
    execCalls,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await db.close();
    }
  };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  todayHost = await import('../../scripts/one-chat-window/today-host.mjs');
  env = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true, args: ['--disable-gpu'] });
});

test.after(async () => {
  await browser?.close();
  await env?.close();
});

async function openAt(urlPath, width, height) {
  const phone = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (
    new URL(route.request().url()).origin === env.origin
      ? route.continue()
      : (outside.push(route.request().url()), route.abort())
  ));
  const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
  await page.goto(`${env.origin}${urlPath}`);
  return { context, page, errors, outside, press };
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: Cloud & SSH commands, Console and Pod console mount the kernel's one chat window as ops-rca-specialist`, { timeout: 120000 }, async () => {
    const { context, page, errors, outside, press } = await openAt('/api/intelligent-operations/app#commands', width, height);
    try {
      await page.locator('#status', { hasText: /^Updated / }).waitFor();
      await page.locator('#commands-tool').selectOption('aws');
      await page.locator('#commands-goal').fill('list my EKS clusters');
      const cmdChat = await helper.chatWindow(page, '#commands-concierge iframe.jarvis-chat-frame');
      assert.deepEqual(await todayHost.windowAddress(page, '#commands-concierge iframe.jarvis-chat-frame'), {
        path: '/api/jarvis/',
        app: 'intelligent-operations',
        bot: SPECIALIST_BOT,
        src: await page.locator('#commands-concierge iframe.jarvis-chat-frame').getAttribute('src')
      });
      await helper.windowControls(cmdChat);
      assert.equal(await helper.pickModel(cmdChat, press), 'Picked model');
      const cmdTurn = await helper.sendInWindow(cmdChat, 'Propose a safe AWS EKS cluster check.', press, env.kernel);
      assert.equal(cmdTurn.ask.context?.app, 'intelligent-operations');
      assert.equal(cmdTurn.ask.context?.screen, 'command-helper');
      assert.equal(cmdTurn.ask.context?.provider, 'picked');
      assert.match(String(cmdTurn.ask.context?.screen_state?.text || ''), /# Cloud & SSH commands/);
      await page.locator('#commands-proposal').getByText('aws eks list-clusters', { exact: false }).waitFor();

      await page.evaluate(() => { location.hash = 'console'; });
      await page.locator('#console-tree .console-leaf').first().waitFor();
      const conChat = await helper.chatWindow(page, '#console-concierge iframe.jarvis-chat-frame');
      await helper.windowControls(conChat);
      const conTurn = await helper.sendInWindow(conChat, 'Summarize cluster readiness.', press, env.kernel);
      assert.equal(conTurn.ask.context?.screen, 'ops-console');
      assert.match(String(conTurn.ask.context?.screen_state?.text || ''), /# Console/);
      await page.locator('#console-output .console-chip', { hasText: 'kubectl get pods -A' }).waitFor();

      await page.evaluate(() => { location.hash = 'systems'; });
      const tree = page.locator('#systems-results').getByRole('tree');
      await tree.waitFor();
      await press(tree.getByRole('treeitem', { name: /lab · kubernetes/ }));
      await press(tree.getByRole('treeitem', { name: /demo group/ }));
      await press(tree.locator('[data-resource-id="p1"]'));
      const podChat = await helper.chatWindow(page, '.pod-concierge iframe.jarvis-chat-frame');
      await helper.windowControls(podChat);
      const podTurn = await helper.sendInWindow(podChat, 'Inspect this pod readiness.', press, env.kernel);
      assert.equal(podTurn.ask.context?.screen, 'pod-console');
      assert.match(String(podTurn.ask.context?.screen_state?.text || ''), /\[pod\] demo\/web-1/);
      await page.locator('.pod-suggestion', { hasText: 'Use suggested command' }).waitFor();
      assert.equal(env.execCalls.length, 0, 'specialist chat turns never auto-execute');
      assert.deepEqual(outside, []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test(`${width}x${height}: Intelligent Operations in Today opens the kernel's one chat window with ops-concierge`, { timeout: 90000 }, async () => {
    const { context, page, errors, outside, press } = await openAt('/cockpit/?app=intelligent-operations&screen=operations-estate', width, height);
    try {
      const screen = page.frameLocator('.tool-view-container > iframe');
      await screen.locator('#installations').waitFor({ state: 'visible', timeout: 20000 });
      const entries = todayHost.conciergeEntries(page);
      let opened = 0;
      for (const entry of entries) {
        if (!(await entry.locator.isVisible().catch(() => false))) continue;
        await press(entry.locator);
        await page.waitForFunction(() => {
          const panel = document.getElementById('chatPanel');
          const frame = document.getElementById('chatWorkspaceFrame');
          return Boolean(panel && frame && !panel.classList.contains('collapsed') && (frame.getAttribute('src') || '').includes('/api/jarvis/'));
        }, null, { timeout: 15000 });
        const addr = await todayHost.windowAddress(page, '#chatWorkspaceFrame');
        assert.equal(addr.path, '/api/jarvis/');
        assert.equal(addr.app, 'intelligent-operations');
        assert.equal(addr.bot, CONCIERGE_BOT_ID);
        const chat = await helper.chatWindow(page, '#chatWorkspaceFrame');
        await helper.windowControls(chat);
        const turn = await helper.sendInWindow(chat, 'What needs my attention in operations?', press, env.kernel);
        assert.equal(turn.ask.bot, CONCIERGE_BOT_ID);
        assert.equal(turn.ask.context?.app, 'intelligent-operations');
        opened++;
        break;
      }
      assert.ok(opened >= 1, 'at least one Today concierge entry is visible and opens the one chat window');
      assert.deepEqual(outside, []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
