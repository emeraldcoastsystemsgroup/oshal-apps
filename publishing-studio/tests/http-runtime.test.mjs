/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mandatory genuine mounted HTTP, original-owner PostgreSQL and pinned Typst proofs.
 * HTTP actor header and keep callbacks are named Source seams; no native kernel/held approval proof is claimed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {requireRuntime} from './fixtures/runtime.mjs';
import {digest} from '../routes/model.mjs';
const {createPublishingRoutes}=await import('../routes/application.mjs');
const express=requireRuntime('express');
const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(90000)});
async function mounted(context,runs){const app=express();app.use('/api/publishing-studio',createPublishingRoutes(context,runs));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));return{url:`http://127.0.0.1:${server.address().port}/api/publishing-studio`,close:()=>new Promise(r=>server.close(r))};}
test('real mounted original-owner SQL HTTP saves/reopens, fences foreign and Reader, and exports actual kept render', {timeout:180000},async()=>{
 const {fixture}=await import('./fixtures/fixture.mjs'),f=await fixture({http:true});
 const call=(path,{owner='alice',body,method='GET',headers={}}={})=>request(f.url+'/api/publishing-studio'+path,{method,headers:{'x-test-owner':owner,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(path,options,status=200)=>{const response=await call(path,options),result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;};
 const wait=async job=>{const deadline=Date.now()+90000;for(;;){const answer=await json('/jobs/'+job);if(['ready','failed','cancelled'].includes(answer.job.state))return answer.job;assert.ok(Date.now()<deadline,'real Source engine job deadline');await new Promise(resolve=>setTimeout(resolve,50));}};
 try{
  const key=randomUUID(),created=await json('/documents',{method:'POST',body:{title:'HTTP owned brochure',pageCount:2,requestKey:key}}),document=created.document.id;
  assert.equal(created.document.revision,1);assert.equal((await json('/documents',{method:'POST',body:{title:'HTTP owned brochure',pageCount:2,requestKey:key}})).document.id,document);
  await json('/documents',{method:'POST',body:{title:'different intent',pageCount:2,requestKey:key}},409);
  assert.deepEqual((await json('/documents',{owner:'bob'})).documents,[]);await json('/documents/'+document,{owner:'bob'},404);
  const editKey=randomUUID(),edit={id:document,baseRevision:1,requestKey:editKey,operationsJson:JSON.stringify([{op:'replace-story',story:'story',paragraphs:[{style:'body',runs:[{text:'HTTP saved linked story exact original owner.'}]}]}])};
  const saved=await json('/documents/'+document+'/edits',{method:'POST',body:edit});assert.equal(saved.document.revision,2);assert.equal((await json('/documents/'+document+'/edits',{method:'POST',body:edit})).document.revision,2);
  const reopened=(await json('/documents/'+document+'?revision=2')).document;assert.equal(reopened.model.stories[0].paragraphs[0].runs[0].text,'HTTP saved linked story exact original owner.');assert.equal((await json('/documents/'+document+'?revision=1')).document.model.stories[0].paragraphs[0].runs[0].text.startsWith('Write your brochure'),true);
  await json('/documents/'+document+'/edits',{method:'POST',body:{...edit,requestKey:randomUUID()}},409);
  for(const operationsJson of ['not JSON','{}',JSON.stringify([{op:'set-view',pageView:'single',owner:'bob'}])])await json('/documents/'+document+'/edits',{method:'POST',body:{...edit,baseRevision:2,requestKey:randomUUID(),operationsJson}},400);
  await json('/documents/'+document+'/edits',{method:'POST',body:{...edit,baseRevision:2,requestKey:randomUUID(),operationsJson:' '.repeat(17000)}},413);
  await json('/documents/'+document+'/revisions',{method:'POST',body:{id:randomUUID(),baseRevision:2,restoreRevision:1,requestKey:randomUUID()}},400);
  await json('/documents/'+document+'/revisions',{method:'POST',body:{id:document,baseRevision:2,restoreRevision:1,requestKey:randomUUID(),tenant:'foreign'}},400);
  const {brochureImage}=await import('./fixtures/brochure.mjs'),png=brochureImage(),upload=new FormData();upload.append('title','Actual owned image');upload.append('requestKey',randomUUID());upload.append('file',new Blob([png],{type:'image/png'}),'image.png');
  const uploaded=await request(f.url+'/api/publishing-studio/assets/upload',{method:'POST',headers:{'x-test-owner':'alice'},body:upload});const assetResult=await uploaded.json();assert.equal(uploaded.status,201,JSON.stringify(assetResult));const asset=assetResult.asset;
  assert.equal(asset.sha256,digest(png));const actual=await call('/assets/'+asset.id+'/content');assert.equal(actual.status,200);assert.deepEqual(Buffer.from(await actual.arrayBuffer()),png);await json('/assets/'+asset.id+'/content',{owner:'bob'},404);
  const begun=await json('/documents/'+document+'/render',{method:'POST',body:{id:document,revision:2,requestKey:randomUUID()}},202);assert.ok(['queued','rendering'].includes(begun.job.state));
  const job=await wait(begun.job.id);assert.equal(job.state,'ready',JSON.stringify(job));assert.equal(job.revision,2);assert.equal(job.sourceSha256,reopened.sha256);
  const exported=await json('/documents/'+document+'/export',{method:'POST',body:{id:document,revision:2,format:'pdf'}});const pdfResponse=await request(f.url+exported.contentUrl,{headers:{'x-test-owner':'alice'}});assert.equal(pdfResponse.status,200);const pdf=Buffer.from(await pdfResponse.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.equal(digest(pdf),exported.sha256);assert.equal(pdf.length,exported.bytes);
  const layout=await json('/documents/'+document+'/export',{method:'POST',body:{revision:2,format:'layout'}}),layoutResponse=await request(f.url+layout.contentUrl,{headers:{'x-test-owner':'alice'}}),layoutBytes=Buffer.from(await layoutResponse.arrayBuffer());assert.equal(digest(layoutBytes),layout.sha256);assert.deepEqual(JSON.parse(layoutBytes),reopened.model);
  const state=f.states.get('alice');for(const permission of ['document.create','document.change','document.delete','document.render','document.export','asset.import','asset.delete','job.manage'])state.denied.add(permission);
  assert.equal((await call('/documents/'+document)).status,200);assert.equal((await call('/documents/'+document+'/revisions/2/preview/1')).status,200);assert.equal((await call('/jobs/'+job.id)).status,200);
  await json('/documents/'+document+'/edits',{method:'POST',body:{...edit,baseRevision:2,requestKey:randomUUID()}},403);await json('/documents/'+document+'/export',{method:'POST',body:{revision:2,format:'pdf'}},403);assert.equal((await request(f.url+exported.contentUrl,{headers:{'x-test-owner':'alice'}})).status,403);
  state.denied.delete('document.export');assert.equal((await request(f.url+exported.contentUrl,{headers:{'x-test-owner':'alice'}})).status,200);
  state.denied.add('document.read');await json('/documents/'+document,{},403);assert.equal((await call('/documents/'+document+'/revisions/2/preview/1')).status,403);
  state.active=false;assert.equal((await call('/jobs/'+job.id)).status,401);
  state.active=true;state.denied.clear();const largeText='Preserved text. '.repeat(4000);const large=await json('/documents/'+document+'/revisions',{method:'POST',body:{baseRevision:2,requestKey:randomUUID(),operations:[{op:'replace-story',story:'story',paragraphs:[{style:'body',runs:[{text:largeText}]}]}]}});assert.equal(large.document.revision,3);
  await json('/documents/'+document+'/model/stories/0?revision=3',{},413);let offset=0,combined='',wholeHash;for(;;){const part=await json('/documents/'+document+'/model/complete/'+offset+'?revision=3');assert.equal(part.revision,3);assert.equal(part.modelSha256,large.document.sha256);assert.ok(part.text.length<=2048);assert.equal(part.offset,offset);assert.equal(part.textSha256,wholeHash??part.textSha256);wholeHash=part.textSha256;combined+=part.text;if(part.nextOffset===null){assert.equal(combined.length,part.totalCodeUnits);break;}assert.ok(part.nextOffset>offset);offset=part.nextOffset;}
  assert.equal(digest(Buffer.from(combined)),wholeHash);assert.equal(JSON.parse(combined).stories[0].paragraphs[0].runs[0].text,largeText);
 }finally{await f.close();}
});
test('real SQL queued render is failed on named continuation-admission refusal and capacity remains reusable',{timeout:90000},async()=>{
 const {fixture}=await import('./fixtures/fixture.mjs'),f=await fixture(),store=f.context('alice').store;
 let keeps=0;const runs={keepRunAlive:async()=>{keeps++;throw new Error('named_source_keep_refusal');},run:async()=>{throw new Error('refused producer must not schedule');},runFinished:async()=>{throw new Error('refused run has no completion');}},app=await mounted(f.ctx,runs);
 try{const document=(await store.create({title:'Admission refusal',pageCount:1,requestKey:randomUUID()})).document;
 for(let n=0;n<3;n++){const r=await request(app.url+'/documents/'+document.id+'/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:1,requestKey:randomUUID()})});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'publishing_continuation_unavailable'});}
 assert.equal(keeps,3);const rows=(await f.db.query('SELECT state,error FROM publishing_jobs')).rows;assert.equal(rows.length,3);assert.ok(rows.every(row=>row.state==='failed'&&row.error==='publishing_continuation_unavailable'));
 }finally{await app.close();await f.close();}
});
