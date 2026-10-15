/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify complete unbroken point-text geometry, original native data and explicit surface refusal through actual owned routes.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {startNativeSqlFixture} from './native-sql-fixture.mjs';import {readProject,stringifyNative,parseNative} from '../tools/native-json.mjs';
let fixture;
before(async()=>{fixture=await startNativeSqlFixture();});after(async()=>{await fixture?.close();});
async function call(path,options={},status=200){const r=await fixture.call(path,options);assert.equal(r.status,status,stringifyNative(r.body));return r.body;}
const comp=p=>Object.values(p.document.items).find(i=>i.kind.type==='Comp');
async function create(title){return readProject((await call('/projects',{method:'POST',body:{title,width:320,height:180,frameRate:30,duration:5,requestKey:randomUUID()}})).project);}
async function edits(p,commands){return readProject((await call('/projects/'+p.id+'/operations',{method:'POST',body:{baseRevision:p.revision,requestKey:randomUUID(),compId:String(comp(p).id),commandsJson:stringifyNative(commands)}})).project);}
async function preview(p,options={},status=200){return call('/projects/'+p.id+'/revisions/'+p.revision+'/preview-ticks/0/'+comp(p).id+'/320/1',options,status);}
async function pixels(frame){const {data,info}=await fixture.sharp(Buffer.from(frame.png,'base64')).raw().toBuffer({resolveWithObject:true});let visible=0,maxAlpha=0;for(let i=3;i<data.length;i+=info.channels){if(data[i])visible++;maxAlpha=Math.max(maxAlpha,data[i]);}return{visible,maxAlpha,width:info.width,height:info.height};}

test('the unchanged60000unbrokenletter1px point caption renders visible native glyphs without changing its document',async()=>{
 let project=await create('Full unbroken point caption');try{
  project=await edits(project,[{command:'layer.newText',params:{name:'Unbroken native point text',text:'M'.repeat(60000),font:'Inter',size:1,fill:'#ff0000',position:[160,90]}}]);
  const source=stringifyNative(project.document),started=performance.now(),frame=await preview(project),proof=await pixels(frame);assert.ok(proof.visible>0);assert.ok(proof.maxAlpha>0);assert.equal(proof.width,320);assert.equal(proof.height,180);
  console.log('60000unbrokenletter1px native point preview milliseconds:',Math.round(performance.now()-started));assert.equal(stringifyNative(readProject((await call('/projects/'+project.id)).project).document),source);
  assert.equal(comp(project).kind.layers[0].props.children.find(n=>n.match==='text').children.find(n=>n.match==='sourceText').value.v.text.length,60000);
  await preview(project,{actor:'bob'},404);fixture.assign('alice','reader');await preview(project);fixture.deny('alice','project.read');await preview(project,{},403);
 }finally{fixture.allow('alice','project.read');fixture.assign('alice','administrator');await call('/projects/'+project.id,{method:'DELETE'});}
});

test('text coordinates beyond20000 remain visible after native transforms and saved edits retain undo/export data',async()=>{
 let project=await create('Moved native source coordinates');try{
  project=await edits(project,[{command:'layer.newText',params:{name:'Offset caption',text:'MM',font:'Inter',size:24,fill:'#0000ff'}},{command:'layer.setText',params:{layer:'#1',box:[30000,0,100,70],justify:'left'}},{command:'prop.set',params:{layer:'#1',path:'transform/position',value:[-29850,70,0]}}]);
  const old=project,frame=await preview(project);assert.ok((await pixels(frame)).visible>0);const layer=comp(project).kind.layers[0];project=await edits(project,[{command:'text.patchAt',params:{layer:String(layer.id),compTimeTicks:'0',attributes:{fill:[1,0,0,.5]}}}]);assert.equal((await pixels(await preview(project))).maxAlpha,128);
  const exported=await fixture.call('/projects/'+project.id+'/revisions/'+project.revision+'/export');assert.equal(exported.status,200);assert.equal(stringifyNative(parseNative(exported.body)),stringifyNative(project.document));
  project=readProject((await call('/projects/'+project.id+'/restore',{method:'POST',body:{revision:old.revision,baseRevision:project.revision,requestKey:randomUUID()}})).project);assert.equal(stringifyNative(project.document),stringifyNative(old.document));assert.ok((await pixels(await preview(project))).visible>0);
 }finally{await call('/projects/'+project.id,{method:'DELETE'});}
});

test('an overbudget text surface refuses a frame explicitly and the next valid project remains renderable',async()=>{
 let huge=await create('Text surface budget'),normal;try{
  huge=await edits(huge,[{command:'layer.newText',params:{text:'MM',font:'Inter',size:10000}}]);const before=stringifyNative(huge.document),refused=await fixture.call('/projects/'+huge.id+'/revisions/'+huge.revision+'/preview-ticks/0/'+comp(huge).id+'/320/1');assert.ok([400,413].includes(refused.status));assert.match(refused.body.error,/text_surface_limit/);assert.equal(refused.body.png,undefined);assert.equal(stringifyNative(readProject((await call('/projects/'+huge.id)).project).document),before);
  normal=await create('Valid caption after refusal');normal=await edits(normal,[{command:'layer.newText',params:{text:'MM',size:24}}]);assert.ok((await pixels(await preview(normal))).visible>0);
 }finally{if(normal)await call('/projects/'+normal.id,{method:'DELETE'});await call('/projects/'+huge.id,{method:'DELETE'});}
});
