// CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: an event opens its view, and Cancel meeting there (asked in the page) takes it off; the row's own Remove button gave way to the view.
// CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | A calendar that read fine says nothing in its status line now (DS-31); the proof waits for the workspace's data-state="ready".
// CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | The design standard: New event opens the add form as a modal dialog (so the calendar behind it cannot move while a save is pending), and Remove asks in the page instead of window.confirm.
// CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | The case reads the grid's month in the browser's zone (gridMonth). It took the month from the test process's own zone, UTC on the gate host, which is a month ahead of the America/Chicago grid from 00:00Z to 06:00Z on the 1st, so the day count and the 14th's cell missed and the suite failed then, every month. A pure case proves the month at the month-boundary moments; after the first load and after the reload the grid is brought to that month with its own controls (showMonth, one move at most) for a month that turns while the case sets up.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {fixture,dependency}=createRequire(import.meta.url)('./fixtures/personal-calendar.cjs');const {chromium}=dependency('playwright');
/** The browser's zone (the context's timezoneId). */
const ZONE='America/Chicago';
/**
 * @description The month the grid opens on at a moment, in the browser's zone, with its number of days and the day the case uses
 *   (the 14th). The test process's own zone is UTC on the gate host, a month ahead of the grid from 00:00Z to 06:00Z on the 1st.
 * @param {number} now - The moment, in ms.
 * @param {string} zone - The browser's IANA zone.
 * @returns {{month:string,days:number,day:string}} The month ('YYYY-MM'), its number of days, and the case's day ('YYYY-MM-DD').
 */
function gridMonth(now,zone){const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit'}).formatToParts(new Date(now)),year=Number(parts.find(p=>p.type==='year').value),number=Number(parts.find(p=>p.type==='month').value),month=`${year}-${String(number).padStart(2,'0')}`;return{month,days:new Date(Date.UTC(year,number,0)).getUTCDate(),day:`${month}-14`};}
/**
 * @description Bring the month grid to a month with the page's own Previous month or Next month control, and wait until that month
 *   is read. The grid opens on the case's month unless that month turned while the case set up, so one move is the most it may take.
 * @param {object} page - The Playwright page the calendar draws in.
 * @param {string} month - The month, 'YYYY-MM'.
 * @returns {Promise<number>} The moves it took, 0 or 1.
 */
async function showMonth(page,month){
 const shown=async()=>(await page.locator('.calendar-grid [data-day]').first().getAttribute('data-day')).slice(0,7),from=await shown();if(from===month)return 0;
 await page.getByRole('button',{name:from<month?'Next month':'Previous month',exact:true}).click();await page.locator('.calendar-workspace[data-state="ready"]').waitFor();
 assert.equal(await shown(),month,`one move brings the grid from ${from} to ${month}`);return 1;
}
test('the compact case reads the grid\'s month in the browser\'s zone at the month-boundary moments',()=>{
 for(const [moment,month,days] of [
  ['2026-11-30T23:30:00-06:00','2026-11',30], // a month's last local evening; UTC, the process's own zone on the gate host, is already in December
  ['2026-12-01T00:30:00Z','2026-11',30], // the 1st in UTC, still November 30 in the browser
  ['2026-12-01T12:00:00Z','2026-12',31], // the 1st in both
  ['2028-03-01T03:00:00Z','2028-02',29], // a leap February's last local evening
 ])assert.deepEqual(gridMonth(Date.parse(moment),ZONE),{month,days,day:`${month}-14`},moment);
});
test('actual compact calendar entry renders real owner rows, saves/removes and works at phone width',{timeout:60000},async()=>{
 const f=await fixture();let browser;try{
 // The grid's month in the browser's zone (gridMonth); the process's own month is a month ahead from 00:00Z to 06:00Z on the 1st.
 const now=new Date(),t=gridMonth(now.getTime(),ZONE),day=t.day;
 await f.seed('alice',{title:'OSHAL appointment',start:day});await f.seed('bob',{title:'Secret foreign calendar',start:day});await f.snapshot('alice',[{id:'g',title:'Google holiday',start:day,allDay:true}],now.toISOString());
 browser=await chromium.launch({headless:true});const context=await browser.newContext({timezoneId:ZONE});await context.addCookies([{name:'person',value:'alice',url:f.base}]);const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('native dialog: '+d.message());d.dismiss();});page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 await page.goto(f.base+'/api/calendar/review?compact=1');await page.locator('.calendar-workspace[data-state="ready"]').waitFor();await showMonth(page,t.month);assert.equal(await page.locator('.calendar-day').count(),t.days);await page.locator(`[data-day="${day}"]`).click();await page.locator('.calendar-agenda').getByText('OSHAL appointment',{exact:true}).waitFor();await page.locator('.calendar-agenda').getByText('Google holiday',{exact:true}).waitFor();assert.equal(await page.getByText('Secret foreign calendar').count(),0);assert.equal(writes.length,0,'No implicit sync or write on entry');
 assert.equal(await page.evaluate(async()=>{const {localInstant}=await import('/api/calendar/review/calendar-workspace.mjs');try{localInstant('2026-03-08T02:30');return false;}catch(e){return /does not exist/.test(e.message);}}),true,'The real browser rejects nonexistent local DST time before a write');
 assert.equal((await page.request.get(f.base+'/api/calendar/review/calendar-workspace.mjs?v=kernel-1')).status(),200);assert.equal((await page.request.get(f.base+'/api/calendar/review/calendar-workspace.mjs?owner=bob')).status(),400);
 await page.getByRole('button',{name:'+ New event',exact:true}).click();await page.locator('[name=title]').fill('Human calendar event');await page.locator('[name=allDay]').check();await page.locator('[name=start]').fill(day);let releaseReply,replySeen;const paused=new Promise(resolve=>replySeen=resolve),release=new Promise(resolve=>releaseReply=resolve);
 // Named Source response-delivery pause: the actual POST/SQL executes unchanged; only browser delivery waits.
 await page.route('**/api/calendar/events',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();replySeen();await release;await route.fulfill({response});});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await paused;
 assert.equal(await page.locator('[name=title]').isDisabled(),true,'Submitted fields cannot accept a second draft while a save is pending');
 await page.keyboard.type('another draft');assert.equal(await page.locator('[name=title]').inputValue(),'Human calendar event');
 assert.equal(await page.locator('dialog.calendar-sheet').evaluate(d=>d.matches(':modal')),true,'The pending save keeps the modal add form, so the calendar behind it cannot change under it');
 releaseReply();await page.getByRole('status').filter({hasText:'Event saved in Open Swarm.'}).waitFor();assert.equal(await page.locator('[name=title]').isDisabled(),false);await page.unroute('**/api/calendar/events');
 await page.locator('dialog.calendar-sheet').waitFor({state:'hidden'});
await page.locator(`[data-day="${day}"]`).click();await page.locator('.calendar-agenda').getByText('Human calendar event',{exact:true}).waitFor();
 await page.reload();await page.locator('.calendar-workspace[data-state="ready"]').waitFor();await showMonth(page,t.month);await page.locator(`[data-day="${day}"]`).click();await page.locator('.calendar-agenda').getByText('Human calendar event',{exact:true}).waitFor();await page.getByRole('button',{name:'Open Human calendar event'}).click();await page.locator('dialog.calendar-view').getByRole('button',{name:'Cancel meeting',exact:true}).click();await page.locator('dialog.calendar-confirm').getByRole('button',{name:'Cancel meeting',exact:true}).click();await page.getByRole('status').filter({hasText:'Meeting cancelled.'}).waitFor();assert.equal(await page.locator('.calendar-agenda').getByText('Human calendar event',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Previous month',exact:true}).click();await page.locator('.calendar-workspace[data-state="ready"]').waitFor();await page.getByRole('button',{name:'Next month',exact:true}).click();await page.locator('.calendar-workspace[data-state="ready"]').waitFor();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.equal(writes.filter(u=>u.endsWith('/sync')).length,0);
 const unauthorized=await browser.newPage();await unauthorized.goto(f.base+'/api/calendar/review?compact=1');await unauthorized.getByRole('status').filter({hasText:'not_authenticated'}).waitFor();assert.match(await unauthorized.locator('.calendar-agenda').innerText(),/could not be read/);
 }finally{await browser?.close();await f.close();}
});
