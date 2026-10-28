/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Summarize broker-reported executions across every connected account, including manual and partial fills, without inventing tax-lot profit or contract multipliers.
 */
'use strict';
const {etParts}=require('./market');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round(n*100)/100;
function dayOf(at){const n=Date.parse(at);return Number.isFinite(n)?etParts(new Date(n)).date:null;}
function totals(fills){
 const sum=side=>round(fills.filter(f=>f.side===side&&finite(f.notional)).reduce((s,f)=>s+f.notional,0));
 return {fills:fills.length,orders:new Set(fills.map(f=>f.orderId)).size,buyGross:sum('BUY'),sellGross:sum('SELL'),unvaluedFills:fills.filter(f=>!finite(f.notional)).length,fees:null,realizedPl:null};
}
function brokerActivity(answer,now){
 const day=etParts(now).date,exceptions=[],fills=[],orders=[],seen=new Map();
 if(answer?.source!=='schwab'||!Array.isArray(answer.orders))throw Error('Broker order history is unavailable.');
 orderLoop: for(const order of answer.orders){
  const id=String(order.orderId||'');
  if(!id){exceptions.push('An order has no broker identity; its executions are not aggregated.');continue;}
  if(seen.has(id)){if(seen.get(id)!==JSON.stringify(order))exceptions.push('Conflicting duplicate broker order '+id+'; coverage requires reconciliation.');continue;}
  seen.set(id,JSON.stringify(order));
  orders.push({orderId:id,status:order.status,filledQuantity:order.filledQuantity,remainingQuantity:order.remainingQuantity,enteredTime:order.enteredTime,legs:order.legs,complex:order.complex});
  if(!finite(order.filledQuantity)||order.filledQuantity<0){exceptions.push(id+': filled quantity unavailable.');continue;}
  if(order.filledQuantity===0)continue;
  if(order.complex||order.legs?.length!==1){exceptions.push(id+': executed complex/multi-leg order; the native read does not identify execution legs. Review its broker details separately.');continue;}
  const leg=order.legs[0],executions=order.executions;
  if(!leg.symbol||!leg.instruction||!Array.isArray(executions)||!executions.length||executions.some(e=>!finite(e.price)||e.price<=0||!finite(e.quantity)||e.quantity<=0||!dayOf(e.time)||Date.parse(e.time)>now.getTime())||Math.abs(executions.reduce((n,e)=>n+e.quantity,0)-order.filledQuantity)>0.000001){
   exceptions.push(id+': execution quantities, prices or timestamps do not reconcile; no fill or profit is inferred.');continue;
  }
  for(const e of executions){
   if(fills.length>=10000){exceptions.push('The report reached its 10,000-execution limit; this history is incomplete.');break orderLoop;}
   // The normalized read has no asset-class/multiplier facts. Contract-like symbols
   // remain visible but cannot contribute an invented shares-times-price cash total.
   const stockLike=/^[A-Z][A-Z./-]{0,14}$/.test(leg.symbol);
   fills.push({orderId:id,symbol:leg.symbol,side:leg.instruction,quantity:e.quantity,price:e.price,at:e.time,notional:stockLike?round(e.quantity*e.price):null,status:order.status,partial:finite(order.remainingQuantity)&&order.remainingQuantity>0,source:'schwab',simulated:false});
  }
 }
 fills.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.orderId.localeCompare(b.orderId));
 if(answer.orders.length>=3000)exceptions.push('The broker order query reached its 3,000-order limit; this history may be incomplete.');
 const today=fills.filter(f=>dayOf(f.at)===day),readAt=finite(answer.readAtMs)?new Date(answer.readAtMs).toISOString():null;
 return {status:exceptions.length?'partial':'available',source:'schwab',sessionDate:day,readAt,historyWindowDays:answer.historyWindowDays??null,returnedOrders:answer.orders.length,today:totals(today),todayFills:today,recentFills:fills,orders,exceptions,
  coverage:'All returned broker orders, including manual trades and partial fills. The native query covers orders entered in the last '+(answer.historyWindowDays??'unknown number of')+' days; older standing orders and lifetime history are not certified.',
  valuation:'Buy/sell gross is quantity × execution price for stock-like symbols, before fees. Contract multipliers, fees and tax-lot realized profit are unavailable.'};
}
function paperActivity(orders,now,{truncated=false}={}){
 const sessionDate=etParts(now).date,rows=orders.filter(o=>dayOf(o.created_at)===sessionDate&&Date.parse(o.created_at)<=now.getTime()),fills=rows.map(o=>({orderId:o.order_id,symbol:o.symbol,side:String(o.side).toUpperCase(),quantity:o.qty,price:o.fill_price,at:o.created_at,notional:o.notional,realizedPl:o.realized_pl,reason:o.reason,simulated:true,source:'local-paper'}));
 const summary=totals(fills);summary.realizedPl=round(rows.reduce((s,o)=>s+(finite(o.realized_pl)?o.realized_pl:0),0));
 return {status:truncated?'partial':'available',source:'local-paper',sessionDate,today:summary,todayFills:fills,exceptions:truncated?['The daily paper ledger reached the 10,000-fill report limit; coverage may be incomplete.']:[],simulated:true};
}
module.exports={brokerActivity,paperActivity,totals};
