/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Prove optional Splunk enrichment is source-scoped, bounded, frozen per packet, caller-isolated and visibly unavailable without losing the packet. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,dependency}=require('./fixtures/intake.cjs');
const {externalConfig,saveExternalConfig,ensureExternalEvidence,externalRecords}=require('../routes/external-evidence');
const id='a'.repeat(64),packet={id,sha256:'b'.repeat(64),alertAt:new Date().toISOString(),resource:{id:'pod/api-42'}};
test('one selected source captures a bounded personal Splunk read and never repeats it after configuration changes',async()=>{
 const f=await fixture();try{
  const pool=f.caller('alice');const config=await saveExternalConfig(pool,'alice',{enabled:true,account:'primary',index:'main',sourceIds:['source-a'],expectedRevision:0},['source-a','source-b']);assert.equal(config.revision,1);
  let reads=0;
  const ctx={pool,intent:async(name,args)=>{reads++;assert.equal(name,'connector.read');assert.deepEqual({connector:args.connector,operation:args.operation,account:args.account,index:args.input.index,resourceId:args.input.resourceId},{connector:'splunk',operation:'splunk-bounded-export',account:'primary',index:'main',resourceId:'pod/api-42'});assert.ok(Date.parse(args.input.latest)-Date.parse(args.input.earliest)<=900000);return {operation:'splunk-bounded-export',pageComplete:true,data:{items:[{_time:packet.alertAt,host:'node-a',source:'/var/log/app',sourcetype:'app',_raw:'error token=abc123 Authorization: Bearer xyz'}]}};}};
  const first=await ensureExternalEvidence(ctx,'alice',packet,'source-a');assert.equal(first.status,'available');assert.equal(first.items.length,1);assert.match(first.items[0].message,/token=\[redacted\]/);assert.match(first.items[0].message,/Bearer \[redacted\]/);assert.equal(first.packetSha256,packet.sha256);assert.equal(first.queryVersion,'resource-window-v1');assert.equal(first.items[0].host,'node-a');
  await saveExternalConfig(pool,'alice',{enabled:false,account:'primary',index:'main',sourceIds:[],expectedRevision:1},['source-a','source-b']);
  assert.deepEqual(await ensureExternalEvidence(ctx,'alice',packet,'source-a'),first);assert.equal(reads,1);
  assert.equal((await externalRecords(f.caller('bob'),'bob')).items.length,0);
 }finally{await f.close();}
});
test('refused and unavailable optional reads are sealed as gaps, never retried as effects',async()=>{
 const f=await fixture();try{
  const pool=f.caller('alice');await saveExternalConfig(pool,'alice',{enabled:true,account:'primary',index:'main',sourceIds:['source-a'],expectedRevision:0},['source-a']);
  const refusal=await ensureExternalEvidence({pool,intent:async()=>{throw Error('refused: connector.read.splunk is not linked for this package');}},'alice',packet,'source-a');
  assert.equal(refusal.status,'refused');assert.deepEqual(refusal.items,[]);assert.match(refusal.reason,/refused/);
  const unconfigured=await ensureExternalEvidence({pool},'alice',{...packet,id:'c'.repeat(64)},'source-b');
  assert.equal(unconfigured.status,'not-configured');assert.deepEqual(unconfigured.items,[]);
  const unavailable=await ensureExternalEvidence({pool,intent:async()=>{throw Error('timeout');}},'alice',{...packet,id:'d'.repeat(64)},'source-a');
  assert.equal(unavailable.status,'unavailable');assert.deepEqual(unavailable.items,[]);
  assert.equal((await externalRecords(pool,'alice')).items.length,3);
 }finally{await f.close();}
});
test('configuration refuses foreign source revisions and unsafe provider search selectors',async()=>{
 const f=await fixture();try{
  const pool=f.caller('alice');const base={enabled:true,account:'primary',index:'main',sourceIds:['source-a'],expectedRevision:0};
  for(const bad of [{...base,index:'main | delete'},{...base,sourceIds:['foreign']},{...base,account:'other account'}])
   await assert.rejects(saveExternalConfig(pool,'alice',bad,['source-a']),{status:400});
  assert.equal((await externalConfig(pool,'alice')).enabled,false);
 }finally{await f.close();}
});
test('Connections screen maps one source to a personal Splunk account and shows a refused result',async()=>{
 const {chromium}=dependency('playwright'),browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:780}});
  await page.setContent('<article id="external-evidence-panel"><button id="external-refresh">Refresh enrichment</button><p id="external-status"></p><form id="external-form"><input id="external-enabled" type="checkbox"><input id="external-account"><input id="external-index"><div id="external-sources"></div><button type="submit">Save enrichment setting</button></form><div id="external-outcomes"></div></article>');
  await page.addScriptTag({path:require('node:path').resolve(__dirname,'../experience/external-evidence.js')});
  await page.evaluate(()=>{window.saved=[];window.conf={enabled:false,account:'primary',index:'main',sourceIds:[],revision:0};window.control=window.OperationsExternalEvidence.mount({sources:()=>[{id:'source-a',name:'Alertmanager',environment:'lab'}],request:async(path,body)=>{if(path==='/external-evidence/config'){if(body){window.saved.push(body);window.conf={...body,revision:1};}return window.conf;}if(path==='/external-evidence')return {items:[{status:'refused',resourceId:'pod/api',provider:'splunk',index:'main',items:[],reason:'Your Splunk connection was refused.'}]};throw Error(path);},onRefused:()=>{}});});
  await page.evaluate(()=>window.control.load());
  assert.match(await page.locator('#external-outcomes').innerText(),/refused.*pod\/api/);
  await page.locator('#external-enabled').check();await page.locator('#external-sources input').check();await page.getByRole('button',{name:'Save enrichment setting'}).click();
  await page.waitForFunction(()=>window.saved.length===1);
  assert.deepEqual(await page.evaluate(()=>window.saved[0]),{enabled:true,account:'primary',index:'main',sourceIds:['source-a'],expectedRevision:0});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await browser.close();}
});
