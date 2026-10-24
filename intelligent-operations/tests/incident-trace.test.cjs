/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify exact ticket and record joins, missing-link honesty, read-only browser trace rendering and stale-response clearing. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module');
const {trace}=require('../experience/incident-trace.js');
const runtime=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN||path.join(__dirname,'../../scripts/toolchain'),'package.json'));
const {chromium}=runtime('playwright');
const file=path.resolve(__dirname,'../experience/incident-trace.js');
const ticket={id:'11111111-1111-4111-8111-111111111111',title:'CPU pressure',status:'done',revision:5,position:{name:'revise'}};
const other='22222222-2222-4222-8222-222222222222';
const sha='a'.repeat(64),planId='b'.repeat(64),workId='c'.repeat(64),executionId='d'.repeat(64),linkId='e'.repeat(64);
const sample={
 investigations:{items:[{id:workId,ticketId:ticket.id,deliveryId:'alert-1',packetSha256:sha},{id:'other-work',ticketId:other,deliveryId:'alert-2'}],truncated:false},
 records:{events:[{id:'alert-1',decision:'validated',receivedAt:'2026-10-23T09:00:00Z',normalized:{data:{alertType:'CPU pressure',resource:{id:'pod-a'}}}},{id:'alert-2',normalized:{data:{alertType:'Other issue'}}}]},
 pipeline:{decisions:[{id:'decision-1',deliveryId:'alert-1',outcome:'matched',at:'2026-10-23T09:01:00Z',reduction:{outcome:'admitted',symptomKey:'symptom-a'}},{id:'decision-2',deliveryId:'alert-2',outcome:'matched',reduction:{outcome:'admitted'}}],correlations:[{id:'cohort-1',deliveryIds:['alert-1'],status:'degraded',method:'exact-asset-fallback',problems:[{reason:'asset-stale'}],groups:[{id:'group-a'}]},{id:'cohort-2',deliveryIds:['alert-2'],groups:[]}],evidenceWork:[{id:workId,captureProcessing:{packetSha256:sha,coverage:'retained-context'}}],limits:{perCollection:200}},
 responses:{items:[{id:planId,ticketId:ticket.id,workId,phase:'revise',target:{pod:'pod-a'},downloads:[{name:'remediate.sh',sha256:sha,path:'/executions/plans/'+planId+'/artifacts/remediate.sh'}],approval:{id:'approval-1',grantedAt:'2026-10-23T09:02:00Z'},invalidated:true,executions:[{id:executionId,state:'reported',action:{verifiedByServer:false,reportedAt:'2026-10-23T09:03:00Z',provenance:'operator-report'},recovery:{outcome:'healthy',signalVerifiedByServer:true,at:'2026-10-23T09:03:00Z'}}]},{id:'other-plan',ticketId:other,downloads:[]}],truncated:false},
 sync:{items:[{id:linkId,ticketId:ticket.id,provider:'jira',recordKey:'OPS-7'},{id:'other-link',ticketId:other,provider:'jira',recordKey:'OPS-8'}],attempts:[{id:'attempt-1',linkId,state:'operator-reported-readback-matched',verifiedByServer:false},{id:'attempt-2',linkId:'other-link',state:'operator-reported-readback-matched'}],truncated:false},
 external:{items:[{id:workId,status:'refused',provider:'splunk',index:'main',resourceId:'pod-a',earliest:'2026-10-23T08:50:00Z',latest:'2026-10-23T09:05:00Z',items:[],reason:'Your Splunk read grant was refused.'}],truncated:false}
};
test('trace joins immutable incident IDs and preserves action/provider provenance',()=>{
 const result=trace(ticket,sample),joined=result.steps.map(s=>s.title+' '+s.state+' '+s.detail).join('\n');
 assert.match(joined,/CPU pressure/);assert.match(joined,/symptom symptom-a/);assert.match(joined,/1 group.*degraded.*degraded graph coverage; exact asset fallback.*1 coverage problem/);assert.match(joined,/SHA-256 a{64}/);assert.match(joined,/healthy/);assert.match(joined,/Action approval Used; later ticket revision changed/);assert.match(joined,/command result operator reported/);assert.match(joined,/resolved signal server verified/);assert.match(joined,/OPS-7.*operator reported; provider state unverified/);
 assert.match(joined,/Optional external evidence refused/);assert.match(joined,/Your Splunk read grant was refused/);
 assert.doesNotMatch(joined,/Other issue|OPS-8|cohort-2|other-plan/);
 assert.deepEqual(result.steps.find(s=>s.kind==='artifact').files.map(f=>f.name),['remediate.sh']);
});
test('missing or paged records never become a fabricated alert, execution or recovery',()=>{
 const result=trace(ticket,{investigations:{items:[],truncated:true},responses:{items:[],truncated:true},sync:{items:[],truncated:false},pipeline:{decisions:[],limits:{perCollection:200}}});
 assert.match(result.steps.map(s=>s.state).join(' '),/No linked investigation.*No plan.*No link/);
 assert.equal(result.steps.some(s=>s.kind==='execution'),false);assert.equal(result.limits.investigations,true);assert.equal(result.limits.responses,true);
});
test('failed own-scope reads say unavailable instead of presenting empty history as fact',()=>{
 const result=trace(ticket,{unavailable:['investigations','responses','sync']});
 assert.deepEqual(result.steps.filter(s=>['source','artifact','external'].includes(s.kind)).map(s=>s.state),['Investigation read unavailable','Response read unavailable','External handoff read unavailable']);
 assert.equal(result.steps.some(s=>s.kind==='execution'),false);
});
test('browser trace renders downloads as links and clears private records',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:390,height:780}});
  await page.setContent('<section class="incident-trace"><p id="incident-trace-status"></p><div id="incident-trace"></div></section>');await page.addStyleTag({path:path.resolve(__dirname,'../experience/experience.css')});await page.addScriptTag({path:file});
  await page.evaluate(({ticket,sample})=>{window.requested=[];window.controls=window.OperationsIncidentTrace.mount({request:path=>{window.requested.push(path);return Promise.resolve({ticket,data:{...sample,exact:true,limits:{}}});},onRefused:()=>{}});window.ticket=ticket;window.sample=sample;}, {ticket,sample});
  await page.evaluate(()=>window.controls.select(window.ticket));
  assert.deepEqual(await page.evaluate(()=>window.requested),['/incidents/'+ticket.id+'/trace']);
  assert.match(await page.locator('#incident-trace').innerText(),/CPU pressure/);assert.match(await page.locator('#incident-trace').innerText(),/operator reported; provider state unverified/);
  assert.equal(await page.getByRole('link',{name:/Download remediate.sh/}).getAttribute('href'),'/api/intelligent-operations/executions/plans/'+planId+'/artifacts/remediate.sh');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{window.controls.clear();});assert.equal(await page.locator('#incident-trace').innerText(),'');
 }finally{await browser.close();}
});
