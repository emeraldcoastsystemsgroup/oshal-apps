/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual human portable workflows through genuine native runner/SQL replies, including source isolation and complete large libraries.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,lstat,writeFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {startBundleHttpFixture} from './bundle-http-fixture.mjs';
import {MotionProjectStore,LIMITS,MotionError} from '../routes/project-store.mjs';
import {MotionOwnedBlobs} from '../routes/owned-blobs.mjs';
import {motionEngine} from '../routes/engine-client.mjs';
import {readProject} from '../tools/native-json.mjs';
const {chromium}=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('playwright');
const key=()=>randomUUID(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let http,server,browser,dir,ended;
before(async()=>{http=await startBundleHttpFixture();dir=await mkdtemp(join(tmpdir(),'motion-human-bundles-'));server=await chromium.launchServer({headless:true,host:'127.0.0.1'});ended=new Promise(done=>server.process().once('exit',(code,signal)=>done({code,signal})));browser=await chromium.connect(server.wsEndpoint());});
after(async()=>{await server?.close();if(ended)assert.equal((await ended).code,0);await http?.close();if(dir)await rm(dir,{recursive:true,force:true});});
async function call(path,options={},status=200){const result=await http.native.call(path,options);assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
async function page(t,actor='alice',query='') {const context=await browser.newContext({acceptDownloads:true,viewport:{width:412,height:915},extraHTTPHeaders:{'x-fixture-user':actor}});t.after(()=>context.close());await context.route('**/*',r=>new URL(r.request().url()).origin===http.origin?r.continue():r.abort());const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(20000);await p.goto(http.origin+'/api/motion-studio/app'+query);await p.locator('#status').filter({hasText:query.includes('project=')?'Saved':'Ready'}).waitFor();return {p,context,errors};}
async function seed(title,{photo=true}={}){let p=readProject((await call('/projects',{method:'POST',body:{title,width:160,height:90,duration:5,frameRate:30,requestKey:key()}})).project);p=readProject((await call('/projects/'+p.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:key(),commands:[{command:'layer.newText',params:{name:'Caption',text:'Editable bundle',font:'Inter',size:24,fill:'#ff0000'}}]}})).project);let asset;if(photo){const bytes=await http.native.sharp({create:{width:16,height:8,channels:4,background:{r:255,g:0,b:0,alpha:.5}}}).png().toBuffer(),form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'Owned photo.png');const req=new Request('http://fixture.invalid/',{method:'POST',body:form});asset=(await call('/assets',{method:'POST',body:Buffer.from(await req.arrayBuffer()).toString('base64'),bodyEncoding:'base64',headers:{'content-type':req.headers.get('content-type')}})).asset;p=readProject((await call('/projects/'+p.id+'/operations',{method:'POST',body:{baseRevision:p.revision,requestKey:key(),commands:[{command:'asset.import',params:{assetId:asset.id,name:'Owned photo'}},{command:'layer.addMask',params:{layer:'#1',shape:'rect',rect:[0,0,8,8]}}]}})).project);}return {project:p,asset};}
async function download(p,button='#bundleExport',timeout=60000){const event=p.waitForEvent('download',{timeout}),refusal=p.locator('#error').waitFor({state:'visible',timeout}).then(async()=>{throw new Error(await p.locator('#error').innerText());});const result=Promise.race([event,refusal]);result.catch(()=>{});await p.locator(button).click();const d=await result,path=join(dir,key()+'.motionbundle.tar');await d.saveAs(path);assert.equal(await d.failure(),null);await p.locator('#bundleStatus').filter({hasText:'Verified bundle downloaded'}).waitFor();return path;}
async function cancelled(p){await p.locator('#bundleCancel').click();await p.locator('#bundleStatus').filter({hasText:'Transfer cancelled'}).waitFor();}

test('human native caption/masked-photo export imports for another owner, reopens and remains manually editable',async t=>{
 const {project,asset}=await seed('Human original'),alice=await page(t,'alice','?project='+project.id),path=await download(alice.p),bytes=await readFile(path);
 assert.equal(sha(bytes),(await call('/bundle-exports/'+await alice.p.locator('#bundleReceipt').getAttribute('data-id'))).transfer.sha256);
 const bob=await page(t,'bob');await bob.p.locator('#importBundle [name=title]').fill('Human recipient');await bob.p.locator('#importBundle [name=bundle]').setInputFiles(path);await bob.p.locator('#bundleImport').click();await bob.p.locator('#bundleStatus').filter({hasText:'Imported editable composition'}).waitFor();
 const id=await bob.p.locator('#projects').inputValue(),copy=readProject((await call('/projects/'+id,{actor:'bob'})).project);assert.notEqual(id,project.id);assert.notEqual(copy.assets[0],asset.id);
 assert.equal((await call('/projects/'+id+'/revisions/1/preview/0/auto/160/1',{actor:'bob'})).png,(await call('/projects/'+project.id+'/revisions/'+project.revision+'/preview/0/auto/160/1')).png);
 await call('/projects/'+project.id,{method:'DELETE'});await call('/assets/'+asset.id,{method:'DELETE'});await bob.p.reload();await bob.p.locator('#status').filter({hasText:'Ready'}).waitFor();await bob.p.locator('#projects').selectOption(id);await bob.p.locator('#revision').filter({hasText:'revision 1'}).waitFor();
 await bob.p.locator('#transform [name=opacity]').fill('25');await bob.p.locator('#transform button').click();await bob.p.locator('#revision').filter({hasText:'revision 2'}).waitFor();assert.notEqual((await call('/projects/'+id+'/revisions/2/preview/0/auto/160/1',{actor:'bob'})).png,(await call('/projects/'+id+'/revisions/1/preview/0/auto/160/1',{actor:'bob'})).png);
 assert.equal(await bob.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await bob.p.screenshot({path:'/tmp/oshal-motion-portable-workspace-review.png',fullPage:true});assert.deepEqual(alice.errors,[]);assert.deepEqual(bob.errors,[]);
 await cancelled(alice.p);await call('/projects/'+id,{actor:'bob',method:'DELETE'});for(const aid of copy.assets)await call('/assets/'+aid,{actor:'bob',method:'DELETE'});
});

test('human upload receipt lets the original agent finish one editable import without placing file bytes in chat',async t=>{
 const {project}=await seed('Human to agent',{photo:false}),alice=await page(t,'alice','?project='+project.id),path=await download(alice.p),bob=await page(t,'bob');
 await bob.p.locator('#importBundle [name=bundle]').setInputFiles(path);await bob.p.locator('#bundleStage').click();await bob.p.locator('#bundleStatus').filter({hasText:'Uploaded. Ask the agent'}).waitFor();const id=await bob.p.locator('#bundleReceipt').getAttribute('data-id');
 const result=await call('/bundle-imports/'+id+'/finish',{actor:'bob',method:'POST',body:{id}});assert.equal(result.transfer.state,'complete');assert.equal((await call('/bundle-imports/'+id+'/finish',{actor:'bob',method:'POST',body:{id}})).project.id,result.project.id);
 await cancelled(bob.p);assert.equal((await call('/projects/'+result.project.id,{actor:'bob'})).project.id,result.project.id);await cancelled(alice.p);await call('/projects/'+project.id,{method:'DELETE'});await call('/projects/'+result.project.id,{actor:'bob',method:'DELETE'});assert.deepEqual(bob.errors,[]);
});

test('agent-prepared protected link uses actual source checks and human verified download controls',async t=>{
 const {project}=await seed('Agent prepared',{photo:false}),prepared=(await call('/projects/'+project.id+'/bundle-exports',{method:'POST',body:{revision:project.revision,requestKey:key()}}));
 const alice=await page(t,'alice','?bundleTransfer='+prepared.transfer.id);await alice.p.locator('#bundleStatus').filter({hasText:'Prepared bundle ready'}).waitFor();const path=await download(alice.p,'#bundleDownload');assert.equal(sha(await readFile(path)),prepared.transfer.sha256);
 const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-user':'bob'}});t.after(()=>context.close());const p=await context.newPage();await p.goto(http.origin+prepared.openUrl);await p.locator('#error').filter({hasText:'motion_transfer_not_found'}).waitFor();assert.equal(await p.locator('#bundleDownload').isVisible(),false);
 await cancelled(alice.p);await call('/projects/'+project.id,{method:'DELETE'});assert.deepEqual(alice.errors,[]);
});

test('actual settled upload reply loss retries exact bytes; Reader controls and revoked download publish no file',async t=>{
 const {project}=await seed('Lost upload',{photo:false}),alice=await page(t,'alice','?project='+project.id),path=await download(alice.p),bob=await page(t,'bob');let lost=false;
 await bob.p.route('**/bundle-imports/*/chunks/0',async route=>{if(lost)return route.continue();lost=true;await route.fetch();await route.abort('failed');});await bob.p.locator('#importBundle [name=bundle]').setInputFiles(path);await bob.p.locator('#bundleStage').click();await bob.p.locator('#bundleStatus').filter({hasText:'Uploaded. Ask the agent'}).waitFor();assert.equal(lost,true);const id=await bob.p.locator('#bundleReceipt').getAttribute('data-id');assert.equal((await call('/bundle-imports/'+id,{actor:'bob'})).transfer.received,(await lstat(path)).size);await cancelled(bob.p);
 http.native.assign('alice','reader');const reader=await page(t,'alice','?project='+project.id);for(const selector of ['#bundleImport','#bundleStage','#bundleExport'])assert.equal(await reader.p.locator(selector).isDisabled(),true);http.native.assign('alice','administrator');
 let withdraw=false,downloads=0;alice.p.on('download',()=>downloads++);await alice.p.route('**/bundle-exports/*/chunks/0',async route=>{if(!withdraw){withdraw=true;http.native.deny('alice','project.export');}await route.continue();});await alice.p.locator('#bundleExport').click();await alice.p.locator('#error').filter({hasText:'motion_permission_denied'}).waitFor();assert.equal(downloads,0);assert.equal(withdraw,true);http.native.allow('alice','project.export');await cancelled(alice.p);await call('/projects/'+project.id,{method:'DELETE'});assert.deepEqual(bob.errors,[]);
});

async function browserRss(){
 const root=server.process().pid,queue=[[root,null]];let sum=0;
 while(queue.length){const[pid,parent]=queue.shift();try{const status=await readFile('/proc/'+pid+'/status','utf8');if(parent!==null&&Number(/^PPid:\s+(\d+)/m.exec(status)?.[1])!==parent)continue;sum+=Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]||0);const children=(await readFile('/proc/'+pid+'/task/'+pid+'/children','utf8')).trim();for(const child of children.split(/\s+/).filter(Boolean))queue.push([Number(child),pid]);}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}}
 return sum;
}
test('full human portable library retains64actual near4MiB PNGs through native export, upload and atomic recipient import',async t=>{
 // Cardinality is seeded through the genuine native SDK store, original auth.caller and real
 // raster/model validators. The human path then uses actual production routes/bridge/UI.
 const ctx=http.native.service('alice');t.after(()=>ctx.pool.drain());let store;
 store=new MotionProjectStore(ctx,{blobs:new MotionOwnedBlobs(ctx,http.native.dataDir),revisionBlobs:new MotionOwnedBlobs(ctx,http.native.dataDir,{purpose:'revision'}),decodeRaster:async bytes=>{try{const{data,info}=await http.native.sharp(bytes,{limitInputPixels:LIMITS.pixels,failOn:'error'}).png().toBuffer({resolveWithObject:true});return{bytes:data,type:'image/png',width:info.width,height:info.height};}catch{throw new MotionError(400,'motion_invalid_raster');}},validateDocument:async document=>(await motionEngine(ctx,{op:'inspect',document})).document});
 const image=await http.native.sharp(randomBytes(1180*1180*3),{raw:{width:1180,height:1180,channels:3}}).png().toBuffer();assert.ok(image.length>4*1024*1024-20000&&image.length<=LIMITS.imageBytes);const ids=[];
 for(let n=0;n<64;n++)ids.push((await store.uploadAsset({bytes:image})).id);
 const {project}=await seed('Complete human library',{photo:false});const source=await store.save(project.id,{title:project.title,document:project.document,assets:ids,baseRevision:project.revision,requestKey:key()});
 let browserPeakKiB=0,sampling=false;const sample=async()=>{if(sampling)return;sampling=true;try{browserPeakKiB=Math.max(browserPeakKiB,await browserRss());}finally{sampling=false;}};const sampler=setInterval(()=>sample().catch(()=>{}),100);t.after(()=>clearInterval(sampler));await sample();
 const alice=await page(t,'alice','?project='+source.id);let started=Date.now(),path;
 const streamSave=process.env.MOTION_TEST_STREAM_SAVE==='1';
 if(streamSave){
  await alice.p.evaluate(async()=>{const root=await navigator.storage.getDirectory(),file=await root.getFileHandle('full-library-test.tar',{create:true});window.__fullStreamFile=file;window.showSaveFilePicker=async()=>file;});
  await alice.p.locator('#bundleSaveFile').click();await alice.p.locator('#bundleStatus').filter({hasText:'Verified bundle saved to file'}).waitFor({timeout:180000});
  path=join(dir,key()+'.motionbundle.tar');const target=await open(path,'wx',0o600);let received=0;
  try{
   await alice.p.exposeFunction('__fullStreamChunk',async(offset,text)=>{assert.equal(offset,received);const bytes=Buffer.from(text,'base64');assert.ok(bytes.length<=1048576);assert.equal(bytes.toString('base64'),text);await target.writeFile(bytes);received+=bytes.length;});
   await alice.p.evaluate(async()=>{const file=await window.__fullStreamFile.getFile();for(let offset=0;offset<file.size;offset+=1048576){const bytes=new Uint8Array(await file.slice(offset,offset+1048576).arrayBuffer());let text='';for(let n=0;n<bytes.length;n+=8192)text+=String.fromCharCode(...bytes.subarray(n,n+8192));await window.__fullStreamChunk(offset,btoa(text));}});
   await target.sync();
  }finally{await target.close();await alice.p.evaluate(async()=>{await(await navigator.storage.getDirectory()).removeEntry('full-library-test.tar');});}
 }else path=await download(alice.p,'#bundleExport',180000);
 const exportMs=Date.now()-started,size=(await lstat(path)).size;assert.ok(size>255*1024*1024&&size<264*1024*1024);await cancelled(alice.p);
 const bob=await page(t,'bob');await bob.p.locator('#importBundle [name=bundle]').setInputFiles(path);await bob.p.locator('#importBundle [name=title]').fill('Complete recipient library');started=Date.now();await bob.p.locator('#bundleImport').click();await bob.p.locator('#bundleStatus').filter({hasText:'Imported editable composition'}).waitFor({timeout:180000});const importMs=Date.now()-started,id=await bob.p.locator('#projects').inputValue(),copy=readProject((await call('/projects/'+id,{actor:'bob'})).project);assert.equal(copy.assets.length,64);assert.ok(copy.assets.every(a=>!ids.includes(a)));assert.equal((await call('/assets',{actor:'bob'})).assets.length,64);
 assert.equal((await call('/projects/'+id+'/revisions/1/preview/0/auto/160/1',{actor:'bob'})).png,(await call('/projects/'+source.id+'/revisions/'+source.revision+'/preview/0/auto/160/1')).png);
 await writeFile(streamSave?'/tmp/oshal-motion-full-human-stream-save-measurements.json':'/tmp/oshal-motion-full-human-stream-fallback-measurements.json',JSON.stringify({bytes:size,assets:64,sourcePngBytes:image.length,streamSave,pickerSeam:streamSave?'Controlled picker returning real browser native FileSystemFileHandle':'No picker; ordinary verified Blob download',exportMs,importMs,browserPeakRssKiB:browserPeakKiB,browserRssMethod:'Sampled100ms actual owned Chromium process tree VmRSS, not installed/worker memory.',installed:false,admission:'Controlled source/role seams; genuine native SDK/SQL/HTTP/UI and real raster/model validation.'},null,2));
 assert.ok(http.requests.filter(r=>r.path.includes('/chunks/')).every(r=>r.bytes<=1048576));assert.deepEqual(alice.errors,[]);assert.deepEqual(bob.errors,[]);
 await cancelled(bob.p);await store.delete(source.id);for(const aid of ids)await store.deleteAsset(aid);await call('/projects/'+id,{actor:'bob',method:'DELETE'});for(const aid of copy.assets)await call('/assets/'+aid,{actor:'bob',method:'DELETE'});
});
