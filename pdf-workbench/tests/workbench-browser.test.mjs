/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real human browser upload/edit/undo/form/save/reopen/history and protected PDF download.
 * The external source fixture has genuine SQL/framed rendering; original admission and kept-run wrappers are named seams, not installed proof.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {resolve,join} from 'node:path';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/fixture.mjs';
const require=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN??resolve(import.meta.dirname,'../../scripts/toolchain'),'package.json')),{chromium}=require('playwright');
test('human PDF controls persist real forms/rotated pages/history and original bytes',async()=>{
 const f=await fixture();let browser,page;
 try{
  browser=await chromium.launch({headless:true,...(process.env.OSHAL_TEST_CHROMIUM?{executablePath:process.env.OSHAL_TEST_CHROMIUM}:{})});page=await browser.newPage({viewport:{width:900,height:900}});await page.goto(f.url+'/api/pdf-workbench/app');
  await page.locator('#file').setInputFiles(join(f.directory,'first.pdf'));await page.locator('#source-title').fill('Owned first form');await page.locator('#upload button').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Original PDF preserved'));
  await page.locator('#title').fill('Human PDF');await page.locator('#create').click();await page.waitForFunction(()=>document.querySelectorAll('.page').length===2);
  await page.locator('.page input').first().check();await page.locator('#rotate').click();await page.locator('#undo').click();await page.locator('#redo').click();
  const name=page.locator('#forms input').first();await name.fill('HUMAN VALUE');await page.locator('#fill').click();await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 2'),null,{timeout:60000});
  const document=new URL(page.url()).searchParams.get('document');assert.ok(document);const saved=await(await fetch(f.url+'/api/pdf-workbench/documents/'+document)).json();assert.equal(saved.document.model.pages[0].rotation,90);assert.ok(Object.values(saved.document.model.fields).includes('HUMAN VALUE'));
  const download=await fetch(f.url+`/api/pdf-workbench/documents/${document}/revisions/2/content`);assert.equal(download.status,200);assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  await page.reload();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 2'));await page.locator('#history').selectOption('1');await page.locator('#open-history').click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 1'));assert.equal(await page.locator('#forms input').first().inputValue(),'Original');
  await page.locator('#restore').click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 3'),null,{timeout:60000});assert.equal((await(await fetch(f.url+'/api/pdf-workbench/documents/'+document)).json()).document.model.pages[0].rotation,0);
  assert.equal((await fetch(f.url+'/api/pdf-workbench/documents/'+document,{headers:{'x-test-owner':'bob'}})).status,404);
  f.states.get('alice').add('document.export');assert.equal((await fetch(f.url+`/api/pdf-workbench/documents/${document}/revisions/3/content`)).status,403);f.states.get('alice').delete('document.export');
  // Native handles are not mocked into a source fixture; unavailable native rail refuses.
  const refused=await fetch(f.url+'/api/pdf-workbench/sources/import-artifact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:'art_'+'a'.repeat(64),title:'Handle',requestKey:randomUUID()})});assert.equal(refused.status,503);
 }catch(error){console.error('PDF browser status:',await page?.locator('#status').textContent());console.error('PDF job states:',(await f.db.query('SELECT state,kind,error FROM pdf_jobs ORDER BY created_at')).rows);throw error;}finally{await browser?.close();await f.close();}
});
