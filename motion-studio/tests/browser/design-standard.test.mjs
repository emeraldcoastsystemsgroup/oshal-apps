/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.3.0, the oshal design standard (docs/ux/design-standard.md §3.1, §3.2, §3.3, §4.3, §4.4, §4.8, §4.10, §5.1; Alight Motion and Node Video, REFP CONVENTIONS §5.4; Roger, trial.oswarm.ai, 2026-11-06, F7). With nothing saved Motion opens on a blank composition whose one primary is Add layer, and the first layer saves it as 1920×1080, 10 s, 30 fps; + Add holds Text, Shape, Solid, Photo and Camera or light with Video and Audio greyed; the phone's bottom bar is Layers · Add · Properties · Concierge · More and a sheet stays clear of it; the phone's Back closes an open sheet and stays in the app; with no layer chosen the panel shows the composition's size, frame rate, duration, background and work area and a greyed Motion blur; a diamond on a property row adds a key at the current time and opens its editor; Undo and Redo step back and forth; a saved composition makes the list the first screen with one + New; Delete asks in the page, never in a browser dialog. Real routes over disposable PostgreSQL, the real framed compositor and the kernel's shared editor from OSHAL_PLATFORM_ROOT.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, RP-MOT-01 & RP-MOT-02: verify live Video… and Audio… menu items in + Add and live Motion blur shutter controls in Composition settings with zero RP-MOT placeholders.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.4.1, RP-ALL-01: verify no duplicate greyed RP-ALL-01 Summarize placeholder is injected beside the kernel's live Summarize prompt chip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {startApplicationFixture,chromium} from '../application-fixture.mjs';
const PHONE={viewport:{width:412,height:743},isMobile:true,hasTouch:true,deviceScaleFactor:2};
const overlaps=(a,b)=>Boolean(a&&b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height);

async function open(t,options=PHONE){
 const f=await startApplicationFixture(),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const page=await (await browser.newContext(options)).newPage(),errors=[],dialogs=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.type());void dialog.dismiss();});
 t.after(()=>{assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[],'no browser alert, confirm or prompt');});page.setDefaultTimeout(30000);
 await page.goto(f.origin+'/api/motion-studio/app');await page.locator('.ef-shell').waitFor();await page.locator('#status').filter({hasText:'Ready'}).waitFor();
 return{f,page,press:locator=>options.hasTouch?locator.tap():locator.click()};
}
const primaries=page=>page.evaluate(()=>[...document.querySelectorAll('button.primary')].filter(node=>node.getClientRects().length&&!node.closest('[hidden]')).map(node=>node.textContent.trim()));
async function addText(page,press){
 await press(page.getByRole('button',{name:'Add layer',exact:true}));await press(page.getByRole('menuitem',{name:'Text',exact:true}));
 await page.locator('#revision').filter({hasText:'revision 2'}).waitFor({timeout:90000});
}

test('a blank composition opens with Add layer as its one primary; + Add holds live Text, Shape, Solid, Photo, Video, Audio and Camera or light; the first layer saves it',{timeout:180000},async t=>{
 const {page,press}=await open(t);
 const contract=await page.evaluate(()=>({category:document.documentElement.dataset.dsCategory,first:document.documentElement.dataset.dsFirstAction,work:document.querySelector('[data-ds-work]')?.id,text:document.body.innerText}));
 assert.deepEqual([contract.category,contract.first,contract.work],['editor','tap','stage']);
 assert.equal(/Create or open a composition|New composition/.test(contract.text),false,'no "create or open" box and no New composition empty state');
 assert.deepEqual(await primaries(page),['Add layer'],'one primary on the blank composition');
 const bar=await page.evaluate(()=>{const row=document.querySelector('.motion-toolrow'),box=row.getBoundingClientRect();return{labels:[...row.querySelectorAll('.motion-tool')].filter(n=>n.getClientRects().length).map(n=>n.querySelector('.motion-word').textContent),bottom:Math.round(box.bottom),height:Math.round(box.height),rows:new Set([...row.children].filter(n=>n.getClientRects().length).map(n=>Math.round(n.getBoundingClientRect().top))).size,innerHeight};});
 assert.deepEqual(bar.labels,['Layers','Add','Properties','Concierge','More']);assert.equal(bar.bottom,bar.innerHeight,'the bottom bar sits at the bottom');assert.equal(bar.rows,1);assert.ok(bar.height>=44&&bar.height<=64,'bar height '+bar.height);
 assert.equal(await page.locator('.ef-panes').isVisible(),false,'no Navigation / Properties / Concierge band above the work');
 await press(page.getByRole('button',{name:'Add layer',exact:true}));
 const menu=page.locator('dialog[open] [role=menu]');await menu.waitFor();
 assert.deepEqual((await menu.locator('[role=menuitem]').allTextContents()).map(text=>text.trim()),['Text','Shape','Solid','Photo…','Video…','Audio…','Camera or light…']);
 const planned=await menu.locator('[data-ds-not-yet]').count();
 assert.equal(planned,0,'RP-MOT-01 placeholders are replaced by live Video… and Audio…');
 assert.equal(await page.locator('[data-ds-backlog="RP-ALL-01"]').count(),0,'no duplicate greyed RP-ALL-01 Summarize placeholder');
 assert.equal(await page.locator('[data-concierge-prompt="Summarize"]').count(),1,'kernel-owned live Summarize prompt is present');
 const sheet=await page.locator('dialog[open]').boundingBox(),row=await page.locator('.motion-toolrow').boundingBox();assert.equal(overlaps(sheet,row),false,'the menu sheet stays clear of the bottom bar '+JSON.stringify({sheet,row}));
 await press(page.getByRole('menuitem',{name:'Text',exact:true}));await page.locator('#revision').filter({hasText:'revision 2'}).waitFor({timeout:90000});
 const saved=await page.evaluate(async()=>{const id=document.getElementById('projects').value,body=JSON.parse(await (await fetch('/api/motion-studio/projects/'+id)).text()),comp=Object.values(body.project.document.items).find(item=>item.kind.type==='Comp').kind;return{width:comp.width,height:comp.height,layers:comp.layers.map(l=>l.name),title:body.project.title};});
 assert.deepEqual(saved,{width:1920,height:1080,layers:['Your caption'],title:'Untitled composition'});
 assert.deepEqual(await primaries(page),['Render'],'with a layer, Render is the one primary');
 assert.equal(await page.locator('#timeline .motion-row-name').filter({hasText:'Your caption'}).isVisible(),true,'the layer is a timeline row');
 assert.equal(await page.locator('#play').isEnabled(),true,'Play is live once there is a layer');
});

test('on a phone the Back button closes an open sheet and stays in the app; with no layer chosen the panel shows the composition and live Motion blur controls',{timeout:180000},async t=>{
 const {page,press}=await open(t);await addText(page,press);
 const before=page.url();await press(page.locator('.motion-tool[data-tool=layers]'));await page.locator('dialog[open]').waitFor();
 await page.goBack();await page.locator('dialog[open]').waitFor({state:'detached'});assert.equal(page.url(),before,'Back closed the sheet, the app stayed');
 await press(page.locator('.motion-tool[data-tool=layers]'));await press(page.getByRole('button',{name:'Composition',exact:true}));await press(page.getByRole('button',{name:'Done',exact:true}));
 await press(page.locator('.motion-tool[data-tool=properties]'));const sheet=page.locator('dialog[open]');await sheet.locator('.motion-comp-settings').waitFor();
 assert.equal((await sheet.locator('.ds-layer-title').textContent()).trim(),'Composition');
 assert.deepEqual(await sheet.locator('.motion-facts dd').allTextContents(),['1920 × 1080','30 fps','10 s','#000000']);
 assert.equal(await sheet.locator('#workArea').isVisible(),true,'the work area is with the composition settings');
 assert.equal(await sheet.locator('#compMotionBlur').isVisible(),true,'Motion blur shutter controls are live in Composition settings');
 assert.equal(await sheet.locator('[data-ds-not-yet]').count(),0,'RP-MOT-02 placeholder is replaced');
 assert.equal(await sheet.evaluate(node=>[...node.querySelectorAll('*')].some(item=>item.children.length===0&&item.textContent.trim()==='No object selected'&&item.getClientRects().length>0)),false,'"No object selected" is never the empty state');
});

test('a diamond on a property row adds a key at the current time and opens it; Undo and Redo step back and forth; Delete asks in the page',{timeout:180000},async t=>{
 const {page,press}=await open(t,{viewport:{width:1440,height:900}});await addText(page,press);
 const diamond=page.locator('.motion-diamond[data-path="transform/position"]');await diamond.waitFor();assert.equal(await diamond.getAttribute('aria-pressed'),'false');
 await press(diamond);await page.locator('#revision').filter({hasText:'revision 3'}).waitFor();await page.locator('#keyEditor').waitFor();
 assert.equal(await page.locator('#timeline .keyButton').count(),1,'the key is a diamond on the timeline');assert.match(await page.locator('#keySummary').textContent(),/Position/);
 await press(page.getByRole('button',{name:'Undo',exact:true}));await page.locator('#revision').filter({hasText:'revision 4'}).waitFor();assert.equal(await page.locator('#timeline .keyButton').count(),0,'Undo removed the key');
 await press(page.getByRole('button',{name:'Redo',exact:true}));await page.locator('#revision').filter({hasText:'revision 5'}).waitFor();assert.equal(await page.locator('#timeline .keyButton').count(),1,'Redo brought it back');
 assert.equal(await page.getByRole('button',{name:'Redo',exact:true}).isDisabled(),true,'nothing more to redo');
 await press(page.locator('.motion-doc'));await press(page.getByRole('menuitem',{name:'Delete composition',exact:true}));
 const confirm=page.locator('dialog[open].ds-confirm');await confirm.waitFor();await press(confirm.getByRole('button',{name:'Cancel',exact:true}));await confirm.waitFor({state:'detached'});
 assert.match(await page.locator('#revision').textContent(),/revision 5/,'Cancel keeps the composition');
});

test('with a composition saved the first screen is the list, newest first, with one + New that opens a blank composition',{timeout:180000},async t=>{
 const {page,press}=await open(t);await addText(page,press);
 await page.reload();await page.locator('.ef-shell').waitFor();const home=page.locator('.motion-home');await home.waitFor();
 assert.deepEqual((await home.locator('.motion-home-row').allTextContents()).map(text=>text.trim()),['Untitled composition']);
 assert.deepEqual(await primaries(page),['+ New'],'one + New on the list');
 await press(page.getByRole('button',{name:'+ New',exact:true}));await home.waitFor({state:'hidden'});assert.deepEqual(await primaries(page),['Add layer']);
 await press(page.locator('.motion-doc'));await press(page.getByRole('menuitem',{name:'Open…',exact:true}));await press(page.locator('dialog[open] .motion-home-row').first());
 await page.locator('#revision').filter({hasText:'revision 2'}).waitFor();assert.equal(await page.locator('#timeline .motion-row-name').count(),1);
});
