/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise genuine wide u64 ids/i64 ticks through owned native/PG persistence, editing, exact observations and human file reopen.
 */
import{test,before,after}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{execFile}from'node:child_process';import{promisify}from'node:util';const exec=promisify(execFile);
import{startApplicationFixture,chromium}from'./application-fixture.mjs';import{startNativeSqlFixture}from'./native-sql-fixture.mjs';
import{parseNative,stringifyNative,readProject}from'../tools/native-json.mjs';
let http,native;before(async()=>{http=await startApplicationFixture();native=await startNativeSqlFixture();});after(async()=>{await native?.close();await http?.close();});
async function call(kind,path,{actor='alice',method='GET',body,status=200}={}){
 let response;
 if(kind==='native'){
  if(body instanceof FormData){const packet=new Request('http://fixture.invalid/',{method:'POST',body});response=await native.call(path,{actor,method,body:Buffer.from(await packet.arrayBuffer()).toString('base64'),bodyEncoding:'base64',headers:{'content-type':packet.headers.get('content-type')}});}
  else response=await native.call(path,{actor,method,body});
  if(typeof response.body==='string')response={...response,raw:response.body,body:parseNative(response.body)};
 }else{
  const result=await fetch(http.origin+'/api/motion-studio'+path,{method,headers:{'x-fixture-user':actor,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const raw=await result.text();response={status:result.status,raw,body:parseNative(raw)};
 }
 assert.equal(response.status,status,stringifyNative(response.body));return response;
}
const fresh={title:'Lossless seed',width:320,height:180,frameRate:30,duration:5};
async function wide(kind,base){
 let project=readProject((await call(kind,'/projects',{method:'POST',body:{...fresh,requestKey:randomUUID()}})).body.project);
 project=readProject((await call(kind,'/projects/'+project.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),commands:[{command:'layer.newSolid',params:{name:'Exact red',color:'#ff0000',width:100,height:60}}]}})).body.project);
 const shift=(value,key='')=>{
  if(typeof value==='number'&&['id','item','parent','next_id'].includes(key))return base+BigInt(value);
  if(Array.isArray(value))return value.map(v=>shift(v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shift(v,k)]));return value;
 };
 const document=shift(project.document);document.items=Object.fromEntries(Object.entries(document.items).map(([key,value])=>[String(base+BigInt(key)),value]));
 const composition=Object.values(document.items).find(item=>item.kind.type==='Comp');composition.kind.duration=9007199254740993n;
 return{seed:project,document,comp:composition.id,layer:composition.kind.layers[0].id};
}
function form(document,title='Exact imported'){const value=new FormData();value.append('document',new Blob([stringifyNative(document)],{type:'application/json'}),'exact.ecproj');value.append('title',title);value.append('requestKey',randomUUID());return value;}
for(const kind of ['http','native'])test(kind+': wide native ids/ticks survive import, exact edit, fork, immutable restore and export',async()=>{
 for(const base of [9007199254740992n,18446744073709551400n]){
  const original=await wide(kind,base),reply=(await call(kind,'/projects/import',{method:'POST',body:form(original.document)})).body;
  assert.equal(reply.project.document,undefined);assert.ok(reply.project.documentJson.includes(String(original.comp)));
  let project=readProject(reply.project);assert.equal(project.document.items[String(original.comp)].id,original.comp);assert.equal(project.document.items[String(original.comp)].kind.duration,9007199254740993n);
  const preview=await call(kind,'/preview',{method:'POST',body:{documentJson:stringifyNative(project.document),compId:String(original.comp),time:2.5}});
  const input={baseRevision:1,requestKey:randomUUID(),compId:String(original.comp),commandsJson:stringifyNative([{command:'prop.set',params:{layer:original.layer,path:'transform/rotation',value:30,time:0}}])};
  project=readProject((await call(kind,'/projects/'+project.id+'/operations',{method:'POST',body:input})).body.project);
  assert.equal(project.revision,2);assert.equal(project.document.items[String(original.comp)].kind.layers[0].id,original.layer);assert.equal(project.document.items[String(original.comp)].kind.duration,9007199254740993n);
  if(kind==='native'){
   const exactTool=native.contract.tools.find(tool=>tool.name==='motion-apply-exact-edits');assert.equal(exactTool.bound,true);assert.equal(exactTool.mutating,true);assert.equal(exactTool.approvalRequired,true);
   await exec(process.env.MOTION_NATIVE_BINARY||'/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture',['--tool-input',native.definition,'motion-apply-exact-edits',JSON.stringify({...input,id:project.id,response:'receipt'})]);
   native.assign('alice','reader');
   try{const readOnly=(await call(kind,'/projects/'+project.id+'/revisions/2/preview/2.5/'+original.comp+'/1280/1')).body;assert.ok(readOnly.png);await call(kind,'/projects/'+project.id+'/operations',{method:'POST',body:{...input,baseRevision:2},status:403});}
   finally{native.assign('alice','administrator');}
  }
  const changed=await call(kind,'/preview',{method:'POST',body:{documentJson:stringifyNative(project.document),compId:String(original.comp),time:2.5}});assert.notEqual(changed.body.png,preview.body.png);
  assert.equal((await call(kind,'/projects/'+project.id+'/operations',{method:'POST',body:input})).body.project.revision,2);
  const root=await call(kind,'/projects/'+project.id+'/inspection/2/value/root/0');const items=root.body.children.find(node=>node.name==='items').node;
  const itemPage=(await call(kind,'/projects/'+project.id+'/inspection/2/value/'+items+'/0')).body;const compNode=itemPage.children.find(node=>node.name===String(original.comp)).node;
  const compPage=(await call(kind,'/projects/'+project.id+'/inspection/2/value/'+compNode+'/0')).body;const idNode=compPage.children.find(node=>node.name==='id').node;
  const exact=(await call(kind,'/projects/'+project.id+'/inspection/2/value/'+idNode+'/0')).body;assert.equal(exact.value,String(original.comp));assert.equal(exact.valueEncoding,'decimal-integer');
  const copied=readProject((await call(kind,'/projects/'+project.id+'/fork',{method:'POST',body:{revision:2,requestKey:randomUUID()}})).body.project);assert.deepEqual(copied.document,project.document);
  const restored=readProject((await call(kind,'/projects/'+project.id+'/restore',{method:'POST',body:{revision:1,baseRevision:2,requestKey:randomUUID()}})).body.project);assert.equal(restored.revision,3);assert.deepEqual(restored.document,original.document);
  const exported=await call(kind,'/projects/'+project.id+'/revisions/1/export');assert.deepEqual(exported.body,original.document);assert.ok(exported.raw.includes(String(original.comp)));
  await call(kind,'/projects/'+project.id,{actor:'bob',status:404});
  await call(kind,'/projects/'+project.id+'/operations',{method:'POST',body:{...input,baseRevision:3,compId:'18446744073709551616'},status:400});
  for(const id of [project.id,copied.id,original.seed.id])await call(kind,'/projects/'+id,{method:'DELETE'});
 }
});
test('actual narrow editor imports, renders, edits and exports a wide-id document with exact ticks',async t=>{
 const original=await wide('http',9007199254740992n);let context;const server=await chromium.launchServer({headless:true,host:'127.0.0.1'});t.after(async()=>{await context?.close();await server.close();});
 const browser=await chromium.connect(server.wsEndpoint());context=await browser.newContext({viewport:{width:412,height:915}});await context.route('**/*',route=>new URL(route.request().url()).origin===http.origin?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(http.origin+'/api/motion-studio/app');await page.locator('#status').filter({hasText:'Ready'}).waitFor();
 await page.locator('#importDocument [name=title]').fill('Human wide ids');await page.locator('#importDocument [name=document]').setInputFiles({name:'exact.ecproj',mimeType:'application/json',buffer:Buffer.from(stringifyNative(original.document))});await page.locator('#importDocument button').click();await page.locator('#status').filter({hasText:'Saved'}).waitFor();
 const id=await page.locator('#projects').inputValue();await page.locator('#preview').evaluate(img=>img.decode());assert.equal(await page.locator('#comps').inputValue(),String(original.comp));
 await page.locator('#transform [name=rotation]').fill('30');await page.locator('#transform button').click();await page.locator('#revision').filter({hasText:'revision 2'}).waitFor();await page.locator('#status').filter({hasText:'Saved'}).waitFor();
 const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading,stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);const exported=parseNative(Buffer.concat(parts).toString('utf8'));
 assert.equal(exported.items[String(original.comp)].id,original.comp);assert.equal(exported.items[String(original.comp)].kind.duration,9007199254740993n);
 await page.reload();await page.locator('#status').filter({hasText:'Ready'}).waitFor();await page.locator('#projects').selectOption(id);await page.locator('#status').filter({hasText:'Saved'}).waitFor();assert.equal(await page.locator('#comps').inputValue(),String(original.comp));assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 for(const project of [id,original.seed.id])await call('http','/projects/'+project,{method:'DELETE'});
});
