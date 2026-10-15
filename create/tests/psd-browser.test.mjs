/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove human PSD review/cancellation, editable pixels/history/save/reopen and original download in real desktop/phone Chromium.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireCore } from './project-api.fixture.mjs';
import { psdBrowserFixture } from './psd-browser.fixture.mjs';
import { groupedPsd, makePsd } from './fixtures/psd-fixtures.mjs';
const { chromium } = requireCore('playwright');
test('real desktop and phone PSD controls retain editable pixels, history and immutable original', async t => {
  const api = await psdBrowserFixture(t), browser = await chromium.launch({ headless:true });t.after(()=>browser.close());
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}])await t.test(`PSD human workflow ${viewport.width}px`,async()=>{
    const context=await browser.newContext({viewport}),page=await context.newPage();try{
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(api.origin+'/api/create/editor');await page.locator('#importPsd').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('importPsd').disabled);
      const before=(await api.call('/projects')).body.projects.length,bytes=groupedPsd();
      await page.locator('#psdFile').setInputFiles({name:'editable.psd',mimeType:'image/vnd.adobe.photoshop',buffer:bytes});
      await page.locator('#psdReview').waitFor({state:'visible'});assert.equal((await api.call('/projects')).body.projects.length,before);
      assert.equal(await page.locator('#psdReview').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
      assert.match(await page.locator('#psdReview').innerText(),/exact original PSD/);await page.locator('#psdCancel').click();assert.equal((await api.call('/projects')).body.projects.length,before);
      await page.locator('#psdFile').setInputFiles({name:'editable.psd',mimeType:'image/vnd.adobe.photoshop',buffer:bytes});await page.locator('#psdReview').waitFor({state:'visible'});
      await page.locator('#psdTitle').fill(`PSD human${viewport.width}`);await page.locator('#psdConfirm').click();await page.locator('#psdReview').waitFor({state:'detached'});
      const record=(await api.call('/projects')).body.projects.find(p=>p.title===`PSD human${viewport.width}`);assert.ok(record);
      await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('Saved')||!document.getElementById('psdSource').disabled);
      const doc=(await api.call('/projects/'+record.id)).body.project.document;assert.equal(doc.layers.at(-1).type,'group');assert.equal(doc.layers.at(-1).name,'Grüppe 🎨');
      const pixels=await page.evaluate(async()=>{
        const {state}=await import('/api/create/editor/editor-state.mjs'),{exportProjectImage}=await import('/api/create/editor/renderer.mjs');
        const bitmap=await createImageBitmap(await exportProjectImage(state.project)),canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
        canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return [...canvas.getContext('2d').getImageData(1,1,1,1).data];
      });assert.equal(pixels[3],255);for(const[index,expected]of[128,0,127].entries())assert.ok(Math.abs(pixels[index]-expected)<=1,`isolated opacity reference channel${index}: ${pixels[index]} vs ${expected}; tolerance1`);
      await page.evaluate(async()=>{const {state,edit}=await import('/api/create/editor/editor-state.mjs');state.selected='psd-1';edit({type:'update',id:'psd-1',patch:{opacity:.25,x:1}});});
      await page.locator('#undo').click();assert.equal(await page.evaluate(async()=>{const{state}=await import('/api/create/editor/editor-state.mjs');return state.project.layers.find(l=>l.id==='psd-1').opacity}),1);
      await page.locator('#redo').click();await page.locator('#saveProject').click();await page.waitForFunction(async()=>{const{state}=await import('/api/create/editor/editor-state.mjs');return!state.saving&&state.revision===2;});
      await page.goto(api.origin+'/api/create/editor?project='+record.id);await page.waitForFunction(()=>!document.getElementById('psdSource').disabled);
      const saved=await api.call('/projects/'+record.id);assert.equal(saved.body.project.revision,2);assert.equal(saved.body.project.document.layers.find(l=>l.id==='psd-1').opacity,.25);
      await page.locator('#psdSource').click();await page.locator('#psdSourceDetails').waitFor({state:'visible'});
      assert.equal(await page.locator('#psdSourceDetails').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
      const downloading=page.waitForEvent('download');await page.locator('#psdDownloadOriginal').click();const download=await downloading;assert.deepEqual(await readFile(await download.path()),bytes);await page.getByRole('button',{name:'Close',exact:true}).click();
      const flat=makePsd({layers:[{tag:'TySh'}],color:[1,2,3]});await page.locator('#psdFile').setInputFiles({name:'unsupported.psd',mimeType:'image/vnd.adobe.photoshop',buffer:flat});await page.locator('#psdReview').waitFor({state:'visible'});
      const option=await page.locator('#psdMode option[value="editable"]').evaluate(e=>({disabled:e.disabled,html:e.outerHTML,report:document.getElementById('psdLossReport').textContent}));
      assert.equal(option.disabled,true,JSON.stringify(option));assert.match(await page.locator('#psdLossReport').innerText(),/Photoshop text/);
      await page.locator('#psdCancel').click();assert.equal((await api.call('/projects')).body.projects.length,before+1);
      assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    }finally{await context.close();}
  });
  await t.test('a discarded real publication response retries the same sealed import without duplicate projects/assets',async()=>{
    const context=await browser.newContext(),page=await context.newPage();try{
      await page.goto(api.origin+'/api/create/editor');await page.waitForFunction(()=>!document.getElementById('importPsd').disabled);
      const before=(await api.call('/projects')).body.projects.length,bytes=groupedPsd();let published=null;
      await page.route('**/api/create/psd-imports',async route=>{
        if(published){await route.continue();return;}
        const response=await route.fetch();published={status:response.status(),body:await response.json()};await route.abort('failed');
      });
      await page.locator('#psdFile').setInputFiles({name:'uncertain.psd',mimeType:'image/vnd.adobe.photoshop',buffer:bytes});await page.locator('#psdReview').waitFor({state:'visible'});
      await page.locator('#psdTitle').fill('Uncertain actual publication');await page.locator('#psdConfirm').click();await page.locator('#psdConfirm').getByText('Retry same import').waitFor();
      assert.equal(published.status,201);assert.equal(published.body.replayed,false);assert.equal((await api.call('/projects')).body.projects.length,before+1);
      assert.equal(await page.locator('#psdTitle').isDisabled(),true);assert.equal(await page.locator('#psdMode').isDisabled(),true);
      const retry=page.waitForResponse(response=>response.url().endsWith('/psd-imports'));await page.locator('#psdConfirm').click();const result=await(await retry).json();
      assert.equal(result.replayed,true);assert.equal(result.project.id,published.body.project.id);await page.locator('#psdReview').waitFor({state:'detached'});
      assert.equal((await api.call('/projects')).body.projects.length,before+1);
    }finally{await context.close();}
  });
});
