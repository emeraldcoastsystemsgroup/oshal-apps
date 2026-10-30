/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove real native inspector saves before concierge reads and editable same-project refresh with actual Chromium, original-owner SQL and the pinned compositor. Assistant operations use the real app routes; no provider inference is claimed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startApplicationFixture, chromium } from '../application-fixture.mjs';
import { parseNative, stringifyNative, readProject } from '../../tools/native-json.mjs';
let fixture,server,browser,ended;
before(async()=>{fixture=await startApplicationFixture();server=await chromium.launchServer({headless:true,host:'127.0.0.1'});ended=new Promise(done=>server.process().once('exit',(code,signal)=>done({code,signal})));browser=await chromium.connect(server.wsEndpoint());});
after(async()=>{await server?.close();if(ended)assert.equal((await ended).code,0);await fixture?.close();});
async function page(t){
 const context=await browser.newContext({viewport:{width:1280,height:900}});t.after(()=>context.close());
 await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(fixture.origin+'/api/motion-studio/app');await page.waitForFunction(()=>window.__oshalDocumentSession);return {page,errors,context};
}
async function saved(page,n){await page.locator('#revision').filter({hasText:'revision '+n}).waitFor();await page.locator('#status').filter({hasText:'Saved'}).waitFor();}
async function create(page,title){await page.locator('#new [name=title]').fill(title);await page.locator('#new [name=width]').fill('160');await page.locator('#new [name=height]').fill('90');await page.locator('#new button').click();await saved(page,1);}
async function caption(page,text){await page.locator('#add [name=text]').fill(text);await page.locator('#add button').click();await saved(page,2);await page.locator('#textEdit [name=content]:enabled').waitFor();}
const begin=page=>page.evaluate(async()=>{const api=await import('/shared/ui/js/document-handoff.js');window.handoff=await api.beginDocumentHandoff();return window.handoff.context;});
async function api(path,body){const response=await fetch(fixture.origin+'/api/motion-studio'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:stringifyNative(body)}:{});const result=parseNative(await response.text());assert.ok(response.ok,stringifyNative(result));return result;}
async function project(id){return readProject((await api('/projects/'+id)).project);}
const comp=p=>Object.values(p.document.items).find(item=>item.kind.type==='Comp');
const prop=(layer,group,name)=>layer.props.children.find(item=>item.match===group).children.find(item=>item.match===name);
async function edit(snapshot,commands){return api('/projects/'+snapshot.recordId+'/operations',{baseRevision:snapshot.fields.revision,compId:snapshot.fields.compId,requestKey:randomUUID(),commandsJson:stringifyNative(commands)});}

test('Motion saves unapplied native text, transform and layer fields before reads and refreshes the same editable document twice',async t=>{
 const {page:p,errors}=await page(t);await create(p,'Current motion');await caption(p,'Original caption');
 await p.locator('#textEdit [name=content]').fill('My manual caption');await p.locator('#transform [name=x]').fill('60');await p.locator('#layerSettings [name=name]').fill('My native caption');
 const first=await begin(p);assert.equal(first.fields.revision,3);
 let document=await project(first.recordId),layer=comp(document).kind.layers[0];assert.equal(layer.name,'My native caption');assert.equal(prop(layer,'text','sourceText').value.v.text,'My manual caption');assert.equal(prop(layer,'transform','position').value.v[0],60);
 await edit(first,[{command:'text.patchAt',params:{layer:first.fields.layerId,compTimeTicks:first.fields.compTimeTicks,attributes:{text:'Concierge caption'}}}]);
 await p.evaluate(()=>window.handoff.refresh());assert.equal(await p.locator('#textEdit [name=content]').inputValue(),'Concierge caption');assert.equal(await p.locator('#transform [name=x]').inputValue(),'60');
 await p.locator('#textEdit [name=content]').fill('My next change');const second=await begin(p);assert.equal(second.recordId,first.recordId);assert.equal(second.fields.revision,5);
 document=await project(second.recordId);layer=comp(document).kind.layers[0];assert.equal(prop(layer,'text','sourceText').value.v.text,'My next change');
 await edit(second,[{command:'layer.select',params:{layers:[parseNative(second.fields.layerId)]}},{command:'layer.rename',params:{layer:parseNative(second.fields.layerId),name:'Continued native caption'}}]);await p.evaluate(()=>window.handoff.refresh());
 assert.match(await p.locator('#layers').innerText(),/Continued native caption/);assert.equal(await p.locator('#textEdit [name=content]').inputValue(),'My next change');assert.deepEqual(errors,[]);
});


test('a failed automatic Motion save blocks reading and retains the inspector draft',async t=>{
 const {page:p}=await page(t);await create(p,'Denied save');await caption(p,'Saved caption');const initial=await begin(p);
 await p.locator('#textEdit [name=content]').fill('Unsent manual draft');fixture.state.denied.set('alice',new Set(['project.change']));
 try{await assert.rejects(begin(p));assert.equal((await project(initial.recordId)).revision,2);assert.equal(await p.locator('#textEdit [name=content]').inputValue(),'Unsent manual draft');}
 finally{fixture.state.denied.delete('alice');}
});

test('a Motion refresh keeps a concurrent focused inspector field and permits a clean refresh once it is undone',async t=>{
 const {page:p}=await page(t);await create(p,'Concurrent fields');await caption(p,'Saved caption');const first=await begin(p);
 await p.locator('#textEdit [name=content]').fill('My concurrent draft');
 await edit(first,[{command:'text.patchAt',params:{layer:first.fields.layerId,compTimeTicks:first.fields.compTimeTicks,attributes:{text:'Saved concierge caption'}}}]);
 await assert.rejects(p.evaluate(()=>window.handoff.refresh()),/composition field draft is still here/);assert.equal(await p.locator('#textEdit [name=content]').inputValue(),'My concurrent draft');
 await p.locator('#textEdit [name=content]').fill('Saved caption');await p.evaluate(()=>window.handoff.refresh());assert.equal(await p.locator('#textEdit [name=content]').inputValue(),'Saved concierge caption');
});

test('Motion automatically saves effect, mask and selected keyframe values without replacing their native structures',async t=>{
 const {page:p,errors}=await page(t);await create(p,'Native controls');await p.locator('#add [name=kind]').selectOption('solid');await p.locator('#add [name=text]').fill('Native plane');await p.locator('#add button').click();await saved(p,2);
 await p.locator('#effectCatalog').selectOption('ec.blur.gaussian');await p.locator('#addEffect button').click();await saved(p,3);
 await p.locator('#mask [name=width]').fill('40');await p.locator('#mask [name=height]').fill('40');await p.locator('#mask button').click();await saved(p,4);
 await p.locator('#key [name=value]').fill('100');await p.locator('#key button').click();await saved(p,5);
 const before=await begin(p),beforeProject=await project(before.recordId),originalLayer=comp(beforeProject).kind.layers[0];
 await p.locator('#effectFields fieldset[data-param="blurriness"] input:enabled').fill('8');await p.locator('#maskSettings [name=opacity]:enabled').fill('40');
 await p.locator('#timeline .keyButton').first().click();await p.locator('#editKey [name=value]:enabled').fill('25');
 const after=await begin(p),result=await project(after.recordId),layer=comp(result).kind.layers[0];assert.equal(layer.id,originalLayer.id);
 const effect=layer.props.children.find(group=>group.match==='effects').children[0],mask=layer.props.children.find(group=>group.match==='masks').children[0];
 assert.equal(effect.uid,originalLayer.props.children.find(group=>group.match==='effects').children[0].uid);assert.equal(effect.children.find(prop=>prop.match==='blurriness').value.v,8);
 assert.equal(mask.uid,originalLayer.props.children.find(group=>group.match==='masks').children[0].uid);assert.equal(mask.children.find(prop=>prop.match==='opacity').value.v,40);assert.equal(prop(layer,'transform','opacity').keys[0].value.v,25);
 assert.equal(await p.locator('#editKey [name=value]').inputValue(),'25');assert.deepEqual(errors,[]);
});

test('a historical Motion question retains the visible revision and cannot silently edit it',async t=>{
 const {page:p}=await page(t);await create(p,'Visible history');await caption(p,'Current caption');const current=await begin(p);
 await p.goto(fixture.origin+'/api/motion-studio/app?project='+current.recordId+'&revision=1');await p.waitForFunction(()=>window.__oshalDocumentSession);
 const historical=await begin(p);assert.equal(historical.fields.revision,1);assert.equal(historical.fields.readOnly,true);
 await p.evaluate(()=>window.handoff.refresh());assert.match(await p.locator('#revision').textContent(),/revision 1/);assert.equal(await p.locator('#add button').isDisabled(),true);
});


test('unapplied Motion drafts on two layers are both saved and the selected layer is retained',async t=>{
 const {page:p}=await page(t);await create(p,'Two layer drafts');await caption(p,'First native text');
 await p.locator('#add [name=text]').fill('Second native text');await p.locator('#add button').click();await saved(p,3);
 await p.locator('#layers button').filter({hasText:'First native text'}).click();await p.locator('#textEdit [name=content]:enabled').fill('My first layer draft');
 await p.locator('#layers button').filter({hasText:'Second native text'}).click();await p.locator('#textEdit [name=content]:enabled').fill('My second layer draft');
 const snapshot=await begin(p),document=await project(snapshot.recordId),layers=comp(document).kind.layers;
 assert.deepEqual(new Set(layers.map(layer=>prop(layer,'text','sourceText').value.v.text)),new Set(['My first layer draft','My second layer draft']));
 assert.equal(snapshot.fields.layerId,String(layers.find(layer=>layer.name==='Second native text').id));assert.equal(await p.locator('#textEdit [name=content]').inputValue(),'My second layer draft');
});

test('a delayed automatic native save cannot replace a newly opened Motion project',async t=>{
 const {page:p}=await page(t);await create(p,'First project');await caption(p,'First caption');const first=await begin(p);await create(p,'Other project');const other=await begin(p);
 await p.locator('#projects').selectOption(first.recordId);await saved(p,2);
 let arrived,release;const seen=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 await p.route('**/projects/'+first.recordId+'/operations',async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});});
 await p.locator('#textEdit [name=content]:enabled').fill('Saved before switching');const handoff=begin(p).then(value=>({value}),error=>({error:error.message}));await seen;
 await p.locator('#projects').selectOption(other.recordId);await p.locator('#revision').filter({hasText:'Other project'}).waitFor();release();assert.match((await handoff).error,/open composition changed/);
 assert.match(await p.locator('#revision').textContent(),/Other project/);assert.equal((await begin(p)).recordId,other.recordId);
});

test('the concierge creates an editable native layer and gray effect, then reads a manual filter adjustment on the next handoff',async t=>{
 const {page:p,errors}=await page(t);await create(p,'Editable gray work');const first=await begin(p);
 let result=readProject((await edit(first,[{command:'layer.newSolid',params:{name:'Concierge plane',color:'#ff0000',width:160,height:90}},{command:'layer.select',params:{layers:['Concierge plane']}},{command:'effect.apply',params:{effect:'ec.color.huesaturation'}}])).project);
 const nativeLayer=comp(result).kind.layers[0],effect=nativeLayer.props.children.find(group=>group.match==='effects').children[0],saturation=effect.children.find(item=>item.match==='saturation');
 const snapshot={...first,fields:{...first.fields,revision:result.revision,layerId:String(nativeLayer.id)}};
 await edit(snapshot,[{command:'properties.patchAt',params:{layer:String(nativeLayer.id),effect:String(effect.uid),compTimeTicks:'0',changes:[{prop:String(saturation.uid),value:-100}]}}]);await p.evaluate(()=>window.handoff.refresh());
 const slider=p.locator('#effectFields fieldset[data-param="saturation"] input:enabled');assert.equal(await slider.inputValue(),'-100');
 const pixel=await p.locator('#preview').evaluate(async img=>{await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(80,45,1,1).data];});assert.equal(pixel[0],pixel[1]);assert.equal(pixel[1],pixel[2]);assert.equal(pixel[3],255);
 await slider.fill('-50');const next=await begin(p);result=await project(next.recordId);const edited=comp(result).kind.layers[0],sameEffect=edited.props.children.find(group=>group.match==='effects').children[0];
 assert.equal(edited.id,nativeLayer.id);assert.equal(sameEffect.uid,effect.uid);assert.equal(sameEffect.children.find(item=>item.match==='saturation').value.v,-50);
 await edit(next,[{command:'layer.select',params:{layers:[edited.id]}},{command:'layer.rename',params:{layer:edited.id,name:'Continued editable gray work'}}]);await p.evaluate(()=>window.handoff.refresh());
 assert.match(await p.locator('#layers').innerText(),/Continued editable gray work/);assert.equal(await slider.inputValue(),'-50');assert.deepEqual(errors,[]);
});


test('automatic Motion saves retain a full effect text file when only a hidden section changes',async t=>{
 const {page:p}=await page(t);await create(p,'Full effect text');await p.locator('#add [name=kind]').selectOption('solid');await p.locator('#add button').click();await saved(p,2);
 await p.locator('#effectCatalog').selectOption('ec.utility.applylut');await p.locator('#addEffect button').click();await saved(p,3);
 const header='# shared visible header '+('x'.repeat(95000))+'\nLUT_1D_SIZE 2\n0 0 0\n',first=header+'1 1 1\n',next=header+'0 1 0\n';
 const file=p.locator('#effectFields fieldset[data-param="lut"] input[type=file]');await file.setInputFiles({name:'first.cube',mimeType:'text/plain',buffer:Buffer.from(first)});
 await p.locator('#effectFields fieldset[data-param="lut"] small').filter({hasText:'file loaded'}).waitFor();const initial=await begin(p);
 let document=await project(initial.recordId),effect=comp(document).kind.layers[0].props.children.find(group=>group.match==='effects').children[0];assert.equal(effect.children.find(prop=>prop.match==='lut').value.v,first);
 await file.setInputFiles({name:'next.cube',mimeType:'text/plain',buffer:Buffer.from(next)});await p.locator('#effectFields fieldset[data-param="lut"] small').filter({hasText:'file loaded'}).waitFor();
 const second=await begin(p);document=await project(second.recordId);effect=comp(document).kind.layers[0].props.children.find(group=>group.match==='effects').children[0];assert.equal(effect.children.find(prop=>prop.match==='lut').value.v,next);assert.equal(second.fields.revision,initial.fields.revision+1);
});


test('reopening a newer Motion revision never silently rebases an older inspector draft',async t=>{
 const {page:p}=await page(t);await create(p,'Original draft project');await caption(p,'Initial caption');const first=await begin(p);
 await p.locator('#textEdit [name=content]').fill('My older unsent draft');await create(p,'Another open project');
 await edit(first,[{command:'text.patchAt',params:{layer:first.fields.layerId,compTimeTicks:first.fields.compTimeTicks,attributes:{text:'Newer saved caption'}}}]);
 await p.locator('#projects').selectOption(first.recordId);await saved(p,3);await p.locator('#textEdit [name=content]:enabled').waitFor();
 await assert.rejects(begin(p),/newer saved revision/);assert.equal(await p.locator('#textEdit [name=content]').inputValue(),'My older unsent draft');
 const latest=await project(first.recordId);assert.equal(prop(comp(latest).kind.layers[0],'text','sourceText').value.v.text,'Newer saved caption');
 await p.locator('#textEdit [name=content]').fill('Newer saved caption');assert.equal((await begin(p)).fields.revision,3);
});


test('distinct native color parameters with repeated control names retain independent drafts',async t=>{
 const {page:p}=await page(t);await create(p,'Independent effect colors');await p.locator('#add [name=kind]').selectOption('solid');await p.locator('#add button').click();await saved(p,2);
 await p.locator('#effectCatalog').selectOption('ec.color.tint');await p.locator('#addEffect button').click();await saved(p,3);const initial=await begin(p);
 const before=await project(initial.recordId),original=comp(before).kind.layers[0].props.children.find(group=>group.match==='effects').children[0],white=original.children.find(prop=>prop.match==='white').value.v;
 await p.locator('#effectFields fieldset[data-param="black"] input[type=color]:enabled').evaluate(field=>{field.value='#808080';field.dispatchEvent(new Event('input',{bubbles:true}));});
 const updated=await begin(p),after=await project(updated.recordId),effect=comp(after).kind.layers[0].props.children.find(group=>group.match==='effects').children[0];
 assert.equal(updated.fields.revision,4);assert.deepEqual(effect.children.find(prop=>prop.match==='black').value.v,[128/255,128/255,128/255,1]);assert.deepEqual(effect.children.find(prop=>prop.match==='white').value.v,white);
});
