/** Actual HTML/modules in Chromium; named shell/catalog/Guide/generation HTTP fixtures.
 * This proves draft interaction and request delivery, not provider/native artifact fidelity.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const toolchain=resolve(process.env.STORE_CI_TOOLCHAIN || resolve(root,'scripts/toolchain'));
const {chromium}=createRequire(resolve(toolchain,'package.json'))('playwright');
const theme={id:'executive',name:'Executive',mood:'clear',cover:'wash',decor:'bar',darkCanvas:true,headingCase:'normal',fonts:{heading:'Arial',body:'Arial'},colors:{deep:'17202b',deepInk:'ffffff',deepInkSoft:'c7d2df',accent:'4cc9f0',accent2:'f72585',canvas:'ffffff',canvasAlt:'eef4f8',ink:'17202b',inkSoft:'536476',line:'d4dce7'}};
async function fixture(){
  const guideBodies=[],renders=[],savedDrafts=[];let guideRelease=null;let holdGuide=false;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    try{
      if(url.pathname==='/api/presentations/sections/ui'){res.setHeader('content-type','text/html');res.end(await readFile(resolve(root,'presentations/tools/presentations.html')));return;}
      if(/^\/api\/presentations\/sections\/assets\/(office-workspace\.css|office-assistant\.mjs|slide-workspace\.(mjs|css)|sheet-workspace\.(mjs|css))$/.test(url.pathname)){
        res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(resolve(root,'presentations/tools',basename(url.pathname))));return;
      }
      if(url.pathname.endsWith('/themes'))return json(200,{themes:[theme],layouts:[],defaultTheme:theme.id});
      if(url.pathname.endsWith('/starters'))return json(200,{kinds:[],starters:[]});
      if(url.pathname.endsWith('/destination'))return json(200,{provider:'oshal-local',folder:'files',subfolder:'oshal',isDefault:true});
      if(url.pathname.endsWith('/list'))return json(200,{decks:savedDrafts});
      if(req.method==='POST'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
        if(url.pathname.endsWith('/guide')){guideBodies.push(body);if(holdGuide){holdGuide=false;await new Promise(resolve=>{guideRelease=resolve;});}return json(200,{reply:'Suggested an edit.',actions:body.kind==='xlsx'?[{op:'update_cell',index:1,cell:'B2',value:'250'}]:[{op:'update_slide',index:2,title:'Revised goal'}]});}
        if(/\/(pptx|xlsx|docx)$/.test(url.pathname)){renders.push(body);savedDrafts.push({title:body.title||'Fixture',fileName:'fixture.office',format:basename(url.pathname),theme:theme.id,outlineComplete:true,outline:body.sections.map(s=>({title:s.title,bullets:s.content.split('\n'),sourceVersion:2}))});return json(200,{ok:true,provider:'oshal-local',location:'fixture.office',format:basename(url.pathname),slides:body.sections.length});}
      }
      // Named shell fixtures: no connected workflow or surface relay actions.
      if(url.pathname==='/cockpit/js/app-handoff.js'){res.setHeader('content-type','text/javascript');res.end('export function receiveHandoff(){}');return;}
      if(url.pathname==='/cockpit/js/app-workflows.js'){res.setHeader('content-type','text/javascript');res.end('export async function mountConnectedActions(){}');return;}
      if(url.pathname.endsWith('.js')){res.setHeader('content-type','text/javascript');res.end('');return;}
      if(url.pathname.endsWith('.css')){res.setHeader('content-type','text/css');res.end(':root{--bg-primary:#f4f6fb;--bg-secondary:#fff;--bg-tertiary:#eee;--border-color:#ccd4e0;--text-primary:#17202b;--text-secondary:#536476;--accent-primary:#5355cc;--status-success:#2c99b8;--bg:#f4f6fb;--panel:#fff;--panel2:#eee;--line:#ccd4e0;--text:#17202b;--muted:#536476;--accent:#5355cc;--accent2:#2c99b8}');return;}
      return json(404,{error:'fixture_not_available'});
    }catch(error){return json(500,{error:error.message});}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {holdNextGuide:()=>{holdGuide=true;},releaseGuide:()=>guideRelease?.(),savedDrafts,server,origin:`http://127.0.0.1:${server.address().port}`,guideBodies,renders};
}

test('shipped workspace keeps chat visible, reviews suggestions and refuses stale proposals',async()=>{
  const app=await fixture();const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(15000);
  try{
    await page.goto(app.origin+'/api/presentations/sections/ui?kind=pptx&workspace=1');
    await page.waitForFunction(()=>!document.querySelector('#wiz').classList.contains('on'));
    await page.waitForFunction(()=>Boolean(window.officeProposalReview));
    await page.evaluate(()=>{document.querySelector('#outline').value='Intro\n  Keep this  \n\nGoal\nImprove this';document.querySelector('#outline').dispatchEvent(new Event('input'));});
    await page.waitForFunction(()=>document.querySelector('#slideWorkspace').textContent.includes('Goal'));
    await page.locator('#tabDecks').click();assert.equal(await page.locator('#paneGuide').isVisible(),true);
    await page.locator('#chatIn').fill('Improve the second slide');await page.locator('#chatSend').click();
    await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
    assert.match(await page.locator('#outline').inputValue(),/Goal\nImprove this/);
    await page.getByRole('button',{name:'Apply changes',exact:true}).click();
    assert.match(await page.locator('#outline').inputValue(),/Intro\n  Keep this  \n\nRevised goal\nImprove this/);
    assert.equal(app.guideBodies[0].kind,'pptx');
    await page.locator('#chatIn').fill('Improve it again');await page.locator('#chatSend').click();await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
    await page.evaluate(()=>{document.querySelector('#outline').value+='\nA later human edit';document.querySelector('#outline').dispatchEvent(new Event('input'));});
    await page.getByRole('button',{name:'Apply changes',exact:true}).click();
    assert.match(await page.locator('#chat').innerText(),/draft changed/);assert.match(await page.locator('#outline').inputValue(),/A later human edit/);
    await page.locator('#genBtn').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('saved'));
    assert.equal(app.renders.length,1);assert.equal(app.renders[0].sections[0].content,'  Keep this  ');assert.match(app.renders[0].sections[1].content,/A later human edit/);
    const savedSource=await page.locator('#outline').inputValue();await page.locator('#tabDecks').click();await page.locator('.fRow').click();await page.locator('#fEdit').click();assert.equal(await page.locator('#outline').inputValue(),savedSource);
    if(process.env.OSHAL_OFFICE_SCREENSHOT_DIR){await mkdir(process.env.OSHAL_OFFICE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.OSHAL_OFFICE_SCREENSHOT_DIR,'presentation-desktop.png'),fullPage:true});}
    await page.setViewportSize({width:390,height:844});await page.locator('#officePartner').click();assert.equal(await page.locator('#chatIn').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});


test('full Office spreadsheet sends selected cell context and applies a reviewed cell patch without replacing other rows',async()=>{
  const app=await fixture();const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(15000);
  try{
    await page.goto(app.origin+'/api/presentations/sections/ui?kind=xlsx');await page.waitForFunction(()=>Boolean(window.officeProposalReview));
    await page.selectOption('#officeFormat','xlsx');
    const original='Budget\n| Item | Cost |\n| Rent | 100 |\n| Food | 50 |\n\nNotes\nKeep these notes';
    await page.evaluate(value=>{document.querySelector('#outline').value=value;document.querySelector('#outline').dispatchEvent(new Event('input'));},original);
    await page.getByRole('gridcell',{name:'B2',exact:true}).click();
    await page.locator('#chatIn').fill('Set this cell to 250');await page.locator('#chatSend').click();await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
    assert.equal(await page.locator('#outline').inputValue(),original);
    assert.deepEqual(app.guideBodies[0].selection,{kind:'xlsx',index:1,title:'Budget',cell:'B2',value:'100'});
    await page.getByRole('button',{name:'Apply changes',exact:true}).click();
    assert.equal(await page.locator('#outline').inputValue(),original.replace('Rent | 100','Rent | 250'));
    await page.getByRole('gridcell',{name:'B2',exact:true}).dblclick();await page.getByRole('textbox',{name:'Cell value or formula text'}).fill('300');await page.getByRole('button',{name:'Apply',exact:true}).click();
    await page.getByRole('gridcell',{name:'B3',exact:true}).dblclick();await page.getByRole('textbox',{name:'Cell value or formula text'}).fill('75');await page.getByRole('button',{name:'Apply',exact:true}).click();
    const undo=page.locator('#sheetWorkspace').getByRole('button',{name:'Undo',exact:true}),redo=page.locator('#sheetWorkspace').getByRole('button',{name:'Redo',exact:true});
    await undo.click();await undo.click();assert.equal(await page.locator('#outline').inputValue(),original.replace('Rent | 100','Rent | 250'));
    await redo.click();await redo.click();assert.match(await page.locator('#outline').inputValue(),/Rent \| 300/);assert.match(await page.locator('#outline').inputValue(),/Food \| 75/);
    await page.locator('#genBtn').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('saved'));assert.equal(app.renders[0].sections[1].content,'Keep these notes');
    if(process.env.OSHAL_OFFICE_SCREENSHOT_DIR){await mkdir(process.env.OSHAL_OFFICE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.OSHAL_OFFICE_SCREENSHOT_DIR,'spreadsheet-desktop.png'),fullPage:true});}
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});

test('document workspace edits a selected section and uses the same visible AI partner and export source',async()=>{
  const app=await fixture();const browser=await chromium.launch({headless:true});const page=await browser.newPage();
  page.setDefaultTimeout(15000);
  try{
    await page.goto(app.origin+'/api/presentations/sections/ui?kind=docx');await page.waitForFunction(()=>Boolean(window.officeProposalReview));await page.selectOption('#officeFormat','docx');
    await page.evaluate(()=>{document.querySelector('#outline').value='Introduction\nKeep first\n\nDetails\nOriginal detail';document.querySelector('#outline').dispatchEvent(new Event('input'));});
    await page.locator('#documentWorkspace').getByRole('button',{name:'Details',exact:true}).click();
    const content=page.getByRole('textbox',{name:'Section content',exact:true});await content.fill('Human document edit');await content.blur();
    assert.equal(await page.locator('#outline').inputValue(),'Introduction\nKeep first\n\nDetails\nHuman document edit');
    await page.locator('#chatIn').fill('Improve this section heading');await page.locator('#chatSend').click();await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
    assert.deepEqual(app.guideBodies[0].selection,{kind:'docx',index:2,title:'Details'});await page.getByRole('button',{name:'Apply changes',exact:true}).click();
    assert.equal(await page.locator('#paneGuide').isVisible(),true);assert.match(await page.locator('#outline').inputValue(),/Revised goal\nHuman document edit/);
    await page.locator('#genBtn').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('saved'));assert.deepEqual(app.renders[0].sections,[{title:'Introduction',content:'Keep first'},{title:'Revised goal',content:'Human document edit'}]);
  }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});


test('Enter cannot start another Guide turn while a reply is pending',async()=>{
  const app=await fixture();const browser=await chromium.launch({headless:true});const page=await browser.newPage();
  page.setDefaultTimeout(15000);
  try{
    await page.goto(app.origin+'/api/presentations/sections/ui');await page.waitForFunction(()=>Boolean(window.officeProposalReview));
    app.holdNextGuide();await page.locator('#chatIn').fill('First request');await page.locator('#chatIn').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#chatSend').disabled);await page.locator('#chatIn').fill('Second request');await page.locator('#chatIn').press('Enter');
    await page.waitForTimeout(100);assert.equal(app.guideBodies.length,1);assert.equal(await page.locator('#chatIn').inputValue(),'Second request');
    assert.equal(await page.locator('#chatSend').isDisabled(),true);app.releaseGuide();await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();assert.equal(app.guideBodies.length,1);
  }finally{app.releaseGuide();await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});


test('older cropped saved previews cannot be silently reopened as complete source',async()=>{
  const app=await fixture();app.savedDrafts.push({title:'Older deck',fileName:'older.pptx',format:'pptx',theme:theme.id,outlineComplete:false,outline:[{title:'Preview only',bullets:['First two lines']}],slides:15});
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();
  try{
    await page.goto(app.origin+'/api/presentations/sections/ui');await page.waitForFunction(()=>Boolean(window.officeProposalReview));await page.locator('#tabDecks').click();await page.locator('.fRow').click();
    assert.equal(await page.locator('#fEdit').count(),0);assert.match(await page.locator('#decks').innerText(),/Full editable source is unavailable/);assert.equal(await page.locator('#wzRecent').isVisible(),false);
  }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});


test('fresh normal entry and kind links open authoring directly; walkthrough remains explicit',async()=>{
 const app=await fixture();const browser=await chromium.launch({headless:true});
 try{
  for(const query of ['', '?kind=pptx','?kind=docx','?kind=xlsx']){
   const page=await browser.newPage({viewport:{width:1440,height:900}});
   await page.goto(app.origin+'/api/presentations/sections/ui'+query);await page.waitForFunction(()=>Boolean(window.officeProposalReview));
   assert.equal(await page.locator('#wiz').isVisible(),false);
   assert.equal(await page.locator('#openBtn').isVisible(),true);
   const editor=query.includes('docx')?'#documentWorkspace':query.includes('xlsx')?'#sheetWorkspace':'#slideWorkspace';
   assert.equal(await page.locator(editor).isVisible(),true);
   await page.locator('#wzReopen').click();assert.equal(await page.locator('#wiz').isVisible(),true);
   await page.locator('#wzSkip').click();assert.equal(await page.locator('#wiz').isVisible(),false);
   await page.close();
  }
 }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});

test('long slide rail scrolls without pushing export out of view, and phone AI opens in the viewport',async()=>{
 const app=await fixture();const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.origin+'/api/presentations/sections/ui?kind=pptx');await page.waitForFunction(()=>Boolean(window.officeProposalReview));
  await page.evaluate(()=>{document.querySelector('#outline').value=Array.from({length:50},(_,i)=>'Slide '+(i+1)+'\nPoint one\nPoint two').join('\n\n');document.querySelector('#outline').dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>document.querySelectorAll('.office-slide-thumbnail').length===50);
  assert.deepEqual(await page.evaluate(()=>{const rail=document.querySelector('.office-slide-rail'),canvas=document.querySelector('.office-slide-canvas').getBoundingClientRect(),button=document.querySelector('#genBtn').getBoundingClientRect();return{railScrolls:rail.scrollHeight>rail.clientHeight+100,canvasFits:canvas.top>=0&&canvas.bottom<=innerHeight,exportFits:button.top>=0&&button.bottom<=innerHeight};}),{railScrolls:true,canvasFits:true,exportFits:true});
  await page.locator('.office-slide-thumbnail').last().click();assert.match(await page.locator('.office-slide-counter').innerText(),/Slide 50 of 50/);
  await page.setViewportSize({width:390,height:844});await page.locator('#officePartner').click();
  assert.equal(await page.locator('#chatIn').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.activeElement===el;}),true);
  await page.locator('#officePartnerClose').click();assert.equal(await page.locator('#officePartner').evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});

test('document paragraphs survive sections, history, reviewed Guide edits and full saved-source reopen',async()=>{
 const app=await fixture();const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.origin+'/api/presentations/sections/ui?kind=docx');await page.waitForFunction(()=>Boolean(window.officeProposalReview));
  const doc=page.locator('#documentWorkspace');await doc.getByRole('button',{name:'Add section',exact:true}).click();
  await page.getByRole('textbox',{name:'Section heading',exact:true}).fill('Introduction');
  const body='  First paragraph.  \n\nSecond paragraph.\n\n\nThird paragraph.';
  await page.getByRole('textbox',{name:'Section content',exact:true}).fill(body);
  assert.equal(await page.getByRole('textbox',{name:'Section content',exact:true}).evaluate(el=>document.activeElement===el),true);
  await doc.getByRole('button',{name:'Add section',exact:true}).click();
  await page.getByRole('textbox',{name:'Section heading',exact:true}).fill('Details');
  await page.getByRole('textbox',{name:'Section content',exact:true}).fill('Single paragraph.');
  await page.getByRole('textbox',{name:'Section content',exact:true}).fill('Updated detail.');
  await doc.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Section content',exact:true}).inputValue(),'Single paragraph.');
  await doc.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Section content',exact:true}).inputValue(),'Updated detail.');
  await doc.getByRole('button',{name:'Introduction',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Section content',exact:true}).inputValue(),body);
  await doc.getByRole('button',{name:'Details',exact:true}).click();
  await page.locator('#chatIn').fill('Improve this heading');await page.locator('#chatSend').click();await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
  assert.deepEqual(app.guideBodies[0].slides[0].bullets,body.split('\n'));
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await page.locator('#genBtn').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('saved'));
  const expected=[{title:'Introduction',content:body},{title:'Revised goal',content:'Updated detail.'}];assert.deepEqual(app.renders[0].sections,expected);
  await page.reload();await page.waitForFunction(()=>Boolean(window.officeProposalReview));await page.locator('#tabDecks').click();await page.locator('.fRow').click();await page.locator('#fEdit').click();
  await doc.getByRole('button',{name:'Introduction',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Section content',exact:true}).inputValue(),body);
  await page.locator('#genBtn').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('saved'));assert.deepEqual(app.renders[1].sections,expected);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});


test('pending cells settle before format, export or Guide handoff; malformed source never generates',async()=>{
 const app=await fixture();const browser=await chromium.launch({headless:true});const page=await browser.newPage();
 try{
  await page.goto(app.origin+'/api/presentations/sections/ui?kind=xlsx');await page.waitForFunction(()=>Boolean(window.officeProposalReview));
  await page.evaluate(()=>{document.querySelector('#outline').value='Budget\n| Item | Cost |\n| Rent | 100 |';document.querySelector('#outline').dispatchEvent(new Event('input'));});
  await page.getByRole('gridcell',{name:'B2',exact:true}).dblclick();await page.getByRole('textbox',{name:'Cell value or formula text'}).fill('111');
  await page.locator('#officeFormat').selectOption('pptx');assert.match(await page.locator('#outline').inputValue(),/Rent \| 111/);
  await page.locator('#officeFormat').selectOption('xlsx');await page.getByRole('gridcell',{name:'B2',exact:true}).dblclick();await page.getByRole('textbox',{name:'Cell value or formula text'}).fill('222');
  await page.locator('#genBtn').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('saved'));assert.match(app.renders[0].sections[0].content,/Rent \| 222/);
  await page.getByRole('gridcell',{name:'B2',exact:true}).dblclick();await page.getByRole('textbox',{name:'Cell value or formula text'}).fill('333');
  await page.locator('#chatIn').fill('Explain this cell');await page.locator('#chatSend').click();await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();assert.equal(app.guideBodies[0].selection.value,'333');
  await page.locator('#officeFormat').selectOption('docx');
  const malformed='{"format":"oshal-office-outline/1","sections":[{"title":"Title","content":"Body","owner":"foreign"}]}';
  await page.evaluate(value=>{document.querySelector('#outline').value=value;document.querySelector('#outline').dispatchEvent(new Event('input'));},malformed);
  await page.locator('#genBtn').click();assert.equal(app.renders.length,1);assert.equal(await page.locator('#outline').inputValue(),malformed);assert.match(await page.locator('#result').innerText(),/structured document source is invalid/);
 }finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});
