/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Explicit completed-session end dates, bounded native extended history, and window-scoped source validation; never silently discard an in-window conflict.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-bound combined allocation/backstop comparisons, prior-data selection and continuous later-period evaluation. Reads only supported named market-data intents.
 */
'use strict';
const {PortfolioError,accountKey}=require('../trading-portfolio-model');
const {getRecord,listRecords,saveRecord,fingerprint}=require('../trading-portfolio-store');
const {sessionDates,lastCompletedSession,validDay}=require('../trading-portfolio-calendar');
const {normalizePortfolioStrategy}=require('../trading-portfolio-sim');
const {portfolioStrategySymbols,portfolioWarmupSessions}=require('../trading-portfolio-rotation');
const {dailyBackstopEvidence}=require('./backstop-model');
const {simulateProtectedPortfolio,performance}=require('./protected-model');
const busy=new Set(),DAY=86400000;
const fail=(message,status=422)=>{throw new PortfolioError(status,'combined_research_unavailable',message);};
/** Two bounded, overlapping native windows retain OHLC, verify overlap and never fabricate sessions. */
async function combinedDaily(ctx,connection,symbol,endDate,at,earliestNeeded,{historyDays}={}){
 const anchor=Math.min(at.getTime(),Date.parse(endDate+'T23:59:59.999Z'));
 const ends=[anchor];if(!historyDays&&Date.parse(earliestNeeded)<anchor-380*DAY)ends.push(Math.max(at.getTime()-399*DAY,anchor-350*DAY));
 const rows=new Map();let repeatedReadSnapshots=0,ignoredAfterEnd=0,ignoredBeforeWarmup=0;
 for(const end of ends){
  const result=await ctx.intent('trading.bars',{connection,symbol,timeframe:'1Day',end:Math.floor(end),...(historyDays?{historyDays}:{})});
  if(result?.source!=='schwab'||result.symbol!==symbol||!Array.isArray(result.bars)||result.bars.length>10000)fail(symbol+': the original-owner broker history source is invalid.');
  const pageTimes=new Set();
  for(const b of result.bars){
   if(!b||!Number.isFinite(b.t)||!Number.isFinite(new Date(b.t*1000).getTime()))fail(symbol+': invalid timestamp inside a history page.');
   const day=new Date(b.t*1000).toISOString().slice(0,10);
   if(day>endDate){ignoredAfterEnd++;continue;}
   if(day<earliestNeeded){ignoredBeforeWarmup++;continue;}
   if(pageTimes.has(b.t))fail(symbol+': duplicate or invalid timestamps inside a history page.');
   pageTimes.add(b.t);const old=rows.get(b.t);
   if(old){if(['o','h','l','c'].some(k=>old[k]!==b[k]))fail(symbol+': overlapping broker history changed prices on '+day+'; retry the study.');repeatedReadSnapshots++;}
   else rows.set(b.t,b);
  }
 }
 let evidence;try{evidence=dailyBackstopEvidence([...rows.values()],endDate);}catch(e){if(e instanceof PortfolioError)fail(symbol+': '+e.message);throw e;}
 return{rows:evidence.rows,quality:{...evidence.quality,repeatedReadSnapshots,windows:ends.length,historyDays:historyDays??400,requestedEndDate:endDate,earliestWarmupDate:earliestNeeded,ignoredAfterEnd,ignoredBeforeWarmup}};
}
function summarize(r,startDate,endDate){
 const points=r.curve.filter(p=>p.date>=startDate&&p.date<=endDate),index=r.curve.findIndex(p=>p.date===points[0]?.date);
 if(!points.length)fail('The requested chronological result segment is empty.');
 const capital=index===0?r.startingCapital:r.curve[index-1].equity;
 const events=r.events.filter(e=>e.date>=startDate&&e.date<=endDate);
 const benchmarks=Object.fromEntries(['SPY','DIA'].map(symbol=>[symbol,performance(points.map(p=>({equity:p.benchmarks[symbol]})),index===0?r.startingCapital:r.curve[index-1].benchmarks[symbol])]));
 return{window:{firstSession:points[0].date,lastSession:points.at(-1).date,sessions:points.length},startingEquity:capital,metrics:performance(points,capital),benchmarks,
  costs:{tradingUsd:events.reduce((n,e)=>n+(e.fee||0),0)},tradeCount:events.filter(e=>e.side).length,stopExits:events.filter(e=>e.reason.startsWith('stop-')).length};
}
/** Freeze the training winner before computing any later results. Carry cash, positions and ratchets across the split. */
function compareProtectedPortfolio(config,input,trainingEnd){
 const sessions=sessionDates(input.startDate,input.endDate),split=sessions.indexOf(trainingEnd)+1;
 if(split<60||sessions.length-split<60)fail('Training and later evaluation each need at least 60 sessions.');
 const candidates=[5,8,10,12,15,20].map(trailPct=>{
  const train=simulateProtectedPortfolio(config,{...input,endDate:trainingEnd},{trailPct}),training=summarize(train,input.startDate,trainingEnd);
  return{trailPct,training,score:training.metrics.totalReturnPct/Math.max(5,training.metrics.maxDrawdownPct)};
 });
 const selected=candidates.filter(c=>c.training.metrics.totalReturnPct>0).sort((a,b)=>b.score-a.score||a.training.tradeCount-b.training.tradeCount||a.trailPct-b.trailPct)[0]||null;
 const laterStart=sessions[split];let selectedSimulation=null;
 for(const c of candidates){
  const full=simulateProtectedPortfolio(config,input,{trailPct:c.trailPct});c.later=summarize(full,laterStart,input.endDate);
  if(c===selected)selectedSimulation=full;
 }
 const allocationOnly=simulateProtectedPortfolio(config,input,{trailPct:null});
 return{candidates,selectedTrailPct:selected?.trailPct??null,selectedSimulation,
  comparators:{allocationOnly:{training:summarize(allocationOnly,input.startDate,trainingEnd),later:summarize(allocationOnly,laterStart,input.endDate)},cash:{trainingReturnPct:0,laterReturnPct:0,interestAssumedPct:0}},
  trainingWindow:{startDate:input.startDate,endDate:trainingEnd},laterWindow:{startDate:laterStart,endDate:input.endDate},
  selection:'Six fixed trails ranked only by positive training price return / max(5%, training drawdown), then fewer training trades, then smaller trail. All later results are retained. No later-period selection.',
  continuousEvaluation:true,researchOnly:true,untouchedHoldout:false,brokerOrdersPlaced:0};
}
function registerCombinedResearch(route,ctx,deps){
 route('get','/portfolio/backstops/combined',async(_req,owner,at)=>({latestCompletedSession:lastCompletedSession(at),runs:(await listRecords(ctx,owner,'combined-run')).map(({history,selectedSimulation,...r})=>r)}));
 route('get','/portfolio/backstops/combined/:id',async(req,owner)=>({run:await getRecord(ctx,owner,'combined-run',req.params.id)}));
 route('post','/portfolio/backstops/combined',async(req,owner,at)=>{
  const b=req.body||{};
  if(Object.keys(b).some(k=>!['accountId','connectionKey','strategyId','endDate','book','mode'].includes(k)))fail('Unexpected combined-research fields.',400);
  const selected=await deps.selected(owner,b,at),strategy=await getRecord(ctx,owner,'strategy',b.strategyId);
  if(selected.account.kind!=='live'||selected.profile?.strategyId!==strategy.id)fail('Choose the strategy currently assigned to this connected account.',409);
  const config=normalizePortfolioStrategy(strategy.config);
  if(config.fractionalShares||config.grossExposurePct>100)fail('Choose a whole-share, cash-funded strategy for this combined version.');
  if(!Number.isFinite(selected.account.equity)||selected.account.equity<100)fail('Measured current equity of at least $100 is required for the study scale.');
  const key=owner+':'+accountKey(selected.account);if(busy.has(key))fail('A combined study is already running for this account.',409);busy.add(key);
  try{
   const latest=lastCompletedSession(at),endDate=validDay(b.endDate??latest);
   if(endDate>latest||sessionDates(endDate,endDate).length!==1||Date.parse(endDate+'T23:59:59.999Z')<at.getTime()-399*DAY)fail('Choose a completed NYSE session within the supported broker end-date window.');
   const start=new Date(Date.parse(endDate)-300*DAY).toISOString().slice(0,10),sessions=sessionDates(start,endDate),trainingEnd=sessions[Math.floor(sessions.length/2)-1];
   const earliestNeeded=[new Date(Date.parse(start)-Math.ceil(Math.max(1,portfolioWarmupSessions(config))*1.6+25)*DAY).toISOString().slice(0,10),'2024-01-01'].sort().at(-1);
   const nativeConfig=await ctx.intent('trading.config',{}),maxHistory=nativeConfig?.maxDailyHistoryDays;
   const neededDays=Math.max(400,Math.ceil((Math.min(at.getTime(),Date.parse(endDate+'T23:59:59.999Z'))-Date.parse(earliestNeeded))/DAY)+3);
   const historyDays=Number.isInteger(maxHistory)&&maxHistory>=neededDays&&maxHistory<=4000?neededDays:undefined;
   const symbols=[...new Set([...portfolioStrategySymbols(config),'SPY','DIA'])],history={},dataQuality={};
   const deadline=Date.now()+90000;
   for(let i=0;i<symbols.length;i+=2){
    if(Date.now()>deadline)fail('Combined historical reads exceeded their time budget.',504);
    const batch=await Promise.allSettled(symbols.slice(i,i+2).map(async symbol=>({symbol,...await combinedDaily(ctx,selected.account.connectionKey,symbol,endDate,at,earliestNeeded,{historyDays})})));
    for(const r of batch){if(r.status==='rejected')throw r.reason;history[r.value.symbol]=r.value.rows;dataQuality[r.value.symbol]=r.value.quality;}
   }
   const input={startDate:start,endDate,startingCapital:selected.account.equity,series:history,dailyAllocationNotionalLimitUsd:Math.min(2000000,2*selected.account.equity)};
   const result=compareProtectedPortfolio(config,input,trainingEnd);
   const run=await saveRecord(ctx,owner,'combined-run',{...result,...{accountId:b.accountId,connectionKey:b.connectionKey,strategyId:strategy.id,strategyName:strategy.name,config},
    source:'schwab',sourceReadAt:at.toISOString(),latestCompletedSession:latest,requestedEndDate:endDate,sessionsAfterStudyEnd:sessionDates(endDate,latest).filter(d=>d>endDate).length,history,historyFingerprint:fingerprint(history),configFingerprint:fingerprint(config),dataQuality,
    startingCapital:input.startingCapital,maxAllocationTicketNotionalUsd:50000,dailyAllocationNotionalLimitUsd:input.dailyAllocationNotionalLimitUsd,initialPortfolio:'fresh-cash-study-not-current-legacy-book',currentCongressBasket:!!strategy.universeEvidence,
    executionCompatibility:'Research only: broker stop replacement and continuous intraday ratchets are not established by this daily model.'});
   return{run};
  }finally{busy.delete(key);}
 });
}
module.exports={combinedDaily,compareProtectedPortfolio,summarize,registerCombinedResearch};
