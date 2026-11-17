/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: the Image editor's concierge button could not be clicked, "same with ai office". A person reaches AI Office inside Today, as its own application (/cockpit/?app=presentations) and as Create's AI Office screen (/cockpit/?app=create&screen=create-office), where the concierge entries are Today's (the bar's Concierge that the framed editor takes over, the floating ball) and AI Office's own (the docked pane's Concierge tab on a desktop, the bottom bar's Concierge on a phone). This opens the shipped Today page from the kernel platform export (scripts/one-chat-window/today-host.mjs, profiles built from the manifests as the kernel builds them) over AI Office's real routes on disposable PostgreSQL, presses every entry a person can see with Playwright's own actionability (a click on a desktop, a tap on a phone; never forced, never a script click), and asserts that the one Jarvis chat window opens as AI Office's own concierge: /api/jarvis/?concierge=presentations&bot=<deck-builder>, its message box ready.
 */
import{test,before,after}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{fixture}from'./fixture.mjs';
import{kernelPlatform,chatWindow}from'../../../scripts/one-chat-window/kernel-window.mjs';
import{mountToday,profileFor,conciergeEntries,openWindows}from'../../../scripts/one-chat-window/today-host.mjs';
const{chromium}=createRequire(import.meta.url)('playwright');
// The platform the Office fixture serves the shared editor from; a platform without the window fails here, never skips.
const platform=kernelPlatform(process.env.OSHAL_PLATFORM_ROOT??new URL('../../../../kernel-editor-foundation/platform',import.meta.url).pathname);
const SIZES=[{name:'1440x900',options:{viewport:{width:1440,height:900}}},{name:'412x915',options:{viewport:{width:412,height:915},isMobile:true,hasTouch:true}}];
const ADDRESSES=[{address:'/cockpit/?app=presentations',name:'AI Office'},{address:'/cockpit/?app=create&screen=create-office',name:'Create\'s AI Office screen'}];
let f,browser;
before(async()=>{f=await fixture({http:true,extend:app=>mountToday(app,{platform,apps:['presentations','create']})});browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await f?.close();});

/** Today's entries and AI Office's own: the docked pane's Concierge tab (a desktop) and the bottom bar's Concierge (a phone). */
function entries(page){
 const screen=page.frameLocator('.tool-view-container > iframe');
 return[...conciergeEntries(page),{name:'AI Office\'s Concierge tab',locator:screen.locator('.office-pane-tabs [data-pane=concierge]')},
  {name:'AI Office\'s bottom bar Concierge',locator:screen.locator('.office-bottom-bar').getByRole('button',{name:'Concierge',exact:true})}];
}
/** Open the address inside Today and wait until AI Office is ready in its frame. */
async function open(context,address){
 const page=await context.newPage();await page.goto(f.origin+address);
 await page.frameLocator('.tool-view-container > iframe').locator('html[data-office-ready=true]').waitFor({timeout:30000});
 await page.waitForTimeout(1500);   // Today's startup and the framed editor's binding of the bar settle
 return page;
}
/** The one chat window an entry opened, waited for: its address, and its message box ready. */
async function openedWindow(page){
 let found=[];for(const until=Date.now()+15000;Date.now()<until&&!found.length;await page.waitForTimeout(250))found=await openWindows(page);
 assert.equal(found.length,1,`exactly one chat window opens (${JSON.stringify(found)})`);
 const rail=await page.evaluate(()=>document.getElementById('chatWorkspaceFrame')?.getAttribute('src')||'');
 await(found[0]===rail?chatWindow(page,'#chatWorkspaceFrame'):chatWindow(page.frameLocator('.tool-view-container > iframe')));
 return new URL(found[0],f.origin);
}

for(const{address,name:where}of ADDRESSES)for(const{name,options}of SIZES)test(`${name}: ${where} in Today - every concierge entry a person sees opens the one chat window as AI Office's concierge`,{timeout:180000},async t=>{
 const want=profileFor('presentations').profile.chatAgent,press=locator=>options.hasTouch?locator.tap({timeout:5000}):locator.click({timeout:5000});
 const context=await browser.newContext(options);t.after(()=>context.close());
 const first=await open(context,address),shown=[];
 for(const entry of entries(first))if(await entry.locator.isVisible())shown.push(entry.name);
 await first.close();
 assert.ok(shown.length>0,'a person sees a concierge entry on AI Office');
 for(const entryName of shown){
  const page=await open(context,address),entry=entries(page).find(each=>each.name===entryName);
  await press(entry.locator);
  const opened=await openedWindow(page);
  assert.equal(opened.pathname,'/api/jarvis/',`${entryName} opens the one Jarvis chat window`);
  assert.equal(opened.searchParams.get('concierge'),'presentations',`${entryName} opens AI Office's own concierge (${opened.pathname}${opened.search})`);
  assert.ok([want.agentId,want.name].includes(opened.searchParams.get('bot')),`bound to AI Office's bot ${want.name} (${opened.search})`);
  await page.close();
 }
});
