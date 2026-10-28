/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stale archive recovery uses measured native quotes and completed candles, names its source and never reaches a broker writer.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {nativePaperMarket}=require('../routes/paper/native-market');
const {planTick}=require('../routes/paper/plan');
const {DEFAULTS}=require('../routes/paper/tick');
test('stale archive fallback preserves source and excludes future/incomplete bars',async()=>{
 const now=new Date('2026-10-27T15:00:00Z'),calls=[];
 const intent=async(name,input)=>{
  calls.push(name);
  if(name==='prices.latest')return {prices:[{symbol:'SPY',price:100,at:'2026-10-16T19:55:00Z'}]};
  if(name==='prices.series')return {series:{SPY:[]}};
  if(name==='trading.config')return {configured:true};
  if(name==='trading.quotes')return {source:'schwab',quotes:[{symbol:'SPY',tradePrice:200,tradeAt:now.toISOString()}]};
  if(name==='trading.bars')return {source:'schwab',symbol:input.symbol,bars:[{t:Math.floor(now.getTime()/1000)-86400,c:190},{t:Math.floor(now.getTime()/1000),c:999}]};
  throw Error('Unexpected intent '+name);
 };
 const market=await nativePaperMarket(intent,['SPY'],now);
 assert.equal(market.quotes.get('SPY').price,200);assert.equal(market.source,'schwab-read-only');assert.deepEqual(market.closes.get('SPY')['1Day'],[190]);assert.deepEqual(market.closes.get('SPY')['5Min'],[190]);
 assert.ok(calls.every(x=>['prices.latest','prices.series','trading.config','trading.quotes','trading.bars'].includes(x)));
 const plan=planTick({config:{...DEFAULTS,universe:['SPY']},account:{cash:100000,equity:100000,highWater:100000,realizedPl:0},positions:[],market,now});
 assert.equal(plan.fills.length,0,'missing indicator history cannot invent a buy signal');
});
test('failed archive and unavailable native data stays an error, never a fabricated quote',async()=>{
 await assert.rejects(nativePaperMarket(async()=>{throw Error('synthetic provider outage');},['SPY'],new Date()),/synthetic provider outage/);
});
