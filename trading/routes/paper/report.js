/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include all connected accounts' broker execution recaps and separate daily local-paper fills; preserve explicit history and accounting gaps.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve an optional private native Video clip reference per owner; external URLs are refused and footage remains separate from current narration.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Native evidence-backed OSHAL report, including local paper results and retained research. No desktop worker, publication, orders or model spend.
 */
'use strict';
const {randomUUID}=require('node:crypto');
const store=require('./store'),books=require('./books');
const {etParts}=require('./market');
const {brokerActivity,paperActivity}=require('./report-activity');
const SQL={
 list:'SELECT report_id,session_date,payload,created_at FROM trading_oshal_reports WHERE user_sub=$1 ORDER BY created_at DESC LIMIT 30',
 get:'SELECT report_id,session_date,payload,created_at FROM trading_oshal_reports WHERE user_sub=$1 AND report_id=$2',
 insert:'INSERT INTO trading_oshal_reports (user_sub,report_id,session_date,payload,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_sub,report_id) DO NOTHING',
 preferences:'SELECT presenter_name,presenter_video_url FROM trading_report_preferences WHERE user_sub=$1',
 savePreferences:'INSERT INTO trading_report_preferences (user_sub,presenter_name,presenter_video_url,updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (user_sub) DO UPDATE SET presenter_name=EXCLUDED.presenter_name,presenter_video_url=EXCLUDED.presenter_video_url,updated_at=EXCLUDED.updated_at',
};
const money=n=>n==null?'unavailable':Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=n=>n==null?'unavailable':`${Number(n).toFixed(2)}%`;
const round=n=>Math.round(n*100)/100;
function paperRow(label,account,config,ticks,positions,archived=false){
 if(!account)return null;
 const unrealized=positions.reduce((s,p)=>s+((p.lastPrice??p.avgCost)-p.avgCost)*p.qty,0);
 return {label,posture:config?.posture||'unknown',armed:Boolean(config?.armed)&&!archived,archived,
  equity:account.equity,cash:account.cash,startingCash:account.startingCash,realizedPl:account.realizedPl,unrealizedPl:round(unrealized),
  returnPct:account.startingCash>0?round((account.equity/account.startingCash-1)*100):null,
  drawdownPct:account.highWater>0?round(Math.max(0,1-account.equity/account.highWater)*100):null,
  startedAt:new Date(account.createdAt).toISOString(),lastTickAt:ticks[0]?.created_at||null,lastOutcome:ticks[0]?.outcome||null,
  halted:Boolean(ticks[0]?.summary?.halted),priceSource:ticks[0]?.summary?.priceSource||'world-archive',
  missing: ticks[0]?.summary?.missing||[],positions:positions.map(p=>({symbol:p.symbol,qty:p.qty,avgCost:p.avgCost,lastPrice:p.lastPrice,priceAt:p.lastPriceAt})),simulated:true};
}
async function paperRows(ctx,owner,now=new Date()){
 const refs=[{book_ref:'paper',label:'Paper reference',archived:false},...await books.listBooks(ctx.pool,owner)],rows=[];
 for(const b of refs){
  const pool=b.book_ref==='paper'?ctx.pool:books.bookPool(ctx.pool,b.book_ref);
  const [account,config,ticks,positions,executions]=await Promise.all([store.loadAccount(pool,owner),store.loadConfig(pool,owner),store.listTicks(pool,owner),store.loadPositions(pool,owner),pool.query(store.SQL.REPORT_ORDERS,[owner,etParts(now).date+'T00:00:00.000Z',now.toISOString()]).catch(()=>({rows:[],unavailable:true}))]);
  const row=paperRow(b.label,account,config,ticks,positions,b.archived===true||b.archived==='t');
  if(row){const orders=executions.rows.slice(0,10000).map(o=>({...o,qty:Number(o.qty),fill_price:Number(o.fill_price),notional:Number(o.notional),realized_pl:o.realized_pl==null?null:Number(o.realized_pl)}));rows.push({...row,bookRef:b.book_ref,activity:executions.unavailable?{status:'unavailable',simulated:true,exceptions:['Daily paper executions could not be read. No zero-trade day is inferred.']}:paperActivity(orders,now,{truncated:executions.rows.length>=10000})});}
 }
 return rows;
}
function composeReport({now,presenter,presenterVideoUrl=null,paper,live,errors=[]}){
 const sessionDate=etParts(now).date;
 const activePaper=paper.filter(r=>!r.archived),liveTotal=live.length?round(live.reduce((s,r)=>s+(Number.isFinite(r.equity)?r.equity:0),0)):null;
 const paperTotal=activePaper.length?round(activePaper.reduce((s,r)=>s+r.equity,0)):null;
 const headlines=[`${live.length} connected real accounts · ${money(liveTotal)} current equity.`,`${activePaper.length} active local paper accounts · ${money(paperTotal)} simulated equity.`];
 const tradeRecap=live.map(r=>`${r.label}: ${r.activity?.status==='unavailable'||!r.activity?'broker trade history unavailable':`${r.activity.today.fills} executions across ${r.activity.today.orders} orders today; buys ${money(r.activity.today.buyGross)}, sells ${money(r.activity.today.sellGross)}, before fees. ${r.activity.status==='partial'?'History has exceptions.':''}`}`);
 headlines.push(`${live.reduce((n,r)=>n+(r.activity?.today?.fills||0),0)} reported real executions today across the connected accounts; paper executions are separate.`);
 const narration=[`This is the OSHAL report for ${sessionDate}. I'm ${presenter}.`,...headlines,
  'Real trading activity across every connected account, including trades placed outside OSHAL:',...tradeRecap,
  ...activePaper.map(r=>`${r.label}: ${money(r.equity)} simulated equity, ${pct(r.returnPct)} since its ${r.startedAt.slice(0,10)} start. Realized result ${money(r.realizedPl)}. ${r.halted?'The drawdown breaker has halted entries.':r.armed?'The simulation is armed; schedule activation and fresh prices are still required.':'The simulation is stopped.'}`),
  ...live.map(r=>`${r.label}: ${money(r.equity)} current equity. ${r.strategyName?'Assigned research: '+r.strategyName+'.':'No strategy assignment was found.'} ${r.authority==='active'?'Native strategy authority is active.':'Native strategy authority: '+r.authority+'.'} Watcher exit authority: ${r.protectionAuthority}.`),
  'Backtests are historical simulations, not live results or a forecast. A balance snapshot is not a measured investment return. Missing prices, stale checks and unavailable accounts remain exceptions.',
  ...errors].join('\n\n');
 return {version:2,title:'The OSHAL report',presenter,presenterVideoUrl,sessionDate,generatedAt:now.toISOString(),headlines,live,paper,errors,narration,
  private:true,published:false,ordersPlaced:false,
  limitations:['Paper fills are simulated at observed prices; they do not reproduce broker queueing, slippage, dividends, taxes or borrowing.','Real executions include manual and OSHAL trades from the broker read. Its 60-day order-entry window can omit older standing orders; unavailable, complex or unreconciled executions remain explicit exceptions.','Real trade gross is before fees; tax-lot realized profit, contract multipliers and lifetime performance are unavailable. Live balances, deposits and withdrawals are not reconstructed into a total-return series.','Research metrics retain their exact test windows and costs. They do not establish future performance.'],
  storyboard:[{title:'Market desk',text:headlines.join('\n')},{title:'All real-account trades',text:tradeRecap.join('\n')||'Real trade history unavailable.'},{title:'Local paper results',text:activePaper.map(r=>`${r.label}: ${money(r.equity)} · ${pct(r.returnPct)} since ${r.startedAt.slice(0,10)}; ${r.activity?.today?.fills||0} simulated executions today.`).join('\n')||'No local paper account has started.'},{title:'Real accounts and strategies',text:live.map(r=>`${r.label}: ${r.strategyName||'unassigned'} · strategy ${r.authority} · watcher exits ${r.protectionAuthority}`).join('\n')||'Real account reads unavailable.'},{title:'Checks and exceptions',text:errors.join('\n')||'Review the account checks, source timestamps and research windows below.'}]};
}
async function liveRows(ctx,owner,now){
 const {portfolioSnapshot}=require('../trading-portfolio-routes'),{listRecords}=require('../trading-portfolio-store');
 const [snapshot,watches,policies,strategies,runs]=await Promise.all([portfolioSnapshot(ctx,owner,now),listRecords(ctx,owner,'watch'),listRecords(ctx,owner,'backstop-policy'),listRecords(ctx,owner,'strategy'),listRecords(ctx,owner,'run')]);
 const rows=[];
 for(const account of snapshot.native.accounts){
  const match=r=>r.accountId===account.accountId&&r.connectionKey===account.connectionKey;
  const profile=snapshot.profiles.find(match),watch=watches.find(match),policy=policies.find(match),strategy=strategies.find(r=>r.id===profile?.strategyId),study=runs.filter(r=>match(r)&&r.strategyId===strategy?.id&&r.status==='completed').sort((a,b)=>String(b.result?.window?.lastSession||b.result?.window?.endDate||'').localeCompare(String(a.result?.window?.lastSession||a.result?.window?.endDate||''))||(b.result?.window?.sessions||0)-(a.result?.window?.sessions||0)||String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  let authority='off',protectionAuthority='off';
  const bound={connection:account.connectionKey,accountId:account.accountId};
  let activity;
  try{const answer=await ctx.intent('trading.orders.list',bound);if(answer.accountId!==account.accountId)throw Error('Broker history account mismatch.');activity=brokerActivity(answer,now);}
  catch{activity={status:'unavailable',source:'schwab',exceptions:['Broker execution history could not be verified for this account. No zero-trade day is inferred.']};}
  if(watch?.mandateId){try{const answer=await ctx.intent('trading.orders.mandate.status',{...bound,mandateId:watch.mandateId});authority=require('../live/execution-state').mandateAuthority(answer,now).status;}catch{authority='unavailable';}}
  if(policy?.protectionMandateId){try{const answer=await ctx.intent('trading.orders.protection.status',{...bound,protectionMandateId:policy.protectionMandateId});protectionAuthority=require('../live/execution-state').mandateAuthority(answer,now).status;}catch{protectionAuthority='unavailable';}}
  rows.push({label:profile?.label||account.label||account.accountMasked,equity:account.equity,cash:account.cash,readAt:snapshot.native.readAt,positions:account.positions.map(p=>({symbol:p.symbol,qty:p.qty,marketValue:p.marketValue})),strategyName:strategy?.name||null,authority,protectionAuthority,lastWatcherAt:watch?.lastGuardAt||watch?.lastRunAt||null,activity,
   research:study?{window:study.result?.window,metrics:study.result?.metrics,costs:study.result?.costs,createdAt:study.createdAt}:null});
 }
 return {rows,errors:snapshot.native.errors.map(r=>r.message||'Connected account unavailable.')};
}
async function generateReport(ctx,owner,now,{scheduled=false,readLive=liveRows}={}){
 const reportId=scheduled?'daily-'+etParts(now).date:randomUUID();
 if(scheduled){const row=(await ctx.pool.query(SQL.get,[owner,reportId])).rows[0];if(row)return {...JSON.parse(row.payload),reportId};}
 const [paper,prefs]=await Promise.all([paperRows(ctx,owner,now),ctx.pool.query(SQL.preferences,[owner])]);
 let live={rows:[],errors:[]};try{live=await readLive(ctx,owner,now);}catch{live.errors.push('Connected real-account evidence could not be read. No live results are inferred.');}
 const report=composeReport({now,presenter:prefs.rows[0]?.presenter_name||'OSHAL market desk',presenterVideoUrl:prefs.rows[0]?.presenter_video_url||null,paper,live:live.rows,errors:live.errors});
 await ctx.pool.query(SQL.insert,[owner,reportId,report.sessionDate,JSON.stringify(report),now.toISOString()]);
 return {...report,reportId};
}
async function listReports(pool,owner){return (await pool.query(SQL.list,[owner])).rows.map(r=>({...JSON.parse(r.payload),reportId:r.report_id}));}
async function savePreferences(pool,owner,body,now){
 const name=String(body?.presenterName||'').trim();if(!name||name.length>80)throw Object.assign(new Error('Use a presenter name of at most 80 characters.'),{status:400,code:'presenter_invalid'});
 const current=(await pool.query(SQL.preferences,[owner])).rows[0];
 const url=body?.presenterVideoUrl===undefined?(current?.presenter_video_url||null):String(body.presenterVideoUrl||'').trim()||null;
 if(url&&!/^\/api\/video\/editor\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(url))throw Object.assign(new Error('Choose a private OSHAL Video Studio clip link.'),{status:400,code:'presenter_media_invalid'});
 await pool.query(SQL.savePreferences,[owner,name,url,now.toISOString()]);return {ok:true,presenterName:name,presenterVideoUrl:url};
}
module.exports={SQL,paperRow,paperRows,composeReport,generateReport,listReports,savePreferences,liveRows};
