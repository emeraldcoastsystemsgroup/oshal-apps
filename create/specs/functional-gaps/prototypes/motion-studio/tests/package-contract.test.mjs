/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate actual Motion manifest/persona/catalog/schema contracts with kernel parsers and exercise declared route workflows over genuine native SQL; fixture admission is explicit.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require lasting storage and register actual private-byte and full-library source recipes.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Register durable revision growth with the genuine source Test Lab loader.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Register the genuine source crash-boundary and recovery recipe.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Register portable codec and native atomic-copy source recipes without advertising unbound tools.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Register real render producer source recipe without advertising public jobs.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Register saved manual/native layer workflow source evidence.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Validate actual read-only effect tools and register rendered effect workflow evidence.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Validate exact keyframe read/tool bindings and register native curve/path workflows.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, mkdir, rm, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..'), definition = join(root, 'package-definition.yaml');
const binary = process.env.MOTION_NATIVE_BINARY || '/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture';
const yaml = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN, 'package.json'))('js-yaml');
let source, catalog, fixture, report;
before(async () => {
  source = yaml.load(await readFile(definition, 'utf8'));
  catalog = yaml.load(await readFile(join(root, 'authorization.yaml'), 'utf8'));
  report = JSON.parse((await exec(binary, ['--package-contract', definition], { maxBuffer: 512 * 1024 })).stdout);
  fixture = await startNativeSqlFixture();
});
after(async () => { await fixture?.close(); });
async function mutate(work) {
  const dir = await mkdtemp(join(tmpdir(), 'motion-package-contract-'));
  try {
    await mkdir(join(dir, 'personas'));
    await copyFile(join(root, 'personas/motion-editor.yaml'), join(dir, 'personas/motion-editor.yaml'));
    const app = structuredClone(source), auth = structuredClone(catalog);
    work(app, auth);
    await writeFile(join(dir, 'definition.yaml'), yaml.dump(app, { noRefs: true }));
    await writeFile(join(dir, 'authorization.yaml'), yaml.dump(auth, { noRefs: true }));
    const result = await exec(binary, ['--package-contract', join(dir, 'definition.yaml')], { maxBuffer: 512 * 1024 });
    return JSON.parse(result.stdout);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function validate(name, input) {
  await exec(binary, ['--tool-input', definition, name, JSON.stringify(input)], { maxBuffer: 65536 });
}
async function tool(name, input = {}, { actor = 'alice', status = 200 } = {}) {
  const raw = source.tools.find(tool => tool.name === name);
  assert.ok(raw, 'tool must actually be declared');
  assert.equal(report.tools.find(tool => tool.name === name).bound, true);
  await validate(name, input);
  const [method, target] = raw.executor.apiEndpoint.split(' ');
  const path = target.replaceAll(/\{input\.([a-zA-Z]+)\}/g, (_, key) => encodeURIComponent(input[key]));
  const result = await fixture.call(path.slice('/api/motion-studio'.length), { actor, method,
    body: method === 'GET' ? null : input });
  assert.equal(result.status, status, JSON.stringify(result.body)); return result.body;
}
const fresh = title => ({ title, width: 320, height: 180, frameRate: 30, duration: 5, requestKey: randomUUID(), response: 'receipt' });

async function inspect(project, node = 'root', part = 'value', offset = 0) {
  const result = await tool('motion-inspect-project', { id: project.id, revision: project.revision, node, part, offset });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 60 * 1024);
  assert.equal(result.project.revision, project.revision); return result;
}
async function children(project, node) {
  let page = await inspect(project, node), entries = [...page.children];
  while (!page.complete) { assert.ok(page.nextOffset > page.offset); page = await inspect(project, node, 'value', page.nextOffset); entries.push(...page.children); }
  assert.equal(entries.length, page.totalChildren); return entries;
}
async function nodeAt(project, names, node = 'root') {
  for (const name of names) { const child = (await children(project, node)).find(child => child.nameComplete && child.name === String(name)); assert.ok(child, 'Actual field missing: ' + name); node = child.node; }
  return node;
}
async function valueAt(project, names, node = 'root') {
  node = await nodeAt(project, names, node);
  let page = await inspect(project, node);
  if (page.type !== 'string') { assert.ok('value' in page); return page.value; }
  let value = page.text;
  while (!page.complete) { page = await inspect(project, node, 'value', page.nextOffset); value += page.text; }
  return value;
}
async function composition(project) {
  const items = await nodeAt(project, ['items']);
  for (const entry of await children(project, items)) if (await valueAt(project, ['kind', 'type'], entry.node) === 'Comp') return { id: await valueAt(project, ['id'], entry.node), node: entry.node };
  assert.fail('No actual composition');
}
test('genuine importer loads forty-three exact route bindings, original own roles and the declared editing persona', async () => {
  assert.equal(source.lastingStorage, true);
  assert.equal(report.name, 'motion-studio'); assert.equal(report.runtime, 'process');
  assert.equal(report.tools.length, 43); assert.ok(report.tools.every(tool => tool.bound));
  assert.equal(report.bots.length, 1);
  const persona = yaml.load(await readFile(join(root, 'personas/motion-editor.yaml'), 'utf8'));
  assert.equal(report.bots[0].agent_id, persona.agent_id);
  assert.equal(report.bots[0].persona, persona.perspective);
  assert.deepEqual(Object.keys(persona.authorizations).sort(), source.tools.map(tool => tool.name).sort());
  assert.ok(Object.values(report.authorization.catalog.roles).every(role => role.grants.every(grant => grant.scope === 'own')));
  const permissions = name => report.authorization.catalog.roles[name].grants.map(grant => grant.permission).sort();
  assert.deepEqual(permissions('viewer'), ['project.view']);
  assert.deepEqual(permissions('creator'), ['project.create', 'project.read', 'project.view']);
  assert.deepEqual(permissions('editor'), ['project.change', 'project.read', 'project.view']);
  assert.deepEqual(permissions('exporter'), ['project.export', 'project.read', 'project.view']);
  assert.deepEqual(report.migrations.map(migration => migration.id), ['migrations/native/001-motion.sql']);
});
test('unbound or mismatched source tools lose their route contract instead of receiving wider permissions', async () => {
  const missing = await mutate((_app, auth) => { auth.bindings.tools = auth.bindings.tools.filter(binding => binding.id !== 'motion-apply-edits'); });
  assert.equal(missing.tools.find(tool => tool.name === 'motion-apply-edits').bound, false);
  const changed = await mutate((_app, auth) => { auth.bindings.tools.find(binding => binding.id === 'motion-apply-edits').allOf = ['project.view']; });
  assert.equal(changed.tools.find(tool => tool.name === 'motion-apply-edits').bound, false);
  await assert.rejects(mutate((_app, auth) => { auth.roles.viewer.grants.push({ permission: 'project.change', scope: 'own' }); }));
});
test('actual kernel schemas refuse owner selectors, missing retry keys and oversized/malformed edit batches', async () => {
  await assert.rejects(validate('motion-read-project', { id: randomUUID(), owner: 'bob' }));
  await assert.rejects(validate('motion-new-project', { ...fresh('Bad'), requestKey: undefined }));
  const input = { id: randomUUID(), baseRevision: 1, requestKey: randomUUID(), response: 'receipt' };
  await assert.rejects(validate('motion-apply-edits', { ...input, response: 'full', commands: [{command:'layer.newSolid',params:{}}] }));
  await assert.rejects(validate('motion-apply-edits', { ...input, commands: [] }));
  await assert.rejects(validate('motion-apply-edits', { ...input, commands: Array.from({ length: 33 }, () => ({ command: 'layer.newSolid', params: {} })) }));
  await assert.rejects(validate('motion-apply-edits', { ...input, commands: [{ command: 'layer.newSolid', params: {}, owner: 'bob' }] }));
  await assert.rejects(validate('motion-apply-edits', { ...input, commands: [{ command: 'text.set', params: { text: 'a'.repeat(17000) } }] }));
});
test('complete agent index and exact real schemas fit below the platform observation limit', async () => {
  const manual = await fixture.call('/editing-contract'); assert.equal(manual.status, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(manual.body)) > 65536, 'the full manual catalog would be truncated as an agent observation');
  const compact = await tool('motion-editing-contract');
  assert.equal(compact.commandIndexComplete, true);
  assert.equal(compact.commandCount, manual.body.engine.commands.length);
  assert.deepEqual(compact.engine.commands.map(command => command.id), manual.body.engine.commands.map(command => command.id));
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 60 * 1024);
  for (const command of ['layer.newSolid', 'prop.addKey', 'asset.import']) {
    const result = await tool('motion-command-schema', { command });
    assert.deepEqual(result.command, manual.body.engine.commands.find(entry => entry.id === command));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 60 * 1024);
  }
  await tool('motion-command-schema', { command: 'no.such.command' }, { status: 404 });
  await tool('motion-command-schema', { command: '../private' }, { status: 403 });
});
test('mutations retain source approval ceilings and GET export retains genuine mutating permission classification', () => {
  for (const name of ['motion-new-project', 'motion-apply-edits', 'motion-restore-revision', 'motion-delete-project', 'motion-delete-unused-asset', 'motion-fork-project', 'motion-apply-exact-edits']) {
    const contract = report.tools.find(tool => tool.name === name);
    assert.equal(contract.mutating, true); assert.equal(contract.approvalRequired, true);
  }
  const exported = report.tools.find(tool => tool.name === 'motion-export-document');
  assert.equal(exported.method, 'GET'); assert.equal(exported.mutating, true);
  assert.deepEqual(exported.permissions, ['project.view', 'project.read', 'project.export']);
});
test('declaration-backed editing workflow uses actual ids/revisions and preserves native animated pixels, undo and export', async () => {
  await tool('motion-editing-contract');
  await tool('motion-command-schema', { command: 'layer.newSolid' });
  await tool('motion-command-schema', { command: 'prop.addKey' });
  let project = (await tool('motion-new-project', fresh('Declared tool animation'))).project;
  let selected = await composition(project); const comp = selected.id;
  project = (await tool('motion-apply-edits', { id: project.id, comp, baseRevision: project.revision,
    requestKey: randomUUID(), response: 'receipt', commands: [{ command: 'layer.newSolid', params: { name: 'Actual new layer', color: '#ff0000', width: 100, height: 60 } }] })).project;
  selected = await composition(project);
  const layer = await valueAt(project, ['kind', 'layers', 0, 'id'], selected.node);
  project = (await tool('motion-apply-edits', { id: project.id, comp, baseRevision: project.revision,
    requestKey: randomUUID(), response: 'receipt', commands: [
      { command: 'prop.addKey', params: { layer, path: 'transform/opacity', time: 0, value: 0 } },
      { command: 'prop.addKey', params: { layer, path: 'transform/opacity', time: 5, value: 100 } },
    ] })).project;
  const saved = (await tool('motion-read-project', { id: project.id })).project;
  assert.equal(saved.revision, project.revision); assert.equal(saved.document, undefined);
  const full = (await fixture.call('/projects/' + project.id)).body.project;
  const preview = await fixture.call('/preview', { method: 'POST', body: { document: full.document, comp, time: 2.5 } });
  assert.equal(preview.status, 200);
  const { data, info } = await fixture.sharp(Buffer.from(preview.body.png, 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[(90 * info.width + 160) * info.channels + 3], 128);
  const history = await tool('motion-revision-history', { id: project.id, revision: project.revision, offset: 0 }); assert.equal(history.revisions.length, 3);
  const first = (await tool('motion-read-revision', { id: project.id, revision: 1 })).project;
  project = (await tool('motion-restore-revision', { id: project.id, revision: 1, baseRevision: project.revision, requestKey: randomUUID(), response: 'receipt' })).project;
  assert.equal(project.revision, 4); assert.equal(project.document, undefined);
  const prior = (await fixture.call('/projects/' + first.id + '/revisions/1')).body.project;
  const exported = await tool('motion-export-document', { id: project.id });
  const download = await fixture.call(exported.download.immutableUrl.slice('/api/motion-studio'.length));
  assert.equal(download.status, 200); assert.deepEqual(JSON.parse(download.body), prior.document);
  assert.equal(exported.download.sha256, createHash('sha256').update(download.body).digest('hex'));
  await tool('motion-read-project', { id: project.id }, { actor: 'bob', status: 404 });
  await tool('motion-list-assets');
  await tool('motion-delete-project', { id: project.id });
  await tool('motion-read-project', { id: project.id }, { status: 404 });
});
test('actual role declarations narrow fixture permissions independently for viewing, creating, changing, exporting and deleting', async () => {
  fixture.assign('alice', 'creator');
  let project;
  try {
    project = (await tool('motion-new-project', fresh('Creator-owned proof'))).project;
    await tool('motion-restore-revision', { id: project.id, revision: 1, baseRevision: 1, requestKey: randomUUID(), response: 'receipt' }, { status: 403 });
    await tool('motion-delete-project', { id: project.id }, { status: 403 });
    fixture.assign('alice', 'editor');
    await tool('motion-new-project', fresh('Editor cannot create'), { status: 403 });
    await tool('motion-export-document', { id: project.id }, { status: 403 });
    fixture.assign('alice', 'exporter');
    assert.equal((await tool('motion-export-document', { id: project.id })).download.requiresPermission, 'project.export');
    await tool('motion-restore-revision', { id: project.id, revision: 1, baseRevision: 1, requestKey: randomUUID(), response: 'receipt' }, { status: 403 });
    fixture.assign('alice', 'viewer');
    await tool('motion-editing-contract'); await tool('motion-list-projects', { stamp: 'start', offset: 0 }, { status: 403 });
  } finally {
    fixture.assign('alice', 'administrator');
    if (project) await tool('motion-delete-project', { id: project.id });
  }
});
test('large real native text remains exactly inspectable after bounded agent edits, and export bytes stay revision-pinned', async () => {
  let project = (await tool('motion-new-project', fresh('Large actual native document'))).project;
  const comp = (await composition(project)).id;
  const text = ('An original Unicode caption 😀\n').repeat(330);
  for (let batch = 0; batch < 2; batch++) {
    const added = await fixture.call('/projects/' + project.id + '/operations', { method: 'POST', body: {
      baseRevision: project.revision, requestKey: randomUUID(), response: 'receipt', comp,
      commands: Array.from({ length: 4 }, (_, index) => ({ command: 'layer.newText', params: { name: 'Caption ' + (batch * 4 + index), text, size: 36, position: [100, 80] } })) } });
    assert.equal(added.status, 200, JSON.stringify(added.body)); project = added.body.project;
    assert.equal(project.document, undefined); assert.ok(Buffer.byteLength(JSON.stringify(added.body)) < 60 * 1024);
  }
  const manual = (await fixture.call('/projects/' + project.id)).body.project;
  assert.ok(Buffer.byteLength(JSON.stringify(manual)) > 65536);
  const original = project, selected = await composition(original);
  const layerNode = await nodeAt(original, ['kind', 'layers', 0], selected.node);
  // Resolve the actual engine's text fields instead of inventing a serializer path.
  async function findText(node) {
    const page = await inspect(original, node);
    if (page.type === 'string') {
      let value = page.text; while (!page.complete) { const next = await inspect(original, node, 'value', page.nextOffset); value += next.text; Object.assign(page, next); }
      return value === text ? node : null;
    }
    if (!page.children) return null;
    for (const child of await children(original, node)) { const found = await findText(child.node); if (found) return found; }
    return null;
  }
  const textNode = await findText(layerNode); assert.ok(textNode);
  const exportBefore = await tool('motion-export-document', { id: original.id });
  project = (await tool('motion-apply-edits', { id: project.id, comp, baseRevision: project.revision, requestKey: randomUUID(), response: 'receipt',
    commands: [{ command: 'layer.newSolid', params: { name: 'Agent addition', color: '#ff0000', width: 40, height: 30 } }] })).project;
  assert.equal(project.document, undefined); assert.equal(project.revision, original.revision + 1);
  assert.equal((await inspect(original, textNode)).project.revision, original.revision);
  const downloaded = await fixture.call(exportBefore.download.immutableUrl.slice('/api/motion-studio'.length));
  assert.equal(downloaded.status, 200); assert.deepEqual(JSON.parse(downloaded.body), manual.document);
  assert.equal(Buffer.byteLength(downloaded.body), exportBefore.download.byteLength);
  assert.equal(createHash('sha256').update(downloaded.body).digest('hex'), exportBefore.download.sha256);
  await tool('motion-inspect-project', { id: project.id, revision: original.revision, node: 'root', part: 'value', offset: 0 }, { actor: 'bob', status: 404 });
  await tool('motion-export-document', { id: project.id }, { actor: 'bob', status: 404 });
  fixture.deny('alice', 'project.read');
  try { await tool('motion-inspect-project', { id: project.id, revision: original.revision, node: 'root', part: 'value', offset: 0 }, { status: 403 }); }
  finally { fixture.allow('alice', 'project.read'); }
  fixture.deny('alice', 'project.export');
  try { assert.equal((await fixture.call(exportBefore.download.immutableUrl.slice('/api/motion-studio'.length))).status, 403); }
  finally { fixture.allow('alice', 'project.export'); }
  await tool('motion-delete-project', { id: project.id });
});
test('native metadata indexes expose entries past100 and pin complete immutable history without leaking owners', async () => {
  // Explicit small-source host seeding tests metadata cardinality/SQL paging;
  // it does not prove 1000 large revisions or application write quotas.
  const base = (await tool('motion-new-project', fresh('Index fixture'))).project;
  const sql = (text, values = []) => fixture.rpc('alice', 'sql', { text, values, connection: 'metadata-index-fixture' });
  const original = (await sql('SELECT owner_issuer,owner_sub FROM motion_projects WHERE project_id=$1', [base.id])).rows[0];
  const document = (await fixture.call('/projects/' + base.id)).body.project.document;
  const ids = [];
  try {
    for (let n = 0; n < 101; n++) {
      const id = randomUUID(); ids.push(id);
      await sql('INSERT INTO motion_projects (project_id,owner_issuer,owner_sub,title) VALUES ($1,$2,$3,$4)', [id, original.owner_issuer, original.owner_sub, 'Indexed ' + n]);
      await sql('INSERT INTO motion_revisions (project_id,owner_issuer,owner_sub,revision,title,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [id, original.owner_issuer, original.owner_sub, 1, 'Indexed ' + n, JSON.stringify(document)]);
    }
    let page = await tool('motion-list-projects', { stamp: 'start', offset: 0 });
    const stamp = page.stamp, seen = [...page.projects];
    while (!page.complete) { page = await tool('motion-list-projects', { stamp, offset: page.nextOffset }); seen.push(...page.projects); assert.ok(Buffer.byteLength(JSON.stringify(page)) < 60 * 1024); }
    assert.ok(ids.every(id => seen.some(project => project.id === id))); assert.equal(seen.length, page.total);
    assert.deepEqual((await tool('motion-list-projects', { stamp: 'start', offset: 0 }, { actor: 'bob' })).projects, []);
    await sql('UPDATE motion_projects SET title=$2 WHERE project_id=$1', [ids[0], 'Index changed']);
    await tool('motion-list-projects', { stamp, offset: 64 }, { status: 409 });
    for (let revision = 2; revision <= 101; revision++) await sql('INSERT INTO motion_revisions (project_id,owner_issuer,owner_sub,revision,title,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [base.id, original.owner_issuer, original.owner_sub, revision, 'Revision ' + revision, JSON.stringify(document)]);
    await sql('UPDATE motion_projects SET current_revision=$2 WHERE project_id=$1', [base.id, 101]);
    page = await tool('motion-revision-history', { id: base.id, revision: 101, offset: 0 });
    const history = [...page.revisions];
    while (!page.complete) { page = await tool('motion-revision-history', { id: base.id, revision: 101, offset: page.nextOffset }); history.push(...page.revisions); }
    assert.deepEqual(history.map(row => row.revision), Array.from({length:101},(_,n)=>n+1));
    await tool('motion-revision-history', { id: base.id, revision: 101, offset: 0 }, { actor: 'bob', status: 404 });
    await sql('INSERT INTO motion_revisions (project_id,owner_issuer,owner_sub,revision,title,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [base.id, original.owner_issuer, original.owner_sub, 102, 'Later', JSON.stringify(document)]);
    await sql('UPDATE motion_projects SET current_revision=$2 WHERE project_id=$1', [base.id, 102]);
    assert.equal((await tool('motion-revision-history', { id: base.id, revision: 101, offset: 64 })).total, 101);
  } finally { for (const id of ids) await tool('motion-delete-project', { id }); await tool('motion-delete-project', { id: base.id }); }
});
test('declared fork tool preserves a large native project with independent source grants and bounded receipt', async () => {
  let source = (await tool('motion-new-project', fresh('Large fork source'))).project;
  const comp = (await composition(source)).id;
  for (let batch = 0; batch < 2; batch++) {
    const reply = await fixture.call('/projects/' + source.id + '/operations', { method: 'POST', body: {
      baseRevision: source.revision, requestKey: randomUUID(), response: 'receipt', comp,
      commands: Array.from({length:4},(_,n)=>({command:'layer.newText',params:{name:'Source caption '+(batch*4+n),text:'Actual original caption '.repeat(400),size:36,position:[100,80]}})) } });
    assert.equal(reply.status,200);source=reply.body.project;
  }
  const original=(await fixture.call('/projects/'+source.id)).body.project.document;
  assert.ok(Buffer.byteLength(JSON.stringify(original))>65536);
  await assert.rejects(validate('motion-fork-project',{id:source.id,revision:source.revision,requestKey:randomUUID(),response:'receipt',owner:'bob'}));
  const input={id:source.id,revision:source.revision,title:'Agent editable fork',requestKey:randomUUID(),response:'receipt'};
  let copied;
  try {
    fixture.assign('alice','creator');copied=(await tool('motion-fork-project',input)).project;
    assert.notEqual(copied.id,source.id);assert.equal(copied.revision,1);assert.equal(copied.document,undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(copied))<60*1024);
    assert.deepEqual((await fixture.call('/projects/'+copied.id)).body.project.document,original);
    assert.equal((await tool('motion-fork-project',input)).project.id,copied.id);
    fixture.assign('alice','editor');await tool('motion-fork-project',{...input,requestKey:randomUUID()},{status:403});
    fixture.assign('alice','creator');fixture.deny('alice','project.read');
    await tool('motion-fork-project',{...input,requestKey:randomUUID()},{status:403});
  } finally {
    fixture.assign('alice','administrator');if(copied)await tool('motion-delete-project',{id:copied.id});await tool('motion-delete-project',{id:source.id});
  }
});
test('Test Lab catalog is loaded by the actual framework catalog reader and registers every shipped source suite', async () => {
  const framework = process.env.OSHAL_CORE_ROOT;
  assert.ok(framework, 'Explicit framework source required for catalog loader proof');
  const loader = createRequire(resolve(framework, 'package.json'))('./scripts/oshal-test-catalog.js');
  const result = loader.loadPackageTestCatalog(root, source);
  assert.equal(result.catalog.cases.length, 42);
  const registered = new Set(result.catalog.cases.flatMap(testCase => testCase.runner.files));
  for (const file of ['engine/src/lib.rs', 'tests/project-store.test.mjs', 'tests/engine-bridge.test.mjs',
    'tests/application.test.mjs', 'tests/workbench.test.mjs', 'tests/native-runner.test.mjs',
    'tests/native-sql.test.mjs', 'tests/bounded-json-wire.test.mjs', 'tests/package-contract.test.mjs', 'tests/project-inspection.test.mjs', 'tests/engine-container.test.mjs', 'tests/document-exchange.test.mjs','tests/lossless-json.test.mjs','tests/lossless-documents.test.mjs','tests/owned-blobs.test.mjs','tests/durable-assets.test.mjs','tests/durable-revisions.test.mjs','tests/crash-recovery.test.mjs','tests/portable-bundle.test.mjs','tests/portable-store.test.mjs','tests/render-export.test.mjs','tests/layer-workflows.test.mjs','tests/effects.test.mjs','tests/keyframe-workflows.test.mjs','tests/playback-workflows.test.mjs','tests/text-workflows.test.mjs','tests/point-text.test.mjs','tests/candidate-package.test.mjs','tests/mask-workflows.test.mjs','tests/animated-mask-workflows.test.mjs','tests/per-character-text.test.mjs','tests/variable-feather.test.mjs','tests/bundle-transfers.test.mjs','tests/bundle-http.test.mjs','tests/bundle-workbench.test.mjs','tests/sha256-stream.test.mjs','tests/bundle-streaming.test.mjs','tests/properties-workflows.test.mjs']) assert.ok(registered.has(file), file);
});
