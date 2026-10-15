/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify saved work areas and exact native frame playback with real browser/SQL/compositor, original grants and stale-frame cancellation.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startApplicationFixture,chromium} from './application-fixture.mjs';
import {startNativeSqlFixture} from './native-sql-fixture.mjs';
import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readProject,parseNative,stringifyNative} from '../tools/native-json.mjs';
let fixture,server,browser;
before(async()=>{fixture=await startApplicationFixture();server=await chromium.launchServer({headless:true,host:'127.0.0.1'});browser=await chromium.connect(server.wsEndpoint());});
after(async()=>{await server?.close();await fixture?.close();});
async function page(t){
 const context=await browser.newContext({viewport:{width:412,height:915}});t.after(()=>context.close());await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
 const p=await context.newPage(),errors=[];p.on('pageerror',error=>errors.push(error.message));p.setDefaultTimeout(10000);await p.goto(fixture.origin+'/api/motion-studio/app');await p.locator('#status').filter({hasText:'Ready'}).waitFor();return{p,context,errors};
}
async function saved(p,n){await p.locator('#revision').filter({hasText:'revision '+n}).waitFor();await p.locator('#status').filter({hasText:'Saved'}).waitFor();}
async function create(p,title){await p.locator('#new [name=title]').fill(title);await p.locator('#new [name=width]').fill('160');await p.locator('#new [name=height]').fill('90');await p.locator('#new button').click();await saved(p,1);await p.locator('#add [name=kind]').selectOption('solid');await p.locator('#add [name=color]').evaluate(i=>i.value='#ff0000');await p.locator('#add button').click();await saved(p,2);}
async function project(p){const id=await p.locator('#projects').inputValue();return readProject(parseNative(await(await fetch(fixture.origin+'/api/motion-studio/projects/'+id)).text()).project);}
const composition=project=>Object.values(project.document.items).find(i=>i.kind.type==='Comp');
async function work(p,start,end,n){await p.locator('#workArea [name=start]').fill(start);await p.locator('#workArea [name=end]').fill(end);await p.locator('#workArea button').click();await saved(p,n);}
function ticks(request){return request.path.match(/\/preview-ticks\/([0-9]+)\//)?.[1];}
async function stopped(p){await p.locator('#play').filter({hasText:'Play work area'}).waitFor();await p.locator('#playbackStatus').filter({hasText:'Stopped'}).waitFor();}
async function pngPixel(p){return p.locator('#preview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(80,45,1,1).data];});}

test('saved native work area previews every exact frame, retains pixels, reopens and undoes',async t=>{
 const {p,errors}=await page(t);await create(p,'Work-area animation');await p.locator('#key [name=value]').fill('0');await p.locator('#key button').click();await saved(p,3);
 await p.locator('#time').evaluate(i=>{i.value='4';i.dispatchEvent(new Event('input',{bubbles:true}));});await p.locator('#key [name=value]').fill('100');await p.locator('#key button').click();await saved(p,4);
 await work(p,'1','1.1',5);assert.deepEqual(composition(await project(p)).kind.work_area,[254016000000,279417600000]);
 const start=fixture.state.requests.length;await p.locator('#play').click();await p.waitForFunction(()=>document.getElementById('play').getAttribute('aria-pressed')==='false'&&document.getElementById('time').value!=='4');await stopped(p);
 assert.deepEqual(fixture.state.requests.slice(start).map(ticks).filter(Boolean),['254016000000','262483200000','270950400000']);assert.equal((await pngPixel(p))[3],68);assert.equal((await project(p)).revision,5);
 const id=await p.locator('#projects').inputValue();await p.goto(fixture.origin+'/api/motion-studio/app?project='+id);await saved(p,5);assert.equal(await p.locator('#workArea [name=start]').inputValue(),'1');assert.equal(await p.locator('#workArea [name=end]').inputValue(),'1.1');
 await p.locator('#stage').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/oshal-motion-playback-narrow.png'});await p.setViewportSize({width:1280,height:900});await p.locator('#stage').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/oshal-motion-playback-desktop.png'});await p.setViewportSize({width:412,height:915});await p.locator('#undo').click();await saved(p,6);assert.deepEqual(composition(await project(p)).kind.work_area,[0,1270080000000]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
});

test('fractional nonintegral frame ticks and wide work areas stay exact through stepping and unchanged save',async t=>{
 const {p,errors}=await page(t);await create(p,'Wide work area seed');const seed=await project(p),c=composition(seed),start=9007199254740993n,numerator=254016000000n,denominator=29n;
 c.kind.duration=start+4n*numerator/denominator;c.kind.work_area=[start,start+3n*numerator/denominator];c.kind.frame_rate={num:29,den:1};c.kind.layers[0].out_point=c.kind.duration;
 await p.locator('#importDocument [name=title]').fill('Wide 29fps work area');await p.locator('#importDocument [name=document]').setInputFiles({name:'wide.ecproj',mimeType:'application/json',buffer:Buffer.from(stringifyNative(seed.document))});await p.locator('#importDocument button').click();await saved(p,1);
 const before=fixture.state.requests.length;await p.locator('#workArea button').click();assert.equal((await project(p)).revision,1);assert.equal(fixture.state.requests.slice(before).some(r=>r.path.endsWith('/operations')),false);
 const responses=[];p.on('response',r=>{const match=r.url().match(/\/preview-ticks\/([0-9]+)\//);if(match)responses.push(match[1]);});
 let response=p.waitForResponse(r=>r.url().includes('/preview-ticks/'+start+'/'));await p.locator('#nextFrame').click();await response;
 response=p.waitForResponse(r=>r.url().includes('/preview-ticks/'+(start+numerator/denominator)+'/'));await p.locator('#nextFrame').click();await response;
 response=p.waitForResponse(r=>r.url().includes('/preview-ticks/'+start+'/'));await p.locator('#previousFrame').click();await response;
 assert.deepEqual(responses,[String(start),String(start+numerator/denominator),String(start)]);
 assert.deepEqual(composition(await project(p)).kind.work_area,[start,start+3n*numerator/denominator]);assert.equal((await project(p)).revision,1);assert.deepEqual(errors,[]);
});

async function hold(context){let release,seen;const gate=new Promise(done=>release=done),observed=new Promise(done=>seen=done);await context.route(fixture.origin+'/api/motion-studio/projects/*/revisions/*/preview-ticks/**',async route=>{const response=await route.fetch();await response.body();seen();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});return{release,observed};}

test('loop playback has one frame in flight and pause rejects an already-rendered held frame',async t=>{
 const {p,context,errors}=await page(t);await create(p,'Paused preview');await p.locator('#key [name=value]').fill('0');await p.locator('#key button').click();await saved(p,3);await p.locator('#time').evaluate(i=>{i.value='2';i.dispatchEvent(new Event('input',{bubbles:true}));});await p.locator('#key [name=value]').fill('100');await p.locator('#key button').click();await saved(p,4);await work(p,'1','1.033333333333',5);await p.locator('#loop').check();
 const held=await hold(context),start=fixture.state.requests.length;await p.locator('#play').click();await held.observed;assert.equal(fixture.state.requests.slice(start).map(ticks).filter(Boolean).length,1);
 const original=await p.locator('#preview').getAttribute('src');await p.locator('#play').click();await stopped(p);held.release();await p.waitForTimeout(100);assert.equal(await p.locator('#preview').getAttribute('src'),original);assert.equal(fixture.state.requests.slice(start).map(ticks).filter(Boolean).length,1);
 const received=[];p.on('response',r=>{if(r.url().includes('/preview-ticks/'))received.push(r.url());});await p.locator('#play').click();await p.waitForFunction(()=>document.getElementById('play').getAttribute('aria-pressed')==='true');
 await p.waitForResponse(r=>r.url().includes('/preview-ticks/'));await p.waitForResponse(r=>r.url().includes('/preview-ticks/'));await p.locator('#play').click();await stopped(p);assert.ok(received.length>=2);assert.ok(received.every(url=>url.includes('/254016000000/')));assert.equal((await project(p)).revision,5);assert.deepEqual(errors,[]);
});

test('opening another project during a held playback frame stops the old run and preserves the new canvas',async t=>{
 const {p,context,errors}=await page(t);await create(p,'Old playback');await work(p,'1','2',3);const first=await p.locator('#projects').inputValue();await create(p,'New canvas');const second=await p.locator('#projects').inputValue();await p.locator('#transform [name=opacity]').fill('25');await p.locator('#transform button').click();await saved(p,3);
 await p.locator('#projects').selectOption(first);await saved(p,3);const held=await hold(context);await p.locator('#play').click();await held.observed;await p.locator('#projects').selectOption(second);await p.locator('#revision').filter({hasText:'New canvas'}).waitFor();await saved(p,3);await stopped(p);const current=await p.locator('#preview').getAttribute('src');assert.equal((await pngPixel(p))[3],64);
 held.release();await p.waitForTimeout(100);assert.equal(await p.locator('#preview').getAttribute('src'),current);assert.equal(await p.locator('#projects').inputValue(),second);assert.deepEqual(errors,[]);
});

test('Reader playback is allowed, saving is disabled, and a fresh read withdrawal stops frames',async t=>{
 const {p,context,errors}=await page(t);await create(p,'Reader preview');await work(p,'1','2',3);const id=await p.locator('#projects').inputValue();fixture.state.denied.set('alice',new Set(['project.change','project.create','project.delete','project.export']));
 try{await p.goto(fixture.origin+'/api/motion-studio/app?project='+id);await saved(p,3);assert.equal(await p.locator('#workArea button').isDisabled(),true);assert.equal(await p.locator('#play').isDisabled(),false);const held=await hold(context);await p.locator('#play').click();await held.observed;fixture.state.denied.get('alice').add('project.read');held.release();await stopped(p);await p.locator('#error').waitFor();assert.match(await p.locator('#error').innerText(),/read|forbidden|permission/i);assert.equal(await p.locator('#play').getAttribute('aria-pressed'),'false');assert.deepEqual(errors,[]);
 }finally{fixture.state.denied.delete('alice');}
});

test('invalid work areas refuse without saving and hidden tabs stop playback',async t=>{
 const {p,context,errors}=await page(t);await create(p,'Range refusal');await p.locator('#workArea [name=start]').fill('4');await p.locator('#workArea [name=end]').fill('3');await p.locator('#workArea button').click();await p.locator('#error').waitFor();assert.match(await p.locator('#error').innerText(),/inside the composition/);assert.equal((await project(p)).revision,2);
 await work(p,'1','2',3);const held=await hold(context);await p.locator('#play').click();await held.observed;await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await stopped(p);held.release();await p.waitForTimeout(100);assert.equal((await project(p)).revision,3);assert.deepEqual(errors,[]);
});


test('declared approval-bound agent edits save the same native work area and original Reader frames',async()=>{
 const native=await startNativeSqlFixture(),exec=promisify(execFile);let id;
 try{
  const call=async(path,options={},status=200)=>{const r=await native.call(path,options);assert.equal(r.status,status,stringifyNative(r.body));return r.body;};
  let project=readProject((await call('/projects',{method:'POST',body:{title:'Agent work-area preview',width:160,height:90,duration:5,frameRate:30,requestKey:randomUUID()}})).project);id=project.id;const comp=composition(project).id;
  const tool=native.contract.tools.find(t=>t.name==='motion-apply-exact-edits');assert.equal(tool.bound,true);assert.equal(tool.approvalRequired,true);
  const commands=[{command:'layer.newSolid',params:{name:'Agent work-area logo',color:'#ff0000',width:40,height:20}},{command:'comp.workArea',params:{comp,start:1,end:1.1}}];
  const input={id,baseRevision:1,requestKey:randomUUID(),compId:String(comp),commandsJson:stringifyNative(commands),response:'receipt'};
  await exec(process.env.MOTION_NATIVE_BINARY||'/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture',['--tool-input',native.definition,tool.name,JSON.stringify(input)]);
  const {id:omit,...body}=input;await call('/projects/'+id+'/operations',{method:'POST',body});project=readProject((await call('/projects/'+id)).project);assert.equal(project.revision,2);assert.deepEqual(composition(project).kind.work_area,[254016000000,279417600000]);
  native.assign('alice','reader');const path='/projects/'+id+'/revisions/2/preview-ticks/254016000000/'+comp+'/160/1',preview=await call(path),{data,info}=await native.sharp(Buffer.from(preview.png,'base64')).raw().toBuffer({resolveWithObject:true});assert.deepEqual([...data.subarray((45*info.width+80)*info.channels,(45*info.width+80)*info.channels+4)],[255,0,0,255]);
  await call('/projects/'+id+'/operations',{method:'POST',body:{...body,baseRevision:2,requestKey:randomUUID()}},403);await call(path,{actor:'bob'},404);native.deny('alice','project.read');await call(path,{},403);native.allow('alice','project.read');assert.equal(readProject((await call('/projects/'+id)).project).revision,2);
 }finally{native.assign('alice','administrator');native.allow('alice','project.read');if(id)await native.call('/projects/'+id,{method:'DELETE'});await native.close();}
});
