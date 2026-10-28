/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Identify the exact session and conflicting timestamps in an OHLC refusal.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Ratcheting position backstops and a causal OHLC Donchian/SMA challenger simulation. Pure research; no brokerage I/O.
 */
'use strict';
const {PortfolioError}=require('../trading-portfolio-model');
const {sessionDates}=require('../trading-portfolio-calendar');
const fail=message=>{throw new PortfolioError(422,'backstop_invalid',message);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function backstopPolicy(raw){
 if(!raw||Object.keys(raw).some(k=>!['modelVersion','trailPct','transactionCostBps','reentry'].includes(k)))fail('Use the supported moving-backstop fields.');
 if(![1,2].includes(raw.modelVersion)||!finite(raw.trailPct)||raw.trailPct<0.5||raw.trailPct>50||!finite(raw.transactionCostBps)||raw.transactionCostBps<0||raw.transactionCostBps>100)fail('Choose a trail from0.5% to50% and modeled one-way costs from0 to100bps.');
 if(raw.modelVersion===2?raw.reentry!=='none':raw.reentry!==undefined)fail('Version2 exits to cash with no automatic reentry; version1 retains its original Donchian/SMA research rules.');
 return{modelVersion:raw.modelVersion,trailPct:raw.trailPct,transactionCostBps:raw.transactionCostBps,...(raw.modelVersion===2?{reentry:'none'}:{})};
}
/** A quantity change or earlier timestamp cannot silently reset a previously ratcheted stop. */
function advanceBackstop(previous,{price,observedAt,quantity},raw){
 const policy=backstopPolicy(raw),at=Date.parse(observedAt);
 if(!finite(price)||price<=0||!finite(quantity)||quantity<=0||!Number.isFinite(at))fail('A positive measured price, long quantity and observation time are required.');
 if(previous&&(previous.trailPct!==policy.trailPct||previous.quantity!==quantity))return{...previous,status:'review-required',reason:'Position quantity or trail changed; review reenrollment before changing its backstop.'};
 if(previous&&at<Date.parse(previous.observedAt))return{...previous,ignoredEarlierObservation:true};
 const peak=Math.max(previous?.peak||price,price),stop=Math.max(previous?.stop||0,peak*(1-policy.trailPct/100));
 const crossing=price<=stop,first=crossing&&!previous?.triggeredAt;
 return{quantity,trailPct:policy.trailPct,peak,stop,observedAt,enrolledAt:previous?.enrolledAt||observedAt,triggered:!!previous?.triggered||crossing,
  ...(first?{triggeredAt:observedAt,triggerPrice:price,triggerStop:stop,triggerPeak:peak,triggerQuantity:Math.floor(quantity)}:previous?.triggeredAt?{triggeredAt:previous.triggeredAt,triggerPrice:previous.triggerPrice,triggerStop:previous.triggerStop,triggerPeak:previous.triggerPeak,triggerQuantity:previous.triggerQuantity}:{}),
  status:previous?.triggered||price<=stop?'model-triggered':'model-watching',brokerOrderPlaced:false};
}
/** Reject fabricated candles, missing NYSE sessions and unfinished daily observations. */
function dailyBackstopBars(raw,latest){
 return dailyBackstopEvidence(raw,latest).rows;
}
/** Distinct same-session broker snapshots may repeat identical prices; conflicting prices stay a refusal. */
function dailyBackstopEvidence(raw,latest){
 if(!Array.isArray(raw)||raw.length>10000)fail('Daily OHLC history is missing or exceeds its bound.');
 const byDay=new Map(),times=new Map(),equivalentSnapshots=[];
 for(const b of raw){
  if(!b||!finite(b.t))fail('Daily history has an invalid timestamp.');
  const timestamp=new Date(b.t*1000);if(!Number.isFinite(timestamp.getTime()))fail('Daily history has an invalid timestamp.');
  const day=timestamp.toISOString().slice(0,10);if(day>latest)continue;
  if(!['o','h','l','c'].every(k=>finite(b[k])&&b[k]>0)||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.h<b.l)fail('Daily OHLC values are invalid or duplicated.');
  const previous=byDay.get(day);
  if(previous){
   if(times.get(day).has(b.t)||previous.open!==b.o||previous.high!==b.h||previous.low!==b.l||previous.close!==b.c)fail('Daily OHLC values conflict or their timestamp is duplicated on '+day+' ('+[...times.get(day)].join(',')+' vs '+b.t+').');
   equivalentSnapshots.push({date:day,timestamp:b.t,pricesIdentical:true});times.get(day).add(b.t);continue;
  }
  times.set(day,new Set([b.t]));
  byDay.set(day,{date:day,open:b.o,high:b.h,low:b.l,close:b.c});
 }
 const rows=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
 if(rows.length<80||rows.at(-1).date!==latest)fail('At least80 complete daily candles through the last completed session are required.');
 const required=sessionDates(rows[0].date,latest);if(required.some(d=>!byDay.has(d)))fail('Daily history is missing a required NYSE session.');
 return{rows,quality:{equivalentSnapshots,coalescedSnapshots:equivalentSnapshots.length,conflictingSnapshots:'refused',exactTimestampDuplicates:'refused'}};
}
function wilderAtr(rows,period=14){
 if(rows.length<period+1)return null;
 const ranges=rows.slice(1).map((r,i)=>Math.max(r.high-r.low,Math.abs(r.high-rows[i].close),Math.abs(r.low-rows[i].close)));
 let atr=ranges.slice(0,period).reduce((a,b)=>a+b,0)/period;
 for(const range of ranges.slice(period))atr=(atr*(period-1)+range)/period;
 return atr;
}
/** The prior stop is tested before today's high can raise tomorrow's stop. Gaps fill at the lower open. */
function simulateBackstop(rows,raw,{startDate,endDate,capital=10000}={}){
 const policy=backstopPolicy(raw),first=rows.findIndex(r=>r.date>=startDate);let last=rows.length-1;while(last>=0&&rows[last].date>endDate)last--;
 if(first<50||last-first<59||!finite(capital)||capital<100)fail('Choose at least60 priced sessions after50 warmup sessions and capital of at least$100.');
 let cash=capital,qty=0,peak=null,stop=null,pending=true,fees=0,tradeCount=0,benchmarkQty=0,benchmarkCash=capital,previous=capital,highest=capital,drawdown=0;
 const curve=[],trades=[],cost=policy.transactionCostBps/10000;
 for(let i=first;i<=last;i++){
  const r=rows[i];let exited=false;
  if(pending&&qty===0){qty=Math.floor(cash/(r.open*(1+cost)));if(qty){const fee=qty*r.open*cost;cash-=qty*r.open+fee;fees+=fee;tradeCount++;peak=r.open;stop=peak*(1-policy.trailPct/100);trades.push({date:r.date,side:'buy',quantity:qty,price:r.open,signalDate:rows[i-1].date});}pending=false;}
  if(i===first){benchmarkQty=Math.floor(capital/(r.open*(1+cost)));benchmarkCash-=benchmarkQty*r.open*(1+cost);}
  if(qty>0&&r.low<=stop){const price=Math.min(r.open,stop),fee=qty*price*cost;cash+=qty*price-fee;fees+=fee;tradeCount++;trades.push({date:r.date,side:'sell',quantity:qty,price,priorStop:stop});qty=0;peak=null;stop=null;exited=true;}
  if(qty>0){peak=Math.max(peak,r.high);stop=Math.max(stop,peak*(1-policy.trailPct/100));}
  // A completed-session20-day Donchian breakout plus50-session SMA schedules next-open entry.
  if(!qty&&!exited&&policy.modelVersion===1){const prior=rows.slice(i-20,i),sma=rows.slice(i-49,i+1).reduce((n,x)=>n+x.close,0)/50;pending=r.close>Math.max(...prior.map(x=>x.high))&&r.close>sma;}
  const equity=cash+qty*r.close;highest=Math.max(highest,equity);drawdown=Math.max(drawdown,(1-equity/highest)*100);
  if(cash< -1e-7||qty<0||!Number.isInteger(qty)||!finite(equity))fail('Simulation cash/share accounting failed.');
  curve.push({date:r.date,equity,cash,qty,stop,benchmark:benchmarkCash+benchmarkQty*r.close,dailyReturn:equity/previous-1});previous=equity;
 }
 return{researchOnly:true,realOrdersPlaced:0,policy,window:{first:rows[first].date,last:rows[last].date,sessions:curve.length},startingCapital:capital,
  metrics:{returnPct:(previous/capital-1)*100,maxDrawdownPct:drawdown,benchmarkReturnPct:(curve.at(-1).benchmark/capital-1)*100},fees,tradeCount,trades,curve,
  assumptions:[policy.modelVersion===1?'Initial whole-share entry at first open from cash; later entries follow a completed20-day Donchian breakout and50-session SMA filter.':'Initial whole-share holding at first open; a protective exit leaves cash with no automatic reentry. Purchases require separate account-strategy authority.','Prior stop only; gap-through fills at lower open; today high raises tomorrow stop. Intraday ordering and real bid triggers are not reconstructed.','Daily price-only simulation excludes distributions, taxes and borrowings. Stops can fill below their trigger and do not guarantee a loss ceiling.']};
}
module.exports={backstopPolicy,advanceBackstop,dailyBackstopBars,dailyBackstopEvidence,wilderAtr,simulateBackstop};
