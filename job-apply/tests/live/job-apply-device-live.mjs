#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Reusable live proof on the Blue test slot (http://127.0.0.1:38798): enrols two synthetic Orbit devices for a disposable test person, chooses one via PUT /api/apply-operator/workers, starts a job-apply ticket, verifies the chosen device receives the command and GET /api/trace/{id} records a device span for it, flips to the second device to prove the switch, and tears down every synthetic record in finally.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Complete the full Orbit browser-form sequence (open -> snapshot -> form -> screen.capture) and assert the ticket reaches a terminal `done` state with `completed` work alongside the trace device span.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

function parseBase(argv) {
  const arg = argv.find((a) => a.startsWith('--base='));
  const base = (arg ? arg.slice('--base='.length) : 'http://127.0.0.1:38798').replace(/\/+$/, '');
  const url = new URL(base);
  if (url.port !== '38798' && process.env.ALLOW_NON_BLUE_LIVE_PROOF !== '1') {
    throw new Error(`Refusing live proof outside port 38798 (${base}).`);
  }
  return base;
}

async function apiJson(base, method, path, headers = {}, body = undefined) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

async function issueConfirm(base, authHeader) {
  const res = await apiJson(base, 'POST', '/confirmations', authHeader, {});
  assert.equal(res.status, 200, `issue confirmation failed: ${JSON.stringify(res.data)}`);
  return res.data.confirmation;
}

async function enrolOrbitDevice(base, authHeader, name, machine) {
  const confirm = await issueConfirm(base, authHeader);
  const invite = await apiJson(base, 'POST', '/nodes/join-codes', { ...authHeader, 'x-oshal-confirm': confirm }, {
    capabilities: [],
    lifetime_ms: 300000,
  });
  assert.equal(invite.status, 200, `join-code failed: ${JSON.stringify(invite.data)}`);
  const joined = await apiJson(base, 'POST', '/nodes/join', {}, {
    code: invite.data.code,
    kind: 'remote',
    harness: 'oshal-node-desktop',
    capabilities: {},
  });
  assert.ok([200, 201].includes(joined.status), `node join failed: ${JSON.stringify(joined.data)}`);
  const nodeId = joined.data.node.id;
  const token = joined.data.token;
  const presenceBody = { wait_ms: 0, name, platform: 'linux', arch: 'x64', machine, tools: ['browser.control', 'screen.capture'] };
  const poll = await apiJson(base, 'POST', `/nodes/${nodeId}/commands/next`, { 'x-oshal-node-token': token }, presenceBody);
  assert.equal(poll.status, 200, `presence poll failed: ${JSON.stringify(poll.data)}`);
  return { nodeId, token, name, presenceBody };
}

function buildBrowserStartBody(postingUrl) {
  const base = {
    version: 1,
    intentId: crypto.randomUUID(),
    origin: 'https://jobs.example.com',
    maxPresses: 2,
    expiresAt: Date.now() + 1_800_000,
    task: {
      url: postingUrl,
      mode: 'submit',
      postingId: 1,
      profile: { fullName: 'Test Applicant', email: 'applicant@example.com' },
    },
  };
  const requestDigest = crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
  const payload = Buffer.from(JSON.stringify({ ...base, requestDigest }), 'utf8');
  const fileDigest = [...crypto.createHash('sha256').update(payload).digest()];
  return {
    executor: 'browser-form-v1',
    prompt: 'Execute only the approved browser-task.json form intent.',
    files: [{ path: 'browser-task.json', digest: fileDigest, bytes: [...payload] }],
    limits: { wall_ms: 120000, output_tokens: 1, artifact_bytes: 1048576 },
  };
}

async function nextOrbitCommand(base, dev) {
  for (let i = 0; i < 40; i++) {
    const poll = await apiJson(base, 'POST', `/nodes/${dev.nodeId}/commands/next`, { 'x-oshal-node-token': dev.token }, dev.presenceBody);
    if (poll.data.command) return poll.data.command;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for command on ${dev.name}`);
}

async function answerOrbitCommand(base, dev, cmdId, outcome) {
  const res = await apiJson(base, 'POST', `/nodes/${dev.nodeId}/commands/${cmdId}/result`, { 'x-oshal-node-token': dev.token }, outcome);
  assert.equal(res.status, 200, `answer command failed: ${JSON.stringify(res.data)}`);
}

async function openAndSnapshotOrbit(base, chosen, postingUrl) {
  const open = await nextOrbitCommand(base, chosen);
  assert.equal(open.tool, 'browser.control');
  assert.equal(open.arguments?.url, postingUrl);
  await answerOrbitCommand(base, chosen, open.id, { ok: true, text: 'Opened', output: { tabId: 3, url: postingUrl } });

  const snap = await nextOrbitCommand(base, chosen);
  assert.equal(snap.arguments?.action, 'snapshot');
  await answerOrbitCommand(base, chosen, snap.id, {
    ok: true,
    text: 'Snapshot',
    output: {
      url: postingUrl,
      title: 'Apply Live Proof',
      snapshot: 'snap-live',
      text: 'Complete your application below.',
      elements: [
        { ref: 0, tag: 'input', type: 'text', label: 'Full Name', disabled: false, form: 0 },
        { ref: 1, tag: 'input', type: 'email', label: 'Email', disabled: false, form: 0 },
        { ref: 2, tag: 'button', type: 'submit', label: 'Submit application', disabled: false, form: 0 },
      ],
    },
  });
}

async function completeOrbitSequence(base, chosen, postingUrl) {
  await openAndSnapshotOrbit(base, chosen, postingUrl);
  const form = await nextOrbitCommand(base, chosen);
  assert.equal(form.arguments?.action, 'form');
  await answerOrbitCommand(base, chosen, form.id, {
    ok: true,
    text: 'Filled 2 fields and sent the form.',
    output: { done: true, filled: 2, submitted: true, now: { title: 'Application received' } },
  });

  const postSnap = await nextOrbitCommand(base, chosen);
  assert.equal(postSnap.arguments?.action, 'snapshot');
  await answerOrbitCommand(base, chosen, postSnap.id, {
    ok: true,
    text: 'Snapshot',
    output: {
      url: 'https://jobs.example.com/live-proof/thanks',
      title: 'Application submitted',
      snapshot: 'snap-live-done',
      text: 'Thank you for applying! Your application has been received.',
      elements: [],
    },
  });

  const shot = await nextOrbitCommand(base, chosen);
  assert.equal(shot.tool, 'screen.capture');
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);
  await answerOrbitCommand(base, chosen, shot.id, {
    ok: true,
    text: 'Captured',
    output: { dataUrl: `data:image/png;base64,${png.toString('base64')}` },
  });
}

async function verifyDeviceRoute(base, authHeader, chosen, other, postingUrl, createdTickets) {
  const put = await apiJson(base, 'PUT', '/api/apply-operator/workers', authHeader, { deviceId: chosen.nodeId });
  assert.equal(put.status, 200, `PUT device failed: ${JSON.stringify(put.data)}`);
  assert.equal(put.data.selectedDeviceId, chosen.nodeId);
  assert.equal(put.data.selectedDeviceName, chosen.name);

  const created = await apiJson(base, 'POST', '/api/v1/tickets', authHeader, {
    kind: 'job-apply',
    title: `Synthetic device proof ${chosen.name}`,
  });
  assert.ok([200, 201].includes(created.status), `create ticket failed: ${JSON.stringify(created.data)}`);
  const ticketId = created.data.ticket?.id || created.data.id;
  createdTickets.push(ticketId);

  const started = await apiJson(base, 'POST', `/tickets/${ticketId}/start`, authHeader, buildBrowserStartBody(postingUrl));
  assert.equal(started.status, 200, `start ticket failed: ${JSON.stringify(started.data)}`);

  const otherPoll = await apiJson(base, 'POST', `/nodes/${other.nodeId}/commands/next`, { 'x-oshal-node-token': other.token }, other.presenceBody);
  assert.equal(otherPoll.data.command ?? null, null, `unchosen device received command: ${JSON.stringify(otherPoll.data)}`);

  await completeOrbitSequence(base, chosen, postingUrl);
  for (let i = 0; i < 40; i++) {
    const view = await apiJson(base, 'GET', `/api/v1/tickets/${ticketId}`, authHeader);
    if (view.data.ticket?.status === 'done') break;
    if (i === 39) assert.fail(`ticket ${ticketId} did not reach done: ${JSON.stringify(view.data)}`);
    await new Promise((r) => setTimeout(r, 25));
  }

  const trace = await apiJson(base, 'GET', `/api/trace/${ticketId}`, authHeader);
  assert.equal(trace.status, 200, `trace read failed: ${JSON.stringify(trace.data)}`);
  assert.equal(trace.data.trace?.ticket?.device?.deviceId, chosen.nodeId);
  assert.equal(trace.data.trace?.ticket?.device?.deviceName, chosen.name);
  const span = (trace.data.trace?.spans || []).find((s) => s.kind === 'device' && s.deviceId === chosen.nodeId);
  assert.ok(span, `missing device span on trace: ${JSON.stringify(trace.data)}`);
  return ticketId;
}

async function cleanupResources(base, authHeader, nodes, tickets) {
  await apiJson(base, 'PUT', '/api/apply-operator/workers', authHeader, { deviceId: '' }).catch(() => {});
  for (const ticketId of tickets) {
    try {
      const c1 = await issueConfirm(base, authHeader);
      await apiJson(base, 'POST', `/tickets/${ticketId}/cancel`, { ...authHeader, 'x-oshal-confirm': c1 }, {});
      const c2 = await issueConfirm(base, authHeader);
      await apiJson(base, 'DELETE', `/tickets/${ticketId}`, { ...authHeader, 'x-oshal-confirm': c2 });
    } catch { /* best-effort teardown */ }
  }
  for (const device of nodes) {
    try {
      const confirm = await issueConfirm(base, authHeader);
      await apiJson(base, 'DELETE', `/nodes/${device.nodeId}`, { ...authHeader, 'x-oshal-confirm': confirm });
    } catch { /* best-effort teardown */ }
  }
}

async function main() {
  const base = parseBase(process.argv.slice(2));
  const token = process.env.OSHAL_TEST_BEARER || process.env.OSHAL_BEARER_TOKEN || '';
  const cookie = process.env.OSHAL_TEST_COOKIE || '';
  if (!token && !cookie) {
    throw new Error('Set OSHAL_TEST_BEARER or OSHAL_TEST_COOKIE for the disposable test person on Blue (:38798).');
  }
  const authHeader = token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie };
  const enrolledNodes = [];
  const createdTickets = [];
  try {
    const alpha = await enrolOrbitDevice(base, authHeader, 'alpha-desk', 'a1f00001');
    enrolledNodes.push(alpha);
    const beta = await enrolOrbitDevice(base, authHeader, 'beta-laptop', 'be7a0002');
    enrolledNodes.push(beta);

    const t1 = await verifyDeviceRoute(base, authHeader, beta, alpha, 'https://jobs.example.com/live-proof/1', createdTickets);
    const t2 = await verifyDeviceRoute(base, authHeader, alpha, beta, 'https://jobs.example.com/live-proof/2', createdTickets);
    console.log(JSON.stringify({ ok: true, base, routedBetaTicket: t1, routedAlphaTicket: t2 }));
  } finally {
    await cleanupResources(base, authHeader, enrolledNodes, createdTickets);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
