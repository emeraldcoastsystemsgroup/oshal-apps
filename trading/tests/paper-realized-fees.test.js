/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual daily paper buy costs reach ledger/account and realized screen totals exactly once without counting purchases as closing trades.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {realizedOf,screenRead}=require('../routes/paper/screen');
const store=require('../routes/paper/store');
const {planDaily}=require('../routes/paper/daily-strategy');
const {normalizePortfolioStrategy}=require('../routes/trading-portfolio-sim');
const {createSqlDouble}=require('./support/paper-doubles');
const NOW=new Date('2026-11-12T16:00:00Z');
const fill=(side,realized_pl,at=NOW.toISOString())=>({side,realized_pl,created_at:at});

test('a purchases-only day includes entry fees but has no closing trades or losing-trade rate',()=>{
 const out=realizedOf([fill('buy',-2.5),fill('buy',-1)],NOW);
 for(const tally of [out.today,out.last30d]){
  assert.equal(tally.net,-3.5);assert.equal(tally.trades,0);assert.equal(tally.wins+tally.losses,0);assert.equal(tally.winRatePct,null);
  assert.deepEqual([tally.avg_win,tally.avg_loss,tally.biggest_win,tally.biggest_loss],[0,0,0,0]);
 }
});
test('entry fees affect net exactly once while closing-trade metrics retain sell semantics',()=>{
 const out=realizedOf([fill('buy',-2),fill('sell',12),fill('sell',-3),fill('buy',null)],NOW).today;
 assert.deepEqual([out.net,out.trades,out.wins,out.losses,out.winRatePct],[7,2,1,1,50]);
 assert.deepEqual([out.avg_win,out.avg_loss,out.biggest_win,out.biggest_loss],[12,-3,12,-3]);
});
test('entry fees use the same New York day and thirty-day windows as closing fills',()=>{
 const out=realizedOf([fill('buy',-1,'2026-11-12T04:59:00Z'),fill('buy',-2,'2026-11-12T05:00:00Z'),fill('buy',-4,'2026-10-13T15:59:59Z'),fill('sell',10)],NOW);
 assert.equal(out.today.net,8);assert.equal(out.last30d.net,7);assert.equal(out.today.trades,1);assert.equal(out.last30d.trades,1);
});
test('actual daily costed plan, atomic ledger/account and shipped realized reader agree',async()=>{
 const {pool,db}=createSqlDouble(),owner='synthetic-fee-owner';
 await store.arm(pool,owner,{posture:'balanced',startingCash:10000,maxShares:100,maxNotional:10000,maxOrdersPerTick:5,maxQuoteAgeMinutes:10},NOW.toISOString());
 const config=normalizePortfolioStrategy({modelVersion:3,kind:'quant-margin-daily'}),prices=new Map(config.assets.map(a=>[a.symbol,{price:100,at:NOW.toISOString()}]));
 const account=await store.loadAccount(pool,owner),plan=planDaily(account,[],{decisionAsOf:'2026-11-11',targets:[{symbol:'SPY',weightPct:25}],riskState:{}},prices,{config,strategyName:'Synthetic daily'},null,'2026-11-12');
 assert.ok(plan.fills.length>0);assert.ok(plan.fills.every(f=>f.side==='buy'&&f.realizedPl<0));plan.summary={daily:plan.daily};
 const written=await store.writeTick(pool,owner,{window:NOW.toISOString(),trigger:'test',runId:null,at:NOW.toISOString(),sessionDate:'2026-11-12',plan,account,ids:plan.fills.map((_,i)=>({orderId:'fee-order-'+i,decisionId:'fee-decision-'+i})),previousSymbols:[]});
 assert.equal(written.written,true);const net=Math.round(plan.fills.reduce((n,f)=>n+f.realizedPl,0)*100)/100;
 const out=await screenRead({pool,intent:async()=>{throw Error('No market read belongs to realized');}},owner,'paper',false,'realized',{now:NOW});
 assert.ok(out);assert.equal(db.account[0].realized_pl,net);assert.equal(out.today.net,net);assert.equal(out.last30d.net,net);
 assert.equal(out.today.trades,0);assert.equal(db.orders.length,plan.fills.length);
});
