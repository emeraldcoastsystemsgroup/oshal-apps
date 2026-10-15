/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual effect schemas, bounded agent admission, saved manual gradient/blur/shadow/key pixels and original grant isolation.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApplicationFixture,chromium} from './application-fixture.mjs';
import {startNativeSqlFixture} from './native-sql-fixture.mjs';
import {readProject,parseNative,stringifyNative} from '../tools/native-json.mjs';
const exec=promisify(execFile);let http,native,server,browser;
before(async()=>{http=await startApplicationFixture();native=await startNativeSqlFixture();server=await chromium.launchServer({headless:true,host:'127.0.0.1'});browser=await chromium.connect(server.wsEndpoint());});
after(async()=>{await server?.close();await native?.close();await http?.close();});
async function api(path,{method='GET',body,status=200}={}){const response=await fetch(http.origin+'/api/motion-studio'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=parseNative(await response.text());assert.equal(response.status,status,stringifyNative(result));return result;}
async function nativeCall(path,options={},status=200){const answer=await native.call(path,options);assert.equal(answer.status,status,stringifyNative(answer.body));return answer.body;}
async function page(t){const context=await browser.newContext({viewport:{width:412,height:915}});t.after(()=>context.close());await context.route('**/*',r=>new URL(r.request().url()).origin===http.origin?r.continue():r.abort());const p=await context.newPage(),errors=[];p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await p.goto(http.origin+'/api/motion-studio/app');await p.locator('#status').filter({hasText:'Ready'}).waitFor();return{p,errors};}
async function saved(p,n){await p.locator('#revision').filter({hasText:'revision '+n}).waitFor();await p.locator('#status').filter({hasText:'Saved'}).waitFor();}
async function create(p,title){await p.locator('#new [name=title]').fill(title);await p.locator('#new [name=width]').fill('160');await p.locator('#new [name=height]').fill('90');await p.locator('#new button').click();await saved(p,1);}
async function solid(p){await p.locator('#add [name=kind]').selectOption('solid');await p.locator('#add [name=text]').fill('Effect source');await p.locator('#add [name=color]').evaluate(i=>i.value='#ffffff');await p.locator('#add button').click();await saved(p,2);}
async function addEffect(p,id,n){await p.locator('#effectCatalog').selectOption(id);await p.locator('#addEffect button').click();await saved(p,n);await p.locator('#effectFields fieldset').first().waitFor();}
const field=(p,id)=>p.locator('#effectFields fieldset[data-param="'+id+'"]');
async function color(p,id,value){await field(p,id).locator('input[type=color]').evaluate((i,v)=>i.value=v,value);}
async function pixel(p,x,y){return p.locator('#preview').evaluate(async(img,{x,y})=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(x,y,1,1).data];},{x,y});}
async function project(p){const id=await p.locator('#projects').inputValue();return readProject((await api('/projects/'+id)).project);}
const root=project=>Object.values(project.document.items).find(item=>item.kind.type==='Comp').kind;
const groups=project=>root(project).layers[0].props.children.find(node=>node.match==='effects').children;

test('actual complete effect inventory/schema tools are read-only, stamp-pinned and bounded without creating project data',async()=>{
 const before=(await nativeCall('/projects')).projects;
 const manual=(await api('/editing-contract')).engine.effects;assert.ok(manual.length>300);assert.equal(new Set(manual.map(e=>e.id)).size,manual.length);
 let index=await nativeCall('/effect-index/start/0'),all=[...index.effects];const stamp=index.stamp;
 while(!index.complete){assert.ok(Buffer.byteLength(JSON.stringify(index))<60*1024);index=await nativeCall('/effect-index/'+stamp+'/'+index.nextOffset);all.push(...index.effects);}
 assert.deepEqual(all.map(e=>e.id),manual.map(e=>e.id));assert.equal(all.length,index.total);
 for(const effect of manual){const schema=await api('/effect-schema/'+effect.id);assert.deepEqual(schema.effect,effect);assert.ok(Buffer.byteLength(JSON.stringify(schema))<60*1024);}
 for(const name of ['motion-list-effects','motion-effect-schema']){const contract=native.contract.tools.find(t=>t.name===name);assert.equal(contract.bound,true);assert.equal(contract.mutating,false);assert.equal(contract.approvalRequired,false);assert.deepEqual(contract.permissions,['project.view']);}
 const binary=process.env.MOTION_NATIVE_BINARY||'/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture';
 await exec(binary,['--tool-input',native.definition,'motion-list-effects',JSON.stringify({stamp:'start',offset:0})]);
 await exec(binary,['--tool-input',native.definition,'motion-effect-schema',JSON.stringify({effect:'ec.blur.gaussian'})]);
 await assert.rejects(exec(binary,['--tool-input',native.definition,'motion-effect-schema',JSON.stringify({effect:'ec.blur.gaussian',owner:'bob'})]));
 assert.deepEqual((await nativeCall('/projects')).projects,before);
 await api('/effect-index/'+'0'.repeat(64)+'/64',{status:409});await api('/effect-index/start/999999',{status:400});await api('/effect-index/start/01',{status:400});await api('/effect-schema/no.such.effect',{status:404});
 const calls=http.state.engineCalls;http.state.denied.set('alice',new Set(['project.view']));try{await api('/effect-schema/ec.blur.gaussian',{status:403});assert.equal(http.state.engineCalls,calls);}finally{http.state.denied.delete('alice');}
 http.state.afterEngine=()=>{http.state.denied.set('alice',new Set(['project.view']));};try{await api('/effect-index/start/0',{status:403});}finally{http.state.afterEngine=null;http.state.denied.delete('alice');}
});

test('manual gradient/blur parameters, toggle, ordering, removal and undo preserve real saved effect pixels',async t=>{
 const{p,errors}=await page(t);await create(p,'Gradient and blur');await solid(p);await addEffect(p,'ec.generate.gradientramp',3);
 await color(p,'startColor','#ff0000');await color(p,'endColor','#0000ff');await p.locator('#effectParams button').click();await saved(p,4);
 const top=await pixel(p,80,20),bottom=await pixel(p,80,70);assert.ok(top[0]>bottom[0]);assert.ok(bottom[2]>top[2]);assert.equal(top[3],255);
 await p.locator('#effectEnabled').uncheck();await saved(p,5);assert.deepEqual(await pixel(p,80,45),[255,255,255,255]);await p.locator('#effectEnabled').check();await saved(p,6);
 await addEffect(p,'ec.blur.gaussian',7);await field(p,'blurriness').locator('input').fill('6');await p.locator('#effectParams button').click();await saved(p,8);
 const fringe=await pixel(p,28,45);assert.ok(fringe[3]>0&&fringe[3]<255);assert.ok(fringe[0]+fringe[2]>220,'straight PNG colors retain chroma at an alpha fringe');
 await p.locator('#effectUp').click();await saved(p,9);assert.deepEqual(groups(await project(p)).map(g=>g.match),['ec.blur.gaussian','ec.generate.gradientramp']);const original=await p.locator('#preview').getAttribute('src');
 await p.locator('#removeEffect').click();await saved(p,10);assert.deepEqual(groups(await project(p)).map(g=>g.match),['ec.generate.gradientramp']);await p.locator('#undo').click();await saved(p,11);assert.equal(await p.locator('#preview').getAttribute('src'),original);
 const id=await p.locator('#projects').inputValue();await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(id);await saved(p,11);assert.equal(groups(await project(p)).length,2);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
});

test('manual shadow opacity/direction/only controls render an actual premultiplied shadow outside source bounds',async t=>{
 const{p,errors}=await page(t);await create(p,'Actual shadow');await solid(p);await addEffect(p,'ec.perspective.dropshadow',3);
 await field(p,'direction').locator('input').fill('90');await field(p,'distance').locator('input').fill('10');await field(p,'shadowOnly').locator('input').check();await p.locator('#effectParams button').click();await saved(p,4);
 assert.deepEqual(await pixel(p,135,45),[0,0,0,128]);assert.equal((await pixel(p,35,45))[3],0);assert.deepEqual(errors,[]);
});

test('manual basic chroma key removes owned green source and keeps semi-transparent red without dark fringes',async t=>{
 const{p,errors}=await page(t);await create(p,'Owned chroma source');const raw=Buffer.alloc(16*8*4);
 for(let y=0;y<8;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;raw[i+(x<8?0:1)]=255;raw[i+3]=x<8?128:255;}
 const png=await native.sharp(raw,{raw:{width:16,height:8,channels:4}}).png().toBuffer();await p.locator('#image').setInputFiles({name:'own-key-source.png',mimeType:'image/png',buffer:png});await saved(p,2);await addEffect(p,'ec.key.linearcolor',3);
 await color(p,'keyColor','#00ff00');await field(p,'tolerance').locator('input').fill('0');await field(p,'softness').locator('input').fill('0');await p.locator('#effectParams button').click();await saved(p,4);
 assert.deepEqual(await pixel(p,75,45),[255,0,0,128]);assert.equal((await pixel(p,85,45))[3],0);
 await field(p,'view').locator('select').selectOption('2');await p.locator('#effectParams button').click();await saved(p,5);assert.equal((await pixel(p,85,45))[3],255);
 await field(p,'view').locator('select').selectOption('0');await p.locator('#effectParams button').click();await saved(p,6);assert.deepEqual(await pixel(p,75,45),[255,0,0,128]);assert.equal((await pixel(p,85,45))[3],0);assert.deepEqual(errors,[]);
});

test('declared native agent effect edits retain original data, property UIDs and approval boundaries',async()=>{
 let project=readProject((await nativeCall('/projects',{method:'POST',body:{title:'Agent blur',width:64,height:32,frameRate:30,duration:5,requestKey:randomUUID()}})).project);
 const comp=Object.values(project.document.items).find(item=>item.kind.type==='Comp').id;
 async function edit(commands,status=200,actor='alice'){const body={id:project.id,baseRevision:project.revision,requestKey:randomUUID(),response:'receipt',commandsJson:stringifyNative(commands),compId:String(comp)};
 const binary=process.env.MOTION_NATIVE_BINARY||'/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture';await exec(binary,['--tool-input',native.definition,'motion-apply-exact-edits',JSON.stringify(body)]);
 await nativeCall('/projects/'+project.id+'/operations',{method:'POST',body,actor},status);if(status===200)project=readProject((await nativeCall('/projects/'+project.id)).project);}
 await edit([{command:'layer.newSolid',params:{name:'Agent white',color:'#ffffff',width:16,height:8}},{command:'effect.apply',params:{effect:'ec.blur.gaussian',layers:['Agent white']}}]);
 const layer=root(project).layers[0],fx=groups(project)[0],prop=fx.children.find(p=>p.match==='blurriness');assert.equal((await nativeCall('/effect-schema/'+fx.match)).effect.params.find(p=>p.id==='blurriness').max,3000);
 await edit([{command:'prop.set',params:{layer:layer.id,prop:prop.uid,value:4,time:0,timeBase:'comp'}}]);
 const preview=await nativeCall('/projects/'+project.id+'/revisions/'+project.revision+'/preview/0/'+comp+'/64/1'),{data,info}=await native.sharp(Buffer.from(preview.png,'base64')).raw().toBuffer({resolveWithObject:true});assert.ok(data[(16*info.width+22)*info.channels+3]>0);
 await edit([{command:'effect.remove',params:{layer:layer.id,effect:fx.uid}}],404,'bob');native.deny('alice','project.change');try{await edit([{command:'effect.remove',params:{layer:layer.id,effect:fx.uid}}],403);}finally{native.allow('alice','project.change');}
 assert.equal(groups(readProject((await nativeCall('/projects/'+project.id)).project))[0].uid,fx.uid);await nativeCall('/projects/'+project.id,{method:'DELETE'});
});

test('effect parameter saves preserve untouched native color precision and keys, add timed keys and honor Reader controls',async t=>{
 const{p,errors}=await page(t);await create(p,'Precise effect settings');await solid(p);await addEffect(p,'ec.perspective.dropshadow',3);
 let current=await project(p);const layer=root(current).layers[0],fx=groups(current)[0],colorProp=fx.children.find(v=>v.match==='color'),distance=fx.children.find(v=>v.match==='distance');
 current=readProject((await api('/projects/'+current.id+'/operations',{method:'POST',body:{baseRevision:current.revision,requestKey:randomUUID(),commands:[
  {command:'prop.set',params:{layer:layer.id,prop:colorProp.uid,value:[.123456789,.234567891,.345678912,.87654321],time:0}},
  {command:'prop.addKey',params:{layer:layer.id,prop:distance.uid,value:5,time:0}},
  {command:'prop.addKey',params:{layer:layer.id,prop:distance.uid,value:15,time:4}},
 ]}})).project);
 const originalColor=groups(current)[0].children.find(v=>v.match==='color').value.v,originalKeys=groups(current)[0].children.find(v=>v.match==='distance').keys;
 await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(current.id);await saved(p,4);
 const writes=http.state.requests.filter(r=>r.path.endsWith('/operations')).length;await p.locator('#effectParams button').click();assert.equal((await project(p)).revision,4);assert.equal(http.state.requests.filter(r=>r.path.endsWith('/operations')).length,writes);
 await field(p,'color').locator('input[name=alpha]').fill('0.5');await p.locator('#effectParams button').click();await saved(p,5);
 let actual=groups(await project(p))[0];assert.deepEqual(actual.children.find(v=>v.match==='color').value.v.slice(0,3),originalColor.slice(0,3));assert.equal(actual.children.find(v=>v.match==='color').value.v[3],.5);assert.deepEqual(actual.children.find(v=>v.match==='distance').keys,originalKeys);
 await p.locator('#time').evaluate(i=>{i.value='2';i.dispatchEvent(new Event('input',{bubbles:true}));});await p.locator('#effectStatus').filter({hasText:'tick 508032000000 ·'}).waitFor();assert.equal(Number(await field(p,'distance').locator('input').inputValue()),10);await field(p,'distance').locator('input').fill('10');await p.locator('#effectParams button').click();assert.equal((await project(p)).revision,5);await field(p,'distance').locator('input').fill('12');await p.locator('#effectParams button').click();await saved(p,6);
 actual=groups(await project(p))[0];assert.deepEqual(actual.children.find(v=>v.match==='distance').keys.map(v=>v.time),[0,508032000000,1016064000000]);
 http.state.denied.set('alice',new Set(['project.change','project.create','project.delete','project.export']));
 try{await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(current.id);await saved(p,6);for(const selector of ['#addEffect button','#effectParams button','#effectEnabled','#effectUp','#effectDown','#removeEffect'])assert.equal(await p.locator(selector).isDisabled(),true,selector);}finally{http.state.denied.delete('alice');}
 assert.deepEqual(errors,[]);
});

test('manual inline LUT retains multiline data and real pixels while a host file path refuses without saving',async t=>{
 const{p,errors}=await page(t);await create(p,'Inline color source');await solid(p);await addEffect(p,'ec.utility.applylut',3);
 const lut='LUT_1D_SIZE 2\n0 0 0\n0 0 0\n';await field(p,'lut').locator('textarea').fill(lut);await p.locator('#effectParams button').click();await saved(p,4);assert.deepEqual(await pixel(p,80,45),[0,0,0,255]);
 assert.equal(groups(await project(p))[0].children.find(v=>v.match==='lut').value.v,lut);
 await field(p,'lut').locator('textarea').fill('/tmp/foreign-source.cube');const writes=http.state.requests.filter(r=>r.path.endsWith('/operations')).length;await p.locator('#effectParams button').click();await p.locator('#error').filter({hasText:'owned source import'}).waitFor();assert.equal(http.state.requests.filter(r=>r.path.endsWith('/operations')).length,writes);
 const current=await project(p),fx=groups(current)[0],param=fx.children.find(v=>v.match==='lut');const refused=await api('/projects/'+current.id+'/operations',{method:'POST',body:{baseRevision:4,requestKey:randomUUID(),commands:[{command:'prop.set',params:{layer:root(current).layers[0].id,prop:param.uid,value:'/tmp/foreign-source.cube'}}]},status:400});assert.ok(['motion_operation_refused','motion_effect_needs_owned_text_asset'].includes(refused.error));assert.equal((await project(p)).revision,4);assert.deepEqual(await pixel(p,80,45),[0,0,0,255]);assert.deepEqual(errors,[]);
});

test('manual full-composition background has editable native dimensions and a real edge-to-edge gradient',async t=>{
 const{p,errors}=await page(t);await create(p,'Gradient background');await p.locator('#add [name=kind]').selectOption('background');await p.locator('#add [name=text]').fill('Editable background');await p.locator('#add [name=color]').evaluate(i=>i.value='#112233');await p.locator('#add button').click();await saved(p,2);assert.deepEqual(await pixel(p,1,1),[17,34,51,255]);
 let current=await project(p);const item=current.document.items[String(root(current).layers[0].source.item)];assert.equal(item.kind.width,160);assert.equal(item.kind.height,90);
 await addEffect(p,'ec.generate.gradientramp',3);await color(p,'startColor','#ff0000');await color(p,'endColor','#0000ff');await p.locator('#effectParams button').click();await saved(p,4);
 const first=await pixel(p,1,1),last=await pixel(p,159,89);assert.equal(first[3],255);assert.equal(last[3],255);assert.ok(first[0]>last[0]);assert.ok(last[2]>first[2]);assert.deepEqual(errors,[]);
});
