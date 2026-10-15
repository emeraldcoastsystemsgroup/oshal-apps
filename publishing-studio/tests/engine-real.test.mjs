import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { brochure, brochureImage } from './fixtures/brochure.mjs';
const engine=fileURLToPath(new URL('../engine/worker.py',import.meta.url));
const python=process.env.OSHAL_PUBLISHING_PYTHON;
const typst=process.env.OSHAL_PUBLISHING_TYPST;
assert.ok(python && resolve(python)===python && existsSync(python),'Required actual OSHAL_PUBLISHING_PYTHON from hash-pinned runtime preparation; no skip/fallback.');
assert.ok(typst && resolve(typst)===typst && existsSync(typst),'Required actual OSHAL_PUBLISHING_TYPST from hash-pinned runtime preparation; no skip/fallback.');
function fixture(t) { const root=mkdtempSync(join(tmpdir(),'oshal-publishing-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'assets'));return root; }
function run(root,model,assets=new Map(),name='output') { writeFileSync(join(root,'model.json'),JSON.stringify(model));for(const [id,bytes]of assets)writeFileSync(join(root,'assets',id),bytes);const done=spawnSync(python,[engine,'--typst',typst,'--model',join(root,'model.json'),'--assets',join(root,'assets'),'--output',join(root,name)],{encoding:'utf8',timeout:300_000,maxBuffer:1024*1024});assert.equal(done.error,undefined);assert.ok(done.status===0||done.status===1,done.stderr);const result=JSON.parse(done.stdout);assert.equal(result.ok,done.status===0,done.stderr);return result; }
function decodePPM(bytes){let pos=0;function token(){while(bytes[pos]<=32)pos++;let start=pos;while(bytes[pos]>32)pos++;return bytes.subarray(start,pos).toString();}assert.equal(token(),'P6');const width=Number(token()),height=Number(token());assert.equal(token(),'255');assert.equal(bytes[pos++],10);assert.equal(bytes.length-pos,width*height*3);return{width,height,pixel(x,y){return [...bytes.subarray(pos+(y*width+x)*3,pos+(y*width+x)*3+3)];}};}

test('genuine four-page linked stories, exact boxes, master numbers, fonts, text and final-PDF pixels survive reopen',t=>{
 const root=fixture(t),{model,assets}=brochure();writeFileSync(join(root,'reopen.json'),JSON.stringify(model));const reopened=JSON.parse(readFileSync(join(root,'reopen.json')));assert.deepEqual(reopened,model);
 const result=run(root,reopened,assets);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.receipt.pages,4);assert.equal(result.receipt.modelHashEncoding,'python-json-sort-keys-ascii');assert.deepEqual(result.receipt.stories.map(s=>s.renderedFrames),[4,4]);assert.deepEqual(result.receipt.preflight,{clean:true,issues:[]});
 const pdf=join(root,'output','publication.pdf');const bytes=readFileSync(pdf);assert.equal(bytes.length,result.receipt.outputs[0].bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),result.receipt.outputs[0].sha256);
 const independent=spawnSync(python,['-c',`import json,sys\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1],strict=True)\nassert len(r.pages)==4\nfor n,p in enumerate(r.pages):\n assert list(p.mediabox)==[0,0,474,654]\n assert list(p.trimbox)==[21,21,453,633]\n assert list(p.bleedbox)==[12,12,462,642]\n assert int(p.get('/Rotate',0))==0\n assert 'Publishing Studio - Shared Master' in p.extract_text()\n assert str(n+1) in p.extract_text()\nprint(json.dumps({'pages':len(r.pages)}))`,pdf],{encoding:'utf8',timeout:10_000});assert.equal(independent.status,0,independent.stderr);
 const fonts=spawnSync('/usr/bin/pdffonts',[pdf],{encoding:'utf8',timeout:10_000});assert.equal(fonts.status,0);const lines=fonts.stdout.trim().split('\n').slice(2);assert.ok(lines.length>=3);for(const line of lines){assert.match(line,/LibertinusSerif-/);assert.match(line,/yes\s+yes\s+yes/);}assert.match(fonts.stdout,/BoldItalic/);
 const extracted=spawnSync('/usr/bin/pdftotext',['-layout',pdf,'-'],{encoding:'utf8',timeout:10_000});assert.equal(extracted.status,0);const pages=extracted.stdout.split('\f').filter(p=>p.trim());assert.equal(pages.length,4);for(let i=0;i<4;i++){assert.match(pages[i],/Shared Master/);assert.ok(pages[i].trimEnd().endsWith(String(i+1)));}
 for(const [prefix,count]of [['MAIN',30],['SIDE',32]]){const markers=[...extracted.stdout.matchAll(new RegExp(prefix+'-(\\d{2})','g'))].map(m=>Number(m[1]));assert.deepEqual(markers,Array.from({length:count},(_,i)=>i+1));}
 const ppm=spawnSync('/usr/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','72',pdf,join(root,'independent')],{encoding:'utf8',timeout:10_000});assert.equal(ppm.status,0,ppm.stderr);const image=decodePPM(readFileSync(join(root,'independent.ppm')));assert.equal(image.width,474);assert.equal(image.height,654);assert.deepEqual(image.pixel(380,540),[0,180,40]);for(const [point,expected]of [[[40,560],[210,40,40]],[[120,560],[20,40,210]]]){const actual=image.pixel(...point);assert.ok(actual.every((channel,index)=>Math.abs(channel-expected[index])<=2),'Independent decoder image RGB rounding remains within2; no ICC/color-fidelity claim');}assert.deepEqual(image.pixel(370,530),[255,255,255]);
 // Independent decoder recreates the exact previews from exported bytes.
 const preview=spawnSync('/usr/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','96','-png',pdf,join(root,'same-preview')],{encoding:'utf8',timeout:10_000});assert.equal(preview.status,0);assert.deepEqual(readFileSync(join(root,'same-preview.png')),readFileSync(join(root,'output','preview-1.png')));
 const repeat=run(root,reopened,assets,'repeat');assert.equal(repeat.ok,true);assert.deepEqual(readFileSync(join(root,'repeat','publication.pdf')),bytes,'Fixed renderer timestamp and immutable inputs yield same export after reopen');
});

test('native page flow refuses overset and styled-run unbreakable overflow without a clean output',t=>{
 const root=fixture(t),{model,assets}=brochure();for(const page of model.pages)for(const frame of page.frames)frame.height=20;
 const result=run(root,model,assets);assert.equal(result.ok,false);assert.equal(result.error,'publishing_preflight_failed');assert.ok(result.details.issues.some(i=>i.code==='publishing_text_overflow'));assert.equal(existsSync(join(root,'output')),false);
 const split=brochure().model;split.stories[0].paragraphs=[{style:'body',runs:[{text:'X'.repeat(40)},{text:'X'.repeat(40),style:'emphasis'}]}];const word=run(root,split,assets,'word');assert.equal(word.error,'publishing_text_overflow');assert.equal(existsSync(join(root,'word')),false);
});

test('missing fonts/variants/assets, changed bytes, low DPI, cycles and frame-order/profile violations refuse explicitly',t=>{
 const root=fixture(t);const cases=[
 ['publishing_font_missing',m=>m.characterStyles.emphasis.font='Missing Face'],
 ['publishing_font_variant_missing',m=>m.characterStyles.emphasis.weight=600],
 ['publishing_asset_missing',m=>m.pages[0].objects[0].assetId='missing'],
 ['publishing_link_cycle_or_branch',m=>m.pages[3].frames[0].nextFrame='main1'],
 ['publishing_linked_frame_size_unsupported',m=>m.pages[2].frames[0].width=350],
 ['publishing_reading_order',m=>{m.pages[0].frames[0].nextFrame='main3';m.pages[2].frames[0].nextFrame='main2';m.pages[1].frames[0].nextFrame='main4';}],
 ['publishing_text_profile_unsupported',m=>m.stories[0].paragraphs[0].runs[0].text='unsupported 😀']
 ];for(const [error,mutate]of cases){const {model,assets}=brochure();mutate(model);const result=run(root,model,assets,error);assert.equal(result.error,error,JSON.stringify(result));}
 const {model,assets}=brochure();assets.set('bleedImage',brochureImage(10,10));const changed=run(root,model,assets,'changed');assert.equal(changed.error,'publishing_asset_changed');
 const low=brochure();const small=brochureImage(10,10);low.assets.set('bleedImage',small);Object.assign(low.model.assets[0],{bytes:small.length,sha256:createHash('sha256').update(small).digest('hex')});const result=run(root,low.model,low.assets,'low');assert.equal(result.error,'publishing_preflight_failed');assert.ok(result.details.issues.some(i=>i.code==='publishing_image_resolution'));assert.equal(existsSync(join(root,'low')),false);
});


test('actual framed pure stages bound chunks, reject foreign namespace/replays, render genuine bytes and retire cancelled buffers',async t=>{
 const root=fixture(t),tokens=[],ns='1'.repeat(64),foreign='2'.repeat(64),{model,assets}=brochure();
 const child=spawn(python,[fileURLToPath(new URL('../engine/server.py',import.meta.url))],{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',TMPDIR:root,OSHAL_PUBLISHING_TYPST:typst,PUBLISHING_ENGINE_HOST:'127.0.0.1',PUBLISHING_ENGINE_PORT:'0'},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString().slice(0,2000));const lines=createInterface({input:child.stdout});
 const startup=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Genuine server startup timeout')),10000);lines.once('line',line=>{clearTimeout(timer);done(JSON.parse(line));});child.once('error',reject);child.once('exit',()=>reject(new Error('Genuine server exited '+stderr)));});lines.close();
 async function call(args){return new Promise((done,reject)=>{const socket=createConnection({host:'127.0.0.1',port:startup.port});let raw='',hello;const timer=setTimeout(()=>{socket.destroy();reject(new Error('Bounded stage RPC deadline'));},10000);socket.on('error',error=>{clearTimeout(timer);reject(error);});socket.on('data',block=>{raw+=block;assert.ok(raw.length<1024*1024);for(;;){const nl=raw.indexOf('\n');if(nl<0)break;const value=JSON.parse(raw.slice(0,nl));raw=raw.slice(nl+1);if(!hello){hello=value;assert.deepEqual(hello.bridge,startup.identity);socket.write(JSON.stringify({id:1,cmd:'publishing',args})+'\n');}else{clearTimeout(timer);socket.end();assert.equal(value.buildHash,startup.identity.buildHash);done(value);}}});socket.on('end',()=>{clearTimeout(timer);});});}
 t.after(async()=>{for(const token of tokens)await call({op:'close',namespace:ns,token}).catch(()=>{});child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});});
 const held=[];try{for(let i=0;i<16;i++){const socket=createConnection({host:'127.0.0.1',port:startup.port});held.push(socket);await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Bounded real connection admission')),3000);socket.once('data',bytes=>{clearTimeout(timer);assert.deepEqual(JSON.parse(bytes.toString()).bridge,startup.identity);done();});socket.once('error',reject);});}const overflow=createConnection({host:'127.0.0.1',port:startup.port});held.push(overflow);await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Connection overflow must refuse without queue')),3000);overflow.once('data',()=>reject(new Error('Connection overflow unexpectedly admitted')));overflow.once('error',reject);overflow.once('end',()=>{clearTimeout(timer);done();});});}finally{for(const socket of held)socket.destroy();}await new Promise(r=>setTimeout(r,30));
 const opened=await call({op:'open',namespace:ns,assets:model.assets});assert.equal(opened.ok,true);const token=opened.result.token;tokens.push(token);assert.equal(opened.result.chunkBytes,65536);
 assert.equal((await call({op:'status',namespace:foreign,token})).error,'publishing_stage_missing');assert.equal((await call({op:'close',namespace:foreign,token})).error,'publishing_stage_missing');
 assert.equal((await call({op:'render',namespace:ns,token,model})).error,'publishing_asset_incomplete');
 for(const[id,bytes]of assets)for(let offset=0;offset<bytes.length;offset+=65536){const piece=bytes.subarray(offset,offset+65536),input={op:'write',namespace:ns,token,assetId:id,offset,dataBase64:piece.toString('base64'),sha256:createHash('sha256').update(piece).digest('hex')};assert.equal((await call(input)).ok,true);assert.equal((await call(input)).ok,true,'Exact same-offset bytes are an idempotent transport replay');const forged=Buffer.from(piece);forged[0]^=1;assert.equal((await call({...input,dataBase64:forged.toString('base64'),sha256:createHash('sha256').update(forged).digest('hex')})).error,'publishing_chunk_conflict');}
 assert.equal((await call({op:'render',namespace:ns,token,model})).result.state,'rendering');let ready;const deadline=Date.now()+30000;while(Date.now()<deadline){const status=await call({op:'status',namespace:ns,token});assert.equal(status.ok,true);if(status.result.state==='ready'){ready=status.result;break;}assert.equal(status.result.state,'rendering',JSON.stringify(status));await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Actual native staged render completes');
 const descriptor=ready.receipt.outputs[0],parts=[];for(let offset=0;offset<descriptor.bytes;){const result=await call({op:'read',namespace:ns,token,name:descriptor.name,offset});assert.equal(result.ok,true);const c=result.result,b=Buffer.from(c.dataBase64,'base64');assert.equal(b.length,c.bytes);assert.equal(c.offset,offset);assert.equal(c.totalBytes,descriptor.bytes);assert.equal(c.outputSha256,descriptor.sha256);assert.equal(createHash('sha256').update(b).digest('hex'),c.sha256);assert.equal(c.complete,offset+b.length===descriptor.bytes);assert.equal(c.nextOffset,c.complete?null:offset+b.length);assert.ok(b.length<=65536);parts.push(b);offset+=b.length;}const exported=Buffer.concat(parts);assert.equal(createHash('sha256').update(exported).digest('hex'),descriptor.sha256);assert.equal(exported.subarray(0,5).toString(),'%PDF-');
 assert.equal((await call({op:'read',namespace:ns,token,name:'../model.json',offset:0})).error,'publishing_output_missing');assert.equal((await call({op:'read',namespace:ns,token,name:descriptor.name,offset:1})).error,'publishing_chunk_invalid');
 const second=await call({op:'open',namespace:ns,assets:[]});assert.equal(second.ok,true);tokens.push(second.result.token);assert.equal((await call({op:'open',namespace:ns,assets:[]})).error,'publishing_stage_quota');assert.equal((await call({op:'close',namespace:ns,token:second.result.token})).result.closed,true);assert.equal((await call({op:'status',namespace:ns,token:second.result.token})).error,'publishing_stage_missing');
 assert.equal((await call({op:'close',namespace:ns,token})).result.closed,true);assert.equal((await call({op:'read',namespace:ns,token,name:descriptor.name,offset:0})).error,'publishing_stage_missing');
});

test('actual native producer reply held before publication is retired on cancel and expiry; reservations fail closed',t=>{
 const root=fixture(t),{model,assets}=brochure();writeFileSync(join(root,'model.json'),JSON.stringify(model));for(const[id,bytes]of assets)writeFileSync(join(root,'assets',id),bytes);
 const script=`import asyncio,json,sys,tempfile,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import server
async def main():
 with tempfile.TemporaryDirectory(prefix='publishing-stage-fences-') as root:
  server.ROOT=Path(root)
  ns='1'*64
  model=json.loads(Path(sys.argv[2]).read_text())
  original=asyncio.create_subprocess_exec
  ready=asyncio.Event()
  observed=[]
  class DeliveryPause:
   def __init__(self,child):self.child=child
   @property
   def pid(self):return self.child.pid
   @property
   def returncode(self):return self.child.returncode
   async def wait(self):return await self.child.wait()
   async def communicate(self):
    result=await self.child.communicate()
    actual=json.loads(result[0]);assert self.child.returncode==0 and actual['ok'] is True
    assert actual['receipt']['pages']==4
    observed.append(actual['receipt']['outputs'][0]['sha256'])
    ready.set()
    await asyncio.Event().wait() # named seam: genuine worker reply delivery, no fake rendering
    return result
  async def held(*args,**kwargs):return DeliveryPause(await original(*args,**kwargs))
  asyncio.create_subprocess_exec=held
  for fence in ('cancel','expiry'):
   ready.clear()
   opened=await server.command({'op':'open','namespace':ns,'assets':model['assets']})
   token=opened['token']
   for item in model['assets']:
    data=(Path(sys.argv[3])/item['id']).read_bytes()
    for offset in range(0,len(data),65536):
     piece=data[offset:offset+65536]
     import base64
     await server.command({'op':'write','namespace':ns,'token':token,'assetId':item['id'],'offset':offset,'dataBase64':base64.b64encode(piece).decode(),'sha256':hashlib.sha256(piece).hexdigest()})
   await server.command({'op':'render','namespace':ns,'token':token,'model':model})
   await asyncio.wait_for(ready.wait(),30)
   stage=server.STAGES[token];task=stage['task'];path=stage['path']
   assert stage['state']=='rendering' and (path/'output'/'publication.pdf').read_bytes().startswith(b'%PDF-')
   if fence=='cancel':await server.command({'op':'close','namespace':ns,'token':token})
   else:
    stage['expires']=server.time.monotonic()-1 # named fixture seam: expired private metadata, production TTL unchanged
    await server.sweep()
   assert task.cancelled() and token not in server.STAGES and not path.exists() and server.stored_bytes()==0
   try:await server.command({'op':'status','namespace':ns,'token':token});raise AssertionError('retired stage survived')
   except server.Refusal as e:assert e.code=='publishing_stage_missing'
  asyncio.create_subprocess_exec=original
  tokens=[]
  for n in range(4):tokens.append((await server.command({'op':'open','namespace':str(n+1)*64,'assets':[]}))['token'])
  assert server.stored_bytes()==server.GLOBAL_BYTES
  try:await server.command({'op':'open','namespace':'5'*64,'assets':[]});raise AssertionError('unreserved output admitted')
  except server.Refusal as e:assert e.code=='publishing_stage_quota'
  for token in tokens:await server.remove(token)
  assert server.stored_bytes()==0 and list(server.ROOT.iterdir())==[]
  assert len(observed)==2 and observed[0]==observed[1]
  print(json.dumps({'genuineCompletedWorkers':2,'cancelledDelivery':True,'expiredDelivery':True,'reservedQuota':True}))
asyncio.run(main())`;
 const result=spawnSync(python,['-c',script,fileURLToPath(new URL('../engine/',import.meta.url)),join(root,'model.json'),join(root,'assets')],{env:{...process.env,OSHAL_PUBLISHING_TYPST:typst,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8',timeout:90000,maxBuffer:1024*1024});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{genuineCompletedWorkers:2,cancelledDelivery:true,expiredDelivery:true,reservedQuota:true});
});

test('genuine offline runtime preparation isolates pip targets/config and Python imports inside its new private venv',{timeout:180000},t=>{
 const root=fixture(t),archive=process.env.OSHAL_PUBLISHING_TYPST_ARCHIVE,wheels=process.env.OSHAL_PUBLISHING_WHEEL_DIR;
 assert.ok(archive&&resolve(archive)===archive&&existsSync(archive),'Required OSHAL_PUBLISHING_TYPST_ARCHIVE original hash-pinned archive, no download/fallback');
 assert.ok(wheels&&resolve(wheels)===wheels&&existsSync(wheels),'Required OSHAL_PUBLISHING_WHEEL_DIR original hash-pinned wheel directory, no download/fallback');
 const outside=join(root,'external-sentinel'),injection=join(outside,'module-injection'),runtime=join(root,'prepared');mkdirSync(outside);mkdirSync(injection);mkdirSync(join(outside,'env-temp'));
 writeFileSync(join(outside,'sentinel'),'unchanged owned sentinel\n');writeFileSync(join(injection,'pypdf.py'),'raise RuntimeError("Inherited module path must not supply pypdf")\n');
 const config=join(outside,'pip.conf');writeFileSync(config,`[global]\ntarget = ${join(outside,'config-target')}\nprefix = ${join(outside,'config-prefix')}\ncache-dir = ${join(outside,'config-cache')}\n[install]\nuser = true\n`);
 const snapshot=()=>readdirSync(outside,{recursive:true}).sort().map(name=>{const target=join(outside,name),st=lstatSync(target);return{name,mode:st.mode,bytes:st.isFile()?readFileSync(target).toString('base64'):null};});const before=snapshot();
 const poisoned={...process.env,PIP_TARGET:join(outside,'env-target'),PIP_PREFIX:join(outside,'env-prefix'),PIP_CONFIG_FILE:config,PIP_LOG:join(outside,'env-log'),PIP_CACHE_DIR:join(outside,'env-cache'),PIP_USER:'1',TMPDIR:join(outside,'env-temp'),PYTHONPYCACHEPREFIX:join(outside,'env-pycache'),PYTHONPATH:injection,PYTHONHOME:join(outside,'nonexistent-python-home')};
 // -I protects the initial interpreter too; the preparer itself isolates every owned subprocess.
 const prepared=spawnSync(python,['-I',fileURLToPath(new URL('../engine/prepare-runtime.py',import.meta.url)),'--root',runtime,'--typst-archive',archive,'--wheel-dir',wheels],{env:poisoned,encoding:'utf8',timeout:150000,maxBuffer:1048576});assert.equal(prepared.error,undefined);assert.equal(prepared.status,0,prepared.stderr);const receipt=JSON.parse(prepared.stdout);assert.equal(receipt.pypdfVersion,'6.20.1');assert.equal(receipt.typstVersion,'typst 0.15.1 (9dfd3a08)');assert.equal(lstatSync(runtime).mode&0o777,0o700,'Host runtime root remains private');assert.deepEqual(snapshot(),before,'Inherited pip/config must never write outside the newly owned runtime');
 const verified=spawnSync(receipt.python,['-I','-c',`import json,sys,pypdf\nfrom pathlib import Path\nroot=Path(sys.argv[1]).resolve()\nassert Path(sys.prefix).resolve()==root\nassert Path(pypdf.__file__).resolve().is_relative_to(root)\nassert pypdf.__version__=='6.20.1'\nprint(json.dumps({'owned':True,'version':pypdf.__version__}))`,join(runtime,'python')],{env:poisoned,encoding:'utf8',timeout:10000,maxBuffer:1048576});assert.equal(verified.status,0,verified.stderr);assert.deepEqual(JSON.parse(verified.stdout),{owned:true,version:'6.20.1'});const native=spawnSync(receipt.typst,['--version'],{encoding:'utf8',timeout:10000});assert.equal(native.status,0,native.stderr);assert.equal(native.stdout.trim(),receipt.typstVersion);assert.deepEqual(snapshot(),before);
});
