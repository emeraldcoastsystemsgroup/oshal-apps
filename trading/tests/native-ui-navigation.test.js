/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Drive delayed shipped Quant responses across reused tab bodies, navigation, errors and pending run/review actions. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tools/ui/view-quant.js'),'utf8');
function fixture(){
 const pending=[],messages=[],host={innerHTML:'',querySelector:()=>null};
 const context=vm.createContext({RENDER_TOKEN:1,SUB_GEN:1,URLSearchParams,Date,console,host,messages,
  $:id=>id==='tabbody'?host:null,spinner:()=>'',esc:String,jbody:(_m,body)=>body,
  api:(url)=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),
  paperScheduleRow:async()=>({status:'active'}),clearTimeout(){},setTimeout:f=>{queueMicrotask(f);return 1;}});
 vm.runInContext('function stale(t){return t!==RENDER_TOKEN;} function tabGen(){return SUB_GEN;} function tabStale(g){return g!==SUB_GEN;}',context);
 vm.runInContext(source,context);
 // Replace rendering only: the shipped loaders, async actions and navigation checks remain real.
 vm.runInContext('qdPaint=host=>{host.innerHTML="Quant result";};qdShowMessage=()=>messages.push(QD.message);',context);
 return {context,host,pending,messages,run:code=>vm.runInContext(code,context),finish:()=>pending.splice(0).forEach(p=>p.resolve({ready:true,session:'fixture'}))};
}
for(const move of ['subtab','render'])test('a delayed Quant answer cannot repaint a reused tab body after '+move+' navigation',async()=>{
 const h=fixture(),task=h.run('loadQuantDesk()');assert.ok(h.pending.length);
 h.context[move==='subtab'?'SUB_GEN':'RENDER_TOKEN']++;h.host.innerHTML='New destination';h.finish();await task;
 assert.equal(h.host.innerHTML,'New destination');assert.equal(h.run('QD.today'),null,'a discarded response must not replace current research state');
});
test('a delayed Quant error cannot replace the selected tab',async()=>{
 const h=fixture(),task=h.run('loadQuantDesk()');h.context.SUB_GEN++;h.host.innerHTML='New destination';
 h.pending.splice(0).forEach(p=>p.reject(Error('Old request failed')));await task;
 assert.equal(h.host.innerHTML,'New destination');assert.equal(h.messages.length,0);
});
test('a current Quant response still paints and retains its measured state',async()=>{
 const h=fixture(),task=h.run('loadQuantDesk()');h.finish();await task;
 assert.equal(h.host.innerHTML,'Quant result');assert.equal(h.run('QD.today.session'),'fixture');
});
test('leaving Quant while Run now awaits stops later passes and stale messages',async()=>{
 const h=fixture();h.context.api=async()=>{h.context.calls++;if(h.context.calls===1)return new Promise(resolve=>h.context.resolveRun=resolve);return {status:'done',progress:{session:'fixture'}};};h.context.calls=0;
 const task=h.run('qdRun(host,()=>!tabStale(1))');assert.equal(h.context.calls,1);h.context.SUB_GEN++;
 const before=h.messages.length;h.context.resolveRun({status:'working',progress:{phase:'scan',read:1,total:2}});await task;
 assert.equal(h.context.calls,1,'no new pass after the user leaves');assert.equal(h.messages.length,before,'no old progress message');assert.equal(h.run('QD.running'),false);
});
test('a delayed strategy review cannot paint or replace state after a sub-tab change',async()=>{
 const h=fixture(),opened=h.run('loadQuantDesk()');h.finish();await opened;
 const button={dataset:{qd:'strategy-review'},disabled:false},event={target:{closest:selector=>selector==='[data-qd]'?button:null}};
 const task=h.host.onclick(event);assert.equal(h.pending.length,1);h.context.SUB_GEN++;h.host.innerHTML='New destination';
 h.pending[0].resolve({reviewId:'old-review'});await task;
 assert.equal(h.host.innerHTML,'New destination');assert.equal(h.run('QD.strategyReview'),null);
});
test('returning to Quant releases the departed run without allowing its completion to stop a newer run',async()=>{
 const h=fixture(),first=h.run('qdRun(host,()=>!tabStale(1))'),old=h.pending.shift();
 h.context.SUB_GEN++;const opened=h.run('loadQuantDesk()');h.finish();await opened;
 assert.equal(h.run('QD.running'),false,'the returning desk must not keep an abandoned Running button');
 const next=h.run('qdRun(host,()=>!tabStale(2))'),fresh=h.pending.shift();
 old.resolve({status:'working',progress:{}});await first;
 assert.equal(h.run('QD.running'),true,'the old run cannot clear a new run owner');
 fresh.resolve({status:'needs-schwab',message:'Fixture done'});await next;
 assert.equal(h.run('QD.running'),false);
});

function detailsFixture(){
 const pending=[],notice={textContent:''},chart={innerHTML:''},host={isConnected:true,dataset:{},querySelector:s=>({'[data-details-status]':notice,'[data-details-compare]':{value:'SPY'},'[data-details-period]':{value:'1M'},'[data-details-stock]':chart})[s],querySelectorAll:()=>[]};
 const context=vm.createContext({RENDER_TOKEN:1,URLSearchParams,host,paints:0,model:{accountId:'fixture',connectionKey:'fixture'},main:{querySelector:()=>host},esc:String,
  api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),sameNativeAccount:()=>true});
 vm.runInContext('function stale(t){return t!==RENDER_TOKEN;}',context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/ui/native-account-details.js'),'utf8'),context);
 vm.runInContext('paintNativeAccountDetails=()=>{paints++;};',context);
 return {context,host,notice,chart,pending,run:code=>vm.runInContext(code,context)};
}
for(const change of ['render','detached','superseded'])test('native account details discard a '+change+' request and its late failure',async()=>{
 for(const failure of [false,true]){
  const h=detailsFixture(),task=h.run('loadNativeAccountDetails(model,1)');
  let latest;
  if(change==='render')h.context.RENDER_TOKEN++;
  else if(change==='detached')h.host.isConnected=false;
  else latest=h.run('loadNativeAccountDetails(model,1)');
  h.notice.textContent='Current account view';
  if(failure)h.pending[0].reject(Error('Old failure'));else h.pending[0].resolve({account:{positions:[]}});
  await task;assert.equal(h.context.paints,0);assert.equal(h.notice.textContent,'Current account view');
  if(latest){h.pending[1].resolve({account:{positions:[]}});await latest;assert.equal(h.context.paints,1);h.host.isConnected=false;h.pending[2].resolve({bars:[]});await new Promise(setImmediate);}
 }
});
test('the holding comparison retains its parent request fence after account details finish',async()=>{
 for(const change of ['render','detached','superseded','holding']){
  const h=detailsFixture(),task=h.run('loadNativeAccountDetails(model,1)');h.pending[0].resolve({account:{positions:[{symbol:'AAA'}]}});await task;
  assert.equal(h.pending.length,3,'the original page starts both real comparison reads');
  if(change==='render')h.context.RENDER_TOKEN++;
  else if(change==='detached')h.host.isConnected=false;
  else if(change==='superseded')h.host.dataset.request='2';
  else h.host.dataset.stock='NEW';
  h.chart.innerHTML='Current comparison';
  for(const request of h.pending.slice(1))request.resolve({bars:[{t:1700000000,c:100},{t:1700086400,c:101}]});
  await new Promise(setImmediate);assert.equal(h.chart.innerHTML,'Current comparison',change);
 }
});
