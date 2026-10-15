/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise exact native key selection, real cubic frames, saved visual paths, readonly original grants and stale workspace fencing.
 */
import{test,before,after}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{execFile}from'node:child_process';import{promisify}from'node:util';
import{startApplicationFixture,chromium}from'./application-fixture.mjs';import{startNativeSqlFixture}from'./native-sql-fixture.mjs';import{readProject,parseNative,stringifyNative}from'../tools/native-json.mjs';
const exec=promisify(execFile);let http,native,server,browser;
before(async()=>{http=await startApplicationFixture();native=await startNativeSqlFixture();server=await chromium.launchServer({headless:true,host:'127.0.0.1'});browser=await chromium.connect(server.wsEndpoint());});
after(async()=>{await server?.close();await native?.close();await http?.close();});
async function api(path,{method='GET',body,status=200}={}){const r=await fetch(http.origin+'/api/motion-studio'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?stringifyNative(body):undefined});const result=parseNative(await r.text());assert.equal(r.status,status,stringifyNative(result));return result;}
async function nativeCall(path,options={},status=200){const r=await native.call(path,options);let body=typeof r.body==='string'?parseNative(r.body):r.body;assert.equal(r.status,status,stringifyNative(body));return body;}
async function page(t){const context=await browser.newContext({viewport:{width:412,height:915}});t.after(()=>context.close());await context.route('**/*',r=>new URL(r.request().url()).origin===http.origin?r.continue():r.abort());const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);await p.goto(http.origin+'/api/motion-studio/app');await p.locator('#status').filter({hasText:'Ready'}).waitFor();return{p,context,errors};}
async function saved(p,n){await p.locator('#revision').filter({hasText:'revision '+n}).waitFor();await p.locator('#status').filter({hasText:'Saved'}).waitFor();}
async function create(p,title){await p.locator('#new [name=title]').fill(title);await p.locator('#new [name=width]').fill('160');await p.locator('#new [name=height]').fill('90');await p.locator('#new button').click();await saved(p,1);await p.locator('#add [name=kind]').selectOption('solid');await p.locator('#add [name=text]').fill('Logo');await p.locator('#add [name=color]').evaluate(i=>i.value='#ff0000');await p.locator('#add button').click();await saved(p,2);}
async function scrub(p,time){const ready=p.waitForResponse(r=>r.url().includes('/preview/'+time+'/'));await p.locator('#time').evaluate((i,t)=>{i.value=String(t);i.dispatchEvent(new Event('input',{bubbles:true}));},time);const result=await(await ready).json();await p.waitForFunction(png=>document.getElementById('preview').src==='data:image/png;base64,'+png,result.png);}
async function pixel(p,x=80,y=45){return p.locator('#preview').evaluate(async(img,{x,y})=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return[...ctx.getImageData(x,y,1,1).data];},{x,y});}
async function project(p){return readProject((await api('/projects/'+await p.locator('#projects').inputValue())).project);}
const comp=project=>Object.values(project.document.items).find(item=>item.kind.type==='Comp');
function prop(project,path){let node=comp(project).kind.layers[0].props;for(const part of path.split('/'))node=node.children.find(n=>n.match===part);return node;}
async function key(p,path,value,time,revision){await scrub(p,time);await p.locator('#key [name=path]').selectOption(path);await p.locator('#key [name=value]').fill(value);await p.locator('#key button').click();await saved(p,revision);}
async function choose(p,property,time){await p.locator('.keyButton[data-prop="'+property+'"][data-tick="'+time+'"]').click();await p.locator('#keyEditor').waitFor();await p.locator('#keySummary').filter({hasText:time+' layer ticks'}).waitFor();await p.locator('#preview').evaluate(img=>img.decode());}

test('actual native wide adjacent ticks stay distinct under declared exact read/select/interpolation tools',async()=>{
 let project=readProject((await nativeCall('/projects',{method:'POST',body:{title:'Exact native keys',width:160,height:90,frameRate:30,duration:5,requestKey:randomUUID()}})).project);
 project=readProject((await nativeCall('/projects/'+project.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),commands:[{command:'layer.newSolid',params:{name:'Wide logo'}}]}})).project);
 const composition=comp(project),layer=composition.kind.layers[0],property=prop(project,'transform/opacity');
 async function edit(commands,status=200,actor='alice'){const body={id:project.id,baseRevision:project.revision,requestKey:randomUUID(),response:'receipt',compId:String(composition.id),commandsJson:stringifyNative(commands)};await nativeCall('/projects/'+project.id+'/operations',{method:'POST',body,actor},status);if(status===200)project=readProject((await nativeCall('/projects/'+project.id)).project);}
 const refs={layer:String(layer.id),prop:String(property.uid)};
 await edit([{command:'keys.addExact',params:{...refs,timeTicks:'9007199254740992',value:25}},{command:'keys.addExact',params:{...refs,timeTicks:'9007199254740993',value:75}}]);
 const read=time=>'/projects/'+project.id+'/revisions/'+project.revision+'/keyframes/'+composition.id+'/'+layer.id+'/'+property.uid+'/'+time;
 const before=project.revision,first=await nativeCall(read('9007199254740992')),last=await nativeCall(read('9007199254740993'));assert.equal(first.keyframe.key.value.v,25);assert.equal(last.keyframe.key.value.v,75);assert.equal(last.keyframe.layerTimeTicks,'9007199254740993');assert.equal(last.keyframe.key.time,'9007199254740993');assert.equal(readProject((await nativeCall('/projects/'+project.id)).project).revision,before);
 const input={id:project.id,revision:project.revision,compId:String(composition.id),...refs,timeTicks:'9007199254740993'},tool=native.contract.tools.find(t=>t.name==='motion-read-keyframe');assert.equal(tool.bound,true);assert.equal(tool.mutating,false);assert.equal(tool.approvalRequired,false);
 await exec(process.env.MOTION_NATIVE_BINARY||'/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture',['--tool-input',native.definition,tool.name,JSON.stringify(input)]);
 await edit([{command:'keys.selectExact',params:{...refs,timeTicks:'9007199254740993'}},{command:'keys.interpolation',params:{interpolation:'hold'}}]);assert.equal((await nativeCall(read('9007199254740992'))).keyframe.key.out_interp,'Linear');assert.equal((await nativeCall(read('9007199254740993'))).keyframe.key.out_interp,'Hold');
 await nativeCall(read('9007199254740993'),{actor:'bob'},404);native.assign('alice','reader');try{assert.equal((await nativeCall(read('9007199254740993'))).keyframe.valueComplete,true);await edit([{command:'keys.patchExact',params:{...refs,timeTicks:'9007199254740993',value:50}}],403);}finally{native.assign('alice','administrator');}
 await edit([{command:'keys.patchExact',params:{...refs,timeTicks:'9007199254740993',newTimeTicks:'9007199254740992'}}],400);await nativeCall('/projects/'+project.id,{method:'DELETE'});
});

test('manual exact key editor produces real cubic opacity, moves/deletes one key and restores immutable animation',async t=>{
 const{p,errors}=await page(t);await create(p,'Cubic opacity');await key(p,'transform/opacity','0',0,3);await key(p,'transform/opacity','100',4,4);let current=await project(p),property=prop(current,'transform/opacity');
 await scrub(p,1);const linear=(await pixel(p))[3];assert.equal(linear,64);
 await choose(p,property.uid,'0');await p.locator('#editKey [name=ease]').selectOption('ease');await p.locator('#editKey button').click();await saved(p,5);
 await choose(p,property.uid,'1016064000000');await p.locator('#editKey [name=ease]').selectOption('ease');await p.locator('#editKey button').click();await saved(p,6);await scrub(p,1);assert.ok((await pixel(p))[3]<linear-10);assert.match(await p.locator('#keyCurve polyline').getAttribute('points'),/\d/);
 await p.locator('#editKey [name=seconds]').fill('3');await p.locator('#editKey button').click();await saved(p,7);current=await project(p);assert.deepEqual(prop(current,'transform/opacity').keys.map(k=>k.time),[0,762048000000]);
 await p.locator('#deleteKey').click();await saved(p,8);assert.equal(prop(await project(p),'transform/opacity').keys.length,1);await p.locator('#undo').click();await saved(p,9);assert.equal(prop(await project(p),'transform/opacity').keys.length,2);
 const id=await p.locator('#projects').inputValue();await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(id);await saved(p,9);assert.equal(prop(await project(p),'transform/opacity').keys[0].out_interp,'Bezier');assert.deepEqual(errors,[]);
});

test('manual spatial handles and visual point drag edit the same native cubic motion path and real frames',async t=>{
 const{p,errors}=await page(t);await create(p,'Spatial cubic path');await p.locator('#transform [name=scale]').fill('10');await p.locator('#transform button').click();await saved(p,3);
 await key(p,'transform/position','40,60,0',0,4);await key(p,'transform/position','120,60,0',2,5);const property=prop(await project(p),'transform/position');
 await choose(p,property.uid,'0');await p.locator('#editKey [name=outY]').fill('-40');await p.locator('#editKey button').click();await saved(p,6);
 await choose(p,property.uid,'508032000000');await p.locator('#editKey [name=inY]').fill('-40');await p.locator('#editKey button').click();await saved(p,7);await scrub(p,1);assert.equal((await pixel(p,80,30))[3],255);assert.equal((await pixel(p,80,60))[3],0);assert.match(await p.locator('#motionPath path').getAttribute('d'),/ C /);
 const svg=p.locator('#motionPath'),circle=svg.locator('circle[data-tick="0"]');await circle.scrollIntoViewIfNeeded();const at=await circle.boundingBox();await p.mouse.move(at.x+at.width/2,at.y+at.height/2);await p.mouse.down();const target=await svg.evaluate(svg=>{const p=new DOMPoint(50,70).matrixTransform(svg.getScreenCTM());return{x:p.x,y:p.y};});await p.mouse.move(target.x,target.y,{steps:4});await p.mouse.up();await saved(p,8);const moved=prop(await project(p),'transform/position').keys[0].value.v;assert.ok(Math.abs(moved[0]-50)<.1&&Math.abs(moved[1]-70)<.1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
});

test('a held exact-key read cannot replace the newly opened workspace',async t=>{
 const{p,context,errors}=await page(t);await create(p,'Old keys');await key(p,'transform/opacity','0',0,3);const old=await project(p),property=prop(old,'transform/opacity');
 await create(p,'New workspace');const fresh=await p.locator('#projects').inputValue();await p.locator('#projects').selectOption(old.id);await saved(p,3);
 let release,observed;const gate=new Promise(done=>release=done),seen=new Promise(done=>observed=done);await context.route('**/keyframes/**',async route=>{const response=await route.fetch();await response.body();observed();await gate;await route.fulfill({response});},{times:1});
 await p.locator('.keyButton[data-prop="'+property.uid+'"]').click();await seen;await p.locator('#projects').selectOption(fresh);await saved(p,2);release();await new Promise(done=>setTimeout(done,50));assert.equal(await p.locator('#keyEditor').isHidden(),true);assert.equal((await project(p)).id,fresh);assert.deepEqual(errors,[]);
});

test('wide native layer/property ids and large key values retain exact references and bounded inspection',async()=>{
 let current=readProject((await nativeCall('/projects',{method:'POST',body:{title:'Wide key seed',width:160,height:90,frameRate:30,duration:5,requestKey:randomUUID()}})).project);
 current=readProject((await nativeCall('/projects/'+current.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),commands:[{command:'layer.newText',params:{name:'Large keyed text',text:'Real native key value '.repeat(2000)}}]}})).project);
 const composition=comp(current),layer=composition.kind.layers[0];let property=layer.props.children.find(g=>g.match==='text').children.find(p=>p.match==='sourceText');layer.id=18446744073709551000n;property.uid=18446744073709551001n;current.document.next_id=18446744073709551002n;
 const form=new FormData();form.append('document',new Blob([stringifyNative(current.document)],{type:'application/json'}),'wide.ecproj');form.append('title','Wide keyed copy');form.append('requestKey',randomUUID());const packet=new Request('http://fixture.invalid/',{method:'POST',body:form});
 const copied=readProject((await nativeCall('/projects/import',{method:'POST',body:Buffer.from(await packet.arrayBuffer()).toString('base64'),bodyEncoding:'base64',headers:{'content-type':packet.headers.get('content-type')}})).project);
 const refs={layer:String(layer.id),prop:String(property.uid),timeTicks:'0'};
 await nativeCall('/projects/'+copied.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),compId:String(composition.id),commandsJson:stringifyNative([{command:'keys.addExact',params:refs}])}});
 const metadata=await nativeCall('/projects/'+copied.id+'/revisions/2/keyframes/'+composition.id+'/'+refs.layer+'/'+refs.prop+'/0');assert.equal(metadata.keyframe.layer,refs.layer);assert.equal(metadata.keyframe.prop,refs.prop);assert.equal(metadata.keyframe.valueComplete,false);assert.equal(metadata.keyframe.key.value,undefined);assert.equal(metadata.keyframe.valueInspection.revision,2);assert.ok(Buffer.byteLength(stringifyNative(metadata))<60*1024);
 for(const id of [current.id,copied.id])await nativeCall('/projects/'+id,{method:'DELETE'});
});

test('Reader key inspector remains usable while exact edits are disabled and stale drags cannot write another project',async t=>{
 const{p,errors}=await page(t);await create(p,'Reader path');await key(p,'transform/position','40,60,0',0,3);await key(p,'transform/position','120,60,0',2,4);const first=await project(p),property=prop(first,'transform/position');
 await choose(p,property.uid,'0');http.state.denied.set('alice',new Set(['project.change','project.create','project.delete','project.export']));
 try{await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(first.id);await saved(p,4);await choose(p,property.uid,'0');assert.equal(await p.locator('#editKey button').isDisabled(),true);assert.equal(await p.locator('#deleteKey').isDisabled(),true);}finally{http.state.denied.delete('alice');}
 await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await create(p,'Other canvas');const second=await p.locator('#projects').inputValue();await p.locator('#projects').selectOption(first.id);await saved(p,4);await choose(p,property.uid,'0');
 const circle=p.locator('#motionPath circle[data-tick="0"]');await circle.scrollIntoViewIfNeeded();const at=await circle.boundingBox();await p.mouse.move(at.x+at.width/2,at.y+at.height/2);await p.mouse.down();await p.mouse.move(at.x+at.width/2+10,at.y+at.height/2+10);await p.locator('#projects').selectOption(second);await saved(p,2);await p.mouse.up();assert.equal((await project(p)).revision,2);assert.equal((await api('/projects/'+first.id)).project.revision,4);assert.deepEqual(errors,[]);
});

test('native spatial inspection bounds its real path window and reports incomplete coverage explicitly',async()=>{
 let current=readProject((await nativeCall('/projects',{method:'POST',body:{title:'Long native path',width:160,height:90,frameRate:30,duration:5,requestKey:randomUUID()}})).project);
 current=readProject((await nativeCall('/projects/'+current.id+'/operations',{method:'POST',body:{baseRevision:1,requestKey:randomUUID(),commands:[{command:'layer.newSolid',params:{name:'Many positions',width:4,height:4}}]}})).project);
 const composition=comp(current),layer=composition.kind.layers[0],property=prop(current,'transform/position');
 for(let start=0;start<100;start+=25){const commands=Array.from({length:25},(_,i)=>({command:'keys.addExact',params:{layer:String(layer.id),prop:String(property.uid),timeTicks:String(BigInt(start+i)*8467200000n),value:[start+i,45,0]}}));current=readProject((await nativeCall('/projects/'+current.id+'/operations',{method:'POST',body:{baseRevision:current.revision,requestKey:randomUUID(),compId:String(composition.id),commandsJson:stringifyNative(commands)}})).project);}
 const response=await nativeCall('/projects/'+current.id+'/revisions/'+current.revision+'/keyframes/'+composition.id+'/'+layer.id+'/'+property.uid+'/'+(50n*8467200000n));
 assert.equal(response.keyframe.pathWindow.total,100);assert.equal(response.keyframe.pathWindow.offset,18);assert.equal(response.keyframe.pathWindow.points.length,64);assert.equal(response.keyframe.pathWindow.complete,false);assert.equal(response.keyframe.samples.length,65);assert.ok(Buffer.byteLength(stringifyNative(response))<60*1024);await nativeCall('/projects/'+current.id,{method:'DELETE'});
});
