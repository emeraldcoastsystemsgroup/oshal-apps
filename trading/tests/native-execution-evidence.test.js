/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Supply real-domain identity in positive fixtures and refuse execution evidence when account or monitor strategy context is absent.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Withhold foreign-strategy rows and distinguish unavailable order arrays from readable empty evidence while retaining bounded working-order and partial-fill rows.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Account execution evidence names the masked account, exposes a month-cycle pause, distinguishes fills from submissions and refuses another account's retained receipt.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tools/ui/native-account-management.js'),'utf8');
const context=vm.createContext({console,esc:s=>String(s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])),money:n=>'$'+Number(n).toFixed(2)});
vm.runInContext(source+'\n;globalThis.render=nativeExecutionEvidence;',context);
const account={accountId:'a',connectionKey:'c',strategyId:'selected',label:'Trading …1234'};
function receipt(){return{accountId:'a',connectionKey:'c',strategyId:'selected',observedAt:'2026-11-04T18:00:00Z',automation:{status:'protective-exit-awaiting-next-cycle',message:'A protective exit occurred. No remaining allocation order is submitted.'},brokerOrders:[{orderId:'fixture-order',status:'FILLED',legs:[{symbol:'ABC',instruction:'SELL'}],executions:[{quantity:10,price:25.5,time:'2026-11-04T17:00:00Z'}]},{orderId:'unfilled-order',status:'WORKING',legs:[{symbol:'XYZ',instruction:'BUY'}],executions:[]}]};}
test('an active approval cannot hide an account-wide allocation pause or a confirmed broker execution',()=>{
 const html=context.render(account,{...account,authority:{active:true},lastReceipt:receipt()});
 assert.match(html,/Execution · Trading …1234/);assert.match(html,/Allocation paused after a protective sale/);
 assert.match(html,/No remaining allocation order/);assert.match(html,/SELL ABC/);assert.match(html,/fixture-order/);assert.match(html,/\$25\.50/);
 assert.doesNotMatch(html,/unfilled-order|BUY XYZ/);assert.match(html,/Broker orders last read/);assert.match(html,/Quant desk and research feed results do not change/);
});
test('another account or connection never supplies the selected account outcome or fills',()=>{
 for(const patch of [{accountId:'other'},{connectionKey:'other'}]){
  const html=context.render(account,{...account,lastReceipt:{...receipt(),...patch}});
  assert.match(html,/No matching account broker receipt/);assert.doesNotMatch(html,/fixture-order|SELL ABC|Allocation paused/);
 }
});
test('unknown reads differ from verified empty reads, and partial executions retain their measured quantities',()=>{
 assert.match(context.render(account,{...account}),/Broker executions are unavailable/);
 const r=receipt();r.brokerOrders=[];assert.match(context.render(account,{...account,lastReceipt:r}),/No confirmed executions were returned/);
 const partial=receipt();partial.brokerOrders[0].status='WORKING';partial.brokerOrders[0].executions[0].quantity=3;
 const html=context.render(account,{...account,lastReceipt:partial});assert.match(html,/>3<\/td>/);assert.match(html,/fixture-order/);
});
test('untrusted account and order text are rendered as text',()=>{
 const r=receipt();r.brokerOrders[0].orderId='<script>bad</script>';
 const html=context.render({...account,label:'<img onerror=bad>'},{...account,lastReceipt:r});assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
});

test('strategy and monitor identity must match before a selected strategy exposes broker rows',()=>{
 const a={...account,strategyId:'selected'};
 const watch={...account,strategyId:'selected',lastReceipt:{...receipt(),strategyId:'selected'}};
 assert.match(context.render(a,watch),/fixture-order/);
 for(const change of [w=>{w.strategyId='foreign';},w=>{w.accountId='foreign';},w=>{w.connectionKey='foreign';},w=>{w.lastReceipt.strategyId='foreign';},w=>{delete w.strategyId;},w=>{delete w.lastReceipt.strategyId;}]){
  const w=structuredClone(watch);change(w);const html=context.render(a,w);assert.doesNotMatch(html,/fixture-order|SELL ABC|Allocation paused/);assert.match(html,/No matching account/);
 }
});
test('absent account strategy context never validates a current-strategy execution receipt',()=>{
 const watch={...account,lastReceipt:receipt()};
 for(const value of [undefined,null,'']){const a={...account,strategyId:value};assert.doesNotMatch(context.render(a,watch),/fixture-order|SELL ABC|Allocation paused/);assert.match(context.render(a,watch),/No matching account/);}
});
test('malformed arrays stay unavailable and working order text stays escaped and bounded',()=>{
 for(const patch of [{brokerOrders:[null]},{brokerOrders:{}},{brokerOrders:[{executions:[null]}]}])assert.match(context.render(account,{...account,lastReceipt:{...receipt(),...patch}}),/Broker executions are unavailable/);
 const r=receipt();r.workingOrders=[null];assert.match(context.render(account,{...account,lastReceipt:r}),/Working orders are unavailable/);
 r.workingOrders=[];assert.match(context.render(account,{...account,lastReceipt:r}),/No working orders were returned/);
 r.workingOrders=Array.from({length:25},(_,i)=>({orderId:'pending-'+i,status:'<img onerror=bad>'}));
 const html=context.render(account,{...account,lastReceipt:r});assert.match(html,/pending-19/);assert.doesNotMatch(html,/pending-20|<img/);assert.match(html,/&lt;img/);
});
