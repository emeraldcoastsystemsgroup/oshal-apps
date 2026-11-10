/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual brief editor and shared shell with catalog-checked editable handoffs and no generation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The design standard: one copy of each field (Title in the brief, Source link in Properties), the connected editors in ⋯ More, and the first pane named Saved.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: Resize (RP-BRG-02) hands 9:16 or 1:1 to Video Studio with the format named first in the brief, Schedule or post (RP-BRG-05) hands the brief to Switchboard Compose (offer prepare-post), and a scene's Edit on canvas (RP-BRG-07) hands that scene to AI Office's canvas, each through the cockpit's catalog-checked hand-off and with no POST. Red on 1.3.2 (the three were greyed).
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
const APP='brand-graphics',SURFACE='/api/'+APP+'/review';
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
function plan(){const offer=(id,targetApp,targetAction,contextType,surface,surfaceUrl)=>({id,label:id,sourceApp:APP,targetApp,targetAction,contextType,version:1,state:'available',fields:['title','notes','sourceUrl'],surface,surfaceUrl});
 return{apps:[{integrationSources:[{app:APP,surfaces:[{url:SURFACE}],offers:[offer('prepare-document','presentations','prepare-brief','research-brief','office','/api/presentations/sections/ui'),offer('prepare-episode','video','prepare-brief','research-brief','video-studio','/api/video/app'),offer('prepare-post','switchboard','prepare-post','communication-brief','switchboard-compose','/api/switchboard/compose')]}]}]};}
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

test('Resize hands 9:16 to Video Studio, Schedule or post hands the brief to Switchboard Compose, a scene opens on AI Office\'s canvas',async t=>{
 const{page,frame,requests,errors}=await fixture(t);
 await frame.locator('#title').fill('Launch');await frame.locator('#notes').fill('An intro for the launch');
 await frame.getByRole('button',{name:'More',exact:true}).click();await frame.getByRole('menuitem',{name:'Resize for other formats',exact:true}).click();
 const sheet=frame.locator('dialog.brand-resize');await sheet.waitFor();assert.equal(await sheet.getByRole('button').filter({hasText:/^(16:9 wide|9:16 vertical|1:1 square)/}).count(),3);
 await sheet.getByRole('button').filter({hasText:'9:16 vertical'}).click();await page.waitForFunction(()=>window.navigations.length===1);
 let handoff=await page.evaluate(()=>window.handoffs.at(-1));assert.equal(handoff.offer,'prepare-episode');assert.match(handoff.context.notes,/^Format: 9:16 vertical \(Shorts, Reels and TikTok\)\n\nAn intro for the launch$/);
 await frame.locator('#status').filter({hasText:'Choose 9:16 under Aspect there'}).waitFor();
 await frame.getByRole('button',{name:'More',exact:true}).click();await frame.getByRole('menuitem',{name:'Schedule or post',exact:true}).click();await page.waitForFunction(()=>window.navigations.length===2);
 handoff=await page.evaluate(()=>window.handoffs.at(-1));assert.equal(handoff.offer,'prepare-post');assert.deepEqual(handoff.context,{title:'Launch',notes:'An intro for the launch',sourceUrl:''});
 assert.equal((await page.evaluate(()=>window.navigations.at(-1))).options.name,'switchboard-compose');
 await frame.getByRole('button',{name:'Add scene',exact:true}).click();await frame.locator('[data-editor-property="sceneText"]').fill('The logo resolves out of light');await frame.locator('[data-editor-property="sceneText"]').press('Tab');
 await frame.getByRole('button',{name:'Scene 1 actions',exact:true}).click();await frame.getByRole('menuitem',{name:'Edit on canvas',exact:true}).click();await page.waitForFunction(()=>window.navigations.length===3);
 handoff=await page.evaluate(()=>window.handoffs.at(-1));assert.equal(handoff.offer,'prepare-document');assert.equal(handoff.context.title,'Scene 1');assert.match(handoff.context.notes,/^The logo resolves out of light\nDuration: 5 seconds\.\nFrom the brand brief "Launch"\.$/);
 assert.equal(requests.some(item=>item.method==='POST'),false,'hand-offs render and save nothing');assert.deepEqual(errors,[]);
});
