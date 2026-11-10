/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.2.0 two-administrator and non-admin isolation proof against a disposable oshald + Postgres: Person A (operator) and Person B (business-admin) both hold phone-control admin, Person C (trader) holds phone-control operator; proves Person B reads 404/empty on every device, history, report, computer, screen and command of Person A with zero leaked commands, and Person C gets 200 on /ui and 403 on /devices.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: extend disposable-kernel isolation proof to cover Person A's mirrored iPhone record and mirror-frame command alongside TV, proving Person B gets 404/empty and zero leaked commands on Person A's mirrored iPhone.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const [base, rootToken, outFile] = process.argv.slice(2);
if (!base || !base.startsWith('http://127.0.0.1:') || base.endsWith(':38788') || base.endsWith(':38789')) {
  throw new Error(`isolation-proof only targets a disposable loopback kernel, never ${base}`);
}

const ALL_TOOLS = ['shell.exec', 'screen.capture', 'screen.read', 'desktop.control', 'app.open', 'browser.control'];
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 0x2a), Buffer.from([0xff, 0xd9])]);

async function api(method, route, { token, body, contentType = 'application/json' } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (Buffer.isBuffer(body)) {
    headers['content-type'] = contentType;
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = contentType;
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${base}${route}`, { method, headers, body: payload });
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary or HTML */ }
  return { status: response.status, json, text, bytes, headers: response.headers };
}

async function switchPersona(persona) {
  const switched = await api('POST', '/api/auth/switch', { body: { persona } });
  assert.equal(switched.status, 200, `switch ${persona}: ${switched.text}`);
  assert.ok(switched.json?.token && switched.json?.principal_id, `missing token/principal for ${persona}`);
  return { persona, token: switched.json.token, principalId: switched.json.principal_id, subject: switched.json.subject };
}

async function grantTemplate(principalId, assignmentId, template) {
  const cat = await api('GET', '/api/authorization/composites', { token: rootToken });
  assert.equal(cat.status, 200, cat.text);
  const req = {
    target: principalId,
    assignment_id: assignmentId,
    action: 'assign',
    selection: { kind: 'composite', app: 'phone-control', template, optional_apps: [] },
    expected_revision: cat.json.revision,
    expected_plan_revision: null,
    expires_at: null,
    reason: `disposable isolation proof (${template})`,
    idempotency_key: `iso-${crypto.randomUUID()}`
  };
  const pv = await api('POST', '/api/authorization/composites/preview', { token: rootToken, body: req });
  assert.equal(pv.status, 200, pv.text);
  const plan = pv.json.plan_revision || pv.json.plan?.plan_revision || pv.json.plan?.revision;
  const ap = await api('POST', '/api/authorization/composites/apply', {
    token: rootToken,
    body: { ...req, expected_revision: pv.json.revision ?? cat.json.revision, expected_plan_revision: plan, idempotency_key: `iso-${crypto.randomUUID()}` }
  });
  assert.ok([200, 201].includes(ap.status), ap.text);
}

async function startFakeComputer(ownerToken) {
  const code = await api('POST', '/nodes/join-codes', { token: ownerToken, body: { lifetime_ms: 60000 } });
  assert.equal(code.status, 200, code.text);
  const joined = await api('POST', '/nodes/join', {
    body: { code: code.json.code, kind: 'remote', harness: { custom: 'oshal-node-desktop' }, capabilities: { shell: true, display: true } }
  });
  assert.equal(joined.status, 200, joined.text);
  const nodeId = joined.json.node.id;
  const deviceToken = joined.json.token;
  const state = { commandsRun: 0, running: true };
  const loop = (async () => {
    while (state.running) {
      const poll = await api('POST', `/nodes/${nodeId}/commands/next`, {
        token: deviceToken,
        body: { name: 'Spark-A', platform: 'linux', arch: 'arm64', tools: ALL_TOOLS, wait_ms: 150 }
      });
      if (poll.status !== 200) break;
      const cmd = poll.json?.command;
      if (!cmd) continue;
      state.commandsRun += 1;
      const isMirror = String(cmd.arguments?.command || '').includes('mirror-frame');
      const sha256 = crypto.createHash('sha256').update(JPEG).digest('hex');
      const line = isMirror
        ? JSON.stringify({ ok: true, verb: 'mirror-frame', id: sha256.slice(0, 16), sha256, mime: 'image/jpeg', bytes: JPEG.length, chunks: 1, index: 0, data: JPEG.toString('base64'), deviceWidth: 1170, deviceHeight: 2532, slow: false })
        : JSON.stringify({ ok: true, verb: 'adb-key', key: 'OK' });
      const res = await api('POST', `/nodes/${nodeId}/commands/${cmd.id}/result`, {
        token: deviceToken,
        body: { ok: true, text: 'done', output: { stdout: `${line}\n`, stderr: '', exitCode: 0 } }
      });
      assert.equal(res.status, 200, res.text);
    }
  })();
  return {
    nodeId,
    deviceToken,
    state,
    pushFrame: () => api('POST', `/nodes/${nodeId}/commands/frame`, { token: deviceToken, body: JPEG, contentType: 'image/jpeg' }),
    stop: async () => { state.running = false; await loop; }
  };
}

async function seedPersonADevices(personA, compA, pkgVersion) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const savedTv = await api('POST', '/api/phone-control/devices', {
    token: personA.token,
    body: { name: 'Fire TV Stick 4K', platform: 'android', form: 'tv', computerNodeId: compA.nodeId, address: '192.168.1.60:5555' }
  });
  assert.equal(savedTv.status, 201, savedTv.text);
  const savedIos = await api('POST', '/api/phone-control/devices', {
    token: personA.token,
    body: { name: "Roger's iPhone", platform: 'ios', computerNodeId: compA.nodeId, address: '7C:4B:26:00:00:01' }
  });
  assert.equal(savedIos.status, 201, savedIos.text);
  const rep = await api('POST', `/api/phone-control/computers/${compA.nodeId}/report`, {
    token: personA.token,
    body: { report: { version: pkgVersion, adb: { ready: true }, mirror: { ready: true, running: true, hasFrame: true } } }
  });
  assert.equal(rep.status, 200, rep.text);
  const hist = await api('POST', '/api/phone-control/history', {
    token: personA.token,
    body: { computerNodeId: compA.nodeId, phoneId: savedIos.json.device.id, action: 'mirror', summary: 'Start iPhone screen mirroring', ok: true, exitCode: 0 }
  });
  assert.equal(hist.status, 201, hist.text);
  return { tvId: savedTv.json.device.id, iosId: savedIos.json.device.id };
}

async function seedPersonA(personA, compA, pkgVersion) {
  const { tvId, iosId } = await seedPersonADevices(personA, compA, pkgVersion);
  const runCmd = {
    tool: 'shell.exec',
    arguments: { command: 'python3 -I "$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py" adb-key --b64 eyJrZXkiOiJPSyIsInNlcmlhbCI6IjE5Mi4xNjguMS4xMzg6NTU1NSJ9', timeout_ms: 10000 },
    limit_ms: 15000
  };
  const mirrorCmd = {
    tool: 'shell.exec',
    arguments: { command: 'python3 -I "$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py" mirror-frame --b64 eyJ3aWR0aCI6NDMyfQ==', timeout_ms: 10000 },
    limit_ms: 15000
  };
  const ownRun = await api('POST', `/api/computers/${compA.nodeId}/run`, { token: personA.token, body: runCmd });
  assert.equal(ownRun.status, 200, ownRun.text);
  const ownMirror = await api('POST', `/api/computers/${compA.nodeId}/run`, { token: personA.token, body: mirrorCmd });
  assert.equal(ownMirror.status, 200, ownMirror.text);
  assert.match(ownMirror.json?.output?.stdout || '', /mirror-frame/);
  assert.equal(compA.state.commandsRun, 2);

  const firstLook = await api('GET', `/api/computers/${compA.nodeId}/screen`, { token: personA.token });
  assert.equal(firstLook.status, 404);
  const pushed = await compA.pushFrame();
  assert.equal(pushed.status, 200, pushed.text);
  const ownScreen = await api('GET', `/api/computers/${compA.nodeId}/screen`, { token: personA.token });
  assert.equal(ownScreen.status, 200);
  assert.deepEqual(ownScreen.bytes, JPEG);
  return { tvId, iosId, runCmd, mirrorCmd, ownRun, ownMirror, ownScreen };
}

async function verifyPersonBIsolated(personB, compA, ids, cmds) {
  assert.deepEqual((await api('GET', '/api/phone-control/devices', { token: personB.token })).json, { devices: [] });
  for (const deviceId of [ids.tvId, ids.iosId]) {
    assert.equal((await api('GET', `/api/phone-control/devices/${deviceId}`, { token: personB.token })).status, 404);
    assert.equal((await api('POST', `/api/phone-control/devices/${deviceId}`, { token: personB.token, body: { controlEnabled: false } })).status, 404);
    assert.equal((await api('DELETE', `/api/phone-control/devices/${deviceId}`, { token: personB.token })).status, 404);
  }
  assert.deepEqual((await api('GET', '/api/phone-control/history', { token: personB.token })).json, { history: [] });
  assert.deepEqual((await api('GET', '/api/phone-control/computers/reports', { token: personB.token })).json, { reports: [] });
  assert.deepEqual((await api('GET', '/api/computers', { token: personB.token })).json, { computers: [] });
  assert.equal((await api('POST', `/api/computers/${compA.nodeId}/run`, { token: personB.token, body: cmds.runCmd })).status, 404);
  const bMirror = await api('POST', `/api/computers/${compA.nodeId}/run`, { token: personB.token, body: cmds.mirrorCmd });
  assert.equal(bMirror.status, 404);
  const bScreen = await api('GET', `/api/computers/${compA.nodeId}/screen`, { token: personB.token });
  assert.equal(bScreen.status, 404);
  assert.equal(compA.state.commandsRun, 2, 'Person B caused zero commands on Person A computer');
  return { bScreenStatus: bScreen.status, bMirrorStatus: bMirror.status };
}

async function verifyPersonCRefused(personC) {
  const cUi = await api('GET', '/api/phone-control/ui', { token: personC.token });
  assert.equal(cUi.status, 200);
  assert.match(cUi.text, /Not available on your account/);
  const cDevices = await api('GET', '/api/phone-control/devices', { token: personC.token });
  assert.equal(cDevices.status, 403);
  assert.equal((await api('GET', '/api/phone-control/bridge/manifest.json', { token: personC.token })).status, 403);
  return { uiStatus: cUi.status, devicesStatus: cDevices.status };
}

async function main() {
  const pkgs = await api('GET', '/packages', { token: rootToken });
  const pkg = (pkgs.json?.packages || []).find((item) => item.name === 'phone-control');
  assert.equal(pkg?.state, 'active', JSON.stringify(pkg));

  const personA = await switchPersona('operator');
  const personB = await switchPersona('business-admin');
  const personC = await switchPersona('trader');
  assert.notEqual(personA.principalId, personB.principalId);
  assert.notEqual(personA.principalId, personC.principalId);

  await grantTemplate(personA.principalId, 'iso-admin-a', 'admin');
  await grantTemplate(personB.principalId, 'iso-admin-b', 'admin');
  await grantTemplate(personC.principalId, 'iso-operator-c', 'operator');

  const compA = await startFakeComputer(personA.token);
  try {
    const { tvId, iosId, runCmd, mirrorCmd, ownRun, ownMirror, ownScreen } = await seedPersonA(personA, compA, pkg.version);
    const { bScreenStatus, bMirrorStatus } = await verifyPersonBIsolated(personB, compA, { tvId, iosId }, { runCmd, mirrorCmd });
    const cStatus = await verifyPersonCRefused(personC);
    const receipt = {
      verifiedAt: new Date().toISOString(),
      packageVersion: pkg.version,
      personA: {
        subject: personA.subject, principalId: personA.principalId,
        ownRunStatus: ownRun.status, ownMirrorFrameStatus: ownMirror.status, ownScreenBytes: ownScreen.bytes.length
      },
      personB: {
        subject: personB.subject, principalId: personB.principalId,
        devicesCount: 0, getTvStatus: 404, getIosStatus: 404, updateDeviceStatus: 404, deleteDeviceStatus: 404,
        historyCount: 0, reportsCount: 0, computersCount: 0,
        runOnAComputerStatus: 404, mirrorFrameOnAComputerStatus: bMirrorStatus,
        screenOnAComputerStatus: bScreenStatus, commandsDeliveredToAFromB: 0
      },
      personC: { subject: personC.subject, principalId: personC.principalId, ...cStatus }
    };
    fs.writeFileSync(outFile, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt));
  } finally {
    await compA.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
