/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove full agent-native value replacement, exact bounded retries, fresh source authority and private stage integrity.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {resolve,join} from 'node:path';
import {readFile,writeFile,lstat,open,link,unlink,symlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {startBundleHttpFixture} from './bundle-http-fixture.mjs';import {readProject,stringifyNative} from '../tools/native-json.mjs';
const exec=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex'),key=()=>randomUUID();let http,browser,server,ended;
before(async()=>{http=await startBundleHttpFixture();const {chromium}=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('playwright');server=await chromium.launchServer({headless:true,host:'127.0.0.1'});ended=new Promise(done=>server.process().once('exit',(code,signal)=>done({code,signal})));browser=await chromium.connect(server.wsEndpoint());});
after(async()=>{await server?.close();if(ended)assert.equal((await ended).code,0);await http?.close();});
async function call(path,options={},status=200){const r=await http.native.call(path,options);assert.equal(r.status,status,stringifyNative(r.body));return r.body;}
const comp=p=>Object.values(p.document.items).find(i=>i.kind.type==='Comp'),layer=p=>comp(p).kind.layers[0],effect=p=>layer(p).props.children.find(g=>g.match==='effects').children[0],prop=p=>effect(p).children.find(p=>p.match==='lut');
async function seed(){let p=readProject((await call('/projects',{method:'POST',body:{title:'Atomic agent value',width:160,height:90,duration:5,frameRate:30,requestKey:key()}})).project);return edit(p,[{command:'layer.newSolid',params:{name:'Plane',width:40,height:20,color:'#ffffff'}},{command:'layer.select',params:{layers:['Plane']}},{command:'effect.apply',params:{effect:'ec.utility.applylut'}}]);}
async function edit(p,commands){return readProject((await call('/projects/'+p.id+'/operations',{method:'POST',body:{baseRevision:p.revision,requestKey:key(),commandsJson:stringifyNative(commands)}})).project);}
const target=p=>({project:p.id,revision:p.revision,compId:String(comp(p).id),layer:String(layer(p).id),effect:String(effect(p).uid),prop:String(prop(p).uid),compTimeTicks:'0'});
async function begin(p,bytes,extra={},status=200,actor='alice'){return (await call('/value-uploads',{method:'POST',actor,body:{...target(p),bytes:bytes.length,sha256:sha(bytes),requestKey:key(),...extra}},status)).transfer;}
const status=async(id,actor='alice',expected=200)=>(await call('/value-uploads/'+id,{actor},expected)).transfer;
async function append(id,offset,bytes,expected=200,extra={}){const body={id,offset,dataBase64:bytes.toString('base64'),...extra};assert.ok(Buffer.byteLength(JSON.stringify(body))<16384);return (await call('/value-uploads/'+id+'/chunks',{method:'POST',body},expected)).transfer;}
const finish=async(id,expected=200)=>(await call('/value-uploads/'+id+'/finish',{method:'POST',body:{id}},expected));
const cancel=async(id)=>call('/value-uploads/'+id+'/cancel',{method:'POST',body:{id}});
async function upload(p,bytes,extra={}){const started=await begin(p,bytes,extra);for(let n=0;n<bytes.length;n+=8192)await append(started.id,n,bytes.subarray(n,n+8192));return started;}
function paths(id){const p=http.native.principal('alice'),owner=sha(JSON.stringify(['motion-studio',p.tenant,p.id,p.issuer,p.subject,'value-transfers']));const base=join(http.native.dataDir,'.motion-value-transfers',owner);return{base,data:join(base,id+'.data'),meta:join(base,id+'.json')};}
const lut='# exact native value\nLUT_1D_SIZE 2\n1 0 0\n1 0 0\n';

test('full Unicode value uploads through actual bounded agent arguments, atomically saves once and reopens editable for a human',async t=>{
 let p=await seed(),staged;try{
 const before=p.revision,value=('# '+ 'x'.repeat(30)+'😀\n').repeat(45000)+lut,bytes=Buffer.from(value),requestKey=key();staged=await begin(p,bytes,{requestKey});assert.equal(staged.received,0);assert.equal((await begin(p,bytes,{requestKey})).id,staged.id);
 for(let n=0;n<bytes.length;n+=8192){const part=bytes.subarray(n,n+8192);const receipt=await append(staged.id,n,part);assert.equal(receipt.received,n+part.length);if(n===0)assert.equal((await append(staged.id,0,part)).received,part.length);}
 assert.equal(readProject((await call('/projects/'+p.id)).project).revision,before);assert.equal((await status(staged.id)).received,bytes.length);const complete=await finish(staged.id);assert.equal(complete.transfer.state,'complete');assert.equal(complete.project.revision,before+1);assert.ok(Buffer.byteLength(stringifyNative(complete))<60*1024);assert.equal((await finish(staged.id)).project.revision,before+1);
 p=readProject((await call('/projects/'+p.id)).project);assert.equal(prop(p).value.v,value);assert.equal(p.revision,before+1);const frame=await call('/projects/'+p.id+'/revisions/'+p.revision+'/preview/0/auto/160/1'),{data,info}=await http.native.sharp(Buffer.from(frame.png,'base64')).raw().toBuffer({resolveWithObject:true});assert.deepEqual([...data.subarray((45*info.width+80)*info.channels,(45*info.width+80)*info.channels+4)],[255,0,0,255]);
 const ctx=await browser.newContext({viewport:{width:412,height:915}});t.after(()=>ctx.close());const page=await ctx.newPage();page.setDefaultTimeout(20000);await page.goto(http.origin+'/api/motion-studio/app?project='+p.id);await page.locator('#effectStatus').filter({hasText:'Native effect values'}).waitFor();assert.equal(await page.getByLabel('LUT',{exact:true}).inputValue(),value.slice(0,4096));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#undo').click();await page.locator('#revision').filter({hasText:'revision '+(p.revision+1)}).waitFor();await page.locator('#status').filter({hasText:'Saved'}).waitFor();await page.getByLabel('LUT',{exact:true}).waitFor();assert.equal(await page.getByLabel('LUT',{exact:true}).inputValue(),'');await ctx.close();
 }finally{if(staged)await cancel(staged.id);await call('/projects/'+p.id,{method:'DELETE'});}
});

test('declared value tools retain approval and actual mutation grants; forbidden source/type/owner/Reader/chunks never publish',async()=>{
 let p=await seed(),staged;try{
 for(const name of ['motion-begin-value-upload','motion-append-value-chunk','motion-finish-value-upload','motion-cancel-value-upload']){const tool=http.native.contract.tools.find(t=>t.name===name);assert.equal(tool.bound,true);assert.equal(tool.mutating,true);assert.equal(tool.approvalRequired,true);assert.deepEqual(tool.permissions,['project.view','project.read','project.change']);}
 const metadata=http.native.contract.tools.find(t=>t.name==='motion-value-upload-status');assert.equal(metadata.mutating,true);assert.equal(metadata.approvalRequired,false);assert.equal(metadata.method,'GET');
 const bytes=Buffer.from(lut);await begin(p,bytes,{},404,'bob');await begin(p,bytes,{owner:'bob'},400);await begin(p,bytes,{prop:'999999'},400);http.native.assign('alice','reader');await begin(p,bytes,{},403);http.native.assign('alice','administrator');
 staged=await begin(p,bytes);await status(staged.id,'bob',404);await append(staged.id,1,bytes,409);await append(staged.id,0,bytes.subarray(0,5));await append(staged.id,0,Buffer.from('wrong'),409);await append(staged.id,5,bytes.subarray(5));await finish(staged.id);assert.equal(readProject((await call('/projects/'+p.id)).project).revision,p.revision+1);
 const input={id:staged.id,offset:0,dataBase64:Buffer.alloc(8192,7).toString('base64')};await exec(process.env.MOTION_NATIVE_BINARY||'/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture',['--tool-input',http.native.definition,'motion-append-value-chunk',JSON.stringify(input)]);await assert.rejects(exec(process.env.MOTION_NATIVE_BINARY||'/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture',['--tool-input',http.native.definition,'motion-append-value-chunk',JSON.stringify({...input,owner:'bob'})]));
 }finally{http.native.assign('alice','administrator');if(staged)await cancel(staged.id);await call('/projects/'+p.id,{method:'DELETE'});}
});

test('withdrawn read/change or deleted pinned source stops bytes and rolls back only unacknowledged tails',async()=>{
 let p=await seed(),staged,deleted=false;try{
 const bytes=Buffer.from(lut);staged=await begin(p,bytes);const path=paths(staged.id).data;let tripped=false;
 http.native.beforeIntent(async(actor,name)=>{if(actor==='alice'&&name==='auth.caller'&&!tripped&&(await lstat(path)).size>0){tripped=true;http.native.deny('alice','project.change');}});await append(staged.id,0,bytes,403);assert.equal(tripped,true);assert.equal((await lstat(path)).size,0);http.native.beforeIntent(null);http.native.allow('alice','project.change');assert.equal((await status(staged.id)).received,0);
 http.native.deny('alice','project.read');await status(staged.id,'alice',403);http.native.allow('alice','project.read');await append(staged.id,0,bytes);await call('/projects/'+p.id,{method:'DELETE'});deleted=true;await finish(staged.id,404);await status(staged.id,'alice',404);await cancel(staged.id);staged=null;
 }finally{http.native.beforeIntent(null);http.native.assign('alice','administrator');http.native.allow('alice','project.change');http.native.allow('alice','project.read');if(staged)await cancel(staged.id);if(!deleted)await call('/projects/'+p.id,{method:'DELETE'});}
});

test('corrupt digest/UTF8, stale revisions and unsafe private links cannot publish a value',async()=>{
 let p=await seed(),staged;try{
 const bytes=Buffer.from(lut);staged=await upload(p,bytes,{sha256:'0'.repeat(64)});await finish(staged.id,400);assert.equal(readProject((await call('/projects/'+p.id)).project).revision,p.revision);await cancel(staged.id);
 staged=await upload(p,Buffer.from([255]));await finish(staged.id,400);await cancel(staged.id);staged=await upload(p,bytes);const path=paths(staged.id).data,outside=path+'.outside';await link(path,outside);await finish(staged.id,503);await unlink(outside);
 const old=p;p=await edit(p,[{command:'layer.rename',params:{layer:layer(p).id,name:'New source revision'}}]);await finish(staged.id,409);assert.equal(readProject((await call('/projects/'+p.id)).project).revision,p.revision);assert.equal((await status(staged.id)).target.revision,old.revision);
 }finally{if(staged)await cancel(staged.id);await call('/projects/'+p.id,{method:'DELETE'});}
});

test('lost native COMMIT reply retains staging and recovers exactly one revision under the same key',async()=>{
 let p=await seed(),staged;try{
 staged=await upload(p,Buffer.from(lut));let written=false,lost=false;http.native.onSql((actor,args)=>{if(actor==='alice'&&/^INSERT INTO motion_requests/.test(args.text))written=true;if(actor==='alice'&&written&&args.transaction==='commit'&&!lost){lost=true;throw new Error('fixture_value_commit_reply_lost');}});
 await finish(staged.id,503);assert.equal(lost,true);http.native.onSql(null);assert.equal((await status(staged.id)).state,'uploading');const done=await finish(staged.id);assert.equal(done.project.revision,p.revision+1);assert.equal((await finish(staged.id)).project.revision,p.revision+1);assert.equal(readProject((await call('/projects/'+p.id)).project).revision,p.revision+1);
 }finally{http.native.onSql(null);if(staged)await cancel(staged.id);await call('/projects/'+p.id,{method:'DELETE'});}
});

test('incomplete, expired, forged metadata and symlinks refuse; UTF8 BOM bytes remain exact and cancellation preserves data',async()=>{
 let p=await seed(),staged;try{
 const bytes=Buffer.from('\ufeff'+lut);staged=await begin(p,bytes);await finish(staged.id,409);assert.equal(readProject((await call('/projects/'+p.id)).project).revision,p.revision);
 const path=paths(staged.id),original=await readFile(path.meta),bad={...JSON.parse(original),owner:'bob'};await writeFile(path.meta,JSON.stringify(bad),{mode:0o600});await status(staged.id,'alice',503);await writeFile(path.meta,original,{mode:0o600});
 const expired=JSON.parse(original);expired.created=Date.now()-3600001;expired.expires=expired.created+3600000;await writeFile(path.meta,JSON.stringify(expired),{mode:0o600});await status(staged.id,'alice',410);await writeFile(path.meta,original,{mode:0o600});
 const outside=path.data+'.outside';await writeFile(outside,Buffer.alloc(0),{mode:0o600});await unlink(path.data);await symlink(outside,path.data);await append(staged.id,0,bytes,503);await unlink(path.data);await writeFile(path.data,Buffer.alloc(0),{mode:0o600});await unlink(outside);
 await append(staged.id,0,bytes);const done=await finish(staged.id);p=readProject((await call('/projects/'+p.id)).project);assert.equal(prop(p).value.v,'\ufeff'+lut);assert.equal(sha(Buffer.from(prop(p).value.v)),sha(bytes));await cancel(staged.id);staged=null;assert.equal(readProject((await call('/projects/'+p.id)).project).revision,done.project.revision);
 }finally{if(staged)await cancel(staged.id);await call('/projects/'+p.id,{method:'DELETE'});}
});
