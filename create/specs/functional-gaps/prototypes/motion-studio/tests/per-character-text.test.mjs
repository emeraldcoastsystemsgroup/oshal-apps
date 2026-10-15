/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify full per-character3Dglyph geometry, original native data, visible tails and aggregate/individual surface refusal.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {startApplicationFixture,chromium} from './application-fixture.mjs';
import {startNativeSqlFixture} from './native-sql-fixture.mjs';import {readProject,stringifyNative,parseNative} from '../tools/native-json.mjs';
let fixture,http,server,browser;
before(async()=>{fixture=await startNativeSqlFixture();http=await startApplicationFixture({exchangeTimeoutMs:45000});server=await chromium.launchServer({headless:true,host:'127.0.0.1'});browser=await chromium.connect(server.wsEndpoint());});after(async()=>{await server?.close();await http?.close();await fixture?.close();});
async function call(path,options={},status=200){const r=await fixture.call(path,options);assert.equal(r.status,status,stringifyNative(r.body));return r.body;}
const comp=p=>Object.values(p.document.items).find(i=>i.kind.type==='Comp');
async function create(title){return readProject((await call('/projects',{method:'POST',body:{title,width:320,height:180,frameRate:30,duration:5,requestKey:randomUUID()}})).project);}
async function edits(p,commands){return readProject((await call('/projects/'+p.id+'/operations',{method:'POST',body:{baseRevision:p.revision,requestKey:randomUUID(),compId:String(comp(p).id),commandsJson:stringifyNative(commands)}})).project);}
async function preview(p,options={},status=200){return call('/projects/'+p.id+'/revisions/'+p.revision+'/preview-ticks/0/'+comp(p).id+'/320/1',options,status);}
async function pixels(frame){const {data,info}=await fixture.sharp(Buffer.from(frame.png,'base64')).raw().toBuffer({resolveWithObject:true});let visible=0,maxAlpha=0;for(let i=3;i<data.length;i+=info.channels){if(data[i])visible++;maxAlpha=Math.max(maxAlpha,data[i]);}return{visible,maxAlpha,width:info.width,height:info.height};}


function textProp(p){return comp(p).kind.layers[0].props.children.find(n=>n.match==='text').children.find(n=>n.match==='sourceText');}
async function rgba(frame){return fixture.sharp(Buffer.from(frame.png,'base64')).raw().toBuffer({resolveWithObject:true});}
test('large scaled per-character3Dglyph retains the right edge and matches the complete native flat-plane reference',async()=>{
 let project=await create('Full glyph surface');try{
  project=await edits(project,[{command:'layer.newText',params:{name:'Large original M',text:'M',font:'Inter',size:6000,fill:'#ff0000',position:[10,165]}},{command:'layer.setText',params:{layer:'#1',justify:'left'}},{command:'prop.set',params:{layer:'#1',path:'transform/scale',value:[5,5,5]}},{command:'layer.enablePerChar3D',params:{layer:'#1',enabled:true}}]);const before=stringifyNative(project.document),started=performance.now(),frame=await preview(project),actual=await rgba(frame);console.log('Full native6000px per-character glyph preview milliseconds:',Math.round(performance.now()-started));assert.equal(textProp(project).value.v.size,6000);let tail=0;for(let y=0;y<actual.info.height;y++)for(let x=230;x<actual.info.width;x++)if(actual.data[(y*actual.info.width+x)*actual.info.channels+3])tail++;assert.ok(tail>100,'right glyph stem survives beyond the old source clamp');
  assert.equal(stringifyNative(readProject((await call('/projects/'+project.id)).project).document),before);project=await edits(project,[{command:'layer.enablePerChar3D',params:{layer:'#1',enabled:false}}]);const reference=await rgba(await preview(project));assert.equal(actual.info.width,reference.info.width);// Native character planes use output-scale sampling; flat text uses continuous
  // layer-scale sampling. Require complete reference geometry within one antialiasing
  // pixel in both directions and identical opaque interior color, not arbitrary error totals.
  const w=actual.info.width,h=actual.info.height,images=[actual.data,reference.data],channels=actual.info.channels;
  const alpha=(image,x,y)=>image[(y*w+x)*channels+3];
  for(let k=0;k<2;k++)for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(alpha(images[k],x,y)){
   let supported=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h&&alpha(images[1-k],xx,yy))supported=true;}
   assert.equal(supported,true,'complete native geometry has no missing region beyond one antialiasing pixel');
  }
  let interior=0;for(let i=0;i<actual.data.length;i+=channels)if(actual.data[i+3]===255&&reference.data[i+3]===255){assert.deepEqual([...actual.data.subarray(i,i+3)],[...reference.data.subarray(i,i+3)]);interior++;}assert.ok(interior>1000);

  const exported=await fixture.call('/projects/'+project.id+'/revisions/'+project.revision+'/export');assert.equal(exported.status,200);assert.equal(stringifyNative(parseNative(exported.body)),stringifyNative(project.document));
 }finally{await call('/projects/'+project.id,{method:'DELETE'});}
});
test('individual and aggregate per-character surfaces refuse whole frames and leave the next valid request usable',async()=>{
 let project=await create('Aggregate glyph budget');try{
  project=await edits(project,[{command:'layer.newText',params:{name:'Budget source',text:'MM',font:'Inter',size:6000}},{command:'layer.enablePerChar3D',params:{layer:'#1',enabled:true}}]);const before=stringifyNative(project.document);let r=await fixture.call('/projects/'+project.id+'/revisions/'+project.revision+'/preview-ticks/0/'+comp(project).id+'/320/1');assert.ok([400,413].includes(r.status));assert.match(r.body.error,/text_surface_limit/);assert.equal(r.body.png,undefined);assert.equal(stringifyNative(readProject((await call('/projects/'+project.id)).project).document),before);
  project=await edits(project,[{command:'layer.setText',params:{layer:'#1',text:'M',size:10000}}]);r=await fixture.call('/projects/'+project.id+'/revisions/'+project.revision+'/preview-ticks/0/'+comp(project).id+'/320/1');assert.ok([400,413].includes(r.status));assert.match(r.body.error,/text_surface_limit/);assert.equal(r.body.png,undefined);
  project=await edits(project,[{command:'layer.setText',params:{layer:'#1',size:24}}]);assert.ok((await pixels(await preview(project))).visible>0);const contract=await call('/editing-contract');assert.equal(contract.engine.perCharacterTextSurfacePixels,33554432);
 }finally{await call('/projects/'+project.id,{method:'DELETE'});}
});
async function page(t){const context=await browser.newContext({viewport:{width:412,height:915}});t.after(()=>context.close());await context.route('**/*',route=>new URL(route.request().url()).origin===http.origin?route.continue():route.abort());const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);await p.goto(http.origin+'/api/motion-studio/app');await p.locator('#status').filter({hasText:'Ready'}).waitFor();return{p,errors};}
async function saved(p,n){await p.locator('#revision').filter({hasText:'revision '+n}).waitFor();await p.locator('#status').filter({hasText:'Saved'}).waitFor();}
async function humanDoc(p){const id=await p.locator('#projects').inputValue(),r=await fetch(http.origin+'/api/motion-studio/projects/'+id);return readProject(parseNative(await r.text()).project);}
async function setupPage(p){await p.locator('#new [name=width]').fill('320');await p.locator('#new [name=height]').fill('180');await p.locator('#new button').click();await saved(p,1);await p.locator('#add [name=text]').fill('MM');await p.locator('#add button').click();await saved(p,2);await p.waitForFunction(()=>!document.querySelector('#textEdit button').disabled);}
test('human per-character3Dswitch saves native mode, preserves caption data through reopen/undo and stays disabled for Reader',async t=>{
 const {p,errors}=await page(t);await setupPage(p);const before=await humanDoc(p);await p.locator('#textEdit [name=perChar3d]').check();await p.locator('#textEdit button').click();await saved(p,3);const current=await humanDoc(p),layer=comp(current).kind.layers[0];assert.equal(layer.switches.three_d,true);assert.equal(layer.props.children.find(n=>n.match==='text').children.find(n=>n.match==='perChar3d').value.v,true);assert.deepEqual(textProp(current),textProp(before));
 const id=current.id;await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(id);await saved(p,3);await p.waitForFunction(()=>document.querySelector('#textEdit [name=perChar3d]').checked);await p.locator('#undo').click();await saved(p,4);assert.equal(comp(await humanDoc(p)).kind.layers[0].props.children.find(n=>n.match==='text').children.find(n=>n.match==='perChar3d').value.v,false);
 http.state.denied.set('alice',new Set(['project.change','project.create','project.delete','project.export']));try{await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(id);await saved(p,4);assert.equal(await p.locator('#textEdit [name=perChar3d]').isDisabled(),true);}finally{http.state.denied.delete('alice');}assert.deepEqual(errors,[]);
});
test('human overbudget preview hides the old revision image and undo restores a real frame',async t=>{
 const {p,errors}=await page(t);await setupPage(p);await p.locator('#textEdit [name=perChar3d]').check();await p.locator('#textEdit button').click();await saved(p,3);await p.waitForFunction(()=>!document.querySelector('#textEdit button').disabled);await p.locator('#textEdit [name=size]').fill('10000');await p.locator('#textEdit button').click();await saved(p,4);await p.locator('#error').waitFor();assert.match(await p.locator('#error').innerText(),/text_surface_limit/);assert.equal(await p.locator('#preview').isVisible(),false);assert.equal(await p.locator('#empty').innerText(),'Preview unavailable for this revision.');assert.equal(textProp(await humanDoc(p)).value.v.size,10000);
 await p.locator('#undo').click();await saved(p,5);await p.locator('#preview').waitFor({state:'visible'});assert.equal(textProp(await humanDoc(p)).value.v.size,36);assert.deepEqual(errors,[]);await p.locator('#textPanel').screenshot({path:'/tmp/oshal-motion-per-character-panel.png'});
});
test('original Reader previews native per-character animation; foreign and withdrawn grants refuse',async()=>{
 let project=await create('Reader3Dtext');try{
  project=await edits(project,[{command:'layer.newText',params:{name:'Animated3D',text:'MM',size:36}},{command:'layer.enablePerChar3D',params:{layer:'#1',enabled:true}},{command:'layer.addTextAnimator',params:{layer:'#1',properties:['opacity']}},{command:'prop.addKey',params:{layer:'#1',path:'text/animators/#1/properties/opacity',time:0,value:0}},{command:'prop.addKey',params:{layer:'#1',path:'text/animators/#1/properties/opacity',time:4,value:100}}]);
  await preview(project,{actor:'bob'},404);fixture.assign('alice','reader');const middle=await call('/projects/'+project.id+'/revisions/'+project.revision+'/preview-ticks/508032000000/'+comp(project).id+'/320/1');assert.equal((await pixels(middle)).maxAlpha,128);fixture.deny('alice','project.read');await preview(project,{},403);
 }finally{fixture.allow('alice','project.read');fixture.assign('alice','administrator');await call('/projects/'+project.id,{method:'DELETE'});}
});
