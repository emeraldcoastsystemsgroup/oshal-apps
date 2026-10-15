/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify real Video HTTP/store/forced-RLS source lineage and human/agent refresh; artifact exchange and native upload are explicitly named fixture seams.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Match native offset-only chunk receipts and reject incorrect acknowledgements before publication.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Exercise owned-job discovery and approved typed mint using explicit native port seams while retaining real media and forced-RLS publication.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Accept every valid producer title within160 UTF16 units while retaining the actual UTF8 full-receipt bound.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {startApi,motionExchange,loadCompiled,packageRoot,requireCore,timeline} from './video-editor.fixture.mjs';
import {startPostgres} from './video-editor-postgres.fixture.mjs';
import {validateMotionSource,motionSourceUrl} from '../tools/editor/motion-source.mjs';
import * as model from '../tools/editor/timeline-model.mjs';
import {applyAgentOperations} from '../tools/editor/agent-tools.mjs';
const {inspectUpload,probeWithFfprobe}=loadCompiled('video-editor-media.js');
const REF='art_'+'a'.repeat(64), project=randomUUID(),render=randomUUID(), hash='b'.repeat(64);
const link={project,revision:1,compId:'18446744073709551615',documentSha256:hash,renderJob:render,renderSha256:hash,startTick:'0',endTick:'1000',frameRate:{num:30,den:1}};
const source={kind:'video',asset:randomUUID(),name:'Composition',frames:30,width:320,height:180,audio:false,motion:link};
test('Motion source identities preserve wide ids and reject authority, paths, extra fields and invalid decimal ranges',()=>{
 assert.deepEqual(validateMotionSource(link),link); assert.equal(motionSourceUrl(link),`/api/motion-studio/app?project=${project}&revision=1&compId=18446744073709551615`);
 for(const value of [{...link,owner:'other'},{...link,compId:'18446744073709551616'},{...link,startTick:'-9223372036854775809'},{...link,endTick:'0'},{...link,frameRate:{num:30,den:1,path:'/private'}},{...link,revision:1.1},{...link,renderSha256:'G'.repeat(64)}])assert.throws(()=>validateMotionSource(value));
});
test('human and agent source refresh preserve immutable trim/split/effects/linked timing, refuse locked tracks or incompatible source ranges',()=>{
 const add=model.addSource(model.createTimeline('Source edit'),source),clip=model.appendSegment(add.document,add.key,{in:5,out:25});
 const split=model.splitSegment(clip,'s1',10).document,serial=JSON.stringify(split),next={...source,asset:randomUUID(),motion:{...link,revision:2,documentSha256:'c'.repeat(64),renderJob:randomUUID()}};
 const updated=model.replaceMotionSource(split,'v1',next);assert.deepEqual(updated.segments,split.segments);assert.equal(JSON.stringify(split),serial);assert.equal(updated.sources.v1.motion.revision,2);
 const v2=applyAgentOperations(split,[{type:'migrate'},{type:'clip',id:'s1',patch:{opacity:75,x:10}}]);
 const fresh=applyAgentOperations(v2,[{type:'replaceMotionSource',key:'v1',sourceMetadata:next}]);assert.deepEqual(fresh.tracks,v2.tracks);assert.deepEqual(fresh.sources.v1.motion,next.motion);
 for(const replacement of [{...next,frames:10},{...next,motion:{...next.motion,compId:'1'}},{...next,motion:{...next.motion,startTick:'1'}},{...next,motion:{...next.motion,frameRate:{num:24,den:1}}}])assert.throws(()=>model.replaceMotionSource(v2,'v1',replacement));
 const locked=applyAgentOperations(v2,[{type:'track',id:'video1',patch:{locked:true}}]);assert.throws(()=>model.replaceMotionSource(locked,'v1',next));
});

async function setup(t,options={}){
 const database=await startPostgres(fn=>t.after(fn)); database.pool.storageModel='kernel-scoped-documents';
 const original=options.bytes ?? await readFile(resolve(packageRoot,'tests/fixtures/editor-acceptance-clip.mp4')),free=Buffer.alloc(300000);free.writeUInt32BE(free.length,0);free.write('free',4);
 const bytes=Buffer.concat([original,free]),directory=await mkdtemp(resolve(tmpdir(),'video-motion-proof-'));t.after(()=>rm(directory,{recursive:true,force:true}));const mediaFile=resolve(directory,'composition.mp4');await writeFile(mediaFile,bytes);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const measured=await inspectUpload(mediaFile,'video',probeWithFfprobe);
 const receipt={id:randomUUID(),state:'ready',title:'Owned composition',createdAt:'2026-10-13T04:30:00.000Z',expiresAt:'2026-10-13T05:30:00.000Z',project,revision:1,compId:'2',documentSha256:hash,format:'mp4',frames:30,frameRate:{num:30,den:1},startTick:'0',endTick:'1000',bytes:bytes.length,sha256,width:measured.width,height:measured.height,renderWidth:options.renderWidth??measured.width,renderHeight:options.renderHeight??measured.height};
 let metadata={ref:REF,type:'video/mp4',size:bytes.length,sha256,sourcePackage:'motion-studio',source:`/api/motion-studio/render-jobs/${receipt.id}`,receipt};
 const uploads=new Map(),calls=[],control={deny:false,corrupt:false,revoke:null};
 motionExchange.metadata=async ref=>{if(control.deny || ref!==REF)throw Error('Denied');const result=structuredClone(metadata);control.afterMetadata?.();return result;};
 motionExchange.chunk=async(ref,offset)=>{if(control.deny || ref!==REF)throw Error('Denied');const piece=Buffer.from(bytes.subarray(offset,offset+65536));if(control.corrupt)piece[0]^=1;control.revoke?.();return {ref,offset,size:bytes.length,dataBase64:piece.toString('base64'),done:offset+piece.length===bytes.length};};
 const intent=async(name,input)=>{
  if(name==='artifact.exchange'){
   calls.push('artifact:'+input.op);(control.artifactInputs??=[]).push(structuredClone(input));
   if(control.deny)throw Error('Named native fixture: source grant denied');
   if(input.op==='motion-renders'){assert.deepEqual(input,{op:'motion-renders'});return control.catalogue??{jobs:[structuredClone(receipt)]};}
   if(input.op==='mint'){assert.deepEqual(input,{op:'mint',mode:'motion-render',source:`/api/motion-studio/render-jobs/${receipt.id}`,type:'video/mp4',name:'Editable Motion'});return{ref:REF};}
   throw Error('Unexpected named artifact op');
  }
  assert.equal(name,'video.editor');calls.push(input.op);
  if(input.op==='epoch')return {epoch:'fixture',chunkBytes:131072};
  if(input.op==='upload_begin'){
   let record=[...uploads.values()].find(item=>item.requestKey===input.requestKey);
   if(record){if(record.bytes!==input.bytes || record.contentSha256!==input.contentSha256 || record.requestDigest!==input.requestDigest)throw Error('refused: video_edit_upload_conflict');}
   else{record={id:randomUUID(),parts:[],requestKey:input.requestKey,contentSha256:input.contentSha256,requestDigest:input.requestDigest,bytes:input.bytes};uploads.set(record.id,record);}
   if(control.lose==='begin'){control.lose=null;throw Error('Named fixture: persisted begin acknowledgement lost');}
   return{id:record.id,chunkBytes:131072,offset:record.parts.reduce((sum,b)=>sum+b.length,0)};
  }
  if(input.op==='upload_status'){const record=uploads.get(input.id);return{id:record.id,kind:'video',bytes:record.bytes,chunkBytes:131072,offset:control.badOffset??record.parts.reduce((sum,b)=>sum+b.length,0),contentSha256:record.contentSha256,requestDigest:record.requestDigest,...(record.media?{media:record.media}:{})};}
  if(input.op==='upload_chunk'){const parts=uploads.get(input.id).parts,offset=parts.reduce((sum,b)=>sum+b.length,0),piece=Buffer.from(input.data,'base64');assert.equal(input.offset,offset);assert.equal(createHash('sha256').update(piece).digest('hex'),input.sha256);parts.push(piece);if(control.lose==='chunk'){control.lose=null;throw Error('Named fixture: persisted chunk acknowledgement lost');}return {offset:control.badChunkOffset??offset+piece.length};}
  if(input.op==='upload_finish'){await control.finishHold;const record=uploads.get(input.id),data=Buffer.concat(record.parts);assert.deepEqual(data,bytes);record.media={...measured,id:input.id,bytes:data.length,sha256};if(control.lose==='finish'){control.lose=null;throw Error('Named fixture: persisted finish acknowledgement lost');}return{media:record.media};}
  throw Error('Unexpected native fixture op '+input.op);
 };
 const api=await startApi(t,database.pool,{intent}),body={ref:REF,name:'Editable Motion',requestKey:randomUUID()};
 return{database,api,body,calls,control,receipt,metadata,uploads,updateMetadata(value){metadata=value;},bytes};
}
test('verified real H264 bytes import once, exact owned editable lineage persists/reopens; forged, stripped, foreign and changed receipts refuse',async t=>{
 const f=await setup(t);const result=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(result.status,201,JSON.stringify(result.body));
 const imported=result.body,again=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(again.status,201);assert.equal(again.body.replayed,true);assert.equal(again.body.media.id,imported.media.id);assert.equal(f.calls.filter(op=>op==='upload_begin').length,1);assert.ok(f.calls.filter(op=>op==='upload_chunk').length>=3,'64KiB source segments aggregate into full128KiB native parts');
 const doc=model.appendSegment(model.addSource(model.createTimeline('Linked video'),imported.sourceMetadata).document,'v1');
 const saved=await f.api.call('/editor/projects','POST',{title:doc.name,document:doc});assert.equal(saved.status,201,JSON.stringify(saved.body));
 const reopened=await f.api.call('/editor/projects/'+saved.body.project.id);assert.deepEqual(reopened.body.project.document.sources.v1.motion,imported.sourceMetadata.motion);
 for(const source of [{...imported.sourceMetadata,motion:{...imported.sourceMetadata.motion,revision:2}},{...imported.sourceMetadata,motion:undefined}]){
  const bad={...doc,sources:{v1:source}};const response=await f.api.call('/editor/projects','POST',{title:doc.name,document:bad});assert.equal(response.status,400);assert.equal(response.body.error,'video_edit_motion_source_mismatch');
 }
 const other=await f.api.call('/editor/projects','POST',{title:doc.name,document:doc},'bob');assert.equal(other.status,400);assert.equal(other.body.error,'video_edit_motion_source_mismatch');
 const original=await f.database.admin.query('SELECT source FROM video_edit_motion_sources');assert.equal(original.rows.length,1);
 await assert.rejects(f.database.admin.query("UPDATE video_edit_motion_sources SET source='{}'::jsonb"),/immutable/);
 const row=await f.database.pool.connect();try{await row.query('BEGIN');await row.query("SELECT set_config('video.owner_issuer',$1,true),set_config('video.owner_sub',$2,true)",['https://other.test','alice']);assert.equal((await row.query('SELECT * FROM video_edit_motion_sources')).rows.length,0);await row.query('ROLLBACK');}finally{row.release();}
 f.metadata.receipt.revision=2;const conflict=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(conflict.status,409);assert.equal(conflict.body.error,'video_edit_motion_import_conflict');
});
test('fresh Video grants, Motion source revocation, corrupt bytes and forged producer refuse before saved publication',async t=>{
 const f=await setup(t);
 for(const permission of ['editor.view','editor.read','editor.change']){f.api.state.denied.add(permission);const denied=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(denied.status,403);f.api.state.denied.delete(permission);}assert.equal(f.calls.length,0);
 f.control.deny=true;assert.equal((await f.api.call('/editor/motion-media','POST',f.body)).status,403);f.control.deny=false;
 f.updateMetadata({...f.metadata,sourcePackage:'other'});assert.equal((await f.api.call('/editor/motion-media','POST',f.body)).status,400);assert.equal(f.calls.length,0);f.updateMetadata(f.metadata);
 f.control.corrupt=true;const corrupt=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(corrupt.status,503);assert.equal(corrupt.body.error,'video_edit_motion_digest_mismatch');f.control.corrupt=false;
 f.control.revoke=()=>f.api.state.denied.add('editor.change');assert.equal((await f.api.call('/editor/motion-media','POST',f.body)).status,403);
 assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,0);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,0);
});
test('real human phone UI selects a ready render, links exact source in a draft, saves/reopens and refreshes without losing clips',async t=>{
 const f=await setup(t),{chromium}=requireCore('playwright'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:412,height:915}});t.after(()=>context.close());
 await context.route('**/api/motion-studio/render-jobs',route=>route.fulfill({json:{jobs:[f.receipt]}}));
 await context.route('**/api/artifacts/handles',route=>route.fulfill({json:{ref:REF}}));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(f.api.origin+'/api/video/editor');await page.locator('html[data-editor-ready="true"]').waitFor();
 await page.locator('#motionImportPanel summary').click();await page.locator('#refreshMotionJobs').click();await page.locator('#motionRender').selectOption(f.receipt.id);await page.locator('#importMotion').click();await page.locator('#status').filter({hasText:'Motion source linked in your draft'}).waitFor();
 assert.match(await page.locator('#motionSources a').getAttribute('href'),/revision=1/);assert.equal(await page.locator('#track .segment').count(),1);
 await page.locator('#saveProject').click();await page.locator('#status').filter({hasText:'Saved · revision 1'}).waitFor();await page.reload();await page.locator('html[data-editor-ready="true"]').waitFor();await page.locator('#motionImportPanel summary').click();assert.equal(await page.locator('#motionSources a').count(),1);
 f.receipt.revision=2;f.receipt.documentSha256='c'.repeat(64);f.receipt.id=randomUUID();f.metadata.source=`/api/motion-studio/render-jobs/${f.receipt.id}`;
 await page.locator('#refreshMotionJobs').click();await page.locator('#motionRender').selectOption(f.receipt.id);await page.locator('#motionReplace').selectOption('v1');await page.locator('#importMotion').click();await page.locator('#status').filter({hasText:'Motion source linked in your draft'}).waitFor();
 assert.equal(await page.locator('#track .segment').count(),1);assert.match(await page.locator('#motionSources a').getAttribute('href'),/revision=2/);await page.locator('#undo').click();assert.match(await page.locator('#motionSources a').getAttribute('href'),/revision=1/);await page.locator('#redo').click();
 await page.locator('#saveProject').click();await page.locator('#status').filter({hasText:'Saved · revision 2'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
});
test('lost real SQL COMMIT acknowledgement recovers exactly one immutable import with the same request key',async t=>{
 const f=await setup(t),connect=f.database.pool.connect.bind(f.database.pool);let lost=false;
 f.database.pool.connect=async()=>{
  const client=await connect(),query=client.query.bind(client);let inserted=false;
  return new Proxy(client,{get(target,key){
   if(key==='query')return async(sql,values)=>{const result=await query(sql,values);if(/^INSERT INTO video_edit_motion_sources/.test(sql))inserted=true;if(sql==='COMMIT'&&inserted&&!lost){lost=true;throw Error('Named fixture: COMMIT committed but acknowledgement lost');}return result;};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
 };
 const uncertain=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(uncertain.status,503);assert.equal(lost,true);
 const retry=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(retry.status,201);assert.equal(retry.body.replayed,true);assert.equal(f.calls.filter(op=>op==='upload_begin').length,1);
 assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,1);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,1);
});

test('an actual held import cannot attach its source to a newly opened human draft',async t=>{
 const f=await setup(t),{chromium}=requireCore('playwright'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext();t.after(()=>context.close());
 await context.route('**/api/motion-studio/render-jobs',route=>route.fulfill({json:{jobs:[f.receipt]}}));await context.route('**/api/artifacts/handles',route=>route.fulfill({json:{ref:REF}}));
 let release;f.control.finishHold=new Promise(done=>{release=done;});t.after(()=>release());
 const page=await context.newPage();await page.goto(f.api.origin+'/api/video/editor');await page.locator('html[data-editor-ready="true"]').waitFor();
 await page.locator('#motionImportPanel summary').click();await page.locator('#refreshMotionJobs').click();await page.locator('#motionRender').selectOption(f.receipt.id);await page.locator('#importMotion').click();
 await page.locator('#status').filter({hasText:'Linking Motion render'}).waitFor();
 await page.locator('#newProject').click();release();await page.locator('#status').filter({hasText:'The newly opened draft was kept'}).waitFor();
 assert.equal(await page.locator('#track .segment').count(),0);assert.equal(await page.locator('#motionSources a').count(),0);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,1);
});
test('explicit same-key retries recover persisted native begin, chunk and finish acknowledgements without another upload or duplicate bytes',async t=>{
 for(const phase of ['begin','chunk','finish'])await t.test(phase,async child=>{
  const f=await setup(child);f.control.lose=phase;
  const uncertain=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(uncertain.status,503);
  assert.equal(f.uploads.size,1);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,0);
  const recovered=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(recovered.status,201,JSON.stringify(recovered.body));assert.equal(f.uploads.size,1);
  const record=[...f.uploads.values()][0];assert.deepEqual(Buffer.concat(record.parts),f.bytes);assert.equal(record.parts.length,3,'only actual128Kparts, no duplicate bytes');
  assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,1);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,1);
 });
});
test('live native recovery key seals the complete trusted lineage and refuses changed graph with equal media digest or invalid acknowledged offsets',async t=>{
 const f=await setup(t);f.control.lose='begin';assert.equal((await f.api.call('/editor/motion-media','POST',f.body)).status,503);
 f.receipt.documentSha256='c'.repeat(64);const conflict=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(conflict.status,409);assert.equal(f.uploads.size,1);
 f.receipt.documentSha256=hash;f.control.badOffset=1;const offset=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(offset.status,503);assert.equal(offset.body.error,'video_edit_motion_upload_receipt_invalid');
 assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,0);
});
test('genuine odd159x89 raw frames produce admissible padded160x90 H264; inconsistent or forged encoded receipt dimensions refuse',async t=>{
 const {execFileSync}=await import('node:child_process'),directory=await mkdtemp(resolve(tmpdir(),'video-odd-mp4-'));t.after(()=>rm(directory,{recursive:true,force:true}));const path=resolve(directory,'odd.mp4');
 const frame=Buffer.alloc(159*89*3);for(let pixel=0;pixel<frame.length;pixel+=3)frame[pixel]=255;
 execFileSync('/usr/bin/ffmpeg',['-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size','159x89','-framerate','30','-i','pipe:0','-vf','pad=160:90','-frames:v','30','-c:v','libx264','-pix_fmt','yuv420p',path],{input:Buffer.concat(Array(30).fill(frame)),maxBuffer:1024*1024});
 const bytes=await readFile(path),f=await setup(t,{bytes,renderWidth:159,renderHeight:89});assert.equal(f.receipt.width,160);assert.equal(f.receipt.height,90);
 const imported=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(imported.status,201,JSON.stringify(imported.body));assert.equal(imported.body.sourceMetadata.width,160);assert.equal(imported.body.sourceMetadata.height,90);
 for(const patch of [{width:159},{height:89},{renderWidth:157},{renderHeight:87}]){
  const previous={...f.receipt};Object.assign(f.receipt,patch);const bad=await f.api.call('/editor/motion-media','POST',{...f.body,requestKey:randomUUID()});assert.equal(bad.status,400);assert.equal(bad.body.error,'video_edit_motion_render_required');Object.assign(f.receipt,previous);
 }
});

test('canonical offset-only native chunk receipts succeed and incorrect acknowledgements refuse publication',async t=>{
 for(const offset of [0,1,131073])await t.test(String(offset),async child=>{
  const f=await setup(child);f.control.badChunkOffset=offset;
  const refused=await f.api.call('/editor/motion-media','POST',f.body);assert.equal(refused.status,503);assert.equal(refused.body.error,'video_edit_motion_upload_receipt_invalid');
  assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,0);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,0);
 });
});

test('owned-job discovery is complete bounded metadata and approved import keeps the original verified pipeline',async t=>{
 const f=await setup(t),second={...f.receipt,id:randomUUID(),title:'Second composition',revision:2,bytes:200*1024*1024,frames:1800};
 f.control.catalogue={jobs:[f.receipt,second]};
 const listed=await f.api.call('/editor/motion-renders','POST',{});assert.equal(listed.status,200,JSON.stringify(listed.body));assert.equal(listed.body.jobs.length,2);
 assert.equal(listed.body.jobs[1].bytes,second.bytes,'large unsupported import remains visible rather than silently omitted');assert.equal(listed.body.jobs[1].title,second.title);
 assert.deepEqual(f.calls,['artifact:motion-renders']);assert.equal(f.uploads.size,0);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,0);
 for(const title of ['é'.repeat(160),'😀'.repeat(80),'\u0001'.repeat(159)+'a']){f.control.catalogue={jobs:[{...f.receipt,title}]};const unicode=await f.api.call('/editor/motion-renders','POST',{});assert.equal(unicode.status,200,JSON.stringify(unicode.body));assert.equal(unicode.body.jobs[0].title,title,'protected producer title bound is UTF16 units, not byte length');}
 const body={id:f.receipt.id,name:'Editable Motion',requestKey:randomUUID()},path=`/editor/motion-render-jobs/${body.id}/import`;
 const result=await f.api.call(path,'POST',body);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.sourceMetadata.motion.renderJob,f.receipt.id);assert.equal(result.body.sourceMetadata.motion.project,f.receipt.project);
 const replay=await f.api.call(path,'POST',body);assert.equal(replay.status,201);assert.equal(replay.body.replayed,true);assert.equal(replay.body.media.id,result.body.media.id);assert.equal(f.uploads.size,1);
 assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,1);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,1);
});
test('catalogue refuses malformed or overflowing selections and closed inputs before native authority calls',async t=>{
 const f=await setup(t);
 for(const body of [{owner:'other'},{source:'/private'},{limit:1}]){assert.equal((await f.api.call('/editor/motion-renders','POST',body)).status,400);}assert.equal(f.calls.length,0);
 for(const jobs of [[f.receipt,f.receipt],Array.from({length:3},()=>({...f.receipt,id:randomUUID()})),[{...f.receipt,title:''}],[{...f.receipt,title:'é'.repeat(3000)}],[{...f.receipt,state:'rendering'}],[{...f.receipt,format:'png-sequence'}],[{...f.receipt,frameRate:{num:30,den:1,owner:'other'}}],[{...f.receipt,renderWidth:f.receipt.width-3}],[{...f.receipt,expiresAt:'invalid'}]]){
  f.control.catalogue={jobs};const result=await f.api.call('/editor/motion-renders','POST',{});assert.equal(result.status,503,JSON.stringify(result.body));assert.equal(result.body.error,'video_edit_motion_catalogue_invalid');
 }
 f.control.catalogue={jobs:[],owner:'other'};assert.equal((await f.api.call('/editor/motion-renders','POST',{})).status,503);
 f.control.catalogue={jobs:[]};assert.deepEqual((await f.api.call('/editor/motion-renders','POST',{})).body,{jobs:[]});assert.equal(f.uploads.size,0);
});
test('Writer admission and current named source-grant refusal protect discovery and job import; forged selection cannot publish',async t=>{
 const f=await setup(t),body={id:f.receipt.id,name:'Editable Motion',requestKey:randomUUID()},path=`/editor/motion-render-jobs/${body.id}/import`;
 for(const permission of ['editor.view','editor.read','editor.change']){
  f.api.state.denied.add(permission);for(const [route,input] of [['/editor/motion-renders',{}],[path,body]])assert.equal((await f.api.call(route,'POST',input)).status,403);f.api.state.denied.delete(permission);
 }assert.equal(f.calls.length,0);
 for(const input of [{...body,owner:'other'},{...body,source:'/private'},{...body,id:randomUUID()},{...body,ref:REF}])assert.equal((await f.api.call(path,'POST',input)).status,400);assert.equal(f.calls.length,0);
 f.control.deny=true;for(const [route,input] of [['/editor/motion-renders',{}],[path,body]])assert.equal((await f.api.call(route,'POST',input)).status,403);f.control.deny=false;
 f.updateMetadata({...f.metadata,receipt:{...f.receipt,id:randomUUID()}});const changed=await f.api.call(path,'POST',body);assert.equal(changed.status,503);assert.equal(changed.body.error,'video_edit_motion_source_changed');assert.equal(f.uploads.size,0);
 assert.equal((await f.database.admin.query('SELECT * FROM video_edit_assets')).rows.length,0);assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,0);
});

test('job selection remains exact if a named native metadata seam changes between typed mint and import',async t=>{
 const f=await setup(t),body={id:f.receipt.id,name:'Editable Motion',requestKey:randomUUID()},path=`/editor/motion-render-jobs/${body.id}/import`;
 f.control.afterMetadata=()=>{f.receipt.id=randomUUID();f.metadata.source=`/api/motion-studio/render-jobs/${f.receipt.id}`;};
 const changed=await f.api.call(path,'POST',body);assert.equal(changed.status,503);assert.equal(changed.body.error,'video_edit_motion_source_changed');assert.equal(f.uploads.size,0);
 assert.equal((await f.database.admin.query('SELECT * FROM video_edit_motion_sources')).rows.length,0);
});
