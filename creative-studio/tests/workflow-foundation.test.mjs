/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual brief editor and shared shell with catalog-checked editable handoffs and no generation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The design standard: one copy of each field (Title in the brief, Source link in Properties), the connected editors in ⋯ More, and the first pane named Saved.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const core=process.env.OSHAL_CORE_ROOT;
const platform=process.env.OSHAL_PLATFORM_ROOT;
assert.ok(core&&platform,'Matching dependency and kernel platform roots are required.');
const requireCore=createRequire(resolve(core,'package.json'));
const express=requireCore('express'),{chromium}=requireCore('playwright');
const APP='creative-studio',SURFACE='/api/'+APP+'/review';
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
function plan(){return{apps:[{integrationSources:[{app:APP,surfaces:[{url:SURFACE}],offers:[{id:'prepare-document',label:'Prepare a document',sourceApp:APP,targetApp:'presentations',targetAction:'prepare-brief',contextType:'research-brief',version:1,state:'available',fields:['title','notes','sourceUrl'],surface:'office',surfaceUrl:'/api/presentations/sections/ui'}]}]}]};}
async function fixture(t,width=1280){
 const app=express(),requests=[];
 app.use((req,res,next)=>{requests.push({method:req.method,path:req.path});if(!['GET','HEAD'].includes(req.method))return res.status(405).json({error:'no_generation_in_fixture'});next();});
 app.get('/fixture',(_req,res)=>res.type('html').send(`<!doctype html><html><head><style>body{margin:0}iframe{display:block;width:100%;height:100vh;border:0}</style></head><body><iframe id="studio"></iframe><script type="module">import{bindAppHandoffs}from'/cockpit/js/app-workflows.js';window.handoffs=[];window.navigations=[];const frame=document.getElementById('studio');window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data?.type==='oshal:request-app-context')handoffs.push(event.data);});bindAppHandoffs(frame,(id,options)=>navigations.push({id,options}));frame.src='${SURFACE}';</script></body></html>`));
 app.get('/api/'+APP+'/source-project-editor.mjs',(_req,res)=>res.type('text/javascript').sendFile(resolve(root,'tools/source-project-editor.mjs')));
 app.get('/api/'+APP+'/source-projects',(_req,res)=>res.json({projects:[]}));
 app.get(SURFACE,(_req,res)=>res.sendFile(resolve(root,'tools/review.html')));
 app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));app.use('/cockpit',express.static(resolve(platform,'src/pages/cockpit')));
 app.get('/api/swarm/apps/home-plan',(_req,res)=>res.json(plan()));
 app.get('/api/vids/jobs',(_req,res)=>res.json({workers:[],jobs:[]}));
 app.get('/api/'+APP+'/home-summary',(_req,res)=>res.json({metrics:[{label:'Saved work',value:'1'}],items:[{text:'Saved evidence',detail:'Recorded source brief',actions:[{context:{title:'Saved title',notes:'Saved source notes',sourceUrl:'https://example.test/source'}}]}]}));
 app.use((_req,res)=>res.status(404).json({error:'outside_fixture'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 const context=await browser.newContext({viewport:{width,height:900}});t.after(async()=>{await context.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
 const frame=page.frameLocator('#studio');await frame.locator('.ef-shell').waitFor();await frame.locator('.source-project-actions').waitFor();await frame.locator('#records button').waitFor({state:'attached'});
 return{page,frame,requests,errors};
}
test('shared brief properties update real source controls and an explicit handoff carries the edited source',async t=>{
 const{page,frame,requests,errors}=await fixture(t);
 await frame.getByRole('button',{name:'Use this evidence',exact:true}).click();
 assert.equal(await frame.locator('#title').inputValue(),'Saved title');assert.equal(await frame.locator('[data-editor-property="title"]').count(),0,'Title is edited in the brief only');
 const link=frame.locator('[data-editor-property="sourceUrl"]');assert.equal(await link.inputValue(),'https://example.test/source');await link.fill('https://example.test/edited');await link.press('Tab');
 assert.equal(await frame.locator('#sourceUrl').inputValue(),'https://example.test/edited');await frame.locator('#title').fill('Edited title');await frame.locator('#notes').fill('Manual source for the receiving editor');
 await frame.getByRole('button',{name:'More',exact:true}).click();await frame.getByRole('menuitem',{name:'Edit brief as document',exact:true}).click();
 await page.waitForFunction(()=>window.navigations.length===1);
 const handoff=await page.evaluate(()=>window.handoffs[0]);assert.equal(handoff.offer,'prepare-document');assert.deepEqual(handoff.context,{title:'Edited title',notes:'Manual source for the receiving editor',sourceUrl:'https://example.test/edited'});
 assert.equal(requests.some(item=>item.method==='POST'),false);assert.deepEqual(errors,[]);
});
test('phone navigation and properties preserve the editable brief without overflowing the page',async t=>{
 const{frame,requests,errors}=await fixture(t,412);
 await frame.locator('.ef-tools').getByRole('button',{name:'Saved',exact:true}).click();await frame.getByRole('button',{name:'Use this evidence',exact:true}).click();
 await frame.getByRole('button',{name:'Close navigation',exact:true}).click();await frame.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true}).click();
 const link=frame.locator('[data-editor-property="sourceUrl"]');await link.fill('https://example.test/phone');await link.press('Tab');await frame.getByRole('button',{name:'Close inspector',exact:true}).click();
 assert.equal(await frame.locator('#sourceUrl').inputValue(),'https://example.test/phone');assert.equal(await frame.locator('#title').inputValue(),'Saved title');assert.equal(await frame.locator('#notes').inputValue(),'Saved source notes');assert.equal(await frame.locator('html').evaluate(el=>el.scrollWidth>innerWidth),false);
 assert.equal(requests.some(item=>item.method==='POST'),false);assert.deepEqual(errors,[]);
});
