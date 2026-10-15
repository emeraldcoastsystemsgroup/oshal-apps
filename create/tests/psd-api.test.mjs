/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise genuine PSD pixels, immutable originals, editing/reopen and atomic failures on an owned shared35689 database; never provision a container.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { startApi, requireCore, packageRoot, loadCompiled } from './project-api.fixture.mjs';
import { makePsd, groupedPsd } from './fixtures/psd-fixtures.mjs';
const { Pool } = requireCore('pg'), sharp = requireCore('sharp'), { ProjectError } = loadCompiled('create-project-types.js');
const {psdSelection}=loadCompiled('create-psd.js');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function form(bytes, fields = {}) { const body = new FormData(); body.append('psd', new Blob([bytes], { type: 'image/vnd.adobe.photoshop' }), 'original.psd'); for (const [key, value] of Object.entries(fields)) body.append(key, value); return body; }
const selected = (bytes, title = 'Imported PSD', mode = 'editable') => ({ title, mode, expectedSha256: digest(bytes), requestKey: randomUUID() });
test('closed selection refuses coerced mode arrays/objects and noncanonical retry keys',()=>{
  const value=selected(makePsd({layers:[{}]}));
  for(const mode of [['editable'],{toString:()=> 'editable'},true,null])assert.throws(()=>psdSelection({...value,mode}),/invalid_psd_selection/);
  assert.throws(()=>psdSelection({...value,requestKey:value.requestKey.toUpperCase()}),/invalid_psd_selection/);
});

test('real PSD original/image/project transactions, owner boundaries and independent export grants', async t => {
  const raw = process.env.OSHAL_SHARED_TEST_POSTGRES_URL ?? (await readFile('/tmp/oshal-motion-disposable-pg-url', 'utf8')).trim(), url = new URL(raw);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '35689');
  const token = randomUUID().replaceAll('-', ''), database = 'create_psd_' + token, role = 'create_psd_app_' + token;
  const admin = new Pool({ connectionString: raw, max: 2 }); let pool, api;
  const cleanups = []; let fault = '', revoke = false, hold = null;
  t.after(async () => {
    try { for (const cleanup of cleanups.reverse()) await cleanup(); await pool?.end(); }
    finally { await admin.query(`DROP DATABASE IF EXISTS "${database}"`); await admin.query(`DROP ROLE IF EXISTS "${role}"`); await admin.end(); }
  });
  const password = randomUUID(); await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`CREATE DATABASE "${database}" OWNER "${role}"`);
  const connection = new URL(raw); connection.pathname = '/' + database; connection.username = role; connection.password = password;
  pool = new Pool({ connectionString: connection.href, max: 3 });
  for (const file of ['001-create-projects.sql', '002-create-brand-kits.sql', '003-force-row-level-security.sql', '004-owner-policy-standard-identity-arm.sql', '005-create-region-edits.sql', '006-create-psd.sql']) {
    const sql = await readFile(resolve(packageRoot, 'migrations', file), 'utf8'); await pool.query(sql); await pool.query(sql);
  }
  const guarded = new Proxy(pool, { get(target, property) {
    if (property !== 'connect') { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
    return async () => { const client = await target.connect(); return new Proxy(client, { get(value, key) {
      if (key === 'query') return async (sql, values) => {
        if (fault && /^INSERT INTO create_psd_source_parts/.test(sql)) throw new ProjectError(503, 'named_psd_original_parts_rollback_fixture');
        const result = await value.query(sql, values);
        if (hold && /^INSERT INTO create_psd_source_parts/.test(sql)) { const gate=hold;hold=null;gate.entered.resolve();await gate.released.promise; }
        if (revoke && /^INSERT INTO create_psd_source_parts/.test(sql)) { revoke = false; api.state.denied.add('project.create'); }
        return result;
      };
      const member = Reflect.get(value, key); return typeof member === 'function' ? member.bind(value) : member;
    } }); };
  } });
  api = await startApi({ after: cleanup => cleanups.push(cleanup) }, guarded);
  const ownerSql = async (sql, values = [], actor = 'alice') => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true)", ['https://create-identity.fixture.test', actor]); const result = await client.query(sql, values); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  };
  const counts = async actor => (await ownerSql('SELECT (SELECT COUNT(*) FROM create_projects)::int AS projects,(SELECT COUNT(*) FROM create_project_assets)::int AS assets,(SELECT COUNT(*) FROM create_psd_sources)::int AS sources,(SELECT COUNT(*) FROM create_psd_source_parts)::int AS parts', [], actor)).rows[0];
  const bytes = groupedPsd(), choice = selected(bytes), before = await counts('alice'); let imported;
  await t.test('inspection is inert and immutable group import creates editable references with genuine decoded pixels', async () => {
    const inspected = await api.call('/psd-inspect', 'POST', form(bytes)); assert.equal(inspected.status, 200); assert.equal(inspected.body.editable, true); assert.equal(inspected.body.sha256, digest(bytes));
    assert.deepEqual(await counts('alice'), before);
    const result = await api.call('/psd-imports', 'POST', form(bytes, choice)); assert.equal(result.status, 201, JSON.stringify(result.body)); imported = result.body.project;
    assert.equal(result.body.source.sha256, digest(bytes)); assert.equal(result.body.source.importedRevision, 1); assert.equal(result.body.replayed, false);
    assert.equal(imported.document.layers.at(-1).type, 'group'); assert.equal(imported.document.layers.at(-1).name, 'Grüppe 🎨');
    const red = imported.document.layers.find(layer => layer.name === 'Red'), image = imported.document.images[red.assetId];
    const response = await fetch(api.origin + image.src); assert.equal(response.status, 200);
    const decoded = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer(); assert.deepEqual([...decoded], Array(4).fill([255, 0, 0, 255]).flat());
    assert.equal((await api.call(`/projects/${imported.id}`)).body.project.revision, 1);
  });
  await t.test('edit/save/reopen preserves original source bytes and refuses a stale revision', async () => {
    const edit = await api.call(`/projects/${imported.id}/operations`, 'POST', { baseRevision: 1, operations: [{ type: 'update', id: 'psd-1', patch: { x: 1, opacity: .25 } }] });
    assert.equal(edit.status, 201, JSON.stringify(edit.body)); assert.equal(edit.body.project.revision, 2);
    const reopened = await api.call(`/projects/${imported.id}`); assert.equal(reopened.body.project.document.layers.find(l => l.id === 'psd-1').opacity, .25);
    assert.equal((await api.call(`/projects/${imported.id}/operations`, 'POST', { baseRevision: 1, operations: [{ type: 'update', id: 'psd-1', patch: { opacity: .8 } }] })).status, 409);
    const response = await fetch(api.origin + `/api/create/projects/${imported.id}/psd-original`); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const old = await api.call(`/projects/${imported.id}/revisions/1`); assert.equal(old.body.project.document.layers.find(l => l.id === 'psd-1').opacity, 1);
    const metadata = await api.call(`/projects/${imported.id}/psd-source`); assert.equal(metadata.body.source.sha256, digest(bytes)); assert.equal(metadata.body.source.importedRevision, 1);
    await assert.rejects(ownerSql('UPDATE create_psd_sources SET sha256=$1 WHERE project_id=$2', ['a'.repeat(64), imported.id]), /immutable/);
    await assert.rejects(ownerSql('UPDATE create_psd_source_parts SET content_base64=$1 WHERE project_id=$2', ['AAAA', imported.id]), /immutable/);
  });
  await t.test('sealed replay creates no duplicates and changed bytes/mode/title refuse', async () => {
    const old = await counts('alice'), replay = await api.call('/psd-imports', 'POST', form(bytes, choice)); assert.equal(replay.status, 201); assert.equal(replay.body.project.id, imported.id); assert.equal(replay.body.replayed, true); assert.equal(replay.body.project.revision, 1);
    assert.deepEqual(await counts('alice'), old);
    assert.equal((await api.call('/psd-imports', 'POST', form(bytes, { ...choice, title: 'Changed' }))).status, 409);
    assert.equal((await api.call('/psd-imports', 'POST', form(bytes, { ...choice, mode: 'flattened' }))).status, 409);
    assert.deepEqual(await counts('alice'), old);
  });
  await t.test('foreign/inactive/reader/export withdrawal deny independently before mutation or byte release', async () => {
    assert.equal((await api.call(`/projects/${imported.id}/psd-original`, 'GET', undefined, 'bob')).status, 404);
    assert.equal((await api.call(`/projects/${imported.id}/psd-source`, 'GET', undefined, 'collision')).status, 404);
    assert.equal((await api.call('/psd-imports', 'POST', form(bytes, selected(bytes)), 'inactive')).status, 401);
    api.state.denied.add('project.create'); assert.equal((await api.call('/psd-imports', 'POST', form(bytes, selected(bytes)))).status, 403); assert.equal((await api.call(`/projects/${imported.id}/psd-source`)).status, 200); api.state.denied.delete('project.create');
    api.state.denied.add('project.export'); assert.equal((await api.call(`/projects/${imported.id}/psd-original`)).status, 403); assert.equal((await api.call(`/projects/${imported.id}/psd-source`)).status, 200); api.state.denied.delete('project.export');
    assert.equal((await api.call('/psd-imports?owner=alice', 'POST', form(bytes, selected(bytes)))).status, 400);
    assert.equal((await api.call('/psd-artifact-imports', 'POST', { ref: 'not-a-real-handle', ...selected(bytes) })).status, 403);
  });
  await t.test('unsupported semantic import requires explicit flattened mode; real PNG merged pixels persist', async () => {
    const value = makePsd({ layers: [{ tag: 'TySh' }], color: [12, 34, 56] }), old = await counts('alice');
    const inspected = await api.call('/psd-inspect', 'POST', form(value)); assert.equal(inspected.body.editable, false); assert.equal(inspected.body.flattened, true); assert.ok(inspected.body.report.some(row => row.code === 'layer_tag_TySh_unsupported'));
    assert.equal((await api.call('/psd-imports', 'POST', form(value, selected(value)))).status, 422); assert.deepEqual(await counts('alice'), old);
    const result = await api.call('/psd-imports', 'POST', form(value, selected(value, 'Explicit flat copy', 'flattened'))); assert.equal(result.status, 201); assert.equal(result.body.project.document.layers.length, 1);
    const image = Object.values(result.body.project.document.images)[0], response = await fetch(api.origin + image.src), decoded = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer();
    assert.deepEqual([...decoded], Array(4).fill([12, 34, 56, 255]).flat());
  });
  await t.test('named original-parts fault and grant withdrawal after writes roll back project/images/source atomically', async () => {
    const old = await counts('alice'), path = resolve(api.dataRoot, digest(JSON.stringify(['https://create-identity.fixture.test','alice']))), files = await readdir(path);
    fault = 'parts'; const failed = await api.call('/psd-imports', 'POST', form(bytes, selected(bytes))); fault = '';
    assert.equal(failed.status, 503); assert.equal(failed.body.error, 'named_psd_original_parts_rollback_fixture'); assert.deepEqual(await counts('alice'), old); assert.deepEqual(await readdir(path), files);
    revoke = true; const denied = await api.call('/psd-imports', 'POST', form(bytes, selected(bytes))); api.state.denied.delete('project.create');
    assert.equal(denied.status, 403); assert.deepEqual(await counts('alice'), old); assert.deepEqual(await readdir(path), files);
  });
  await t.test('full4MiB original download/64 parts and per-owner retained quota are actual byte proofs', async () => {
    const bare = makePsd({ layers: [{}] }), size = 4194304 - bare.length - 12, resource = Buffer.alloc(size + 12);
    resource.write('8BIM',0); resource.writeUInt16BE(65535,4); resource.writeUInt32BE(size,8);
    const value = makePsd({ layers: [{}], resources: resource }); assert.equal(value.length, 4194304);
    const result = await api.call('/psd-imports', 'POST', form(value, selected(value, 'Full original', 'flattened')), 'bob'); assert.equal(result.status, 201, JSON.stringify(result.body));
    const response = await fetch(api.origin + `/api/create/projects/${result.body.project.id}/psd-original`, { headers: { 'x-fixture-actor':'bob' } }); assert.equal(response.status, 200); const actual = Buffer.from(await response.arrayBuffer()); assert.equal(actual.length, value.length); assert.equal(digest(actual), digest(value));
    assert.equal((await counts('bob')).parts, 64);
    const before = await counts('bob'); assert.equal((await api.call('/psd-imports','POST',form(bytes,selected(bytes)),'bob')).status,413); assert.deepEqual(await counts('bob'), before);
    assert.equal((await api.call(`/projects/${result.body.project.id}`,'DELETE',{baseRevision:1},'bob')).status,204); assert.equal((await counts('bob')).parts,0); assert.equal((await counts('bob')).sources,0);
  });
  await t.test('two whole-pipeline reservations bound concurrent maximum decoded imports; third refuses before decoding', async () => {
    const value=makePsd({width:2048,height:2048,rle:true,layers:[{width:1024,height:2048},{x:1024,width:1024,height:2048}]});
    const gate={entered:Promise.withResolvers(),released:Promise.withResolvers()};hold=gate;
    const first=api.call('/psd-imports','POST',form(value,selected(value,'Maximum source1')),'admin');
    let second,timer;
    try {
      await Promise.race([gate.entered.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('named PSD gate not reached')),5000);})]);clearTimeout(timer);
      const observed=api.state.decisions.length;second=api.call('/psd-imports','POST',form(value,selected(value,'Maximum source2')),'admin');
      const deadline=Date.now()+2000;while(api.state.decisions.length<observed+4 && Date.now()<deadline)await new Promise(done=>setTimeout(done,10));
      assert.ok(api.state.decisions.length>=observed+4,'second actual request reached fresh admission');
      const refused=await api.call('/psd-imports','POST',form(value,selected(value,'No third allocation')),'admin');assert.equal(refused.status,503);assert.equal(refused.body.error,'psd_import_busy');
    } finally { clearTimeout(timer);gate.released.resolve();await Promise.allSettled([first,...(second?[second]:[])]); }
    assert.equal((await first).status,201);assert.equal((await second).status,201);assert.equal((await counts('admin')).projects,2);assert.equal((await counts('admin')).assets,4);
    console.log(JSON.stringify({fixture:'PSD maximum decoded source pipelines',decodedPixelsPerRequest:8388608,concurrent:2,processMaxRssKiB:process.resourceUsage().maxRSS,architecture:process.arch,nativeImagePort:false}));
  });
});
