/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real PDF object selection, focused-property save, inline text, draft rendering, phone drawers and native exports.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | PDF Workbench 0.3.0 (the oshal design standard): the proofs upload through the Originals sheet, rotate through the Pages sheet, fill forms through the Form fields sheet, select shapes on the page and, on a phone, adjust through the Edit mode's Format sheet; Save shows only while there is something to save.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98; Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The AI cases ask in the window through the fixture's stand-in kernel: the person's words alone reach pdf-editor as PDF Workbench, with the automatically saved revision and the selected object on the context, and the answer shows in the window. The approval-card case shows the card in the window, bound to the saved revision, while native inline and form edits stay local and nothing runs before Approve; it no longer asserts that a native edit retires the waiting card: the new pane has no card retirement (its invalidate is empty on kernel 0ed7f44b), so that guard went with the old pane. Each card has its own id, as the window presents an id once.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The concierge each case opens is asserted by its address (the coordinator's rule after Roger's 2026-11-17 02:22Z report, where a concierge opened as another application's): the one chat window, /api/jarvis/?concierge=pdf-workbench&bot=pdf-editor, read with scripts/one-chat-window/today-host.mjs windowAddress.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Return to the chat through its message field before inspecting a waiting card; the shared window revalidates approvals when focus returns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fixture} from '../fixtures/fixture.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
import {uploadAndCreate,rotateFirstPage,openFormFields,openFormat,editMode} from './workbench-ui.mjs';
import {chatWindow,sendInWindow} from '../../../scripts/one-chat-window/kernel-window.mjs';
import {windowAddress} from '../../../scripts/one-chat-window/today-host.mjs';
const {chromium}=requireRuntime('playwright');
const click=locator=>locator.click();
/** The concierge, opened where it is closed: it is the one chat window inside the pane. */
async function concierge(page){if(!await page.locator('.ef-ai').isVisible())await page.getByRole('button',{name:'Concierge',exact:true}).click();const chat=await chatWindow(page.locator('.ef-assistant'));
 const where=await windowAddress(page.locator('.ef-assistant'));assert.deepEqual([where.path,where.app,where.bot],['/api/jarvis/','pdf-workbench','pdf-editor'],'the Concierge opens the one chat window as PDF Workbench\'s own concierge');return chat;}
async function open(t,options={}){
 const f=await fixture(options);t.after(()=>f.close());if(options.prepare)await options.prepare(f.directory);const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('PDF browser error:',error.message);});page.on('response',async response=>{if(response.url().includes('/draft-preview')&&response.status()>=400)console.error('PDF draft preview refused:',response.status(),await response.text());});page.on('dialog',dialog=>dialog.accept());
 await page.goto(f.url+'/api/pdf-workbench/app');await page.locator('[data-pdf-view]').first().waitFor();await uploadAndCreate(page,join(f.directory,'first.pdf'),'Original owned PDF','Editable PDF');await page.locator('.pdf-object').first().waitFor();
 const id=new URL(page.url()).searchParams.get('document');return{f,page,id,errors};
}
const textObject=page=>page.locator('[data-pdf-stage]').first().getByRole('button',{name:/^Text: FIRST PAGE 1/});
test('selected original PDF objects edit in place, save focused fields, undo and export actual changed bytes',async t=>{
 const {f,page,id,errors}=await open(t);
 assert.ok(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()));assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isVisible(),false,'nothing to save yet');
 await textObject(page).click();const text=page.getByRole('textbox',{name:'Text',exact:true});await text.fill('HUMAN EDIT');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 2'),null,{timeout:60000});
 let current=await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json();assert.equal(current.document.model.contentEdits[0].properties.text,'HUMAN EDIT');
 let object=page.locator('[data-pdf-stage]').first().getByRole('button',{name:'Text: HUMAN EDIT',exact:true});await object.dblclick();const inline=page.getByRole('textbox',{name:'Edit selected PDF text'});await inline.fill('INLINE EDIT');await inline.press('Enter');assert.equal(await inline.count(),0);
 await page.locator('.preview-pending').first().waitFor({state:'hidden',timeout:60000});
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('textbox',{name:'Text',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Text',exact:true}).inputValue(),'HUMAN EDIT');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByRole('textbox',{name:'Text',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Text',exact:true}).inputValue(),'INLINE EDIT');
 await page.getByRole('spinbutton',{name:'X',exact:true}).fill('15');await page.getByRole('spinbutton',{name:'X',exact:true}).press('Enter');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 3'),null,{timeout:60000});
 const [downloaded]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export',exact:true}).click()]);assert.equal((await readFile(await downloaded.path())).subarray(0,5).toString(),'%PDF-');
 const decoded=spawnSync('pdftotext',[await downloaded.path(),'-'],{encoding:'utf8'});assert.equal(decoded.status,0);assert.match(decoded.stdout,/INLINE EDIT/);assert.doesNotMatch(decoded.stdout,/FIRST PAGE 1/);
 await page.reload();await page.locator('[data-pdf-stage]').first().getByRole('button',{name:'Text: INLINE EDIT',exact:true}).click();assert.equal(await page.getByRole('spinbutton',{name:'X',exact:true}).inputValue(),'15');
 if(process.env.EDITOR_REVIEW_SCREENSHOT_DIR){await page.waitForFunction(()=>{const image=document.querySelector('.page img');return image.complete&&image.naturalWidth>0;});const directory=process.env.EDITOR_REVIEW_SCREENSHOT_DIR;await mkdir(directory,{recursive:true});await page.screenshot({path:join(directory,'pdf-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(directory,'pdf-phone-document.png')});await page.getByRole('button',{name:'Properties',exact:true}).click();await page.screenshot({path:join(directory,'pdf-phone-properties.png')});}
 assert.deepEqual(errors,[]);
});
test('invalid PDF property is retained, phone drawers work and AI reads the automatically saved revision',async t=>{
 const {f,page,id,errors}=await open(t,{answer:()=>'Saved selection received.'});
 await textObject(page).click();const x=page.getByRole('spinbutton',{name:'X',exact:true});await x.fill('-20');await x.press('Enter');assert.equal(await x.inputValue(),'-20');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ef-property-error')?.textContent||document.querySelector('[aria-invalid="true"]'));
 assert.equal((await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json()).document.revision,1);
 await x.fill('12');await x.press('Enter');const chat=await concierge(page);const {ask,answer}=await sendInWindow(chat,'Read the selected text.',click,f.kernel,60000);
 assert.match(await answer.textContent(),/Saved selection received\./,'the answer shows in the window');
 assert.equal(f.kernel.asks.length,1);assert.deepEqual([ask.bot,ask.context.app,ask.message],['pdf-editor','pdf-workbench','Read the selected text.'],'the person\'s words alone reach PDF Workbench\'s bot');
 assert.equal(ask.context.recordId,id);assert.equal(ask.context.fields.revision,2);assert.ok(ask.context.selection[0].includes('/o'));
 assert.equal((await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json()).document.revision,2);
 await page.setViewportSize({width:390,height:844});await openFormat(page);await page.getByRole('spinbutton',{name:'X',exact:true}).waitFor();assert.equal(await page.getByRole('spinbutton',{name:'X',exact:true}).inputValue(),'12');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
});
test('owned transparent images save once, keep asset references through history and refuse foreign or retained-image deletion',async t=>{
 const {f,page,id,errors}=await open(t),python=process.env.OSHAL_PDF_TEST_PYTHON;
 const png=spawnSync(python,['-c',"from PIL import Image;import io,sys;b=io.BytesIO();Image.new('RGBA',(4,4),(255,0,0,128)).save(b,format='PNG');sys.stdout.buffer.write(b.getvalue())"]);assert.equal(png.status,0);
 await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({name:'Transparent source.png',mimeType:'image/png',buffer:png.stdout});await page.locator('[data-pdf-stage]').first().getByRole('button',{name:'image object',exact:true}).waitFor();
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 2'),null,{timeout:60000});
 let saved=(await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json()).document;const image=saved.model.objects.find(o=>o.kind==='image');assert.ok(image.asset);assert.equal(image.image,undefined);assert.ok(JSON.stringify(saved.model).length<2000);
 await page.locator('[data-pdf-stage]').first().getByRole('button',{name:'image object',exact:true}).click();await page.getByRole('spinbutton',{name:'Opacity',exact:true}).fill('50');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 3'),null,{timeout:60000});
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pdf_image_assets')).rows[0].n,1);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pdf_revision_images')).rows[0].n,2);
 const part=await(await fetch(f.url+`/api/pdf-workbench/documents/${id}/model/objects/0?query=${encodeURIComponent(image.page+'/'+image.id)}`)).json();assert.equal(part.value.id,image.id);assert.ok(Math.abs(part.value.opacity-.5)<.01);
 assert.equal((await fetch(f.url+'/api/pdf-workbench/image-assets/'+image.asset,{method:'DELETE',headers:{'x-test-owner':'bob'}})).status,404);
 assert.equal((await fetch(f.url+'/api/pdf-workbench/image-assets/'+image.asset,{method:'DELETE'})).status,409);
 assert.equal((await fetch(f.url+'/api/pdf-workbench/documents/'+id,{method:'DELETE'})).status,200);assert.equal((await fetch(f.url+'/api/pdf-workbench/image-assets/'+image.asset,{method:'DELETE'})).status,200);assert.deepEqual(errors,[]);
});


test('one click selects the next PDF object after committing a valid property draft, and Undo restores saved pixels',async t=>{
 const {f,page,id,errors}=await open(t),originalImage=await page.locator('.page img').first().getAttribute('src');
 const originalShape=page.locator('[data-pdf-stage]').first().getByRole('button',{name:'path object',exact:true}).first();await editMode(page);await originalShape.click();assert.equal(await page.getByRole('button',{name:'Delete object',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Delete object',exact:true}).click();assert.equal(await originalShape.count(),0);await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await originalShape.count(),1);
 await textObject(page).click();const size=page.getByRole('spinbutton',{name:'Font size',exact:true}),originalSize=await size.inputValue();await size.fill('32');
 const shape=page.locator('[data-pdf-stage]').first().getByRole('button',{name:'path object',exact:true}).first();await shape.click();await page.getByRole('spinbutton',{name:'Line weight',exact:true}).waitFor();assert.equal(await shape.getAttribute('aria-pressed'),'true');
 await page.waitForFunction(()=>document.querySelector('.page img').getAttribute('src').startsWith('data:image/png;base64,'),null,{timeout:60000});await page.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal(await page.locator('.page img').first().getAttribute('src'),originalImage);await textObject(page).click();assert.equal(await page.getByRole('spinbutton',{name:'Font size',exact:true}).inputValue(),originalSize);
 await rotateFirstPage(page);await textObject(page).click();const y=Number(await page.getByRole('spinbutton',{name:'Y',exact:true}).inputValue()),x=Number(await page.getByRole('spinbutton',{name:'X',exact:true}).inputValue());await textObject(page).press('ArrowRight');assert.ok(Math.abs(Number(await page.getByRole('spinbutton',{name:'Y',exact:true}).inputValue())-y-1)<.01);assert.equal(Number(await page.getByRole('spinbutton',{name:'X',exact:true}).inputValue()),x);
 const saved=(await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json()).document;assert.equal(saved.revision,1);assert.equal(saved.model.contentEdits?.length??0,0);assert.deepEqual(errors,[]);
});


test('an approval card waits in the window, bound to the saved revision, while native inline and form edits stay local and nothing runs before Approve',async t=>{
 // The card is the controller-issued proposal for the turn's own saved document and revision; its current state and its
 // execution are this suite's explicit seams (execution is refused, so the proof is that nothing is asked to run).
 const proposals=new Map();let executed=0;
 const {f,page,id,errors}=await open(t,{
  answer:ask=>{const proposal={id:'pdf-fixture-held-'+(proposals.size+1),app:'pdf-workbench',toolName:'pdf-apply-operations',mode:'ask',label:'Change the selected PDF text.',input:{id:ask.context.recordId,baseRevision:ask.context.fields.revision,operations:[]},expiresAt:new Date(Date.now()+120000).toISOString()};proposals.set(proposal.id,proposal);return{answer:'Review the selected text change.',packageToolProposal:proposal};},
  extend:app=>{
   app.get('/api/jarvis/package-tools/proposals/:id',(req,res)=>proposals.has(req.params.id)?res.json(proposals.get(req.params.id)):res.status(404).json({error:'not_found'}));
   app.post('/api/jarvis/package-tools/execute',(_req,res)=>{executed++;res.status(500).json({error:'No fixture execution is permitted.'});});
  }});
 await textObject(page).click();
 // The nth turn's own answer (the earlier one has the same words), then its card's Approve.
 const ask=async n=>{const chat=await concierge(page),{ask}=await sendInWindow(chat,'Change the selected text.',click,f.kernel);
  await chat.locator('#convo .msg.bot .bx').filter({hasText:'Review the selected text change.'}).nth(n-1).waitFor();
  // Return to this window before inspecting its held card; approvals revalidate after focus returns.
  await chat.getByRole('textbox',{name:'Message Jarvis',exact:true}).click();
  await chat.getByRole('button',{name:'Approve',exact:true}).waitFor();return{chat,ask};};
 let {chat,ask:turn}=await ask(1);
 assert.deepEqual([turn.bot,turn.context.app,turn.context.recordId,turn.context.fields.revision,turn.message],['pdf-editor','pdf-workbench',id,1,'Change the selected text.'],'the card is asked for this saved document at revision 1');
 await textObject(page).dblclick();await page.getByRole('textbox',{name:'Edit selected PDF text'}).fill('A still local inline edit');await page.getByRole('textbox',{name:'Edit selected PDF text'}).press('Escape');
 ({chat,ask:turn}=await ask(2));assert.equal(turn.context.fields.revision,1,'the second turn is still about revision 1');
 assert.equal(await chat.getByRole('button',{name:'Approve',exact:true}).count(),1,'one reply\'s card waits at a time');
 await openFormFields(page);await page.locator('#forms input').first().fill('A still local form edit');await page.locator('dialog.ds-layer[open] .ds-layer-done').click();await concierge(page);
 assert.equal(executed,0,'nothing runs before the person approves');assert.equal((await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json()).document.revision,1,'the native edits stay local');assert.deepEqual(errors,[]);
});


test('embedded source fonts keep real geometry controls and enable text only after explicit standard-font choice',async t=>{
 const {f,page,id,errors}=await open(t,{prepare:async directory=>{const built=spawnSync(process.env.OSHAL_PDF_TEST_PYTHON,[join(import.meta.dirname,'../fixtures/build-font-fixtures.py'),directory]);assert.equal(built.status,0,built.stderr?.toString());await copyFile(join(directory,'embedded-font.pdf'),join(directory,'first.pdf'));}});
 const run=page.locator('[data-pdf-stage]').first().getByRole('button',{name:/^Text: café/});await run.click();
 const text=page.getByRole('textbox',{name:'Text',exact:true}),size=page.getByRole('spinbutton',{name:'Font size',exact:true}),font=page.getByRole('combobox',{name:'Font',exact:true});
 assert.equal(await text.isDisabled(),true);assert.equal(await size.isDisabled(),true);assert.equal(await font.isEnabled(),true);assert.equal(await page.getByRole('spinbutton',{name:'X',exact:true}).isEnabled(),true);
 await run.dblclick();assert.equal(await page.getByRole('textbox',{name:'Edit selected PDF text'}).count(),0);
 await font.selectOption('Helvetica');await page.waitForFunction(()=>!document.querySelector('[data-editor-property="text"]').disabled);
 assert.equal(await size.isEnabled(),true);await text.fill('Explicit café Z');await text.press('Enter');await size.fill('26');await size.press('Enter');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.getElementById('revision').textContent.includes('Saved revision 2'),null,{timeout:60000});
 const saved=(await(await fetch(f.url+'/api/pdf-workbench/documents/'+id)).json()).document;assert.equal(saved.model.contentEdits[0].properties.font,'Helvetica');assert.equal(saved.model.contentEdits[0].properties.text,'Explicit café Z');assert.equal(saved.model.contentEdits[0].properties.fontSize,26);assert.deepEqual(errors,[]);
});
