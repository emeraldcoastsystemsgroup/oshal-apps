/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Use the explicit published signal and its matching evidence, reject failed rankings, and distinguish saved monthly execution from daily stock assessment.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind stock Quant proposals to saved taxable margin registration; retirement and unclassified accounts require separate models and receive no stock transition.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A dated, owner-kept daily Quant strategy proposal with account comparisons. Review only: no order, mandate, assignment or schedule operation exists in this module.
 */
'use strict';
const {createHash}=require('node:crypto');
const store=require('./store');
const {lastCompletedSession}=require('../trading-portfolio-calendar');
const {PRICE_SIGNALS}=require('./factors');

// Proposed limits, fixed before evaluation. These are not claimed to be profitable or approved.
const RULES=Object.freeze({id:'daily-quant-review-v3',cadence:'daily',rankBy:'published-price-signal',maxPositions:10,maxPositionPct:5,maxIndustryPct:15,maxGrossPct:50,defensiveGrossPct:25,retainThroughRank:30,minDollarVolume:5000000,maxOneDayFallPct:5,maxFromHighPct:20,hardStopPct:5,trailingStopPct:5,maxDailyTurnoverPct:10,borrowing:false,shorting:false});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const measured=n=>typeof n==='number'&&Number.isFinite(n);
const ticker=s=>typeof s==='string'&&/^[A-Z][A-Z0-9.-]{0,9}$/.test(s);
const CASH_RESERVES=new Set(['BIL','SGOV','SHV','USFR']);
const score=(row,rankBy)=>row?.pct?.[rankBy];

/** Price rank alone cannot admit a broken trend, an unclassified industry or missing quality evidence. */
function exclusions(row,rankBy){
 const out=[],f=row?.f||{},fund=row?.fund;
 if(!ticker(row?.symbol)||!measured(row?.price)||row.price<=0)out.push('Verified symbol and positive reference price required');
 if(!rankBy||!measured(score(row,rankBy)))out.push('Complete published ranking signal required');
 if(!measured(f.vsMa200)||!measured(f.vsMa50)||f.vsMa200<=0||f.vsMa50<=0||f.trend!==3)out.push('Price and 50-day trend must be above the 200-day trend');
 if(!measured(f.mom12)||f.mom12<=0||!measured(f.rev1)||f.rev1<=0)out.push('Both the older momentum and the latest month must be positive');
 if(!measured(row?.chg1d)||row.chg1d<=-RULES.maxOneDayFallPct/100)out.push('A fall of 5% or more in the last session blocks a new entry');
 if(!measured(f.fromHigh)||f.fromHigh<=-RULES.maxFromHighPct/100)out.push('A stock 20% or more below its high is outside this trend proposal');
 if(!fund||!measured(fund.netMarginPct)||!measured(fund.revenueYoYPct)||fund.netMarginPct<=0||fund.revenueYoYPct<=0)out.push('Observed positive annual net margin and revenue growth required');
 if(typeof row?.group!=='string'||!row.group||/unknown|unclassified|^other$/i.test(row.group))out.push('A classified industry is required for the concentration cap');
 return out;
}

/** A pure proposal: inputs are completed-session published rows and currently measured accounts. */
function buildReview(today,rows,history,accounts,now=new Date()){
 const expected=lastCompletedSession(now),blockers=[];
 const rankBy=today?.rankBy,knownSignal=PRICE_SIGNALS.some(s=>s.id===rankBy),evidence=history?.signals?.find(s=>s.id===rankBy);
 if(!knownSignal)blockers.push('An explicit supported published price signal is required; no composite fallback is allowed.');
 else if(!evidence||!['Holds up','Promising','Mixed'].includes(evidence.verdict))blockers.push('The published '+rankBy+' signal has failed or insufficient historical comparison; no replacement targets are proposed.');
 if(!today||today.session!==expected)blockers.push('The Quant list must cover the latest completed session, '+expected+'.');
 if(!today||!measured(Date.parse(today.at))||Date.parse(today.at)>now.getTime())blockers.push('A valid observed publication time is required.');
 if(!Array.isArray(rows)||!rows.length||rows.length!==today?.scored||new Set((rows||[]).map(r=>r.symbol)).size!==rows?.length)blockers.push('The complete, duplicate-free published ranking must be available.');
 const ranked=(Array.isArray(rows)?rows:[]).filter(r=>knownSignal&&measured(score(r,rankBy))).slice().sort((a,b)=>score(b,rankBy)-score(a,rankBy)||String(a.symbol).localeCompare(String(b.symbol))).map((r,i)=>({...r,proposalRank:i+1}));
 const bySymbol=new Map(ranked.map(r=>[r.symbol,r]));
 const market=today?.market,regimeKnown=measured(market?.vsMa200)&&measured(market?.above200Pct);
 if(!regimeKnown)blockers.push('Market trend and breadth measurements are required.');
 const grossCap=regimeKnown&&market.vsMa200>0&&market.above200Pct>=50?RULES.maxGrossPct:RULES.defensiveGrossPct;
 const candidate=ranked.filter(r=>!exclusions(r,rankBy).length);
 const comparisons=(accounts||[]).map(account=>{
  const retirement=['401k','ira','roth-ira'].includes(account.registration),eligible=account.registration==='taxable'&&account.accountType==='margin',eligibilityReason=eligible?'Confirmed taxable margin account.':retirement?'Retirement account: use the separate cash-funded retirement strategy; this stock Quant proposal does not apply.':'Confirm taxable registration and broker MARGIN before reviewing this stock strategy.';
  const positions=Array.isArray(account.positions)?account.positions:[],held=new Set(positions.filter(p=>measured(p.qty)&&p.qty>0).map(p=>p.symbol));
  const selected=[],industries=new Map();
  // Hysteresis retains eligible holdings through rank 30, rather than trading every rank shuffle.
  const retained=candidate.filter(r=>held.has(r.symbol)&&r.proposalRank<=RULES.retainThroughRank);
  const ordered=[...retained,...candidate.filter(r=>!retained.includes(r))];
  if(!blockers.length&&eligible)for(const r of ordered){
   if(selected.length>=RULES.maxPositions||(selected.length+1)*RULES.maxPositionPct>grossCap)break;
   const exposure=(industries.get(r.group)||0)+RULES.maxPositionPct;if(exposure>RULES.maxIndustryPct)continue;
   industries.set(r.group,exposure);selected.push(r);
  }
  const proposalAvailable=eligible&&blockers.length===0,equity=measured(account.equity)&&account.equity>0?account.equity:null;
  const targets=selected.map(r=>({symbol:r.symbol,industry:r.group,rank:r.proposalRank,score:score(r,rankBy),weightPct:RULES.maxPositionPct,referencePrice:r.price,referenceShares:equity===null?null:Math.floor(equity*RULES.maxPositionPct/100/r.price),held:held.has(r.symbol)}));
  const targetSet=new Set(targets.map(r=>r.symbol));
  const holdings=positions.map(p=>{const row=bySymbol.get(p.symbol),reserve=CASH_RESERVES.has(p.symbol),reasons=row?exclusions(row,rankBy):['Not ranked in this completed-session Quant snapshot'];return{symbol:p.symbol,quantity:p.qty,marketValue:p.marketValue,rank:row?.proposalRank??null,disposition:!eligible?'Separate account strategy required; no stock transition proposed':blockers.length?'Data incomplete; no transition proposed':reserve?'Cash reserve; separate from stock selection':targetSet.has(p.symbol)?'Retain within proposed limits':'Review exit or reduction',reasons:targetSet.has(p.symbol)||reserve?[]:reasons.length?reasons:['Outside the proposed selection or concentration limits']};});
  return{accountId:account.accountId,connectionKey:account.connectionKey,account:account.accountLabel||account.accountMasked||'Masked account unavailable',registration:account.registration||'unknown',accountType:account.accountType||'unknown',eligible,eligibilityReason,proposalAvailable,observedAt:account.observedAt||null,configuredExecution:account.configuredExecution||null,equity,cash:measured(account.cash)?account.cash:null,grossCapPct:proposalAvailable?grossCap:null,proposedGrossPct:proposalAvailable?targets.length*RULES.maxPositionPct:null,residualCashPct:proposalAvailable?100-targets.length*RULES.maxPositionPct:null,targets,holdings};
 });
 return{ok:true,reviewOnly:true,armed:false,executionAvailable:false,ordersSubmitted:0,name:'Daily stock Quant rotation — taxable margin proposal',rules:{...RULES,rankBy:knownSignal?rankBy:null},generatedAt:now.toISOString(),session:today?.session||null,expectedSession:expected,publicationAt:today?.at||null,sourceFingerprint:digest({today,rows,history}),blockers,candidateCount:candidate.length,accounts:comparisons,
  signalEvidence:evidence?{id:evidence.id,name:evidence.name??null,verdict:evidence.verdict??null,testCadence:'calendar-monthly',annual:evidence.annual??null,maxDrawdown:evidence.maxDrawdown??null,withoutWinners:evidence.withoutWinners??null}:null,
  operatingRules:['Score the full eligible pool after every close; reconsider holdings at the next regular session, never wait for a calendar month.','Stop exits remain independent of ranking and run every minute. Proposed hard stop and trailing stop are each 5%; exact account protection needs its own reviewed terms.','After a protective sale, reconsider the instrument after the next completed session only if a newly dated Quant snapshot passes all entry rules. No same-pass buy-back and no 30-day lock.','Use sell-first, fill-reconciled whole-share orders and measured available cash; no borrowing, shorting or assumed settlement.','Missing or stale scores block new entries and retain independent protection. Uncertain broker orders must reconcile before any new submission.','SEC quality measurements are eligibility evidence. Congress and news feeds annotate review; they cannot silently override a failed price or risk rule.'],
  validation:{readyForLive:false,reasons:['This exact daily strategy has no completed backtest or forward paper record.','The existing monthly signal history test does not validate daily rebalancing, stops or re-entry.','Today’s surviving universe and current SEC fundamentals cannot be projected backward as point-in-time evidence.','Existing approvals remain bound to their saved models. This proposal creates no replacement mandate or account assignment.'],required:['Chronological replay using historical membership and information available at each signal date, next-session fills, costs, slippage and missing-data refusals.','An untouched evaluation period and forward paper comparison against SPY, cash and each account’s current strategy, with drawdown and turnover recorded.','Account-specific transition review, excluded/manual holdings, capital and protection terms before any real-money activation.']}};
}

/** Save a review snapshot only. The one host operation is an owner-admitted account read. */
async function createReview(ctx,sub,now=new Date()){
 const [today,rows,history,broker]=await Promise.all([store.getRecord(ctx.pool,sub,'today','current'),store.getRecord(ctx.pool,sub,'rows','current'),store.getRecord(ctx.pool,sub,'history','current'),ctx.intent('trading.accounts',{})]);
 const portfolioStore=require('../trading-portfolio-store'),[profilesRead,watchesRead]=await Promise.allSettled([portfolioStore.listRecords(ctx,sub,'profile'),portfolioStore.listRecords(ctx,sub,'watch')]);
 const classificationsAvailable=profilesRead.status==='fulfilled',profiles=classificationsAvailable?profilesRead.value:[],watches=watchesRead.status==='fulfilled'?watchesRead.value:[];
 const accounts=(broker.accounts||[]).map(a=>{const p=profiles.find(p=>p.accountId===a.accountId&&p.connectionKey===a.connectionKey),w=watches.find(w=>w.accountId===a.accountId&&w.connectionKey===a.connectionKey),mode=w?.executionMode||null;return {...a,registration:p?.registration||'unknown',accountLabel:p?.label||null,observedAt:broker.readAt||null,configuredExecution:{available:watchesRead.status==='fulfilled',mode,configuredEnabled:w?.enabled===true,configuredAutomated:w?.automatedTrading===true,lastObservedAt:w?.lastReceipt?.observedAt||null,lastObservedStatus:w?.lastReceipt?.status||null,decisionAsOf:w?.lastReceipt?.signal?.decisionAsOf||null,authorityVerified:false,dailyStockQuantConnected:w?.signal?.model==='quant-stock-daily-v1',mismatch:mode==='automatic-monthly'?'Monthly model execution does not consume this daily stock Quant proposal.':null}};});
 const review=buildReview(today,rows,history,accounts,now);
 if(!classificationsAvailable)review.blockers.push('Saved account classifications could not be read; no stock-model transition is proposed.');
 if(broker.errors?.length)review.blockers.push('Some connected accounts could not be read; the review is incomplete.');
 review.reviewId=digest(review);
 await store.putRecord(ctx.pool,sub,'strategy-review',review.reviewId,review,now);
 await store.putRecord(ctx.pool,sub,'strategy-review-index','current',{reviewId:review.reviewId},now);
 return review;
}
module.exports={RULES,exclusions,buildReview,createReview};
