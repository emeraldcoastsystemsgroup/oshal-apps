/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Require the configured stock factor warmup and describe selected-universe price research accurately. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Costed chronological daily replay, held-out and harsher-cost evidence; no same-close fills, current fundamentals or future membership. */
'use strict';
const {normalizePolicy,hash}=require('./policies');
const {signal,seriesMaps}=require('./signals');
function metrics(curve,start){
 let peak=start,dd=0;const returns=curve.map((p,i)=>{peak=Math.max(peak,p.equity);dd=Math.max(dd,1-p.equity/peak);return p.equity/(i?curve[i-1].equity:start)-1;}),mean=returns.reduce((n,r)=>n+r,0)/returns.length,sd=Math.sqrt(returns.reduce((n,r)=>n+(r-mean)**2,0)/Math.max(1,returns.length-1));
 return {totalReturnPct:(curve.at(-1).equity/start-1)*100,maxDrawdownPct:dd*100,sharpeZeroRiskFree:sd>0?mean/sd*Math.sqrt(252):0};
}
function replay(raw,input,{costMultiplier=1}={}){
 const c=normalizePolicy(raw),maps=seriesMaps(input.series),calendar=[...(maps.get('SPY')||new Map()).keys()].sort(),days=calendar.filter(d=>d>=input.startDate&&d<=input.endDate);
 if(days.length<2||calendar.indexOf(days[0])<c.lookbackSessions||!Number.isFinite(input.startingCapital)||input.startingCapital<100)throw Error('Replay needs capital, '+c.lookbackSessions+' warmup sessions and a complete requested window.');
 for(const symbol of c.assets.map(a=>a.symbol))for(const day of calendar.slice(calendar.indexOf(days[0])-c.lookbackSessions,calendar.indexOf(days.at(-1))+1))if(!maps.get(symbol)?.has(day))throw Error(symbol+' has missing historical sessions.');
 const expected=require('../trading-portfolio-calendar').sessionDates(input.startDate,input.endDate);if(expected.length!==days.length||expected.some((d,i)=>d!==days[i]))throw Error('Replay benchmark session coverage is incomplete.');
 const capital=input.startingCapital,book=new Map(),curve=[],rebalances=[],costRate=c.transactionCostBps*costMultiplier/10000;
 let riskState={},cash=capital,settling=[],costs=0,trades=0,benchmarkShares=0,benchmarkCash=capital;
 for(const [offset,day] of days.entries()){
  const ix=calendar.indexOf(day),previous=calendar[ix-1],prices=Object.fromEntries(c.assets.map(a=>[a.symbol,maps.get(a.symbol).get(day)]));
  cash+=settling.filter(x=>x.session<=ix).reduce((n,x)=>n+x.amount,0);settling=settling.filter(x=>x.session>ix);
  const holdings=[...book].map(([symbol,p])=>({symbol,...p}));
  const decision=signal(c,maps,previous,{holdings,riskState});riskState=decision.riskState;
  let equity=cash+settling.reduce((n,x)=>n+x.amount,0)+holdings.reduce((n,h)=>n+h.qty*prices[h.symbol],0);
  const targets=new Map(decision.targets.map(t=>[t.symbol,t.weightPct]));
  const actions=c.assets.map(a=>{const held=book.get(a.symbol)?.qty||0,target=Math.floor(equity*(targets.get(a.symbol)||0)/100/prices[a.symbol]);return {symbol:a.symbol,change:target-held,riskExit:target===0&&held>0};}).filter(a=>a.change!==0&& (a.riskExit||Math.abs(a.change)*prices[a.symbol]>=equity*c.minTradeEquityPct/100));
  let regularBudget=equity*(offset===0?c.initialTransitionTurnoverPct:c.maxDailyTurnoverPct)/100;
  const fills=[];
  for(const action of actions.sort((a,b)=>(a.change>0)-(b.change>0)||a.symbol.localeCompare(b.symbol))){
   const price=prices[action.symbol],buy=action.change>0;
   let qty=Math.min(Math.abs(action.change),Math.floor((action.riskExit?Infinity:regularBudget)/(price*(1+costRate))));
   if(buy)qty=Math.min(qty,Math.floor(cash/(price*(1+costRate))));
   if(qty<1)continue;const notional=qty*price,fee=notional*costRate;costs+=fee;trades++;
   if(!action.riskExit)regularBudget=Math.max(0,regularBudget-notional-fee);
   const old=book.get(action.symbol);
   if(buy){cash-=notional+fee;book.set(action.symbol,{qty:(old?.qty||0)+qty,entry:((old?.entry||0)*(old?.qty||0)+notional)/((old?.qty||0)+qty),peak:Math.max(old?.peak||price,price)});}
   else{const remaining=old.qty-qty;if(remaining)book.set(action.symbol,{...old,qty:remaining});else book.delete(action.symbol);if(c.accountClass==='retirement-cash')settling.push({session:ix+1,amount:notional-fee});else cash+=notional-fee;}
   fills.push({symbol:action.symbol,side:buy?'buy':'sell',qty,price,cost:fee});
  }
  if(!offset){const px=maps.get('SPY').get(day);benchmarkShares=Math.floor(capital/(px*(1+costRate)));benchmarkCash-=benchmarkShares*px*(1+costRate);}
  equity=cash+settling.reduce((n,x)=>n+x.amount,0)+[...book].reduce((n,[s,p])=>n+p.qty*prices[s],0);
  if(cash<-.000001||equity<=0)throw Error('Cash/solvency invariant failed.');
  curve.push({date:day,equity,cash,unsettledCash:settling.reduce((n,x)=>n+x.amount,0),benchmark:benchmarkCash+benchmarkShares*maps.get('SPY').get(day),benchmarkEquity:benchmarkCash+benchmarkShares*maps.get('SPY').get(day)});
  rebalances.push({fillDate:day,decisionAsOf:previous,targets:decision.targets,fills});
 }
 const result=metrics(curve,capital),benchmark=metrics(curve.map(p=>({equity:p.benchmarkEquity})),capital),half=Math.floor(curve.length/2),holdout=metrics(curve.slice(half),curve[half-1].equity);
 return {model:'portfolio-daily-v3',researchOnly:true,realOrdersPlaced:0,config:c,window:{firstSession:days[0],lastSession:days.at(-1),sessions:days.length,requestedStart:input.startDate,requestedEnd:input.endDate},metrics:{...result,benchmarkReturnPct:benchmark.totalReturnPct,excessPriceReturnPct:result.totalReturnPct-benchmark.totalReturnPct},holdout:{firstSession:curve[half].date,sessions:curve.length-half,metrics:holdout},startingCapital:capital,maintenanceTriggered:false,costs:{oneWayBps:c.transactionCostBps*costMultiplier,totalUsd:costs,tradingUsd:costs,interestUsd:0,financingUsd:0,trades},curve,equityCurve:curve,rebalances,assumptions:[c.kind==='quant-stock-daily'?'Persisted explicitly selected equity universe and Quant price signal; selected-universe research, with no historical membership or point-in-time fundamental claim.':'Fixed versioned ETF universe; no present-day stock fundamentals or historical index-membership claim.','Signals use prior completed close; fills at the following session close with one-way cost/slippage. Closing-price stops are not an intraday stop simulation.','Cash earns zero; provider daily closes are price returns, not asserted total returns. Benchmark uses the same price basis and costs.','Retirement sales settle on the next supplied exchange session; proceeds cannot fund same-session purchases. Margin uses sale proceeds without negative cash or leverage.','Held-out second half is diagnostic for this predeclared version, not a promise of future gains.']};
}
function validateReplay(config,input){
 const result=replay(config,input),stress=replay(config,input,{costMultiplier:2}),c=normalizePolicy(config),reasons=[];
 if(result.window.sessions<252)reasons.push('At least 252 evaluated sessions are required.');
 if(result.holdout.sessions<126)reasons.push('At least 126 held-out sessions are required.');
 if(result.metrics.totalReturnPct<=0||result.holdout.metrics.totalReturnPct<=0)reasons.push('Net full-window and held-out price returns must both be positive.');
 if(result.metrics.sharpeZeroRiskFree<.5)reasons.push('Net full-window Sharpe must be at least 0.5.');
 if(result.metrics.maxDrawdownPct>(c.accountClass==='retirement-cash'?10:15))reasons.push('Drawdown exceeds this account class limit.');
 if(stress.metrics.totalReturnPct<=0||stress.holdout.metrics.totalReturnPct<=0)reasons.push('The doubled-cost full-window and held-out results must remain positive.');
 return {result,validation:{version:c.validationVersion,strategyFingerprint:hash(c),dataFingerprint:hash(input.series),window:result.window,passed:reasons.length===0,reasons,stress:{metrics:stress.metrics,holdout:stress.holdout,costs:stress.costs},limitations:result.assumptions}};
}
module.exports={replay,validateReplay,metrics};
