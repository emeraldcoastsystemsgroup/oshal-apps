/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0: the first screen's facts for connected accounts, from saved records only. Roger could not tell whether an account was trading or parked, what it did today or why its value moved: the answers were already in the watcher's last check, the strategy's saved decision and the daily value record, and no screen read them together. SELECT statements only; no broker, no kernel order service, no write.
 */
'use strict';
const {listRecords}=require('../trading-portfolio-store');
const {accountKey,measured}=require('../trading-portfolio-model');
const {sessionDates}=require('../trading-portfolio-calendar');
const {mandateAuthority}=require('../live/execution-state');
const {brokerActivity}=require('../paper/report-activity');
const {etParts}=require('../paper/market');

/** The statements this module sends beyond the saved-record list. Read by the kernel test so they cannot drift. */
const SQL=Object.freeze({
 VALUES_RECENT: 'SELECT observed_day, observed_at, equity, cash FROM trading_account_values WHERE user_sub=$1 AND connection_key=$2 AND account_id=$3 ORDER BY observed_day DESC LIMIT 3',
});
const LIMITS=Object.freeze({accounts:8,positions:200,fills:50,working:50,blockers:20});
const TERMINAL=new Set(['FILLED','CANCELED','CANCELLED','REJECTED','EXPIRED','REPLACED']);
const round2=n=>Math.round(n*100)/100;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const dayOf=at=>stamp(at)?etParts(new Date(at)).date:null;
const text=(value,max)=>typeof value==='string'?value.slice(0,max):null;
/** undefined stays undefined, a list of plain rows is kept, anything else is null: unreadable, never empty. */
function rowsOf(value){
 if(value===undefined)return undefined;
 return Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&!Array.isArray(row))?value:null;
}
const blockersOf=value=>{const rows=rowsOf(value);return rows?rows.slice(0,LIMITS.blockers).map(b=>({code:text(b.code,80),symbol:text(b.symbol,32),message:text(b.message,300)})):rows;};

/**
 * @description The receipt only when it is for this exact account, connection and strategy; another one is not evidence.
 * @param {object|null} watch A saved monitor record.
 * @returns {object|null} Its matching receipt, or null.
 */
function receiptOf(watch){
 const receipt=watch?.lastReceipt,key=watch&&accountKey(watch);
 if(!receipt||typeof receipt!=='object'||!key||accountKey(receipt)!==key)return null;
 return typeof watch.strategyId==='string'&&watch.strategyId&&receipt.strategyId===watch.strategyId?receipt:null;
}

/** @description The approval as the last check saw it, with the same rule the management read applies to a live answer. */
function authorityOf(watch,receipt,now){
 if(!watch.mandateId)return {status:'not-enabled',active:false};
 const authority=mandateAuthority(receipt?.automation?.mandate||watch.mandate,now);
 return authority.active&&(!watch.automatedTrading||!watch.enabled)?{status:'execution-disabled',active:false}:authority;
}

/** @description The receipt fields the account-status reader uses, with unreadable lists kept unreadable. */
function trimmedReceipt(receipt){
 const positions=rowsOf(receipt.positions),targets=rowsOf(receipt.signal?.targets),working=rowsOf(receipt.workingOrders),deferred=rowsOf(receipt.automation?.deferred);
 return {accountId:receipt.accountId,connectionKey:receipt.connectionKey,strategyId:receipt.strategyId,observedAt:stamp(receipt.observedAt),status:text(receipt.status,80),
  ordersSubmitted:Number.isSafeInteger(receipt.ordersSubmitted)?receipt.ordersSubmitted:null,accountEquity:measured(receipt.accountEquity),
  signal:receipt.signal&&typeof receipt.signal==='object'?{signalAsOf:text(receipt.signal.signalAsOf,10),decisionAsOf:text(receipt.signal.decisionAsOf,10),evidenceThrough:text(receipt.signal.evidenceThrough,10),
   targets:targets?targets.map(t=>({symbol:text(t.symbol,32),weightPct:measured(t.weightPct)})):targets}:undefined,
  positions:positions?positions.slice(0,LIMITS.positions).map(p=>({symbol:text(p.symbol,32),qty:measured(p.qty),marketValue:measured(p.marketValue),unrealizedPl:measured(p.unrealizedPl)})):positions,
  workingOrders:working?working.slice(0,LIMITS.working).map(o=>({orderId:text(String(o.orderId??''),40),status:text(o.status,50)})):working,
  automation:receipt.automation&&typeof receipt.automation==='object'?{status:text(receipt.automation.status,80),message:text(receipt.automation.message,300),blockers:blockersOf(receipt.automation.blockers),
   deferred:deferred?deferred.slice(0,LIMITS.blockers).map(d=>({symbol:text(d.symbol,32),action:text(d.action,10),blockers:blockersOf(d.blockers)})):deferred}:undefined,
  proposal:{blockers:blockersOf(receipt.proposal?.blockers)}};
}

/** @description The monitor's saved settings and the times it really ran. */
function monitorOf(watch,receipt,authority){
 const mandate=receipt?.automation?.mandate||watch.mandate,run=stamp(watch.lastRunAt),guard=stamp(watch.lastGuardAt);
 const heartbeat=run&&guard?(Date.parse(run)>=Date.parse(guard)?run:guard):run||guard;
 return {enabled:watch.enabled===true?true:watch.enabled===false?false:null,automatedTrading:watch.automatedTrading===true?true:watch.automatedTrading===false?false:null,
  executionMode:text(watch.executionMode,40),enabledAt:stamp(watch.enabledAt),stoppedAt:stamp(watch.stoppedAt),lastRunAt:run,lastGuardAt:guard,heartbeatAt:heartbeat,lastError:text(watch.lastError,240),
  protectionCheck:text(watch.lastProtectionCheck?.status,80),
  approval:watch.mandateId?{status:authority.status,active:authority.active,asOf:stamp(receipt?.observedAt),expiresAt:Number.isFinite(mandate?.expiresAtMs)?new Date(mandate.expiresAtMs).toISOString():null,
   capitalUsd:Number.isFinite(mandate?.terms?.capitalCents)?mandate.terms.capitalCents/100:null,scope:text(mandate?.terms?.scope,40),cadence:text(mandate?.terms?.cadence,20)}:null};
}

/** @description The month-end close the next monthly decision uses, or null outside the verified 2024 to 2027 calendar. */
function nextMonthlyDecision(latest){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(latest))||latest<'2024-01-01'||latest>'2027-11-15')return null;
 const after=sessionDates(latest,new Date(Date.parse(latest+'T00:00:00Z')+10*86400000).toISOString().slice(0,10)).find(d=>d>latest);
 if(!after)return null;
 const month=after.slice(0,7),end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
 return sessionDates(month+'-01',end).at(-1)||null;
}

/**
 * @description The strategy's saved decision: what the account is meant to hold, and how much of that is the model's fallback.
 * Monthly models put every unfilled share into BIL (trading-portfolio-rotation.js); daily models leave it in cash (strategy/signals.js).
 * @param {object|null} signal A saved signal (targets, decision date, cadence).
 * @param {object|null} strategy The saved strategy record.
 * @param {string|null} latest The last completed session.
 * @returns {object|null} The plan, or null when none is recorded.
 */
function planOf(signal,strategy,latest){
 if(!signal||typeof signal!=='object')return null;
 const rows=rowsOf(signal.targets),config=strategy?.config;
 // The saved decision names its own cadence; a signal that does not is read by its strategy's model version.
 const monthly=typeof signal.rebalanceCadence==='string'?signal.rebalanceCadence==='calendar-monthly':config?.modelVersion===2;
 const targets=rows?rows.map(t=>({symbol:text(t.symbol,32),weightPct:measured(t.weightPct)})).filter(t=>t.symbol):null;
 const known=targets&&targets.every(t=>t.weightPct!==null),sum=known?targets.reduce((n,t)=>n+t.weightPct,0):null;
 const bil=known?targets.filter(t=>t.symbol==='BIL').reduce((n,t)=>n+t.weightPct,0):null;
 const cash=known?(measured(signal.cashWeightPct)??Math.max(0,100-sum)):null;
 return {decisionAsOf:text(signal.decisionAsOf,10),signalAsOf:text(signal.signalAsOf,10),evidenceThrough:text(signal.evidenceThrough,10),cadence:monthly?'monthly':'daily',targets,
  fallbackSymbol:monthly?'BIL':null,fallbackPct:known?round2(monthly?bil:cash):null,cashWeightPct:known&&!monthly?round2(cash):null,
  marketRiskOn:typeof signal.marketRiskOn==='boolean'?signal.marketRiskOn:null,fundsInPlan:known?targets.filter(t=>t.symbol!=='BIL'&&t.weightPct>0).length:null,
  funds:Array.isArray(config?.assets)?config.assets.length:null,nextDecisionUses:monthly&&latest?nextMonthlyDecision(latest):null};
}

/** @description What the account held at the last check. */
function holdingsOf(receipt){
 const rows=rowsOf(receipt.positions),equity=measured(receipt.accountEquity);
 return {at:stamp(receipt.observedAt),equity,cash:measured(receipt.reportedCash),cut:Boolean(rows&&rows.length>LIMITS.positions),
  positions:rows?rows.slice(0,LIMITS.positions).map(p=>{const value=measured(p.marketValue);return {symbol:text(p.symbol,32),qty:measured(p.qty),marketValue:value,
   weightPct:value!==null&&equity>0?round2(value/equity*100):null,unrealizedPl:measured(p.unrealizedPl)};}):null};
}

/** @description Who placed an order: the strategy, a watcher exit, a one-off review, or someone outside OSHAL. */
function originOf(tickets){
 const byOrder=new Map((tickets||[]).filter(t=>t.orderId!=null).map(t=>[String(t.orderId),t]));
 return orderId=>{const t=byOrder.get(String(orderId));return !t?'outside':t.protectionMandateId?'watcherExit':t.mandateId?'strategy':'oneOff';};
}

/**
 * @description Today's orders and fills from the broker order list the last check saved. The same reading of a fill as the
 * daily report (paper/report-activity.js), so the two cannot disagree. An unreadable list is null, never an empty day.
 * @param {object} receipt The matching receipt.
 * @param {Date} now The server clock.
 * @param {{error:Function}} log The route's logger.
 * @returns {object} Counts, fills, the last fill and what could not be read.
 */
function todayOf(receipt,now,log){
 const tickets=rowsOf(receipt.nativeTickets),origin=originOf(tickets),day=etParts(now).date,at=stamp(receipt.observedAt);
 const uncertain=tickets?tickets.filter(t=>['unknown','attempting'].includes(t.status)).length:null;
 const base={at,ordersSubmittedLastCheck:Number.isSafeInteger(receipt.ordersSubmitted)?receipt.ordersSubmitted:null,uncertainAttempts:uncertain};
 let activity;
 if(!Array.isArray(receipt.brokerOrders))return {...base,orders:null,fills:null,fillsCut:false,lastFill:null,exceptions:null,all:null};
 try{activity=brokerActivity({source:'schwab',orders:receipt.brokerOrders,readAtMs:at?Date.parse(at):null},now);}
 catch(err){
  // A saved order list that cannot be read is Unknown on the screen, never an empty day.
  log.error({err,accountId:receipt.accountId},'saved broker order list could not be read');
  return {...base,orders:null,fills:null,fillsCut:false,lastFill:null,exceptions:null,all:null};
 }
 const entered=activity.orders.filter(o=>dayOf(o.enteredTime)===day),count=kind=>entered.filter(o=>origin(o.orderId)===kind).length;
 const shape=f=>({at:f.at,symbol:f.symbol,side:f.side,quantity:f.quantity,price:f.price,notional:f.notional,orderId:f.orderId,origin:origin(f.orderId)});
 return {...base,all:activity.recentFills,exceptions:activity.exceptions.length,
  orders:{entered:{total:entered.length,strategy:count('strategy'),watcherExit:count('watcherExit'),oneOff:count('oneOff'),outside:count('outside')},
   refused:entered.filter(o=>o.status==='REJECTED').length,cancelled:entered.filter(o=>['CANCELED','CANCELLED','EXPIRED','REPLACED'].includes(o.status)).length,
   working:entered.filter(o=>!TERMINAL.has(o.status)).length},
  fills:activity.todayFills.slice(0,LIMITS.fills).map(shape),fillsCut:activity.todayFills.length>LIMITS.fills,lastFill:activity.recentFills[0]?shape(activity.recentFills[0]):null};
}

/**
 * @description The change in value since the last record of an earlier day, split into the only two parts saved records
 * support: what prices did to the holdings, and cash that moved for any reason other than a trade. The parts add up to the change.
 * @param {{at:string|null,equity:number|null,cash:number|null}} current Value and cash at the last check.
 * @param {Array<object>} values Saved daily records, newest first.
 * @param {Array<object>|null} fills Every readable fill, or null.
 * @returns {object} The change, its parts when they can be computed, and what is unknown.
 */
function valueOf(current,values,fills){
 const day=dayOf(current.at),prior=day?values.find(v=>v.day<day)||null:null,unknown=[];
 const out={now:current,prior,change:null,parts:null,unknown};
 if(current.equity===null||!prior){unknown.push(prior?'value':'prior');return out;}
 out.change=round2(current.equity-prior.equity);
 const dayFills=fills?fills.filter(f=>dayOf(f.at)===day):null;
 if(current.cash===null||prior.cash===null)unknown.push('cash');
 if(!dayFills||dayFills.some(f=>f.notional===null||!/^(BUY|SELL)/.test(String(f.side))))unknown.push('fills');
 if(unknown.length)return out;
 const bought=dayFills.filter(f=>String(f.side).startsWith('BUY')).reduce((n,f)=>n+f.notional,0),sold=dayFills.filter(f=>String(f.side).startsWith('SELL')).reduce((n,f)=>n+f.notional,0);
 const otherCash=round2(current.cash-prior.cash+bought-sold);
 out.parts={prices:round2(out.change-otherCash),otherCash,bought:round2(bought),sold:round2(sold)};
 return out;
}

/** @description The newest saved daily value records of one account. */
async function recentValues(db,owner,account){
 const rows=(await db.pool.query(SQL.VALUES_RECENT,[owner,account.connectionKey,account.accountId])).rows;
 return rows.map(r=>({day:String(r.observed_day),at:new Date(r.observed_at).toISOString(),equity:measured(Number(r.equity)),cash:r.cash==null?null:measured(Number(r.cash))})).filter(v=>v.equity!==null);
}

/** @description One connected account's facts from its saved profile, monitor, strategy and value records. */
async function accountFact(db,owner,row,records,now,latest){
 const {profile,watch}=row,account={accountId:row.accountId,connectionKey:row.connectionKey},receipt=receiptOf(watch);
 // The assigned strategy is the profile's, as on the management page; the monitor's own is shown only when none is assigned.
 const strategyId=profile?.strategyId??null,strategy=records.strategies.find(s=>s.id===(strategyId||watch?.strategyId))||null;
 const authority=watch?authorityOf(watch,receipt,now):null,today=receipt?todayOf(receipt,now,db.log):null;
 const fact={kind:'connected',...account,label:text(profile?.label||watch?.accountLabel,120)||'Connected account',
  strategy:strategy?{id:strategy.id,name:text(strategy.name,120),kind:text(strategy.config?.kind,40),modelVersion:measured(strategy.config?.modelVersion),
   grossExposurePct:measured(strategy.config?.grossExposurePct),defensiveGrossPct:measured(strategy.config?.defensiveGrossPct)}:null,
  status:{account:{...account,strategyId},watch:watch?{...account,strategyId:watch.strategyId??null,enabled:watch.enabled,automatedTrading:watch.automatedTrading,authority,
   lastError:text(watch.lastError,240),lastRunAt:stamp(watch.lastRunAt),lastReceipt:receipt?trimmedReceipt(receipt):watch.lastReceipt?{accountId:null}:null}:null},
  monitor:watch?monitorOf(watch,receipt,authority):null,plan:planOf(receipt?.signal||watch?.signal,strategy,latest),
  holdings:receipt?holdingsOf(receipt):null,today:null,value:null,interest:null};
 if(!receipt)return fact;
 const {all,...shown}=today,values=await recentValues(db,owner,account),accrued=measured(receipt.brokerFunding?.account?.balanceFacts?.accruedInterest);
 fact.today=shown;
 fact.value=valueOf({at:stamp(receipt.observedAt),equity:measured(receipt.accountEquity),cash:measured(receipt.reportedCash)},values,all);
 fact.interest=accrued===null?null:{accrued,at:Number.isFinite(receipt.brokerFunding.readAtMs)?new Date(receipt.brokerFunding.readAtMs).toISOString():stamp(receipt.observedAt)};
 return fact;
}

/**
 * @description Every connected account the person has a saved profile or monitor for, with what its saved records say.
 * Reads the caller's own rows with SELECT statements and nothing else: no broker, no kernel order service, no write.
 * @param {{pool:object,log:object}} db The package pool and the route's logger; nothing else.
 * @param {string} owner The admitted caller.
 * @param {Date} now The server clock.
 * @param {string|null} latest The last completed session.
 * @returns {Promise<{accounts:Array<object>,cut:boolean}>} The accounts, and whether the list was cut at its bound.
 */
async function connectedFacts(db,owner,now,latest){
 const records={profiles:await listRecords(db,owner,'profile'),watches:await listRecords(db,owner,'watch'),strategies:await listRecords(db,owner,'strategy')};
 const rows=new Map();
 for(const profile of records.profiles){const key=accountKey(profile);if(key&&profile.connectionKey!=='outside')rows.set(key,{accountId:profile.accountId,connectionKey:profile.connectionKey,profile,watch:null});}
 for(const watch of records.watches){const key=accountKey(watch);if(key)rows.set(key,{...(rows.get(key)||{accountId:watch.accountId,connectionKey:watch.connectionKey,profile:null}),watch});}
 const listed=[...rows.values()],accounts=[];
 for(const row of listed.slice(0,LIMITS.accounts))accounts.push(await accountFact(db,owner,row,records,now,latest));
 return {accounts,cut:listed.length>LIMITS.accounts};
}

module.exports={SQL,LIMITS,connectedFacts,receiptOf,planOf,todayOf,valueOf};
