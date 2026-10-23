/* CHANGE LOG: overview schedule | maintainer@emeraldcoastsystemsgroup.com | Overview shows a suspended processing schedule with a Re-activate action and counts unfiled delegations. */
/* CHANGE LOG: overview actions | maintainer@emeraldcoastsystemsgroup.com | Needs attention counts operator actions from response plans, the detector and tickets; incident chips default to Needs you. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Pin the canonical backend symptom key in event inspection. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped operator screens, exact-source navigation, keyboard tabs and stale-access clearing in a real browser. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module'),runtime=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN||path.join(__dirname,'../../scripts/toolchain'),'package.json')),{chromium}=runtime('playwright');
const root=path.resolve(__dirname,'..'),at='2026-10-21T12:00:00Z';
const source=(id,name,environment)=>({id,name,environment,source:'urn:ops:'+id,mapping:{environment:'/data/environment',alertType:'/data/alertType',severity:'/data/severity',status:'/data/status',kind:'/data/resource/kind',scope:'/data/resource/scope',id:'/data/resource/id'}});
const a=source('source-a','Production Prometheus','production'),b=source('source-b','Lab <script>unsafe()</script>','lab');
const event=(id,s,decision='validated')=>({id,sourceId:s.id,decision,receivedAt:at,ingestion:'transactional',reasons:decision==='quarantined'?['Missing scoped identity']:[],normalized:decision==='validated'?{time:at,data:{alertType:'Pod unavailable',environment:s.environment,severity:'critical',status:'firing',resource:{kind:'kubernetes-pod',scope:'cluster-a',id:'pod-a'}}}:null,raw:{secretLookingText:'Fixture only, rendered as text'}});
const records={sources:[a,b],events:[event('event-a',a),event('event-b',b,'quarantined')],inventory:[],processing:[{delivery_id:'event-a',state:'evidence-attention',last_error:'Context unavailable'}]};
const asset=(id,kind,extra={})=>({id,kind,nativeId:id,name:id,provider:'kubernetes',scope:'cluster-a',observedAt:at,health:'unknown',properties:{namespace:'demo'},...extra});
const graph={asOf:at,assets:[asset('cluster-a','cluster'),asset('pod-a','pod',{health:'degraded',properties:{namespace:'demo',phase:'Pending',image:'registry/'+('long-image-'.repeat(30))}})],relationships:[],collections:[{complete:true}]};
const pipeline={policies:[],bindings:[],decisions:[{id:'d-a',deliveryId:'event-a',at,outcome:'matched',reduction:{outcome:'admitted',symptomKey:'symptom-a'}}],symptoms:[],evidenceWork:[],correlations:[]};
let schedules=[],activations=0;
async function fixture(run){
 let refused=false,held=null,holdTickets=false;const requests=[];
 const server=http.createServer((req,res)=>{requests.push([req.method,req.url]);const url=new URL(req.url,'http://localhost');const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/api/tickets'){if(holdTickets){held=res;return;}return json({tickets:[{id:'11111111-1111-4111-8111-111111111111',kind:'intelligent-operations',title:'Untitled',description:'Review pod availability',status:'awaiting_approval'},{id:'22222222-2222-4222-8222-222222222222',kind:'intelligent-operations',title:'Finished drill',status:'done'},{id:'33333333-3333-4333-8333-333333333333',kind:'intelligent-operations',title:'Broken drill',status:'failed'}]});}
  if(url.pathname==='/api/v1/agent/schedules')return json({schedules});
  if(url.pathname==='/api/v1/agent/schedules/s1/activate'&&req.method==='POST'){activations++;schedules=schedules.map(x=>({...x,status:'active',reason:null}));return json({status:'activated'});}
  if(url.pathname==='/api/v1/peer-inbox')return json({delegations:[{id:'i1'},{id:'i2'}],executionAuthorized:false});
  const prefix='/api/intelligent-operations',route=url.pathname.slice(prefix.length);
  if(url.pathname.startsWith(prefix)&&!route.startsWith('/assets/')&&route!=='/app'){
   if(refused)return json({error:'Scope withdrawn'},403);
   if(route==='/records')return json(records);if(route==='/pipeline')return json(pipeline);if(route==='/investigations')return json({items:[]});
   if(route==='/pipeline/processing')return json({config:{enabled:false,sourceIds:[],batchSize:10,maxAttempts:8,retrySeconds:30,revision:0},scheduleName:'fixture',jobs:[],limit:200,leaseSeconds:120});
   if(route==='/executions')return json({items:[{id:'p1',invalidated:false,approval:null,executions:[],promotions:[]},{id:'p2',invalidated:false,approval:{expired:false},executions:[{state:'completed',recovery:{outcome:'regressed'}}],promotions:[{overdue:true}]}]});
   if(route==='/delegations')return json({items:[{direction:'inbound',inboxId:'i1',state:'started'}]});
   if(route==='/anomaly')return json({baselines:[{firing:true},{firing:false}],cursors:[],config:{}});
   if(route==='/topology')return json(graph);return json({error:'Fixture does not implement this action'},404);
  }
  let file;if(route==='/app')file=path.join(root,'experience/index.html');else if(route.startsWith('/assets/')){const name=path.basename(route);file=path.join(root,name==='operations.css'?'ui':'experience',name);if(name==='replay-scenarios.js')file=path.join(root,'ui',name);}else if(url.pathname.startsWith('/shared/')){res.writeHead(200);return res.end('');}
  if(file&&fs.existsSync(file)){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(fs.readFileSync(file));}
  res.writeHead(404);res.end();
 });
 let browser;try{await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await run({page,base:'http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app',requests,errors,refuse:()=>{refused=true;},hold:()=>{holdTickets=true;},release:()=>{held?.writeHead(200,{'Content-Type':'application/json'});held?.end(JSON.stringify({tickets:[{id:'late',kind:'intelligent-operations',title:'Late private ticket',status:'running'}]}));}});assert.deepEqual(errors,[]);}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('operator journey separates monitoring, events, exact source mappings and configuration with responsive keyboard tabs',async()=>fixture(async({page,base,requests})=>{
 await page.goto(base+'#overview');await page.getByText('Needs attention',{exact:true}).waitFor();await page.getByText('Review pod availability',{exact:true}).waitFor();
 assert.match(await page.locator('#overview-attention').textContent(),/Quarantined events/);assert.match(await page.locator('#overview-attention').textContent(),/Processing needs review/);
 await page.locator('#overview-activity').getByRole('button',{name:/Production Prometheus/}).click();await page.getByRole('heading',{name:'Production Prometheus',exact:true}).waitFor();
 assert.match(await page.locator('#source-detail').textContent(),/\/data\/resource\/id/);assert.equal(await page.locator('#source-form').isVisible(),false);
 await page.getByLabel('Find a source',{exact:true}).fill('lab');assert.equal(await page.locator('#source-list>button').count(),1);assert.match(await page.locator('#source-detail').textContent(),/Lab <script>unsafe\(\)<\/script>/);assert.equal(await page.evaluate(()=>typeof window.unsafe),'undefined');
 await page.getByRole('button',{name:'Inspect source events',exact:true}).click();await page.getByRole('tab',{name:'Events',exact:true}).waitFor();await page.waitForFunction(()=>document.getElementById('event-source-filter').value==='source-b');
 assert.equal(await page.getByLabel('Decision',{exact:true}).count(),1);assert.equal(await page.getByLabel('Source revision',{exact:true}).count(),1);assert.equal(await page.locator('#pipeline-panel-events #evaluate-events').count(),1);assert.equal(await page.locator('#pipeline-panel-events #run-pipeline').count(),1);assert.equal(await page.locator('#event-list .event-row').count(),1);assert.match(await page.locator('#event-list').textContent(),/quarantined/);await page.locator('#event-list').getByRole('button',{name:'Inspect',exact:true}).click();assert.match(await page.locator('#event-detail').textContent(),/Missing scoped identity/);assert.equal(await page.locator('#event-detail pre').isVisible(),false);
 await page.getByRole('tab',{name:'Events',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Rules',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.locator('#policy-source').inputValue(),'source-b');
 await page.getByRole('tab',{name:'Automation',exact:true}).click();assert.equal(await page.locator('#processing-form').isVisible(),true);assert.equal(await page.locator('#policy-workbench').isVisible(),false);
 await page.getByRole('tab',{name:'Flow',exact:true}).click();await page.getByText('Incoming cohort',{exact:true}).waitFor();assert.equal(await page.locator('#processing-form').isVisible(),false);assert.match(await page.locator('#pipeline-flow').textContent(),/1 unique evaluated events/);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});for(const name of ['Flow','Events','Rules','Automation','Correlation']){await page.getByRole('tab',{name,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' at '+width);}}
 assert.equal(requests.some(([method])=>method!=='GET'),false);
}));
test('selected event deep link shows a readable decision trail and Systems remains a compact observed tree',async()=>fixture(async({page,base})=>{
 await page.goto(base+'?pane=events&event=event-a#data');await page.getByRole('heading',{name:'Pod unavailable',exact:true}).waitFor();await page.waitForFunction(()=>document.getElementById('pipeline-flow').textContent.includes('1 unique'));
 // Reinspect after asynchronous processing finishes to use the latest saved decisions.
 await page.locator('#event-list').getByRole('button',{name:'Inspect',exact:true}).first().click();assert.match(await page.locator('.operator-timeline').textContent(),/admitted/);assert.match(await page.locator('.operator-timeline').textContent(),/symptom symptom-a/);assert.match(await page.locator('.operator-timeline').textContent(),/evidence-attention/);
 await page.goto(base+'#systems');await page.getByRole('tree',{name:'Observed systems and resources'}).waitFor();
 assert.equal(await page.evaluate(()=>document.querySelector('.systems-intro').getBoundingClientRect().height<150),true);
 await page.setViewportSize({width:1040,height:720});
 assert.equal(await page.evaluate(()=>document.querySelector('.systems-filters').getBoundingClientRect().height<90),true,'embedded desktop filters fit one compact row');
 const search=page.getByLabel('Find a resource',{exact:true});await search.fill('pod-a');await page.getByRole('treeitem',{name:/kubernetes.*group/}).click();await page.getByRole('treeitem',{name:'demo group',exact:true}).click();await page.getByRole('treeitem',{name:'pod-a pod degraded',exact:true}).click();
 assert.match(await page.getByRole('region',{name:'Resource details'}).textContent(),/degraded at capture/);assert.match(await page.getByRole('region',{name:'Resource details'}).textContent(),/Pending/);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
}));
test('access withdrawal clears source, event and overview data and a late ticket response cannot restore it',async()=>fixture(async({page,base,refuse,hold,release})=>{
 await page.goto(base+'#overview');await page.getByText('Review pod availability',{exact:true}).waitFor();hold();await page.getByRole('button',{name:'Refresh incident work',exact:true}).click();refuse();await page.getByRole('button',{name:'Refresh records',exact:true}).click();await page.waitForFunction(()=>document.getElementById('sources-count').textContent==='Unavailable');release();
 await page.waitForTimeout(80);assert.equal(await page.getByText('Late private ticket',{exact:true}).count(),0);assert.equal(await page.getByText('Review pod availability',{exact:true}).count(),0);assert.equal(await page.locator('#source-list>button').count(),0);assert.equal(await page.locator('#event-list .event-row').count(),0);
}));
test('Needs attention lists what waits on the operator and incident work defaults to the tickets that need them',async()=>fixture(async({page,base})=>{
 await page.goto(base+'#overview');const actions=page.locator('#overview-actions');await actions.getByText('Anomaly baselines firing').waitFor();
 const text=await actions.innerText();for(const [label,count] of [['Response plans awaiting approval',1],['Executions without verified recovery',1],['Break-glass reconciliations overdue',1],['Anomaly baselines firing',1],['Reports awaiting your approval',1]])assert.match(text,new RegExp(count+'\\s+'+label));
 const tickets=page.locator('#overview-tickets');assert.equal(await tickets.getByRole('button',{name:/Needs you · 1/}).getAttribute('aria-pressed'),'true');assert.match(await tickets.innerText(),/Review pod availability/);assert.doesNotMatch(await tickets.innerText(),/Finished drill/);
 await tickets.getByRole('button',{name:/All · 3/}).click();assert.match(await tickets.innerText(),/Finished drill/);assert.match(await tickets.innerText(),/Broken drill/);
 await tickets.getByRole('button',{name:/Failed or cancelled · 1/}).click();assert.doesNotMatch(await tickets.innerText(),/Review pod availability/);
}));
test('Overview says when the processing schedule is suspended, re-activates it on the person\'s click and counts unfiled delegations',async()=>{schedules=[{id:'s1',app:'intelligent-operations',status:'paused',reason:'deny_tier'}];activations=0;try{await fixture(async({page,base})=>{
 await page.goto(base+'#overview');const actions=page.locator('#overview-actions');await actions.getByText('Processing schedule is paused (deny_tier)',{exact:false}).waitFor();
 assert.match(await actions.innerText(),/1\s+Delegations from other swarms not yet filed/);
 await actions.getByRole('button',{name:'Re-activate',exact:true}).click();await actions.getByText('Processing schedule suspended',{exact:true}).waitFor();assert.equal(activations,1);assert.equal(await actions.getByRole('button',{name:'Re-activate',exact:true}).count(),0);
});}finally{schedules=[];}});
