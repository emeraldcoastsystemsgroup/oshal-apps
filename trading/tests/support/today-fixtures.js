/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Invented accounts for the first screen (1.57.0): a statement-exact database double for GET /paper/today that answers only the SELECT statements the shipped modules declare (their texts are imported, so they cannot drift), logs every statement and refuses anything else, plus builders for made-up monitors, receipts, broker orders and paper ledgers. No real account, order or balance appears here.
 */
'use strict';
const store=require('../../routes/paper/store');
const books=require('../../routes/paper/books');
const {fingerprint}=require('../../routes/trading-portfolio-store');
const {accountKey}=require('../../routes/trading-portfolio-model');
const {SQL:CONNECTED_SQL}=require('../../routes/today/connected');

const RECORD_LIST=/^SELECT record_id, payload, created_at FROM oshal_trading_portfolio_records WHERE user_sub=\$1 AND kind=\$2 ORDER BY created_at DESC LIMIT \d+$/;
const RECORD_GET='SELECT record_id, payload, created_at FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 AND record_id=$3';
const PAPER_READS=['ACCOUNT_GET','CONFIG_GET','POSITIONS_LIST','TICKS_RECENT','ORDERS_LIST','EQUITY_SERIES'];
const OWNER='fixture-owner',ACCOUNT=Object.freeze({accountId:'fixture-account-1',connectionKey:'fixture-login'});
const clone=value=>JSON.parse(JSON.stringify(value));
const answer=rows=>({rows:clone(rows),rowCount:rows.length});

/** @description The rows one paper read returns for one ledger. */
function paperRows(name,ledger,sub){
 const mine=rows=>(rows||[]).filter(r=>r.user_sub===sub);
 if(name==='ACCOUNT_GET')return mine(ledger.account);
 if(name==='CONFIG_GET')return mine(ledger.config);
 if(name==='POSITIONS_LIST')return mine(ledger.positions).sort((a,b)=>a.symbol<b.symbol?-1:1);
 if(name==='TICKS_RECENT')return mine(ledger.ticks).sort((a,b)=>a.tick_window<b.tick_window?1:-1).slice(0,20);
 if(name==='ORDERS_LIST')return mine(ledger.orders).sort((a,b)=>a.created_at<b.created_at?1:-1).slice(0,200);
 return mine(ledger.equity).sort((a,b)=>a.session_date<b.session_date?-1:1);
}

/**
 * @description An in-memory database that answers exactly the statements GET /paper/today may send and refuses every other.
 * @returns {{pool:object,log:Array<string>,record:Function,value:Function,book:Function,ledger:Function}} The pool, the log of every statement, and the seeders.
 */
function createTodayDb(){
 const db={records:[],values:[],books:[],ledgers:new Map()},log=[];
 const ledgerOf=ref=>{if(!db.ledgers.has(ref))db.ledgers.set(ref,{account:[],config:[],positions:[],ticks:[],orders:[],equity:[]});return db.ledgers.get(ref);};
 const statements=new Map();
 for(const name of PAPER_READS){
  statements.set(store.SQL[name],([sub])=>answer(paperRows(name,ledgerOf('paper'),sub)));
  statements.set(books.bindStatement(store.SQL[name]),([sub,ref])=>answer(paperRows(name,ledgerOf(ref),sub)));
 }
 statements.set(books.META.list,([sub])=>answer(db.books.filter(b=>b.user_sub===sub).sort((a,b)=>a.created_at<b.created_at?1:-1)));
 statements.set(RECORD_GET,([sub,kind,id])=>answer(db.records.filter(r=>r.user_sub===sub&&r.kind===kind&&r.record_id===id)));
 statements.set(CONNECTED_SQL.VALUES_RECENT,([sub,connection,account])=>answer(db.values.filter(v=>v.user_sub===sub&&v.connection_key===connection&&v.account_id===account)
  .sort((a,b)=>a.observed_day<b.observed_day?1:-1).slice(0,3)));
 const query=async(text,values=[])=>{
  log.push(text);
  if(RECORD_LIST.test(text))return answer(db.records.filter(r=>r.user_sub===values[0]&&r.kind===values[1]).sort((a,b)=>a.created_at<b.created_at?1:-1));
  const handler=statements.get(text);
  if(!handler)throw new Error('today double refuses an undeclared statement: '+String(text).slice(0,90));
  return handler(values);
 };
 return {log,pool:{query,connect:async()=>{log.push('CONNECT');throw new Error('the today read must not open a transaction');}},
  record(owner,kind,payload,key,createdAt='2026-11-01T12:00:00.000Z'){const id=key?kind+':'+fingerprint([owner,key]):kind+'-'+(db.records.length+1);db.records.push({record_id:id,user_sub:owner,kind,payload:JSON.stringify(payload),created_at:createdAt});return id;},
  value(owner,account,day,at,equity,cash){db.values.push({user_sub:owner,connection_key:account.connectionKey,account_id:account.accountId,observed_day:day,observed_at:at,equity,cash});},
  book(owner,ref,label,isArchived=false){db.books.push({user_sub:owner,book_ref:ref,label,archived:isArchived,created_at:'2026-10-28T13:00:00.000Z',updated_at:'2026-10-28T13:00:00.000Z'});},
  ledger(owner,ref,rows){const ledger=ledgerOf(ref);for(const [table,list] of Object.entries(rows))for(const row of list)ledger[table].push({user_sub:owner,...row});}};
}

/** @description A saved monthly strategy of five invented funds. */
function monthlyStrategy(){
 return {name:'Example monthly trend',config:{modelVersion:2,kind:'monthly-trend',assets:['SPY','EFA','IEF','GLD','DBC'].map(symbol=>({symbol,weightPct:20})),grossExposurePct:100}};
}

/** @description One broker order in the kernel's normalized shape. */
function brokerOrder(orderId,side,symbol,quantity,price,enteredTime,{status='FILLED',fillAt=enteredTime}={}){
 const filled=status==='FILLED';
 return {orderId,status,quantity,filledQuantity:filled?quantity:0,remainingQuantity:filled?0:quantity,price,enteredTime,closeTime:filled?fillAt:null,orderType:'LIMIT',complex:false,
  legs:[{symbol,instruction:side,quantity}],executions:filled?[{price,quantity,time:fillAt}]:[],averageFillPrice:filled?price:null};
}

/**
 * @description A watcher receipt for the invented account: what the last check saw and decided.
 * @param {string} strategyId The saved strategy's record id.
 * @param {object} [over] Fields to replace.
 * @returns {object} The receipt.
 */
function receipt(strategyId,over={}){
 return {...ACCOUNT,accountLabel:'Example margin',strategyId,runId:'fixture-run',observedAt:'2026-11-12T18:45:00.000Z',trigger:'schedule',status:'aligned',
  signal:{model:'portfolio-monthly-v2',signalAsOf:'2026-11-11',decisionAsOf:'2026-10-30',evidenceThrough:'2026-10-30',rebalanceCadence:'calendar-monthly',
   targets:[{symbol:'SPY',weightPct:20},{symbol:'GLD',weightPct:20},{symbol:'BIL',weightPct:60}]},
  accountEquity:31204.18,reportedCash:310.5,
  positions:[{symbol:'BIL',qty:204,marketValue:18670.08,avgEntryPrice:91.54,unrealizedPl:-3.1},{symbol:'SPY',qty:9,marketValue:6180.3,avgEntryPrice:673.3,unrealizedPl:120.44},{symbol:'GLD',qty:16,marketValue:6043.3,avgEntryPrice:378.83,unrealizedPl:-18.02}],
  brokerOrders:[brokerOrder('9001','BUY','BIL',41,91.52,'2026-11-03T15:05:00.000Z')],workingOrders:[],
  brokerFunding:{cashBudgetUsd:310.5,readAtMs:Date.parse('2026-11-12T18:45:00.000Z'),account:{accountNumber:'ACCOUNT-NUMBER-DO-NOT-SHOW',balanceFacts:{accruedInterest:null,marginBalance:0}}},
  nativeTickets:[{ticketId:'t-9001',orderId:'9001',status:'submitted',mandateId:'fixture-mandate',fingerprint:'TICKET-FINGERPRINT-DO-NOT-SHOW',attemptedAtMs:Date.parse('2026-11-03T15:05:00.000Z')}],
  proposal:{actions:[],blockers:[],rows:[]},ordersSubmitted:0,
  automation:{status:'cycle-completed',ordersSubmitted:0,mandate:{mandateId:'fixture-mandate',status:'active',effectiveStatus:'active',expiresAtMs:Date.parse('2026-12-02T15:00:00.000Z'),
   source:'SOURCE-DIGEST-DO-NOT-SHOW',terms:{capitalCents:3000000,scope:'whole-account',cadence:'monthly'}}},...over};
}

/** @description A saved monitor that is on, approved and checked by its schedule a minute ago. */
function watch(strategyId,lastReceipt,over={}){
 return {...ACCOUNT,accountLabel:'Example margin',strategyId,runId:'fixture-run',enabled:true,enabledAt:'2026-11-02T14:00:00.000Z',automatedTrading:true,executionMode:'automatic-monthly',
  mandateId:'fixture-mandate',lastRunAt:lastReceipt?.observedAt||null,lastGuardAt:'2026-11-12T18:49:00.000Z',lastError:null,lastProtectionCheck:{status:'not-enabled',ordersSubmitted:0},
  signal:lastReceipt?.signal,lastReceipt,...over};
}

/**
 * @description Seed the invented connected account: its profile, strategy, monitor with one receipt and two daily value records.
 * @param {object} db createTodayDb().
 * @param {{receipt?:object,watch?:object,owner?:string}} [over] Replacements for the receipt, the monitor or the owner.
 * @returns {{strategyId:string}} The saved strategy's id.
 */
function seedConnected(db,over={}){
 const owner=over.owner||OWNER,strategyId=db.record(owner,'strategy',monthlyStrategy());
 db.record(owner,'profile',{...ACCOUNT,registration:'taxable',label:'Example margin ···0001',strategyId},accountKey(ACCOUNT));
 db.record(owner,'watch',watch(strategyId,receipt(strategyId,over.receipt),over.watch),accountKey(ACCOUNT));
 db.value(owner,ACCOUNT,'2026-11-11','2026-11-12T04:55:00.000Z',31216.58,308);
 db.value(owner,ACCOUNT,'2026-11-12','2026-11-12T18:45:00.000Z',31204.18,310.5);
 return {strategyId};
}

/**
 * @description Seed one invented paper ledger that holds BIL under the monthly strategy, with yesterday's value record.
 * @param {object} db createTodayDb().
 * @param {string} ref 'paper' for the reference book, or a named account's ref.
 * @param {{owner?:string,strategy?:boolean,armed?:boolean}} [over] Owner, whether a saved strategy runs it, and whether it is armed.
 * @returns {void}
 */
function seedPaper(db,ref,over={}){
 const owner=over.owner||OWNER,at='2026-11-12T18:45:00.000Z';
 if(ref!=='paper')db.book(owner,ref,'Example paper account');
 db.ledger(owner,ref,{
  account:[{cash:60.16,equity:99868.96,high_water:100000,realized_pl:0,starting_cash:100000,version:9,last_tick_window:at,created_at:'2026-10-28T13:00:00.000Z',updated_at:at}],
  config:[{armed:over.armed!==false,posture:'balanced',starting_cash:100000,max_shares:100,max_notional:5000,max_orders_per_tick:8,max_quote_age_minutes:20,universe:null,armed_at:'2026-10-28T13:00:00.000Z',disarmed_at:null,updated_at:at}],
  positions:[{symbol:'BIL',qty:1092,avg_cost:91.52,last_price:91.4,last_price_at:'2026-11-12T18:44:00.000Z',peak_price:91.6,opened_at:'2026-11-03T15:05:00.000Z',updated_at:at}],
  ticks:[{tick_window:'2026-11-12T18:45:00.000Z',trigger_kind:'schedule',outcome:'no_trade',order_count:0,equity:99868.96,created_at:at,
   summary:JSON.stringify(over.strategy===false?{priceSource:'world-archive'}:{strategy:'Example monthly trend',strategyId:'fixture-strategy',decisionAsOf:'2026-10-30',targets:[{symbol:'BIL',weightPct:100}],valuationOnly:true})},
   {tick_window:'2026-11-12T18:40:00.000Z',trigger_kind:'schedule',outcome:'no_trade',order_count:0,equity:99880,created_at:'2026-11-12T18:40:00.000Z',summary:null}],
  orders:[{order_id:'paper-1',tick_window:'2026-11-03T15:05:00.000Z',decision_id:'d-1',symbol:'BIL',side:'buy',qty:1092,fill_price:91.52,notional:99939.84,reason:'Strategy rebalance: Example monthly trend',realized_pl:null,status:'filled',quote_at:null,created_at:'2026-11-03T15:05:00.000Z'}],
  equity:[{session_date:'2026-11-11',equity:99910.46,cash:60.16,recorded_at:'2026-11-11T20:55:00.000Z'},{session_date:'2026-11-12',equity:99868.96,cash:60.16,recorded_at:at}]});
 if(ref!=='paper'&&over.strategy!==false)db.record(owner,'paper-strategy',{bookRef:ref,strategyId:'fixture-strategy',strategyName:'Example monthly trend',config:monthlyStrategy().config,symbols:['SPY','EFA','IEF','GLD','DBC','BIL'],
  assignedAt:'2026-11-03T15:00:00.000Z',preview:{decisionAsOf:'2026-10-30',targets:[{symbol:'BIL',weightPct:100}]},lastDecisionAsOf:'2026-10-30',lastCheckedSession:'2026-11-12',lastAttemptAt:'2026-11-12T14:35:00.000Z',lastResult:'current'},ref);
}

module.exports={OWNER,ACCOUNT,createTodayDb,monthlyStrategy,brokerOrder,receipt,watch,seedConnected,seedPaper};
