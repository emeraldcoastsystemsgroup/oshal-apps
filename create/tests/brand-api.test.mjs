/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual brand kit HTTP boundary: verified identity, named brand permissions, personal scope and shared validation all refuse before any database work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { startApi, emptyPool, actors, imageBody } from './project-api.fixture.mjs';
import { defaultBrandKit } from '../tools/editor/brand-kit.mjs';

const kit = (overrides = {}) => ({ ...defaultBrandKit(), name: 'Synthetic brand', ...overrides });
const businessSql = pool => pool.queries.filter(row => !/^(BEGIN|COMMIT|ROLLBACK|SET|SELECT set_config)/.test(row.sql));

test('missing or inactive actors reach no brand function and no database', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  for (const actor of ['missing', 'inactive']) {
    for (const [path, method, body] of [['/brand-kit', 'GET'], ['/brand-kit', 'PUT', { baseRevision: 0, kit: kit() }], ['/brand-kit', 'DELETE', { baseRevision: 1 }], ['/brand-kit/logo', 'POST', await imageBody()]]) {
      const result = await api.call(path, method, body, actor, { 'x-oshal-caller-sub': 'alice' });
      assert.equal(result.status, 401, `${actor} ${method} ${path}`); assert.match(result.headers.get('cache-control'), /no-store/);
    }
  }
  assert.equal(pool.queries.length, 0); assert.deepEqual(await readdir(api.dataRoot), []);
});

test('reading needs brand.read; saving, removing and logo upload need brand.change, checked before work', async t => {
  const pool = emptyPool(), noRead = await startApi(t, pool, { denied: ['brand.read'] });
  assert.equal((await noRead.call('/brand-kit')).status, 403);
  const noChange = await startApi(t, pool, { denied: ['brand.change'] });
  for (const [path, method, body] of [['/brand-kit', 'PUT', { baseRevision: 0, kit: kit() }], ['/brand-kit', 'DELETE', { baseRevision: 1 }], ['/brand-kit/logo', 'POST', await imageBody()]]) {
    const result = await noChange.call(path, method, body);
    assert.equal(result.status, 403, `${method} ${path}`); assert.deepEqual(result.body, { error: 'brand_permission_denied' });
  }
  assert.equal(businessSql(pool).length, 0); assert.deepEqual(await readdir(noChange.dataRoot), []);
  const read = await noChange.call('/brand-kit');
  assert.equal(read.status, 200); assert.deepEqual(read.body, { kit: null, revision: 0, updatedAt: null, canChange: false, words: null });
});

test('opening Create is required too: project.view gates every brand function', async t => {
  const pool = emptyPool(), api = await startApi(t, pool, { denied: ['project.view'] });
  assert.equal((await api.call('/brand-kit')).status, 403);
  assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: kit() })).status, 403);
  assert.equal(pool.queries.length, 0);
});

test('a kit read names only the verified issuer and subject, including a same-subject other issuer', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  for (const actor of ['alice', 'collision', 'admin']) {
    const result = await api.call('/brand-kit', 'GET', undefined, actor);
    assert.equal(result.status, 200); assert.equal(result.body.canChange, true);
    const query = pool.queries.filter(row => /FROM create_brand_kits/.test(row.sql)).at(-1);
    assert.deepEqual(query.values, [actors[actor].issuer, actors[actor].sub]);
  }
});

test('tenant selectors, identity fields and envelope extras are refused without database work', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  assert.equal((await api.call('/brand-kit?tenantId=synthetic')).status, 400);
  assert.equal((await api.call('/brand-kit', 'GET', undefined, 'alice', { 'x-oshal-tenant-id': 'synthetic' })).status, 400);
  assert.equal((await api.call('/brand-kit?owner_sub=bob')).status, 400);
  for (const body of [{ baseRevision: 0, kit: kit(), owner_sub: 'bob' }, { kit: kit() }, { baseRevision: 0 }]) {
    assert.equal((await api.call('/brand-kit', 'PUT', body)).status, 400, JSON.stringify(Object.keys(body)));
  }
  assert.equal(businessSql(pool).length, 0);
});

test('the shared validator refuses bad kits and revisions before the store is touched', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  const bad = [kit({ fonts: { heading: 'Papyrus', body: 'Arial' } }), kit({ colors: { ...defaultBrandKit().colors, primary: 'red' } }),
    kit({ logo: { src: 'https://remote.fixture.test/logo.png', width: 10, height: 10 } }), { ...kit(), owner: 'bob' }, kit({ name: 'x'.repeat(81) })];
  for (const value of bad) {
    const result = await api.call('/brand-kit', 'PUT', { baseRevision: 0, kit: value });
    assert.equal(result.status, 400); assert.deepEqual(result.body, { error: 'invalid_brand_kit' });
  }
  for (const baseRevision of [-1, 1.5, '0', null, 100001]) {
    assert.equal((await api.call('/brand-kit', 'PUT', { baseRevision, kit: kit() })).body.error, 'invalid_brand_revision');
  }
  assert.equal((await api.call('/brand-kit', 'DELETE', { baseRevision: 0 })).body.error, 'invalid_brand_revision');
  assert.equal(businessSql(pool).length, 0);
});

test('a logo upload with brand.change does not need project create or change', async t => {
  const pool = emptyPool(), api = await startApi(t, pool, { denied: ['project.create', 'project.change'] });
  assert.equal((await api.call('/project-assets', 'POST', await imageBody())).status, 403);
  const result = await api.call('/brand-kit/logo', 'POST', await imageBody());
  // The strict non-writing double refuses the asset INSERT, so admission is proven by reaching the store, not by a row.
  assert.equal(result.status, 503); assert.ok(pool.queries.some(row => /pg_advisory_xact_lock/.test(row.sql) || /FROM create_project_assets/.test(row.sql)));
});
