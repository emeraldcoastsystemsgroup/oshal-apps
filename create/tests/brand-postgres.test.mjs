/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the brand kit migration, exact-owner RLS, optimistic revisions, owned-logo checks and logo-preserving cleanup against a disposable real PostgreSQL through the actual HTTP router.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startPostgres, resetPostgres } from './project-postgres.fixture.mjs';
import { startApi, actors, imageBody } from './project-api.fixture.mjs';
import { defaultBrandKit } from '../tools/editor/brand-kit.mjs';

let db, cleanup;
after(async () => { await cleanup?.(); });
before(async () => { db = await startPostgres(callback => { cleanup = callback; }); });
beforeEach(async () => { await resetPostgres(db.admin); });

const kit = (overrides = {}) => ({ ...defaultBrandKit(), name: 'Synthetic brand', ...overrides });
const withLogo = asset => kit({ logo: { src: asset.src, width: asset.width, height: asset.height } });

async function logo(api, actor = 'alice') {
  const result = await api.call('/brand-kit/logo', 'POST', await imageBody(), actor);
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.asset;
}

async function backdatedCopy(api, source) {
  const owner = join(api.dataRoot, createHash('sha256').update(JSON.stringify([actors.alice.issuer, actors.alice.sub])).digest('hex'));
  const id = randomUUID(); await writeFile(join(owner, `${id}.png`), await readFile(join(owner, `${source.id}.png`)));
  await db.admin.query(`INSERT INTO create_project_assets(asset_id,owner_issuer,owner_sub,width,height,byte_length,sha256,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,NOW()-INTERVAL '2 days')`, [id, actors.alice.issuer, 'alice', source.width, source.height, source.bytes, source.sha256]);
  return { ...source, id, src: `/api/create/project-assets/${id}` };
}

test('a first save, a read and later saves keep one row per owner with optimistic revisions', async t => {
  const api = await startApi(t, db.pool);
  const first = await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: kit() });
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.revision, 1);
  assert.equal(first.body.words.phrase, 'bright violet, bright cyan and coral');
  const read = await api.call('/brand-kit');
  assert.deepEqual(read.body.kit, first.body.kit); assert.equal(read.body.revision, 1); assert.equal(read.body.canChange, true);
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: kit({ name: 'Stale tab' }) })).body.error, 'brand_revision_conflict');
  const second = await api.call('/brand-kit', 'PUT', { baseRevision: 1, kit: kit({ name: 'Renamed' }) });
  assert.equal(second.body.revision, 2); assert.equal(second.body.kit.name, 'Renamed');
  assert.equal((await db.admin.query('SELECT COUNT(*)::int AS count FROM create_brand_kits')).rows[0].count, 1);
});

test('owners never see or change each other, including a same-subject different issuer', async t => {
  const api = await startApi(t, db.pool);
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: kit({ name: 'Alice brand' }) })).status, 200);
  for (const actor of ['bob', 'collision', 'admin']) {
    assert.deepEqual((await api.call('/brand-kit', 'GET', undefined, actor)).body.kit, null, actor);
    assert.equal((await api.call('/brand-kit', 'DELETE', { baseRevision: 1 }, actor)).body.error, 'brand_kit_not_found', actor);
  }
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: kit({ name: 'Bob brand' }) }, 'bob')).status, 200);
  assert.equal((await api.call('/brand-kit')).body.kit.name, 'Alice brand');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    assert.equal((await client.query('SELECT kit FROM create_brand_kits')).rows.length, 0, 'unset identity sees no row');
    await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true)", [actors.collision.issuer, 'alice']);
    assert.equal((await client.query('SELECT kit FROM create_brand_kits')).rows.length, 0, 'same subject, other issuer sees no row');
    await client.query("SELECT set_config('create.owner_issuer',$1,true)", [actors.alice.issuer]);
    assert.deepEqual((await client.query('SELECT kit FROM create_brand_kits')).rows.map(row => row.kit.name), ['Alice brand']);
    await client.query('ROLLBACK');
  } finally { client.release(); }
});

test('a logo must be an image the same owner uploaded, at its real size', async t => {
  const api = await startApi(t, db.pool), asset = await logo(api);
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: withLogo(asset) }, 'bob')).body.error, 'brand_logo_unavailable');
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: withLogo({ ...asset, width: asset.width + 1 }) })).body.error, 'brand_logo_unavailable');
  const saved = await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: withLogo(asset) });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.kit.logo, { src: asset.src, width: asset.width, height: asset.height });
  assert.equal((await api.call(asset.src.replace('/api/create', ''))).status, 200);
  await assert.rejects(db.admin.query('INSERT INTO create_brand_kits (owner_issuer,owner_sub,kit,logo_asset_id) VALUES ($1,$2,$3,$4)',
    [actors.bob.issuer, 'bob', JSON.stringify(kit()), asset.id]), /foreign key/);
});

test('unused-upload cleanup keeps the logo a kit uses and releases it once the kit lets go', async t => {
  const api = await startApi(t, db.pool), fresh = await logo(api), kept = await backdatedCopy(api, fresh), unused = await backdatedCopy(api, fresh);
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: withLogo(kept) })).status, 200);
  assert.deepEqual((await api.call('/project-assets/cleanup', 'POST', {})).body, { deleted: [unused.id] });
  assert.equal((await api.call(kept.src.replace('/api/create', ''))).status, 200);
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 1, kit: kit() })).status, 200);
  assert.deepEqual((await api.call('/project-assets/cleanup', 'POST', {})).body, { deleted: [kept.id] });
  assert.equal((await api.call(kept.src.replace('/api/create', ''))).status, 404);
});

test('removing a kit needs its current revision and leaves nothing behind', async t => {
  const api = await startApi(t, db.pool);
  assert.equal((await api.call('/brand-kit', 'DELETE', { baseRevision: 1 })).body.error, 'brand_kit_not_found');
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: kit() })).status, 200);
  assert.equal((await api.call('/brand-kit', 'DELETE', { baseRevision: 2 })).body.error, 'brand_revision_conflict');
  assert.equal((await api.call('/brand-kit', 'DELETE', { baseRevision: 1 })).status, 204);
  assert.deepEqual((await api.call('/brand-kit')).body, { kit: null, revision: 0, updatedAt: null, canChange: true, words: null });
  assert.equal((await db.admin.query('SELECT COUNT(*)::int AS count FROM create_brand_kits')).rows[0].count, 0);
});

test('the database itself bounds a kit and refuses a revision below one', async () => {
  await assert.rejects(db.admin.query('INSERT INTO create_brand_kits (owner_issuer,owner_sub,kit,revision) VALUES ($1,$2,$3,0)',
    [actors.alice.issuer, 'alice', JSON.stringify(kit())]), /check constraint/);
  await assert.rejects(db.admin.query('INSERT INTO create_brand_kits (owner_issuer,owner_sub,kit) VALUES ($1,$2,$3)',
    [actors.alice.issuer, 'alice', JSON.stringify({ padding: 'x'.repeat(17000) })]), /check constraint/);
});
