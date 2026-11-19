/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Intelligent Operations 1.9.5 (Option 1 — Ticket + Per-User Workspace + Workflow):
 *     |                                         | fail-first behavioral contract verifying in Chromium and over real SQL that
 *     |                                         | Cloud & SSH commands, Console and Pod console dispatch cli-helper-v1,
 *     |                                         | console-plan-v1, console-assess-v1 and pod-analysis-v1 (>4,000 characters up
 *     |                                         | to 64 KiB) untrimmed as evidence/packet.json on caller-owned ops-specialist
 *     |                                         | tickets, verify accepted answer.md digests via ticketService.getAcceptedWork,
 *     |                                         | honour Stop via confirmed ticket cancellation without localPlan fallback,
 *     |                                         | drop late replies on access clear/dispose, refuse foreign or tampered work,
 *     |                                         | and keep jarvis-chat-frame.js mounted as ops-concierge for conversation.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, loadExperience, root } = require('./fixtures/intake.cjs');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Kernel-shaped in-memory ticketService port recording created tickets, workspace files and accepted work. */
function createTicketPort(answerFor) {
  const tickets = new Map();
  let holdIf = () => false;
  let tamperNextDigest = false;

  function settleWork(entry) {
    const packetFile = entry.startInput.files.find((f) => f.path === 'evidence/packet.json');
    assert.ok(packetFile, 'evidence/packet.json must be attached to startTicket');
    const rawBytes = Buffer.from(packetFile.bytes);
    assert.deepEqual([...createHash('sha256').update(rawBytes).digest()], packetFile.digest, 'input SHA-256 matches bytes');
    const packet = JSON.parse(rawBytes.toString('utf8'));
    const reply = answerFor({ ticket: entry.ticket, prompt: entry.startInput.prompt, packet, rawBytes });
    const answer = typeof reply === 'string' ? reply : JSON.stringify(reply);
    entry.work = {
      id: entry.workId,
      phase: { index: 0, name: 'analyze' },
      state: 'completed',
      executor: entry.startInput.executor,
      nodeId: 'spark-worker-1',
      resultUnavailable: false,
      answer,
      answerSha256: sha256(answer),
      receipt: `trace-${randomUUID()}`
    };
    entry.ticket.status = 'done';
    entry.ticket.revision += 1;
  }

  return {
    tickets,
    hold(predicate) { holdIf = predicate; },
    tamperDigestOnce() { tamperNextDigest = true; },
    releaseAll() {
      for (const entry of tickets.values()) {
        if (entry.held && entry.ticket.status === 'running') {
          entry.held = false;
          settleWork(entry);
        }
      }
    },
    cancelTicket(id) {
      const entry = tickets.get(id);
      if (!entry) return null;
      entry.ticket.status = 'cancelled';
      entry.ticket.revision += 1;
      if (entry.work) entry.work.state = 'cancelled';
      return entry.ticket;
    },
    seedForeignTicket(id, ownerSub, ticketType = 'ops-specialist') {
      tickets.set(id, {
        ownerSub,
        ticket: { id, ticketId: id, ticketType, status: 'done', revision: 2 },
        workId: randomUUID(),
        work: null
      });
    },
    portFor(callerSub) {
      return {
        async createTicket(input) {
          assert.equal(input.ownerSub, callerSub, 'createTicket binds caller ownerSub');
          const id = randomUUID();
          const ticket = {
            id,
            ticketId: id,
            ticketType: input.ticketType,
            title: input.title || null,
            description: input.description || null,
            status: 'queued',
            position: { index: 0, name: 'analyze' },
            revision: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          tickets.set(id, { ownerSub: callerSub, ticket, workId: randomUUID(), startInput: null, work: null, held: false });
          return { ticketId: id, status: 'queued', ticket };
        },
        async startTicket(ticketId, input) {
          const entry = tickets.get(ticketId);
          if (!entry || entry.ownerSub !== callerSub) throw Error('refused: the owned ticket is unavailable');
          assert.equal(input.executor, 'native-broker-v1');
          entry.startInput = input;
          entry.ticket.status = 'running';
          entry.ticket.revision += 1;
          const packet = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
          if (holdIf(packet, entry)) {
            entry.held = true;
            entry.work = { id: entry.workId, phase: { index: 0, name: 'analyze' }, state: 'claimed', executor: input.executor, nodeId: 'spark-worker-1', resultUnavailable: false };
          } else {
            settleWork(entry);
          }
          return { ticketId, status: entry.ticket.status, ticket: entry.ticket };
        },
        async getTicket(ticketId) {
          const entry = tickets.get(ticketId);
          if (!entry || entry.ownerSub !== callerSub) return null;
          return { ...entry.ticket };
        },
        async getTicketWork(ticketId) {
          const entry = tickets.get(ticketId);
          if (!entry || entry.ownerSub !== callerSub) throw Error('refused: owned ticket is unavailable');
          if (!entry.work) return [];
          const { id, phase, state, executor, nodeId, resultUnavailable } = entry.work;
          return [{ id, phase, state, executor, nodeId, resultUnavailable }];
        },
        async getAcceptedWork(ticketId, workId) {
          const entry = tickets.get(ticketId);
          if (!entry || entry.ownerSub !== callerSub) return null;
          if (!entry.work || entry.work.id !== workId || entry.work.state !== 'completed') {
            throw Error('completed ticket work is unavailable');
          }
          const digest = tamperNextDigest ? '0'.repeat(64) : entry.work.answerSha256;
          tamperNextDigest = false;
          return {
            ticketId,
            workId,
            phase: entry.work.phase,
            answer: entry.work.answer,
            answerSha256: digest,
            receipt: entry.work.receipt,
            source: 'accepted-work-answer.md'
          };
        }
      };
    }
  };
}

let helper, env, browser;

function specialistAnswer({ packet }) {
  if (packet.version === 'cli-helper-v1') {
    if (String(packet.goal).includes('CREDENTIAL_TEST')) {
      return {
        say: 'Unsafe credential test.',
        command: { tool: 'aws', argv: ['aws', '--secret', ['AK', 'IA'].join('') + 'ABCDEFGHIJKLMNOP'], reason: 'bad', readOnly: true, risk: 'none', verify: 'never' }
      };
    }
    return {
      say: 'Safe read-only EKS listing staged from ticket workspace.',
      command: {
        tool: packet.tool,
        argv: ['aws', 'eks', 'list-clusters', '--region', 'us-east-1'],
        reason: 'read-only cluster listing',
        readOnly: true,
        risk: 'none',
        verify: 'Cluster names print as JSON.'
      }
    };
  }
  if (packet.version === 'console-plan-v1') {
    return {
      say: 'Reading pod logs from demo/web-1.',
      steps: [{ argv: ['kubectl', 'logs', 'web-1', '-n', 'demo', '--tail', '200'], reason: 'inspect full pod logs' }]
    };
  }
  if (packet.version === 'console-assess-v1') {
    return {
      headline: 'demo/web-1 logs reviewed untrimmed',
      verdict: 'attention',
      explanation: '- Verified head and tail sentinels in ticket workspace.\n- <img src=x onerror="window.__pwned=1"> stays literal text.',
      next: [{ argv: ['kubectl', 'get', 'pods', '-n', 'demo'], reason: 'check pod status' }]
    };
  }
  if (packet.version === 'pod-analysis-v1') {
    return {
      say: 'Inspected full 11 KB pod stdout from ticket workspace without window truncation.',
      command: { argv: ['id'], reason: 'verify container uid' }
    };
  }
  return { say: 'Unknown packet.' };
}

async function startFixture() {
  const db = await fixture();
  const express = helper.toolchain('express');
  const platform = helper.kernelPlatform(path.resolve(root, '../../oshal-kernel/platform'));
  const chatKernel = helper.windowKernel({
    answer: (ask) => {
      assert.equal(ask.bot === 'ops-concierge' || ask.bot === '0be32215-3a5a-43cd-9f84-afc659aa1d65', true, 'chat window talks only to ops-concierge');
      return 'Conversational concierge reply: zero critical alerts firing.';
    }
  });
  const tickets = createTicketPort(specialistAnswer);
  const counts = { confirmations: 0, kube: [], cancelled: [] };
  const flags = { denyRecords: false, user: 'alice' };
  const longLog = 'HEAD_SENTINEL_LOG_001\n' + 'L'.repeat(5400) + '\nTAIL_SENTINEL_LOG_999';
  const podStdout = 'HEAD_SENTINEL_POD_001\n' + 'P'.repeat(11200) + '\nTAIL_SENTINEL_POD_999';
  const at = '2026-10-23T00:00:00.000Z';
  const graph = {
    assets: [
      { id: 'c1', provider: 'kubernetes', scope: 's1', kind: 'cluster', nativeId: 's1', name: 'lab', health: 'healthy', observedAt: at, properties: {} },
      { id: 'ns1', provider: 'kubernetes', scope: 's1', kind: 'namespace', nativeId: 'ns1', name: 'demo', health: 'healthy', observedAt: at, properties: { namespace: 'demo' } },
      { id: 'p1', provider: 'kubernetes', scope: 's1', kind: 'pod', nativeId: 'pod-uid-1', name: 'web-1', health: 'degraded', observedAt: at, properties: { namespace: 'demo', phase: 'Running' } }
    ],
    relationships: [], asOf: at, collections: [{ id: 's1/demo', complete: true, observedAt: at }], revision: 'r1', scanIds: [],
    limits: { scans: 200, assets: 2000, relationships: 5000 }
  };

  const proofs = new Set();
  const web = express();
  web.use(express.json({ limit: '1mb' }));
  helper.mountWindow(web, { platform, kernel: chatKernel });
  web.get('/connectors', (_req, res) => res.json({
    connections: [{ connector: 'kubernetes', account: 'primary', shared: false, status: 'connected' }],
    httpServices: [{ connector: 'kubernetes', configured: true }]
  }));
  web.post('/confirmations', (_req, res) => {
    counts.confirmations += 1;
    const id = randomUUID();
    proofs.add(id);
    res.json({ confirmation: id });
  });
  web.post('/tickets/:id/cancel', (req, res) => {
    assert.ok(proofs.delete(req.headers['x-oshal-confirm']), 'ticket cancel requires fresh confirmation');
    const cancelled = tickets.cancelTicket(req.params.id);
    if (!cancelled) return res.status(404).json({ error: 'ticket_not_found' });
    counts.cancelled.push(req.params.id);
    return res.json({ ticket: cancelled });
  });
  web.post('/connectors/kubernetes/actions/:op', (req, res) => {
    assert.ok(proofs.delete(req.headers['x-oshal-confirm']), 'kube action requires fresh confirmation');
    counts.kube.push(req.params.op);
    const now = new Date().toISOString();
    if (req.params.op === 'kubernetes-list-nodes') {
      return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: now, items: [{ uid: 'n1', name: 'lab-node', ready: true, pressure: [], roles: ['control-plane'], allocatable: { cpu: '4', memory: '8Gi', pods: '110' }, kubelet: 'v1.34.0' }] });
    }
    if (req.params.op === 'kubernetes-list-pods') {
      return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: now, items: [{ uid: 'pod-uid-1', name: 'web-1', namespace: 'demo', phase: 'Running', node: 'lab-node', ready: true, restarts: 0, containers: [{ name: 'web', ready: true, restarts: 0 }] }] });
    }
    if (req.params.op === 'kubernetes-pod-logs') {
      return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: now, outcome: 'completed', stdout: longLog, stderr: '' });
    }
    if (req.params.op === 'kubernetes-inspect-pod') {
      return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: now, pod: { uid: 'pod-uid-1', name: 'web-1', namespace: 'demo', phase: 'Running', containers: [{ name: 'web', ready: true, restarts: 0 }] } });
    }
    return res.json({ transport: 'native_kubernetes', operation: req.params.op, observedAt: now, target: { namespace: 'demo', pod: 'web-1', observedUid: 'pod-uid-1', container: 'web' }, outcome: 'completed', exitCode: 0, stdout: podStdout, stderr: '', remoteTerminationVerified: true });
  });

  const routesForAlice = loadExperience().createOperationsExperienceRoutes({
    pool: db.caller('alice'),
    appPackageDir: root,
    authorization: { registerResource() {} },
    store: { query: async () => [], put: async () => {} },
    ticketService: tickets.portFor('alice')
  });
  web.use('/api/intelligent-operations', (req, res, next) => {
    if (flags.denyRecords && req.path === '/records') return res.status(403).json({ refused: 'not_permitted' });
    req.oidc = { user: { sub: flags.user } };
    if (req.path === '/topology') return res.json(graph);
    next();
  }, routesForAlice);
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));

  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    chatKernel,
    tickets,
    counts,
    flags,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await db.close();
    }
  };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  env = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true, args: ['--disable-gpu'] });
});

test.after(async () => {
  await browser?.close();
  await env?.close();
});

async function openPage(hash) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${env.origin}/api/intelligent-operations/app#${hash}`);
  await page.locator('#status', { hasText: /^Updated / }).waitFor();
  return { context, page, errors };
}

test('Cloud & SSH commands, Console and Pod console preserve >4,000-char packets untrimmed in ops-specialist ticket workspaces and never post packets into chat', { timeout: 120000 }, async () => {
  const { context, page, errors } = await openPage('commands');
  try {
    const asksBefore = env.chatKernel.asks.length;
    await page.locator('#commands-tool').selectOption('aws');
    await page.locator('#commands-goal').fill('HEAD_SENTINEL_CMD_GOAL ' + 'G'.repeat(1900) + ' TAIL_SENTINEL_CMD_GOAL');
    await page.locator('#commands-context').fill('HEAD_SENTINEL_CMD_CTX ' + 'C'.repeat(3900) + ' TAIL_SENTINEL_CMD_CTX');
    await page.locator('#commands-ask').click();
    await page.locator('#commands-proposal').getByText('aws eks list-clusters --region us-east-1', { exact: false }).waitFor();

    const createdCmd = [...env.tickets.tickets.values()].find((t) => t.startInput && JSON.parse(Buffer.from(t.startInput.files[0].bytes).toString('utf8')).version === 'cli-helper-v1');
    assert.ok(createdCmd, 'cli-helper-v1 created an ops-specialist ticket');
    assert.equal(createdCmd.ticket.ticketType, 'ops-specialist');
    const cmdPacketText = Buffer.from(createdCmd.startInput.files[0].bytes).toString('utf8');
    assert.ok(cmdPacketText.length > 5800, `expected >5,800-byte packet, got ${cmdPacketText.length}`);
    assert.match(cmdPacketText, /HEAD_SENTINEL_CMD_GOAL[\s\S]*TAIL_SENTINEL_CMD_GOAL/);
    assert.match(cmdPacketText, /HEAD_SENTINEL_CMD_CTX[\s\S]*TAIL_SENTINEL_CMD_CTX/);
    assert.doesNotMatch(cmdPacketText, /characters omitted/);
    assert.doesNotMatch(await page.locator('#commands-status').textContent(), /omitted/);

    await page.evaluate(() => { location.hash = 'console'; });
    await page.locator('#console-tree .console-leaf').first().waitFor();
    await page.locator('#console-input').fill('inspect logs of web-1 in demo');
    await page.locator('#console-input').press('Enter');
    await page.locator('#console-output .console-report').waitFor();
    const assessEntry = [...env.tickets.tickets.values()].find((t) => t.startInput && JSON.parse(Buffer.from(t.startInput.files[0].bytes).toString('utf8')).version === 'console-assess-v1');
    assert.ok(assessEntry, 'console-assess-v1 ran on an ops-specialist ticket');
    const assessText = Buffer.from(assessEntry.startInput.files[0].bytes).toString('utf8');
    assert.ok(assessText.length > 5500, `expected >5,500-byte console-assess-v1 packet, got ${assessText.length}`);
    assert.match(assessText, /HEAD_SENTINEL_LOG_001[\s\S]*TAIL_SENTINEL_LOG_999/);
    assert.doesNotMatch(assessText, /characters omitted/);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'analyst markdown never executes HTML');

    await page.evaluate(() => { location.hash = 'systems'; });
    const tree = page.locator('#systems-results').getByRole('tree');
    await tree.waitFor();
    await tree.getByRole('treeitem', { name: /lab · kubernetes/ }).click();
    await tree.getByRole('treeitem', { name: /demo group/ }).click();
    await tree.locator('[data-resource-id="p1"]').click();
    await page.getByRole('button', { name: 'Read current status' }).click();
    await page.getByText('Current status captured', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Review command' }).click();
    await page.getByRole('button', { name: 'Execute reviewed command' }).click();
    await page.getByText('Command outcome: completed', { exact: false }).waitFor();
    await page.getByLabel('Ask about this pod').fill('Explain the full 11 KB command output.');
    await page.getByRole('button', { name: 'Ask operations analyst' }).click();
    await page.locator('.pod-analysis').getByText('Inspected full 11 KB pod stdout', { exact: false }).waitFor();
    await page.locator('.pod-suggestion', { hasText: 'Use suggested command' }).waitFor();

    const podEntry = [...env.tickets.tickets.values()].find((t) => t.startInput && JSON.parse(Buffer.from(t.startInput.files[0].bytes).toString('utf8')).version === 'pod-analysis-v1');
    assert.ok(podEntry, 'pod-analysis-v1 ran on an ops-specialist ticket');
    const podPacketText = Buffer.from(podEntry.startInput.files[0].bytes).toString('utf8');
    assert.ok(podPacketText.length > 11000, `expected >11,000-byte pod-analysis-v1 packet, got ${podPacketText.length}`);
    assert.match(podPacketText, /HEAD_SENTINEL_POD_001[\s\S]*TAIL_SENTINEL_POD_999/);
    assert.doesNotMatch(podPacketText, /characters omitted/);
    assert.equal(env.chatKernel.asks.length, asksBefore, 'zero specialist packets were stuffed into the chat window');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Stop during Console ticket planning cancels the ticket, runs no localPlan and no Kubernetes read, and leaves Console usable', { timeout: 90000 }, async () => {
  env.tickets.hold((packet) => packet.version === 'console-plan-v1');
  const { context, page, errors } = await openPage('console');
  try {
    await page.locator('#console-tree .console-leaf').first().waitFor();
    const kubeBefore = env.counts.kube.length;
    const cancelBefore = env.counts.cancelled.length;
    await page.locator('#console-input').fill('are my pods healthy right now?');
    await page.locator('#console-input').press('Enter');
    const stopBtn = page.locator('#console-panel [data-stop-analysis]');
    await stopBtn.waitFor({ state: 'visible', timeout: 10000 });
    await stopBtn.click();
    await page.locator('#console-output', { hasText: /Stopped at your request/ }).waitFor();
    await page.waitForTimeout(800);
    assert.equal(env.counts.kube.length, kubeBefore, 'no Kubernetes read after Stop');
    assert.ok(env.counts.cancelled.length > cancelBefore, 'confirmed /tickets/:id/cancel was sent');
    assert.doesNotMatch(await page.locator('#console-output').textContent(), /planning locally/);
    env.tickets.hold(() => false);
    await page.locator('#console-input').fill('kubectl get nodes');
    await page.locator('#console-input').press('Enter');
    await page.locator('#console-output .console-table').waitFor();
    assert.ok(env.counts.kube.length > kubeBefore, 'subsequent kubectl command runs cleanly');
    assert.deepEqual(errors, []);
  } finally {
    env.tickets.hold(() => false);
    env.tickets.releaseAll();
    await context.close();
  }
});

test('access clear cancels pending specialist polling so late ticket completion stages nothing, and credential-shaped proposals are discarded', { timeout: 90000 }, async () => {
  env.tickets.hold((packet) => packet.version === 'cli-helper-v1' && String(packet.goal).includes('HELD_FOR_CLEAR'));
  const { context, page, errors } = await openPage('commands');
  try {
    await page.locator('#commands-tool').selectOption('aws');
    await page.locator('#commands-goal').fill('HELD_FOR_CLEAR list clusters');
    await page.locator('#commands-ask').click();
    await page.locator('#commands-panel [data-stop-analysis]').waitFor({ state: 'visible', timeout: 10000 });
    env.flags.denyRecords = true;
    await page.locator('#refresh').click();
    await page.locator('#status', { hasText: /role does not permit/ }).waitFor();
    env.tickets.releaseAll();
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#commands-proposal').evaluate((n) => n.childElementCount), 0, 'late ticket settlement stages nothing after clear');

    env.flags.denyRecords = false;
    env.tickets.hold(() => false);
    await page.locator('#refresh').click();
    await page.locator('#status', { hasText: /^Updated / }).waitFor();
    await page.locator('#commands-tool').selectOption('aws');
    await page.locator('#commands-goal').fill('CREDENTIAL_TEST check');
    await page.locator('#commands-ask').click();
    await page.locator('#commands-status', { hasText: /contained what looks like a credential and was discarded/ }).waitFor();
    assert.equal(await page.locator('#commands-proposal').evaluate((n) => n.childElementCount), 0);
    assert.deepEqual(errors, []);
  } finally {
    env.flags.denyRecords = false;
    env.tickets.hold(() => false);
    env.tickets.releaseAll();
    await context.close();
  }
});

test('specialist-analyses routes enforce closed schemas, 64 KiB cap, ops-specialist ownership and server-verified answerSha256', async () => {
  const post = async (body) => {
    const r = await fetch(`${env.origin}/api/intelligent-operations/specialist-analyses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: r.status, json: await r.json() };
  };
  const get = async (id) => {
    const r = await fetch(`${env.origin}/api/intelligent-operations/specialist-analyses/${id}`);
    return { status: r.status, json: await r.json() };
  };

  assert.equal((await post({ screen: 'command-helper', lead: 'x', packet: { version: 'pod-analysis-v1', executionAuthority: false } })).status, 400);
  assert.equal((await post({ screen: 'command-helper', lead: 'x', packet: { version: 'cli-helper-v1', executionAuthority: true } })).status, 400);
  assert.equal((await post({ screen: 'command-helper', lead: 'x', packet: { version: 'cli-helper-v1', executionAuthority: false, blob: 'B'.repeat(66000) } })).status, 413);

  const foreignId = randomUUID();
  env.tickets.seedForeignTicket(foreignId, 'bob', 'ops-specialist');
  assert.equal((await get(foreignId)).status, 404, 'foreign owner ticket returns 404');

  const incidentId = randomUUID();
  env.tickets.seedForeignTicket(incidentId, 'alice', 'intelligent-operations');
  assert.equal((await get(incidentId)).status, 404, 'non-ops-specialist ticket returns 404');

  const created = await post({
    screen: 'command-helper',
    lead: 'Coach safe check.',
    packet: { version: 'cli-helper-v1', tool: 'aws', goal: 'identity', target: null, context: null, executionAuthority: false }
  });
  assert.equal(created.status, 201);
  env.tickets.tamperDigestOnce();
  assert.equal((await get(created.json.ticketId)).status, 409, 'tampered answerSha256 is refused');
  const cleanRead = await get(created.json.ticketId);
  assert.equal(cleanRead.status, 200);
  assert.equal(cleanRead.json.status, 'completed');
  assert.equal(cleanRead.json.answerVerifiedByServer, true);
});

test('the three specialist screens share one byte-identical workflow helper, mount ops-concierge for chat, and never monkey-patch iframe fetch or fitPacket', () => {
  const block = (file) => {
    const s = fs.readFileSync(path.join(root, 'experience', file), 'utf8');
    const a = s.indexOf('/* SPECIALIST WORKFLOW (shared copy');
    const b = s.indexOf('/* END SPECIALIST WORKFLOW */');
    assert.ok(a >= 0 && b > a, `${file} carries the shared specialist workflow helper`);
    return s.slice(a, b);
  };
  const reference = block('command-helper.js');
  for (const file of ['console.js', 'pod-console.js']) {
    assert.equal(block(file), reference, `${file} matches command-helper.js byte-for-byte`);
  }
  for (const file of ['command-helper.js', 'console.js', 'pod-console.js']) {
    const s = fs.readFileSync(path.join(root, 'experience', file), 'utf8');
    assert.match(s, /\/shared\/ui\/js\/jarvis-chat-frame\.js/);
    assert.match(s, /bot:\s*['"]ops-concierge['"]/);
    assert.doesNotMatch(s, /watchWindowTurns|fitPacket|WINDOW_TURN_LIMIT|__opsTurns|hookWindowFetch/);
  }
});
