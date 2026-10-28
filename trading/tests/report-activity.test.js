/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify real/manual/partial execution recaps across all connected accounts, ET date boundaries and explicit incomplete-history handling.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {brokerActivity,paperActivity}=require('../routes/paper/report-activity');
const now=new Date('2026-10-27T22:00:00Z');
const order=(id,extra={})=>({orderId:id,status:'FILLED',filledQuantity:3,remainingQuantity:0,legs:[{symbol:'SPY',instruction:'BUY'}],executions:[{quantity:3,price:100,time:'2026-10-27T14:00:00Z'}],...extra});
const answer=orders=>({source:'schwab',orders,readAtMs:now.getTime(),historyWindowDays:60});
test('partial/manual fills are counted on execution ET day rather than order date or close date',()=>{
 const r=brokerActivity(answer([order('manual',{status:'WORKING',remainingQuantity:1,enteredTime:'2026-10-01T14:00:00Z',closeTime:null,executions:[{quantity:1,price:99,time:'2026-10-27T03:59:00Z'},{quantity:2,price:101,time:'2026-10-27T04:01:00Z'}]})]),now);
 assert.equal(r.today.fills,1);assert.equal(r.today.orders,1);assert.equal(r.today.buyGross,202);assert.equal(r.recentFills.length,2);assert.equal(r.todayFills[0].partial,true);assert.equal(r.today.realizedPl,null);assert.equal(r.today.fees,null);
});
test('zero-filled replacement activity never becomes a trade and duplicate order IDs do not double count',()=>{
 const o=order('same'),r=brokerActivity(answer([order('replaced',{status:'REPLACED',filledQuantity:0,executions:[{quantity:70,price:0,time:now.toISOString()}]}),o,o]),now);
 assert.equal(r.today.fills,1);assert.equal(r.today.buyGross,300);assert.equal(r.status,'available');
});
test('complex, missing and inconsistent executions remain coverage exceptions',()=>{
 const r=brokerActivity(answer([order('complex',{complex:true}),order('missing',{executions:[]}),order('wrong-qty',{filledQuantity:4}),order('future',{executions:[{quantity:3,price:100,time:'2026-10-28T14:00:00Z'}]})]),now);
 assert.equal(r.status,'partial');assert.equal(r.today.fills,0);assert.equal(r.exceptions.length,4);assert.equal(r.orders.length,4);
});
test('contract symbols retain actual fills without an invented multiplier or profit',()=>{
 const r=brokerActivity(answer([order('option',{legs:[{symbol:'SPY_102726C500',instruction:'SELL_TO_CLOSE'}]})]),now);
 assert.equal(r.today.fills,1);assert.equal(r.today.unvaluedFills,1);assert.equal(r.todayFills[0].notional,null);assert.equal(r.today.sellGross,0);
});
test('daily paper profit stays simulated and cannot enter broker totals',()=>{
 const r=paperActivity([{order_id:'p',side:'sell',symbol:'SPY',qty:2,fill_price:101,notional:202,realized_pl:2,created_at:'2026-10-27T14:00:00Z'}],now);
 assert.equal(r.today.realizedPl,2);assert.equal(r.today.sellGross,202);assert.equal(r.simulated,true);assert.equal(r.todayFills[0].simulated,true);
});
test('live report reads every original-owner account including untracked trades and preserves account outages',async()=>{
 const {standIns,loadShipped}=require('./support/native-landing-host');
 const modules=standIns({});modules['@/features/trading'].nativeSchwabReads=true;
 const report=loadShipped(modules,load=>{load('trading-portfolio-routes');return load('paper/report');});
 const calls=[],owners=[];
 const accounts=['cash','margin','ira'].map(accountId=>({accountId,connectionKey:'own-connection',kind:'live',broker:'schwab',accountMasked:accountId,accountType:'cash',equity:10000,cash:10000,positions:[]}));
 const ctx={pool:{query:async(_sql,args)=>{owners.push(args[0]);return{rows:[]};}},intent:async(name,input)=>{
  calls.push({name,input});if(name==='trading.accounts')return{accounts,errors:[],readAt:now.toISOString()};
  if(name==='trading.orders.list'){if(input.accountId==='ira')throw Error('synthetic provider outage');return{...answer([order('same-broker-id')]),accountId:input.accountId};}
  throw Error('Unintended intent '+name);
 }};
 const r=await report.liveRows(ctx,'original-owner',now);
 assert.equal(r.rows.length,3);assert.equal(r.rows[0].activity.today.fills,1);assert.equal(r.rows[1].activity.today.fills,1);assert.equal(r.rows[2].activity.status,'unavailable');assert.equal(r.rows[2].activity.today,undefined);
 assert.deepEqual(calls.filter(c=>c.name==='trading.orders.list').map(c=>c.input.accountId),['cash','margin','ira']);assert.ok(owners.every(o=>o==='original-owner'));assert.ok(calls.every(c=>['trading.accounts','trading.orders.list'].includes(c.name)));
});
