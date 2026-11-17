/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Motion Studio on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06, F7: an "Open a composition" dropdown first, an empty "Create or open a composition to start" box and dead playback buttons; the trial check: 244 px of bars and sheets 15 px over the pane bar): the app bar is one row and content starts within 74 px of the frame (120 px with the 46 px Today row); with no composition the one primary action is New composition and no dead control is drawn; one tap creates and opens a blank composition with Play live; a pane opens as a sheet that stays clear of the pane bar. Real routes over disposable PostgreSQL and the real framed compositor, and the kernel's shared editor from OSHAL_PLATFORM_ROOT.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.2.4 (the round-2 trial check, 2026-11-06: in the Concierge sheet a full-width + pushed Read latest reply aloud and Send off the right edge, so Send could not be tapped): every Concierge control is inside the sheet and under the finger at its centre, the + and the speaker are icon-sized, and the same holds in the 1440x900 Concierge column.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.3.0, the design standard layout: the blank composition's one first action is Add layer (it replaced New composition), the panes are reached from the bottom bar (Layers · Add · Properties · Concierge · More) and open as sheets, and the Concierge opens from that bar. The round-1 and round-2 guards stay: one app bar row, content within 74 px, no dead control before a composition exists, live Play once there is one, sheets clear of the app bar and the bottom bar, and the Concierge composer on screen and under the finger.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The shared composer gains a microphone beside Read aloud where a speech engine runs (kernel editor-assistant-voice.js, Roger F13): it is one more icon button that must sit inside the sheet and under the finger; on a platform without it the row is unchanged.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98; Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The composer is the window's: its model menu, Files, Tap to talk, Keep trying and Send are each inside the sheet (and the 1440x900 column) and under the finger at their centre, the page hitting the window's frame there and the window the control; Send is live once there is a message. The old pane's Attach, Read aloud and icon-size and colour checks are gone with its composer (the 1440x900 case found none of them on the new pane and passed with nothing measured).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The concierge each case opens is asserted by its address (the coordinator's rule after Roger's 2026-11-17 02:22Z report, where a concierge opened as another application's): the one chat window, /api/jarvis/?concierge=motion-studio&bot=motion-editor, read with scripts/one-chat-window/today-host.mjs windowAddress.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {startApplicationFixture,chromium} from '../application-fixture.mjs';
import {chatWindow,windowControls} from '../../../scripts/one-chat-window/kernel-window.mjs';
import {windowAddress} from '../../../scripts/one-chat-window/today-host.mjs';
/** The window the Concierge opened is Motion's own concierge, by its address. */
async function motionConcierge(scope){const where=await windowAddress(scope);assert.deepEqual([where.path,where.app,where.bot],['/api/jarvis/','motion-studio','motion-editor'],'the one chat window as Motion\'s own concierge');}
const PHONE={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2.5};
const overlaps=(a,b)=>Boolean(a&&b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height);

async function open(t){
 const f=await startApplicationFixture(),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const page=await (await browser.newContext(PHONE)).newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));page.setDefaultTimeout(30000);
 await page.goto(f.origin+'/api/motion-studio/app');await page.locator('.ef-shell').waitFor();await page.locator('#new button:enabled').waitFor({state:'attached'});
 await page.getByRole('button',{name:'Add layer',exact:true}).waitFor();return{f,page};
}
const drawn=page=>page.evaluate(()=>[...document.querySelectorAll('.ef-viewport :is(button,summary,select,input,a[href])')].filter(node=>{
 for(let up=node.parentElement;up;up=up.parentElement)if(up.tagName==='DETAILS'&&!up.open&&!(node.tagName==='SUMMARY'&&node.parentElement===up))return false;
 const box=node.getBoundingClientRect();return node.getClientRects().length&&box.width>1&&box.bottom>0&&box.top<innerHeight;}).map(node=>({text:node.textContent.trim()||node.id||node.name,disabled:Boolean(node.disabled)})));

test('the first screen: one app bar row, content within 74 px, Add layer as the one first action and no dead control',{timeout:180000},async t=>{
 const {page}=await open(t);
 const bar=await page.evaluate(()=>({shell:Math.round(document.querySelector('.ef-shell').getBoundingClientRect().top),viewport:Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top),
  items:[...document.querySelectorAll('.ef-header-slot header > :is(h1,span,button,select,summary)')].filter(node=>node.getClientRects().length&&node.textContent.trim()&&!node.classList.contains('motion-sr')).map(node=>{const box=node.getBoundingClientRect();return{text:node.textContent.trim(),top:Math.round(box.top),bottom:Math.round(box.bottom)};})}));
 assert.equal(bar.shell,0,'no empty band above the app bar');assert.ok(bar.viewport<=74,`content starts ${bar.viewport}px into the frame ${JSON.stringify(bar.items)}`);
 assert.equal(bar.items.some(item=>item.text==='Motion Studio'),false,'the Today row already names Motion Studio');
 assert.ok(Math.max(...bar.items.map(item=>item.top))<Math.min(...bar.items.map(item=>item.bottom)),'one row '+JSON.stringify(bar.items));
 const controls=await drawn(page);
 assert.deepEqual(controls.filter(control=>control.disabled),[],'no dead control before a composition exists');
 assert.deepEqual(controls.map(control=>control.text),['Add layer'],'one primary first action');
 assert.deepEqual(await page.locator('.motion-toolrow .motion-word').allTextContents(),['Layers','Add','Properties','Concierge','More']);
});

test('Add layer then Text saves the blank composition with live playback, and a pane sheet stays clear of the bottom bar',{timeout:180000},async t=>{
 const {page}=await open(t);
 await page.getByRole('button',{name:'Add layer',exact:true}).tap();await page.getByRole('menuitem',{name:'Text',exact:true}).tap();
 await page.locator('#revision').filter({hasText:'revision 2'}).waitFor({timeout:90000});
 assert.equal(await page.locator('.motion-start').isVisible(),false,'the first action leaves once there is a layer');
 const play=page.locator('#play');await play.scrollIntoViewIfNeeded();assert.equal(await play.isDisabled(),false,'Play is live on the open composition');
 await page.locator('.motion-toolrow').getByRole('button',{name:'Properties',exact:true}).tap();await page.locator('dialog[open] .ef-inspector').waitFor({state:'visible'});
 const boxes=await page.evaluate(()=>({sheet:document.querySelector('dialog[open]').getBoundingClientRect().toJSON(),panes:document.querySelector('.motion-toolrow').getBoundingClientRect().toJSON(),bar:document.querySelector('.ef-header-slot').getBoundingClientRect().toJSON()}));
 assert.equal(overlaps(boxes.sheet,boxes.panes),false,'the sheet stays above the pane bar '+JSON.stringify(boxes));assert.equal(overlaps(boxes.sheet,boxes.bar),false,'and below the app bar');
});

/**
 * Each control of the concierge's composer, which is the one chat window's (a frame in the pane): its name, whether it
 * lies inside the pane and the screen, and whether a press at its centre lands on it (the page hits the window's frame
 * there, and the window the control).
 */
async function composer(page,pane){
 const frame=await(await page.locator(pane+' iframe.jarvis-chat-frame').elementHandle()).contentFrame();
 const outer=await page.evaluate(pane=>{const box=node=>node.getBoundingClientRect().toJSON();return{pane:box(document.querySelector(pane)),frame:box(document.querySelector(pane+' iframe.jarvis-chat-frame')),width:innerWidth,height:innerHeight};},pane);
 const inner=await frame.evaluate(()=>[...document.querySelectorAll('.jc-composer :is(button,summary)')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>{
  const box=node.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2,hit=document.elementFromPoint(x,y);
  return{id:node.id||(node.closest('#typer')&&node.type==='submit'?'send':''),label:node.getAttribute('aria-label')||node.textContent.trim(),left:box.left,right:box.right,top:box.top,bottom:box.bottom,x,y,hit:hit===node||node.contains(hit)};}));
 const onFrame=await page.evaluate(({pane,points})=>{const frame=document.querySelector(pane+' iframe.jarvis-chat-frame');return points.map(([x,y])=>document.elementFromPoint(x,y)===frame);},{pane,points:inner.map(control=>[outer.frame.x+control.x,outer.frame.y+control.y])});
 return inner.map((control,i)=>{const left=outer.frame.x+control.left,right=outer.frame.x+control.right,top=outer.frame.y+control.top,bottom=outer.frame.y+control.bottom;
  return{id:control.id,label:control.label,inside:left>=outer.pane.x-1&&right<=outer.pane.x+outer.pane.width+1&&top>=outer.pane.y-1&&bottom<=outer.pane.y+outer.pane.height+1&&right<=outer.width&&bottom<=outer.height,hit:control.hit&&onFrame[i]};});
}
/** The window's own composer controls a person must reach: the model menu, Files, Tap to talk, Keep trying and Send. */
const REQUIRED=['jarvisModelBtn','addMediaBtn','mic','effortToggle','send'];

test('the Concierge sheet on a phone is the one chat window: its model menu, Files, Tap to talk, Keep trying and Send are on screen and under the finger',{timeout:180000},async t=>{
 const {page}=await open(t);
 await page.locator('.motion-toolrow').getByRole('button',{name:'Concierge',exact:true}).tap();await page.locator('dialog[open] .ef-assistant').waitFor({state:'visible'});
 const chat=await chatWindow(page.locator('dialog[open] .ef-assistant'));await windowControls(chat);await motionConcierge(page.locator('dialog[open] .ef-assistant'));
 const controls=await composer(page,'dialog[open] .ef-assistant');
 assert.deepEqual(REQUIRED.filter(id=>!controls.some(control=>control.id===id)),[],'every control of the window\'s composer is drawn '+JSON.stringify(controls));
 for(const control of controls){assert.equal(control.inside,true,control.label+' is inside the sheet '+JSON.stringify(controls));assert.equal(control.hit,true,control.label+' is under the finger '+JSON.stringify(controls));}
 if(process.env.MOTION_PHONE_SHOT)await page.screenshot({path:process.env.MOTION_PHONE_SHOT});
 await chat.locator('#typein').tap();await page.keyboard.type('Make the title bigger');
 assert.equal(await chat.locator('#typein').inputValue(),'Make the title bigger','the words land in the window\'s box');
 assert.equal(await chat.locator('#typer button[type=submit]').isEnabled(),true,'Send is live once there is a message');
});

test('the Concierge column at 1440x900: the window\'s composer controls sit inside it and can be clicked',{timeout:180000},async t=>{
 const f=await startApplicationFixture(),browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await f.close();});
 const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(f.origin+'/api/motion-studio/app');await page.locator('.ef-shell').waitFor();
 const concierge=page.locator('.ef-concierge');if(!await concierge.isVisible())await page.locator('.motion-toolrow').getByRole('button',{name:'Concierge',exact:true}).click();await concierge.waitFor({state:'visible'});
 const chat=await chatWindow(concierge);await windowControls(chat);await motionConcierge(concierge);
 const controls=await composer(page,'.ef-concierge');
 assert.deepEqual(REQUIRED.filter(id=>!controls.some(control=>control.id===id)),[],'every control of the window\'s composer is drawn '+JSON.stringify(controls));
 for(const control of controls){assert.equal(control.inside,true,control.label+' is inside the column '+JSON.stringify(controls));assert.equal(control.hit,true,control.label+' can be clicked '+JSON.stringify(controls));}
});
