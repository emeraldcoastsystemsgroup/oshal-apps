/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Mark held paper shares on fresh regular-session quotes after a decision is already checked or unchanged, without fills or changes to peak, high-water, daily risk or settlement anchors.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Daily models use persisted holdings/risk state, shared costed sizing and next-session retirement settlement; request bounded extended history from the current clock.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A local paper account can run a saved portfolio strategy: the owner (or the concierge on their behalf) assigns one, and each scheduled pass of a regular session rebalances the simulated book in whole shares to the strategy's current targets (the same portfolioNextTargets the live accounts use) once per new decision. Daily closes and quotes come from read-only Schwab when configured, else the platform archive. No broker order path exists here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Assigning computes the strategy's current targets first and refuses (422 strategy_history_unavailable) when a year of daily prices cannot be read: the archive serves at most 365 days, short of the monthly warmup, so a login without Schwab is told at assignment instead of failing at the open.
 */
'use strict';
const {randomUUID}=require('node:crypto');
const store=require('./store');
const {valuationPlan}=require('./valuation');
const {regularSession,tickWindow,etParts}=require('./market');
const {normalizePortfolioStrategy,portfolioNextTargets}=require('../trading-portfolio-sim');
const {portfolioStrategySymbols}=require('../trading-portfolio-rotation');
const {lastCompletedSession}=require('../trading-portfolio-calendar');
const {getRecord,saveRecord,removeRecord,fingerprint}=require('../trading-portfolio-store');

const KIND='paper-strategy';
const RETRY_MS=30*60000;
const refuse=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const round=(n,d=2)=>Math.round(n*10**d)/10**d;

/**
 * @description The owner's strategy assignment for one paper account, or null.
 * @param {{pool:object}} deps - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} ref - Paper account book_ref.
 * @returns {Promise<object|null>} The assignment.
 */
async function assignmentOf(deps,sub,ref){
 try{return await getRecord({pool:deps.pool},sub,KIND,KIND+':'+fingerprint([sub,ref]));}
 catch(err){if(err&&err.status===404)return null;throw err;}
}

/**
 * @description Assign a saved strategy to one of the owner's paper accounts. The next scheduled pass of a regular
 * session rebalances the account to the strategy's targets; the account's posture engine no longer trades it.
 * @param {{pool:object}} deps - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {{book_ref:string}} book - The owner's paper account (already resolved by owner).
 * @param {string} strategyId - A saved strategy id.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} The assignment.
 */
async function assignStrategy(deps,sub,book,strategyId,now){
 if(typeof strategyId!=='string'||!strategyId)refuse(400,'strategy_required','Name the saved strategy to run.');
 const strategy=await getRecord({pool:deps.pool},sub,'strategy',strategyId);
 const config=normalizePortfolioStrategy(strategy.config),symbols=portfolioStrategySymbols(config);
 // Prove now that the strategy's targets can be computed for this person, so a pass at the open cannot fail on history.
 const pool=require('./books').bookPool(deps.pool,book.book_ref);
 const positions=await store.loadPositions(pool,sub),previous=config.modelVersion===3?(await store.listTicks(pool,sub)).find(t=>t.summary?.daily)?.summary.daily:null;
 const preview=await previewTargets(deps,config,symbols,now,{positions,previous});
 const assignment={bookRef:book.book_ref,strategyId,strategyName:strategy.name,config,symbols,assignedAt:now.toISOString(),preview,lastDecisionAsOf:null,lastCheckedSession:null,lastAttemptAt:null,lastResult:null};
 return saveRecord({pool:deps.pool},sub,KIND,assignment,book.book_ref);
}

/**
 * @description The strategy's current targets from a year of daily closes, or a 422 naming why they cannot be read.
 * @param {{intent:Function}} deps - Kernel intent call.
 * @param {object} config - Normalized strategy.
 * @param {string[]} symbols - Strategy symbols.
 * @param {Date} now - Instant.
 * @returns {Promise<{decisionAsOf:string,targets:Array<object>,priceSource:string}>} The preview.
 */
async function previewTargets(deps,config,symbols,now,{positions=[],previous=null}={}){
 if(typeof deps.intent!=='function')refuse(503,'prices_unavailable','This host has no price service.');
 let schwab=false;try{schwab=(await deps.intent('trading.config',{})).configured===true;}catch{}
 try{
  const series=await dailyCloses(deps.intent,[...new Set([...symbols,'SPY'])],schwab,now),asOf=lastCompletedSession(now);
  const signal=config.modelVersion===3?require('./daily-strategy').decide(config,series,asOf,positions,previous):portfolioNextTargets(config,series,asOf);
  return {decisionAsOf:signal.decisionAsOf,targets:signal.targets,priceSource:schwab?'schwab-read-only':'world-archive'};
 }catch(err){
  refuse(422,'strategy_history_unavailable','This strategy needs a year of daily prices for '+symbols.join(', ')+', which come from your connected Schwab login (read-only), the same data a backtest uses. '+(schwab?'':'No Schwab login is connected. ')+'Details: '+String(err&&err.message||err).slice(0,200));
 }
}

/**
 * @description Remove a paper account's strategy; the account returns to its posture engine.
 * @param {{pool:object}} deps - Package SQL pool.
 * @param {string} sub - Owner.
 * @param {string} ref - book_ref.
 * @returns {Promise<boolean>} Whether one was removed.
 */
async function clearStrategy(deps,sub,ref){
 const held=await assignmentOf(deps,sub,ref);if(!held)return false;
 await removeRecord({pool:deps.pool},sub,KIND,held.id);return true;
}

/**
 * @description Daily closes for the strategy's symbols plus SPY, keyed by symbol as [{date, close}].
 * @param {Function} intent - Kernel intent call.
 * @param {string[]} symbols - Tickers.
 * @param {boolean} schwab - Whether read-only Schwab market data is configured.
 * @returns {Promise<Object<string,Array<{date:string,close:number}>>>} Series.
 */
async function dailyCloses(intent,symbols,schwab,now=new Date()){
 const series={};
 if(schwab){
  // Use the supported extended request, rather than moving end outside the native 400-day bound.
  const nowMs=now.getTime();
  const deadline=Date.now()+90000;
  const readSymbol=async symbol=>{
   if(Date.now()>deadline)throw Error('Historical reads exceeded their time budget.');
   const data=await intent('trading.bars',{symbol,timeframe:'1Day',end:Math.floor(nowMs),historyDays:800}),rows=new Map();
   if(data.source!=='schwab'||data.symbol!==symbol||!Array.isArray(data.bars)||data.bars.length>10000)throw Error(symbol+' daily history is unavailable.');
   for(const b of data.bars){
    if(!Number.isFinite(b.c)||b.c<=0||!Number.isFinite(b.t))throw Error(symbol+' has invalid daily evidence.');
    const date=new Date(b.t*1000).toISOString().slice(0,10),old=rows.get(date);
    if(old!==undefined&&old!==b.c)throw Error(symbol+' daily evidence changed.');
    rows.set(date,b.c);
   }
   series[symbol]=[...rows].sort(([a],[b])=>a.localeCompare(b)).map(([date,close])=>({date,close}));
  };
  for(let i=0;i<symbols.length;i+=2){const results=await Promise.allSettled(symbols.slice(i,i+2).map(readSymbol));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}
  return series;
 }
 const answer=await intent('prices.series',{symbols,interval:'day',days:365});
 for(const symbol of symbols){
  const points=(answer&&answer.series&&answer.series[symbol])||[];
  series[symbol]=points.filter(p=>Number(p.price)>0&&p.bucket).map(p=>({date:String(p.bucket).slice(0,10),close:Number(p.price)}));
 }
 return series;
}

/**
 * @description Current trade prices for the symbols, or the reason none can be priced.
 * @param {Function} intent - Kernel intent call.
 * @param {string[]} symbols - Tickers.
 * @param {boolean} schwab - Whether read-only Schwab quotes are configured.
 * @returns {Promise<Map<string,{price:number,at:string}>>} Prices.
 */
async function currentPrices(intent,symbols,schwab){
 const out=new Map();
 if(schwab){
  const answer=await intent('trading.quotes',{symbols});
  for(const q of (answer&&answer.quotes)||[])if(symbols.includes(q.symbol)&&Number(q.tradePrice)>0)out.set(q.symbol,{price:Number(q.tradePrice),at:q.tradeAt||null});
  return out;
 }
 const answer=await intent('prices.latest',{symbols});
 for(const p of (answer&&answer.prices)||[]){const s=String(p.symbol||'').toUpperCase();if(symbols.includes(s)&&Number(p.price)>0)out.set(s,{price:Number(p.price),at:p.at||null});}
 return out;
}

/**
 * @description The whole-share rebalance from the current book to the target weights: sells first, then buys
 * largest weight first within the cash they leave. Pure; prices must cover every held and target symbol.
 * @param {{cash:number,highWater:number}} account - Book account.
 * @param {Array<object>} positions - Current positions.
 * @param {Array<{symbol:string,weightPct:number}>} targets - Target weights.
 * @param {Map<string,{price:number,at:string}>} prices - Trade prices.
 * @param {string} name - Strategy name for the fill reason.
 * @returns {{fills:Array<object>,positions:Array<object>,cash:number,equity:number,highWater:number}} The plan.
 */
function rebalancePlan(account,positions,targets,prices,name){
 const held=new Map(positions.map(p=>[p.symbol,{...p}]));
 const equity=round(account.cash+positions.reduce((s,p)=>s+p.qty*prices.get(p.symbol).price,0));
 const want=new Map(targets.filter(t=>t.weightPct>0).map(t=>[t.symbol,Math.floor(equity*t.weightPct/100/prices.get(t.symbol).price)]));
 const fills=[];let cash=account.cash;
 const fill=(symbol,side,qty,realizedPl)=>{const q=prices.get(symbol);fills.push({symbol,side,qty,price:q.price,notional:round(qty*q.price),reason:'Strategy rebalance: '+name,realizedPl,quoteAt:q.at,
  decision:{action:side,reason:'Strategy rebalance: '+name,score:null,confidence:null,regime:null,rationale:'Target weight from the saved strategy '+name+'.',perTimeframe:[]}});};
 for(const [symbol,p] of held){
  const sell=p.qty-(want.get(symbol)||0);if(sell<=0)continue;
  const price=prices.get(symbol).price,realized=round((price-p.avgCost)*sell);
  fill(symbol,'sell',sell,realized);cash=round(cash+sell*price);
  if(sell===p.qty)held.delete(symbol);else held.set(symbol,{...p,qty:p.qty-sell});
 }
 for(const t of [...targets].sort((a,b)=>b.weightPct-a.weightPct)){
  const price=prices.get(t.symbol)?.price;if(!price)continue;
  const have=held.get(t.symbol)?.qty||0,buy=Math.min((want.get(t.symbol)||0)-have,Math.floor(cash/price));
  if(buy<=0)continue;
  fill(t.symbol,'buy',buy,null);cash=round(cash-buy*price);
  const p=held.get(t.symbol);
  held.set(t.symbol,p?{...p,qty:p.qty+buy,avgCost:round((p.avgCost*p.qty+price*buy)/(p.qty+buy),4)}:{symbol:t.symbol,qty:buy,avgCost:price,peak:price,openedAt:null});
 }
 const out=[...held.values()].map(p=>({symbol:p.symbol,qty:p.qty,avgCost:p.avgCost,currentPrice:prices.get(p.symbol).price,lastPriceAt:prices.get(p.symbol).at,peak:p.peak,openedAt:p.openedAt}));
 const after=round(cash+out.reduce((s,p)=>s+p.qty*p.currentPrice,0));
 return {fills,positions:out,cash,equity:after,highWater:Math.max(account.highWater||0,equity,after)};
}

/**
 * @description Mark an already-decided strategy book using fresh quotes, retaining its committed daily anchor.
 * @param {object} deps - Book-scoped SQL and read-only market intent.
 * @param {string} sub - Owner.
 * @param {object} state - Account, positions, assignment, committed anchor, prior summary and market source.
 * @param {object} opts - Pass provenance and clock.
 * @param {object|null} signal - Already-computed unchanged monthly signal, when present.
 * @returns {Promise<object>} Atomic valuation receipt or the original write fence refusal.
 */
async function valueStrategy(deps,sub,state,opts,signal=null){
 const {account,config,positions,assignment,committed,prior,schwab}=state,{now}=opts;
 const symbols=[...new Set(positions.map(p=>p.symbol))];
 const prices=symbols.length?await currentPrices(deps.intent,symbols,schwab):new Map();
 const summary={strategy:assignment.strategyName,strategyId:assignment.strategyId,decisionAsOf:signal?.decisionAsOf||assignment.lastDecisionAsOf||committed?.decisionAsOf||null,
  ...(signal?{targets:signal.targets}:Array.isArray(prior?.targets)?{targets:prior.targets}:{}),priceSource:schwab?'schwab-read-only':'world-archive',valuationOnly:true,...(committed?{daily:committed}:{})};
 const plan=valuationPlan(account,positions,prices,now,config.maxQuoteAgeMinutes,summary),window=tickWindow(now);
 const result=await store.writeTick(deps.pool,sub,{window,trigger:opts.trigger,runId:opts.runId,at:now.toISOString(),sessionDate:etParts(now).date,plan,account,ids:[],previousSymbols:symbols});
 return result.written?{ok:true,window,valuationOnly:true,strategy:assignment.strategyName,orders:[]}:{skipped:result.reason,window};
}

/**
 * @description Read targets at most once per session; a new decision alone can rebalance. Other regular-session
 * passes refresh held-share values without changing decisions, fills or risk state. Failed reads retry after 30 minutes.
 * @param {object} deps - Book-scoped pool, intent and optional id source.
 * @param {object} root - Owner assignment pool.
 * @param {string} sub - Owner.
 * @param {object} assignment - Stored assignment.
 * @param {object} opts - Pass provenance and clock.
 * @returns {Promise<object>} Pass receipt.
 */
async function runStrategyTick(deps,root,sub,assignment,opts){
 const {now}=opts,session=etParts(now).date,window=tickWindow(now),checked=assignment.lastCheckedSession===session;
 const [account,config]=await Promise.all([store.loadAccount(deps.pool,sub),store.loadConfig(deps.pool,sub)]);
 if(!account||!config||!config.armed)return {skipped:'not_armed'};
 if(!regularSession(now))return {skipped:'market_closed',window};
 if((!checked||String(assignment.lastResult).startsWith('failed:'))&&assignment.lastAttemptAt&&now.getTime()-Date.parse(assignment.lastAttemptAt)<RETRY_MS)return {skipped:'retry_later',window};
 const {id,createdAt,...stored}=assignment,keep=patch=>saveRecord(root,sub,KIND,{...stored,...patch},assignment.bookRef);
 try{
  let schwab=false;try{schwab=(await deps.intent('trading.config',{})).configured===true;}catch{}
  const symbols=[...new Set([...assignment.symbols,'SPY'])],daily=assignment.config.modelVersion===3;
  const [positions,ticks]=await Promise.all([store.loadPositions(deps.pool,sub),store.listTicks(deps.pool,sub)]);
  const committed=daily?ticks.find(t=>t.summary?.daily)?.summary.daily:null,prior=ticks.find(t=>t.summary?.strategyId===assignment.strategyId)?.summary;
  if(committed?.session>session)throw Error('This paper account has future daily state.');
  const state={account,config,positions,assignment,committed,prior,schwab};
  if(checked||committed?.session===session){
   const marked=await valueStrategy(deps,sub,state,opts);
   if(marked.ok&&String(assignment.lastResult).startsWith('failed:'))await keep({lastResult:'current'});
   return marked;
  }
  const series=await dailyCloses(deps.intent,symbols,schwab,now),asOf=lastCompletedSession(now);
  const signal=daily?require('./daily-strategy').decide(assignment.config,series,asOf,positions,committed):portfolioNextTargets(assignment.config,series,asOf);
  if(assignment.lastDecisionAsOf===signal.decisionAsOf){
   const marked=await valueStrategy(deps,sub,state,opts,signal);
   if(marked.ok)await keep({lastCheckedSession:session,lastAttemptAt:now.toISOString(),lastResult:'current'});
   return {...marked,unchanged:signal.decisionAsOf};
  }
  const needed=[...new Set([...positions.map(p=>p.symbol),...signal.targets.map(t=>t.symbol),...(daily?assignment.symbols:[])])];
  const prices=await currentPrices(deps.intent,needed,schwab);
  const unpriced=needed.filter(s=>!prices.has(s));
  if(unpriced.length)throw Error('No current price for '+unpriced.join(', ')+'.');
  for(const [symbol,q] of prices)if(!Number.isFinite(Date.parse(q.at))||now-Date.parse(q.at)>config.maxQuoteAgeMinutes*60000||Date.parse(q.at)>now.getTime()+60000)throw Error('No fresh current price for '+symbol+'.');
  const plan=daily?require('./daily-strategy').planDaily(account,positions,signal,prices,assignment,committed,session):rebalancePlan(account,positions,signal.targets,prices,assignment.strategyName);
  plan.summary={strategy:assignment.strategyName,strategyId:assignment.strategyId,decisionAsOf:signal.decisionAsOf,targets:signal.targets,priceSource:schwab?'schwab-read-only':'world-archive',...(daily?{daily:plan.daily}:{})};
  const newId=deps.newId||randomUUID,ids=plan.fills.map(()=>({orderId:newId(),decisionId:newId()}));
  const result=await store.writeTick(deps.pool,sub,{window,trigger:opts.trigger,runId:opts.runId,at:now.toISOString(),sessionDate:session,plan,account,ids,previousSymbols:positions.map(p=>p.symbol)});
  if(!result.written)return {skipped:result.reason,window};
  await keep({lastDecisionAsOf:signal.decisionAsOf,lastCheckedSession:session,lastAttemptAt:now.toISOString(),lastResult:'rebalanced'});
  return {ok:true,window,strategy:assignment.strategyName,decisionAsOf:signal.decisionAsOf,orders:plan.fills.map(f=>({symbol:f.symbol,side:f.side,qty:f.qty,fillPrice:f.price}))};
 }catch(err){
  const message=String(err&&err.message||err).slice(0,300);
  await keep({lastAttemptAt:now.toISOString(),lastResult:'failed: '+message});
  return {error:'strategy_pass_failed',message,window};
 }
}

module.exports={assignmentOf,assignStrategy,previewTargets,clearStrategy,rebalancePlan,runStrategyTick,dailyCloses,KIND};
