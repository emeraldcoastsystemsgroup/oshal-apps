/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove browser native file-stream commits/aborts and streaming checksum/Blob fallback through actual owned native SDK HTTP.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {resolve} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {startBundleHttpFixture} from './bundle-http-fixture.mjs';
import {BundleClient} from '../tools/bundle-client.mjs';
const {chromium}=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('playwright');
const key=()=>randomUUID(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');let http,server,browser,ended;
before(async()=>{http=await startBundleHttpFixture();server=await chromium.launchServer({headless:true,host:'127.0.0.1'});ended=new Promise(done=>server.process().once('exit',(code,signal)=>done({code,signal})));browser=await chromium.connect(server.wsEndpoint());});
after(async()=>{await server?.close();if(ended)assert.equal((await ended).code,0);await http?.close();});
async function call(path,options={},status=200){const result=await http.native.call(path,options);assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
async function source(){return(await call('/projects',{method:'POST',body:{title:'Streaming native caption',width:160,height:90,duration:5,frameRate:30,requestKey:key()}})).project;}
async function page(t,project){const context=await browser.newContext({viewport:{width:412,height:915}});t.after(()=>context.close());const p=await context.newPage();p.setDefaultTimeout(20000);await p.goto(http.origin+'/api/motion-studio/app?project='+project.id);await p.locator('#status').filter({hasText:'Saved'}).waitFor();return p;}
async function target(p,work){const name='motion-stream-test-'+key();await p.evaluate(async name=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle(name,{create:true}),handle=await dir.getFileHandle('chosen.tar',{create:true}),original=await handle.createWritable();await original.write('preserve existing file');await original.close();window.__streamTarget=handle;window.__pickerCalls=0;window.showSaveFilePicker=async()=>{window.__pickerCalls++;return handle;};},name);
 try{return await work();}finally{await p.evaluate(async name=>{const root=await navigator.storage.getDirectory();await root.removeEntry(name,{recursive:true});delete window.__streamTarget;},name);}}
const fileBytes=p=>p.evaluate(async()=>Array.from(new Uint8Array(await(await window.__streamTarget.getFile()).arrayBuffer())));

test('human Save bundle uses a real native browser writable, verifies digests and commits only the complete archive',async t=>{
 const project=await source(),p=await page(t,project);
 try{await target(p,async()=>{await p.locator('#bundleSaveFile').click();await p.locator('#bundleStatus').filter({hasText:'Verified bundle saved to file'}).waitFor();const id=await p.locator('#bundleReceipt').getAttribute('data-id'),metadata=(await call('/bundle-exports/'+id)).transfer,bytes=Buffer.from(await fileBytes(p));assert.equal(bytes.length,metadata.bytes);assert.equal(sha(bytes),metadata.sha256);assert.equal(await p.evaluate(()=>window.__pickerCalls),1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.locator('#bundleCancel').click();await p.locator('#bundleStatus').filter({hasText:'Transfer cancelled'}).waitFor();});}
 finally{await call('/projects/'+project.id,{method:'DELETE'});}
});

test('corrupt segment, wrong whole-archive digest and source withdrawal abort the real writable and preserve its existing file',async t=>{
 const project=await source(),p=await page(t,project);
 try{for(const failure of ['segment','whole','grant'])await target(p,async()=>{
   const prepared=await call('/projects/'+project.id+'/bundle-exports',{method:'POST',body:{revision:project.revision,requestKey:key()}}),id=prepared.transfer.id;
   await p.route('**/bundle-exports/'+id+'/chunks/0',async route=>{if(failure==='grant'){http.native.deny('alice','project.export');return route.continue();}const response=await route.fetch(),body=await response.json();if(failure==='segment')body.chunk.chunkSha256='0'.repeat(64);if(failure==='whole')body.chunk.sha256='0'.repeat(64);await route.fulfill({response,body:JSON.stringify(body)});});
   const result=await p.evaluate(async({id,failure})=>{const {BundleClient}=await import('/api/motion-studio/ui/bundle-client.mjs'),client=new BundleClient();await client.useExport(id);if(failure==='whole')client.exportRecord.transfer.sha256='0'.repeat(64);const writable=await window.__streamTarget.createWritable({keepExistingData:false});try{await client.download({writable});return {unexpected:true};}catch(error){return {error:error.message};}}, {id,failure});
   assert.ok(result.error);assert.equal(Buffer.from(await fileBytes(p)).toString(),'preserve existing file');http.native.allow('alice','project.export');await call('/bundle-exports/'+id+'/cancel',{method:'POST',body:{}});await p.unroute('**/bundle-exports/'+id+'/chunks/0');
  });}
 finally{http.native.assign('alice','administrator');await call('/projects/'+project.id,{method:'DELETE'});}
});

test('cancelled chunk processing aborts its native file transaction; picker cancellation starts no export',async t=>{
 const project=await source(),p=await page(t,project),prepared=await call('/projects/'+project.id+'/bundle-exports',{method:'POST',body:{revision:project.revision,requestKey:key()}});
 try{await target(p,async()=>{const result=await p.evaluate(async id=>{const {BundleClient}=await import('/api/motion-studio/ui/bundle-client.mjs'),control=new AbortController(),client=new BundleClient(()=>control.abort());await client.useExport(id);const writable=await window.__streamTarget.createWritable();try{await client.download({signal:control.signal,writable});return {unexpected:true};}catch(error){return {name:error.name};}},prepared.transfer.id);assert.equal(result.name,'AbortError');assert.equal(Buffer.from(await fileBytes(p)).toString(),'preserve existing file');});
  const before=http.requests.filter(r=>r.path.endsWith('/bundle-exports')).length;await p.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError');};});await p.locator('#bundleSaveFile').click();await p.locator('#bundleStatus').filter({hasText:'Transfer stopped'}).waitFor();assert.equal(http.requests.filter(r=>r.path.endsWith('/bundle-exports')).length,before);
 }finally{await call('/bundle-exports/'+prepared.transfer.id+'/cancel',{method:'POST',body:{}});await call('/projects/'+project.id,{method:'DELETE'});}
});

test('upload never asks for a whole-file buffer and Blob fallback hashes the original byte chunks',async t=>{
 const project=await source(),p=await page(t,project),prepared=await call('/projects/'+project.id+'/bundle-exports',{method:'POST',body:{revision:project.revision,requestKey:key()}});
 try{const output=await p.evaluate(async id=>{const {BundleClient}=await import('/api/motion-studio/ui/bundle-client.mjs'),client=new BundleClient();await client.useExport(id);const blob=await client.download();let whole=0,largest=0;const file={size:blob.size,arrayBuffer(){whole++;throw new Error('whole-file input forbidden');},slice(start,end){largest=Math.max(largest,end-start);return blob.slice(start,end);}};const receipt=await client.upload(file,'Actual streamed import');const project=await client.finish();await client.cancel('import');return{whole,largest,receipt,project};},prepared.transfer.id);assert.equal(output.whole,0);assert.ok(output.largest<=1048576);assert.equal(output.receipt.sha256,prepared.transfer.sha256);assert.equal(output.project.revision,1);await call('/projects/'+output.project.id,{method:'DELETE'});}
 finally{await call('/bundle-exports/'+prepared.transfer.id+'/cancel',{method:'POST',body:{}});await call('/projects/'+project.id,{method:'DELETE'});}
});

test('a missing export receipt aborts an already opened sink instead of leaving a writable transaction',async()=>{
 let aborted=0,closed=0;const writable={async write(){throw new Error('unexpected write');},async close(){closed++;},async abort(){aborted++;}};
 await assert.rejects(new BundleClient().download({writable}),/Prepare an export first/);assert.equal(aborted,1);assert.equal(closed,0);
});
