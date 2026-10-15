/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual native HTTP codecs and declared transfer tools with editable remaps and independent original grants.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startBundleHttpFixture} from './bundle-http-fixture.mjs';
import {readProject} from '../tools/native-json.mjs';
const exec=promisify(execFile),key=()=>randomUUID(),sha=b=>createHash('sha256').update(b).digest('hex');
const root=resolve(import.meta.dirname,'..'),definition=resolve(root,'oshal-app.yaml'),binary='/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture';
let http,tools,report;
before(async()=>{http=await startBundleHttpFixture();const yaml=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('js-yaml');tools=yaml.load(await readFile(definition,'utf8')).tools;report=JSON.parse((await exec(binary,['--package-contract',definition])).stdout);});
after(async()=>{await http?.close();});
async function call(path,options={},status=200){const result=await http.native.call(path,options);assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
async function tool(name,input,actor='alice',status=200){const declared=tools.find(t=>t.name===name);assert.ok(declared);await exec(binary,['--tool-input',definition,name,JSON.stringify(input)]);const [method,path]=declared.executor.apiEndpoint.split(' ');return call(path.replaceAll(/\{input\.([a-zA-Z]+)\}/g,(_,k)=>encodeURIComponent(input[k])).slice('/api/motion-studio'.length),{method,body:method==='GET'?{}:input,actor},status);}
async function source(title){let p=readProject((await call('/projects',{method:'POST',body:{title,width:160,height:90,duration:5,frameRate:30,requestKey:key()}})).project);p=readProject((await call('/projects/'+p.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:key(),commands:[{command:'layer.newText',params:{text:'Editable bundle caption',font:'Inter',size:24,fill:'#ff0000'}}]}})).project);return p;}
async function exportBytes(p){const prepared=await tool('motion-export-bundle',{id:p.id,revision:p.revision,requestKey:key()}),chunks=[];for(let offset=0;offset!==null;){const {chunk}=await call('/bundle-exports/'+prepared.transfer.id+'/chunks/'+offset);const bytes=Buffer.from(chunk.dataBase64,'base64');assert.equal(chunk.bytes,prepared.transfer.bytes);assert.equal(sha(bytes),chunk.chunkSha256);assert.ok(Buffer.byteLength(JSON.stringify(chunk))<1500000);chunks.push(bytes);offset=chunk.nextOffset;}return {prepared,bytes:Buffer.concat(chunks)};}

test('eight native bound transfer tools retain exact original grants and approval ceilings',async()=>{
 const names=['motion-export-bundle','motion-begin-bundle-import','motion-append-bundle-chunk','motion-import-bundle','motion-import-transfer-status','motion-export-transfer-status','motion-cancel-bundle-import','motion-cancel-bundle-export'];
 for(const name of names){const item=report.tools.find(t=>t.name===name);assert.equal(item.bound,true);assert.equal(item.mutating,true);assert.equal(item.approvalRequired,!name.endsWith('-status'));assert.deepEqual(item.permissions,['project.view','project.read',name.includes('export')?'project.export':'project.create']);}
 await assert.rejects(exec(binary,['--tool-input',definition,'motion-append-bundle-chunk',JSON.stringify({id:key(),offset:0,dataBase64:'a'.repeat(10925)})]));
 await assert.rejects(exec(binary,['--tool-input',definition,'motion-begin-bundle-import',JSON.stringify({bytes:1,sha256:'a'.repeat(64),requestKey:key(),owner:'bob'})]));
});

test('agent-shaped chunks create an independent editable native copy with bounded receipts and replay',async()=>{
 const p=await source('Agent transferable'),output=await exportBytes(p);let start,imported;
 try{
  const requestKey=key();start=(await tool('motion-begin-bundle-import',{bytes:output.bytes.length,sha256:sha(output.bytes),requestKey},'bob')).transfer;
  for(let offset=0;offset<output.bytes.length;offset+=8192){const input={id:start.id,offset,dataBase64:output.bytes.subarray(offset,offset+8192).toString('base64')};assert.ok(Buffer.byteLength(JSON.stringify(input))<16384);const result=await tool('motion-append-bundle-chunk',input,'bob');assert.ok(Buffer.byteLength(JSON.stringify(result))<60*1024);}
  assert.equal((await tool('motion-import-transfer-status',{id:start.id},'bob')).transfer.received,output.bytes.length);
  const result=await tool('motion-import-bundle',{id:start.id},'bob');imported=result.project;assert.equal(imported.document,undefined);assert.equal((await tool('motion-import-bundle',{id:start.id},'bob')).project.id,imported.id);assert.notEqual(imported.id,p.id);
  const original=await call('/projects/'+p.id+'/revisions/'+p.revision+'/preview/0/auto/160/1'),copy=await call('/projects/'+imported.id+'/revisions/1/preview/0/auto/160/1',{actor:'bob'});assert.equal(copy.png,original.png);
  await call('/projects/'+p.id,{method:'DELETE'});await call('/projects/'+imported.id+'/operations',{actor:'bob',method:'POST',body:{baseRevision:1,requestKey:key(),commands:[{command:'layer.newSolid',params:{name:'Recipient edit'}}]}});
 }finally{if(start)await tool('motion-cancel-bundle-import',{id:start.id},'bob');await tool('motion-cancel-bundle-export',{id:output.prepared.transfer.id});await call('/projects/'+p.id,{method:'DELETE'},200).catch(e=>{if(!e.message.includes('404'))throw e;});if(imported)await call('/projects/'+imported.id,{actor:'bob',method:'DELETE'});}
});

test('native binary upload limits and malformed/replayed agent chunks refuse without advancing offsets',async()=>{
 const bytes=Buffer.alloc(1048576+1,19),start=(await tool('motion-begin-bundle-import',{bytes:bytes.length,sha256:sha(bytes),requestKey:key()})).transfer;
 try{
  await call('/bundle-imports/'+start.id+'/chunks/0',{method:'POST',body:bytes.toString('base64'),bodyEncoding:'base64',headers:{'content-type':'application/octet-stream'}},413);
  for(const dataBase64 of ['bad','YQ','YQ==\n','!!!!'])await call('/bundle-imports/'+start.id+'/chunks',{method:'POST',body:{id:start.id,offset:0,dataBase64}},400);
  await call('/bundle-imports/'+start.id+'/chunks',{method:'POST',body:{id:key(),offset:0,dataBase64:'YQ=='}},400);
  await call('/bundle-imports/'+start.id+'/chunks/0',{method:'POST',body:{owner:'bob'},headers:{'content-type':'application/json'}},400);
  assert.equal((await call('/bundle-imports/'+start.id)).transfer.received,0);
  await call('/bundle-imports/'+start.id+'/chunks/0',{method:'POST',body:bytes.subarray(0,1048576).toString('base64'),bodyEncoding:'base64',headers:{'content-type':'application/octet-stream'}});
  assert.equal((await call('/bundle-imports/'+start.id)).transfer.received,1048576);
  await call('/bundle-imports/'+start.id+'/chunks',{method:'POST',body:{id:start.id,offset:0,dataBase64:Buffer.alloc(512,20).toString('base64')}},409);
 }finally{await tool('motion-cancel-bundle-import',{id:start.id});}
});

test('fresh original role and source checks refuse foreign ids, missing grants and deleted-source downloads',async()=>{
 const p=await source('Original download'),output=await exportBytes(p),id=output.prepared.transfer.id;
 try{
  await call('/bundle-exports/'+id,{actor:'bob'},404);await call('/bundle-exports/'+id+'/chunks/0',{actor:'bob'},404);
  http.native.assign('alice','reader');await call('/bundle-exports/'+id+'/chunks/0',{},403);await call('/bundle-imports',{method:'POST',body:{bad:true}},403);
  http.native.assign('alice','creator');await call('/bundle-exports/'+id+'/chunks/0',{},403);
  http.native.assign('alice','administrator');await call('/projects/'+p.id,{method:'DELETE'});await call('/bundle-exports/'+id+'/chunks/0',{},404);
 }finally{http.native.assign('alice','administrator');await tool('motion-cancel-bundle-export',{id});}
});

test('large real native PNG downloads cross the actual reply codec in complete1MiB envelopes',async()=>{
 const image=await http.native.sharp(randomBytes(1100*1000*3),{raw:{width:1100,height:1000,channels:3}}).png().toBuffer(),form=new FormData();form.append('file',new Blob([image],{type:'image/png'}),'source.png');const req=new Request('http://fixture.invalid/',{method:'POST',body:form});
 const asset=(await call('/assets',{method:'POST',body:Buffer.from(await req.arrayBuffer()).toString('base64'),bodyEncoding:'base64',headers:{'content-type':req.headers.get('content-type')}})).asset;
 let p=await source('Large codec');let output;
 try{p=readProject((await call('/projects/'+p.id+'/operations',{method:'POST',body:{baseRevision:p.revision,requestKey:key(),commands:[{command:'asset.import',params:{assetId:asset.id}}]}})).project);output=await exportBytes(p);assert.ok(output.bytes.length>3*1048576);assert.equal(sha(output.bytes),output.prepared.transfer.sha256);}
 finally{if(output)await tool('motion-cancel-bundle-export',{id:output.prepared.transfer.id});await call('/projects/'+p.id,{method:'DELETE'});await call('/assets/'+asset.id,{method:'DELETE'});}
});

test('actual native SDK grant withdrawal during a disk chunk returns no acknowledgement and rolls back its unpublished tail',async()=>{
 const {lstat}=await import('node:fs/promises'),{join}=await import('node:path'),bytes=Buffer.alloc(1048576,13),start=(await call('/bundle-imports',{method:'POST',body:{bytes:bytes.length,sha256:sha(bytes),requestKey:key()}})).transfer;
 const p=http.native.principal('alice'),owner=sha(JSON.stringify(['motion-studio',p.tenant,p.id,p.issuer,p.subject,'bundle-transfers'])),path=join(http.native.dataDir,'.motion-transfers',owner,start.id+'.data');let withdrawn=false;
 try{
  http.native.beforeIntent(async(actor,name)=>{if(actor==='alice'&&name==='auth.caller'&&!withdrawn&&(await lstat(path)).size>0){withdrawn=true;http.native.deny('alice','project.create');}});
  await call('/bundle-imports/'+start.id+'/chunks/0',{method:'POST',body:bytes.toString('base64'),bodyEncoding:'base64',headers:{'content-type':'application/octet-stream'}},403);assert.equal(withdrawn,true);assert.equal((await lstat(path)).size,0);
  http.native.beforeIntent(null);http.native.allow('alice','project.create');assert.equal((await call('/bundle-imports/'+start.id)).transfer.received,0);
 }finally{http.native.beforeIntent(null);http.native.assign('alice','administrator');await call('/bundle-imports/'+start.id+'/cancel',{method:'POST',body:{}});}
});
