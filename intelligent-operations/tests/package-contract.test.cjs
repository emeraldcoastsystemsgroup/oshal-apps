/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Allow route-backed read tools for Jarvis; still no CLI executor tool. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the Swarm hand-off navigation entry. */
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Native-port contract: the package declares something runnable (the platform left only an inert declaration that opened nothing). Every workflow phase and the concierge name a bot this package declares or imports, every declared bot is inline with a persona file inside the package that answers in plain prose and teaches no shell, CLI script, workspace path or platform HTTP call, and no screen points at a platform-only route.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The only route a ported package may declare is the store's canonical service-authenticated readiness route, byte-identical to the reviewed brand-graphics module; any other route module (a platform TypeScript port) is still refused.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The README's account of SAP Incident says where its persona is (the archived core trunk, commit 41da137) and that it is not yet ported, and no current text claims its persona or corpus exists in no repository: that claim was false and was about to be shown on the SAP Incident card.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the RCA report called a 502 "simulated by sweep" because the ticket noted its record was made by a sweep. The served RCA persona says a note about the record is never a cause.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: the report called a test record's 502 "simulated" and the record "already deleted" (the ticket
 *   said "deleted afterwards"), and the concierge subtracted the waiting count from the open count. The served persona restates the
 *   event in the ticket's words, keeps a record note's tense, and quotes queue counts as given.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const store = path.resolve(root, '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(toolchain, 'package.json'))('js-yaml');
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
/** Platform screens and routes with no native route (they answered 404 on the native kernel). */
const PLATFORM_ONLY = ['/api/forge', '/api/security', '/intelligent-processing', '/system-health', '/alert-pipeline-admin',
  '/api/jarvis/ambient/person', '/task-explorer', '/queue-dashboard', '/mesh-dashboard', '/ops-dashboard', '/health-dashboard', '/rag-center'];
const own = (manifest.bots || []).map(bot => bot.name);
const imported = ['required', 'optional'].flatMap(tier => (manifest.dependencies?.[tier]?.bots || []));

test('the package declares something runnable: a concierge or a workflow, each bound to a declared or imported bot', () => {
  const phases = manifest.workflow?.phases || [];
  assert.ok(manifest.chatBot || phases.length, 'an inert declaration opens nothing');
  for (const phase of phases) {
    if (phase.action === 'complete') continue;
    assert.ok(own.includes(phase.bot) || imported.some(bot => bot.name === phase.bot), `phase ${phase.name} bot ${phase.bot}`);
  }
  if (manifest.chatBot) assert.ok(own.includes(manifest.chatBot) || imported.some(bot => bot.name === manifest.chatBot));
  for (const binding of imported) assert.ok(manifest.dependencies.required.apps.includes(binding.app), binding.app);
  const readiness = { module: 'routes/package-smoke.js', factory: 'createPackageSmokeRoutes',
    mountPath: `/api/${manifest.name}/_smoke`, auth: 'service', requiresContext: true, requiresAi: false };
  assert.deepEqual(manifest.routes, [{module:'routes/experience.js',factory:'createOperationsExperienceRoutes',mountPath:'/api/intelligent-operations',auth:'oidc',requiresAuth:true,requiresContext:true,requiresAi:false}, readiness], 'the experience is session-authenticated; readiness retains its reviewed boundary');
  assert.equal(manifest.experience.entry,'/api/intelligent-operations/app');
  const auth=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8'));
  assert.deepEqual(auth.roles.reader.grants,[{permission:'app.open',scope:'own'}]);
  for(const binding of auth.bindings.http.filter(b=>b.method==='POST'))assert.deepEqual(binding.allOf,['records.write']);
  for (const file of ['routes/package-smoke.js', 'src-routes/package-smoke.ts']) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), fs.readFileSync(path.join(store, 'brand-graphics', file), 'utf8'), file);
  }
  for(const tool of manifest.tools||[]){assert.equal(tool.executor?.executorType,'api',tool.name+': no CLI executor tool is declared');assert.equal(tool.requiresApproval,false,tool.name+' is a read');}
});

test('declared bots are inline, own a persona inside the package and answer in plain prose without platform tooling', () => {
  for (const bot of manifest.bots || []) {
    assert.equal(bot.container, undefined, bot.name);
    assert.equal(bot.requiresOwnNode, undefined, bot.name);
    assert.ok(!['rca-specialist', 'queue-bot', 'general-bot'].includes(bot.name), `${bot.name} is a kernel or platform name`);
    const file = path.resolve(root, bot.persona);
    assert.ok(file.startsWith(root + path.sep) && fs.existsSync(file), bot.persona);
    const persona = yaml.load(fs.readFileSync(file, 'utf8'));
    assert.equal(persona.agent_id, bot.agentId);
    assert.match(persona.perspective, /plain prose/i);
    assert.doesNotMatch(persona.perspective, /curl |\/app\/|workspace-shared|oshal-local-api|node scripts\/|CLINE_WORKSPACE/);
  }
});

test('no screen points at a platform-only route', () => {
  for (const tile of manifest.ui?.static || []) {
    assert.ok(!PLATFORM_ONLY.some(prefix => tile.iframeUrl.startsWith(prefix)), tile.iframeUrl);
  }
});

test('Operations owns its workspace and Test Lab catalog while preserving specialist and workflow identities', () => {
  assert.equal(manifest.version, '1.1.1');
  assert.equal(manifest.ribbon.defaultView, 'operations-estate');
  assert.deepEqual(manifest.ribbon.hideFrameworkItems, ['chat','calendar','addressbook','dashboard','logs','settings','operations']);
  assert.equal(manifest.ribbon.showPlatformTools, false);
  assert.deepEqual(manifest.ui.static.map(tile => tile.toolName), ['operations-workspace','operations-estate','operations-data','operations-sources','operations-topology','operations-streams','operations-replay','operations-connections','operations-credentials','operations-commands','operations-git','operations-provisioning','operations-swarms','operations-library','operations-files','operations-workflow']);
  assert.equal(manifest.ui.static.find(tile => tile.toolName === 'operations-files').iframeUrl, '/api/files');
  assert.equal(manifest.ui.static[0].iframeUrl, '/api/intelligent-operations/app#overview');
  assert.equal(manifest.ribbon.defaultView,'operations-estate');
  for(const page of ['systems','estate','data','streams','replay','sources','credentials','connections','commands','library'])assert.ok(manifest.ui.static.some(tile=>tile.iframeUrl.endsWith('#'+page)),page+' has a native navigation entry');
  assert.equal(manifest.ticketType, 'intelligent-operations');
  assert.deepEqual(manifest.bots.map(bot => bot.name), ['ops-rca-specialist', 'ops-incident-reviewer']);
  const page = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
  assert.match(page, /Source preview/);
  const code = fs.readFileSync(path.join(root, 'ui/operations.js'), 'utf8');
  assert.deepEqual([...code.matchAll(/fetch\('([^']+)'/g)].map(m => m[1]), ['/api/tickets']);
  assert.doesNotMatch(code, /localStorage|sessionStorage|innerHTML|document\.write/);
  const catalog = yaml.load(fs.readFileSync(path.join(root, manifest.testing.catalog), 'utf8'));
  assert.ok(manifest.uses.includes('test-catalog'));
  for (const entry of catalog.cases) for (const file of entry.runner.files || []) assert.ok(fs.existsSync(path.join(root, file)), file);
});

test('SAP Incident is described as not yet ported, with its persona in the archived core trunk, never as missing from every repository', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const sap = readme.slice(readme.indexOf('SAP Incident'));
  assert.match(sap, /not yet ported/i);
  assert.match(sap, /41da137/);
  assert.match(sap, /sap-runbooks/);
  const changeLog = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8').split('\n').filter(line => line.startsWith('#'));
  const latestSap = changeLog.filter(line => /SAP Incident/.test(line)).pop();
  for (const [where, text] of [['README', readme], ['latest CHANGE LOG entry naming SAP Incident', latestSap]]) {
    assert.doesNotMatch(text, /(exists?|are|is)\s+(in\s+)?no\s+repository|not\s+in\s+any\s+repository/i, where);
  }
});

test('the RCA specialist never reads a note about the ticket record as the incident\'s cause (sweep 12)', () => {
  const persona = yaml.load(fs.readFileSync(path.join(root, 'personas', 'ops-rca-specialist.yaml'), 'utf8'));
  assert.match(persona.perspective, /describes the record, not the incident/);
  assert.match(persona.perspective, /never say the\s+event was simulated, staged, caused by a test or caused by whoever filed it/);
});

test('the RCA specialist restates the event, keeps a record note\'s tense and quotes queue counts as given (sweep 13)', () => {
  const bot = manifest.bots.find((b) => b.name === 'ops-rca-specialist');
  const persona = yaml.load(fs.readFileSync(path.join(root, bot.persona), 'utf8')).perspective.replace(/\s+/g, ' ');
  assert.match(persona, /Problem statement: what broke, in the ticket's own words for the event/);
  assert.match(persona, /"deleted afterwards" means it will be deleted, not that it has been\. Never call the event simulated or test traffic because the record is a test record/);
  assert.match(persona, /never add or subtract them to make a new count: "open" already includes the tickets waiting on a person/);
});

// Exercise the exact shipped module with only the Express module resolved from the pinned test runtime.
function experienceModule(){
 const file=path.join(root,'routes/experience.js'),m={exports:{}};
 new Function('require','exports','module',fs.readFileSync(file,'utf8'))(id=>id==='express'?createRequire(path.join(toolchain,'package.json'))(id):require(id.startsWith('.')?path.resolve(path.dirname(file),id):id),m.exports,m);return m.exports;
}
test('persisted source revisions and inventory refuse ambiguous or invented identity and discard arbitrary payload fields',()=>{
 const {sourceDefinition,inventorySnapshot}=experienceModule();
 const input={name:'Local lab',source:'urn:operations:lab',environment:'operations-lab'};
 assert.equal(sourceDefinition(input).id,sourceDefinition(input).id);
 assert.notEqual(sourceDefinition(input).id,sourceDefinition({...input,environment:'another'}).id);
 assert.throws(()=>sourceDefinition({...input,source:'https://user:pass@example.com'}));
 assert.throws(()=>sourceDefinition({...input,mapping:{id:'/__proto__/id'}}));
 const capture={environment:'operations-lab',clusterUid:'real-cluster-uid',observedAt:new Date().toISOString(),complete:true,pods:[{uid:'pod-1',name:'api',namespace:'operations-demo',node:'node-1',ready:null,containers:[{name:'api',image:'image@sha256:abc',ready:null,restarts:0}],secret:'must not persist'}]};
 const result=inventorySnapshot(capture);assert.equal(result.pods[0].ready,null);assert.equal(result.pods[0].secret,undefined);
 assert.throws(()=>inventorySnapshot({...capture,pods:[...capture.pods,...capture.pods]}));
 assert.throws(()=>inventorySnapshot({...capture,observedAt:'2026-02-31T10:00:00Z'}));
 assert.throws(()=>inventorySnapshot({...capture,pods:[{...capture.pods[0],uid:''}]}));
});

test('the compiled experience initializes and serves saved records through its actual router',async()=>{
  const express=createRequire(path.join(toolchain,'package.json'))('express');
  const fixture=await require('./fixtures/intake.cjs').fixture();
  const {createOperationsExperienceRoutes}=experienceModule();const collections=new Map();
  const app=express();app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',createOperationsExperienceRoutes({appPackageDir:root,pool:fixture.caller('alice'),authorization:{registerResource(){}},store:{query:async name=>[...(collections.get(name)||new Map()).values()],put:async(name,id,body)=>{if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,body);}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  try{
    const page=await fetch(base+'/app');assert.equal(page.status,200);assert.match(await page.text(),/TriageNorth/);
    const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
    const source=await post('/sources',{name:'Local',source:'urn:operations:source:local-lab',environment:'local-lab'});assert.equal(source.status,201);
    const event=require('../ui/source-contract.js').example();const one=await post('/events',{sourceId:source.body.id,event});assert.equal(one.status,201);assert.equal(one.body.normalized.data.resource.id,event.data.resource.id);
    const retry=await post('/events',{sourceId:source.body.id,event});assert.equal(retry.status,200);assert.equal(retry.body.retry,true);
    event.data.environment='forged';assert.equal((await post('/events',{sourceId:source.body.id,event})).status,409);
    event.id='quarantined-event';
    delete event.data.resource.id;const rejected=await post('/events',{sourceId:source.body.id,event});assert.equal(rejected.body.decision,'quarantined');
    const records=await(await fetch(base+'/records')).json();assert.equal(records.events.length,2);assert.equal(records.sources.length,1);assert.equal(records.attempts.length,4);
  }finally{await new Promise(resolve=>server.close(resolve));await fixture.close();}
});


test('incident workspace exposes canonical ticket reads and report completion requires human acceptance',()=>{
 const page=fs.readFileSync(path.join(root,'experience/index.html'),'utf8');
 assert.match(page,/id="refresh-tickets"/);
 assert.doesNotMatch(page,/href="\/apps\/intelligent-operations\/ui/);
 const phases=manifest.workflow.phases;
 assert.deepEqual(phases.slice(0,3).map(p=>p.name),['investigate','review','revise']);
 assert.deepEqual(phases.at(-1),{name:'queue-deliver',action:'complete',approval:{approver:'admin'}});
 assert.ok(phases.every(p=>!p.capabilities?.length));
});

// A route may be admitted while its declared inline bot is still unbound. Jarvis uses this separate catalog entry.
test('every Operations bot has an explicit own-scope read binding for native Jarvis handoffs',()=>{
 const auth=yaml.load(fs.readFileSync(path.join(root,manifest.authorization.catalog),'utf8'));
 for(const bot of manifest.bots){
  const binding=auth.bindings.bots?.find(row=>row.id===bot.name||row.id===bot.agentId);
  assert.ok(binding,bot.name+' has no explicit permission binding');
  assert.deepEqual(binding.allOf,['app.open']);
 }
 assert.deepEqual(auth.resources.application.scopes,['own']);
 assert.equal(auth.permissions['app.open'].effect,'read');
 assert.deepEqual(auth.roles.reader.grants,[{permission:'app.open',scope:'own'}]);
});
