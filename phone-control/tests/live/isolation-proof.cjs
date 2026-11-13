/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.2.0 two-administrator and non-admin isolation proof against a disposable oshald + Postgres: Person A (operator) and Person B (business-admin) both hold phone-control admin, Person C (trader) holds phone-control operator; proves Person B reads 404/empty on every device, history, report, computer, screen and command of Person A with zero leaked commands, and Person C gets 200 on /ui and 403 on /devices.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: extend disposable-kernel isolation proof to cover Person A's mirrored iPhone record and mirror-frame command alongside TV, proving Person B gets 404/empty and zero leaked commands on Person A's mirrored iPhone.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): every person uses their own devices. Person B is no longer a second administrator: the trader persona (a member, not an installation administrator) with the operator template. After the same isolation checks against Person A, Person B joins a computer of their own, adds a TV on it without naming a computer, presses it, and the kernel delivers that one command to Person B's computer and none to Person A's; Person A reads 404 on Person B's TV; and Person B is refused when previewing or applying a role for themselves (giving access stays with the installation's administrators). Person C is the student persona with the viewer template: the page with its card, 403 on listing, adding and the bridge files.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): the server a provisioned device is told to sign in to, through the real kernel. On the loopback address of this throwaway kernel the installation's public address is not known, so POST /provision without serverUrl answers server_required in words; a public-origin header sent by the caller changes nothing (the kernel does not forward it, so it cannot be forged); a request that arrives on a public host name is planned for https at that host; and a named serverUrl is used as given.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
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

async function startFakeComputer(ownerToken, name = 'Spark-A') {
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
        body: { name, platform: 'linux', arch: 'arm64', tools: ALL_TOOLS, wait_ms: 150 }
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
  assert.deepEqual((await api('GET', '/api/computers', { token: personB.token })).json.computers, [], 'Person B has no computer yet and is shown nobody else\'s');
  assert.equal((await api('POST', `/api/computers/${compA.nodeId}/run`, { token: personB.token, body: cmds.runCmd })).status, 404);
  const bMirror = await api('POST', `/api/computers/${compA.nodeId}/run`, { token: personB.token, body: cmds.mirrorCmd });
  assert.equal(bMirror.status, 404);
  const bScreen = await api('GET', `/api/computers/${compA.nodeId}/screen`, { token: personB.token });
  assert.equal(bScreen.status, 404);
  assert.equal(compA.state.commandsRun, 2, 'Person B caused zero commands on Person A computer');
  return { bScreenStatus: bScreen.status, bMirrorStatus: bMirror.status };
}

/**
 * Person B, who is not an administrator, on a computer of their own: adds a TV without naming a computer, presses
 * it, and the kernel delivers that one command to Person B's computer and none to Person A's.
 */
async function verifyPersonBOwnDevices(personA, personB, compA) {
  const compB = await startFakeComputer(personB.token, 'Laptop-B');
  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const report = await api('POST', `/api/phone-control/computers/${compB.nodeId}/report`, { token: personB.token, body: { report: { adb: { ready: true } } } });
    assert.equal(report.status, 200, report.text);
    const added = await api('POST', '/api/phone-control/devices', { token: personB.token, body: { name: 'Bedroom Fire TV', address: '192.168.1.70' } });
    assert.equal(added.status, 201, added.text);
    assert.equal(added.json.device.computerNodeId, compB.nodeId, 'Person B\'s own computer connects it');
    const tvId = added.json.device.id;
    const pressed = await api('POST', `/api/phone-control/devices/${tvId}/execute`, { token: personB.token, body: { action: 'key', key: 'OK' } });
    assert.equal(pressed.status, 200, pressed.text);
    const request = pressed.json.computerRunRequest;
    assert.equal(request.endpoint, `/api/computers/${compB.nodeId}/run`);
    const ran = await api(request.method, request.endpoint, { token: personB.token, body: request.body });
    assert.equal(ran.status, 200, ran.text);
    assert.equal(compB.state.commandsRun, 1, 'the press reached Person B\'s own computer');
    assert.equal(compA.state.commandsRun, 2, 'and nothing reached Person A\'s');
    const aLook = await api('GET', `/api/phone-control/devices/${tvId}`, { token: personA.token });
    assert.equal(aLook.status, 404, 'an administrator of the application sees nobody else\'s device');
    const renamed = await api('POST', `/api/phone-control/devices/${tvId}`, { token: personB.token, body: { name: 'Bedroom TV' } });
    assert.equal(renamed.json?.device?.name, 'Bedroom TV', renamed.text);
    const removed = await api('DELETE', `/api/phone-control/devices/${tvId}`, { token: personB.token });
    assert.equal(removed.status, 204, removed.text);
    return { addStatus: added.status, pressStatus: pressed.status, runStatus: ran.status, commandsOnOwnComputer: compB.state.commandsRun, removeStatus: removed.status, seenByAStatus: aLook.status };
  } finally {
    await compB.stop();
  }
}

/** POST /provision through the kernel with exactly these extra headers; `host` replaces the Host the request arrives on. */
function provisionThroughKernel(person, body, extra = {}) {
  const target = new URL(base);
  const payload = JSON.stringify(body);
  const headers = { authorization: `Bearer ${person.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), host: target.host, ...extra };
  const options = { host: target.hostname, port: target.port, method: 'POST', path: '/api/phone-control/provision', setHost: false, headers };
  return new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: response.statusCode, json, text });
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

/** A provisioned device is told the installation the request arrived on, or the route says it does not know. */
async function verifyProvisionAddress(person) {
  const tv = { serialOrIp: '192.168.1.72' };
  const unknown = await provisionThroughKernel(person, tv);
  assert.equal(unknown.status, 400, unknown.text);
  assert.equal(unknown.json?.error, 'server_required', unknown.text);
  assert.match(unknown.json.message, /^Say which server this TV should connect to\. /);
  const forged = await provisionThroughKernel(person, tv, { 'x-oshal-public-origin': 'https://elsewhere.example.com' });
  assert.equal(forged.json?.error, 'server_required', 'the kernel does not forward a caller\'s public-origin header');
  const arrived = await provisionThroughKernel(person, tv, { host: 'slot-b.example.com' });
  assert.equal(arrived.status, 200, arrived.text);
  assert.equal(arrived.json.args.serverUrl, 'https://slot-b.example.com', 'the public host the request arrived on, as https');
  const named = await provisionThroughKernel(person, { ...tv, serverUrl: 'https://chosen.example.org' });
  assert.equal(named.json?.args?.serverUrl, 'https://chosen.example.org', named.text);
  return { unknownStatus: unknown.status, unknownError: unknown.json.error, forgedHeaderError: forged.json.error, arrivedOnPublicHost: arrived.json.args.serverUrl, named: named.json.args.serverUrl };
}

/** Giving access is the installation administrators' alone: Person B cannot preview or apply a role for themselves. */
async function verifyPersonBGivesNoAccess(personB) {
  const cat = await api('GET', '/api/authorization/composites', { token: rootToken });
  assert.equal(cat.status, 200, cat.text);
  const req = {
    target: personB.principalId, assignment_id: 'iso-self-admin-b', action: 'assign',
    selection: { kind: 'composite', app: 'phone-control', template: 'admin', optional_apps: [] },
    expected_revision: cat.json.revision, expected_plan_revision: null, expires_at: null,
    reason: 'disposable isolation proof (a person gives themselves the administrator role)', idempotency_key: `iso-${crypto.randomUUID()}`
  };
  const preview = await api('POST', '/api/authorization/composites/preview', { token: personB.token, body: req });
  assert.equal(preview.status, 403, preview.text);
  const apply = await api('POST', '/api/authorization/composites/apply', { token: personB.token, body: { ...req, expected_plan_revision: 'none' } });
  assert.equal(apply.status, 403, apply.text);
  const after = await api('GET', '/api/authorization/composites', { token: rootToken });
  assert.equal(after.json.revision, cat.json.revision, 'no role changed');
  return { previewRoleStatus: preview.status, applyRoleStatus: apply.status };
}

async function verifyPersonCRefused(personC) {
  const cUi = await api('GET', '/api/phone-control/ui', { token: personC.token });
  assert.equal(cUi.status, 200);
  assert.match(cUi.text, /Not available on your account/);
  const cDevices = await api('GET', '/api/phone-control/devices', { token: personC.token });
  assert.equal(cDevices.status, 403);
  const cAdd = await api('POST', '/api/phone-control/devices', { token: personC.token, body: { name: 'TV', address: '192.168.1.71' } });
  assert.equal(cAdd.status, 403, cAdd.text);
  assert.equal((await api('GET', '/api/phone-control/bridge/manifest.json', { token: personC.token })).status, 403);
  return { uiStatus: cUi.status, devicesStatus: cDevices.status, addStatus: cAdd.status };
}

async function main() {
  const pkgs = await api('GET', '/packages', { token: rootToken });
  const pkg = (pkgs.json?.packages || []).find((item) => item.name === 'phone-control');
  assert.equal(pkg?.state, 'active', JSON.stringify(pkg));

  const personA = await switchPersona('operator');
  const personB = await switchPersona('trader');
  const personC = await switchPersona('student');
  assert.notEqual(personA.principalId, personB.principalId);
  assert.notEqual(personA.principalId, personC.principalId);
  assert.notEqual(personB.principalId, personC.principalId);

  await grantTemplate(personA.principalId, 'iso-admin-a', 'admin');
  await grantTemplate(personB.principalId, 'iso-operator-b', 'operator');
  await grantTemplate(personC.principalId, 'iso-viewer-c', 'viewer');

  const compA = await startFakeComputer(personA.token);
  try {
    const { tvId, iosId, runCmd, mirrorCmd, ownRun, ownMirror, ownScreen } = await seedPersonA(personA, compA, pkg.version);
    const { bScreenStatus, bMirrorStatus } = await verifyPersonBIsolated(personB, compA, { tvId, iosId }, { runCmd, mirrorCmd });
    const bOwn = await verifyPersonBOwnDevices(personA, personB, compA);
    const bAccess = await verifyPersonBGivesNoAccess(personB);
    const provision = await verifyProvisionAddress(personB);
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
        screenOnAComputerStatus: bScreenStatus, commandsDeliveredToAFromB: 0,
        role: 'operator (not an administrator)', ownDevice: bOwn, ...bAccess
      },
      personC: { subject: personC.subject, principalId: personC.principalId, ...cStatus },
      provision
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
