/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0: the first screen's facts for the paper reference book and named paper accounts, through the paper store's existing SELECT statements. A paper account's value counts prices only (paper/strategy.js: cash plus quantity times price), so the facts carry that basis for the screen to say. No new statement, no price read, no write.
 */
'use strict';
const store=require('../paper/store');
const books=require('../paper/books');
const {assignmentOf}=require('../paper/strategy');
const {etParts}=require('../paper/market');
const {planOf}=require('./connected');

const LIMITS=Object.freeze({accounts:12,positions:200,fills:50});
const REFERENCE=Object.freeze({book_ref:'paper',label:'Paper (reference book)'});
const round2=n=>Math.round(n*100)/100;
const iso=value=>{const n=Date.parse(value instanceof Date?value.toISOString():value);return Number.isFinite(n)?new Date(n).toISOString():null;};
const dayOf=at=>iso(at)?etParts(new Date(iso(at))).date:null;
const archived=book=>book.archived===true||book.archived==='t';

/** @description One simulated fill in the screen's shape. */
function fillOf(order){
 return {at:iso(order.created_at),symbol:order.symbol,side:String(order.side).toUpperCase(),quantity:order.qty,price:order.fill_price,notional:order.notional,
  reason:typeof order.reason==='string'?order.reason.slice(0,200):null,realizedPl:order.realized_pl};
}

/**
 * @description The saved plan of a paper account that runs a strategy: the newest pass's targets, else the targets shown when it was assigned.
 * @param {object|null} assignment The account's saved strategy assignment.
 * @param {Array<object>} ticks Recent passes, newest first.
 * @param {string|null} latest The last completed session.
 * @returns {object|null} The plan, or null for an account on its posture rules.
 */
function paperPlan(assignment,ticks,latest){
 if(!assignment)return null;
 const summary=ticks.find(t=>t.summary?.strategyId===assignment.strategyId&&Array.isArray(t.summary.targets))?.summary;
 const source=summary||assignment.preview;
 if(!source)return null;
 const monthly=assignment.config?.modelVersion===2;
 return planOf({targets:source.targets,decisionAsOf:source.decisionAsOf,rebalanceCadence:monthly?'calendar-monthly':'completed-session-daily'},{config:assignment.config},latest);
}

/** @description Passes recorded today among the newest twenty, and the newest one the person's schedule ran. */
function passesOf(ticks,day){
 const today=ticks.filter(t=>dayOf(t.created_at)===day),scheduled=ticks.find(t=>t.trigger_kind==='schedule'),last=ticks[0];
 return {lastTick:last?{at:iso(last.created_at),trigger:last.trigger_kind,outcome:last.outcome,orders:last.order_count}:null,
  lastScheduledTickAt:scheduled?iso(scheduled.created_at):null,
  passesToday:{count:today.length,withTrades:today.filter(t=>t.outcome==='traded').length,capped:ticks.length>=20&&today.length===ticks.length}};
}

/**
 * @description The change in a paper account's value since the record of an earlier session, in two parts that add up to it:
 * price change on what it holds, and modeled trading costs. A simulated account has no deposits, interest or dividends.
 * @param {object} account The paper account row.
 * @param {Array<object>} series Daily value records, oldest first.
 * @param {Array<object>} fills Every listed fill.
 * @returns {object} The change, its parts, and the result since the account started.
 */
function paperValue(account,series,fills){
 const at=iso(account.updatedAt),day=dayOf(at),prior=day?[...series].reverse().find(r=>String(r.session_date)<day)||null:null;
 const now={at,equity:account.equity,cash:account.cash};
 const sinceStart=account.startingCash>0?{startingCash:account.startingCash,startedAt:iso(account.createdAt),change:round2(account.equity-account.startingCash),
  pct:round2((account.equity/account.startingCash-1)*100)}:null;
 if(!prior)return {now,prior:null,change:null,parts:null,sinceStart,unknown:['prior']};
 const before={day:String(prior.session_date),at:iso(prior.recorded_at),equity:Number(prior.equity),cash:Number(prior.cash)},dayFills=fills.filter(f=>dayOf(f.at)===day);
 const bought=dayFills.filter(f=>f.side==='BUY').reduce((n,f)=>n+f.notional,0),sold=dayFills.filter(f=>f.side==='SELL').reduce((n,f)=>n+f.notional,0);
 const change=round2(now.equity-before.equity),costs=round2(now.cash-before.cash+bought-sold);
 return {now,prior:before,change,parts:{prices:round2(change-costs),costs,bought:round2(bought),sold:round2(sold)},sinceStart,unknown:[]};
}

/** @description One paper account's facts from its own ledger. */
async function accountFact(root,owner,book,day,latest){
 const reference=book.book_ref===REFERENCE.book_ref,pool=reference?root:books.bookPool(root,book.book_ref);
 const base={kind:'paper',ref:book.book_ref,label:String(book.label||book.book_ref).slice(0,100),simulated:true,basis:'prices-only'};
 const account=await store.loadAccount(pool,owner);
 if(!account)return {...base,opened:false};
 const config=await store.loadConfig(pool,owner),positions=await store.loadPositions(pool,owner),ticks=await store.listTicks(pool,owner);
 const orders=await store.listOrders(pool,owner),series=(await pool.query(store.SQL.EQUITY_SERIES,[owner])).rows;
 const assignment=reference?null:await assignmentOf({pool:root},owner,book.book_ref),fills=orders.map(fillOf),today=fills.filter(f=>dayOf(f.at)===day);
 return {...base,opened:true,config:{armed:Boolean(config?.armed),posture:config?.posture||null,armedAt:iso(config?.armedAt),disarmedAt:iso(config?.disarmedAt)},
  strategy:assignment?{id:assignment.strategyId,name:String(assignment.strategyName||'').slice(0,120),kind:assignment.config?.kind||null,modelVersion:assignment.config?.modelVersion??null,
   lastDecisionAsOf:assignment.lastDecisionAsOf||null,lastCheckedSession:assignment.lastCheckedSession||null,lastAttemptAt:iso(assignment.lastAttemptAt),
   lastResult:typeof assignment.lastResult==='string'?assignment.lastResult.slice(0,320):null}:null,
  ...passesOf(ticks,day),plan:paperPlan(assignment,ticks,latest),
  holdings:{at:iso(account.updatedAt),equity:account.equity,cash:account.cash,cut:positions.length>LIMITS.positions,positions:positions.slice(0,LIMITS.positions).map(p=>{
   const value=p.lastPrice==null?null:round2(p.qty*p.lastPrice);
   return {symbol:p.symbol,qty:p.qty,avgCost:p.avgCost,lastPrice:p.lastPrice,lastPriceAt:iso(p.lastPriceAt),marketValue:value,
    weightPct:value!==null&&account.equity>0?round2(value/account.equity*100):null,unrealizedPl:value===null?null:round2((p.lastPrice-p.avgCost)*p.qty)};})},
  today:{fills:today.slice(0,LIMITS.fills),fillsCut:today.length>LIMITS.fills||orders.length>=200&&today.length===orders.length,
   realizedPl:round2(today.reduce((n,f)=>n+(Number.isFinite(f.realizedPl)?f.realizedPl:0),0)),lastFill:fills[0]||null},
  value:paperValue(account,series,fills)};
}

/**
 * @description The paper reference book and every named paper account that is not archived, each from its own ledger.
 * Uses only statements the paper store already declares, so a named account goes through the existing book binding.
 * @param {{pool:object,log:object}} db The package pool and the route's logger; nothing else.
 * @param {string} owner The admitted caller.
 * @param {Date} now The server clock.
 * @param {string|null} latest The last completed session.
 * @returns {Promise<{accounts:Array<object>,archived:number,cut:boolean}>} The accounts, how many are archived, and whether the list was cut.
 */
async function paperFacts(db,owner,now,latest){
 const day=etParts(now).date,listed=await books.listBooks(db.pool,owner),named=listed.filter(b=>!archived(b));
 const accounts=[];
 for(const book of [REFERENCE,...named.slice(0,LIMITS.accounts-1)]){
  try{accounts.push(await accountFact(db.pool,owner,book,day,latest));}
  catch(err){
   // One unreadable ledger is said on its own card; it does not hide the other accounts.
   db.log.error({err,ref:book.book_ref},'paper account facts could not be read');
   accounts.push({kind:'paper',ref:book.book_ref,label:String(book.label||book.book_ref).slice(0,100),simulated:true,unreadable:true});
  }
 }
 return {accounts,archived:listed.length-named.length,cut:named.length>LIMITS.accounts-1};
}

module.exports={LIMITS,paperFacts,paperValue,paperPlan};
