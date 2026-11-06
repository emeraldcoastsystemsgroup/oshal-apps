/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Daily paper decisions retain cost/trailing state and use the replay's costed turnover/settlement step; state commits with the ledger tick. */
'use strict';
const {signal}=require('../strategy/signals');
const {rebalance}=require('../strategy/rebalance');
const {fingerprint}=require('../trading-portfolio-store');

const holdingsOf=positions=>positions.map(p=>({symbol:p.symbol,qty:p.qty,entry:p.avgCost,avgEntryPrice:p.avgCost,peak:p.peak}));
function decide(config,series,asOf,positions,previous){
 const riskState=previous?.strategyFingerprint===fingerprint(config)?previous.riskState:{};
 return signal(config,series,asOf,{holdings:holdingsOf(positions),riskState:riskState||{}});
}
function planDaily(account,positions,decision,prices,assignment,previous,session){
 const c=assignment.config,quotes=Object.fromEntries([...prices].map(([symbol,q])=>[symbol,q.price]));
 if(previous?.session>=session)throw Error('This paper account already processed this session or has future state.');
 // The ledger cash includes sale receivables. A prior exchange session's receivables settle now.
 const step=rebalance(c,{holdings:holdingsOf(positions),cash:account.cash,prices:quotes,targets:decision.targets,initial:!previous});
 const before=new Map(positions.map(p=>[p.symbol,p])),name=assignment.strategyName;
 const fills=step.fills.map(f=>({...f,notional:f.qty*f.price,realizedPl:f.side==='sell'?(f.price-before.get(f.symbol).avgCost)*f.qty-f.cost:-f.cost,quoteAt:prices.get(f.symbol).at,
  reason:'Strategy rebalance: '+name,decision:{action:f.side,reason:'Strategy rebalance: '+name,score:null,confidence:null,regime:null,rationale:'Saved daily strategy; prior completed-session signal, whole shares, costs, turnover and cash settlement.',perTimeframe:[]}}));
 const after=step.holdings.map(p=>({symbol:p.symbol,qty:p.qty,avgCost:p.entry,currentPrice:quotes[p.symbol],lastPriceAt:prices.get(p.symbol).at,peak:p.peak,openedAt:before.get(p.symbol)?.openedAt||null}));
 const cash=step.cash+step.unsettledCash,equity=cash+after.reduce((n,p)=>n+p.qty*p.currentPrice,0);
 return {fills,positions:after,cash,equity,highWater:Math.max(account.highWater||0,equity),daily:{session,strategyFingerprint:fingerprint(c),riskState:decision.riskState,settledCash:step.cash,unsettledCash:step.unsettledCash,costs:step.costs,decisionAsOf:decision.decisionAsOf}};
}
module.exports={decide,planDaily};
