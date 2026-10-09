/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express and multer resolved from the framework checkout and the REAL engine client talking to a fake bridge that speaks the wire protocol and records every request: the caller gate and owner isolation, project create/read/rename, file write/read/download/upload/delete with path and .godot refusals, godot-mcp and Blender Lab MCP calls (projectPath never reaches the engine; the wrong project kind is refused), run, preview and export artifacts, restore, Blender-to-Godot import, a concurrent write answered 409 with its orphan blob removed, revision pruning, delete behind confirm, the engine-down reason with the install command, and Home.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 0.2.0: the in-memory pool and the fake engine bridge moved to tests/scene.fixture.cjs, shared with the package-tool suites; this suite imports them and is otherwise unchanged. Its context carries no `tools` or `authorization` port, as in an isolated route test, so the route entry registers neither the package tools nor the resource adapter and every route answers exactly as before.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer. Not part of the store-CI
 * wildcard; run: OSHAL_CORE_DIR=<oshal checkout> node --test tests/routes.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');

// ── Framework doubles: exactly the @/ modules the package imports (the confirmation helper mirrors core's) ──
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error(obj, msg) { const err = obj && typeof obj === 'object' && obj.err; console.error('[package]', msg || obj, err instanceof Error ? err.stack : err || ''); } }) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => Boolean(body && typeof body === 'object' && body.confirm === true),
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true. No write was attempted.` }),
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (STUBS[request]) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
    return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const express = coreRequire('express');
const { createSceneStudioRoutes } = require(path.join(PKG, 'routes', 'scene-studio-routes.js'));
const { createHomeSummaryRoutes } = require(path.join(PKG, 'routes', 'home-summary.js'));
const { EngineClient } = require(path.join(PKG, 'routes', 'engine-client.js'));
const { HASH, PNG, b64, fakePool, fakeEngine } = require('./scene.fixture.cjs');

// ── The app under test ───────────────────────────────────────────────────────
let currentSub = 'alice';
let server, baseUrl, engine, pool, dataRoot;
const onMcp = { fn: () => ({ text: 'ok', isError: false, changed: false, delta: { added: [], modified: [], deleted: [] } }) };
test.before(async () => {
  engine = await fakeEngine(onMcp);
  pool = fakePool();
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-studio-'));
  const app = express();
  app.use((req, _res, next) => { if (currentSub) req.oidc = { user: { sub: currentSub }, isAuthenticated: () => true }; next(); });
  app.use(express.json({ limit: '100kb' }));
  const ctx = { pool, appPackageDir: PKG };
  app.use('/api/scene-studio/home-summary', createHomeSummaryRoutes(ctx));
  app.use('/api/scene-studio', createSceneStudioRoutes(ctx, { dataRoot, env: { SCENE_STUDIO_ENGINE_ADDR: `127.0.0.1:${engine.port}`, OSHAL_API_CONTAINER: 'oshal-local-api' }, engineBuild: HASH }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/scene-studio`;
});
test.after(() => { server.closeAllConnections(); server.close(); engine.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

async function call(p, init = {}) {
  const res = await fetch(baseUrl + p, init);
  const buf = Buffer.from(await res.arrayBuffer());
  let body = null; try { body = JSON.parse(buf.toString('utf8')); } catch (_) { body = null; }
  return { status: res.status, body, buf, headers: res.headers };
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fileText = async (id, p) => (await call(`/projects/${id}/files/read`, json('POST', { path: p }))).body;

let gameId, modelId;
test('surface, assets and capabilities serve; the caller gate answers 401', async () => {
  const page = await call('/app');
  assert.equal(page.status, 200);
  assert.ok(page.buf.toString().includes('<title>Scene Studio</title>'));
  const js = await call('/assets/scene-studio.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const caps = await call('/capabilities');
  assert.equal(caps.body.capabilities.versions.godot, '4.7.2');
  assert.deepEqual(caps.body.templates.godot, ['3d', '2d', 'empty']);
  assert.ok(caps.body.godotTools.includes('add_node'));
  assert.equal(caps.body.engine.expectedBuildHash, HASH);
  currentSub = null;
  assert.equal((await call('/projects')).status, 401);
  currentSub = 'alice';
});

test('a project is created from the engine template as revision 1; bad kinds and templates are refused', async () => {
  assert.equal((await call('/projects', json('POST', { kind: 'unreal' }))).status, 400);
  assert.equal((await call('/projects', json('POST', { kind: 'godot', template: 'vr' }))).status, 400);
  const made = await call('/projects', json('POST', { kind: 'godot', title: 'Island game', template: '3d' }));
  assert.equal(made.status, 201);
  gameId = made.body.project.projectId;
  assert.equal(made.body.project.revision, 1);
  assert.equal(made.body.project.fileCount, 2);
  const detail = await call(`/projects/${gameId}`);
  assert.deepEqual(detail.body.files.map((f) => f.path), ['main.tscn', 'project.godot']);
  assert.equal(detail.body.revisions[0].action, 'create');
  assert.equal(engine.requests.find((r) => r.op === 'new_project').template, '3d');
});

test('files: write is a revision, read and download return it, unsafe paths and derived state are refused', async () => {
  const wrote = await call(`/projects/${gameId}/files`, json('PUT', { path: 'scripts/player.gd', text: 'extends Node3D\n' }));
  assert.equal(wrote.status, 200);
  assert.equal(wrote.body.project.revision, 2);
  assert.equal((await fileText(gameId, 'scripts/player.gd')).text, 'extends Node3D\n');
  const dl = await call(`/projects/${gameId}/files/download?path=scripts/player.gd`);
  assert.equal(dl.buf.toString(), 'extends Node3D\n');
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="player.gd"/);
  for (const bad of ['../escape.gd', '/etc/passwd', '.godot/imported/x.res', 'a//b.gd']) {
    assert.equal((await call(`/projects/${gameId}/files`, json('PUT', { path: bad, text: 'x' }))).status, 400, bad);
  }
  assert.equal((await call(`/projects/${gameId}/files`, json('PUT', { path: 'big.gd', text: 'x'.repeat(95 * 1024) }))).status, 413);
  assert.equal((await fileText(gameId, 'nope.gd')).error, 'invalid_file');
});

test('an upload is a revision; delete removes the file and restore brings the earlier state back', async () => {
  const form = new FormData();
  form.append('path', 'assets/tex.png');
  form.append('file', new Blob([PNG]), 'tex.png');
  const up = await call(`/projects/${gameId}/files/upload`, { method: 'POST', body: form });
  assert.equal(up.status, 201);
  assert.equal(up.body.project.revision, 3);
  assert.equal((await fileText(gameId, 'assets/tex.png')).binary, true);
  const del = await call(`/projects/${gameId}/files`, json('DELETE', { path: 'assets/tex.png' }));
  assert.equal(del.body.project.revision, 4);
  assert.equal((await call(`/projects/${gameId}/files`, json('DELETE', { path: 'assets/tex.png' }))).status, 404);
  const restored = await call(`/projects/${gameId}/restore`, json('POST', { revision: 3 }));
  assert.equal(restored.body.project.revision, 5);
  assert.equal((await fileText(gameId, 'assets/tex.png')).bytes, PNG.length);
  assert.equal((await call(`/projects/${gameId}/restore`, json('POST', { revision: 99 }))).status, 404);
});

test('a godot-mcp call reaches the engine with the files and never a projectPath; the change is a revision', async () => {
  onMcp.fn = (req) => ({ text: `added ${req.arguments.nodeName}`, isError: false, changed: true, delta: { added: [], modified: ['main.tscn'], deleted: [] }, files: [...req.files.filter((f) => f.path !== 'main.tscn'), { path: 'main.tscn', data: b64('[gd_scene format=3]\n[node name="Lamp"]\n') }] });
  const out = await call(`/projects/${gameId}/godot/add_node`, json('POST', { projectId: gameId, scenePath: 'main.tscn', nodeType: 'OmniLight3D', nodeName: 'Lamp', timeoutMs: 5 }));
  assert.equal(out.status, 200);
  assert.equal(out.body.changed, true);
  assert.equal(out.body.result.text, 'added Lamp');
  assert.equal(out.body.project.revision, 6);
  const sent = engine.requests.filter((r) => r.op === 'mcp_call').pop();
  assert.deepEqual(sent.arguments, { scenePath: 'main.tscn', nodeType: 'OmniLight3D', nodeName: 'Lamp' }, 'framework fields stripped');
  assert.equal(sent.server, 'godot');
  assert.ok(sent.files.some((f) => f.path === 'scripts/player.gd'), 'the current revision travelled');
  assert.match((await fileText(gameId, 'main.tscn')).text, /Lamp/);
  assert.equal((await call(`/projects/${gameId}/godot/add_node`, json('POST', { projectPath: '/etc', scenePath: 'main.tscn' }))).status, 400);
  assert.equal((await call(`/projects/${gameId}/godot/launch_editor`, json('POST', {}))).status, 400);
  assert.equal((await call(`/projects/${gameId}/blender/execute_blender_code_for_cli`, json('POST', { code: 'x' }))).status, 400, 'wrong project kind');
});

test('a read-only tool reply changes nothing; run, preview and export record artifacts the routes serve', async () => {
  onMcp.fn = () => ({ text: '{"name":"Island game"}', isError: false, changed: false, delta: { added: [], modified: [], deleted: [] } });
  const info = await call(`/projects/${gameId}/godot/get_project_info`, json('POST', {}));
  assert.equal(info.body.changed, false);
  assert.equal(info.body.project.revision, 6);
  const run = await call(`/projects/${gameId}/run`, json('POST', { seconds: 2 }));
  assert.deepEqual(run.body.run.output, ['Godot Engine v4.7.2', 'hello from _ready']);
  assert.equal(run.body.project.lastRun.revision, 6);
  assert.equal((await call(`/projects/${gameId}/run`, json('POST', { seconds: 99 }))).status, 400);
  const preview = await call(`/projects/${gameId}/preview`, json('POST', { samples: 8 }));
  assert.equal(preview.body.preview.revision, 6);
  const png = await call(preview.body.preview.png.replace('/api/scene-studio', ''));
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.deepEqual(png.buf, PNG);
  assert.equal((await call(preview.body.preview.stlUrl.replace('/api/scene-studio', ''))).buf.toString(), 'solid-fake');
  const exp = await call(`/projects/${gameId}/export`, json('POST', { format: 'zip' }));
  assert.equal((await call(exp.body.export.url.replace('/api/scene-studio', ''))).buf.toString(), 'EXPORT-zip');
  assert.equal((await call(`/projects/${gameId}/export`, json('POST', { format: 'fbx' }))).status, 400, 'fbx is a Blender export');
  assert.equal((await call(`/projects/${gameId}/artifacts/secret.txt`)).status, 400, 'only allowlisted artifact names');
  assert.equal((await call(`/projects/${gameId}/artifacts/..%2f..%2fsecret`)).status, 400, 'an encoded traversal is still not an artifact name');
  assert.equal((await call(`/projects/${gameId}/artifacts/preview.png?revision=2`)).status, 404);
});

test('a Blender project: code is saved as a revision, docs answer without a project, the model goes into the game', async () => {
  const made = await call('/projects', json('POST', { kind: 'blender', title: 'Boat' }));
  modelId = made.body.project.projectId;
  assert.equal(made.body.project.template, 'default');
  onMcp.fn = (req) => (req.tool === 'search_api_docs'
    ? { text: `hits for ${req.arguments.query}`, isError: false, changed: false, delta: { added: [], modified: [], deleted: [] } }
    : { text: '{"objects": 4}', isError: false, changed: req.save !== false, delta: { added: [], modified: ['scene.blend'], deleted: [] }, files: [{ path: 'scene.blend', data: b64('BLENDER-v2') }] });
  const ran = await call(`/projects/${modelId}/blender/execute_blender_code_for_cli`, json('POST', { code: 'import bpy', save: true }));
  assert.equal(ran.body.project.revision, 2);
  const sent = engine.requests.filter((r) => r.op === 'mcp_call').pop();
  assert.deepEqual([sent.server, sent.save, sent.arguments], ['blender', true, { code: 'import bpy' }]);
  const peek = await call(`/projects/${modelId}/blender/execute_blender_code_for_cli`, json('POST', { code: 'result = {}', save: false }));
  assert.equal(peek.body.changed, false);
  const docs = await call('/blender-docs', json('POST', { tool: 'search_api_docs', query: 'primitive_cube_add' }));
  assert.equal(docs.body.text, 'hits for primitive_cube_add');
  assert.equal((await call('/blender-docs', json('POST', { tool: 'execute_blender_code_for_cli', code: 'x' }))).status, 400);
  const imported = await call(`/projects/${gameId}/import-model`, json('POST', { fromProjectId: modelId, name: 'boat', instance: { nodeName: 'Boat' } }));
  assert.equal(imported.body.resPath, 'res://models/boat.glb');
  assert.equal(engine.requests.filter((r) => r.op === 'import_model').pop().fromFiles[0].data, b64('BLENDER-v2'));
  assert.equal((await call(`/projects/${modelId}/import-model`, json('POST', { fromProjectId: gameId, name: 'x' }))).status, 400, 'a Godot project is not a model source');
});

test('another person sees none of it; a concurrent write is a 409 with its blob removed', async () => {
  currentSub = 'bob';
  assert.deepEqual((await call('/projects')).body.projects, []);
  assert.equal((await call(`/projects/${gameId}`)).status, 404);
  assert.equal((await call(`/projects/${gameId}/files`, json('PUT', { path: 'x.gd', text: 'x' }))).status, 404);
  currentSub = 'alice';
  onMcp.fn = (req) => {
    pool.tables.scene_project.find((p) => p.project_id === gameId).revision += 100;
    return { text: 'raced', isError: false, changed: true, delta: { added: [], modified: ['main.tscn'], deleted: [] }, files: req.files };
  };
  const blobsBefore = fs.readdirSync(path.join(dataRoot, fs.readdirSync(dataRoot)[0], gameId, 'revisions')).length;
  const raced = await call(`/projects/${gameId}/godot/save_scene`, json('POST', { scenePath: 'main.tscn' }));
  assert.equal(raced.status, 409);
  const blobsAfter = fs.readdirSync(path.join(dataRoot, fs.readdirSync(dataRoot)[0], gameId, 'revisions')).length;
  assert.equal(blobsAfter, blobsBefore, 'the losing write removed its own blob');
  pool.tables.scene_project.find((p) => p.project_id === gameId).revision -= 100;
});

test('revisions beyond the keep window are pruned with their blobs', async () => {
  for (let i = 0; i < 42; i += 1) await call(`/projects/${modelId}/files`, json('PUT', { path: 'notes.txt', text: `step ${i}` }));
  const revs = pool.tables.scene_revision.filter((r) => r.project_id === modelId).map((r) => r.revision).sort((a, b) => a - b);
  assert.equal(revs.length, 40);
  assert.equal(revs[revs.length - 1], 2 + 42);
  const dir = path.join(dataRoot, fs.readdirSync(dataRoot)[0], modelId, 'revisions');
  assert.equal(fs.readdirSync(dir).length, 40);
  assert.equal((await call(`/projects/${modelId}/restore`, json('POST', { revision: 1 }))).status, 404, 'a pruned revision is gone');
});

test('Home reads metadata; delete needs confirm and removes the files; a down engine names the install command', async () => {
  const home = await call('/home-summary');
  assert.equal(home.body.metrics.find((m) => m.id === 'projects-total').value, '2');
  const refused = await call(`/projects/${modelId}`, json('DELETE', {}));
  assert.equal(refused.status, 428);
  assert.equal(refused.body.error, 'confirmation_required');
  assert.equal((await call(`/projects/${modelId}`, json('DELETE', { confirm: true }))).status, 200);
  assert.equal(fs.existsSync(path.join(dataRoot, fs.readdirSync(dataRoot)[0], modelId)), false);
  engine.close();
  const down = new EngineClient({ host: '127.0.0.1', port: 1, expectedBuildHash: HASH, installHint: 'docker exec oshal-local-api sh x/install-engine.sh', helloTimeoutMs: 300 });
  const app = express();
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'alice' } }; next(); });
  app.use(express.json());
  app.use('/s', createSceneStudioRoutes({ pool, appPackageDir: PKG }, { dataRoot, engine: down, engineBuild: HASH, env: {} }));
  const other = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${other.address().port}/s`;
  const caps = await (await fetch(`${base}/capabilities`)).json();
  assert.equal(caps.capabilities, null);
  assert.match(caps.reason, /install-engine\.sh/);
  const run = await fetch(`${base}/projects/${gameId}/run`, json('POST', {}));
  assert.equal(run.status, 503);
  down.close();
  other.closeAllConnections();
  other.close();
});
