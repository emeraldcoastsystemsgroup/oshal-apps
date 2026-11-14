/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Phone and desktop shared concierge over local HTTP: open, native ask, close/reopen, geometry and one entry; no live service or provider.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: once a reply is in the conversation the help line and the suggestion chips are not shown.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: on a phone the pane is left by its header's Back to Home (the page's name in Career's bar) and the cross is not shown; on a desktop the cross stays. Coming back with Concierge shows the same conversation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The skip names OSHAL_KERNEL_PLATFORM, which the store gate now supplies, so these cases run in the gate instead of skipping.
 */
import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {startConciergeFixture,chromium,sharedRoot} from './helpers/career-concierge-fixture.mjs';
let browser,fixture;
before(async()=>{fixture=await startConciergeFixture();browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await fixture?.close();});
for(const host of ['native','cockpit'])for(const width of [412,1280])test(`${host} ${width}: current shared assistant replaces fly-in and unformatted bar`,{skip:!sharedRoot&&'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (read only)'},async()=>{
 const context=await browser.newContext({viewport:{width,height:915}}),page=await context.newPage();
 try{
  const external=[];await context.route('**/*',route=>{if(new URL(route.request().url()).origin===fixture.origin)return route.continue();external.push(route.request().url());return route.abort();});
  await page.goto(fixture.origin+'/fixture/'+host);
  const frame=page.frameLocator('iframe');const toggle=frame.getByRole('button',{name:'Concierge',exact:true});
  await toggle.waitFor({timeout:4000});await toggle.click();
  const panel=frame.locator('.ef-assistant');await panel.waitFor({state:'visible',timeout:4000});
  const boundary=await page.evaluate(()=>{const frame=document.querySelector('iframe');return{legacy:getComputedStyle(document.querySelector('#active-app-concierge,.chat-panel')).display,bar:getComputedStyle(document.querySelector('.app-focus-bar,.tool-view-header')).display};});
  assert.deepEqual(boundary,{legacy:'none',bar:'none'});
  await panel.getByRole('textbox',{name:'Message to concierge'}).fill('is my resume loaded');await panel.getByRole('button',{name:'Send',exact:true}).click();
  await panel.locator('.ef-assistant-reply').getByText(/résumé is saved/).waitFor();
  await panel.locator('.ef-assistant-notice').getByText('The concierge finished.',{exact:true}).waitFor();
  assert.deepEqual(await panel.evaluate(node=>[...node.querySelectorAll('.ef-assistant-help,.ef-assistant-prompts')].map(n=>getComputedStyle(n).display)),['none','none'],'with a conversation the help line and the chips step aside');
  const ask=fixture.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/ask')).at(-1);assert.equal(ask.body.context.app,'career-hunter');
  assert.equal(ask.body.message.startsWith('is my resume loaded'),true);
  const box=await panel.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=915+1);
  const heading=await panel.locator('.ef-assistant-header').boundingBox();assert.ok(heading.y>=box.y&&heading.y+heading.height<=box.y+box.height);
  const metrics=await panel.evaluate(node=>{const p=node.getBoundingClientRect(),c=node.querySelector('.ef-assistant-composer').getBoundingClientRect();return{border:getComputedStyle(node.parentElement).borderLeftWidth,composerInside:c.bottom<=p.bottom+1,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.equal(metrics.composerInside,true);assert.equal(metrics.overflow,false);if(width===1280)assert.equal(metrics.border,'1px');
  if(process.env.CAREER_CONCIERGE_SCREENSHOTS&&host==='native')await page.screenshot({path:path.join(process.env.CAREER_CONCIERGE_SCREENSHOTS,`concierge-${width}.png`)});
  // 1.61.0: a phone leaves the pane by the header's Back to <this page>, which keeps the conversation; a desktop by the cross.
  if(width===412){assert.equal(await panel.getByRole('button',{name:'Close concierge'}).isVisible(),false);await panel.getByRole('button',{name:'Back to Home',exact:true}).click();}
  else{assert.equal(await panel.getByRole('button',{name:/^Back to /}).isVisible(),false);await panel.getByRole('button',{name:'Close concierge'}).click();}
  await panel.waitFor({state:'hidden'});await toggle.click();await panel.waitFor({state:'visible'});
  assert.equal(await panel.locator('.ef-assistant-reply').count(),1,'the conversation is still there');
  assert.equal(await frame.locator('.ef-assistant').count(),1);assert.deepEqual(external,[]);
 }finally{await context.close();}
});
test('Career imports the same shared assistant as the résumé document, without copying it',()=>{
 const file=path.resolve(import.meta.dirname,'../tools/career-concierge.mjs');assert.equal(fs.existsSync(file),true);
 assert.match(fs.readFileSync(file,'utf8'),/import\('\/shared\/ui\/js\/editor-assistant.js'\)/);
 assert.match(fs.readFileSync(path.resolve(import.meta.dirname,'../../presentations/tools/office/controller.mjs'),'utf8'),/import\('\/shared\/ui\/js\/editor-assistant.js'\)/);
});

test('registered Career draft is saved once before asking and refreshed once after the shared turn',{skip:!sharedRoot&&'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (read only)'},async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:915}}),page=await context.newPage();
 try{await page.goto(fixture.origin+'/fixture/native');const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Concierge',exact:true}).waitFor();
  await page.frames()[1].evaluate(async()=>{const{registerDocumentSession}=await import('/shared/ui/js/document-handoff.js');window.fixtureHandoff={prepared:0,refreshed:0};registerDocumentSession({app:'career-hunter',prepare:async()=>{window.fixtureHandoff.prepared++;return{recordId:'fictional-plan',fields:{revision:7}};},refresh:async()=>{window.fixtureHandoff.refreshed++;}});});
  await frame.getByRole('button',{name:'Concierge',exact:true}).click();await frame.getByRole('textbox',{name:'Message to concierge'}).fill('Check my saved profile');await frame.getByRole('button',{name:'Send',exact:true}).click();
  await frame.getByText('The concierge finished.',{exact:true}).waitFor();
  assert.deepEqual(await page.frames()[1].evaluate(()=>window.fixtureHandoff),{prepared:1,refreshed:1});
  const ask=fixture.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/ask')).at(-1);assert.equal(ask.body.context.recordId,'fictional-plan');assert.equal(ask.body.context.fields.revision,7);assert.equal(ask.body.sessionId,'doc:career-hunter:fictional-plan');
 }finally{await context.close();}
});

test('manual draft changes while an answer waits keep that draft and refuse the stale reply',{skip:!sharedRoot&&'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (read only)'},async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:915}}),page=await context.newPage();let answer,arrived;
 const held=new Promise(done=>{answer=done;}),asked=new Promise(done=>{arrived=done;});
 try{await context.route('**/api/swarm/bots/career-concierge/ask',async route=>{arrived();await held;await route.fulfill({json:{reply:'Earlier saved revision'}});});
  await page.goto(fixture.origin+'/fixture/native');const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Concierge',exact:true}).waitFor();
  await page.frames()[1].evaluate(async()=>{const{registerDocumentSession}=await import('/shared/ui/js/document-handoff.js');const input=document.createElement('input');input.setAttribute('aria-label','Fictional draft');document.querySelector('main').append(input);registerDocumentSession({app:'career-hunter',prepare:async()=>({recordId:'fictional-plan',fields:{revision:1}}),refresh:async()=>{}});});
  await frame.getByRole('button',{name:'Concierge',exact:true}).click();await frame.getByRole('textbox',{name:'Message to concierge'}).fill('Check this draft');await frame.getByRole('button',{name:'Send',exact:true}).click();await asked;
  await frame.getByRole('textbox',{name:'Fictional draft'}).fill('My later manual words');answer();
  await frame.getByText(/earlier document or draft/).waitFor();assert.equal(await frame.getByRole('textbox',{name:'Fictional draft'}).inputValue(),'My later manual words');assert.equal(await frame.locator('.ef-assistant-reply').count(),0);
 }finally{answer();await context.close();}
});
