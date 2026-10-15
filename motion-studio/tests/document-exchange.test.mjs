/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify actual editable file/fork roundtrips and atomic read-plus-create authority over HTTP, native SQL and the human page.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startApplicationFixture,chromium} from './application-fixture.mjs';
import {startNativeSqlFixture} from './native-sql-fixture.mjs';
let http,native;
before(async()=>{http=await startApplicationFixture();native=await startNativeSqlFixture();});
after(async()=>{await native?.close();await http?.close();});
async function request(kind,path,{actor='alice',method='GET',body,status=200}={}){
  let result;
  if(kind==='native'){
    if(body instanceof FormData){const packet=new Request('http://fixture.invalid/',{method:'POST',body});result=await native.call(path,{actor,method,body:Buffer.from(await packet.arrayBuffer()).toString('base64'),bodyEncoding:'base64',headers:{'content-type':packet.headers.get('content-type')}});}
    else result=await native.call(path,{actor,method,body});
  }else{
    const response=await fetch(http.origin+'/api/motion-studio'+path,{method,headers:{'x-fixture-user':actor,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}result={status:response.status,body:value};
  }
  assert.equal(result.status,status,JSON.stringify(result.body));return result.body;
}
function file(bytes,{title='Imported editable copy',requestKey=randomUUID(),extra={}}={}){
  const form=new FormData();form.append('document',new Blob([bytes],{type:'application/json'}),'composition.ecproj');form.append('title',title);form.append('requestKey',requestKey);
  for(const[name,value]of Object.entries(extra))form.append(name,value);return form;
}
const fresh=title=>({title,width:320,height:180,frameRate:30,duration:5,requestKey:randomUUID()});
async function source(kind){
  const image=await http.image(),form=new FormData();form.append('file',new Blob([image],{type:'image/png'}),'photo.png');
  const asset=(await request(kind,'/assets',{method:'POST',body:form})).asset;
  let project=(await request(kind,'/projects',{method:'POST',body:fresh('Original keys and photo')})).project;
  project=(await request(kind,'/projects/'+project.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),commands:[{command:'layer.newSolid',params:{name:'Editable red',color:'#ff0000',width:100,height:60}}]}})).project;
  const comp=Object.values(project.document.items).find(item=>item.kind.type==='Comp'),layer=comp.kind.layers[0].id;
  project=(await request(kind,'/projects/'+project.id+'/operations',{method:'POST',body:{baseRevision:2,requestKey:randomUUID(),comp:comp.id,commands:[{command:'prop.addKey',params:{layer,path:'transform/opacity',time:0,value:0}},{command:'prop.addKey',params:{layer,path:'transform/opacity',time:5,value:100}},{command:'asset.import',params:{assetId:asset.id}}]}})).project;
  const photo=project.document.items[comp.id].kind.layers.find(value=>value.id!==layer).id;
  project=(await request(kind,'/projects/'+project.id+'/operations',{method:'POST',body:{baseRevision:3,requestKey:randomUUID(),comp:comp.id,commands:[{command:'layer.addMask',params:{layer:photo,shape:'rect',rect:[0,0,8,8]}}]}})).project;
  return {project,asset};
}
for(const kind of ['http','native']){
  test(kind+': export/import/fork preserves native editability, immutable snapshots, real pixels and historical photo retention',async()=>{
    const{project:original,asset}=await source(kind),p='/projects/'+original.id;
    const exported=await request(kind,p+'/export');
    // HTTP helper already parses JSON; native runner returns the export representation as text.
    const document=typeof exported==='string'?JSON.parse(exported):exported,bytes=Buffer.from(JSON.stringify(document));
    assert.deepEqual(document,original.document);
    const nonce=randomUUID(),imported=(await request(kind,'/projects/import',{method:'POST',body:file(bytes,{requestKey:nonce})})).project;
    assert.notEqual(imported.id,original.id);assert.equal(imported.revision,1);assert.deepEqual(imported.document,original.document);assert.deepEqual(imported.assets,[asset.id]);
    assert.equal((await request(kind,'/projects/import',{method:'POST',body:file(bytes,{requestKey:nonce})})).project.id,imported.id);
    await request(kind,'/projects/import',{method:'POST',body:file(bytes,{requestKey:nonce,title:'Different intent'}),status:409});
    const input={revision:original.revision,title:'Pinned fork',requestKey:randomUUID(),response:'receipt'};
    const fork=(await request(kind,p+'/fork',{method:'POST',body:input})).project;assert.notEqual(fork.id,original.id);assert.equal(fork.document,undefined);assert.equal(fork.revision,1);
    const opened=(await request(kind,'/projects/'+fork.id)).project;assert.deepEqual(opened.document,original.document);
    const preview=await request(kind,'/preview',{method:'POST',body:{document:original.document,time:2.5}});
    for(const copy of [imported,opened])assert.equal((await request(kind,'/preview',{method:'POST',body:{document:copy.document,time:2.5}})).png,preview.png);
    const comp=Object.values(imported.document.items).find(item=>item.kind.type==='Comp'),layer=comp.kind.layers.find(item=>item.name==='Editable red').id;
    const edited=(await request(kind,'/projects/'+imported.id+'/operations',{method:'POST',body:{comp:comp.id,baseRevision:1,requestKey:randomUUID(),commands:[{command:'prop.set',params:{layer,path:'transform/rotation',value:30,time:0}}]}})).project;
    assert.notEqual((await request(kind,'/preview',{method:'POST',body:{document:edited.document,time:2.5}})).png,preview.png,'an actual imported edit changes rendered pixels');
    assert.equal(edited.revision,2);assert.deepEqual((await request(kind,p)).project.document,original.document);
    assert.equal((await request(kind,p+'/fork',{method:'POST',body:input})).project.id,fork.id);
    await request(kind,p+'/fork',{method:'POST',body:{...input,revision:1},status:409});
    await request(kind,p,{method:'DELETE'});
    assert.equal((await request(kind,p+'/fork',{method:'POST',body:input})).project.id,fork.id,'exact fork replay survives parent deletion');
    await request(kind,p+'/fork',{method:'POST',body:{...input,title:'Changed replay'},status:409});
    await request(kind,'/assets/'+asset.id,{method:'DELETE',status:409});
    await request(kind,'/projects/'+imported.id,{method:'DELETE'});await request(kind,'/projects/'+fork.id,{method:'DELETE'});await request(kind,'/assets/'+asset.id,{method:'DELETE'});
  });
  test(kind+': foreign/missing sources, digest mismatch, invalid file/owner fields and withdrawn creation refuse without saving',async()=>{
    const{project,asset}=await source(kind),bytes=Buffer.from(JSON.stringify(project.document));
    const input={revision:project.revision,requestKey:randomUUID(),response:'receipt'};
    await request(kind,'/projects/'+project.id+'/fork',{actor:'bob',method:'POST',body:input,status:404});
    await request(kind,'/projects/import',{actor:'bob',method:'POST',body:file(bytes),status:404});
    await request(kind,'/projects/import',{method:'POST',body:file(Buffer.from([0xff,0xfe,0])),status:400});
    await request(kind,'/projects/import',{method:'POST',body:file(Buffer.from('{')),status:400});
    await request(kind,'/projects/import',{method:'POST',body:file(Buffer.alloc(4194305,32)),status:413});
    const precise=JSON.stringify(project.document).replace(/\"duration\":([0-9]+)/,'\"duration\":9007199254740993');
    const exact=(await request(kind,'/projects/import',{method:'POST',body:file(Buffer.from(precise))})).project;assert.ok(exact.documentJson.includes('9007199254740993'));await request(kind,'/projects/'+exact.id,{method:'DELETE'});
    await request(kind,'/projects/import',{method:'POST',body:file(bytes,{extra:{owner:'bob'}}),status:400});
    const altered=structuredClone(project.document),footage=Object.values(altered.items).find(item=>item.kind.type==='Footage');footage.kind.path=footage.kind.path.replace(/@[0-9a-f]{64}$/, '@'+'0'.repeat(64));
    await request(kind,'/projects/import',{method:'POST',body:file(Buffer.from(JSON.stringify(altered))),status:400});
    if(kind==='native')native.deny('alice','project.create');else http.state.denied.set('alice',new Set(['project.create']));
    try{await request(kind,'/projects/import',{method:'POST',body:file(Buffer.from('{')),status:403});}
    finally{if(kind==='native')native.allow('alice','project.create');else http.state.denied.delete('alice');}
    assert.deepEqual((await request(kind,'/projects',{actor:'bob'})).projects,[]);
    await request(kind,'/projects/'+project.id,{method:'DELETE'});await request(kind,'/assets/'+asset.id,{method:'DELETE'});
  });
}
test('read withdrawal during real validation and after SQL insert refuses copies and rolls back all project/revision/retry rows',async()=>{
  const source=(await request('http','/projects',{method:'POST',body:fresh('Source for permission withdrawal')})).project;
  const path='/projects/'+source.id+'/fork',input={revision:1,title:'Rollback copy',requestKey:randomUUID()};
  const before=(await request('http','/projects')).projects.map(p=>p.id).sort();
  http.state.afterEngine=()=>http.state.denied.set('alice',new Set(['project.read']));
  try{await request('http',path,{method:'POST',body:input,status:403});}finally{http.state.afterEngine=null;http.state.denied.delete('alice');}
  assert.deepEqual((await request('http','/projects')).projects.map(p=>p.id).sort(),before);
  const connect=http.ctx.pool.connect.bind(http.ctx.pool);
  http.ctx.pool.connect=async()=>{const client=await connect();return{release:value=>client.release(value),query:async(...args)=>{const result=await client.query(...args);if(args[0].startsWith('INSERT INTO motion_projects')&&args[1][3]==='Rollback copy')http.state.denied.set('alice',new Set(['project.read']));return result;}};};
  try{await request('http',path,{method:'POST',body:input,status:403});}finally{http.ctx.pool.connect=connect;http.state.denied.delete('alice');}
  assert.deepEqual((await request('http','/projects')).projects.map(p=>p.id).sort(),before);
  const retried=(await request('http',path,{method:'POST',body:input})).project;assert.equal(retried.revision,1);assert.deepEqual(retried.document,source.document);
  await request('http','/projects/'+retried.id,{method:'DELETE'});await request('http','/projects/'+source.id,{method:'DELETE'});
});
test('actual narrow human page imports a saved file, reopens editable keys/photo masks and duplicates independently',async t=>{
  const{project,asset}=await source('http');
  const server=await chromium.launchServer({headless:true,host:'127.0.0.1'});let context;t.after(async()=>{await context?.close();await server.close();});
  const browser=await chromium.connect(server.wsEndpoint());context=await browser.newContext({viewport:{width:412,height:915}});await context.route('**/*',route=>new URL(route.request().url()).origin===http.origin?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(http.origin+'/api/motion-studio/app');await page.locator('#status').filter({hasText:'Ready'}).waitFor();
  await page.locator('#projects').selectOption(project.id);await page.locator('#status').filter({hasText:'Saved'}).waitFor();
  const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading;
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const exported=Buffer.concat(chunks);assert.deepEqual(JSON.parse(exported.toString('utf8')),project.document);
  await page.locator('#importDocument [name=title]').fill('Human imported composition');await page.locator('#importDocument [name=document]').setInputFiles({name:download.suggestedFilename(),mimeType:'application/json',buffer:exported});
  await page.locator('#importDocument button').click();await page.locator('#revision').filter({hasText:'Human imported composition'}).waitFor();await page.locator('#status').filter({hasText:'Saved'}).waitFor();
  const imported=await page.locator('#projects').inputValue();assert.notEqual(imported,project.id);assert.match(await page.locator('#timeline').innerText(),/5.00s/);
  await page.reload();await page.locator('#status').filter({hasText:'Ready'}).waitFor();await page.locator('#projects').selectOption(imported);await page.locator('#status').filter({hasText:'Saved'}).waitFor();
  assert.match(await page.locator('#layers').innerText(),/Editable red/);await page.locator('#duplicate').click();await page.locator('#revision').filter({hasText:'Human imported composition copy'}).waitFor();await page.locator('#status').filter({hasText:'Saved'}).waitFor();
  const duplicate=await page.locator('#projects').inputValue();assert.notEqual(duplicate,imported);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  for(const id of [project.id,imported,duplicate])await request('http','/projects/'+id,{method:'DELETE'});await request('http','/assets/'+asset.id,{method:'DELETE'});
});
