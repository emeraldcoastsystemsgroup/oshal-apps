/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify native saved masks, path geometry, alpha pixels, history and original human/agent authority.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startApplicationFixture, chromium } from './application-fixture.mjs';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
import { readProject, stringifyNative, parseNative } from '../tools/native-json.mjs';
const exec = promisify(execFile); let http, native, server, browser;
before(async () => { http = await startApplicationFixture(); native = await startNativeSqlFixture(); server = await chromium.launchServer({ headless: true, host: '127.0.0.1' }); browser = await chromium.connect(server.wsEndpoint()); });
after(async () => { await server?.close(); await native?.close(); await http?.close(); });
async function page(t) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } }); t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === http.origin ? route.continue() : route.abort());
  const p = await context.newPage(), errors = []; p.on('pageerror', error => errors.push(error.message)); p.setDefaultTimeout(10000);
  await p.goto(http.origin + '/api/motion-studio/app'); await p.locator('#status').filter({ hasText: 'Ready' }).waitFor(); return { p, errors };
}
async function saved(p, revision) { await p.locator('#revision').filter({ hasText: 'revision ' + revision }).waitFor(); await p.locator('#status').filter({ hasText: 'Saved' }).waitFor(); }
async function create(p, title) { await p.locator('#new [name=title]').fill(title); await p.locator('#new [name=width]').fill('160'); await p.locator('#new [name=height]').fill('90'); await p.locator('#new button').click(); await saved(p, 1); }
async function add(p, name, color) { await p.locator('#add [name=kind]').selectOption('solid'); await p.locator('#add [name=text]').fill(name); await p.locator('#add [name=color]').evaluate((input, value) => input.value = value, color); await p.locator('#add button').click(); }
async function pixel(p, x = 80, y = 45) { return p.locator('#preview').evaluate(async (img, { x, y }) => { await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data]; }, { x, y }); }
async function document(p) { const id = await p.locator('#projects').inputValue(), response = await fetch(http.origin + '/api/motion-studio/projects/' + id); return readProject(parseNative(await response.text()).project); }
const compositions = project => Object.values(project.document.items).filter(item => item.kind.type === 'Comp');
async function nativeCall(path, options = {}, status = 200) { const answer = await native.call(path, options); assert.equal(answer.status, status, stringifyNative(answer.body)); return answer.body; }
async function exact(project, comp, commands) {
  const input = { id: project.id, baseRevision: project.revision, requestKey: randomUUID(), compId: String(comp), commandsJson: stringifyNative(commands), response: 'receipt' };
  const tool = native.contract.tools.find(tool => tool.name === 'motion-apply-exact-edits'); assert.equal(tool.bound, true); assert.equal(tool.approvalRequired, true);
  await exec(process.env.MOTION_NATIVE_BINARY || '/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture', ['--tool-input', native.definition, tool.name, JSON.stringify(input)]);
  const { id, ...body } = input; await nativeCall('/projects/' + id + '/operations', { method: 'POST', body }); return readProject((await nativeCall('/projects/' + id)).project);
}

const masks=p=>compositions(p)[0].kind.layers[0].props.children.find(p=>p.match==='masks').children;
async function addMask(p,shape='rect'){await p.locator('#mask [name=shape]').selectOption(shape);await p.locator('#mask [name=x]').fill('0');await p.locator('#mask [name=y]').fill('0');await p.locator('#mask [name=width]').fill('40');await p.locator('#mask [name=height]').fill('60');await p.locator('#mask button').click();}
test('human saved mask mode, inversion, enable and opacity change real pixels, reopen and undo',async t=>{
 const {p,errors}=await page(t);await create(p,'Manual masks');await add(p,'Red source','#ff0000');await saved(p,2);await addMask(p);await saved(p,3);
 assert.equal((await pixel(p,35))[3],255);assert.equal((await pixel(p,90))[3],0);const original=masks(await document(p))[0];
 await p.locator('#maskSettings [name=name]').fill('Editable crop');await p.locator('#maskSettings [name=inverted]').check();await p.locator('#maskSettings button').click();await saved(p,4);
 assert.equal((await pixel(p,35))[3],0);assert.equal((await pixel(p,90))[3],255);assert.equal(masks(await document(p))[0].uid,original.uid);
 await p.locator('#maskSettings [name=enabled]').uncheck();await p.locator('#maskSettings button').click();await saved(p,5);assert.equal((await pixel(p,35))[3],255);
 await p.locator('#maskSettings [name=enabled]').check();await p.locator('#maskSettings [name=inverted]').uncheck();await p.locator('#maskSettings [name=opacity]').fill('50');await p.locator('#maskSettings button').click();await saved(p,6);assert.equal((await pixel(p,35))[3],128);
 const project=await document(p);assert.equal(masks(project)[0].name,'Editable crop');const writes=http.state.requests.filter(r=>r.path.endsWith('/operations')).length;await p.locator('#maskSettings button').click();assert.equal((await document(p)).revision,6);assert.equal(http.state.requests.filter(r=>r.path.endsWith('/operations')).length,writes);
 await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(project.id);await saved(p,6);assert.equal(await p.locator('#maskSettings [name=opacity]').inputValue(),'50');
 await p.locator('#undo').click();await saved(p,7);assert.equal((await pixel(p,90))[3],255);assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('human native Bezier vertex edits, split/delete, duplicate/order/remove and mask lock preserve history',async t=>{
 const {p,errors}=await page(t);await create(p,'Mask geometry');await add(p,'Red source','#ff0000');await saved(p,2);await addMask(p);await saved(p,3);
 const before=masks(await document(p))[0],path=before.children.find(p=>p.match==='path').value.v;assert.equal(path.vertices.length,4);
 await p.locator('#maskVertex [name=x]').fill('20');await p.locator('#maskVertex [name=outX]').fill('15');await p.locator('#maskVertex [name=outY]').fill('10');await p.locator('#maskVertex button').click();await saved(p,4);
 const altered=masks(await document(p))[0].children.find(p=>p.match==='path').value.v;assert.equal(altered.vertices[0][0],20);assert.deepEqual(altered.out_tangents[0],[15,10]);assert.deepEqual(altered.vertices.slice(1),path.vertices.slice(1));assert.notDeepEqual(await pixel(p,35,17),[255,0,0,255]);
 const svg=await p.locator('#maskPath path').getAttribute('d');assert.match(svg,/ C /);await p.locator('#maskPath circle').nth(1).focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#maskVertices').inputValue(),'1');
 await p.locator('#insertMaskVertex').click();await saved(p,5);assert.equal(masks(await document(p))[0].children.find(p=>p.match==='path').value.v.vertices.length,5);
 await p.locator('#removeMaskVertex').click();await saved(p,6);assert.equal(masks(await document(p))[0].children.find(p=>p.match==='path').value.v.vertices.length,4);
 await p.locator('#duplicateMask').click();await saved(p,7);let current=masks(await document(p));assert.equal(current.length,2);assert.notEqual(current[0].uid,current[1].uid);
 await p.locator('#maskEarlier').click();await saved(p,8);assert.equal(masks(await document(p))[0].uid,current[1].uid);
 await p.locator('#maskLocked').check();await saved(p,9);assert.equal(await p.locator('#maskVertex button').isDisabled(),true);assert.equal(await p.locator('#removeMask').isDisabled(),true);await p.locator('#maskLocked').uncheck();await saved(p,10);
 p.once('dialog',d=>d.accept());await p.locator('#removeMask').click();await saved(p,11);assert.equal(masks(await document(p)).length,1);await p.locator('#undo').click();await saved(p,12);assert.equal(masks(await document(p)).length,2);const selectedMask=parseNative(await p.locator('#savedMasks').inputValue());await p.locator('#maskClosed').uncheck();await saved(p,13);assert.equal(masks(await document(p)).find(g=>g.uid===selectedMask).children.find(p=>p.match==='path').value.v.closed,false);await p.locator('#maskClosed').check();await saved(p,14);assert.equal(masks(await document(p)).find(g=>g.uid===selectedMask).children.find(p=>p.match==='path').value.v.closed,true);const writes=http.state.requests.filter(r=>r.path.endsWith('/operations')).length;await p.locator('#maskVertex button').click();assert.equal((await document(p)).revision,14);assert.equal(http.state.requests.filter(r=>r.path.endsWith('/operations')).length,writes);await p.screenshot({path:'/tmp/oshal-motion-mask-narrow.png',fullPage:true});assert.deepEqual(errors,[]);
});
test('ellipse, feather and expansion produce genuine alpha fringes rather than rectangle coverage',async t=>{
 const {p,errors}=await page(t);await create(p,'Feather ellipse');await add(p,'Red source','#ff0000');await saved(p,2);await addMask(p,'ellipse');await saved(p,3);
 assert.equal((await pixel(p,31,16))[3],0);assert.equal((await pixel(p,50,45))[3],255);
 await p.locator('#maskSettings [name=featherX]').fill('6');await p.locator('#maskSettings [name=featherY]').fill('6');await p.locator('#maskSettings [name=expansion]').fill('3');await p.locator('#maskSettings button').click();await saved(p,4);
 let fringe=false;for(let x=27;x<42;x++){const a=(await pixel(p,x,45))[3];if(a>0&&a<255)fringe=true;}assert.equal(fringe,true);const g=masks(await document(p))[0];assert.deepEqual(g.children.find(p=>p.match==='feather').value.v,[6,6]);assert.equal(g.children.find(p=>p.match==='expansion').value.v,3);assert.deepEqual(errors,[]);
});
test('Reader masks stay inspectable; exact-time keyed paths and wide ids survive unrelated manual edits',async t=>{
 const {p,errors}=await page(t);await create(p,'Keyed mask');await add(p,'Red source','#ff0000');await saved(p,2);await addMask(p);await saved(p,3);
 let seed=await document(p),g=masks(seed)[0],prop=g.children.find(p=>p.match==='path');g.uid=18446744073709551600n;prop.uid=18446744073709551601n;seed.document.next_id=18446744073709551602n;
 prop.keys=[{time:0,value:prop.value,in_interp:'Linear',out_interp:'Linear'},{time:254016000000,value:prop.value,in_interp:'Linear',out_interp:'Linear'}];
 await p.locator('#importDocument [name=document]').setInputFiles({name:'keyed.ecproj',mimeType:'application/json',buffer:Buffer.from(stringifyNative(seed.document))});await p.locator('#importDocument button').click();await saved(p,1);
 await p.locator('#maskVertex button').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#maskVertex button').disabled);assert.match(await p.locator('#maskNote').innerText(),/Native values at current time/);
 const imported=await document(p),savedPath=masks(imported)[0].children.find(p=>p.match==='path');await p.locator('#maskSettings [name=name]').fill('Retained animation');await p.locator('#maskSettings button').click();await saved(p,2);g=masks(await document(p))[0];assert.equal(g.uid,18446744073709551600n);assert.deepEqual(g.children.find(p=>p.match==='path'),savedPath);
 const id=await p.locator('#projects').inputValue();http.state.denied.set('alice',new Set(['project.change','project.create','project.delete','project.export']));try{await p.reload();await p.locator('#status').filter({hasText:'Ready'}).waitFor();await p.locator('#projects').selectOption(id);await saved(p,2);for(const selector of ['#mask button','#maskSettings button','#maskVertex button','#maskLocked','#duplicateMask','#removeMask'])assert.equal(await p.locator(selector).isDisabled(),true,selector);assert.equal(await p.locator('#savedMasks').isDisabled(),false);}finally{http.state.denied.delete('alice');}assert.deepEqual(errors,[]);
});
test('declared approval-held native agent masks share actual pixels and foreign/withdrawn isolation',async()=>{
 let project=readProject((await nativeCall('/projects',{method:'POST',body:{title:'Agent masks',width:160,height:90,duration:5,frameRate:30,requestKey:randomUUID()}})).project),root=compositions(project)[0].id;
 project=await exact(project,root,[{command:'layer.newSolid',params:{name:'Agent source',color:'#ff0000',width:100,height:60}},{command:'layer.addMask',params:{layer:'Agent source',rect:[0,0,40,60]}}]);let layer=compositions(project)[0].kind.layers[0],mask=masks(project)[0];
 project=await exact(project,root,[{command:'layer.select',params:{layers:[layer.id]}},{command:'layer.setMask',params:{layer:layer.id,mask:mask.uid,mode:'Subtract'}},{command:'layer.mask.set',params:{layer:layer.id,mask:mask.uid,field:'feather',value:[3,3]}},{command:'mask.setVertex',params:{layer:layer.id,mask:mask.uid,index:0,point:[10,0],out:[12,6]}}]);
 const preview=await nativeCall('/projects/'+project.id+'/revisions/'+project.revision+'/preview/0/'+root+'/160/1'),{data,info}=await native.sharp(Buffer.from(preview.png,'base64')).raw().toBuffer({resolveWithObject:true});assert.equal(data[(45*info.width+90)*info.channels+3],255);assert.equal(data[(45*info.width+50)*info.channels+3],0);
 await nativeCall('/projects/'+project.id,{actor:'bob'},404);const body={baseRevision:project.revision,requestKey:randomUUID(),compId:String(root),commandsJson:stringifyNative([{command:'mask.remove',params:{layer:layer.id,mask:mask.uid}}])};native.deny('alice','project.change');try{await nativeCall('/projects/'+project.id+'/operations',{method:'POST',body},403);}finally{native.allow('alice','project.change');}assert.deepEqual(readProject((await nativeCall('/projects/'+project.id)).project).document,project.document);
 native.deny('alice','project.read');try{await nativeCall('/projects/'+project.id+'/revisions/'+project.revision+'/preview/0/'+root+'/160/1',{},403);}finally{native.allow('alice','project.read');}await nativeCall('/projects/'+project.id,{method:'DELETE'});
});
