/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | AI Office 2.19.0 against the oshal design standard (docs/ux/design-standard.md §3.1, §3.3, §4.3, §4.4, §4.10, §5.1; Google Docs, Word and ONLYOFFICE, REFP CONVENTIONS §5.1). At 412x743 with real touch and at 1440x900: the page declares its contract and its work; with nothing saved it opens on a blank Word page with the caret on line 1 and no "create or open" box; typing lands in the document, then Export is the one primary and Save is never it; one app row (Back, the name and its menu, Undo, Redo, Save, Export); the phone's bottom bar is Format, Insert, Comment, Concierge and More (Slides first for a presentation); every pane opens as an opaque sheet that the phone's Back closes inside the editor; Format has Text and Paragraph tabs with the planned Highlight after Text colour; the planned controls (RP-OFF-01..07, RP-ALL-01) are greyed, aria-disabled, linked to their backlog ids and inert; Delete asks in the page; with a document saved the first screen is Your documents with one New, and an existing document opens to read on a phone with one Edit; on a desktop the Format | Concierge pane is docked and Zoom Fit keeps the whole slide in view whichever pane is open (the inspector used to float over the canvas and clip the slide's right third); a text selection raises Cut, Copy, Paste and Comment at the selection. Real routes over disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT. Red on store main d88f3ed9 (AI Office 2.18.8).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-01..07): Highlight, Comment, Suggest changes, Find and replace, PDF and plain-text export, Mobile view and Share are now real controls in the same slots with zero RP-OFF-* planned attributes; RP-ALL-01 Summarize remains an inert planned control.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 2.20.1: verify the docked desktop Concierge composer stays pinned within 20px of the bottom of the right rail with zero outer rail/page scrollbar even when conversation messages scroll.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 2.20.2 (RP-ALL-01): verify the Concierge sheet renders the kernel's live Summarize prompt chip with zero duplicate greyed RP-ALL-01 placeholders.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The concierge pane is the kernel's one chat window (kernel 00c62f98; Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). The phone's Concierge sheet holds the window, with its message box and the kernel's live Summarize starter above it, where a tap at its centre lands on it (still no greyed RP-ALL-01 placeholder); on a desktop the Concierge tab opens the window in the docked pane beside the canvas, and the window's composer is pinned near the bottom of the right rail while its own conversation absorbs the scroll, with no outer rail, page or window scrollbar. The old pane's hidden stand-in box is not what a person types in, so it is no longer measured.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The concierge each case opens is asserted by its address (the coordinator's rule after Roger's 2026-11-17 02:22Z report, where a concierge opened as another application's): the one chat window, /api/jarvis/?concierge=presentations&bot=deck-builder, read with scripts/one-chat-window/today-host.mjs windowAddress. concierge-entry-browser.test.mjs opens AI Office inside Today.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 2.20.8: AI Office lays itself out around the one chat window. A new case proves that Generate a draft sits above the window, which reaches the rail's bottom on a desktop, and still writes its starter sentence into the window's own message box with the focus there (through the pane's stand-in box); that the phone's Concierge sheet (412x915) is as tall as a sheet may be and the window takes all of it under that row; and that the window's own Close closes the sheet and keeps the editor (on 2.20.7 it did nothing in the sheet). The phone sheet's tap on the Summarize starter and the desktop composer's place at the rail's bottom with no page scrollbar pass on 2.20.8 (red on 2.20.7: a 308 px window whose composer covered the starter, and the window's composer 64 px above the rail's bottom on a page 1 px taller than the screen).
 */
import{test}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{fixture}from'./fixture.mjs';
import{chatWindow}from'../../../scripts/one-chat-window/kernel-window.mjs';
import{windowAddress}from'../../../scripts/one-chat-window/today-host.mjs';
/** The window a Concierge opened is AI Office's own concierge, by its address. */
async function officeConcierge(scope){const where=await windowAddress(scope);assert.deepEqual([where.path,where.app,where.bot],['/api/jarvis/','presentations','deck-builder'],'the one chat window as AI Office\'s own concierge');}
const{chromium}=createRequire(import.meta.url)('playwright');
const PHONE={viewport:{width:412,height:743},isMobile:true,hasTouch:true,deviceScaleFactor:2.625};
const DESKTOP={viewport:{width:1440,height:900}};
const state=page=>page.evaluate(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>({kind:state.model.kind,id:state.id,revision:state.revision,reading:state.reading,text:state.model.pages?.[0]?.blocks?.map(block=>block.runs?.map(run=>run.text).join('')).join('\n'),objects:state.model.pages?.[0]?.objects?.length})));

async function open(t,size,query='?kind=docx',f=null){
 const own=!f;f??=await fixture({http:true});const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();if(own)await f.close();});
 const context=await browser.newContext(size),page=await context.newPage(),errors=[],dialogs=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.type());void dialog.dismiss();});
 await page.goto(f.origin+'/api/presentations/editor/app'+query);await page.locator('html[data-office-ready=true]').waitFor();await page.waitForTimeout(300);
 t.after(()=>{assert.deepEqual(errors,[],'no page errors');assert.deepEqual(dialogs.filter(type=>type!=='beforeunload'),[],'no native dialogs (DS-30)');});
 return{f,page};
}
/** The enabled primaries on screen (DS-24): buttons painted with the accent. */
const primaries=page=>page.evaluate(()=>[...document.querySelectorAll('button.primary')].filter(node=>!node.disabled&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>node.textContent.trim()));
const openLayer=page=>page.locator('dialog.ds-layer[open]');
async function bar(page){return page.locator('.office-bottom-bar > button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return{label:node.querySelector('.office-bar-label,.ds-not-yet-name')?.textContent,planned:node.hasAttribute('data-ds-not-yet'),backlog:node.dataset.dsBacklog??null,top:Math.round(box.top),inside:box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight};}));}
async function backStaysInApp(page){const url=page.url();await page.evaluate(()=>history.back());await openLayer(page).waitFor({state:'detached',timeout:3000});assert.equal(page.url(),url,'Back closed the layer and kept the editor');}

test('phone: a blank Word page with the caret on line 1, one app row, the bottom bar, and Export the one primary once there is text',{timeout:120000},async t=>{
 const{page}=await open(t,PHONE,'');
 assert.deepEqual(await page.evaluate(()=>({category:document.documentElement.dataset.dsCategory,first:document.documentElement.dataset.dsFirstAction,work:document.querySelector('[data-ds-work]')?.id})),{category:'editor',first:'type',work:'document-canvas'});
 assert.equal((await state(page)).kind,'docx','nothing saved opens a Word page');
 assert.equal(await page.evaluate(()=>document.activeElement?.closest?.('.office-word-page')!==null&&document.activeElement.isContentEditable),true,'the caret is on line 1');
 assert.doesNotMatch(await page.locator('body').innerText(),/Create or open/i);
 assert.deepEqual(await primaries(page),[],'a blank page has no button for its first action: typing is');
 const items=await bar(page);assert.deepEqual(items.map(item=>item.label),['Format','Insert','Comment','Concierge','More']);
 assert.equal(new Set(items.map(item=>item.top)).size,1,'one row');assert.ok(items.every(item=>item.inside),JSON.stringify(items));
 assert.deepEqual(items.filter(item=>item.planned).map(item=>item.backlog),[],'Comment is now a live bottom-bar control');
 const header=await page.locator('#office-header').boundingBox();assert.ok(header.height<=56,'the app row is one row of at most 56px: '+header.height);
 await page.keyboard.type('Hello from a phone');await page.waitForFunction(()=>document.querySelector('#office-export')&&!document.querySelector('#office-export').hidden);
 assert.equal((await state(page)).text,'Hello from a phone');
 assert.deepEqual(await primaries(page),['Export'],'Export is the one primary once there is content');
 assert.equal(await page.locator('#save-document').isVisible(),true);assert.equal(await page.locator('#save-document').evaluate(node=>node.classList.contains('primary')),false,'Save is secondary');
 const rows=await page.locator('#office-header > :is(button,div):visible').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return{top:box.top,bottom:box.bottom,right:box.right};}));
 assert.ok(Math.max(...rows.map(row=>row.top))<Math.min(...rows.map(row=>row.bottom)),'one row: '+JSON.stringify(rows));assert.ok(Math.max(...rows.map(row=>row.right))<=412,'nothing runs off the edge');
});

test('phone: Format, Insert, Concierge, More and Export open as opaque sheets that Back closes; RP-OFF-01..07 and Summarize are live controls with zero planned placeholders',{timeout:120000},async t=>{
 const{page}=await open(t,PHONE);
 await page.keyboard.type('Tabs');
 await page.locator('.office-bottom-bar').getByRole('button',{name:'Format',exact:true}).tap();await openLayer(page).waitFor();
 const format=await page.evaluate(()=>{const layer=document.querySelector('dialog.ds-layer[open]'),box=layer.getBoundingClientRect();return{modal:layer.matches(':modal'),bg:getComputedStyle(layer).backgroundColor,bottom:Math.round(box.bottom),tabs:[...layer.querySelectorAll('.office-format-tab')].map(node=>node.textContent),first:layer.querySelector('.ef-property-group:not([hidden]) [data-editor-property]')?.dataset.editorProperty,highlight:layer.querySelector('[data-editor-property="highlight"]')?.closest('label')?.previousElementSibling?.querySelector('[data-editor-property]')?.dataset.editorProperty,plannedCount:layer.querySelectorAll('[data-ds-not-yet]').length};});
 assert.equal(format.modal,true);assert.doesNotMatch(format.bg,/rgba\(.*, 0(\.\d+)?\)$/,'opaque');assert.equal(format.bottom,743,'a sheet from the bottom');
 assert.deepEqual(format.tabs,['Text','Paragraph']);assert.equal(format.first,'fontFamily','the Text tab starts with the font');assert.equal(format.highlight,'color','Highlight follows Text colour');assert.equal(format.plannedCount,0);
 await page.locator('dialog.ds-layer[open] .office-format-tab',{hasText:'Paragraph'}).tap();assert.equal(await page.locator('dialog.ds-layer[open] [data-editor-property=align]').isVisible(),true,'alignment is on the Paragraph tab');
 await backStaysInApp(page);
 await page.locator('.office-bottom-bar').getByRole('button',{name:'Insert',exact:true}).tap();await openLayer(page).waitFor();
 const before=(await state(page)).text;await page.getByRole('menuitem',{name:'Paragraph',exact:true}).tap();await openLayer(page).waitFor({state:'detached'});
 assert.equal((await state(page)).text.split('\n').length,before.split('\n').length+1,'Insert > Paragraph adds a paragraph');
 await page.locator('.office-bottom-bar').getByRole('button',{name:'More',exact:true}).tap();await openLayer(page).waitFor();
 assert.equal(await page.locator('dialog.ds-layer[open] [data-ds-not-yet]').count(),0,'all More backlog items are now real controls');
 const moreMenuIds=await page.locator('dialog.ds-layer[open] [data-office-menu]').evaluateAll(nodes=>nodes.map(n=>n.dataset.officeMenu));
 for(const id of ['find-replace','suggest-changes','mobile-view','share'])assert.ok(moreMenuIds.includes(id),`More includes ${id}`);
 await backStaysInApp(page);
 await page.locator('.office-bottom-bar').getByRole('button',{name:'Concierge',exact:true}).tap();await openLayer(page).waitFor();
 const chat=await chatWindow(openLayer(page));await officeConcierge(openLayer(page));
 assert.equal(await chat.locator('.jc-composer #typein').isVisible(),true,'the concierge composer (the one chat window\'s) is in the sheet');
 assert.equal(await page.locator('dialog.ds-layer[open] [data-ds-backlog="RP-ALL-01"]').count(),0,'no duplicate greyed RP-ALL-01 Summarize placeholder');
 const summarize=chat.locator('[data-concierge-prompt="Summarize"]');assert.equal(await summarize.isVisible(),true,'the kernel live Summarize prompt is in the window');
 // It sits above the composer where a finger can press it: a tap at its centre lands on it, not on the composer.
 const pressed=await summarize.evaluate(chip=>{const box=chip.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return hit===chip||chip.contains(hit)?'the Summarize prompt':hit?.closest('.jc-composer')?'the window\'s composer':String(hit?.className||hit?.tagName||'nothing');});
 assert.equal(pressed,'the Summarize prompt','a tap on the Summarize prompt lands on it');
 await backStaysInApp(page);
 await page.locator('#office-export').tap();await openLayer(page).waitFor();
 assert.equal(await page.locator('dialog.ds-layer[open] [data-ds-not-yet]').count(),0,'Export has no planned placeholders');
 const exportNames=await page.locator('dialog.ds-layer[open] .office-export-name').allTextContents();
 assert.deepEqual(exportNames,['Word file (.docx)','PDF (.pdf)','Plain text (.txt)','Editable project (.json)']);
 await backStaysInApp(page);
});

test('phone: New > Presentation puts Slides first; Delete asks in the page; Your documents and a document opened to read with one Edit',{timeout:150000},async t=>{
 const f=await fixture({http:true});t.after(()=>f.close());
 {const{page}=await open(t,PHONE,'',f);
  await page.keyboard.type('Kept');await page.locator('#save-document').tap();await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.revision===1));
  await page.locator('#document-name').tap();await openLayer(page).waitFor();await page.getByRole('menuitem',{name:'New…'}).tap();await page.getByRole('menuitem',{name:'Presentation',exact:true}).tap();
  await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.model.kind==='pptx'));
  assert.deepEqual((await bar(page)).map(item=>item.label),['Slides','Format','Insert','Concierge','More'],'Slides first for a presentation');
  assert.equal(await page.locator('#save-document').isVisible(),false,'an untouched presentation has nothing to save');
  await page.locator('.office-bottom-bar').getByRole('button',{name:'Insert',exact:true}).tap();await page.getByRole('menuitem',{name:'New slide',exact:true}).tap();
  await page.locator('#save-document').tap();await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.id&&state.revision===1));
  await page.locator('#document-name').tap();await page.getByRole('menuitem',{name:'Delete',exact:true}).tap();
  const confirm=page.locator('dialog.ds-confirm[open]');await confirm.waitFor();await confirm.getByRole('button',{name:'Delete document'}).tap();
  await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>!state.id));}
 {const{page}=await open(t,PHONE,'',f);
  assert.equal(await page.locator('#office-home').isVisible(),true,'with a document saved, the first screen is Your documents');
  const cards=await page.locator('.office-doc-card .office-doc-title').allTextContents();assert.deepEqual(cards,['Untitled document']);
  assert.deepEqual(await primaries(page),['+ New'],'one New');const box=await page.locator('#office-home-new').boundingBox();assert.ok(box.x+box.width>380&&box.y+box.height>680,'New is at the bottom right '+JSON.stringify(box));
  await page.locator('.office-doc-card').first().tap();await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.id&&state.reading));
  assert.deepEqual(await primaries(page),['Edit'],'an existing document opens to read with one Edit');assert.equal(await page.locator('.office-bottom-bar').isVisible(),false);
  assert.equal(await page.locator('.office-word-page [contenteditable=true]').count(),0,'reading, not editing');
  await page.locator('#office-edit').tap();await page.locator('.office-word-page [contenteditable=true]').first().waitFor();assert.equal(await page.locator('.office-bottom-bar').isVisible(),true,'Edit shows the tools');
  await page.locator('#office-back').tap();await page.locator('#office-home').waitFor();
  await page.locator('#office-home-new').tap();await page.getByRole('menuitem',{name:'Blank document',exact:true}).tap();
  await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>!state.id&&state.model.kind==='docx'));assert.equal(await page.locator('#office-home').isVisible(),false);}
});

test('desktop: Format | Concierge is one docked pane and Zoom Fit keeps the whole slide in view whichever pane is open',{timeout:120000},async t=>{
 const{page}=await open(t,DESKTOP,'?kind=pptx');
 const fits=()=>page.evaluate(()=>{const box=node=>node.getBoundingClientRect(),slide=box(document.querySelector('.office-slide')),canvas=box(document.querySelector('#document-canvas')),side=[...document.querySelectorAll('.ef-inspector,.ef-concierge')].find(node=>node.getClientRects().length&&getComputedStyle(node).display!=='none');return{slideLeft:slide.left,slideRight:slide.right,canvasLeft:canvas.left,canvasRight:canvas.right,side:side?box(side).left:null,nav:box(document.querySelector('.ef-navigation')).width};});
 const check=(value,label)=>{assert.ok(value.side!==null&&value.canvasRight<=value.side+1,label+': the pane is beside the canvas, not over it '+JSON.stringify(value));assert.ok(value.slideRight<=value.canvasRight+1&&value.slideLeft>=value.canvasLeft-1,label+': the whole slide is in view '+JSON.stringify(value));};
 // Open the properties pane by whichever control the screen has (2.18.8: the tools row's Properties, which floated the inspector over the canvas).
 const legacy=page.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true});
 if(await legacy.isVisible().catch(()=>false))await legacy.click();else await page.locator('.office-pane-tabs [data-pane=format]').click();await page.waitForTimeout(200);
 const first=await fits();check(first,'Format');
 assert.equal(await page.locator('.office-pane-tabs [data-pane=concierge]').isVisible(),true);assert.equal(await page.locator('.ef-concierge iframe.jarvis-chat-frame').isVisible(),false,'the concierge opens closed: one assistant entry');
 await page.locator('.office-pane-tabs [data-pane=concierge]').click();await chatWindow(page.locator('.ef-concierge'));await officeConcierge(page.locator('.ef-concierge'));await page.waitForTimeout(200);check(await fits(),'Concierge');
 await page.locator('.office-pane-tabs [data-pane=format]').click();await page.waitForTimeout(200);check(await fits(),'back to Format');
 await page.getByRole('button',{name:'Insert ▾'}).click();await page.getByRole('menuitem',{name:'Rectangle',exact:true}).click();await page.waitForTimeout(200);check(await fits(),'a selected shape');
 assert.equal(await page.locator('[data-editor-property=fill]').isVisible(),true,'the selection\'s properties are in the docked Format pane');
 assert.equal(Math.round(first.nav),240,'Slides in a 240px pane');
});

test('desktop: a text selection raises Cut, Copy, Paste and Comment at the selection, clear of it',{timeout:120000},async t=>{
 const{page}=await open(t,DESKTOP);
 await page.keyboard.type('Select these words');await page.keyboard.down('Shift');for(let i=0;i<5;i++)await page.keyboard.press('ArrowLeft');await page.keyboard.up('Shift');
 const bar=page.locator('.office-selection-bar');await bar.waitFor({state:'visible'});
 const facts=await page.evaluate(()=>{const node=document.querySelector('.office-selection-bar'),range=getSelection().getRangeAt(0).getBoundingClientRect(),box=node.getBoundingClientRect();return{popover:node.matches(':popover-open'),labels:[...node.children].map(child=>child.getAttribute('aria-label')??child.textContent.trim()),clear:box.bottom<=range.top||box.top>=range.bottom,near:Math.min(Math.abs(range.top-box.bottom),Math.abs(box.top-range.bottom))<=48};});
 assert.equal(facts.popover,true,'on the float layer');assert.deepEqual(facts.labels,['Cut','Copy','Paste','Comment','More for the selection']);assert.equal(facts.clear,true,'it never covers the selection');assert.equal(facts.near,true,'it sits at the selection');
 await bar.getByRole('button',{name:'Cut',exact:true}).click();await page.waitForFunction(()=>import('/api/presentations/editor/assets/state.mjs').then(({state})=>state.model.pages[0].blocks[0].runs.map(run=>run.text).join('')==='Select these '));
});

test('desktop: Concierge composer is pinned flush at the bottom of the right rail with zero outer scrollbar',{timeout:120000},async t=>{
 const{page}=await open(t,DESKTOP,'?kind=docx');
 await page.locator('.office-pane-tabs [data-pane=concierge]').click();
 // The concierge is the one chat window docked in the rail: its composer and its conversation are inside its frame.
 await chatWindow(page.locator('#office-root .ef-concierge'));await officeConcierge(page.locator('#office-root .ef-concierge'));
 await page.waitForTimeout(150);
 const frame=await(await page.locator('#office-root .ef-concierge iframe.jarvis-chat-frame').elementHandle()).contentFrame();
 const measure=async()=>{
  const outer=await page.evaluate(()=>{
   const rail=document.querySelector('#office-root .ef-concierge'),ai=document.getElementById('office-ai'),assistant=rail.querySelector('.ef-assistant'),frame=rail.querySelector('iframe.jarvis-chat-frame');
   return{railBottom:rail.getBoundingClientRect().bottom,frameTop:frame.getBoundingClientRect().top,docOverflowY:document.documentElement.scrollHeight>window.innerHeight,railOverflowY:rail.scrollHeight>rail.clientHeight,aiOverflowY:ai.scrollHeight>ai.clientHeight,assistantOverflowY:assistant.scrollHeight>assistant.clientHeight};
  });
  const inner=await frame.evaluate(()=>{
   // The conversation scrolls in its own container, never as the window's page.
   let scroller=document.getElementById('convo');while(scroller&&scroller!==document.body&&!(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)&&scroller.scrollHeight>scroller.clientHeight))scroller=scroller.parentElement;
   return{composerBottom:document.querySelector('.jc-composer').getBoundingClientRect().bottom,windowOverflowY:document.documentElement.scrollHeight>innerHeight,logScrolls:Boolean(scroller)&&scroller!==document.body};
  });
  const{railBottom,frameTop,...rest}=outer;return{bottomGap:Math.round(railBottom-(frameTop+inner.composerBottom)),...rest,windowOverflowY:inner.windowOverflowY,logScrolls:inner.logScrolls};
 };
 const initial=await measure();
 assert.ok(initial.bottomGap>=0&&initial.bottomGap<=20,'composer sits pinned near rail bottom: '+JSON.stringify(initial));
 assert.equal(initial.docOverflowY,false,'no outer document scrollbar');
 assert.equal(initial.railOverflowY,false,'no outer right-rail scrollbar');
 assert.equal(initial.aiOverflowY,false,'no #office-ai scrollbar');
 assert.equal(initial.assistantOverflowY,false,'no .ef-assistant overflow');
 assert.equal(initial.windowOverflowY,false,'the window does not scroll as a page');
 await frame.evaluate(()=>{const section=document.getElementById('convoSect'),log=document.getElementById('convo');if(section)section.style.display='';for(let i=0;i<24;i++){const turn=document.createElement('div'),body=document.createElement('div');turn.className='msg bot';body.className='bx';body.textContent='Conversation turn '+i+' keeps scrolling inside the conversation only.';turn.append(body);log.append(turn);}});
 const crowded=await measure();
 assert.equal(crowded.logScrolls,true,'conversation absorbs the scroll');
 assert.ok(crowded.bottomGap>=0&&crowded.bottomGap<=20,'composer stays pinned at bottom when the conversation overflows: '+JSON.stringify(crowded));
 assert.equal(crowded.railOverflowY,false,'right rail still has zero outer scrollbar');
 assert.equal(crowded.docOverflowY,false,'document still has zero outer scrollbar');
 assert.equal(crowded.windowOverflowY,false,'and the window still does not scroll as a page');
});

test('the one chat window: Generate a draft sits above it and writes its starter into its message box; the phone sheet gives it all its room and its own Close closes the sheet',{timeout:150000},async t=>{
 const f=await fixture({http:true});t.after(()=>f.close());
 const starter='Create the content in this open Word document about ';
 // The Generate a draft row, the window's frame and the pane or sheet they are in, in page pixels.
 const places=(page,scope)=>page.evaluate(scope=>{const root=document.querySelector(scope),box=node=>{const r=node.getBoundingClientRect();return{top:Math.round(r.top),bottom:Math.round(r.bottom)};};return{row:box(root.querySelector('.office-prompts')),frame:box(root.querySelector('iframe.jarvis-chat-frame')),holder:box(root)};},scope);
 const frameOf=async(page,scope)=>(await page.locator(scope+' iframe.jarvis-chat-frame').elementHandle()).contentFrame();
 // What the window's own message box holds and whether it has the focus.
 const typed=frame=>frame.waitForFunction(words=>{const box=document.getElementById('typein');return box&&box.value===words&&document.activeElement===box;},starter,{timeout:10000});
 {const{page}=await open(t,DESKTOP,'?kind=docx',f);
  await page.locator('.office-pane-tabs [data-pane=concierge]').click();await chatWindow(page.locator('#office-root .ef-concierge'));
  const at=await places(page,'#office-root .ef-concierge');
  assert.ok(at.row.bottom<=at.frame.top,'Generate a draft is above the window, never under it: '+JSON.stringify(at));
  assert.equal(at.frame.bottom,at.holder.bottom,'the window reaches the bottom of the rail: '+JSON.stringify(at));
  await page.locator('#office-root .office-prompts').getByRole('button',{name:'Generate a draft',exact:true}).click();
  await typed(await frameOf(page,'#office-root .ef-concierge'));}
 {const{page}=await open(t,{...PHONE,viewport:{width:412,height:915}},'?kind=docx',f);
  await page.keyboard.type('Tabs');await page.locator('.office-bottom-bar').getByRole('button',{name:'Concierge',exact:true}).tap();
  const sheet=openLayer(page);await sheet.waitFor();const chat=await chatWindow(sheet);
  const at=await places(page,'dialog.ds-layer[open]');
  assert.ok(at.holder.top<=57&&at.holder.bottom===915,'the Concierge sheet is as tall as a sheet may be, under the app row: '+JSON.stringify(at));
  assert.ok(at.row.bottom<=at.frame.top&&at.frame.top-at.row.bottom<=1,'the window starts right under Generate a draft: '+JSON.stringify(at));
  assert.equal(at.frame.bottom,at.holder.bottom,'and takes the rest of the sheet, down to its bottom: '+JSON.stringify(at));
  await sheet.locator('.office-prompts').getByRole('button',{name:'Generate a draft',exact:true}).tap();
  await typed(await frameOf(page,'dialog.ds-layer[open]'));
  const url=page.url();await chat.locator('.jc-header .jc-panel-close').tap();await sheet.waitFor({state:'detached',timeout:3000});
  assert.equal(page.url(),url,'the window\'s Close closed the sheet and kept the editor');
  assert.equal(await page.locator('#office-root .ef-concierge #office-ai').count(),1,'the concierge is back in the editor, ready to open again');
  // Moved back, the window loads there again; the case ends once it has, so the fixture never closes under a load.
  await(await frameOf(page,'#office-root .ef-concierge')).waitForFunction(()=>document.readyState==='complete'&&Boolean(document.getElementById('typein')),null,{timeout:15000});}
});
