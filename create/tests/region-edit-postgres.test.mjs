/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove region editing end to end against the real migrations in a disposable PostgreSQL, over real HTTP, with the explicitly named fixture provider: candidates change only the region, acceptance appends a child revision on the revision the person holds, late/stale/locked candidates are refused, cancel and provider failure keep the last accepted revision, two owners and a colliding issuer are walled apart by the forced policy, revocation discards a result, admission ceilings hold, cleanup keeps pending candidates, and manual editing never reaches the provider or the cost ledger.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise explicit cost caps against both generation methods, legacy omitted-cap compatibility, checked-instance execution, and a held-slot free-to-paid or unknown provider race through the actual compiled routes.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The operator-only antigravity-cli rail end to end (operator decision 2026-10-02): the operator's request becomes a ready candidate on that rail; another person's request fails region_edit_provider_unavailable without generation, spend or a second provider, both when the resolver refuses them and when the resolved provider is not available to them; a codex-cli provider is still refused before generation.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPostgres, resetPostgres } from './project-postgres.fixture.mjs';
import { startApi, input, actors, loadCompiled, logged } from './project-api.fixture.mjs';
import { fixtureProvider, noiseImage, rgba, waitForEdit, whenHeld, ANSWER, FIXTURE_PROVIDER_ID, FIXTURE_MODEL } from './region-edit.fixture.mjs';
import { selectionFromCanvas } from '../tools/editor/region-select.mjs';

const { regionMask, regionCropBox } = loadCompiled('create-region-edit-composite.js');
const { REGION_EDIT_COST_AGENT_ID } = loadCompiled('create-region-edit-routes.js');
let db, cleanup;
after(async () => { await cleanup?.(); });
before(async () => { db = await startPostgres(callback => { cleanup = callback; }); });
beforeEach(async () => { await resetPostgres(db.admin); });

async function start(t, options = {}) {
  const fixture = fixtureProvider(options.provider);
  const api = await startApi(t, db.pool, { regionEdits: { dependencies: fixture.dependencies, settings: { dailyCap: options.dailyCap ?? 20, concurrency: 1, timeoutMs: options.timeoutMs ?? 10000 } } });
  return { api, fixture };
}

/** A saved project: a noise photo, a manual title above it and a locked stamp, at revision 1. */
async function project(api, actor = 'alice') {
  const form = new FormData(); form.append('image', new Blob([await noiseImage()], { type: 'image/png' }), 'synthetic-noise.png');
  const uploaded = await api.call('/project-assets', 'POST', form, actor); assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const asset = uploaded.body.asset, layers = [{ id: 'photo', type: 'image', name: 'Photo', assetId: 'photo', x: 0, y: 0, w: 320, h: 200 },
    { id: 'title', type: 'text', name: 'Title', text: 'Manual title', x: 10, y: 10, w: 200, h: 40 },
    { id: 'stamp', type: 'rect', name: 'Stamp', x: 250, y: 150, w: 40, h: 30, fill: '#112233', locked: true }];
  const created = await api.call('/projects', 'POST', input('Synthetic region project', { photo: { src: asset.src, width: 160, height: 100 } }, layers), actor);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { asset, record: created.body.project };
}
const lasso = document => selectionFromCanvas(document, 'photo', [{ x: 100, y: 40 }, { x: 220, y: 60 }, { x: 200, y: 160 }, { x: 110, y: 150 }]);
const base = id => `/projects/${id}/region-edits`;
async function request(api, record, selection = lasso(record.document), actor = 'alice', maxCostClass) {
  return api.call(base(record.id), 'POST', { sourceRevision: record.revision, selection, instruction: 'Turn the middle into a green meadow',
    ...(maxCostClass === undefined ? {} : { maxCostClass }) }, actor);
}
async function save(api, record, change) {
  const document = structuredClone(record.document); change(document);
  const saved = await api.call(`/projects/${record.id}/revisions`, 'POST', { title: document.name, document, baseRevision: record.revision });
  assert.equal(saved.status, 201, JSON.stringify(saved.body)); return saved.body.project;
}
async function assetBytes(api, src) { const response = await fetch(api.origin + src, { headers: { 'x-fixture-actor': 'alice' } }); return Buffer.from(await response.arrayBuffer()); }
const count = async table => (await db.admin.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;

for (const [costClass, maxCostClass] of [['free', 'free'], ['free', 'paid'], ['paid', 'paid'], ['paid', undefined]]) {
  test(`provider ${costClass} runs once under ${maxCostClass ?? 'legacy omitted'} cap`, async t => {
    const { api, fixture } = await start(t, { provider: { costClass, costUsd: costClass === 'free' ? 0 : 0.04 } }), { record } = await project(api);
    const requested = await request(api, record, undefined, 'alice', maxCostClass);
    assert.equal(requested.status, 202, JSON.stringify(requested.body));
    const edit = await waitForEdit(api.call, `${base(record.id)}/${requested.body.edit.id}`);
    assert.equal(edit.status, 'ready'); assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.resolvedFor, ['alice'], 'invoke the one resolved provider without re-resolution');
    assert.equal(fixture.costs.length, costClass === 'free' ? 0 : 1);
  });
}

for (const method of ['generateWithMeta', 'generate']) {
  for (const [costClass, maxCostClass] of [['paid', 'free'], ['unknown', 'free'], ['unknown', 'paid']]) {
    test(`${method}: ${maxCostClass} cap refuses ${costClass} without generation or spend`, async t => {
      const { api, fixture } = await start(t, { provider: { costClass } }), { record } = await project(api);
      let generated = 0;
      fixture.provider[method] = async () => { generated++; throw new Error('A refused cap must never reach this fixture'); };
      if (method === 'generate') delete fixture.provider.generateWithMeta;
      const before = await count('create_project_assets'), requested = await request(api, record, undefined, 'alice', maxCostClass);
      assert.equal(requested.status, 202);
      const edit = await waitForEdit(api.call, `${base(record.id)}/${requested.body.edit.id}`);
      assert.deepEqual([edit.status, edit.error, edit.resultAsset], ['failed', 'region_edit_cost_cap_exceeded', null]);
      assert.equal(generated, 0); assert.deepEqual(fixture.calls, []); assert.deepEqual(fixture.costs, []);
      assert.equal(await count('create_project_assets'), before);
      assert.deepEqual((await api.call(`/projects/${record.id}`)).body.project.document, record.document);
    });
  }
}

for (const changedClass of ['paid', 'unknown']) {
  test(`a queued free cap refuses an actual ${changedClass} provider after a free preflight`, async t => {
    const { api, fixture } = await start(t, { provider: { costClass: 'free', costUsd: 0, mode: 'hold' } });
    t.after(() => fixture.release());
    const first = await project(api), second = await project(api, 'bob');
    const occupying = await request(api, first.record, undefined, 'alice', 'free'); assert.equal(occupying.status, 202);
    await whenHeld(fixture);
    const report = await api.call('/region-edit-provider', 'GET', undefined, 'bob');
    assert.deepEqual([report.body.costClass, report.body.costConsentVersion], ['free', 1]);
    const queued = await request(api, second.record, undefined, 'bob', 'free'); assert.equal(queued.status, 202);
    assert.deepEqual(fixture.resolvedFor, ['alice', 'bob'], 'the queued job has not resolved its execution provider yet');
    const refusedProvider = fixtureProvider({ costClass: changedClass });
    fixture.dependencies.resolveProvider = refusedProvider.dependencies.resolveProvider;
    fixture.setMode('answer'); fixture.release();
    const edit = await waitForEdit(api.call, `${base(second.record.id)}/${queued.body.edit.id}`, undefined, 'bob');
    assert.deepEqual([edit.status, edit.error, edit.resultAsset], ['failed', 'region_edit_cost_cap_exceeded', null]);
    assert.equal(fixture.calls.length, 1, 'only the already-running free request generated');
    assert.deepEqual(refusedProvider.resolvedFor, ['bob']); assert.deepEqual(refusedProvider.calls, []);
    assert.deepEqual(fixture.costs, []); assert.deepEqual(refusedProvider.costs, []);
    assert.equal((await api.call(`/projects/${second.record.id}`, 'GET', undefined, 'bob')).body.project.revision, 1);
  });
}

test('generation uses the checked provider instance and never resolves a second paid provider', async t => {
  const { api, fixture } = await start(t, { provider: { costClass: 'free', costUsd: 0 } }), { record } = await project(api);
  const paid = fixtureProvider(), resolveFree = fixture.dependencies.resolveProvider;
  let resolutions = 0;
  fixture.dependencies.resolveProvider = options => ++resolutions === 1 ? resolveFree(options) : paid.dependencies.resolveProvider(options);
  const requested = await request(api, record, undefined, 'alice', 'free'); assert.equal(requested.status, 202);
  const edit = await waitForEdit(api.call, `${base(record.id)}/${requested.body.edit.id}`);
  assert.equal(edit.status, 'ready'); assert.equal(resolutions, 1); assert.equal(fixture.calls.length, 1);
  assert.deepEqual(paid.calls, []); assert.deepEqual(fixture.costs, []);
});

test('the operator-only antigravity-cli rail serves the operator and refuses anyone else as not configured, with no fallback', async t => {
  const { api, fixture } = await start(t, { provider: { id: 'antigravity-cli', costClass: 'free', costUsd: null, operators: ['alice'] } });
  const operator = await project(api), accepted = await request(api, operator.record, undefined, 'alice', 'free');
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  const ready = await waitForEdit(api.call, `${base(operator.record.id)}/${accepted.body.edit.id}`);
  assert.equal(ready.status, 'ready'); assert.equal(ready.provider, 'antigravity-cli'); assert.equal(fixture.calls.length, 1);
  const guest = await project(api, 'bob'), refused = await request(api, guest.record, undefined, 'bob');
  assert.equal(refused.status, 202);
  const failed = await waitForEdit(api.call, `${base(guest.record.id)}/${refused.body.edit.id}`, undefined, 'bob');
  assert.deepEqual([failed.status, failed.error, failed.resultAsset], ['failed', 'region_edit_provider_unavailable', null]);
  assert.equal(fixture.calls.length, 1, 'nothing was generated for the refused person'); assert.deepEqual(fixture.costs, []);
  assert.deepEqual(fixture.resolvedFor, ['alice', 'bob'], 'the refused person resolved once and no other provider was tried');
  assert.equal((await api.call(`/projects/${guest.record.id}`, 'GET', undefined, 'bob')).body.project.revision, 1);
  for (const provider of [{ id: 'antigravity-cli', costClass: 'free', availableFor: ['alice'] }, { id: 'codex-cli', costClass: 'free' }]) {
    const value = await start(t, { provider }), { record } = await project(value.api, 'bob');
    const requested = await request(value.api, record, undefined, 'bob');
    const edit = await waitForEdit(value.api.call, `${base(record.id)}/${requested.body.edit.id}`, undefined, 'bob');
    assert.deepEqual([edit.status, edit.error], ['failed', 'region_edit_provider_unavailable'], provider.id);
    assert.deepEqual(value.fixture.calls, [], `${provider.id} never generates`);
  }
});

test('a candidate changes only the region and accepting it appends one child revision on the revision the person holds', async t => {
  const { api, fixture } = await start(t), { asset, record } = await project(api), selection = lasso(record.document);
  const requested = await request(api, record, selection); assert.equal(requested.status, 202, JSON.stringify(requested.body));
  assert.equal(requested.body.edit.status, 'generating'); assert.equal(requested.body.edit.sourceRevision, 1);
  const edit = await waitForEdit(api.call, `${base(record.id)}/${requested.body.edit.id}`);
  assert.equal(edit.status, 'ready'); assert.equal(edit.provider, FIXTURE_PROVIDER_ID); assert.equal(edit.model, FIXTURE_MODEL); assert.equal(edit.costUsd, 0.04);
  assert.deepEqual(fixture.calls.map(call => [call.width, call.height]), [[regionCropBox(selection).width, regionCropBox(selection).height]]);
  assert.match(fixture.calls[0].prompt, /green meadow/);
  const [before, after, mask] = [await rgba(await assetBytes(api, asset.src)), await rgba(await assetBytes(api, edit.resultAsset.src)), await regionMask(selection)];
  let outsideChanged = 0, fullWrong = 0, full = 0;
  for (let index = 0; index < mask.length; index++) {
    const a = before.data.subarray(index * 4, index * 4 + 4), b = after.data.subarray(index * 4, index * 4 + 4);
    if (!mask[index] && !a.equals(b)) outsideChanged++;
    if (mask[index] === 255) { full++; if (!Buffer.from(ANSWER).equals(b)) fullWrong++; }
  }
  assert.equal(outsideChanged, 0); assert.equal(fullWrong, 0); assert.ok(full > 1000);
  assert.deepEqual(fixture.costs, [{ taskId: `create-region-edit-${edit.id}`, agentId: REGION_EDIT_COST_AGENT_ID, ownerSub: 'alice',
    providerId: `image-provider:${FIXTURE_PROVIDER_ID}`, model: FIXTURE_MODEL, costUsd: 0.04, durationMs: fixture.costs[0]?.durationMs }]);
  assert.equal((await api.call(`/projects/${record.id}`)).body.project.revision, 1, 'a candidate is not a revision');
  const accepted = await api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: 1 });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body)); const next = accepted.body.project;
  assert.equal(next.revision, 2); const photo = next.document.layers.find(layer => layer.id === 'photo');
  assert.equal(next.document.images[photo.assetId].src, edit.resultAsset.src); assert.equal(Object.keys(next.document.images).length, 1);
  assert.deepEqual(next.document.layers.filter(layer => layer.id !== 'photo'), record.document.layers.filter(layer => layer.id !== 'photo'));
  assert.deepEqual((await api.call(`/projects/${record.id}/revisions/1`)).body.project.document, record.document);
  const row = (await db.admin.query('SELECT source_revision,accepted_revision,status FROM create_region_edits')).rows;
  assert.deepEqual(row, [{ source_revision: 1, accepted_revision: 2, status: 'accepted' }]);
  assert.equal((await api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: 2 })).status, 409);
});

test('two generate, manual edit, regenerate, manual edit cycles keep every manual change', async t => {
  const { api } = await start(t); let { record } = await project(api);
  for (const [cycle, title] of [[1, { x: 30, text: 'First manual title' }], [2, { y: 90, text: 'Second manual title' }]]) {
    const requested = await request(api, record); assert.equal(requested.status, 202, `cycle ${cycle}`);
    const edit = await waitForEdit(api.call, `${base(record.id)}/${requested.body.edit.id}`); assert.equal(edit.status, 'ready');
    const accepted = await api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: record.revision });
    assert.equal(accepted.status, 201); record = accepted.body.project;
    record = await save(api, record, document => Object.assign(document.layers.find(layer => layer.id === 'title'), title));
  }
  assert.equal(record.revision, 5);
  const titleLayer = record.document.layers.find(layer => layer.id === 'title');
  assert.deepEqual([titleLayer.x, titleLayer.y, titleLayer.text], [30, 90, 'Second manual title']);
  assert.deepEqual(record.document.layers.find(layer => layer.id === 'stamp'), (await api.call(`/projects/${record.id}/revisions/1`)).body.project.document.layers[2]);
  assert.deepEqual((await db.admin.query('SELECT source_revision,accepted_revision FROM create_region_edits ORDER BY source_revision')).rows,
    [{ source_revision: 1, accepted_revision: 2 }, { source_revision: 3, accepted_revision: 4 }]);
});

test('a late candidate never replaces a newer manual revision; a replaced or locked target is refused', async t => {
  const { api, fixture } = await start(t, { provider: { mode: 'hold' } }), { asset, record } = await project(api);
  const requested = await request(api, record); await whenHeld(fixture);
  const moved = await save(api, record, document => { document.layers[1].x = 77; });
  fixture.release(); const edit = await waitForEdit(api.call, `${base(record.id)}/${requested.body.edit.id}`); assert.equal(edit.status, 'ready');
  const stale = await api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: 1 });
  assert.equal(stale.status, 409); assert.deepEqual(stale.body, { error: 'project_revision_conflict' });
  assert.deepEqual((await api.call(`/projects/${record.id}`)).body.project.document, moved.document);
  const locked = await save(api, moved, document => { document.layers[0].locked = true; });
  assert.deepEqual((await api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: locked.revision })).body, { error: 'region_edit_layer_locked' });
  const unlocked = await save(api, locked, document => { document.layers[0].locked = false; });
  const rebased = await api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: unlocked.revision });
  assert.equal(rebased.status, 201); assert.equal(rebased.body.project.document.layers[1].x, 77, 'the manual move survives on the child revision');
  fixture.setMode('answer'); const second = await request(api, rebased.body.project);
  const ready = await waitForEdit(api.call, `${base(record.id)}/${second.body.edit.id}`);
  const replaced = await save(api, rebased.body.project, document => {
    const key = document.layers[0].assetId; document.images.other = { ...document.images[key], src: asset.src }; document.layers[0].assetId = 'other'; delete document.images[key];
  });
  assert.deepEqual((await api.call(`${base(record.id)}/${ready.id}/accept`, 'POST', { baseRevision: replaced.revision })).body, { error: 'region_edit_stale' });
  assert.equal((await api.call(`/projects/${record.id}`)).body.project.revision, replaced.revision);
});

test('cancel and provider failure or timeout keep the last accepted revision and add nothing to the project', async t => {
  const held = await start(t, { provider: { mode: 'hold' } }), first = await project(held.api);
  const requested = await request(held.api, first.record); await whenHeld(held.fixture);
  const cancelled = await held.api.call(`${base(first.record.id)}/${requested.body.edit.id}/cancel`, 'POST', {});
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.edit.status, 'cancelled');
  const assetsBefore = await count('create_project_assets'), discarded = logged.length; held.fixture.release();
  for (const deadline = Date.now() + 10000; !logged.slice(discarded).some(row => /cancelled; candidate discarded/.test(row.message));) {
    assert.ok(Date.now() < deadline, 'the cancelled request never finished'); await new Promise(resolve => setTimeout(resolve, 20));
  }
  const after = await waitForEdit(held.api.call, `${base(first.record.id)}/${requested.body.edit.id}`);
  assert.equal(after.status, 'cancelled'); assert.equal(after.resultAsset, null); assert.ok(await count('create_project_assets') <= assetsBefore + 1);
  assert.equal((await held.api.call(`/projects/${first.record.id}`)).body.project.revision, 1);
  for (const [mode, code, timeoutMs] of [['fail', 'region_edit_provider_failed', 10000], ['hold', 'region_edit_provider_timeout', 50]]) {
    const value = await start(t, { provider: { mode }, timeoutMs }), { record } = await project(value.api, 'bob');
    const failed = await request(value.api, record, undefined, 'bob');
    const edit = await waitForEdit(value.api.call, `${base(record.id)}/${failed.body.edit.id}`, undefined, 'bob');
    assert.deepEqual([edit.status, edit.error, edit.resultAsset], ['failed', code, null]); value.fixture.release();
    assert.equal((await value.api.call(`/projects/${record.id}`, 'GET', undefined, 'bob')).body.project.revision, 1);
    assert.equal((await value.api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: 1 }, 'bob')).status, 409);
  }
});

test('a second owner and a colliding issuer cannot see or act on another person\'s region edit, down to the forced policy', async t => {
  const { api } = await start(t), { record } = await project(api), edit = await waitForEdit(api.call, `${base(record.id)}/${(await request(api, record)).body.edit.id}`);
  for (const actor of ['bob', 'collision', 'admin']) {
    assert.equal((await api.call(`${base(record.id)}/${edit.id}`, 'GET', undefined, actor)).status, 404, actor);
    assert.equal((await api.call(`${base(record.id)}/${edit.id}/accept`, 'POST', { baseRevision: 1 }, actor)).status, 404, actor);
    assert.equal((await api.call(`${base(record.id)}/${edit.id}/reject`, 'POST', {}, actor)).status, 404, actor);
    assert.equal((await request(api, record, undefined, actor)).status, 404, actor);
  }
  const flags = await db.admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='create_region_edits'");
  assert.deepEqual(flags.rows, [{ relrowsecurity: true, relforcerowsecurity: true }]);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const [issuer, sub, expected] of [[actors.bob.issuer, 'bob', 0], [actors.collision.issuer, 'alice', 0], [actors.alice.issuer, 'alice', 1]]) {
      await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true)", [issuer, sub]);
      assert.equal((await client.query('SELECT edit_id FROM create_region_edits')).rows.length, expected, `${issuer} ${sub}`);
    }
    await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.equal((await api.call(`/projects/${record.id}`)).body.project.revision, 1);
});

test('revoking project.generate while a request runs discards its result, and a stale selection is refused before admission', async t => {
  const { api, fixture } = await start(t, { provider: { mode: 'hold' } }), { record } = await project(api);
  const requested = await request(api, record); await whenHeld(fixture);
  const assets = await count('create_project_assets'); api.state.denied.add('project.generate'); fixture.release();
  const edit = await waitForEdit(api.call, `${base(record.id)}/${requested.body.edit.id}`);
  assert.deepEqual([edit.status, edit.error, edit.resultAsset], ['failed', 'project_permission_denied', null]);
  assert.equal(await count('create_project_assets'), assets, 'no candidate raster was stored');
  api.state.denied.delete('project.generate'); fixture.setMode('answer');
  const locked = await save(api, record, document => { document.layers[0].locked = true; });
  const refused = await request(api, locked, lasso(record.document));
  assert.equal(refused.status, 409); assert.deepEqual(refused.body, { error: 'region_selection_stale' });
  assert.equal(await count('create_region_edits'), 1);
});

test('one request in flight per person and a rolling daily ceiling', async t => {
  const held = await start(t, { provider: { mode: 'hold' }, dailyCap: 2 }), { record } = await project(held.api);
  assert.equal((await request(held.api, record)).status, 202); await whenHeld(held.fixture);
  assert.deepEqual((await request(held.api, record)).body, { error: 'region_edit_in_progress' });
  held.fixture.setMode('answer'); held.fixture.release();
  await waitForEdit(held.api.call, `${base(record.id)}/${(await db.admin.query('SELECT edit_id FROM create_region_edits')).rows[0].edit_id}`);
  const second = await request(held.api, record); assert.equal(second.status, 202);
  await waitForEdit(held.api.call, `${base(record.id)}/${second.body.edit.id}`);
  const third = await request(held.api, record); assert.equal(third.status, 429); assert.deepEqual(third.body, { error: 'region_edit_daily_limit' });
});

test('cleanup keeps a candidate awaiting review and reclaims it once rejected', async t => {
  const { api } = await start(t), { record } = await project(api);
  const edit = await waitForEdit(api.call, `${base(record.id)}/${(await request(api, record)).body.edit.id}`);
  await db.admin.query("ALTER TABLE create_project_assets DISABLE TRIGGER create_project_asset_immutable");
  try { await db.admin.query("UPDATE create_project_assets SET created_at=NOW()-INTERVAL '2 days' WHERE asset_id=$1", [edit.resultAsset.id]); }
  finally { await db.admin.query("ALTER TABLE create_project_assets ENABLE TRIGGER create_project_asset_immutable"); }
  assert.deepEqual((await api.call('/project-assets/cleanup', 'POST', {})).body, { deleted: [] });
  const rejected = await api.call(`${base(record.id)}/${edit.id}/reject`, 'POST', {});
  assert.deepEqual([rejected.status, rejected.body.edit.status, rejected.body.edit.resultAsset], [200, 'rejected', null]);
  assert.deepEqual((await api.call('/project-assets/cleanup', 'POST', {})).body, { deleted: [edit.resultAsset.id] });
  assert.equal((await api.call(`/projects/${record.id}`)).body.project.revision, 1);
});

test('manual editing never resolves a provider or records a generation cost', async t => {
  const { api, fixture } = await start(t); let { record } = await project(api);
  record = await save(api, record, document => { document.layers[1].text = 'Only a manual change'; });
  assert.equal((await api.call(`/projects/${record.id}/export`)).status, 200);
  assert.equal((await api.call(`/projects/${record.id}`, 'DELETE', { baseRevision: record.revision })).status, 204);
  assert.deepEqual(fixture.calls, []); assert.deepEqual(fixture.resolvedFor, []); assert.deepEqual(fixture.costs, []);
  assert.equal(await count('create_region_edits'), 0);
});
