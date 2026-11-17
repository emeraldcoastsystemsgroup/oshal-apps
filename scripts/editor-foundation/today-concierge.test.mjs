/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: "when im in image editor the image concierge button can not be clicked, same with ai office, portrait has a jarvis ball that opens create-editor not a concierge, video editor's concierge doesnt open ... we need new tests". A person opens an editor inside Today, so this opens Today itself (the shipped page from OSHAL_KERNEL_PLATFORM, scripts/editor-foundation/today-shell.mjs) on Create's Image editor, Video editor and Publishing Studio screens and on Video's own editor, at 1440x900 and at 412x915 with touch, and presses every concierge entry a person can see there (Today's bar Concierge, Today's ball, the editor's own Concierge) the way a person does: Playwright's own click or tap with its actionability checks, never force and never a script click. Each press must put the one Jarvis concierge window on screen, bound to that screen's own application and bot (/api/jarvis/?concierge=<that application>&bot=<its bot>), with its message box; the window's own Close must close it, and the entry must open it again. Red on the production build of 2026-11-17 (kernel 18d03d06, store main 518eba98): Publishing Studio's bar Concierge opens a pane its own layout keeps hidden, its phone screen shows no concierge entry, and Video's phone sheet does not close with the window's Close.
 */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {kernelPlatform,windowKernel,toolchain} from '../one-chat-window/kernel-window.mjs';
import {TODAY_ORIGIN,serveToday,todayProfile,editorFrame,conciergeEntries,editorWindow} from './today-shell.mjs';
import {startReviewServer} from './review-server.mjs';

/** The screens of Roger's report that a store fixture can serve: [Today's application, its screen, the page, the concierge's application, its bot]. */
const SCREENS=[['create','create-editor','/api/create/editor','create','create-editor'],['create','create-video-editor','/api/video/editor','video','video-editor'],
 ['video','video-editor','/api/video/editor','video','video-editor'],['create','create-publishing-studio','/api/publishing-studio/app','publishing-studio','publishing-editor']];
const SIZES=[['1440x900',{viewport:{width:1440,height:900}}],['412x915',{viewport:{width:412,height:915},isMobile:true,hasTouch:true}]];
// The window comes from the same platform as the shared UI (the review server's own sibling default); none fails here.
const platform=kernelPlatform(resolve(import.meta.dirname,'../../../kernel-editor-foundation/platform'));
const kernel=windowKernel(),cleanups=[],profiles={};let browser,servers;

before(async()=>{
 if(!process.env.STORE_CI_TOOLCHAIN)throw new Error('Set STORE_CI_TOOLCHAIN to the pinned Store toolchain; genuine Chromium is required.');
 const dir=await mkdtemp(join(tmpdir(),'today-concierge-'));cleanups.push(()=>rm(dir,{recursive:true,force:true}));
 const review=await startReviewServer({port:0,stateFile:join(dir,'create.json'),renderSeed:false});cleanups.push(()=>review.close());
 const {startPostgres}=await import('../../video/tests/video-editor-postgres.fixture.mjs');
 const {startApi,fixtureEncoder}=await import('../../video/tests/video-editor.fixture.mjs');
 let stopDatabase;const database=await startPostgres(fn=>{stopDatabase=fn;});cleanups.push(()=>stopDatabase());
 const video=await startApi({after:fn=>cleanups.push(fn)},database.pool,{exports:fixtureEncoder()});
 servers=[['/api/create/',review.origin],['/api/publishing-studio',review.origin],['/api/artifacts/picker.',review.origin],['/api/video/',video.origin]];
 for(const app of new Set(SCREENS.map(([app])=>app)))profiles[app]=await todayProfile(app);
 browser=await toolchain('playwright').chromium.launch({headless:true});
});
after(async()=>{await browser?.close();for(const fn of cleanups.reverse())await fn().catch(()=>{});});

/** @description Wait for a check to hold. @param {function():Promise<boolean>} check @param {number} [ms] @returns {Promise<boolean>} */
async function until(check,ms=10000){for(const end=Date.now()+ms;Date.now()<end;){if(await check())return true;await new Promise(done=>setTimeout(done,200));}return check();}

/**
 * @description The chat window a press put on screen: the editor's own, else Today's rail, else Today's ball panel.
 * @param {object} page Today. @param {object} frame The editor's page.
 * @returns {Promise<{where:string,src:string,typing:boolean,close:object}|null>}
 */
async function openedWindow(page,frame){
 const own=await editorWindow(frame);
 if(own.shown)return{where:'the editor',src:own.src,typing:own.typing,close:frame.frameLocator('iframe.jarvis-chat-frame').locator('.jc-header .jc-panel-close')};
 for(const [where,selector] of [['Today\'s rail','#chatPanel:not(.collapsed) #chatWorkspaceFrame'],['Today\'s ball panel','#jarvisOrbPanel.open iframe']]){
  if(!await page.locator(selector).count()||!await page.locator(selector).first().isVisible())continue;
  const window=page.frameLocator(selector).first();
  return{where,src:await page.locator(selector).first().getAttribute('src'),typing:await window.locator('.jc-composer #typein').isVisible().catch(()=>false),close:window.locator('.jc-header .jc-panel-close')};
 }
 return null;
}

for(const [app,screen,path,concierge,bot] of SCREENS)for(const [size,options] of SIZES){
 test(`${size}: in ${app}'s Today, every concierge entry on ${screen} opens ${concierge}'s own concierge, which closes and opens again`,{timeout:180000},async t=>{
  const context=await browser.newContext(options);t.after(()=>context.close());
  const {writes,foreign}=await serveToday(context,{platform,kernel,profile:()=>profiles[app],servers});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const press=locator=>options.hasTouch?locator.tap():locator.click();
  await page.goto(`${TODAY_ORIGIN}/cockpit/?app=${app}&screen=${screen}`);
  const frame=await editorFrame(page,path);
  // The editor tells Today it holds its own concierge once its shell is up; give Today that moment, as a person's eye does.
  await page.waitForTimeout(1500);
  const entries=await conciergeEntries(page,frame);
  assert.ok(entries.length>0,`${screen} at ${size}: a person can see a concierge entry (seen: none)`);
  for(const [index,[name]] of entries.entries()){
   const entry=(await conciergeEntries(page,frame))[index]?.[1];
   assert.ok(entry,`${name} is still on screen before it is pressed`);
   await press(entry);
   const opened=await until(async()=>(await openedWindow(page,frame))?.typing===true);
   const window=await openedWindow(page,frame);
   assert.ok(opened&&window,`${name} on ${screen} at ${size} puts the concierge window on screen with its message box (seen: ${window?`${window.where}, message box ${window.typing}`:'no window on screen'})`);
   assert.match(window.src,new RegExp(`[?&]concierge=${concierge}(&|$)`),`${name} opens ${concierge}'s own concierge, in ${window.where}`);
   if(window.where==='the editor')assert.match(window.src,new RegExp(`[?&]bot=${bot}(&|$)`),`${name} binds the window to ${bot}`);
   await press(window.close);
   assert.ok(await until(async()=>!(await openedWindow(page,frame))),`the window's own Close closes ${concierge}'s concierge on ${screen} at ${size}`);
  }
  // Once closed, the entry a person sees first opens it again.
  const [name,entry]=(await conciergeEntries(page,frame))[0]||[];
  assert.ok(entry,`after Close a person can still see a concierge entry on ${screen} at ${size}`);
  await press(entry);
  assert.ok(await until(async()=>(await openedWindow(page,frame))?.typing===true),`${name} opens the concierge again`);
  assert.deepEqual(errors,[],'no page error');
  assert.deepEqual(foreign,[],'nothing leaves the fixture origin');
  assert.deepEqual(writes.filter(write=>!write.startsWith('POST /api/cockpit/recents')),[],'Today sends no other write');
 });
}
