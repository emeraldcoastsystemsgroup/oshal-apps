/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Phone and desktop shared concierge over local HTTP: open, native ask, close/reopen, geometry and one entry; no live service or provider.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: once a reply is in the conversation the help line and the suggestion chips are not shown.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: on a phone the pane is left by its header's Back to Home (the page's name in Career's bar) and the cross is not shown; on a desktop the cross stays. Coming back with Concierge shows the same conversation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The skip names OSHAL_KERNEL_PLATFORM, which the store gate now supplies, so these cases run in the gate instead of skipping.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The pane is the kernel's one chat window (kernel 00c62f98, Roger 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The cases drive the window inside the pane: its model menu, Files, Tap to talk, Keep trying and conversations are shown, a model picked for the request rides on the turn's context, the person's words reach Career's bot with Career's context, the window's own Close closes the pane at both widths (the pane's header, with Career's Back, steps aside once the window is there: one header), the conversation is still there when the pane opens again, and the window's message box sits inside the pane. A registered draft is saved once before the turn and read once after it; a draft changed while the answer waits is kept and not read over (the window shows the answer; the kernel's tools keep their own revision checks).
 */
import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {startConciergeFixture,chromium,sharedRoot} from './helpers/career-concierge-fixture.mjs';
import {chatWindow,windowControls,pickModel,sendInWindow} from '../../scripts/one-chat-window/kernel-window.mjs';
const needsShared={skip:!sharedRoot&&'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (read only)'};
const click=locator=>locator.click();
let browser,fixture;
before(async()=>{fixture=await startConciergeFixture();browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await fixture?.close();});
for(const host of ['native','cockpit'])for(const width of [412,1280])test(`${host} ${width}: the concierge is the one chat window, in place of the fly-in and the unformatted bar`,needsShared,async()=>{
 const context=await browser.newContext({viewport:{width,height:915}}),page=await context.newPage();
 try{
  const external=[];await context.route('**/*',route=>{if(new URL(route.request().url()).origin===fixture.origin)return route.continue();external.push(route.request().url());return route.abort();});
  await page.goto(fixture.origin+'/fixture/'+host);
  const frame=page.frameLocator('iframe');const toggle=frame.getByRole('button',{name:'Concierge',exact:true});
  await toggle.waitFor({timeout:4000});await toggle.click();
  const panel=frame.locator('.ef-assistant');await panel.waitFor({state:'visible',timeout:4000});
  const boundary=await page.evaluate(()=>{const frame=document.querySelector('iframe');return{legacy:getComputedStyle(document.querySelector('#active-app-concierge,.chat-panel')).display,bar:getComputedStyle(document.querySelector('.app-focus-bar,.tool-view-header')).display};});
  assert.deepEqual(boundary,{legacy:'none',bar:'none'});
  const chat=await chatWindow(panel);await windowControls(chat);
  assert.equal(await pickModel(chat,click),'Picked model','the model picked for this request is shown on the control');
  const {ask,answer}=await sendInWindow(chat,'is my resume loaded',click,fixture.kernel);
  assert.deepEqual([ask.door,ask.message,ask.context.app],['/api/swarm/bots/career-concierge/ask','is my resume loaded','career-hunter'],'the person\'s words reach Career\'s bot as Career');
  assert.deepEqual([ask.context.provider,ask.context.model],['picked','picked-model'],'the pick rides on that request');
  await answer.getByText(/résumé is saved/).waitFor();
  assert.equal(await chat.locator('.jc-concierge-help').isVisible(),false,'with a conversation the help line steps aside');
  await panel.locator('.ef-assistant-header').waitFor({state:'hidden',timeout:5000});
  const box=await panel.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=915+1);
  const composer=await chat.locator('.jc-composer').boundingBox();
  assert.ok(composer.x>=box.x-1&&composer.x+composer.width<=box.x+box.width+1&&composer.y+composer.height<=box.y+box.height+1,'the message box sits inside the pane');
  const metrics=await panel.evaluate(node=>({border:getComputedStyle(node.parentElement).borderLeftWidth,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(metrics.overflow,false);if(width===1280)assert.equal(metrics.border,'1px');
  if(process.env.CAREER_CONCIERGE_SCREENSHOTS&&host==='native')await page.screenshot({path:path.join(process.env.CAREER_CONCIERGE_SCREENSHOTS,`concierge-${width}.png`)});
  // One header: the window's, with its own Close, at both widths; it closes the pane and keeps the conversation.
  await click(chat.locator('.jc-header .jc-panel-close'));
  await panel.waitFor({state:'hidden'});await toggle.click();await panel.waitFor({state:'visible'});
  assert.equal(await chat.locator('#convo .msg.bot').count(),1,'the conversation is still there');
  assert.equal(await frame.locator('.ef-assistant').count(),1);assert.deepEqual(external,[]);
 }finally{await context.close();}
});
test('Career imports the same shared assistant as the résumé document, without copying it',()=>{
 const file=path.resolve(import.meta.dirname,'../tools/career-concierge.mjs');assert.equal(fs.existsSync(file),true);
 assert.match(fs.readFileSync(file,'utf8'),/import\('\/shared\/ui\/js\/editor-assistant.js'\)/);
 assert.match(fs.readFileSync(path.resolve(import.meta.dirname,'../../presentations/tools/office/controller.mjs'),'utf8'),/import\('\/shared\/ui\/js\/editor-assistant.js'\)/);
});

test('registered Career draft is saved once before asking and refreshed once after the shared turn',needsShared,async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:915}}),page=await context.newPage();
 try{await page.goto(fixture.origin+'/fixture/native');const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Concierge',exact:true}).waitFor();
  await page.frames()[1].evaluate(async()=>{const{registerDocumentSession}=await import('/shared/ui/js/document-handoff.js');window.fixtureHandoff={prepared:0,refreshed:0};registerDocumentSession({app:'career-hunter',prepare:async()=>{window.fixtureHandoff.prepared++;return{recordId:'fictional-plan',fields:{revision:7}};},refresh:async()=>{window.fixtureHandoff.refreshed++;}});});
  await frame.getByRole('button',{name:'Concierge',exact:true}).click();
  const chat=await chatWindow(frame.locator('.ef-assistant'));
  const {ask}=await sendInWindow(chat,'Check my saved profile',click,fixture.kernel);
  await page.frames()[1].waitForFunction(()=>window.fixtureHandoff.refreshed>0,null,{timeout:10000});
  assert.deepEqual(await page.frames()[1].evaluate(()=>window.fixtureHandoff),{prepared:1,refreshed:1});
  assert.deepEqual([ask.context.app,ask.context.recordId,ask.context.fields.revision],['career-hunter','fictional-plan',7],'the saved document travels on the turn\'s context');
  assert.equal(ask.message,'Check my saved profile','the person\'s words alone: the document is on the context');
 }finally{await context.close();}
});

test('manual draft changes while an answer waits keep that draft, and the page is not read over it',needsShared,async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:915}}),page=await context.newPage();let answer,arrived;
 const held=new Promise(done=>{answer=done;}),asked=new Promise(done=>{arrived=done;});
 try{await context.route('**/api/swarm/bots/career-concierge/ask',async route=>{arrived();await held;await route.continue();});
  await page.goto(fixture.origin+'/fixture/native');const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Concierge',exact:true}).waitFor();
  await page.frames()[1].evaluate(async()=>{const{registerDocumentSession}=await import('/shared/ui/js/document-handoff.js');window.fixtureHandoff={refreshed:0};const input=document.createElement('input');input.setAttribute('aria-label','Fictional draft');document.querySelector('main').append(input);registerDocumentSession({app:'career-hunter',prepare:async()=>({recordId:'master',fields:{revision:1}}),refresh:async()=>{window.fixtureHandoff.refreshed++;}});});
  await frame.getByRole('button',{name:'Concierge',exact:true}).click();
  const chat=await chatWindow(frame.locator('.ef-assistant'));
  await chat.locator('#typein').fill('Check this draft');await click(chat.locator('#typer button[type=submit]'));await asked;
  await frame.getByRole('textbox',{name:'Fictional draft'}).fill('My later manual words');answer();
  await chat.locator('#convo .msg.bot .bx').getByText(/résumé is saved/).waitFor({timeout:20000});
  assert.equal(await frame.getByRole('textbox',{name:'Fictional draft'}).inputValue(),'My later manual words','the later words are kept');
  await page.waitForTimeout(500);
  assert.equal(await page.frames()[1].evaluate(()=>window.fixtureHandoff.refreshed),0,'a draft that changed while the answer waited is not read over');
 }finally{answer();await context.close();}
});
