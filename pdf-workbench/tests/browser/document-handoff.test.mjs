/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove real PDF jobs finish before handoff, repeat native form/annotation edits, retain concurrent drafts and fence late jobs to their document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { fixture } from '../fixtures/fixture.mjs';
import { requireRuntime } from '../fixtures/runtime.mjs';
const { chromium } = requireRuntime('playwright'), express = requireRuntime('express');
const platform = resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(import.meta.dirname, '../../../../oshal-kernel/platform'));
async function open(t) {
 const f=await fixture({extend:app=>app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')))});t.after(()=>f.close());
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.url+'/api/pdf-workbench/app');
 await page.locator('#file').setInputFiles(join(f.directory,'first.pdf'));await page.locator('#source-title').fill('Owned form');await page.locator('#upload button').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Original PDF preserved'));
 await page.locator('#title').fill('My PDF');await page.locator('#create').click();await page.waitForFunction(()=>document.querySelectorAll('.page').length===2);
 await page.waitForFunction(()=>window.__oshalDocumentSession);
 const api=async(path,body)=>{const response=await fetch(f.url+'/api/pdf-workbench'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
 return{f,page,api,id:new URL(page.url()).searchParams.get('document')};
}
const begin=page=>page.evaluate(async()=>{const api=await import('/shared/ui/js/document-handoff.js');window.handoff=await api.beginDocumentHandoff();return window.handoff.context;});
async function apply(api,id,baseRevision,operations){
 const result=await api('/documents/'+id+'/revisions',{baseRevision,operations,requestKey:randomUUID()});
 for(let n=0;n<100;n++){const {job}=await api('/jobs/'+result.job.id);if(job.state==='ready')return job;if(['failed','cancelled'].includes(job.state))assert.fail(JSON.stringify(job));await pause(100);}assert.fail('Real PDF job did not finish');
}
test('PDF handoffs wait for the actual saved form/page revision and refresh native annotations through repeated manual edits',async t=>{
 const {page,api,id}=await open(t);
 await page.locator('.page input').first().check();await page.locator('#rotate').click();await page.locator('#forms input').first().fill('My handoff value');
 const first=await begin(page);assert.equal(first.recordId,id);assert.equal(first.fields.revision,2);
 let {document}=await api('/documents/'+id);assert.equal(document.model.pages[0].rotation,90);assert.ok(Object.values(document.model.fields).includes('My handoff value'));
 const annotation={id:randomUUID(),page:document.model.pages[0].id,kind:'text',rect:[20,20,160,60],text:'Concierge note',color:'808080'};
 await apply(api,id,first.fields.revision,[{op:'annotate',annotation}]);await page.evaluate(()=>window.handoff.refresh());
 assert.match(await page.locator('#revision').textContent(),/revision 3/);assert.equal(await page.locator('#forms input').first().inputValue(),'My handoff value');
 await page.locator('#forms input').first().fill('My next edit');const second=await begin(page);assert.equal(second.recordId,id);assert.equal(second.fields.revision,4);
 ({document}=await api('/documents/'+id));assert.deepEqual(document.model.annotations[0],annotation);assert.ok(Object.values(document.model.fields).includes('My next edit'));
 await apply(api,id,second.fields.revision,[{op:'rotate',page:document.model.pages[0].id,degrees:90}]);await page.evaluate(()=>window.handoff.refresh());
 assert.match(await page.locator('#revision').textContent(),/revision 5/);assert.equal(await page.locator('.page').count(),2);
 const pdf=await fetch((new URL(await page.locator('#download').getAttribute('href'),page.url())).href);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
});
test('a rejected PDF automatic save blocks the read and preserves the local operation',async t=>{
 const {page,f,api,id}=await open(t);await page.locator('.page input').first().check();await page.locator('#rotate').click();f.states.get('alice').add('document.change');
 await assert.rejects(begin(page));assert.equal((await api('/documents/'+id)).document.revision,1);assert.match(await page.locator('.page img').first().getAttribute('style'),/90deg/);
});
test('PDF refresh retains a concurrent focused form field',async t=>{
 const {page,api,id}=await open(t);const first=await begin(page),{document}=await api('/documents/'+id);
 await page.locator('#forms input').first().fill('My concurrent field');await apply(api,id,first.fields.revision,[{op:'rotate',page:document.model.pages[0].id,degrees:90}]);
 await assert.rejects(page.evaluate(()=>window.handoff.refresh()),/PDF draft is still here/);assert.equal(await page.locator('#forms input').first().inputValue(),'My concurrent field');
});
test('a queued PDF save cannot replace a different document opened before it finishes',async t=>{
 const {page,api,id}=await open(t),{document}=await api('/documents/'+id);
 await page.waitForFunction(()=>[...document.querySelectorAll('.page img')].every(image=>image.complete));
 const second=await api('/documents',{source:document.model.pages[0].source,title:'Other PDF',requestKey:randomUUID()});await page.locator('#refresh').click();await page.getByRole('button',{name:'Other PDF · revision 1',exact:true}).waitFor();
 let arrived,release;const seen=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 await page.route('**/api/pdf-workbench/jobs/*',async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});});
 await page.locator('.page input').first().check();await page.locator('#rotate').click();const handoff=begin(page).then(value=>({value}),error=>({error:error.message}));await seen;
 await page.getByRole('button',{name:'Other PDF · revision 1',exact:true}).click();await page.waitForFunction(()=>document.getElementById('document-title').textContent==='Other PDF');release();
 assert.match((await handoff).error,/open PDF or its draft changed/);assert.equal(await page.locator('#document-title').textContent(),'Other PDF');assert.equal((await begin(page)).recordId,second.document.id);
});

test('a full PDF operation batch is saved before the next unapplied form field',async t=>{
 const {page,api,id}=await open(t);
 await page.evaluate(async()=>{for(let n=0;n<64;n++){document.querySelector('.page input').checked=true;await document.getElementById('rotate').onclick();}});
 await page.locator('#forms input').first().fill('After the full batch');
 const snapshot=await begin(page);assert.equal(snapshot.recordId,id);assert.equal(snapshot.fields.revision,3);
 assert.ok(Object.values((await api('/documents/'+id)).document.model.fields).includes('After the full batch'));
});

test('an approved queued PDF job is awaited before its document refreshes',async t=>{
 const {page,api,id}=await open(t),{document}=await api('/documents/'+id);
 const accepted=await api('/documents/'+id+'/revisions',{baseRevision:1,requestKey:randomUUID(),operations:[{op:'rotate',page:document.model.pages[0].id,degrees:90}]});
 let arrived,release;const seen=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 await page.route('**/api/pdf-workbench/jobs/*',async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});});
 const receipt={job:{id:accepted.job.id,document:id,kind:'revision'}};
 const refreshed=page.evaluate(async completion=>{const api=await import('/shared/ui/js/document-handoff.js');await api.refreshOpenDocument({app:'pdf-workbench',completion});},receipt);
 await seen;assert.match(await page.locator('#revision').textContent(),/revision 1/);release();await refreshed;
 assert.match(await page.locator('#revision').textContent(),/revision 2/);assert.equal((await api('/documents/'+id)).document.model.pages[0].rotation,90);
});
