/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual HTTP identity, validation and permission boundaries with a strict non-writing database double.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { startApi, emptyPool, input, actors, imageBody } from './project-api.fixture.mjs';

const ID = '00000000-0000-4000-8000-000000000001';

test('missing and inactive verified actors cannot use request identity claims or touch persistence', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  for (const actor of ['missing', 'inactive']) {
    const result = await api.call('/projects', 'GET', undefined, actor, { 'x-oshal-caller-sub': 'alice', 'x-owner-issuer': actors.alice.issuer });
    assert.equal(result.status, 401); assert.match(result.headers.get('cache-control'), /no-store/);
  }
  assert.equal(pool.queries.length, 0);
});

test('every named write and export permission is enforced before work', async t => {
  const pool = emptyPool(), api = await startApi(t, pool, { denied: ['project.create', 'project.change', 'project.delete', 'project.export'] });
  for (const [path, method, body] of [['/projects', 'POST', input()], [`/projects/${ID}/revisions`, 'POST', { ...input(), baseRevision: 1 }],
    [`/projects/${ID}`, 'DELETE', { baseRevision: 1 }], [`/projects/${ID}/export`, 'GET', undefined], ['/project-assets', 'POST', await imageBody()]]) {
    assert.equal((await api.call(path, method, body)).status, 403);
  }
  assert.equal(pool.queries.length, 0); assert.deepEqual(await readdir(api.dataRoot), []);
  assert.deepEqual((await api.call('/permissions')).body.permissions, { view: true, read: true, create: false, change: false, delete: false, export: false });
});

test('collections and Home summary query only the verified issuer and subject', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  for (const actor of ['alice', 'collision', 'admin']) {
    assert.deepEqual((await api.call('/projects', 'GET', undefined, actor)).body, { projects: [] });
    const query = pool.queries.filter(row => /FROM create_projects/.test(row.sql)).at(-1);
    assert.deepEqual(query.values, [actors[actor].issuer, actors[actor].sub]);
  }
  assert.deepEqual((await api.call('/home-summary')).body, { items: [], metrics: [{ label: 'Image projects', value: '0' }] });
  assert.ok(pool.releases.every(value => value === false));
});

test('foreign and absent project or asset identifiers return the same missing response', async t => {
  const api = await startApi(t, emptyPool());
  for (const path of [`/projects/${ID}`, `/projects/${ID}/revisions`, `/project-assets/${ID}`]) assert.equal((await api.call(path)).status, 404);
});

test('tenant selectors and body identity fields are refused without database work', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  assert.equal((await api.call('/projects?tenantId=synthetic')).status, 400);
  assert.equal((await api.call('/projects', 'GET', undefined, 'alice', { 'x-oshal-tenant-id': 'synthetic' })).status, 400);
  assert.equal((await api.call('/projects', 'POST', { ...input(), owner_sub: 'bob' })).status, 400);
  assert.equal(pool.queries.length, 0);
});

test('shared document schema rejects remote, inline and mismatched assets before persistence', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  for (const src of ['https://remote.fixture.test/image.png', 'data:image/png;base64,AAAA', '/api/create/project-assets/not-a-uuid']) {
    const body = input('Synthetic image', { image: { src, width: 8, height: 6 } });
    assert.equal((await api.call('/projects', 'POST', body)).status, 400);
  }
  assert.equal((await api.call('/projects', 'POST', { ...input(), title: 'Different name' })).status, 400);
  assert.equal(pool.queries.length, 0);
});

test('malformed JSON, stale revision syntax and oversized documents fail with bounded errors', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  assert.equal((await api.call(`/projects/${ID}/revisions`, 'POST', { ...input(), baseRevision: '1' })).status, 400);
  const oversized = input(); oversized.document.name = 'x'.repeat(270000);
  assert.equal((await api.call('/projects', 'POST', oversized)).status, 413);
  const response = await fetch(api.origin + '/api/create/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400); assert.equal(pool.queries.length, 0);
});

test('non-raster uploads fail before database or filesystem work', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  const form = new FormData(); form.append('image', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'fake.png');
  assert.equal((await api.call('/project-assets', 'POST', form)).status, 400);
  assert.equal(pool.queries.length, 0); assert.deepEqual(await readdir(api.dataRoot), []);
});

test('missing database configuration fails before attempting persistence', async t => {
  const api = await startApi(t, undefined);
  assert.deepEqual((await api.call('/projects')).body, { error: 'project_store_unavailable' });
  assert.equal((await api.call('/projects')).status, 503);
});

test('a failed rollback discards the connection and returns a bounded unavailable response', async t => {
  const released = [], pool = { connect: async () => ({
    query: async sql => { if (sql === 'ROLLBACK' || /FROM create_projects/.test(sql)) throw new Error('synthetic connection failure'); return { rows: [] }; },
    release: discard => released.push(discard),
  }) };
  const api = await startApi(t, pool), result = await api.call('/projects');
  assert.equal(result.status, 503); assert.deepEqual(result.body, { error: 'project_service_unavailable' });
  assert.deepEqual(released, [true]); assert.match(result.headers.get('cache-control'), /no-store/);
});
