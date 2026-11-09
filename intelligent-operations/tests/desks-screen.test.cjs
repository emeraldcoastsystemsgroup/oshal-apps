/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | The four desk tabs in a real browser over the shipped assets, at 390x844 and 412x915 (spec lanes/monitoring-four-desks-spec-2026-11-08.md section 8): the tabs follow Overview, each tab shows its five panels, an empty desk says what will fill each panel and names the probe, the Settings panel shows the topic with the way to Notifications, the source and the host threshold file path with the snapshot a heartbeat carried or that none has, nothing overflows the phone, the four topics are seeded once through POST /api/notify/prefs with channel none, every control is reached by keyboard, a rule toggle saves through the desk's own policy route with the binding's revision, and a refused desk clears and names the role. The server answers are fixtures in the shape routes/desks.js serves; the server side is desks.test.cjs. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http'),fs=require('node:fs');
const {dependency,root}=require('./fixtures/intake.cjs'),{DESKS}=require('../routes/desks');
const catalog=()=>({desks:DESKS.map(d=>({id:d.id,label:d.label,owns:d.owns,topic:d.topic,permission:d.permission,writePermission:d.write,role:d.role,sourceName:d.sourceName,critical:d.critical,warning:d.warning,thresholdFile:d.thresholdFile,probe:d.probe})),executionAuthorized:false});
/** One desk as GET /desks/<id> answers it: before activation, activated and quiet, or busy. */
function summary(desk,shape='empty'){
 const base={desk:desk.id,label:desk.label,owns:desk.owns,topic:desk.topic,permission:desk.permission,writePermission:desk.write,role:desk.role,asOf:new Date().toISOString(),defaults:{critical:desk.critical,warning:desk.warning},executionAuthorized:false,open:desk.label,
  settings:{topic:desk.topic,notificationsPage:'/cockpit/tools/notify.html',sourceName:desk.sourceName,sourceUri:desk.uri,sourceId:null,mapping:null,ingestRoute:null,producerTokens:'/api/v1/producer-tokens',thresholdFile:desk.thresholdFile,thresholds:null,lastHeardAt:null,probe:desk.probe}};
 if(shape==='empty')return {...base,activated:false,installations:[],symptoms:[],rules:null,runbooks:[],summary:desk.label+' has no source yet.'};
 const sourceId='a'.repeat(64),rules={policyId:'b'.repeat(64),name:desk.sourceName+' checks',window:{mode:'sliding',seconds:900},revision:3,publishedAt:new Date().toISOString(),rules:[...desk.critical.map(n=>({id:n,name:n,enabled:true,capture:true,alertType:n})),...desk.warning.map(n=>({id:n,name:n,enabled:n!=='LocationStepUp',capture:false,alertType:n}))]};
 const settings={...base.settings,sourceId,mapping:{resourceKind:'host',idLabel:'instance',scope:desk.sourceName},ingestRoute:'/api/intelligent-operations/ingest/alertmanager/'+sourceId};
 if(shape==='quiet')return {...base,activated:true,installations:[],symptoms:[],rules,runbooks:[],settings,summary:desk.label+': no critical alert firing; no source has reported yet; 11 of 11 rules on.'};
 const now=Date.now(),view={sourceId,name:desk.sourceName,environment:desk.sourceName,state:'reporting',lastHeardAt:new Date(now-32000).toISOString(),ageSeconds:32,lateAfterSeconds:180,silentAfterSeconds:600,firstHeardAt:new Date(now-86400000).toISOString(),reports:1440,silentSince:null,heartbeatEndedAt:null,host:'spark',url:'https://oshal.example.test',health:'healthy',uptimeSeconds:86400,feedError:null,
  thresholds:{reportedAt:new Date(now-32000).toISOString(),file:'/home/you/.local/state/oshal-native/monitoring/'+desk.id+'.json',body:{desk:desk.id,version:1,thresholds:{signin_failures_10m_max:10,refusals_10m_max:50}}},
  checks:[{id:'site',label:'Public site',state:'ok',reading:'Answers in 0.20 s'},{id:'disk',label:'Disk',state:'warn',reading:'84% used'},{id:'backup',label:'Nightly backup',state:'unknown',reading:'Not reported'}],firing:[],history:{days:1,bucketMinutes:15,since:now-86400000,now,series:{}}};
 const symptoms=[{id:'s1',environment:desk.sourceName,resourceKind:'host',resourceId:'spark',alertType:desk.critical[0],service:null,status:'firing',severity:'critical',maxSeverity:'critical',count:3,episodeCount:1,firstSeen:new Date(now-1200000).toISOString(),lastSeen:new Date(now-60000).toISOString(),eventTime:new Date(now-1200000).toISOString(),admittedAt:new Date(now-1200000).toISOString(),expiresAt:new Date(now+600000).toISOString(),evidence:{workId:'w1',state:'captured',capture:true},investigation:{ticketId:'11111111-2222-4333-8444-555555555555',state:'queued',href:'/cockpit/?app=intelligent-operations&ticket=11111111-2222-4333-8444-555555555555'}},
  {id:'s2',environment:desk.sourceName,resourceKind:'host',resourceId:'spark',alertType:desk.warning[0],service:null,status:'firing',severity:'warning',maxSeverity:'warning',count:1,episodeCount:1,firstSeen:new Date(now-300000).toISOString(),lastSeen:new Date(now-300000).toISOString(),eventTime:null,admittedAt:new Date(now-300000).toISOString(),expiresAt:null,evidence:null,investigation:null}];
 return {...base,activated:true,installations:[view],symptoms,rules,runbooks:[{alertType:desk.critical[0],markdown:'# First line of the runbook\nmore',revision:2,updatedAt:new Date(now-3600000).toISOString(),sha256:'x'}],settings:{...settings,thresholds:view.thresholds,lastHeardAt:view.lastHeardAt},summary:desk.label+': 1 critical firing ('+desk.critical[0]+'), 1 warning; its source is reporting, heard 32 seconds ago; 10 of 11 rules on.'};
}
/** The page over loopback: shipped assets, kernel routes as fixtures, the desk routes answering by shape. */
async function page(run,{shapes={},viewport={width:390,height:844},prefs=[],refuse={},tokens=[]}={}){
 const {chromium}=dependency('playwright'),requests=[],saved=[],state={prefs:[...prefs]};
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),json=(b,s=200)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
  let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{requests.push([req.method,url.pathname,raw]);
   if(url.pathname==='/api/auth/user')return json({authenticated:true,subject:'sub-1',displayName:'Test Person'});if(url.pathname==='/api/tickets')return json({tickets:[]});if(url.pathname==='/api/v1/agent/schedules')return json({schedules:[]});if(url.pathname==='/api/v1/peer-inbox')return json({delegations:[]});
   if(url.pathname==='/api/notify/prefs'){if(req.method==='POST'){const body=JSON.parse(raw);state.prefs.push({topic:body.topic,channel:body.channel,enabled:body.channel!=='none'&&body.enabled});return json({ok:true,prefs:state.prefs});}return json({channels:['telegram'],defaultChannel:'none',prefs:state.prefs,emailSetup:{transportRegistered:false}});}
   if(url.pathname==='/api/v1/producer-tokens')return json({producerTokens:tokens,limit:32});
   const prefix='/api/intelligent-operations',route=url.pathname.slice(prefix.length);
   if(url.pathname.startsWith(prefix)&&!route.startsWith('/assets/')&&route!=='/app'){
    if(route==='/desks')return json(catalog());
    const m=/^\/desks\/([a-z-]+)(\/policy)?$/.exec(route);
    if(m){const desk=DESKS.find(d=>d.id===m[1]);if(!desk)return json({error:'no such desk'},404);if(refuse[desk.id])return json({error:'Your current OSHAL role does not permit this operation.'},refuse[desk.id]);
     if(m[2]){const body=JSON.parse(raw);saved.push({desk:desk.id,body});return json({policy:{id:'c'.repeat(64),name:desk.sourceName+' checks',rules:body.rules||[]},binding:{sourceId:'a'.repeat(64),policyId:'c'.repeat(64),revision:(body.expectedRevision||0)+1}});}
     return json(summary(desk,shapes[desk.id]||'empty'));}
    if(route==='/records')return json({sources:[],events:[],inventory:[],processing:[],attempts:[]});if(route==='/pipeline')return json({policies:[],bindings:[],decisions:[],symptoms:[],evidenceWork:[],correlations:[]});if(route==='/investigations')return json({items:[]});if(route==='/topology')return json({asOf:new Date().toISOString(),assets:[],relationships:[],collections:[]});if(route==='/topology/discovery')return json({enabled:false});
    if(route==='/telemetry')return json({streams:[],limits:{},installations:[],watch:{lastTickAt:null,ageSeconds:null,overdue:true,graceUntil:null}});if(route==='/pipeline/processing')return json({config:{enabled:false,sourceIds:[],batchSize:10,maxAttempts:8,retrySeconds:30,revision:0},jobs:[],limit:200,leaseSeconds:120});if(route==='/executions')return json({items:[]});if(route==='/delegations')return json({items:[]});if(route==='/anomaly')return json({baselines:[],cursors:[],config:{}});return json({error:'Fixture does not implement this action'},404);
   }
   let file;if(route==='/app')file=path.join(root,'experience/index.html');else if(route.startsWith('/assets/')){const name=path.basename(route);file=path.join(root,['operations.css','replay-scenarios.js','response-artifacts.js','anomaly-detector.js'].includes(name)?'ui':'experience',name);}
   if(url.pathname.startsWith('/shared/ui/')){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'});return res.end('');}
   if(file&&fs.existsSync(file)){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(fs.readFileSync(file));}
   res.writeHead(404);res.end();});
 });
 let browser;
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport}),tab=await context.newPage();tab.setDefaultTimeout(10000);const errors=[];tab.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app';
  await run({page:tab,base,requests,saved,state,errors});assert.deepEqual(errors,[],'no page error');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
const PANELS=['Firing now','Sources','Rules','Runbooks','Settings'];
/** Wait, at most ten seconds, for what the fixture server should have seen. */
async function until(check,what){const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)throw Error('timed out waiting for '+what);await new Promise(r=>setTimeout(r,50));}}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);

test('the four tabs follow Overview and an empty desk says what will fill each of its five panels, on a 390x844 phone, without overflow',async()=>page(async({page,base,requests,state})=>{
 await page.goto(base+'#platform-ops');
 const links=await page.locator('nav a').evaluateAll(as=>as.map(a=>a.textContent));
 assert.deepEqual(links.slice(0,5),['Overview','App Ops','Sec Ops','Platform Ops','Dev Ops']);
 await page.locator('#platform-ops-settings-body dl').waitFor();
 assert.equal(await page.locator('nav a[aria-current=page]').textContent(),'Platform Ops');assert.equal(await page.locator('#heading').textContent(),'Platform Ops');
 assert.deepEqual(await page.locator('#platform-ops .desk-panel h2').evaluateAll(hs=>hs.map(h=>h.textContent)),PANELS);
 const text=await page.locator('#platform-ops').textContent();
 assert.match(text,/Nothing is firing on Platform Ops\. Alerts appear here as the Platform Ops stack \(Prometheus and Alertmanager on the host\) posts a heartbeat every minute/);
 assert.match(text,/No source has reported yet; the Platform Ops stack \(Prometheus and Alertmanager on the host\) posts a heartbeat every minute and its alerts as they fire once it runs\./);
 assert.match(text,/Source spark\/platform-ops is created by the processing schedule on its next run\./);
 assert.match(text,/The default policy below is published when the processing schedule activates this desk\./);
 assert.equal(await page.locator('#platform-ops-rules-body .desk-rule').count(),21,'the 21 default rules, read-only before activation');
 assert.match(text,/No runbook for Platform Ops's alert types yet\./);assert.match(text,/Owns host, containers, databases, tunnels and slots\./);
 assert.match(text,/platform-attention → not registered yet|platform-attention → no channel yet/);
 const link=page.locator('#platform-ops-settings-body a',{hasText:'Choose the channel on Notifications'});assert.equal(await link.getAttribute('href'),'/cockpit/tools/notify.html');assert.equal(await link.getAttribute('target'),'_top');
 assert.match(text,/~\/\.local\/state\/oshal-native\/monitoring\/platform-ops\.json/);assert.match(text,/No probe has reported this file yet\. Operations cannot read a host file/);
 assert.match(text,/no producer token issued for this route yet|available once the source exists/);
 assert.ok((await overflow(page))<=0,'no horizontal overflow at 390px');
 // The four topics were seeded once, with channel none, through the kernel's own route.
 await until(()=>requests.filter(([m,p])=>m==='POST'&&p==='/api/notify/prefs').length>=4,'the four topic posts');
 const posted=requests.filter(([m,p])=>m==='POST'&&p==='/api/notify/prefs').map(([,,raw])=>JSON.parse(raw));
 assert.deepEqual(posted.map(p=>p.topic),['app-attention','security-attention','platform-attention','release-attention']);assert.ok(posted.every(p=>p.channel==='none'&&p.enabled===true));
 assert.equal(state.prefs.length,4);
 for(const [hash,label]of [['#app-ops','App Ops'],['#sec-ops','Sec Ops'],['#dev-ops','Dev Ops']]){await page.goto(base+hash);await page.locator(hash+'-settings-body dl').waitFor();assert.equal(await page.locator('#heading').textContent(),label);assert.deepEqual(await page.locator(hash+' .desk-panel h2').evaluateAll(hs=>hs.map(h=>h.textContent)),PANELS);assert.ok((await overflow(page))<=0,label+' fits');}
 assert.equal(requests.filter(([m,p])=>m==='POST'&&p==='/api/notify/prefs').length,4,'no second seeding');
}));

test('a busy desk at 412x915 shows its symptoms with the investigation link, its source with the threshold snapshot, its own runbook and saves a rule toggle through its policy route',async()=>page(async({page,base,saved,requests})=>{
 await page.goto(base+'#sec-ops');await page.locator('#sec-ops-settings-body dl').waitFor();
 const firing=page.locator('#sec-ops-firing-body .desk-row');assert.equal(await firing.count(),2);
 assert.match(await firing.nth(0).textContent(),/critical.*SignInFailureBurst.*on spark.*Firing since.*3 occurrences/s);
 const open=firing.nth(0).locator('a',{hasText:'Open investigation'});assert.equal(await open.getAttribute('href'),'/cockpit/?app=intelligent-operations&ticket=11111111-2222-4333-8444-555555555555');assert.equal(await open.getAttribute('target'),'_top');
 assert.match(await firing.nth(1).textContent(),/warning.*KernelRefusalStorm.*Recorded, not captured/s);
 const source=page.locator('#sec-ops-sources-body .desk-source');assert.equal(await source.count(),1);
 assert.match(await source.locator('summary').textContent(),/spark\/sec-ops.*Reporting.*heard 32 s ago.*1440 reports/s);
 await source.locator('summary').click();assert.match(await source.textContent(),/Public site: Answers in 0\.20 s.*Disk: 84% used/s);
 const settings=await page.locator('#sec-ops-settings-body').textContent();
 assert.match(settings,/security-attention → telegram/);assert.match(settings,/Source.*spark\/sec-ops · id aaaaaaaaaaaa…/);assert.match(settings,/POST \/api\/intelligent-operations\/ingest\/alertmanager\/aaaa/);
 assert.match(settings,/2 producer tokens issued \(spark sec-ops alertmanager, expires/);
 assert.match(settings,/Snapshot the probe reported .* from \/home\/roger\/\.local\/state\/oshal-native\/monitoring\/sec-ops\.json/);
 assert.match(await page.locator('#sec-ops-settings-body pre').textContent(),/"signin_failures_10m_max": 10/);
 assert.match(await page.locator('#sec-ops-runbooks-body').textContent(),/SignInFailureBurst.*First line of the runbook.*revision 2/s);
 assert.equal(await page.locator('#sec-ops-rules-body .desk-rule').count(),11);
 const save=page.getByRole('button',{name:'Save rules'});assert.equal(await save.isDisabled(),true,'nothing to save yet');
 const capture=page.locator('#sec-ops-rules-body input[aria-label="Capture for KernelRefusalStorm"]');assert.equal(await capture.isChecked(),false);
 await capture.focus();await page.keyboard.press('Space');assert.equal(await capture.isChecked(),true,'a toggle is reached and flipped by keyboard');assert.equal(await save.isDisabled(),false);
 // Keyboard order: the add field, Add rule, Save rules, Restore defaults.
 await page.locator('#sec-ops-rule-add').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Add rule');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Save rules');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Restore defaults');
 await save.click();await page.locator('#sec-ops-status',{hasText:'Rules saved (revision 4).'}).waitFor();
 assert.equal(saved.length,1);assert.equal(saved[0].desk,'sec-ops');assert.equal(saved[0].body.expectedRevision,3);assert.equal(saved[0].body.rules.length,11);
 assert.deepEqual(saved[0].body.rules.find(r=>r.name==='KernelRefusalStorm'),{name:'KernelRefusalStorm',enabled:true,capture:true});assert.deepEqual(saved[0].body.rules.find(r=>r.name==='LocationStepUp'),{name:'LocationStepUp',enabled:false,capture:false});
 assert.ok(requests.some(([m,p])=>m==='POST'&&p==='/api/intelligent-operations/desks/sec-ops/policy'),'the save went to the desk\'s own route');
 assert.ok((await overflow(page))<=0,'no horizontal overflow at 412px');
},{shapes:{'sec-ops':'busy'},viewport:{width:412,height:915},prefs:[{topic:'security-attention',channel:'telegram',enabled:true}],tokens:[{tokenId:'t1',label:'spark sec-ops alertmanager',app:'intelligent-operations',route:'/ingest/alertmanager/'+'a'.repeat(64),expiresAt:Date.now()+86400000},{tokenId:'t2',label:'spark sec-ops alertmanager',app:'intelligent-operations',route:'/ingest/alertmanager/'+'a'.repeat(64),expiresAt:null},{tokenId:'t3',label:'other',app:'intelligent-operations',route:'/ingest/alertmanager/'+'b'.repeat(64)}]}));

test('a desk the role does not include clears and names the role; the other desks still read; the desktop keeps the five panels',async()=>page(async({page,base})=>{
 await page.goto(base+'#app-ops');await page.locator('#app-ops-status',{hasText:'Your role does not include App Ops. Ask an administrator for the ops-app role.'}).waitFor();
 assert.equal(await page.locator('#app-ops-firing-body').evaluate(e=>e.childElementCount),0,'nothing of the refused desk stays on screen');
 await page.goto(base+'#dev-ops');await page.locator('#dev-ops-settings-body dl').waitFor();assert.match(await page.locator('#dev-ops').textContent(),/Nothing is firing on Dev Ops/);
 assert.deepEqual(await page.locator('#dev-ops .desk-panel h2').evaluateAll(hs=>hs.map(h=>h.textContent)),PANELS);
},{refuse:{'app-ops':403},viewport:{width:1440,height:1000}}));
