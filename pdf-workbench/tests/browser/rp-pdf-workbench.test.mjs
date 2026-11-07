/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Browser end-to-end verification of RP-PDF-01..10 and RP-ALL-01 across real UI sheets, canvas gestures, saved revisions and downloads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fixture} from '../fixtures/fixture.mjs';
import {requireRuntime} from '../fixtures/runtime.mjs';
import {uploadAndCreate,closeLayers,leaveMode} from './workbench-ui.mjs';

const {chromium}=requireRuntime('playwright');
const python=()=>process.env.OSHAL_PDF_TEST_PYTHON||'python3';

function makePhotoBuffer(seed,w,h){
 const script=`import io,random,sys;from PIL import Image;random.seed(${seed});im=Image.frombytes('RGB',(${w},${h}),bytes(random.getrandbits(8) for _ in range(${w}*${h}*3)));b=io.BytesIO();im.save(b,'JPEG',quality=96);sys.stdout.buffer.write(b.getvalue())`;
 const out=spawnSync(python(),['-c',script],{maxBuffer:12*1024*1024});
 assert.equal(out.status,0,out.stderr?.toString());
 return out.stdout;
}

test('photos-to-PDF, single/two-page and night views, size reduction and Office conversions work end-to-end in the browser',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.goto(f.url+'/api/pdf-workbench/app');await page.locator('.ef-shell').waitFor();
 await page.locator('#doc-menu').click();await page.getByRole('menuitem',{name:'From photos…'}).click();
 const sheet=page.locator('dialog.ds-layer[open]');await sheet.waitFor();
 await sheet.locator('input[aria-label="Choose photos"]').setInputFiles([
  {name:'alpha.jpg',mimeType:'image/jpeg',buffer:makePhotoBuffer(1,900,600)},
  {name:'beta.jpg',mimeType:'image/jpeg',buffer:makePhotoBuffer(2,600,900)}
 ]);
 await sheet.getByRole('button',{name:'Move photo 2 earlier'}).click();
 await sheet.getByRole('textbox',{name:'Document title'}).fill('Field photos');
 await sheet.getByRole('button',{name:'Create PDF'}).click();
 await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});
 assert.equal(await page.locator('#pages > .page').count(),2);
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Single page'}).click();
 assert.equal(await page.locator('body').getAttribute('data-pdf-layout'),'single');
 assert.equal(await page.locator('.pdf-pager-label').textContent(),'Page 1 of 2');
 await page.getByRole('button',{name:'Next page'}).click();assert.equal(await page.locator('.pdf-pager-label').textContent(),'Page 2 of 2');
 await page.reload();await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});
 assert.equal(await page.locator('body').getAttribute('data-pdf-layout'),'single','single-page layout persisted');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Two pages'}).click();
 assert.equal(await page.locator('body').getAttribute('data-pdf-layout'),'two-page');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Night mode'}).click();
 assert.equal(await page.locator('body').getAttribute('data-pdf-night'),'true');
 assert.equal(await page.locator('#save').isVisible(),false,'night mode and view toggles do not dirty the PDF');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Reduce file size…'}).click();
 const compSheet=page.locator('dialog.ds-layer[open]');await compSheet.getByRole('combobox',{name:'Compression level'}).selectOption('maximum');
 await compSheet.getByRole('button',{name:'Reduce file size'}).click();
 await compSheet.locator('.pdf-sheet-result').waitFor({timeout:60000});
 assert.match(await compSheet.locator('.pdf-sheet-result').textContent(),/Saved:/);
 await closeLayers(page);assert.match(await page.locator('#revision').textContent(),/Saved revision 2/);
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Convert to Word (.docx)…'}).click();
 const convSheet=page.locator('dialog.ds-layer[open]');await convSheet.getByRole('button',{name:'Convert & download'}).click();
 await convSheet.locator('.pdf-sheet-result a').waitFor({timeout:60000});
 const docxHref=await convSheet.locator('.pdf-sheet-result a').getAttribute('href');
 const docxBytes=Buffer.from(await fetch(new URL(docxHref,f.url).href).then(r=>r.arrayBuffer()));
 assert.equal(docxBytes.subarray(0,4).toString('hex'),'504b0304');
 await closeLayers(page);assert.deepEqual(errors,[]);
});

test('word markup, freehand pen and eraser, blank page, check/cross, signature pad with resize and concierge prompts work live',async t=>{
 const conciergeCalls=[];
 const f=await fixture({extend:app=>app.post('/api/swarm/bots/pdf-editor/ask',async(req,res)=>{let raw='';for await(const c of req)raw+=chunkStr(c);conciergeCalls.push(JSON.parse(raw));res.json({reply:'Summary ready.',sessionId:'rp-pdf-session'});})});
 function chunkStr(c){return Buffer.isBuffer(c)?c.toString('utf8'):String(c);}
 t.after(()=>f.close());
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.goto(f.url+'/api/pdf-workbench/app');await page.locator('[data-pdf-view]').first().waitFor();
 await uploadAndCreate(page,join(f.directory,'first.pdf'),'Contract source','Signed contract');
 const textBtn=page.locator('[data-pdf-stage]').first().getByRole('button',{name:/^Text: FIRST PAGE 1/});await textBtn.waitFor();
 const textBox=await textBtn.boundingBox(),stage=page.locator('[data-pdf-stage]').first(),stageBox=await stage.boundingBox();
 await page.locator('.pdf-mode[data-mode="annotate"]').click();
 await page.locator('.pdf-strip [data-pdf-pick="underline"]').click();
 await page.mouse.move(textBox.x+4,textBox.y+textBox.height/2);await page.mouse.down();await page.mouse.move(textBox.x+textBox.width-4,textBox.y+textBox.height/2,{steps:5});await page.mouse.up();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('1 unsaved operation'));
 await page.locator('.pdf-strip [data-pdf-pick="pen"]').click();
 const sx=stageBox.x+stageBox.width*.25,sy=stageBox.y+stageBox.height*.65;
 await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+90,sy+25,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('2 unsaved operation'));
 await page.locator('.pdf-strip [data-pdf-pick="eraser"]').click();
 await page.mouse.move(sx+45,sy+12);await page.mouse.down();await page.mouse.move(sx+50,sy+14);await page.mouse.up();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('3 unsaved operation'));
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await leaveMode(page);await page.locator('.pdf-mode[data-mode="pages"]').click();
 const pagesSheet=page.locator('dialog.ds-layer[open]');await pagesSheet.getByRole('button',{name:'Add blank page'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#pages > .page').length===3);await closeLayers(page);
 await page.locator('.pdf-mode[data-mode="sign"]').click();
 await page.locator('.pdf-strip [data-pdf-pick="check"]').click();
 await page.mouse.click(stageBox.x+stageBox.width*.75,stageBox.y+stageBox.height*.3);
 await page.locator('.pdf-strip').getByRole('button',{name:'Signature'}).click();
 const sigSheet=page.locator('dialog.ds-layer[open]');await sigSheet.waitFor();
 assert.match(await sigSheet.textContent(),/not cryptographic or certified digital signatures/i);
 const padBox=await sigSheet.locator('.pdf-sig-pad').boundingBox();
 await page.mouse.move(padBox.x+40,padBox.y+80);await page.mouse.down();await page.mouse.move(padBox.x+180,padBox.y+60,{steps:6});await page.mouse.up();
 await sigSheet.getByRole('button',{name:'Save & place'}).click();await sigSheet.waitFor({state:'detached'});
 const handle=stage.locator('.pdf-resize-handle');await handle.waitFor();const hb=await handle.boundingBox();
 await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x+30,hb.y+20,{steps:4});await page.mouse.up();
 await leaveMode(page);
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export',exact:true}).click()]);
 const exported=await readFile(await download.path());assert.equal(exported.subarray(0,5).toString(),'%PDF-');
 const id=new URL(page.url()).searchParams.get('document'),saved=(await(await fetch(`${f.url}/api/pdf-workbench/documents/${id}`)).json()).document;
 assert.equal(saved.model.pages.length,3);
 assert.ok(saved.model.annotations.some(a=>a.kind==='underline'&&Array.isArray(a.quadPoints)&&a.quadPoints.length>=1));
 assert.ok(saved.model.annotations.some(a=>a.kind==='ink'));
 assert.ok(saved.model.objects.some(o=>o.kind==='check')&&saved.model.objects.some(o=>o.kind==='image'));
 await page.locator('.pdf-mode[data-mode="concierge"]').click();
 await page.getByRole('button',{name:'Summarize this PDF',exact:true}).click();
 await page.getByText('Summary ready.',{exact:true}).waitFor({timeout:30000});
 assert.equal(conciergeCalls.length,1);assert.match(conciergeCalls[0].message,/Summarize this PDF/);
 assert.deepEqual(errors,[]);
});
