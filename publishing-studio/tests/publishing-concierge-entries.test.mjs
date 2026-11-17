/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.5.4 (Roger, 2026-11-17, in production: the concierge entry points of the editors inside Today were broken). scripts/editor-foundation/today-concierge.test.mjs covers Publishing as Create's screen; this covers Publishing's own Today (/cockpit/?app=publishing-studio&screen=publishing-studio) and the page opened alone, at 1440x900 and at 412x915 with touch, on Your publications (the first screen whenever a person has publications) and on the publication pressed open from it. Every concierge entry a person can see there (Today's bar Concierge, Today's ball, the studio's own Concierge as a button or a tab) is pressed as a person presses it (Playwright's own click or tap, never force and never a script click) and must put the one Jarvis chat window on screen with its message box, bound to Publishing's own concierge and bot (concierge=publishing-studio&bot=publishing-editor), not Today's own Jarvis; the window's own Close must close it, and the entry must open it again. A turn asked there reaches publishing-editor with context.app publishing-studio, with no publication on it from the list and with the open publication's recordId from the editor. Red on 0.5.3: on a desktop Today's bar Concierge opened a concierge the list kept hidden, and alone or on a phone the list had no concierge entry at all.
 */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/fixture.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
import {createPublication} from './fixtures/publishing-ui.mjs';
import {kernelPlatform,windowKernel,chatWindow,sendInWindow} from '../../scripts/one-chat-window/kernel-window.mjs';
import {TODAY_ORIGIN,serveToday,todayProfile,editorFrame,conciergeEntries,editorWindow} from '../../scripts/editor-foundation/today-shell.mjs';

const {chromium}=requireRuntime('playwright');
const APP='publishing-studio',BOT='publishing-editor',PAGE='/api/publishing-studio/app',TITLE='Spring fair flyer';
const SIZES=[['1440x900',{viewport:{width:1440,height:900}}],['412x915',{viewport:{width:412,height:915},isMobile:true,hasTouch:true}]];
const PLACES=[['in its own Today',`/cockpit/?app=${APP}&screen=${APP}`],['alone',PAGE]];
// Named, never looked for (tests/fixtures/shared-ui.mjs): the store gate sets OSHAL_KERNEL_PLATFORM to its pin.
const platform=kernelPlatform();
const kernel=windowKernel({answer:()=>'Here is a start for your flyer.'});
let f,browser,profile,publication;

before(async()=>{
 f=await fixture({http:true});
 publication=await createPublication(f,{title:TITLE});
 profile=await todayProfile(APP);
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await f?.close();});

/** @description Wait for a check to hold. @param {function():Promise<boolean>} check @param {number} [ms] @returns {Promise<boolean>} */
async function until(check,ms=10000){for(const end=Date.now()+ms;Date.now()<end;){if(await check())return true;await new Promise(done=>setTimeout(done,200));}return check();}

/** @description Today's own Jarvis (its rail or its ball's panel) open on screen. @param {object} page @returns {Promise<boolean>} */
async function todayChatOpen(page){
 for(const selector of ['#chatPanel:not(.collapsed) #chatWorkspaceFrame','#jarvisOrbPanel.open iframe'])
  if(await page.locator(selector).count()&&await page.locator(selector).first().isVisible())return true;
 return false;
}

/**
 * @description Press every concierge entry a person can see, one by one: each must put Publishing's own chat window on
 * screen with its message box, and the window's own Close must close it. The entry seen first then opens it again,
 * and the window is left open.
 * @param {object} page Today, or the studio alone. @param {object} frame The studio's page.
 * @param {function(object):Promise} press A click or a tap. @param {string} label Where, for the report.
 * @returns {Promise<string[]>} The entries pressed.
 */
async function everyEntry(page,frame,press,label){
 const entries=await conciergeEntries(page,frame);
 assert.ok(entries.length>0,`${label}: a person can see a concierge entry (seen: none)`);
 for(const [index,[name]] of entries.entries()){
  const entry=(await conciergeEntries(page,frame))[index]?.[1];
  assert.ok(entry,`${label}: ${name} is still on screen before it is pressed`);
  await press(entry);
  const opened=await until(async()=>(await editorWindow(frame)).typing);
  const window=await editorWindow(frame);
  assert.ok(opened,`${label}: ${name} puts the concierge window on screen with its message box (seen: ${JSON.stringify(window)})`);
  assert.match(window.src,new RegExp(`[?&]concierge=${APP}(&|$)`),`${label}: ${name} opens Publishing's own concierge`);
  assert.match(window.src,new RegExp(`[?&]bot=${BOT}(&|$)`),`${label}: ${name} binds the window to ${BOT}`);
  assert.equal(await todayChatOpen(page),false,`${label}: ${name} opens the studio's concierge, not Today's own Jarvis`);
  await press(frame.frameLocator('iframe.jarvis-chat-frame').locator('.jc-header .jc-panel-close'));
  assert.ok(await until(async()=>!(await editorWindow(frame)).shown),`${label}: the window's own Close closes the concierge ${name} opened`);
 }
 const [name,entry]=(await conciergeEntries(page,frame))[0]||[];
 assert.ok(entry,`${label}: after Close a person can still see a concierge entry`);
 await press(entry);
 assert.ok(await until(async()=>(await editorWindow(frame)).typing),`${label}: ${name} opens the concierge again`);
 return entries.map(([seen])=>seen);
}

/**
 * @description Ask in the open window, then close it with its own Close.
 * @param {object} frame The studio's page. @param {function(object):Promise} press @param {string} words
 * @returns {Promise<object>} The turn as publishing-editor's door got it.
 */
async function askAndClose(frame,press,words){
 const chat=await chatWindow(frame);
 const {ask}=await sendInWindow(chat,words,press,kernel);
 await press(chat.locator('.jc-header .jc-panel-close'));
 assert.ok(await until(async()=>!(await editorWindow(frame)).shown),'the window closes after the turn');
 return ask;
}

for(const [where,address] of PLACES)for(const [size,options] of SIZES){
 test(`${size}, ${where}: every concierge entry on Your publications and on the open publication opens Publishing's own concierge, which closes and opens again`,{timeout:180000},async t=>{
  const context=await browser.newContext(options);t.after(()=>context.close());
  const {writes,foreign}=await serveToday(context,{platform,kernel,profile:()=>profile,servers:[['/api/publishing-studio',f.url]]});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const press=locator=>options.hasTouch?locator.tap():locator.click();
  await page.goto(TODAY_ORIGIN+address);
  const frame=address===PAGE?page.mainFrame():await editorFrame(page,PAGE);
  await frame.locator('body[data-editor-foundation=ready][data-pub-view=list]').waitFor({timeout:30000});
  await frame.locator('#documents .pub-card',{hasText:TITLE}).waitFor();
  // The studio tells Today it holds its own concierge once its shell is up; give Today that moment, as a person's eye does.
  await page.waitForTimeout(1500);

  const listed=await everyEntry(page,frame,press,`${where} at ${size}, Your publications`);
  const fromList=await askAndClose(frame,press,'Suggest a theme for a spring fair flyer');
  assert.deepEqual([fromList.bot,fromList.context?.app,fromList.context?.recordId],[BOT,APP,undefined],'a turn from the list reaches publishing-editor with no publication on it');

  // The person presses the publication's card, and the studio opens it.
  await press(frame.locator('#documents .pub-card',{hasText:TITLE}));
  await frame.locator('body[data-pub-view=editor]').waitFor();
  await frame.waitForFunction(()=>document.querySelector('#revision')?.textContent==='Revision 1');
  const edited=await everyEntry(page,frame,press,`${where} at ${size}, the open publication`);
  const fromEditor=await askAndClose(frame,press,'Make the heading bolder');
  assert.deepEqual([fromEditor.bot,fromEditor.context?.app,fromEditor.context?.recordId],[BOT,APP,publication.id],'a turn from the open publication carries it');

  t.diagnostic(`entries on Your publications: ${listed.join(', ')}; on the open publication: ${edited.join(', ')}`);
  assert.deepEqual(errors,[],'no page error');
  assert.deepEqual(foreign,[],'nothing leaves the fixture origin');
  assert.deepEqual(writes.filter(write=>!write.startsWith('POST /api/cockpit/recents')),[],'Today sends no other write');
 });
}
