/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the shipped native Schwab summary and holdings view use actual owned balances, retain failed-read dispositions and offer no unsupported live book writes.
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

test('the actual account view offers holdings, preserves escaping and never fabricates a failed empty portfolio',() => {
  const src = fs.readFileSync(path.join(__dirname,'../tools/ui/view-accounts.js'),'utf8');
  const nodes = {main:{innerHTML:''},nativeAccountBack:{}};
  const context = vm.createContext({Date,console,BOOKS:[],ACCOUNTS:[],money:n => '$'+n,esc:s => String(s).replace(/[<>&"]/g,c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])),
    $:id => nodes[id],navigate() {},spinner:() => '',dollarPctCell:() => '',bookLabel:String});
  vm.runInContext(src+'\nthis.view={tileHtml,nativeAccountView};',context);
  const model = {nativeReadOnly:true,notTrading:true,state:'ok',label:'Schwab …1234',kind:'live',equity:12500,cash:2500,accountType:'margin',positions:[{symbol:'<NVDA>',qty:20,marketValue:10000}]};
  const tile = context.view.tileHtml(model,0);
  assert.match(tile,/VIEW-ONLY/);assert.match(tile,/View holdings/);assert.doesNotMatch(tile,/Create book|Start trading/);
  context.view.nativeAccountView(model);
  assert.match(nodes.main.innerHTML,/&lt;NVDA&gt;/);assert.match(nodes.main.innerHTML,/20/);assert.match(nodes.main.innerHTML,/10000/);
  assert.doesNotMatch(nodes.main.innerHTML,/Create book|Buy a stock/);
  context.view.nativeAccountView({...model,state:'error',note:'Schwab read failed.'});
  assert.match(nodes.main.innerHTML,/Schwab read failed/);assert.doesNotMatch(nodes.main.innerHTML,/no open positions|12500/);
});
