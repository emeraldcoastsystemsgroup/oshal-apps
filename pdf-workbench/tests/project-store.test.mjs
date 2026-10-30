/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Genuine disposable PostgreSQL + pure PDF worker ownership/history/cancel/rollback proofs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exact retention boundary, foreign reclamation denial, encoded quotas, expiry projection and atomic metadata rollback.
 * Named seam: mutable application-grant adapter; this source test does not claim native kernel admission.
 */
import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
import {LIMITS,digest} from '../routes/model.mjs';
import {PdfStore} from '../routes/project-store.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
const {createPdfRoutes}=await import('../routes/application.mjs');import {bindRequest} from '../routes/authorization.mjs';
import identity from '../routes/engine-identity.json' with {type:'json'};
const root=resolve(import.meta.dirname,'..'),repository=resolve(root,'..');
const require=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN??join(repository,'scripts/toolchain'),'package.json')),{Pool}=require('pg');
const python=process.env.OSHAL_PDF_TEST_PYTHON;assert.ok(python,'OSHAL_PDF_TEST_PYTHON required for genuine PDF worker');
const url=new URL(process.env.OSHAL_TEST_POSTGRES??'');assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='127.0.0.1'&&url.port==='35689','Only shared disposable PG127.0.0.1:35689');
function command(args,input){const r=spawnSync(python,args,{input,encoding:'utf8',timeout:50000,maxBuffer:14*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;}
test('immutable owned revisions, fresh grant/cancel denial and actual transaction rollback',async()=>{
 const suffix=randomUUID().replaceAll('-',''),database='pdf_fixture_'+suffix,role='pdf_role_'+suffix,password=randomUUID(),admin=new Pool({connectionString:url.href});let db,pool;const dir=mkdtempSync(join(tmpdir(),'pdf-store-'));
 try{
  await admin.query('CREATE DATABASE '+database);await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  const dbUrl=new URL(url);dbUrl.pathname='/'+database;db=new Pool({connectionString:dbUrl.href});await db.query(readFileSync(join(root,'migrations/001-pdf-workbench.sql'),'utf8'));await db.query(`GRANT USAGE ON SCHEMA public TO ${role};GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  dbUrl.username=role;dbUrl.password=password;pool=new Pool({connectionString:dbUrl.href,max:8});
  command([join(root,'tests/fixtures/build-fixtures.py'),dir]);const data=readFileSync(join(dir,'first.pdf'));
  function context(sub){const state={sub,denied:new Set(),active:true,hook:null,sqlHook:null};const ctx={pool:{connect:async()=>{const client=await pool.connect();return{query:async(sql,params)=>{if(state.sqlHook)await state.sqlHook(sql,params);return client.query(sql,params);},release:()=>client.release()};}},authorization:{currentActor:()=>({issuer:'pdf-fixture',sub:state.sub,isActive:state.active}),authorize:async({permission})=>({allowed:!state.denied.has(permission)})},intent:async(name,input)=>{assert.equal(name,'engine.exchange');const result=JSON.parse(command([join(root,'engine/worker.py')],JSON.stringify(input.request.args)));if(state.hook)await state.hook(input.request.args,result);return{hello:{bridge:identity},reply:{id:1,buildHash:identity.buildHash,...result}};}};return{state,ctx,store:new PdfStore(bindRequest(ctx))};}
  const alice=context('alice'),bob=context('bob'),requestKey=randomUUID();const uploaded=await alice.store.upload({title:'First form',data,requestKey});assert.equal((await alice.store.upload({title:'First form',data,requestKey})).source.id,uploaded.source.id);
  await assert.rejects(alice.store.upload({title:'Changed intent',data,requestKey}),/pdf_request_conflict/);
  const created=await alice.store.create({title:'Owned document',source:uploaded.source.id,requestKey:randomUUID()}),document=created.document.id;
  assert.equal((await alice.store.get(document)).document.revision,1);
  await assert.rejects(bob.store.get(document),/pdf_document_unavailable/);await assert.rejects(bob.store.create({title:'Foreign',source:uploaded.source.id,requestKey:randomUUID()}),/pdf_source_unavailable/);
  const page=created.document.model.pages[0].id;
  const job=await alice.store.begin(document,{baseRevision:1,requestKey:randomUUID(),operations:[{op:'rotate',page,degrees:90},{op:'fill',name:uploaded.source.id+'.name',value:'ALICE'}]});await alice.store.produce(job.job.id);
  const saved=await alice.store.get(document);assert.equal(saved.document.revision,2);assert.equal(saved.document.model.pages[0].id,page);assert.equal(saved.document.model.pages[0].rotation,90);assert.equal(saved.history.length,2);
  // Actual mounted HTTP lookup uses the genuine scoped store/worker; only actor/grant callbacks are the declared seam.
  const express=requireRuntime('express'),http=express();http.use('/api/pdf-workbench',createPdfRoutes({...alice.ctx,authorization:{...alice.ctx.authorization,registerResource:()=>{}}}));const server=http.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const receipt=await (await fetch('http://127.0.0.1:'+server.address().port+'/api/pdf-workbench/documents/'+document+'?revision=2&receipt=1')).json();assert.deepEqual(receipt.document.pages[0].cropBox,created.document.inspection.pages[0].cropBox);assert.ok(receipt.document.pages[0].textAnnotationRect);const lookup='http://127.0.0.1:'+server.address().port+'/api/pdf-workbench/documents/'+document+'/model/form-fields/0?revision=2&query=name';let response=await fetch(lookup);assert.equal(response.status,200);const body=await response.json();assert.equal(body.revision,2);assert.ok(body.fields.some(f=>f.name===uploaded.source.id+'.name'&&f.value==='ALICE'));assert.ok(Buffer.byteLength(JSON.stringify(body))<=8192);alice.state.sub='bob';assert.equal((await fetch(lookup)).status,404);alice.state.sub='alice';alice.state.denied.add('document.read');assert.equal((await fetch(lookup)).status,403);alice.state.denied.delete('document.read');}finally{alice.state.sub='alice';alice.state.denied.delete('document.read');await new Promise(r=>server.close(r));}
  // Actual Jarvis failure: do not accept an A4-shaped annotation on a small saved PDF.
  const jobsBeforeGeometry=(await db.query('SELECT count(*)::int AS n FROM pdf_jobs')).rows[0].n,requestsBeforeGeometry=(await db.query('SELECT count(*)::int AS n FROM pdf_requests')).rows[0].n;
  await assert.rejects(alice.store.begin(document,{baseRevision:2,requestKey:randomUUID(),operations:[{op:'annotate',annotation:{id:randomUUID(),page,kind:'text',rect:[72,700,300,730],text:'Exact saved name'}}]}),/pdf_annotation_geometry/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pdf_jobs')).rows[0].n,jobsBeforeGeometry,'Invalid geometry must not enqueue a render or persist a retry receipt');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pdf_requests')).rows[0].n,requestsBeforeGeometry);
  assert.equal((await alice.store.get(document)).document.revision,2);
  const original=await alice.store.get(document,1);assert.equal(original.document.model.pages[0].rotation,0);assert.equal((await alice.store.content(document,2)).data.subarray(0,5).toString(),'%PDF-');
  await assert.rejects(alice.store.begin(document,{baseRevision:1,requestKey:randomUUID(),operations:[{op:'rotate',page,degrees:90}]}),/pdf_revision_conflict/);
  await assert.rejects(alice.store.removeSource(uploaded.source.id),/pdf_source_retained_by_history/);
  for(const name of ['create','change','delete','export','ocr','job.manage'])alice.state.denied.add('document.'+name);
  assert.equal((await alice.store.job(job.job.id)).state,'ready');await assert.rejects(alice.store.cancel(job.job.id),/pdf_permission_denied/);
  assert.equal((await alice.store.get(document)).document.revision,2);await assert.rejects(alice.store.content(document,2),/pdf_permission_denied/);await assert.rejects(alice.store.upload({title:'Denied',data,requestKey:randomUUID()}),/pdf_permission_denied/);
  alice.state.denied.clear();
  // Pause only delivery after the genuine native-format worker finishes. A concurrent
  // original-owner cancellation must defeat publication and preserve the current head.
  let entered,release;const held=new Promise(r=>entered=r),pause=new Promise(r=>release=r);
  const cancelled=await alice.store.begin(document,{baseRevision:2,requestKey:randomUUID(),operations:[{op:'rotate',page,degrees:90}]});alice.state.hook=async input=>{if(input.op==='derive'){entered();await pause;}};
  const producing=alice.store.produce(cancelled.job.id);await held;await alice.store.cancel(cancelled.job.id);release();await assert.rejects(producing,/pdf_job_not_active/);alice.state.hook=null;assert.equal((await alice.store.get(document)).document.revision,2);assert.equal((await alice.store.job(cancelled.job.id)).state,'cancelled');
  const withdrawn=await alice.store.begin(document,{baseRevision:2,requestKey:randomUUID(),operations:[{op:'rotate',page,degrees:90}]});alice.state.hook=async input=>{if(input.op==='derive')alice.state.denied.add('document.change');};await assert.rejects(alice.store.produce(withdrawn.job.id),/pdf_permission_denied/);alice.state.hook=null;alice.state.denied.clear();await alice.store.cancel(withdrawn.job.id);assert.equal((await alice.store.get(document)).document.revision,2);
  const failing=await alice.store.begin(document,{baseRevision:2,requestKey:randomUUID(),operations:[{op:'rotate',page,degrees:90}]});const before=await db.query('SELECT count(*)::int AS n,sum(bytes)::int AS bytes FROM pdf_blobs');alice.state.sqlHook=async sql=>{if(sql.startsWith('UPDATE pdf_documents SET current_revision'))throw new Error('fixture publication failure');};await assert.rejects(alice.store.produce(failing.job.id),/fixture publication failure/);alice.state.sqlHook=null;const after=await db.query('SELECT count(*)::int AS n,sum(bytes)::int AS bytes FROM pdf_blobs');assert.deepEqual(after.rows,before.rows);assert.equal((await alice.store.get(document)).document.revision,2);
  // Independent SQL proves forced RLS and immutable trigger enforcement, rather than
  // relying on the JavaScript grant seam to claim isolation.
  const check=await pool.connect();try{await check.query('BEGIN');await check.query("SELECT set_config('pdf.owner_issuer','pdf-fixture',true),set_config('pdf.owner_sub','bob',true)");assert.equal((await check.query('SELECT * FROM pdf_sources')).rows.length,0);await check.query('ROLLBACK');await check.query('BEGIN');await check.query("SELECT set_config('pdf.owner_issuer','pdf-fixture',true),set_config('pdf.owner_sub','alice',true)");await assert.rejects(check.query("UPDATE pdf_sources SET title='clobbered'"),/immutable/);await check.query('ROLLBACK');}finally{check.release();}
  const expired=await alice.store.begin(document,{baseRevision:2,requestKey:randomUUID(),operations:[{op:'rotate',page,degrees:90}]});await db.query("UPDATE pdf_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.job.id]);
  alice.state.denied.add('document.job.manage');const expiredRead=await alice.store.job(expired.job.id);assert.equal(expiredRead.state,'failed');assert.equal(expiredRead.error,'pdf_job_expired');assert.equal((await db.query('SELECT state FROM pdf_jobs WHERE id=$1',[expired.job.id])).rows[0].state,'queued','Expiry receipt is pure read, not an implicit write');alice.state.denied.clear();
  await alice.store.remove(document);await alice.store.removeSource(uploaded.source.id);assert.equal((await alice.store.sourceList()).sources.length,0);
  await assert.rejects(alice.store.upload({title:'First form',data,requestKey}),/pdf_request_result_deleted/);
  assert.deepEqual((await db.query('SELECT result FROM pdf_requests WHERE owner_sub=$1 AND request_key=$2',['alice',requestKey])).rows[0].result,{deleted:true});
  // Quota fixtures seed valid private SQL receipts, not renderer or authority responses.
  const count=context('count-bound'),oldKey=randomUUID(),fingerprint=digest('count-allowed');
  await db.query("INSERT INTO pdf_requests(owner_issuer,owner_sub,request_key,fingerprint,result) SELECT 'pdf-fixture','count-bound',gen_random_uuid(),$1,'{}'::jsonb FROM generate_series(1,$2)",[fingerprint,LIMITS.requestCount]);
  const write=(actor,key,result)=>actor.store.transaction('create',(client,owner)=>actor.store.request(client,owner,key,fingerprint,async()=>result));
  await assert.rejects(write(count,oldKey,{accepted:true}),/pdf_request_receipt_limit/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pdf_requests WHERE owner_sub='count-bound'")).rows[0].n,LIMITS.requestCount);
  // Foreign sealed history does not spend this owner's budget.
  assert.deepEqual(await write(bob,randomUUID(),{accepted:true}),{accepted:true});
  const originalNow=Date.now,fixedNow=Date.now(),cutoff=fixedNow-LIMITS.requestHours*3600000;Date.now=()=>fixedNow;
  try{
   await db.query("UPDATE pdf_requests SET created_at=$1 WHERE owner_sub='count-bound'",[new Date(cutoff+1).toISOString()]);
   await assert.rejects(write(count,oldKey,{accepted:true}),/pdf_request_receipt_limit/,'a receipt one millisecond inside horizon is retained');
   await db.query("UPDATE pdf_requests SET created_at=$1 WHERE owner_sub IN ('count-bound','bob')",[new Date(cutoff).toISOString()]);
   assert.deepEqual(await write(count,oldKey,{accepted:true}),{accepted:true});
   assert.equal((await db.query("SELECT count(*)::int AS n FROM pdf_requests WHERE owner_sub='count-bound'")).rows[0].n,1,'exact24h boundary reclaims only original-owner receipts');
   assert.equal((await db.query("SELECT count(*)::int AS n FROM pdf_requests WHERE owner_sub='bob'")).rows[0].n,1,'another caller cannot reclaim foreign expired receipts');
  }finally{Date.now=originalNow;}

  assert.equal((await write(count,oldKey,{ignored:'replay never calls work'})).replayed,true);
  const encoded=context('encoded-bound');
  await db.query("INSERT INTO pdf_requests(owner_issuer,owner_sub,request_key,fingerprint,result) SELECT 'pdf-fixture','encoded-bound',gen_random_uuid(),$1,jsonb_build_object('payload',repeat('x',131070)) FROM generate_series(1,16)",[fingerprint]);
  await assert.rejects(write(encoded,randomUUID(),{accepted:true}),/pdf_request_receipt_bytes/);
  await assert.rejects(write(context('single-bound'),randomUUID(),{payload:'x'.repeat(LIMITS.requestResultBytes)}),/pdf_request_receipt_bytes/);
  // Persisted JSONB adds separator spaces: both escaping and UTF-8 must be measured
  // before INSERT, yielding the explicit quota error rather than a SQL CHECK failure.
  const boundary=context('canonical-bound'),prefix='"\\\n'.repeat(1000)+'é'.repeat(1000),sample={payload:prefix};
  sample.payload+='x'.repeat(LIMITS.requestResultBytes-1-Buffer.byteLength(JSON.stringify(sample)));
  assert.equal(Buffer.byteLength(JSON.stringify(sample)),LIMITS.requestResultBytes-1);
  const boundaryKey=randomUUID();assert.deepEqual(await write(boundary,boundaryKey,sample),sample);
  assert.equal((await db.query('SELECT octet_length(result::text)::int AS n FROM pdf_requests WHERE request_key=$1',[boundaryKey])).rows[0].n,LIMITS.requestResultBytes);
  await assert.rejects(write(boundary,randomUUID(),{payload:sample.payload+'x'}),error=>error.status===413&&error.code==='pdf_request_receipt_bytes');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pdf_requests WHERE owner_sub='canonical-bound'")).rows[0].n,1);
  const retained=context('retained-metadata');
  const retainedSource=await retained.store.upload({title:'Retained original',data,requestKey:randomUUID()}),retainedDocument=await retained.store.create({title:'Retained history',source:retainedSource.source.id,requestKey:randomUUID()});
  await db.query("INSERT INTO pdf_jobs(id,owner_issuer,owner_sub,document_id,state,kind,base_revision,payload,result,expires_at) SELECT gen_random_uuid(),'pdf-fixture','retained-metadata',$1,'ready','ocr',1,$2::jsonb,jsonb_build_object('payload',repeat('x',524288)),now()+interval '5 minutes' FROM generate_series(1,16)",[retainedDocument.document.id,JSON.stringify({model:retainedDocument.document.model})]);
  const metadataBefore=(await db.query("SELECT count(*)::int AS n,sum(bytes)::int AS bytes FROM pdf_blobs WHERE owner_sub='retained-metadata'")).rows;
  await assert.rejects(retained.store.upload({title:'Atomic metadata refusal',data,requestKey:randomUUID()}),/pdf_metadata_quota/);
  assert.deepEqual((await db.query("SELECT count(*)::int AS n,sum(bytes)::int AS bytes FROM pdf_blobs WHERE owner_sub='retained-metadata'")).rows,metadataBefore,'actual upload bytes/rows roll back when metadata is exhausted');
  await retained.store.remove(retainedDocument.document.id);
  assert.equal((await retained.store.sourceList()).sources.length,1,'owned original survives history reclamation');
  assert.ok((await retained.store.upload({title:'Reclaimed capacity',data,requestKey:randomUUID()})).source.id);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pdf_requests WHERE owner_sub='single-bound'")).rows[0].n,0,'oversized cache insertion rolls back');

 }finally{await pool?.end();await db?.end();await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(()=>{});await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});await admin.end();rmSync(dir,{recursive:true,force:true});}
});
