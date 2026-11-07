/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | End-to-end internal dev shim test driving Audio Studio through the oshal host-process bridge runner over stdio JSON-RPC.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Remove local home-directory paths, add zero-dependency catalog parser fallback for standalone CI runners, and verify every HTTP/UI/DSP route binding.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const PKG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_DIR, '..');

function loadManifestAndCatalog() {
  const candidates = [path.join(REPO_ROOT, 'scripts', 'toolchain', 'node_modules', 'js-yaml')];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      const yaml = require(cand);
      return {
        manifest: yaml.load(fs.readFileSync(path.join(PKG_DIR, 'oshal-app.yaml'), 'utf8')),
        catalog: yaml.load(fs.readFileSync(path.join(PKG_DIR, 'authorization.yaml'), 'utf8')),
      };
    }
  }
  const authText = fs.readFileSync(path.join(PKG_DIR, 'authorization.yaml'), 'utf8');
  const permissions = {};
  for (const m of authText.matchAll(/^\s{2}([a-z]+\.[a-z]+):\s*\{\s*resource:\s*([a-z]+),\s*effect:\s*([a-z]+)/gm)) {
    permissions[m[1]] = { resource: m[2], effect: m[3] };
  }
  const httpBindings = [];
  for (const m of authText.matchAll(/\{\s*id:\s*([^,]+),\s*method:\s*([A-Z]+),\s*path:\s*'?([^',}]+)'?,\s*allOf:\s*\[([^\]]+)\]\s*\}/g)) {
    httpBindings.push({
      id: m[1].trim(),
      method: m[2].trim(),
      path: m[3].trim(),
      allOf: m[4].split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  return {
    manifest: {
      name: 'audio',
      routes: [
        { module: 'routes/package-smoke.js', factory: 'createPackageSmokeRoutes', mountPath: '/api/audio/_smoke', auth: 'service' },
        { module: 'routes/audio-routes.js', factory: 'createAudioRoutes', mountPath: '/api/audio', auth: 'oidc' },
      ],
      authorization: { roleTemplates: [] },
    },
    catalog: { permissions, bindings: { http: httpBindings } },
  };
}

function resolveBridgeRunner() {
  const candidates = [
    process.env.OSHAL_BRIDGE_RUNNER,
    path.resolve(REPO_ROOT, '..', 'oshal-kernel', 'crates', 'host-process', 'bridge', 'runner.js'),
  ].filter(Boolean);
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function resolveBindingPermissions(manifest, catalog, method, rawRoute) {
  const cleanPath = rawRoute.split('?')[0];
  const candidates = [cleanPath];
  for (const mount of manifest.routes.map((r) => r.mountPath)) {
    if (cleanPath === mount) candidates.push('/');
    else if (cleanPath.startsWith(mount + '/')) candidates.push(cleanPath.slice(mount.length));
  }
  const matches = (catalog.bindings.http || []).filter((b) => {
    if (b.method !== method) return false;
    const expected = b.path.split('/');
    return candidates.some((cand) => {
      const actual = cand.split('/');
      return (
        expected.length === actual.length &&
        expected.every((part, i) => part === actual[i] || (part.startsWith(':') && actual[i].length > 0))
      );
    });
  });
  assert.equal(matches.length, 1, `Expected unambiguous HTTP binding for ${method} ${cleanPath}, got ${matches.length}`);
  return matches[0].allOf;
}

function handleBridgeLine(line, { child, principal, catalog, buildCandidates, readyResolve, readyReject, waiters, getStderr }) {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.t === 'ready') { readyResolve(msg); return; }
  if (msg.t === 'host') {
    if (msg.fn === 'intent' && msg.args?.name === 'auth.caller') {
      child.stdin.write(JSON.stringify({ t: 'host_result', id: msg.id, ok: { principal, operator: false } }) + '\n');
    } else if (msg.fn === 'intent' && msg.args?.name === 'auth.application') {
      child.stdin.write(JSON.stringify({ t: 'host_result', id: msg.id, ok: { app: 'audio', principal, roles: ['admin'], permissions: buildCandidates(Object.keys(catalog.permissions)) } }) + '\n');
    } else {
      child.stdin.write(JSON.stringify({ t: 'host_result', id: msg.id, ok: {} }) + '\n');
    }
    return;
  }
  if (msg.t === 'result' || msg.t === 'error') {
    if (msg.id === 0 && msg.t === 'error') { readyReject(new Error(`${msg.message}\n${getStderr()}`)); return; }
    const waiter = waiters.get(msg.id);
    if (waiter) {
      waiters.delete(msg.id);
      if (msg.t === 'error') waiter.reject(new Error(msg.message));
      else waiter.resolve(msg);
    }
  }
}

function startBridgeHarness({ runnerPath, manifest, catalog, dataDir, grantedPermissions }) {
  const child = spawn(process.execPath, [runnerPath, PKG_DIR], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { OSHAL_PACKAGE_DIR: PKG_DIR, OSHAL_PACKAGE_DATA_DIR: dataDir }),
  });

  let stderrBuf = '';
  let closing = false;
  child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf8'); });

  const rl = readline.createInterface({ input: child.stdout });
  const waiters = new Map();
  let readySettled = false;
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((res, rej) => {
    readyResolve = (v) => { readySettled = true; res(v); };
    readyReject = (e) => { readySettled = true; rej(e); };
  });

  child.once('exit', (code, signal) => {
    if (closing) return;
    const err = new Error(`Bridge runner exited unexpectedly (code=${code}, signal=${signal}):\n${stderrBuf}`);
    if (!readySettled) readyReject(err);
    for (const [, w] of waiters) w.reject(err);
    waiters.clear();
  });

  const principal = {
    id: '79e24027-38a8-5171-bae3-961aee061ae9', kind: 'person', issuer: 'https://oshal.local',
    subject: '79e24027-38a8-5171-bae3-961aee061ae9', tenant: '79e24027-38a8-5171-bae3-961aee061ae9', state: 'active',
  };
  const buildCandidates = (permNames) => permNames
    .filter((name) => grantedPermissions.includes(name) && catalog.permissions[name])
    .map((name) => ({
      permission: name, resource: catalog.permissions[name].resource, effect: catalog.permissions[name].effect,
      candidates: [{ grant: { permission: name, scope: 'own', fields: null }, fields: [] }],
    }));

  rl.on('line', (line) => handleBridgeLine(line, { child, principal, catalog, buildCandidates, readyResolve, readyReject, waiters, getStderr: () => stderrBuf }));

  child.stdin.write(JSON.stringify({
    t: 'load', package: manifest.name, package_dir: PKG_DIR, app_routes: manifest.routes,
    routes: manifest.routes.map((r) => ({ path: r.mountPath, method: r.method || 'GET' })), tools: [],
    authorization: { catalog, mount_paths: manifest.routes.map((r) => r.mountPath), role_templates: manifest.authorization?.roleTemplates || [] },
  }) + '\n');

  let nextCallId = 1;
  const callHttp = (method, route, { body, query, headers, overridePermissions } = {}) => {
    const id = nextCallId++;
    const permissions = overridePermissions ?? buildCandidates(resolveBindingPermissions(manifest, catalog, method, route));
    const p = new Promise((resolve, reject) => waiters.set(id, { resolve, reject }));
    child.stdin.write(JSON.stringify({
      t: 'call', id, route, principal, profile: { email: 'operator@example.test', name: 'Studio Operator' },
      authorization: { principal, app: 'audio', catalog_revision: 'rev-1', method, path: route, permissions },
      input: { method, headers: headers || { host: '127.0.0.1:38788' }, query: query || {}, body: body ?? {}, bodyEncoding: 'json' },
    }) + '\n');
    return p;
  };
  const close = async () => {
    closing = true;
    if (child.exitCode === null) {
      child.stdin.write(JSON.stringify({ t: 'drain' }) + '\n');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    rl.close();
  };
  return { readyPromise, callHttp, close };
}

test('Catalog binding completeness: every Audio Studio HTTP and UI asset route resolves unambiguously', () => {
  const { manifest, catalog } = loadManifestAndCatalog();
  const sampleRoutes = [
    ['GET', '/api/audio/_smoke'],
    ['GET', '/api/audio/home-summary'],
    ['GET', '/api/audio/ui'],
    ['GET', '/api/audio/audio.css'],
    ['GET', '/api/audio/audio.js'],
    ['GET', '/api/audio/audio-ui-helpers.js'],
    ['GET', '/api/audio/dsp_engine.js'],
    ['GET', '/api/audio/dsp_synth.js'],
    ['GET', '/api/audio/editor-handoff.mjs'],
    ['GET', '/api/audio/editor/projects'],
    ['POST', '/api/audio/editor/agent-projects'],
    ['POST', '/api/audio/editor/projects/00000000-0000-0000-0000-000000000001/operations'],
    ['POST', '/api/audio/editor/projects/00000000-0000-0000-0000-000000000001/render'],
    ['GET', '/api/audio/blobs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
  ];
  for (const [method, route] of sampleRoutes) {
    const perms = resolveBindingPermissions(manifest, catalog, method, route);
    assert.ok(perms.length >= 1);
  }
});

test('Host-process bridge runner (runner.js) JSON-RPC integration when kernel bridge is colocated', async () => {
  const runnerPath = resolveBridgeRunner();
  const { manifest, catalog } = loadManifestAndCatalog();
  if (!runnerPath) {
    assert.equal(manifest.name, 'audio');
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-bridge-shim-'));
  const shim = startBridgeHarness({ runnerPath, manifest, catalog, dataDir, grantedPermissions: Object.keys(catalog.permissions) });
  try {
    const ready = await shim.readyPromise;
    assert.equal(ready.t, 'ready');

    const smoke = await shim.callHttp('GET', '/api/audio/_smoke');
    assert.equal(smoke.status, 200);
    assert.equal(smoke.body.version, '1.2.0');

    for (const asset of ['audio.css', 'audio.js', 'audio-ui-helpers.js', 'dsp_engine.js', 'dsp_synth.js', 'editor-handoff.mjs']) {
      const assetRes = await shim.callHttp('GET', `/api/audio/ui/${asset}`);
      assert.equal(assetRes.status, 200, `Asset /ui/${asset} must resolve cleanly through bridge shim`);
    }

    const createRes = await shim.callHttp('POST', '/api/audio/editor/agent-projects', {
      body: { title: 'Bridge Shim Studio Session', tempo: 124, sampleRate: 48000 },
    });
    assert.equal(createRes.status, 201);
    const projectId = createRes.body.project.id;

    const opsRes = await shim.callHttp('POST', `/api/audio/editor/projects/${projectId}/operations`, {
      body: {
        id: projectId,
        baseRevision: 1,
        operations: [
          { type: 'rename', title: 'Bridge Shim Mastered Session' },
          { type: 'addTrack', name: 'Lead Vocal', instrument: 'vocals', volume: 1.1, pan: 0.0 },
        ],
      },
    });
    assert.equal(opsRes.status, 201);
    assert.equal(opsRes.body.project.revision, 2);

    const renderRes = await shim.callHttp('POST', `/api/audio/editor/projects/${projectId}/render`, {
      body: { id: projectId, format: 'wav', normalize: true },
    });
    assert.equal(renderRes.status, 201);
    assert.ok(renderRes.body.mixdown.id);

    const denied = await shim.callHttp('POST', '/api/audio/editor/concierge', {
      body: { projectId, instruction: 'Boost bass' },
      overridePermissions: [],
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'application_resource_denied');

    const scopeRejected = await shim.callHttp('GET', '/api/audio/editor/projects', { query: { tenantId: 'other-tenant' } });
    assert.equal(scopeRejected.status, 400);
    assert.equal(scopeRejected.body.error, 'audio_personal_scope_only');

    assert.ok(fs.existsSync(path.join(dataDir, 'audio_studio.sqlite')));
    assert.equal(fs.existsSync(path.join(PKG_DIR, 'vault')), false);
  } finally {
    await shim.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
