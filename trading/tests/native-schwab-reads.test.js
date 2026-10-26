/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Native landing amounts retain their open-position P&L scope and never imply reconstruction of closed trades or cash flows.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve measured and unknown broker balance facts across the named read and landing summary without adding owner or financial inputs.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the shipped native Schwab summary and holdings view use actual owned balances, retain failed-read dispositions and offer no unsupported live book writes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The kernel's measured account day change (Schwab per-position day P&L) reaches the landing row; an unmeasured one stays null, never zero.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function helpers() {
  const original = Module._load;
  Module._load = function(name,...args) { return name === '@/features/trading' ? {nativeSchwabReads:true} : original.call(this,name,...args); };
  try { delete require.cache[require.resolve('../routes/trading-native-reads')];return require('../routes/trading-native-reads'); }
  finally { Module._load = original; }
}

test('native account summaries retain real money, missing daily changes and failed reads',async () => {
  const native = helpers(); const rows = []; const rollup = new Map();
  const input = {accounts:[{accountId:'alice-account',accountMasked:'…1234',equity:12500,cash:2500,positions:[{symbol:'NVDA',qty:20,marketValue:10000}]}],errors:[{message:'Connection needs reauthentication.'}],readAt:'2026-10-14T15:00:00Z'};
  assert.equal(native.nativeSchwabReads(),true);
  assert.equal(native.appendNativeSummary(input,rows,rollup),12500);
  assert.equal(rows[0].dayChange,null);
  assert.equal(rows[0].nativeReadOnly,true);
  assert.equal(rows[1].nativeReadOnly,true);
  assert.equal(rows[1].error,'Connection needs reauthentication.');
  assert.equal(rollup.get('NVDA').marketValue,10000);
  const seen = [];
  const result = await native.readNativeAccounts({intent:async (name,input) => {seen.push({name,input});return {accounts:[],errors:[]};}});
  assert.deepEqual(result,{accounts:[],errors:[]});
  assert.deepEqual(seen,[{name:'trading.accounts',input:{}}]);
});

test('a measured Schwab day change reaches the landing row; an unmeasured one stays unknown',() => {
  const native = helpers(); const rows = [];
  const input = {accounts:[
    {accountId:'a',accountMasked:'…1111',equity:10100,cash:2000,dayChange:100,dayChangePct:1,positions:[{symbol:'NVDA',qty:10,marketValue:5000}]},
    {accountId:'b',accountMasked:'…2222',equity:5000,cash:5000,dayChange:0,dayChangePct:0,positions:[]},
    {accountId:'c',accountMasked:'…3333',equity:900,cash:0,dayChange:null,dayChangePct:null,positions:[{symbol:'MSFT',qty:2,marketValue:900}]}],errors:[]};
  native.appendNativeSummary(input,rows,new Map());
  assert.deepEqual(rows.map(r => [r.dayChange,r.dayChangePct]),[[100,1],[0,0],[null,null]]);
});

test('the actual account view offers holdings, preserves escaping and never fabricates a failed empty portfolio',() => {
  const src = fs.readFileSync(path.join(__dirname,'../tools/ui/view-accounts.js'),'utf8');
  const nodes = {main:{innerHTML:''},nativeAccountBack:{}};
  const context = vm.createContext({Date,console,BOOKS:[],ACCOUNTS:[],money:n => '$'+n,esc:s => String(s).replace(/[<>&"]/g,c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])),
    $:id => nodes[id],navigate() {},spinner:() => '',dollarPctCell:() => '',bookLabel:String});
  vm.runInContext(src+'\nthis.view={tileHtml,nativeAccountView};',context);
  const model = {nativeReadOnly:true,notTrading:true,state:'ok',label:'Schwab …1234',kind:'live',equity:12500,cash:2500,accountType:'margin',positions:[{symbol:'<NVDA>',qty:20,marketValue:10000}]};
  const tile = context.view.tileHtml(model,0);
  assert.match(tile,/VIEW-ONLY/);assert.match(tile,/View holdings/);assert.match(tile,/Open-position day P&amp;L/);assert.doesNotMatch(tile,/Create book|Start trading/);
  context.view.nativeAccountView(model);
  assert.match(nodes.main.innerHTML,/&lt;NVDA&gt;/);assert.match(nodes.main.innerHTML,/20/);assert.match(nodes.main.innerHTML,/10000/);
  assert.doesNotMatch(nodes.main.innerHTML,/Create book|Buy a stock/);
  context.view.nativeAccountView({...model,state:'error',note:'Schwab read failed.'});
  assert.match(nodes.main.innerHTML,/Schwab read failed/);assert.doesNotMatch(nodes.main.innerHTML,/no open positions|12500/);
});
test('native capital hero identifies open-position P&L and does not imply a full account day return',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../tools/ui/view-accounts.js'),'utf8');
 const nodes={heroTotal:{},heroDay:{},heroSub:{},heroMissing:{}};
 const context=vm.createContext({Date,console,BOOKS:[],ACCOUNTS:[],money:n=>'$'+n,esc:String,$:id=>nodes[id],dollarPctCell:()=>'$0'});
 vm.runInContext(src+'\nthis.paint=paintHero;',context);
 context.paint({capital:{real:{equity:1000,dayChange:0,dayChangeBasis:'open-positions'},paper:{equity:null}}},null,[]);
 assert.match(nodes.heroDay.innerHTML,/open-position day P&amp;L/);assert.match(nodes.heroSub.textContent,/Closed-trade results/);
});

test('the named account read and summary retain the additive measured broker facts exactly',async()=>{
 const native=helpers(),calls=[],facts={buyingPower:0,cashAvailableForTrading:900,cashAvailableForWithdrawal:700,unsettledCash:300,debitBalance:0,marginBalance:null,maintenanceRequirement:1200,longMarketValue:9000,shortMarketValue:null};
 const response={accounts:[{accountId:'owned-fixture',connectionKey:'fixture-login',broker:'schwab',kind:'live',equity:10000,cash:1000,buyingPower:20000,balanceFacts:facts,positions:[]}],errors:[],readAt:'2026-10-25T06:00:00Z'};
 const got=await native.readNativeAccounts({intent:async(name,input)=>{calls.push({name,input});return response;}}),rows=[];
 native.appendNativeSummary(got,rows,new Map());assert.deepEqual(rows[0].balanceFacts,facts);assert.equal(rows[0].buyingPower,20000,'compatibility field remains distinct');assert.deepEqual(calls,[{name:'trading.accounts',input:{}}]);
});
