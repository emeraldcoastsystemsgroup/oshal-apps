/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The stand-in employer's three shapes through the shipped helper code (lib/career-browser-worker.js execute, real Chromium) and a stub kernel, on loopback: (a) one POST whose résumé and cover digests equal the packet's and a completed outcome, (b) the same after Continue, (c) Apply then a sign-in wall comes back needs review with zero POSTs. Run: node --test career-hunter/tests/live/career-submit-standin.test.mjs
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const queue=require('../../lib/career-submission-queue'),{execute}=require('../../lib/career-browser-worker');
const standin=require('./career-submit-standin.cjs');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const {chromium}=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN||path.join(root,'scripts/toolchain'),'package.json'))('playwright');
let browser,employer,origin;const oldEnv=process.env.NODE_ENV;
before(async()=>{
  process.env.NODE_ENV='test';
  employer=await standin.start({port:0});origin='http://127.0.0.1:'+employer.port;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await employer?.close();process.env.NODE_ENV=oldEnv;});

/** The approved packet the kernel would hand the helper, built the way Career builds it (lib/career-submission-native.js approve). */
function packet(dir,url){
  const resume=Buffer.from('%PDF-1.7\nStand-in proof résumé '+Math.random()+'\n%%EOF'),cover=Buffer.from('%PDF-1.7\nStand-in proof cover '+Math.random()+'\n%%EOF');
  const profile={fullName:'Sam Example',firstName:'Sam',lastName:'Example',email:'sam.example@example.com',phone:'555-0100'};
  const item=queue.enqueue(dir,{approved:true,postingId:4242,url,resumeSha256:queue.digest(resume),coverSha256:queue.digest(cover),profileSha256:queue.jsonDigest(profile)},{fixtureOrigin:origin}).item;
  const task={version:1,submissionId:item.id,mode:'submit',approved:true,...queue.binding(item,origin),packetDigest:item.packetDigest,profile,
    documents:{'Resume_ATS.pdf':resume.toString('base64'),'CoverLetter.pdf':cover.toString('base64')}};
  const bound={version:1,intentId:item.id,origin,maxPresses:item.maxPresses,expiresAt:Date.now()+300000,task};
  return {input:{...bound,requestDigest:queue.jsonDigest(bound)},resume:queue.digest(resume),cover:queue.digest(cover)};
}
/** A kernel stand-in: permits each distinct press once, answers `next` as the kernel does, keeps the result. */
function kernel(input){
  const asks=[],reports=[];let result;const bytes=Buffer.from(JSON.stringify(input));
  const envelope={id:input.intentId,owner:'proof',tenant:'proof',bot:'proof'};
  const call=async(suffix,body)=>{
    if(suffix.endsWith('/input'))return {version:1,executor:'browser-form-v1',envelope,files:[{path:'browser-task.json',bytes:[...bytes],digest:[...Buffer.from(queue.digest(bytes),'hex')]}],limits:{wall_ms:60000,artifact_bytes:2097152}};
    if(suffix.endsWith('/check'))return {current:true};
    if(suffix.endsWith('/browser-progress')){
      if(body.phase==='reviewing')return {current:true};
      if(body.phase==='press'){asks.push(body);return {current:true,phase:'press',step:body.step,of:input.maxPresses,permit:'c2000000-0000-0000-0000-'+String(body.step).padStart(12,'0')};}
      reports.push(body);const kind=asks.find(a=>a.step===body.step).kind;
      return {current:true,phase:'pressed',step:body.step,result:body.result,next:body.result==='advanced'&&body.step<input.maxPresses&&kind!=='submit'};
    }
    if(suffix.endsWith('/result')){result=body;return {accepted:true};}
    if(suffix.endsWith('/failed'))assert.fail('the helper failed instead of reporting a bounded result');
    assert.fail('unexpected kernel call '+suffix);
  };
  return {call,envelope,asks,reports,get result(){return result;}};
}
async function attempt(t,variant){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'standin-proof-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const run='t'+Math.random().toString(16).slice(2,10),url=origin+'/'+variant+'/'+run+'/apply';
  const {input,resume,cover}=packet(dir,url),native=kernel(input);
  const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.fallback():route.abort('blockedbyclient'));
  await execute(native.call,native.envelope,context,{generation:Array(32).fill(5),root:dir,fixtureOrigin:origin,timeoutMs:3000});
  const answer=JSON.parse(native.result.answer),posts=employer.events.filter(e=>e.run===run&&e.method==='POST');
  return {answer,posts,resume,cover,asks:native.asks,reports:native.reports,artifacts:native.result.artifacts.map(a=>a.path)};
}
function sameDocuments(post,resume,cover){
  assert.deepEqual(post.files.map(f=>[f.field,f.filename,f.sha256]),[['resume','Resume_ATS.pdf',resume],['cover_letter','CoverLetter.pdf',cover]]);
  assert.deepEqual(post.fields.map(f=>[f.name,f.filled]),[['full_name',true],['email',true],['phone',true]]);
}
test('(a) one page: one POST with the approved résumé and cover, completed with a confirmation picture',async t=>{
  const r=await attempt(t,'a');
  assert.equal(r.answer.outcome,'completed',r.answer.data.reason);assert.equal(r.posts.length,1);sameDocuments(r.posts[0],r.resume,r.cover);
  assert.deepEqual(r.asks.map(a=>a.kind),['submit']);assert.ok(r.artifacts.includes('confirmation.png'));
});
test('(b) Continue, then Submit: the same single POST after Continue',async t=>{
  const r=await attempt(t,'b');
  assert.equal(r.answer.outcome,'completed',r.answer.data.reason);assert.deepEqual(r.asks.map(a=>a.kind),['continue','submit']);
  assert.deepEqual(r.reports.map(p=>p.result),['advanced','confirmed']);assert.equal(r.posts.length,1);sameDocuments(r.posts[0],r.resume,r.cover);
});
test('(c) Apply, then a sign-in wall: needs you, zero POSTs, the password never touched',async t=>{
  const r=await attempt(t,'c');
  assert.equal(r.answer.outcome,'needs_review');assert.equal(r.answer.data.status,'needs_you');assert.equal(r.posts.length,0);
  assert.deepEqual(r.asks.map(a=>a.kind),['open']);assert.match(r.answer.data.reason,/application form/);assert.deepEqual(r.reports.map(p=>p.result),['advanced']);
});
