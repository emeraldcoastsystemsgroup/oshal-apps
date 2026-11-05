/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Use the same Quant price factor definitions in daily stock decisions and replay; fingerprint the selected factor scores. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | One completed-session signal function shared by historical replay, paper and scheduled execution; future bars never enter a decision. */
'use strict';
const {normalizePolicy,hash}=require('./policies');
const mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
const volatility=xs=>{const r=xs.slice(1).map((p,i)=>p/xs[i]-1),m=mean(r);return Math.sqrt(r.reduce((s,n)=>s+(n-m)**2,0)/Math.max(1,r.length-1)*252);};
function seriesMaps(series){
 const out=new Map();for(const [symbol,rows] of Object.entries(series)){
  const m=new Map();for(const r of rows){if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(r.close)||r.close<=0||m.has(r.date))throw Error(symbol+' has invalid/duplicate price evidence.');m.set(r.date,r.close);}out.set(symbol,m);
 }return out;
}
function factors(symbol,maps,calendar,index){
 const m=maps.get(symbol),days=calendar.slice(Math.max(0,index-199),index+1),closes=days.map(d=>m?.get(d));
 if(days.length<200||closes.some(n=>!Number.isFinite(n)||n<=0))return null;
 const last=closes.at(-1),ma200=mean(closes),ma50=mean(closes.slice(-50)),vol=volatility(closes.slice(-64));
 if(!Number.isFinite(vol)||vol<0)return null;
 return {symbol,price:last,ma200,ma50,vol,mom126:last/closes.at(-127)-1,mom63:last/closes.at(-64)-1,mom21:last/closes.at(-22)-1,dayReturn:last/closes.at(-2)-1,eligible:last>ma200&&ma50>ma200};
}
function signal(config,series,asOf,{holdings=[],stops={},riskState={}}={}){
 const c=normalizePolicy(config),maps=series instanceof Map?series:seriesMaps(series),calendar=[...(maps.get('SPY')||new Map()).keys()].filter(d=>d<=asOf).sort();
 if(calendar.at(-1)!==asOf)throw Error('The exact completed signal session is unavailable.');
 const warmup=c.lookbackSessions,expected=require('../trading-portfolio-calendar').sessionDates(calendar.at(-warmup)||asOf,asOf);
 if(expected.length!==warmup||expected.some((d,i)=>d!==calendar.slice(-warmup)[i]))throw Error('Signal history has missing benchmark exchange sessions.');
 if(riskState.asOf>asOf)throw Error('Risk state is newer than the signal.');
 const index=calendar.length-1,market=factors('SPY',maps,calendar,index);if(!market)throw Error('The market trend lacks 200 complete sessions.');
 const rows=c.assets.map(a=>{const f=factors(a.symbol,maps,calendar,index);if(!f)throw Error(a.symbol+' lacks complete signal history.');return {...f,baseWeight:a.weightPct};});
 let quantScores=new Map();
 if(c.kind==='quant-stock-daily'){
  const q=require('../quant/factors'),dates=calendar.slice(-253),cross=c.assets.map(a=>{const closes=dates.map(d=>maps.get(a.symbol)?.get(d));if(closes.some(p=>!Number.isFinite(p)||p<=0))throw Error(a.symbol+' lacks complete Quant history.');return {symbol:a.symbol,factors:q.factorsAt(closes,closes.length-1)};});
  q.addComposite(cross);const definition=q.PRICE_SIGNALS.find(s=>s.id===c.rankBy);quantScores=new Map(cross.map(r=>[r.symbol,definition.score(r.factors)]));
 }
 const anchors={},datedStops={...(riskState.stops||{}),...stops};
 for(const h of holdings){const row=rows.find(r=>r.symbol===h.symbol);if(!row||!(h.qty>0))continue;const old=riskState.anchors?.[h.symbol],entry=Number.isFinite(h.avgEntryPrice)&&h.avgEntryPrice>0?h.avgEntryPrice:Number.isFinite(h.entry)&&h.entry>0?h.entry:old?.entry||row.price,peak=Math.max(old?.peak||row.price,row.price);anchors[h.symbol]={entry,peak};if(row.price<=entry*(1-c.hardStopPct/100)||row.price<=peak*(1-c.trailingStopPct/100))datedStops[h.symbol]={session:asOf,reason:'daily-close-stop'};}
 const stopped=s=>datedStops[s]&&asOf<=datedStops[s].session;
 const eligible=rows.filter(r=>r.eligible&&r.mom63>0&&r.mom21>0&&r.dayReturn>-.05&&!stopped(r.symbol));
 let targets=[];const marketRiskOn=market.price>market.ma200&&market.ma50>market.ma200;
 if(c.accountClass==='taxable-margin'){
  // Fixed, risk-scaled price-factor score. No present-day SEC fundamentals are projected backward.
  const scored=eligible.map(r=>({...r,score:c.kind==='quant-stock-daily'?quantScores.get(r.symbol):(.4*r.mom126+.35*r.mom63+.25*r.mom21)/Math.max(.05,r.vol)})).filter(r=>Number.isFinite(r.score)).sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
  const held=new Set(holdings.map(h=>h.symbol)),retained=scored.filter((r,i)=>held.has(r.symbol)&&i<c.retainThroughRank),ordered=[...retained,...scored.filter(r=>!retained.includes(r))];
  const cap=marketRiskOn?c.grossExposurePct:c.defensiveGrossPct;
  for(const r of ordered.slice(0,c.topN)){const weightPct=Math.min(c.maxPositionPct,cap/c.topN)*Math.min(1,c.targetVolatilityPct/100/r.vol);targets.push({symbol:r.symbol,weightPct,score:r.score});}
 }else{
  targets=eligible.map(r=>({symbol:r.symbol,weightPct:Math.min(r.baseWeight,c.maxPositionPct)*Math.min(1,c.targetVolatilityPct/100/r.vol)}));
  const cap=marketRiskOn?c.grossExposurePct:c.defensiveGrossPct,total=targets.reduce((n,t)=>n+t.weightPct,0);if(total>cap)targets=targets.map(t=>({...t,weightPct:t.weightPct*cap/total}));
 }
 targets=targets.filter(t=>t.weightPct>0).sort((a,b)=>a.symbol.localeCompare(b.symbol));
 return {model:c.kind==='quant-stock-daily'?'quant-stock-daily-v1':'portfolio-daily-v3',signalAsOf:asOf,decisionAsOf:asOf,rebalanceCadence:'completed-session-daily',targets,marketRiskOn,cashWeightPct:100-targets.reduce((n,t)=>n+t.weightPct,0),riskExits:holdings.filter(h=>!targets.some(t=>t.symbol===h.symbol)).map(h=>h.symbol),strategyFingerprint:hash(c),inputFingerprint:hash({rows,quantScores:[...quantScores]}),riskState:{asOf,anchors,stops:datedStops}};
}
module.exports={seriesMaps,factors,signal,volatility};
