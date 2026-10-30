/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retain exact-owner measured balances and expose account details with explicit value-change and benchmark provenance.
 */
'use strict';
const {PortfolioError,accountKey,measured}=require('./trading-portfolio-model');
const {listRecords}=require('./trading-portfolio-store');
const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const WINDOWS={'1W':7,'1M':31,'3M':93,'1Y':366,'ALL':3650};
/** @description Store only a measured broker observation, atomically keeping the latest per day.
 * @param {object} ctx Admitted native context. @param {string} owner Current owner.
 * @param {object} account Exact account and connection. @param {string} at Actual observation time.
 * @returns {Promise<void>} Persistence completion; no broker mutation. */
async function recordAccountValue(ctx,owner,account,at){
 if(account.kind!=='live'||account.broker!=='schwab'||!accountKey(account)||measured(account.equity)===null||!Number.isFinite(Date.parse(at)))return;
 await ctx.pool.query(`INSERT INTO trading_account_values (user_sub,connection_key,account_id,observed_day,observed_at,equity,cash) VALUES ($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT (user_sub,connection_key,account_id,observed_day) DO UPDATE SET observed_at=EXCLUDED.observed_at,equity=EXCLUDED.equity,cash=EXCLUDED.cash
 WHERE trading_account_values.observed_at < EXCLUDED.observed_at`,[owner,account.connectionKey,account.accountId,day(at),at,account.equity,measured(account.cash)]);
}
/** @description Preserve actual native reads independently of financial authorization.
 * @param {object} ctx Admitted context. @param {string} owner Current owner. @param {object} native Broker read.
 * @returns {Promise<boolean>} Whether every measured observation could be retained. */
async function recordAccountValues(ctx,owner,native){
 const results=await Promise.allSettled(native.accounts.map(a=>recordAccountValue(ctx,owner,a,native.readAt)));
 return results.every(r=>r.status==='fulfilled');
}
async function savedValues(ctx,owner,a,period){
 const rows=(await ctx.pool.query(`SELECT observed_day,observed_at,equity,cash FROM trading_account_values
 WHERE user_sub=$1 AND connection_key=$2 AND account_id=$3 ORDER BY observed_day DESC LIMIT 4000`,[owner,a.connectionKey,a.accountId])).rows;
 const points=rows.map(r=>({date:String(r.observed_day),at:new Date(r.observed_at).toISOString(),value:measured(r.equity),cash:measured(r.cash)})).filter(p=>p.value!==null);
 points.sort((a,b)=>a.at.localeCompare(b.at));
 if(!points.length)return[];
 const end=Date.parse(points.at(-1).at),start=end-WINDOWS[period]*86400000;
 return points.filter(p=>Date.parse(p.at)>=start);
}
async function seedLastObservation(ctx,owner,a){
 const watch=(await listRecords(ctx,owner,'watch')).find(w=>accountKey(w)===accountKey(a));
 const r=watch?.lastReceipt;
 if(r&&accountKey(r)===accountKey(a)&&Number.isFinite(Date.parse(r.observedAt)))
  await recordAccountValue(ctx,owner,{...a,equity:r.accountEquity,cash:r.reportedCash},r.observedAt);
}
async function comparison(ctx,a,symbol,points){
 try{
  const answer=await ctx.intent('trading.bars',{symbol,timeframe:'1Day',connection:a.connectionKey});
  if(answer?.symbol!==symbol||answer.source!=='schwab'||!Array.isArray(answer.bars))throw Error('invalid');
  const prices=new Map();
  for(const bar of answer.bars){
   if(measured(bar.t)===null||measured(bar.c)===null||bar.c<=0)continue;
   const date=new Date(bar.t*1000).toISOString().slice(0,10);
   if(prices.has(date)&&prices.get(date)!==bar.c)throw Error('conflicting');
   prices.set(date,bar.c);
  }
  const matched=points.filter(p=>prices.has(p.date));
  const first=matched[0];
  return {symbol,source:'schwab',status:matched.length>=2&&first.value>0?'available':'insufficient-history',
   points:first?.value>0?matched.map(p=>({...p,accountPct:(p.value/first.value-1)*100,benchmarkPrice:prices.get(p.date),benchmarkPct:(prices.get(p.date)/prices.get(first.date)-1)*100})):[],
   basis:'Account observations and provider daily prices on matching dates. Intraday observation times can differ. Price change excludes benchmark distributions; account value change includes deposits and withdrawals.'};
 }catch{return{symbol,status:'unavailable',points:[],message:'Benchmark prices could not be verified. Account values and holdings remain available.'};}
}
/** @description Register read-only original-owner account detail evidence on the admitted portfolio router.
 * @param {Function} route Authenticated parent route. @param {object} ctx Native context. @param {object} deps Account resolver.
 * @returns {void} Routes registered. */
function registerAccountValueRoutes(route,ctx,deps){
 route('get','/portfolio/account-details',async(req,owner,at)=>{
  const period=req.query.period||'1M',symbol=String(req.query.compare||'SPY').trim().toUpperCase();
  if(typeof period!=='string'||!Object.hasOwn(WINDOWS,period)||!/^[$^A-Z][A-Z0-9.$^-]{0,14}$/.test(symbol))throw new PortfolioError(400,'comparison_invalid','Choose a period and a valid stock, ETF or index symbol.');
  const selected=await deps.selected(owner,{accountId:req.query.accountId,connectionKey:req.query.connectionKey},at);
  const account=selected.report.accounts.find(a=>accountKey(a)===accountKey(selected.account));
  if(account?.kind!=='live'||account.broker!=='schwab')throw new PortfolioError(400,'connected_account_required','Select a connected brokerage account.');
  let points=[],historyAvailable=true;
  try{await recordAccountValue(ctx,owner,account,selected.native.readAt);await seedLastObservation(ctx,owner,account);points=await savedValues(ctx,owner,account,period);}catch{historyAvailable=false;}
  const benchmark=await comparison(ctx,account,symbol,points),first=points[0],last=points.at(-1);
  return {account,readAt:selected.native.readAt,period,history:{available:historyAvailable,points,
   change:points.length>1?last.value-first.value:null,changePct:points.length>1&&first.value>0?(last.value/first.value-1)*100:null,
   basis:'Actual broker account values, including cash and holdings. Last recorded observation each day; not a cash-flow-adjusted investment return.',
   message:!historyAvailable?'Account history could not be read.':points.length<2?'History starts with recorded account observations. Earlier balances are not reconstructed from current holdings.':null},benchmark};
 });
}
module.exports={recordAccountValue,recordAccountValues,registerAccountValueRoutes};
