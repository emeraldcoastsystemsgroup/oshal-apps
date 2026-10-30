/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exact-owner account history, sparse benchmark, zero/missing facts and failed-source regression guards through shipped routes with synthetic data.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {application}=require('./support/native-portfolio-host');
const {recordAccountValue}=require('../routes/trading-account-values');
async function fixture(t){
 const h=application(),original=h.ctx.intent;let at='2026-10-22T19:55:00Z',failBars=false;
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.accounts')return{accounts:h.accounts,errors:[],readAt:at};
  if(name==='trading.bars'){
   if(failBars)throw Error('Synthetic market outage');
   return{source:'schwab',symbol:input.symbol,bars:[{t:Date.parse('2026-10-22T05:00:00Z')/1000,c:100},{t:Date.parse('2026-10-23T05:00:00Z')/1000,c:input.symbol==='ABC'?120:105}]};
  }return original(name,input);
 };
 const server=await new Promise(resolve=>{const s=h.app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const req=async(query='',owner='owner-a')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/trading/portfolio/account-details?accountId=a&connectionKey=owned-login'+query,{headers:{'x-fixture-owner':owner}});return{status:r.status,...await r.json()};};
 return{...h,req,time:x=>{at=x;h.setNow(x);},failBars:()=>{failBars=true;}};
}
test('details retain actual balances per owner/connection and compare only matching dated observations',async t=>{
 const h=await fixture(t);let data=await h.req();assert.equal(data.status,200);assert.equal(data.history.points.length,1);assert.equal(data.history.changePct,null);assert.equal(data.benchmark.status,'insufficient-history');
 h.time('2026-10-23T19:55:00Z');h.accounts[0].equity=11000;
 data=await h.req();assert.equal(data.history.points.length,2);assert.ok(Math.abs(data.history.changePct-10)<1e-8);assert.ok(Math.abs(data.benchmark.points.at(-1).benchmarkPct-5)<1e-8);assert.match(data.history.basis,/not a cash-flow-adjusted/);
 assert.equal(data.account.dayChange,null,'ambiguous broker position amounts cannot become account return');assert.equal(data.account.holdings[0].dayPl,null);
 await recordAccountValue(h.ctx,'owner-a',h.accounts[0],'2026-10-23T18:00:00Z');assert.equal((await h.req()).history.points.at(-1).at,'2026-10-23T19:55:00.000Z');
 const b=await h.req('','owner-b');assert.equal(b.history.points.length,1,'another owner cannot read the first day');
 h.accounts.push({...h.accounts[0],connectionKey:'second-login',equity:50000});
 const second=await h.req('&connectionKey=second-login');assert.equal(second.status,400,'ambiguous duplicate selectors are refused');
 assert.equal((await h.req('&compare=%3Cscript%3E')).status,400);assert.equal((await h.req('&period=bad')).status,400);
 h.failBars();data=await h.req();assert.equal(data.benchmark.status,'unavailable');assert.equal(data.history.points.length,2);assert.equal(data.account.equity,11000);
 assert.ok(h.calls.filter(c=>c.intent).every(c=>['trading.accounts','trading.bars'].includes(c.intent)),'no financial mutation intent');
});
test('zero equity and absent values stay explicit; a false day P&L is never propagated',async t=>{
 const h=await fixture(t);h.accounts[0].equity=0;h.accounts[0].cash=0;h.accounts[0].positions=[];h.accounts[0].dayChange=180000;
 await h.req();h.time('2026-10-23T19:55:00Z');h.accounts[0].equity=100;
 const data=await h.req();assert.equal(data.history.change,100);assert.equal(data.history.changePct,null);assert.deepEqual(data.benchmark.points,[]);assert.equal(data.account.dayChange,null);
});
