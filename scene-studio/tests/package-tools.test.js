/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.2.0: the director's 22 in-process package tools through their real handlers (routes/scene-tools.js), the REAL engine client against the fake bridge and the owner-keyed in-memory pool (tests/scene.fixture.cjs): each tool registers once; a missing, inactive or issuer-less actor is refused before any query or engine request; identity is never an input and one owner never reaches another's project; inputs are closed (unknown, missing and mistyped keys, a bad UUID, projectPath and blend_file are refused); writes are revisions shaped like the route replies; godot-mcp gets only its own arguments and read-only tools never commit; Blender saves by default; run, preview, export, import and restore mirror the routes; replies stay inside the 192 KiB budget with honest counts and a 2 MB read is cut to 96 KiB on a character boundary; a stuck engine is refused at the deadline; a down engine answers with the install command; every failure class keeps the route's code, status and field; and no log line carries file text or code. Plain Node with the logger stubbed: it runs in the bare store CI.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const logs = [];
const recorder = (bindings) => Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, (obj, msg) => { logs.push({ level, module: bindings.module, obj, msg }); }]));
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: recorder };
  return originalLoad.call(this, request, parent, isMain);
};
const PKG = path.resolve(__dirname, '..');
const routes = (name) => require(path.join(PKG, 'routes', name));
const { createSceneToolHandlers, registerSceneStudioTools } = routes('scene-tools.js');
const { capabilityCache, describeCapabilities } = routes('scene-capabilities.js');
const { EngineClient, EngineFailure } = routes('engine-client.js');
const result = routes('tool-result.js');
const { classifyFailure } = routes('project-view.js');
const { FileError } = routes('project-files.js');
const { ConflictError, NotFoundError, RequestError } = routes('project-service.js');
const { SCENE_TOOL_SPECS } = routes('tool-input.js');
const { GODOT_TOOLS } = routes('tool-contract.js');
const { subHash } = routes('data-dir.js');
const { HASH, PNG, b64, fakePool, fakeEngine } = require('./scene.fixture.cjs');

const ISSUER = 'https://identity.example.test';
const ALICE = { sub: 'alice', issuer: ISSUER, isActive: true };
const BOB = { sub: 'bob', issuer: ISSUER, isActive: true };
const SECRET_TEXT = 'extends Node3D # scene-tools-log-sentinel-text\n';
const SECRET_CODE = 'import bpy  # scene-tools-log-sentinel-code';
const PROJECT_KEYS = ['projectId', 'title', 'kind', 'template', 'revision', 'fileCount', 'totalBytes', 'preview', 'lastRun', 'createdAt', 'updatedAt'];
const NO_DELTA = { added: [], modified: [], deleted: [] };
const onMcp = { fn: () => ({ text: 'ok', isError: false, changed: false, delta: NO_DELTA }) };
let actor = ALICE;
let bridge, engine, pool, dataRoot, tools, gameId, modelId;

/** @description Tool dependencies around one engine client (one capability cache, like the route entry). */
function depsFor(client, extra = {}) {
  const caps = capabilityCache(client);
  return { pool, engine: client, dataRoot, engineBuild: HASH, capabilities: () => describeCapabilities(client, caps), ...extra };
}
const call = (name, input, handlers = tools) => handlers.get(name)(input);
async function refusal(name, input, handlers = tools) {
  try { await call(name, input, handlers); } catch (error) { return error; }
  return assert.fail(`${name} was not refused`);
}
const lastRequest = (op) => bridge.requests.filter((r) => r.op === op).pop();
const sizeOf = (value) => Buffer.byteLength(JSON.stringify(value));

test.before(async () => {
  bridge = await fakeEngine(onMcp);
  pool = fakePool();
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-tools-'));
  engine = new EngineClient({ host: '127.0.0.1', port: bridge.port, expectedBuildHash: HASH, installHint: 'docker exec oshal-local-api sh x/install-engine.sh' });
  tools = createSceneToolHandlers(depsFor(engine), () => actor);
});
test.after(() => { engine.close(); bridge.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

test('the 22 tools register once on the kernel port, with the actor from the authorization port; no port, no registration', async () => {
  const registered = new Map();
  const port = { register(name, handler) { if (registered.has(name)) throw new Error(`duplicate ${name}`); assert.equal(typeof handler, 'function'); registered.set(name, handler); } };
  let portActor;
  const ctx = { pool, tools: port, authorization: { currentActor: () => portActor, registerResource() {} } };
  registerSceneStudioTools(ctx, depsFor(engine));
  assert.deepEqual([...registered.keys()], SCENE_TOOL_SPECS.map((spec) => spec.name));
  assert.equal(registered.size, 22);
  assert.throws(() => registerSceneStudioTools(ctx, depsFor(engine)), /duplicate scene-capabilities/, 'a second registration is the duplicate the kernel refuses');
  const denied = await refusal('scene-list-projects', undefined, registered);
  assert.equal(denied.code, 'signed_in_owner_required', 'the registered handler reads the authorization port, not the input');
  portActor = BOB;
  assert.deepEqual(await call('scene-list-projects', undefined, registered), { projects: [] });
  assert.doesNotThrow(() => registerSceneStudioTools({ pool }, depsFor(engine)), 'an isolated route test has no port');
});

test('no actor, an inactive actor or one without an issuer is refused before any query or engine request', async () => {
  const before = { sql: pool.statements.length, engine: bridge.requests.length };
  const inputs = { 'scene-capabilities': {}, 'scene-list-projects': {}, 'scene-create-project': { title: 'x', kind: 'godot' }, 'godot-project-info': { projectId: '00000000-0000-4000-8000-000000000000' } };
  for (const who of [undefined, { ...ALICE, isActive: false }, { ...ALICE, issuer: '' }, { ...ALICE, sub: '' }]) {
    actor = who;
    for (const [name, input] of Object.entries(inputs)) {
      const error = await refusal(name, input);
      assert.equal(error.code, 'signed_in_owner_required', name);
      assert.equal(error.status, 401);
    }
  }
  actor = ALICE;
  assert.deepEqual({ sql: pool.statements.length, engine: bridge.requests.length }, before);
});

test('create, write and read: each write is one revision, and the replies have the route shapes', async () => {
  const made = await call('scene-create-project', { title: '  Island   game ', kind: 'godot', template: '3d' });
  gameId = made.project.projectId;
  assert.deepEqual(Object.keys(made.project), PROJECT_KEYS);
  assert.deepEqual([made.project.title, made.project.revision, made.project.fileCount], ['Island game', 1, 2]);
  assert.equal(lastRequest('new_project').template, '3d');
  const wrote = await call('scene-write-file', { projectId: gameId, path: 'scripts/player.gd', text: SECRET_TEXT });
  assert.deepEqual(Object.keys(wrote), ['project', 'changed']);
  assert.deepEqual([wrote.project.revision, wrote.changed], [2, true]);
  const bytes = Buffer.byteLength(SECRET_TEXT);
  assert.deepEqual(await call('scene-read-file', { projectId: gameId, path: 'scripts/player.gd' }),
    { path: 'scripts/player.gd', bytes, revision: 2, binary: false, text: SECRET_TEXT, truncated: false, shownBytes: bytes });
  const detail = await call('scene-get-project', { projectId: gameId });
  assert.deepEqual(detail.files.map((f) => f.path), ['main.tscn', 'project.godot', 'scripts/player.gd']);
  assert.deepEqual(detail.revisions.map((r) => [r.revision, r.action]), [[2, 'write-file'], [1, 'create']]);
  assert.equal(detail.engine.expectedBuildHash, HASH);
  for (const [input, code, field, status] of [
    [{ path: '../escape.gd', text: 'x' }, 'invalid_file', 'path', 400], [{ path: '.godot/imported/x.res', text: 'x' }, 'invalid_file', 'path', 400],
    [{ path: 'big.gd', text: 'x'.repeat(95 * 1024) }, 'invalid_file', 'text', 413],
  ]) {
    const error = await refusal('scene-write-file', { projectId: gameId, ...input });
    assert.deepEqual([error.code, error.field, error.status], [code, field, status], input.path);
  }
  assert.equal((await refusal('scene-read-file', { projectId: gameId, path: 'nope.gd' })).status, 404);
  assert.equal((await refusal('scene-create-project', { title: 'x', kind: 'unreal' })).field, 'kind');
  assert.equal((await refusal('scene-create-project', { title: 'x', kind: 'godot', template: 'vr' })).field, 'template');
});

test('identity is never an input, and one owner never reaches another owner\'s project', async () => {
  for (const input of [{ userSub: 'bob' }, { tenantId: 'tenant-a' }]) {
    const error = await refusal('scene-list-projects', input);
    assert.equal(error.code, 'invalid_tool_input');
    assert.match(error.message, /scene-list-projects accepts no input; got (userSub|tenantId)/);
  }
  assert.match((await refusal('scene-get-project', { projectId: gameId, userSub: 'bob' })).message, /accepts only projectId; got userSub/);
  actor = BOB;
  try {
    assert.deepEqual(await call('scene-list-projects'), { projects: [] });
    for (const [name, input] of [['scene-get-project', {}], ['scene-read-file', { path: 'main.tscn' }], ['scene-write-file', { path: 'x.gd', text: 'x' }],
      ['godot-add-node', { scenePath: 'main.tscn', nodeType: 'Node3D', nodeName: 'X' }], ['scene-export', {}], ['scene-restore-revision', { revision: 1 }]]) {
      const error = await refusal(name, { projectId: gameId, ...input });
      assert.deepEqual([error.code, error.status], ['project_not_found', 404], name);
    }
  } finally { actor = ALICE; }
  assert.equal(pool.tables.scene_project.find((p) => p.project_id === gameId).revision, 2, 'bob changed nothing');
});

test('inputs are closed: unknown, missing and mistyped keys are refused, and engine-owned arguments never pass', async () => {
  const before = bridge.requests.length;
  for (const [name, input, code, message] of [
    ['scene-get-project', { projectId: gameId, extra: 1 }, 'invalid_tool_input', /accepts only projectId; got extra/],
    ['scene-write-file', { projectId: gameId, path: 'a.gd' }, 'invalid_tool_input', /requires projectId, path, text; missing text/],
    ['scene-write-file', { projectId: gameId, path: 'a.gd', text: 5 }, 'invalid_request', /\(text\): text must be a string/],
    ['scene-get-project', { projectId: 'not-a-uuid' }, 'invalid_id', /Expected a UUID/],
    ['godot-add-node', { projectId: gameId, scenePath: 'main.tscn', nodeType: 'Node3D', nodeName: 'X', projectPath: '/etc' }, 'invalid_tool_input', /got projectPath/],
    ['blender-run-python', { projectId: gameId, code: 'x', blend_file: '/tmp/x.blend' }, 'invalid_tool_input', /got blend_file/],
    ['godot-add-node', { projectId: gameId, scenePath: 'main.tscn', nodeType: 'Node3D', nodeName: 'X', arguments: { projectPath: '/' } }, 'invalid_tool_input', /got arguments/],
    ['godot-run-project', { projectId: gameId, seconds: 99 }, 'invalid_request', /seconds must be an integer from 1 to 30/],
    ['blender-run-python', { projectId: gameId, code: 'x', save: 'yes' }, 'invalid_request', /save must be true or false/],
    ['godot-export-mesh-library', { projectId: gameId, scenePath: 'a.tscn', outputPath: 'a.res', meshItemNames: [1] }, 'invalid_request', /meshItemNames must be a list of strings/],
    ['scene-import-model', { projectId: gameId, fromProjectId: gameId, name: 'x', instance: { nodeName: 'A', script: 'x' } }, 'invalid_tool_input', /instance accepts only scenePath, nodeName, parentNodePath; got script/],
    ['scene-restore-revision', { projectId: gameId, revision: -1 }, 'invalid_id', /Expected a revision number/],
    ['scene-capabilities', 'text', 'invalid_tool_input', /takes a JSON object/],
    ['scene-capabilities', [1], 'invalid_tool_input', /takes a JSON object/],
  ]) {
    const error = await refusal(name, input);
    assert.equal(error.code, code, `${name} ${JSON.stringify(input)}`);
    assert.match(error.message, message);
  }
  assert.equal(bridge.requests.length, before, 'no refused call reached the engine');
});

test('a godot-mcp tool sends only its own arguments; read-only tools never commit', async () => {
  onMcp.fn = (req) => ({ text: `added ${req.arguments.nodeName}`, isError: false, changed: true, delta: { added: [], modified: ['main.tscn'], deleted: [] },
    files: [...req.files.filter((f) => f.path !== 'main.tscn'), { path: 'main.tscn', data: b64('[gd_scene format=3]\n[node name="Lamp"]\n') }] });
  const out = await call('godot-add-node', { projectId: gameId, scenePath: 'main.tscn', parentNodePath: 'root', nodeType: 'OmniLight3D', nodeName: 'Lamp', properties: { energy: 2 } });
  assert.deepEqual([out.changed, out.project.revision, out.result], [true, 3, { text: 'added Lamp', isError: false }]);
  assert.deepEqual([out.delta, out.deltaCounts, out.deltaTruncated], [{ added: [], modified: ['main.tscn'], deleted: [] }, { added: 0, modified: 1, deleted: 0 }, false]);
  const sent = lastRequest('mcp_call');
  assert.deepEqual([sent.server, sent.tool], ['godot', 'add_node']);
  assert.deepEqual(sent.arguments, { scenePath: 'main.tscn', parentNodePath: 'root', nodeType: 'OmniLight3D', nodeName: 'Lamp', properties: { energy: 2 } });
  onMcp.fn = (req) => ({ text: `{"tool":"${req.tool}"}`, isError: false, changed: false, delta: NO_DELTA });
  for (const [name, input, tool] of [['godot-get-uid', { filePath: 'main.tscn' }, 'get_uid'], ['godot-project-info', {}, 'get_project_info']]) {
    const reply = await call(name, { projectId: gameId, ...input });
    assert.deepEqual([reply.changed, reply.project.revision, lastRequest('mcp_call').tool], [false, 3, tool], name);
  }
  assert.equal(pool.tables.scene_revision.filter((r) => r.project_id === gameId).length, 3);
  const wrongKind = await refusal('blender-file-summary', { projectId: gameId });
  assert.deepEqual([wrongKind.code, wrongKind.field], ['invalid_request', 'kind']);
});

test('blender-run-python saves by default and forwards save:false; the summary never saves; docs need no project', async () => {
  const made = await call('scene-create-project', { title: 'Boat', kind: 'blender' });
  modelId = made.project.projectId;
  assert.equal(made.project.template, 'default');
  onMcp.fn = (req) => (req.tool === 'search_api_docs'
    ? { text: `hits for ${req.arguments.query}`, isError: false, changed: false, delta: NO_DELTA }
    : { text: '{"objects": 4}', isError: false, changed: req.save !== false, delta: { added: [], modified: ['scene.blend'], deleted: [] }, files: [{ path: 'scene.blend', data: b64('BLENDER-v2') }] });
  const ran = await call('blender-run-python', { projectId: modelId, code: SECRET_CODE });
  assert.equal(ran.project.revision, 2);
  const sent = lastRequest('mcp_call');
  assert.deepEqual([sent.server, sent.tool, sent.save, sent.arguments], ['blender', 'execute_blender_code_for_cli', true, { code: SECRET_CODE }]);
  const peek = await call('blender-run-python', { projectId: modelId, code: 'result = {}', save: false });
  assert.deepEqual([peek.changed, lastRequest('mcp_call').save], [false, false]);
  const summary = await call('blender-file-summary', { projectId: modelId, file: 'scene.blend' });
  assert.equal(summary.changed, false);
  assert.deepEqual([lastRequest('mcp_call').tool, lastRequest('mcp_call').save, lastRequest('mcp_call').file, lastRequest('mcp_call').arguments],
    ['get_blendfile_summary_datablocks_for_cli', false, 'scene.blend', {}]);
  assert.deepEqual(await call('blender-docs', { tool: 'search_api_docs', query: 'primitive_cube_add', max_results: 5 }), { text: 'hits for primitive_cube_add', isError: false });
  assert.deepEqual(lastRequest('mcp_call').arguments, { query: 'primitive_cube_add', max_results: 5 });
  assert.equal((await refusal('blender-docs', { tool: 'execute_blender_code_for_cli' })).field, 'tool');
});

test('run, preview and export mirror the routes and write the artifacts their URLs name', async () => {
  const run = await call('godot-run-project', { projectId: gameId, seconds: 2 });
  assert.deepEqual(run.run.output, ['Godot Engine v4.7.2', 'hello from _ready']);
  assert.deepEqual([lastRequest('godot_run').seconds, run.project.lastRun.outputLines, run.project.lastRun.errorLines], [2, 2, 0]);
  const preview = await call('scene-render-preview', { projectId: gameId, samples: 8 });
  assert.equal(preview.preview.png, `/api/scene-studio/projects/${gameId}/artifacts/preview.png?revision=3`);
  assert.equal(lastRequest('preview').samples, 8);
  const artifacts = path.join(dataRoot, subHash('alice'), gameId, 'artifacts', '3');
  assert.deepEqual(fs.readFileSync(path.join(artifacts, 'preview.png')), PNG);
  const exported = await call('scene-export', { projectId: gameId });
  assert.deepEqual(exported, { export: { format: 'zip', bytes: 'EXPORT-zip'.length, revision: 3, url: `/api/scene-studio/projects/${gameId}/artifacts/export.zip?revision=3` } });
  assert.equal(fs.readFileSync(path.join(artifacts, 'export.zip'), 'utf8'), 'EXPORT-zip');
  assert.equal((await call('scene-export', { projectId: modelId })).export.format, 'glb', 'a Blender project exports glb by default');
  assert.equal((await refusal('scene-export', { projectId: gameId, format: 'fbx' })).field, 'format');
  assert.equal((await refusal('godot-run-project', { projectId: modelId })).field, 'kind');
});

test('import and restore are revisions shaped like the route replies', async () => {
  const imported = await call('scene-import-model', { projectId: gameId, fromProjectId: modelId, name: 'boat', instance: { nodeName: 'Boat' } });
  assert.deepEqual([imported.changed, imported.resPath, imported.project.revision], [true, 'res://models/boat.glb', 4]);
  assert.deepEqual(imported.deltaCounts, { added: 1, modified: 0, deleted: 0 });
  const sent = lastRequest('import_model');
  assert.deepEqual([sent.instance, sent.fromFiles[0].data], [{ nodeName: 'Boat' }, b64('BLENDER-v2')]);
  assert.equal((await refusal('scene-import-model', { projectId: modelId, fromProjectId: gameId, name: 'x' })).field, 'kind');
  const restored = await call('scene-restore-revision', { projectId: gameId, revision: 2 });
  assert.deepEqual([restored.changed, restored.project.revision], [true, 5]);
  assert.match((await call('scene-read-file', { projectId: gameId, path: 'main.tscn' })).text, /name="Main"/);
  const missing = await refusal('scene-restore-revision', { projectId: gameId, revision: 99 });
  assert.deepEqual([missing.code, missing.status], ['revision_not_found', 404]);
});

test('a 2 MB file reads as 96 KiB on a character boundary; an escaped text reply is halved into the budget', async () => {
  const big = `x${'€'.repeat(699050)}`;
  const escaped = '\u0001'.repeat(result.TOOL_TEXT_READ_BYTES);
  onMcp.fn = (req) => ({ text: 'ok', isError: false, changed: true, delta: { added: ['big.txt', 'ctl.txt'], modified: [], deleted: [] },
    files: [...req.files, { path: 'big.txt', data: b64(big) }, { path: 'ctl.txt', data: b64(escaped) }] });
  await call('godot-save-scene', { projectId: gameId, scenePath: 'main.tscn' });
  const read = await call('scene-read-file', { projectId: gameId, path: 'big.txt' });
  assert.deepEqual([read.bytes, read.truncated, read.binary], [Buffer.byteLength(big), true, false]);
  assert.equal(read.shownBytes, result.TOOL_TEXT_READ_BYTES - 2, 'stepped back to the start of a three-byte character');
  assert.equal(Buffer.byteLength(read.text), read.shownBytes);
  assert.ok(big.startsWith(read.text) && !read.text.includes('�'), 'no character is split');
  const control = await call('scene-read-file', { projectId: gameId, path: 'ctl.txt' });
  assert.ok(sizeOf(control) <= result.TOOL_RESULT_BUDGET_BYTES);
  assert.deepEqual([control.truncated, control.shownBytes, control.text.length], [true, result.TOOL_TEXT_READ_BYTES / 4, result.TOOL_TEXT_READ_BYTES / 4]);
  assert.deepEqual(result.clipUtf8('ab😀c', 5), { text: 'ab', shownBytes: 2, truncated: true });
});

test('a project with 600 long paths and 4,000-path deltas, and 1,200 projects, stay within 192 KiB with honest counts', async () => {
  const { project } = await call('scene-create-project', { title: 'Huge', kind: 'godot', template: 'empty' });
  const long = (i) => `${'a'.repeat(100)}/${'b'.repeat(100)}/f${String(i).padStart(4, '0')}.tres`;
  const many = (tag) => Array.from({ length: 4000 }, (_, i) => `${tag}/${'c'.repeat(180)}-${i}`);
  for (let round = 0; round < 3; round += 1) {
    onMcp.fn = (req) => ({ text: 'ok', isError: false, changed: true, delta: { added: many('a'), modified: many('m'), deleted: many('d') },
      files: [...req.files.filter((f) => !f.path.startsWith('a')), ...Array.from({ length: 600 }, (_, i) => ({ path: long(i), data: b64(`r${round}`) }))] });
    await call('godot-save-scene', { projectId: project.projectId, scenePath: 'main.tscn' });
  }
  const detail = await call('scene-get-project', { projectId: project.projectId });
  assert.ok(sizeOf(detail) <= result.TOOL_RESULT_BUDGET_BYTES, `get-project is ${sizeOf(detail)} bytes`);
  const total = pool.tables.scene_project.find((p) => p.project_id === project.projectId).file_count;
  assert.equal(detail.files.length + detail.more + detail.hidden, total, 'every file is listed or counted');
  assert.ok(detail.files.length < 500 && detail.more > 100, 'files were trimmed from the end');
  const saved = detail.revisions.filter((r) => r.action === 'godot:save_scene');
  assert.equal(saved.length, 3);
  for (const r of saved) assert.deepEqual([r.detail.deltaCounts, r.detail.delta.added.length, r.detail.deltaTruncated], [{ added: 4000, modified: 4000, deleted: 4000 }, 50, true]);
  const now = new Date().toISOString();
  for (let i = 0; i < 1200; i += 1) pool.tables.scene_project.push({ project_id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, owner_sub: 'carol', title: `Carol ${i} ${'t'.repeat(100)}`, kind: 'godot', template: '3d', revision: 1, file_count: 2, total_bytes: 10, preview: null, last_run: null, created_at: now, updated_at: now });
  actor = { ...ALICE, sub: 'carol' };
  try {
    const listed = await call('scene-list-projects');
    assert.ok(sizeOf(listed) <= result.TOOL_RESULT_BUDGET_BYTES);
    assert.equal(listed.projects.length + listed.more, 1200);
  } finally { actor = ALICE; }
});

test('a stuck engine is refused at the deadline, and the late outcome is caught and logged', async () => {
  assert.equal(result.TOOL_DEADLINE_MS, 285_000);
  assert.ok(result.TOOL_DEADLINE_MS < 300_000, 'inside the node bridge\'s 300 s fetch ceiling');
  const { project } = await call('scene-create-project', { title: 'Stuck', kind: 'godot' });
  const stuckBridge = await fakeEngine({ fn: () => new Promise(() => {}) });
  const stuck = new EngineClient({ host: '127.0.0.1', port: stuckBridge.port, expectedBuildHash: HASH, installHint: 'x' });
  const handlers = createSceneToolHandlers(depsFor(stuck, { deadlineMs: 200 }), () => ALICE);
  try {
    const started = Date.now();
    const error = await refusal('godot-project-info', { projectId: project.projectId }, handlers);
    assert.deepEqual([error.code, error.status], ['tool_deadline_exceeded', 504]);
    assert.match(error.message, /did not finish godot-project-info within 200 ms; .*Read the project before retrying/);
    assert.ok(Date.now() - started < 5000);
    assert.equal(stuckBridge.requests.filter((r) => r.op === 'mcp_call').length, 1, 'the call reached the engine');
  } finally { stuck.close('spec done'); stuckBridge.close(); }
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(logs.some((l) => l.level === 'error' && l.msg === 'Scene Studio tool failed after its deadline' && l.obj.tool === 'godot-project-info'));
});

test('with the engine down, capabilities answers null with the install command and engine tools are refused with it', async () => {
  const down = new EngineClient({ host: '127.0.0.1', port: 1, expectedBuildHash: HASH, installHint: 'docker exec oshal-local-api sh x/install-engine.sh', helloTimeoutMs: 300 });
  const handlers = createSceneToolHandlers(depsFor(down), () => ALICE);
  try {
    const caps = await call('scene-capabilities', undefined, handlers);
    assert.equal(caps.capabilities, null);
    assert.match(caps.installHint, /install-engine\.sh/);
    assert.match(caps.reason, /install-engine\.sh/);
    assert.deepEqual(caps.godotTools, [...GODOT_TOOLS], 'the package contract still answers');
    for (const [name, input] of [['godot-project-info', { projectId: gameId }], ['godot-run-project', { projectId: gameId }]]) {
      const error = await refusal(name, input, handlers);
      assert.deepEqual([error.code, error.status], ['capability_unavailable', 503], name);
      assert.match(error.message, /^capability_unavailable: .*install-engine\.sh/);
    }
    assert.ok((await call('scene-list-projects', undefined, handlers)).projects.length >= 3, 'reading projects needs no engine');
  } finally { down.close(); }
});

test('every failure class keeps the route\'s code, status and field; anything else is opaque and logged with its stack', () => {
  for (const [error, status, code, field] of [
    [new EngineFailure('refused', 'bad argument'), 400, 'refused'], [new EngineFailure('engine_timeout', 'slow'), 504, 'engine_timeout'],
    [new EngineFailure('engine_error', 'crashed'), 502, 'engine_error'], [new EngineFailure('engine_busy', 'full'), 503, 'engine_busy'],
    [new EngineFailure('capability_unavailable', 'down', 'down — install it'), 503, 'capability_unavailable'],
    [new FileError('x is not in this project', 'path', 404), 404, 'invalid_file', 'path'], [new RequestError('kind must be godot', 'kind'), 400, 'invalid_request', 'kind'],
    [new NotFoundError(), 404, 'project_not_found'], [new NotFoundError('revision_not_found'), 404, 'revision_not_found'],
    [new ConflictError('the project changed'), 409, 'conflict'], [new RangeError('Expected a UUID'), 400, 'invalid_id'],
  ]) {
    const failure = result.toolFailure(error, 'scene-spec');
    const route = classifyFailure(error);
    assert.deepEqual([failure.status, failure.code, failure.field], [route.status, route.body.error, route.body.field]);
    assert.deepEqual([failure.status, failure.code, failure.field], [status, code, field]);
    const text = route.body.reason ?? route.body.message;
    assert.equal(failure.message, `${code}${field ? ` (${field})` : ''}${text && text !== code ? `: ${text}` : ''}`);
  }
  const errorsBefore = logs.filter((l) => l.level === 'error').length;
  const opaque = result.toolFailure(new Error('relation "internal_table" does not exist'), 'scene-spec');
  assert.deepEqual([opaque.code, opaque.status, opaque.message.includes('internal_table')], ['scene_tool_failed', 500, false]);
  assert.equal(logs.filter((l) => l.level === 'error').length, errorsBefore + 1);
  assert.ok(logs[logs.length - 1].obj.err instanceof Error, 'the unexpected error is logged with its stack');
});

test('tool logs carry the tool, project, duration and outcome, never file text or code', () => {
  const finished = logs.filter((l) => l.msg === 'Scene Studio tool finished');
  assert.ok(finished.length > 20);
  for (const entry of finished) assert.deepEqual(Object.keys(entry.obj).sort(), ['changed', 'durationMs', 'projectId', 'tool']);
  const text = JSON.stringify(logs, (_key, value) => (value instanceof Error ? value.message : value));
  for (const sentinel of ['scene-tools-log-sentinel-text', 'scene-tools-log-sentinel-code', 'primitive_cube_add']) assert.equal(text.includes(sentinel), false, sentinel);
});
