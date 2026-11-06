/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Share costed whole-share sizing, turnover and retirement settlement between historical replay and forward paper execution. No broker effects. */
'use strict';

function rebalance(c,{holdings,cash,unsettledCash=0,prices,targets,initial=false,costMultiplier=1}){
 const book=new Map(holdings.map(h=>[h.symbol,{qty:h.qty,entry:h.entry,peak:h.peak}]));
 const equity=cash+unsettledCash+holdings.reduce((n,h)=>n+h.qty*prices[h.symbol],0),weights=new Map(targets.map(t=>[t.symbol,t.weightPct]));
 const symbols=[...new Set([...c.assets.map(a=>a.symbol),...book.keys()])],costRate=c.transactionCostBps*costMultiplier/10000;
 if(!Number.isFinite(equity)||equity<=0||cash<0||unsettledCash<0||symbols.some(s=>!Number.isFinite(prices[s])||prices[s]<=0))throw Error('Complete prices and solvent cash are required.');
 const actions=symbols.map(symbol=>{const held=book.get(symbol)?.qty||0,target=Math.floor(equity*(weights.get(symbol)||0)/100/prices[symbol]);return {symbol,change:target-held,riskExit:target===0&&held>0};}).filter(a=>a.change!==0&&(a.riskExit||Math.abs(a.change)*prices[a.symbol]>=equity*c.minTradeEquityPct/100));
 let regularBudget=equity*(initial?c.initialTransitionTurnoverPct:c.maxDailyTurnoverPct)/100,costs=0;
 const fills=[];
 for(const action of actions.sort((a,b)=>(a.change>0)-(b.change>0)||a.symbol.localeCompare(b.symbol))){
  const price=prices[action.symbol],buy=action.change>0;
  let qty=Math.min(Math.abs(action.change),Math.floor((action.riskExit?Infinity:regularBudget)/(price*(1+costRate))));
  if(buy)qty=Math.min(qty,Math.floor(cash/(price*(1+costRate))));
  if(qty<1)continue;const notional=qty*price,fee=notional*costRate;costs+=fee;
  if(!action.riskExit)regularBudget=Math.max(0,regularBudget-notional-fee);
  const old=book.get(action.symbol);
  if(buy){cash-=notional+fee;book.set(action.symbol,{qty:(old?.qty||0)+qty,entry:((old?.entry||0)*(old?.qty||0)+notional)/((old?.qty||0)+qty),peak:Math.max(old?.peak||price,price)});}
  else{const remaining=old.qty-qty;if(remaining)book.set(action.symbol,{...old,qty:remaining});else book.delete(action.symbol);if(c.accountClass==='retirement-cash')unsettledCash+=notional-fee;else cash+=notional-fee;}
  fills.push({symbol:action.symbol,side:buy?'buy':'sell',qty,price,cost:fee});
 }
 return {holdings:[...book].map(([symbol,p])=>({symbol,...p})),cash,unsettledCash,costs,fills};
}
module.exports={rebalance};
