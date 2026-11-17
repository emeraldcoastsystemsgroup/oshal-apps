/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "i want one concierge for the entire app that can do everything that needs to be done in the app. it doesnt make sense to have 2 agents that cant perform the tasks"). One assistant and one conversation on every Career page, in Chromium over the shipped pages and the kernel's real shared assistant: a page with no document of its own hands over the person's Career record (the record My résumé and Work history hand over), so the kernel keeps one conversation for all of them; the pane shows that conversation on each page as the person typed it; and the Word document on My résumé is brought together with the main résumé around every turn. The manifest and the personas say the same: one bot answers a person, it carries every tool, and the worker is named as a worker. The kernel's ask endpoint is a recording stand-in; no model, no person's data.

 * 2 | maintainer@emeraldcoastsystemsgroup.com | The pane is the kernel's one chat window (kernel 00c62f98, Roger 2026-11-16: every concierge is the core Jarvis chat window). The cases ask in the window inside the pane: the turn reaches career-concierge in the Career record's conversation with the page's context on the turn's context and the person's words alone as its message (the window sends no page details in the message), the earlier conversation is in the window when it opens (a turn the old pane sent shows the page details the kernel kept after the person's words: the window shows a kept turn as it was kept), and the Word document and the main résumé are brought together around a turn. */
import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startConciergeFixture,chromium,sharedRoot} from './helpers/career-concierge-fixture.mjs';
import {chatWindow,sendInWindow} from '../../scripts/one-chat-window/kernel-window.mjs';
import {pageContext,surfaceOf} from '../tools/career-concierge.mjs';

const root=path.resolve(import.meta.dirname,'..'),repo=path.resolve(root,'..');
const require=createRequire(import.meta.url);
const yaml=require(require.resolve('js-yaml',{paths:[path.join(repo,'scripts/toolchain')]}));
const needsShared={skip:!sharedRoot&&'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (read only)'};
const SESSION='doc:career-hunter:master';
// An earlier turn as the kernel keeps it: the person's words, then the page details the pane sent along.
const EARLIER=[{role:'user',text:'Add my IL6 job\nCurrent saved document and selection: {"app":"career-hunter","surface":"work-history","recordId":"master"}'},
 {role:'assistant',text:'I proposed the change on a card.'}];
let browser,fixture;
before(async()=>{
 fixture=await startConciergeFixture((app,{repo:store})=>{
  app.get('/api/jarvis/history',(req,res)=>res.json({turns:req.query.sessionId===SESSION?EARLIER:[]}));
  // A made-up main résumé; the person has no Word document yet, so there is nothing to bring together, only the look.
  app.get('/api/career-hunter/resume/doc',(_req,res)=>res.json({revision:'c'.repeat(64),meta:{name:'Alex Fixture'},
   resume:{headline:'Engineer',summary:'Made-up summary.',competencies:[],skills:[],clearance:'',experience:[]}}));
  app.get('/api/career-hunter/settings',(_req,res)=>res.sendFile(path.join(store,'career-hunter/tools/career-settings.html')));
 });
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await fixture?.close();});

async function onPage(address,work){
 const context=await browser.newContext({viewport:{width:1280,height:915}}),page=await context.newPage();
 try{
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
  await page.goto(fixture.origin+address);
  // The bar draws its Concierge button before the pane is mounted; press it once the pane is there to open.
  const toggle=page.getByRole('button',{name:'Concierge',exact:true});await toggle.waitFor({timeout:15000});
  await page.locator('.cf-concierge').waitFor({state:'attached',timeout:15000});await toggle.click();
  const panel=page.locator('.ef-assistant');await panel.waitFor({state:'visible',timeout:15000});
  return await work(page,panel);
 }finally{await context.close();}
}
async function ask(panel,text){
 const before=fixture.calls.length,chat=await chatWindow(panel);
 await sendInWindow(chat,text,locator=>locator.click(),fixture.kernel);
 const since=fixture.calls.slice(before);
 return{since,sent:since.find(call=>call.method==='POST'&&call.path.endsWith('/ask')),chat};
}

test('Home and Settings hand the concierge the same Career record, so the kernel keeps one conversation for every page',needsShared,async()=>{
 for(const [address,surface,title] of [['/api/career-hunter/home','home','Home'],['/api/career-hunter/settings','settings','Settings']]){
  await onPage(address,async(_page,panel)=>{
   const {sent}=await ask(panel,'How many jobs have I saved?');
   assert.equal(sent.path,'/api/swarm/bots/career-concierge/ask','the one bot a person talks to');
   assert.equal(sent.body.sessionId,SESSION,`${title}: the same conversation`);
   const context=sent.body.context;
   assert.deepEqual([context.app,context.recordId,context.surface,context.title],['career-hunter','master',surface,title]);
   assert.match(context.fields.tools,/career_(database|settings)/,'the page names the tools its work uses');
   assert.equal(sent.body.message,'How many jobs have I saved?','the person\'s words alone; the page is on the context');
   assert.equal(context.fields.draft,false,'the record is handed over as a Career document is');
  });
 }
});

test('the conversation from another page is in the window when it opens',needsShared,async()=>{
 await onPage('/api/career-hunter/home',async(_page,panel)=>{
  const chat=await chatWindow(panel);
  await chat.locator('#convo .msg.bot .bx').getByText('I proposed the change on a card.').waitFor({timeout:15000});
  // The person's earlier words open the conversation. The kernel keeps a turn the old pane sent with the page details
  // it added after the words, and the window shows the kept text, so only the start of that turn is the person's.
  const said=(await chat.locator('#convo .msg.user .bx').allInnerTexts()).map(text=>text.trim());
  assert.equal(said.length,1,'one earlier message: '+JSON.stringify(said));assert.ok(said[0].startsWith('Add my IL6 job'),said[0]);
 });
});

/** Wait until the page has looked at the person's Word documents again since `mark` (a count of the fixture's calls). */
async function looked(mark){
 for(let waited=0;waited<5000;waited+=50){
  if(fixture.calls.slice(mark).some(call=>call.method==='GET'&&call.path==='/api/presentations/editor/documents'))return true;
  await new Promise(done=>setTimeout(done,50));
 }
 return false;
}
test('around a turn on a page with no document, the Word document and the main résumé are brought together',needsShared,async()=>{
 await onPage('/api/career-hunter/home',async(page,panel)=>{
  const start=fixture.calls.length,{since}=await ask(panel,'Is my resume loaded?');
  const order=since.map(call=>call.method+' '+call.path),asked=order.findIndex(line=>line.endsWith('/ask'));
  assert.ok(order.slice(0,asked).includes('GET /api/presentations/editor/documents'),'before the concierge reads: what was typed in the document is saved first');
  assert.equal(await looked(start+asked+1),true,'after the turn: the document follows');
  const mark=fixture.calls.length;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('oshal-package-tool-done',{detail:{app:'career-hunter',toolName:'career_resume_patch'}})));
  assert.equal(await looked(mark),true,'after an approved card: the document follows');
 });
});

test('a page says where the person is: its surface, its name, the job its address names',()=>{
 const win=(surface,pathname,search,title)=>({location:{pathname,search},document:{title,documentElement:{dataset:surface?{careerSurface:surface}:{}},querySelector:()=>null}});
 assert.equal(surfaceOf(win('work-history','/api/career-hunter/work-history','','Work history')),'work-history');
 assert.equal(surfaceOf(win('','/api/career-hunter/board-native','','My jobs')),'board-native');
 const board=pageContext(win('','/api/career-hunter/board-native','?view=queue','My jobs'));
 assert.deepEqual([board.recordId,board.surface,board.title,board.screen],['master','board-native','My jobs','surface']);
 assert.equal(board.fields.job,undefined);
 assert.match(board.fields.tools,/career_jobs/);
 assert.match(board.fields.always,/career_resume_section career_resume_patch/,'the résumé can be read and changed from any page');
 assert.equal(pageContext(win('','/api/career-hunter/application','?postingId=4821','Application')).fields.job,'4821');
 assert.equal(pageContext(win('','/api/career-hunter/application','?postingId=4821%20x','Application')).fields.job,undefined,'only a job number is passed on');
 for(const value of Object.values(board.fields))assert.ok(typeof value!=='string'||value.length<=200,'the kernel keeps 200 characters of a field');
 // The kernel narrows a Career turn to read-only by the message's words unless one says something is to be made
 // (bot_turns.rs implicit_career_read, jarvis_intent.rs asks_to_make); a read-only turn cannot hold an approval card.
 // The pane sends the context along as part of the message, and its `draft` field is that word, as on Work history.
 assert.ok('draft' in board.fields,'a turn from any page can hold an approval card');
 assert.match(JSON.stringify(board).toLowerCase().split(/[^a-z0-9]+/).join(' '),/\bdraft\b/);
});
