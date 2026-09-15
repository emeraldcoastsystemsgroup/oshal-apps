/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove migration, real PostgreSQL constraints/concurrency and HTTP owner boundaries in a disposable database with synthetic data only.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startPostgres, resetPostgres } from './project-postgres.fixture.mjs';
import { startApi, input, actors, imageBody } from './project-api.fixture.mjs';

let db, cleanup;
after(async () => { await cleanup?.(); });
before(async () => { db = await startPostgres(callback => { cleanup = callback; }); });
beforeEach(async () => { await resetPostgres(db.admin); });

function ownerDirectory(api, actor = 'alice') {
  const value = actors[actor]; return join(api.dataRoot, createHash('sha256').update(JSON.stringify([value.issuer, value.sub])).digest('hex'));
}
async function uploaded(api) {
  const result = await api.call('/project-assets', 'POST', await imageBody()); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.asset;
}
function withImage(asset, name = 'Synthetic image') {
  return input(name, { photo: { src: asset.src, width: asset.width, height: asset.height } }, [{ id: 'photo-layer', type: 'image', assetId: 'photo', x: 0, y: 0, w: 100, h: 100 }]);
}

test('real migrations are idempotent and exact-owner RLS denies missing or mismatched context', async t => {
  const api = await startApi(t, db.pool), created = await api.call('/projects', 'POST', input());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await db.pool.query('SELECT project_id FROM create_projects')).rows.length, 0);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN'); await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true),set_config('oshal.is_operator','on',true)", [actors.collision.issuer, 'alice']);
    assert.equal((await client.query('SELECT project_id FROM create_projects')).rows.length, 0);
    await client.query("SELECT set_config('create.owner_issuer',$1,true)", [actors.alice.issuer]);
    assert.equal((await client.query('SELECT project_id FROM create_projects')).rows.length, 1);
    await client.query('ROLLBACK');
  } finally { client.release(); }
  const flags = await db.admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname LIKE 'create_project%' AND relkind='r'");
  assert.equal(flags.rows.length, 4); assert.ok(flags.rows.every(row => row.relrowsecurity && !row.relforcerowsecurity));
});

test('durable project CRUD isolates users, colliding subjects and administrators', async t => {
  const api = await startApi(t, db.pool), result = await api.call('/projects', 'POST', input()), project = result.body.project;
  assert.equal(result.status, 201); assert.equal(project.revision, 1);
  assert.deepEqual((await api.call(`/projects/${project.id}`)).body.project.document, project.document);
  for (const actor of ['bob', 'collision', 'admin']) {
    assert.deepEqual((await api.call('/projects', 'GET', undefined, actor)).body, { projects: [] });
    assert.equal((await api.call(`/projects/${project.id}`, 'GET', undefined, actor)).status, 404);
    assert.equal((await api.call(`/projects/${project.id}/revisions`, 'POST', { ...input(), baseRevision: 1 }, actor)).status, 404);
    assert.equal((await api.call(`/projects/${project.id}`, 'DELETE', { baseRevision: 1 }, actor)).status, 404);
  }
  const recreated = await startApi(t, db.pool);
  assert.equal((await recreated.call(`/projects/${project.id}`)).body.project.title, project.title);
});

test('shared model-valid whitespace, data-prefixed text and large bounded strokes persist unchanged', async t => {
  const api = await startApi(t, db.pool), name = '  Synthetic drawing  ';
  const body = input(name, {}, [{ id: 'caption', type: 'text', text: 'data: science' },
    { id: 'stroke', type: 'freehand', points: Array.from({ length: 5000 }, () => ({ x: 0.5, y: 0.25 })) }]);
  const result = await api.call('/projects', 'POST', body);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const stored = (await api.call(`/projects/${result.body.project.id}`)).body.project;
  assert.equal(stored.title, name); assert.equal(stored.document.name, name);
  assert.equal(stored.document.layers[0].text, 'data: science');
  assert.equal(stored.document.layers[1].points.length, 5000);
});

test('simultaneous saves admit exactly one immutable new revision and reject stale deletion', async t => {
  const api = await startApi(t, db.pool), first = (await api.call('/projects', 'POST', input('First'))).body.project;
  const replies = await Promise.all(['Second A', 'Second B'].map(name => api.call(`/projects/${first.id}/revisions`, 'POST', { ...input(name), baseRevision: 1 })));
  assert.deepEqual(replies.map(row => row.status).sort(), [201, 409]);
  assert.equal((await api.call(`/projects/${first.id}/revisions`)).body.revisions.length, 2);
  assert.equal((await api.call(`/projects/${first.id}/revisions/1`)).body.project.document.name, 'First');
  await assert.rejects(db.admin.query('UPDATE create_project_revisions SET title=$2 WHERE project_id=$1', [first.id, 'tampered']), /immutable/);
  assert.equal((await api.call(`/projects/${first.id}`, 'DELETE', { baseRevision: 1 })).status, 409);
  assert.equal((await api.call(`/projects/${first.id}`, 'DELETE', { baseRevision: 2 })).status, 204);
  assert.equal((await db.admin.query('SELECT * FROM create_project_revisions')).rows.length, 0);
});

test('permission revocation during a write rolls back project and snapshot atomically', async t => {
  let api;
  const hooked = { connect: async () => {
    const client = await db.pool.connect(); return { release: value => client.release(value), query: async (...args) => {
      const result = await client.query(...args);
      if (/INSERT INTO create_project_revisions/.test(args[0])) api.state.denied.add('project.create');
      return result;
    } };
  } };
  api = await startApi(t, hooked);
  assert.equal((await api.call('/projects', 'POST', input())).status, 403);
  assert.equal((await db.admin.query('SELECT * FROM create_projects')).rows.length, 0);
  assert.equal((await db.admin.query('SELECT * FROM create_project_revisions')).rows.length, 0);
});

test('uploaded raster bytes are immutable, metadata-qualified and unavailable to other owners', async t => {
  const api = await startApi(t, db.pool), asset = await uploaded(api);
  assert.equal(asset.width, 8); assert.equal(asset.height, 6);
  const response = await fetch(api.origin + asset.src);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  for (const actor of ['bob', 'collision', 'admin']) assert.equal((await api.call(asset.src.replace('/api/create', ''), 'GET', undefined, actor)).status, 404);
  await assert.rejects(db.admin.query('UPDATE create_project_assets SET sha256=$2 WHERE asset_id=$1', [asset.id, '0'.repeat(64)]), /immutable/);
  await writeFile(join(ownerDirectory(api), `${asset.id}.png`), Buffer.alloc(bytes.length));
  assert.equal((await api.call(asset.src.replace('/api/create', ''))).status, 503);
});

test('saved image references must match owned asset dimensions and export rechecks its named permission', async t => {
  const api = await startApi(t, db.pool), asset = await uploaded(api), body = withImage(asset);
  assert.equal((await api.call('/projects', 'POST', body, 'bob')).status, 400);
  const wrong = structuredClone(body); wrong.document.images.photo.width++;
  assert.equal((await api.call('/projects', 'POST', wrong)).status, 400);
  const project = (await api.call('/projects', 'POST', body)).body.project;
  assert.deepEqual((await api.call(`/projects/${project.id}/export`)).body.document, project.document);
  api.state.denied.add('project.export');
  assert.equal((await api.call(`/projects/${project.id}/export`)).status, 403);
  assert.equal((await api.call(`/projects/${project.id}`)).status, 200);
});

test('Home summary contains only bounded own project metadata and canonical editor handoffs', async t => {
  const api = await startApi(t, db.pool);
  for (let index = 0; index < 7; index++) assert.equal((await api.call('/projects', 'POST', input(`Synthetic ${index}`))).status, 201);
  const result = (await api.call('/home-summary')).body;
  assert.equal(result.items.length, 6); assert.deepEqual(result.metrics, [{ label: 'Image projects', value: '7' }]);
  assert.ok(result.items.every(item => item.actions[0].tool === 'create-editor' && /^project=[a-f0-9-]{36}$/.test(item.actions[0].query)));
  assert.deepEqual((await api.call('/home-summary', 'GET', undefined, 'bob')).body, { items: [], metrics: [{ label: 'Image projects', value: '0' }] });
});

async function oldAsset(api, source) {
  const id = randomUUID(), bytes = await readFile(join(ownerDirectory(api), `${source.id}.png`));
  await writeFile(join(ownerDirectory(api), `${id}.png`), bytes);
  await db.admin.query(`INSERT INTO create_project_assets(asset_id,owner_issuer,owner_sub,width,height,byte_length,sha256,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,NOW()-INTERVAL '2 days')`, [id, actors.alice.issuer, 'alice', source.width, source.height, source.bytes, source.sha256]);
  return { ...source, id, src: `/api/create/project-assets/${id}` };
}

test('cleanup retains assets referenced only by old revisions until the project is deleted', async t => {
  const api = await startApi(t, db.pool), uploadedAsset = await uploaded(api), retained = await oldAsset(api, uploadedAsset), unused = await oldAsset(api, uploadedAsset);
  const project = (await api.call('/projects', 'POST', withImage(retained))).body.project;
  assert.equal((await api.call(`/projects/${project.id}/revisions`, 'POST', { ...input('Now blank'), baseRevision: 1 })).status, 201);
  assert.deepEqual((await api.call('/project-assets/cleanup', 'POST', {})).body, { deleted: [unused.id] });
  assert.equal((await api.call(retained.src.replace('/api/create', ''))).status, 200);
  assert.equal((await api.call(`/projects/${project.id}`, 'DELETE', { baseRevision: 2 })).status, 204);
  assert.deepEqual((await api.call('/project-assets/cleanup', 'POST', {})).body, { deleted: [retained.id] });
  assert.equal((await api.call(retained.src.replace('/api/create', ''))).status, 404);
});

test('asset quota rejection removes only the newly uploaded bytes and admits no new row', async t => {
  const api = await startApi(t, db.pool), source = await uploaded(api);
  await db.admin.query(`INSERT INTO create_project_assets(asset_id,owner_issuer,owner_sub,width,height,byte_length,sha256)
    SELECT gen_random_uuid(),$1,$2,8,6,10,$3 FROM generate_series(1,127)`, [actors.alice.issuer, 'alice', source.sha256]);
  const before = await readdir(ownerDirectory(api));
  assert.equal((await api.call('/project-assets', 'POST', await imageBody())).status, 409);
  assert.deepEqual(await readdir(ownerDirectory(api)), before);
  assert.equal((await db.admin.query('SELECT COUNT(*)::int AS count FROM create_project_assets')).rows[0].count, 128);
});
