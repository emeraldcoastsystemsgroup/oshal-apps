/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The design standard on the full Calendar page (docs/ux/design-standard.md; UX audit decision calendar--calendar-review), in a real Chromium over the real routes, SQL and row security of the personal-calendar fixture: the page declares its contract and the grid is the work; framed in Today no title repeats the name; "+ New event" is the one primary and opens the add form as a modal dialog that the browser's Back closes; a save refreshes "Added in OSHAL" in the same step (the FIX-BROKEN item); Remove and Sync ask in the page and never through a native dialog; Sync is one item of More and Cancel sends nothing; on a phone the grid starts within 120px, a day shows dots and nothing runs off the side; the "Your next brief" form stays hidden with no connected application. Every case fails on calendar 1.1.7.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {fixture,dependency}=createRequire(import.meta.url)('./fixtures/personal-calendar.cjs');const {chromium}=dependency('playwright');

/** One browser session as alice on the full page (or inside a same-origin frame), recording native dialogs and writes. */
async function session(f,browser,{width=1280,height=900,phone=false,framed=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:phone,hasTouch:phone,timezoneId:'America/Chicago'});await context.addCookies([{name:'person',value:'alice',url:f.base}]);
 const page=await context.newPage(),errors=[],dialogs=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+new URL(r.url()).pathname);});
 if(framed){await page.route(f.base+'/frame',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe id="app" src="/api/calendar/review" style="border:0;width:100vw;height:100vh"></iframe></body></html>'}));await page.goto(f.base+'/frame');}
 else await page.goto(f.base+'/api/calendar/review');
 const app=framed?page.frameLocator('#app'):page;await app.locator('.calendar-workspace[data-state="ready"]').waitFor();
 return{context,page,app,errors,dialogs,writes};
}

test('the full Calendar page meets the design standard: contract, one primary, in-page asks, Back closes the layer',{timeout:90000},async()=>{
 const f=await fixture();let browser;try{
  const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0'),day=`${y}-${m}-15`;
  await f.seed('alice',{title:'Dentist',start:day});
  browser=await chromium.launch({headless:true});
  const s=await session(f,browser),{page}=s;
  // The contract the audit reads, and the grid is the work.
  assert.equal(await page.locator('html').getAttribute('data-ds-category'),'collection');assert.equal(await page.locator('html').getAttribute('data-ds-first-action'),'tap');
  assert.equal(await page.locator('[data-ds-work] .calendar-grid').count(),1,'the month grid is inside the declared work');
  // Not framed (its own tab): the small bar carries All apps and the name; no eyebrow or hint paragraph above the calendar.
  assert.equal(await page.getByRole('link',{name:'All apps',exact:true}).getAttribute('href'),'/cockpit/');
  assert.equal(await page.locator('.eyebrow').count(),0);
  // One primary, the bottom-right New event.
  const add=page.getByRole('button',{name:'+ New event',exact:true});const box=await add.boundingBox();assert.ok(box.x+box.width>1180&&box.y+box.height>800,`New event sits at the bottom right (${JSON.stringify(box)})`);
  assert.equal(await page.locator('details.calendar-add').count(),0,'the add form is no disclosure below the fold');
  // The brief form has no connected application to take it in this fixture, so it is not offered.
  assert.equal(await page.locator('#briefPanel').isHidden(),true);
  // New event opens a modal dialog; Back closes it and stays on the page.
  await add.click();const sheet=page.locator('dialog.calendar-sheet');await sheet.waitFor();assert.equal(await sheet.evaluate(d=>d.matches(':modal')),true);
  await page.goBack();await sheet.waitFor({state:'hidden'});assert.match(page.url(),/\/api\/calendar\/review$/,'Back closed the layer and stayed in Calendar');
  // A save lands in the grid and in "Added in OSHAL" in the same step.
  await add.click();await page.locator('[name=title]').fill('Team lunch');await page.locator('[name=allDay]').check();await page.locator('[name=start]').fill(day);
  await page.getByRole('button',{name:'Save event',exact:true}).click();await page.getByRole('status').filter({hasText:'Event saved in OSHAL.'}).waitFor();
  await sheet.waitFor({state:'hidden'});await page.locator('#ownEvents').getByText('Team lunch',{exact:true}).waitFor({timeout:5000});
  // Remove asks in the page: Cancel keeps the event, Remove takes it off; no native dialog either way.
  await page.locator(`[data-day="${day}"]`).click();const remove=page.locator('.calendar-agenda').getByRole('button',{name:'Remove Team lunch',exact:true});
  await remove.click();const ask=page.locator('dialog.calendar-confirm');await ask.waitFor();assert.match(await ask.innerText(),/Team lunch/);await ask.getByRole('button',{name:'Cancel',exact:true}).click();await ask.waitFor({state:'detached'});
  assert.equal(await page.locator('.calendar-agenda').getByText('Team lunch',{exact:true}).count(),1,'Cancel removes nothing');
  await remove.click();await page.locator('dialog.calendar-confirm').getByRole('button',{name:'Remove',exact:true}).click();await page.getByRole('status').filter({hasText:'Event removed.'}).waitFor();
  await page.locator('#ownEvents').getByText('Team lunch',{exact:true}).waitFor({state:'detached',timeout:5000});
  // Sync is one item of More, says its scope before it runs, and Cancel sends nothing.
  assert.equal(await page.getByRole('button',{name:/^Sync/}).count(),0,'no Sync button on the page itself');
  await page.getByRole('button',{name:'More',exact:true}).click();const menu=page.getByRole('menu');await menu.waitFor();
  await menu.getByRole('menuitem',{name:/Sync Google events/}).click();const syncAsk=page.locator('dialog.calendar-confirm');await syncAsk.waitFor();assert.match(await syncAsk.innerText(),/next 30 days/);
  await syncAsk.getByRole('button',{name:'Cancel',exact:true}).click();await syncAsk.waitFor({state:'detached'});
  assert.equal(s.writes.filter(w=>w.endsWith('/sync')).length,0,'Cancel sent no sync');
  // More is a layer the browser's Back closes too.
  await page.getByRole('button',{name:'More',exact:true}).click();await menu.waitFor();await page.goBack();await menu.waitFor({state:'hidden'});assert.match(page.url(),/\/api\/calendar\/review$/);
  assert.deepEqual(s.dialogs,[],'no native alert, confirm or prompt');assert.deepEqual(s.errors,[]);
  await s.context.close();
 }finally{await browser?.close();await f.close();}
});

test('framed in Today and on a phone: no repeated name, the grid within 120px, dots and nothing off the side',{timeout:60000},async()=>{
 const f=await fixture();let browser;try{
  const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0'),day=`${y}-${m}-10`;
  await f.seed('alice',{title:'Haircut',start:day});
  browser=await chromium.launch({headless:true});
  const s=await session(f,browser,{width:412,height:743,phone:true,framed:true}),frame=s.page.frame({url:/\/api\/calendar\/review/});
  assert.equal(await frame.evaluate(()=>document.documentElement.hasAttribute('data-framed')),true);
  assert.equal(await frame.locator('h1').evaluate(h=>getComputedStyle(h.closest('header')).display),'none','the Today bar names the app; the page does not repeat it');
  const top=await frame.locator('[data-ds-work]').evaluate(el=>el.getBoundingClientRect().top);assert.ok(top<=120,`the work starts at ${top}px`);
  const cell=frame.locator(`[data-day="${day}"]`);assert.equal(await cell.locator('.calendar-dot').first().isVisible(),true,'a day shows a dot on a phone');assert.equal(await cell.locator('.calendar-chip').first().isVisible(),false);
  const size=await cell.boundingBox();assert.ok(size.width>=44&&size.height>=44,`a day is a 44px target (${size.width}x${size.height})`);
  await cell.click();await frame.locator('.calendar-agenda').getByText('Haircut',{exact:true}).waitFor();
  const below=await frame.evaluate(()=>{const g=document.querySelector('.calendar-grid').getBoundingClientRect(),a=document.querySelector('.calendar-agenda').getBoundingClientRect();return a.top>=g.bottom;});assert.equal(below,true,'the selected day\'s events are rows below the grid');
  assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(s.dialogs,[]);assert.deepEqual(s.errors,[]);await s.context.close();
 }finally{await browser?.close();await f.close();}
});
