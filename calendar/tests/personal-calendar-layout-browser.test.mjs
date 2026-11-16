/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: an event opens its view; Cancel meeting there asks in the page (Keep it keeps it, Cancel meeting takes it off), replacing the row's own Remove button.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the agenda reads Google Calendar live, so the framed phone case reads it through the stand-in kernel egress and stand-in Google (tests/fixtures/google-calendar-standin.cjs): a calendar that read fine says nothing in its status line, the grid still starts within 120px, an event of the person's Family calendar shows as "Google · Family", and its view says it is changed in Google Calendar, with no Edit.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The design standard on the full Calendar page (docs/ux/design-standard.md; UX audit decision calendar--calendar-review), in a real Chromium over the real routes, SQL and row security of the personal-calendar fixture: the page declares its contract and the grid is the work; framed in Today no title repeats the name; "+ New event" is the one primary and opens the add form as a modal dialog that the browser's Back closes; a save refreshes "Added in OSHAL" in the same step (the FIX-BROKEN item); Remove and Sync ask in the page and never through a native dialog; Sync is one item of More and Cancel sends nothing; on a phone the grid starts within 120px, a day shows dots and nothing runs off the side; the "Your next brief" form stays hidden with no connected application. Every case fails on calendar 1.1.7.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Each case picks its day for the moment it runs. The design-standard case added its event on the 15th, which "Added in Open Swarm" (events from the start of today in UTC, routes/own-events.js) no longer lists from the 16th in UTC, so the case failed from the 16th to the end of every month (gate run 2026-11-16 05:29Z). It now adds on today in UTC as it will be when the case's budget runs out (addedDay), and on a month's last local evening, when UTC is already on the 1st, it first moves the grid to that month with the page's own Next month control (showMonth). The framed case's 10th is of the month in the browser's zone (monthDay), not of the test process's own zone, which is UTC on the gate host and named a day the grid did not have on the last local evening of every month. Both choices are pure helpers, proved at fixed moments by their own case against the route's real list bound.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {fixture,dependency,own}=createRequire(import.meta.url)('./fixtures/personal-calendar.cjs');const {chromium}=dependency('playwright');
const {standInGoogle,kernelEgress}=createRequire(import.meta.url)('./fixtures/google-calendar-standin.cjs');const yaml=dependency('js-yaml');
const manifest=yaml.load(createRequire(import.meta.url)('node:fs').readFileSync(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
/** The browser's zone in every case, and the design-standard case's budget (its timeout). */
const ZONE='America/Chicago',BUDGET=90000;

/** The civil day ('YYYY-MM-DD') of an instant in an IANA zone. */
function civilDay(at,zone){const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)),part=type=>parts.find(p=>p.type===type).value;return `${part('year')}-${part('month')}-${part('day')}`;}

/**
 * @description The day the design-standard case adds its all-day event on: one that "Added in Open Swarm" and the month grid
 *   both show, whatever the moment. The list reads from the start of today in UTC on (routes/own-events.js readOwnEvents) and an
 *   all-day event starts at midnight UTC, so the day is today in UTC as it will be when the case's budget has run out. The grid
 *   opens on today's month where the person is (the browser's zone, behind UTC), which holds that day except on a month's last
 *   local evening, when UTC is already on the 1st; the case then moves the grid there with the page's own Next month control.
 * @param {number} now - The moment the case starts, in ms.
 * @param {string} zone - The browser's IANA zone.
 * @param {number} budget - How long the case may run, in ms.
 * @returns {{day:string,month:string,opensOn:string}} The day ('YYYY-MM-DD'), its month, and the month the grid opens on ('YYYY-MM').
 */
function addedDay(now,zone,budget){const day=new Date(now+budget).toISOString().slice(0,10);return{day,month:day.slice(0,7),opensOn:civilDay(now,zone).slice(0,7)};}

/**
 * @description The n-th day of the month the grid opens on, in the browser's zone; the test process's own zone is UTC on the gate
 *   host, a month ahead of the grid on the last local evening of every month.
 * @param {number} now - The moment, in ms.
 * @param {string} zone - The browser's IANA zone.
 * @param {number} n - The day of the month.
 * @returns {string} The day, 'YYYY-MM-DD'.
 */
function monthDay(now,zone,n){return `${civilDay(now,zone).slice(0,7)}-${String(n).padStart(2,'0')}`;}

/**
 * @description Bring the month grid to a month with the page's own Previous month or Next month control, and wait until that month
 *   is read. A case's day is in the month the grid opened on or the next one (the one before only when the month turned while the
 *   case set up), so one move is the most it may take.
 * @param {object} app - The Playwright page or frame the calendar draws in.
 * @param {string} month - The month, 'YYYY-MM'.
 * @returns {Promise<number>} The moves it took, 0 or 1.
 */
async function showMonth(app,month){
 const shown=async()=>(await app.locator('.calendar-grid [data-day]').first().getAttribute('data-day')).slice(0,7),from=await shown();if(from===month)return 0;
 await app.getByRole('button',{name:from<month?'Next month':'Previous month',exact:true}).click();await app.locator('.calendar-workspace[data-state="ready"]').waitFor();
 assert.equal(await shown(),month,`one move brings the grid from ${from} to ${month}`);return 1;
}

/** One browser session as alice on the full page (or inside a same-origin frame), recording native dialogs and writes. */
async function session(f,browser,{width=1280,height=900,phone=false,framed=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:phone,hasTouch:phone,timezoneId:ZONE});await context.addCookies([{name:'person',value:'alice',url:f.base}]);
 const page=await context.newPage(),errors=[],dialogs=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+new URL(r.url()).pathname);});
 if(framed){await page.route(f.base+'/frame',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe id="app" src="/api/calendar/review" style="border:0;width:100vw;height:100vh"></iframe></body></html>'}));await page.goto(f.base+'/frame');}
 else await page.goto(f.base+'/api/calendar/review');
 const app=framed?page.frameLocator('#app'):page;await app.locator('.calendar-workspace[data-state="ready"]').waitFor();
 return{context,page,app,errors,dialogs,writes};
}

test('each case picks a day its page shows at the moment it runs: Added in Open Swarm lists it, and the grid holds it or one move does',async()=>{
 // The bound "Added in Open Swarm" lists from, taken from the real route over a recording pool.
 const listedFrom=async at=>{let from;await own.readOwnEvents({pool:{query:async q=>{from=q.values[1];return{rows:[]};}}},'alice',new Date(at));return from;},at=text=>Date.parse(text);
 // The gate's red run (2026-11-16 05:29Z): the 15th the case added on was already past in UTC, so the list never showed it.
 assert.ok('2026-11-15T00:00:00.000Z'<await listedFrom(at('2026-11-16T05:30:00Z')),'the old fixed 15th is not listed on the 16th in UTC');
 for(const [moment,day,opensOn,tenth] of [
  ['2026-11-16T05:30:00Z','2026-11-16','2026-11','2026-11-10'], // the 16th in UTC, still the 15th in the browser's zone
  ['2026-11-30T23:30:00-06:00','2026-12-01','2026-11','2026-11-10'], // a month's last local evening, UTC already on the 1st: one Next month
  ['2026-12-01T00:30:00Z','2026-12-01','2026-11','2026-11-10'], // the 1st in UTC (the test process's own month on the gate host), November 30 in the browser
  ['2026-11-10T12:00:00Z','2026-11-10','2026-11','2026-11-10'], // mid-month
  ['2026-02-28T23:00:00-06:00','2026-03-01','2026-02','2026-02-10'], // February's last local evening
  ['2026-12-01T12:00:00Z','2026-12-01','2026-12','2026-12-10'], // the 1st in both
  ['2026-11-30T23:59:00Z','2026-12-01','2026-11','2026-11-10'], // a minute before midnight UTC: still listed when the budget runs out
  ['2026-12-31T23:30:00-06:00','2027-01-01','2026-12','2026-12-10'], // the year's last local evening
  ['2026-07-31T23:30:00-05:00','2026-08-01','2026-07','2026-07-10'], // daylight time
 ]){
  assert.deepEqual(addedDay(at(moment),ZONE,BUDGET),{day,month:day.slice(0,7),opensOn},moment);
  for(const when of [at(moment),at(moment)+BUDGET])assert.ok(`${day}T00:00:00.000Z`>=await listedFrom(when),`${moment}: Added in Open Swarm lists ${day} until the budget runs out`);
  assert.equal(monthDay(at(moment),ZONE,10),tenth,`${moment}: the framed case's day is in the month its grid opens on`);
 }
});

test('the full Calendar page meets the design standard: contract, one primary, in-page asks, Back closes the layer',{timeout:BUDGET},async()=>{
 const f=await fixture();let browser;try{
  // A day both "Added in Open Swarm" and the grid show at this moment (addedDay); a fixed 15th was past in UTC from the 16th on.
  const t=addedDay(Date.now(),ZONE,BUDGET),day=t.day;
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
  // A save lands in the grid and in "Added in Open Swarm" in the same step. The grid shows the day's month first: on a month's
  // last local evening that is the next month, reached with the page's own Next month control.
  await showMonth(page,t.month);
  await add.click();await page.locator('[name=title]').fill('Team lunch');await page.locator('[name=allDay]').check();await page.locator('[name=start]').fill(day);
  await page.getByRole('button',{name:'Save event',exact:true}).click();await page.getByRole('status').filter({hasText:'Event saved in Open Swarm.'}).waitFor();
  await sheet.waitFor({state:'hidden'});await page.locator('#ownEvents').getByText('Team lunch',{exact:true}).waitFor({timeout:5000});
  // Remove asks in the page: Cancel keeps the event, Remove takes it off; no native dialog either way.
  await page.locator(`[data-day="${day}"]`).click();const open=page.locator('.calendar-agenda').getByRole('button',{name:'Open Team lunch',exact:true});
  const cancelMeeting=async()=>{await open.click();await page.locator('dialog.calendar-view').getByRole('button',{name:'Cancel meeting',exact:true}).click();};
  await cancelMeeting();const ask=page.locator('dialog.calendar-confirm');await ask.waitFor();assert.match(await ask.innerText(),/Team lunch/);await ask.getByRole('button',{name:'Keep it',exact:true}).click();await ask.waitFor({state:'detached'});
  assert.equal(await page.locator('.calendar-agenda').getByText('Team lunch',{exact:true}).count(),1,'Keep it removes nothing');
  await cancelMeeting();await page.locator('dialog.calendar-confirm').getByRole('button',{name:'Cancel meeting',exact:true}).click();await page.getByRole('status').filter({hasText:'Meeting cancelled.'}).waitFor();
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
 const family='family@group.calendar.google.com',f=await fixture(),api=await standInGoogle({calendars:[{id:family,summary:'Family',selected:true,accessRole:'writer'}]}),egress=kernelEgress(manifest,'person-full',api);let browser;try{
  // The 10th of the month the grid opens on in the browser's zone (monthDay), never of the test process's own zone.
  const day=monthDay(Date.now(),ZONE,10);
  await f.seed('alice',{title:'Haircut',start:day});api.seedOn(family,{summary:'Soccer practice',start:{dateTime:`${day}T17:00:00`,timeZone:ZONE},end:{dateTime:`${day}T18:00:00`,timeZone:ZONE}});
  browser=await chromium.launch({headless:true});
  const s=await session(f,browser,{width:412,height:743,phone:true,framed:true}),frame=s.page.frame({url:/\/api\/calendar\/review/});
  assert.equal(await frame.evaluate(()=>document.documentElement.hasAttribute('data-framed')),true);
  assert.equal(await frame.locator('h1').evaluate(h=>getComputedStyle(h.closest('header')).display),'none','the Today bar names the app; the page does not repeat it');
  const top=await frame.locator('[data-ds-work]').evaluate(el=>el.getBoundingClientRect().top);assert.ok(top<=120,`the work starts at ${top}px`);
  // The grid opened on the day's month; one move only when that month turned while the case set up.
  await showMonth(frame,day.slice(0,7));
  const cell=frame.locator(`[data-day="${day}"]`);assert.equal(await cell.locator('.calendar-dot').first().isVisible(),true,'a day shows a dot on a phone');assert.equal(await cell.locator('.calendar-chip').first().isVisible(),false);
  const size=await cell.boundingBox();assert.ok(size.width>=44&&size.height>=44,`a day is a 44px target (${size.width}x${size.height})`);
  await cell.click();await frame.locator('.calendar-agenda').getByText('Haircut',{exact:true}).waitFor();
  // A Google event of another calendar the person shows: its row names that calendar, and its view sends changes to Google Calendar.
  const soccer=frame.locator('.calendar-event',{hasText:'Soccer practice'});assert.match(await soccer.innerText(),/Google · Family · .*5:00\sPM/);
  await frame.getByRole('button',{name:'Open Soccer practice',exact:true}).click();const view=frame.locator('dialog.calendar-view');await view.waitFor();
  assert.match(await view.innerText(),/In your Google Calendar: Family/);assert.match(await view.innerText(),/To change it, open it in Google Calendar\./);
  assert.equal(await view.getByRole('button',{name:'Edit',exact:true}).count(),0,'only the primary calendar and Open Swarm events are changed here');
  await view.getByRole('button',{name:'Close',exact:true}).click();await view.waitFor({state:'detached'});
  const below=await frame.evaluate(()=>{const g=document.querySelector('.calendar-grid').getBoundingClientRect(),a=document.querySelector('.calendar-agenda').getBoundingClientRect();return a.top>=g.bottom;});assert.equal(below,true,'the selected day\'s events are rows below the grid');
  assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await frame.getByRole('status').innerText(),'','a calendar that read fine says nothing in its status line');
  assert.deepEqual(s.dialogs,[]);assert.deepEqual(s.errors,[]);await s.context.close();
 }finally{await browser?.close();egress.restore();await api.close();await f.close();}
});
