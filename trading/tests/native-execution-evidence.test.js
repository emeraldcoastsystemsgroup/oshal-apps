/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Account execution evidence names the masked account, exposes a month-cycle pause, distinguishes fills from submissions and refuses another account's retained receipt.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tools/ui/native-account-management.js'),'utf8');
const context=vm.createContext({console,esc:s=>String(s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])),money:n=>'$'+Number(n).toFixed(2)});
vm.runInContext(source+'\n;globalThis.render=nativeExecutionEvidence;',context);
const account={accountId:'a',connectionKey:'c',label:'Trading …1234'};
function receipt(){return{accountId:'a',connectionKey:'c',observedAt:'2026-11-04T18:00:00Z',automation:{status:'protective-exit-awaiting-next-cycle',message:'A protective exit occurred. No remaining allocation order is submitted.'},brokerOrders:[{orderId:'fixture-order',status:'FILLED',legs:[{symbol:'ABC',instruction:'SELL'}],executions:[{quantity:10,price:25.5,time:'2026-11-04T17:00:00Z'}]},{orderId:'unfilled-order',status:'WORKING',legs:[{symbol:'XYZ',instruction:'BUY'}],executions:[]}]};}
test('an active approval cannot hide an account-wide allocation pause or a confirmed broker execution',()=>{
 const html=context.render(account,{authority:{active:true},lastReceipt:receipt()});
 assert.match(html,/Execution · Trading …1234/);assert.match(html,/Allocation paused after a protective sale/);
 assert.match(html,/No remaining allocation order/);assert.match(html,/SELL ABC/);assert.match(html,/fixture-order/);assert.match(html,/\$25\.50/);
 assert.doesNotMatch(html,/unfilled-order|BUY XYZ/);assert.match(html,/Broker orders last read/);assert.match(html,/Quant desk and research feed results do not change/);
});
test('another account or connection never supplies the selected account outcome or fills',()=>{
 for(const patch of [{accountId:'other'},{connectionKey:'other'}]){
  const html=context.render(account,{lastReceipt:{...receipt(),...patch}});
  assert.match(html,/No matching account broker receipt/);assert.doesNotMatch(html,/fixture-order|SELL ABC|Allocation paused/);
 }
});
test('unknown reads differ from verified empty reads, and partial executions retain their measured quantities',()=>{
 assert.match(context.render(account,{}),/Broker executions are unavailable/);
 const r=receipt();r.brokerOrders=[];assert.match(context.render(account,{lastReceipt:r}),/No confirmed executions were returned/);
 const partial=receipt();partial.brokerOrders[0].status='WORKING';partial.brokerOrders[0].executions[0].quantity=3;
 const html=context.render(account,{lastReceipt:partial});assert.match(html,/>3<\/td>/);assert.match(html,/fixture-order/);
});
test('untrusted account and order text are rendered as text',()=>{
 const r=receipt();r.brokerOrders[0].orderId='<script>bad</script>';
 const html=context.render({...account,label:'<img onerror=bad>'},{lastReceipt:r});assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
});
