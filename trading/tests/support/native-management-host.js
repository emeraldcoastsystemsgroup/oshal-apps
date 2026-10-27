/** Synthetic account/history/SQL and broker-ticket seam for native management route/browser guards. */
'use strict';
const assert=require('node:assert/strict');
const {application}=require('./native-portfolio-host');
const binding={accountId:'a',connectionKey:'owned-login'};
async function setup(t){
 const h=application();h.accounts[0].balanceFacts={buyingPower:20000,cashAvailableForTrading:1000,cashAvailableForWithdrawal:1000,unsettledCash:0,debitBalance:0,maintenanceRequirement:0};const original=h.ctx.intent;let submissions=0,cancellations=0,failOrders=false;
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.config')return{orderTickets:true};
  if(name==='trading.orders.list'){if(failOrders)throw Error('Synthetic broker outage');return{orders:[],readAtMs:0};}
  if(name==='trading.orders.balance')return{cashBudgetUsd:1000,readAtMs:0};
  if(name==='trading.orders.tickets')return{tickets:[]};
  if(name==='trading.orders.prepare')return{ticketId:'ticket-1',fingerprint:'exact-ticket',terms:{...input,notionalCents:input.quantity*input.limitCents},status:'prepared',expiresAtMs:Date.parse('2026-10-26T16:02:00Z'),facts:{cashBudgetUsd:1000}};
  if(name==='trading.orders.cancel'){cancellations++;return{ticketId:input.ticketId,cancelStatus:'requested',orderId:input.orderId};}
  if(name==='trading.orders.submit'){submissions++;return{ticketId:input.ticketId,status:'submitted',orderId:'12345'};}
  return original(name,input);
 };
 const server=await new Promise(resolve=>{const s=h.app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const req=async(path,body,owner='owner-a')=>{const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/trading/portfolio'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-fixture-owner':owner},...(body?{body:JSON.stringify(body)}:{})});return{status:res.status,...await res.json()};};
 const config={modelVersion:2,kind:'quarterly-rotation',assets:['SPY','EFA','IEF','GLD','VNQ','DBC'].map(symbol=>({symbol,weightPct:100/6})),lookbackSessions:63,rebalanceSessions:20,topN:3,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false};
 const strategy=(await req('/strategies',{name:'Monthly model',config})).strategy;
 assert.ok(strategy?.id);
 await req('/profiles',{...binding,label:'Synthetic account',registration:'taxable',strategyId:strategy.id});
 const study=await req('/backtest',{...binding,strategyId:strategy.id,startDate:'2026-05-01',endDate:'2026-10-23'});assert.equal(study.run?.status,'completed',JSON.stringify(study.run?.error));
 h.setNow('2026-10-26T16:00:00Z');
 for(const symbol of ['ABC','SPY','EFA','IEF','GLD','VNQ','DBC','BIL'])h.setQuote(symbol,{tradeAt:'2026-10-26T16:00:00Z'});
 return {...h,base:'http://127.0.0.1:'+server.address().port,req,runId:study.run.id,strategyId:strategy.id,submitted:()=>submissions,canceled:()=>cancellations,failOrders:()=>{failOrders=true;}};
}
module.exports={setup,binding};
