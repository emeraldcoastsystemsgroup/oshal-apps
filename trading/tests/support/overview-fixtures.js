/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: the margin account's approval ends Nov 30, 2026 at 06:38Z (before the Dec 1 monthly trade, as a review found on two real approvals), the IRA's ends Dec 2 (after it, more than 14 days away), and the cash account has none.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: an invented portfolio for the overview (Intelligent Trades' first screen): three made-up connected accounts with a month of made-up daily values (one account misses a market day, one has a Saturday record), the saved records that give them a running, a needs-you and a not-set-up chip, the broker roster with their holdings, and made-up SPY and BIL daily closes. Every figure is generated from a fixed seed; no real account, holding or price appears here.
 */
'use strict';
const {accountKey}=require('../../routes/trading-portfolio-model');
const {sessionDates}=require('../../routes/trading-portfolio-calendar');
const {OWNER,ACCOUNT,receipt,watch,seedConnected}=require('./today-fixtures');

const NOW=new Date('2026-11-12T18:50:00.000Z');
/** The margin account's approval: active, ending before the Dec 1 trade the Nov 30 month-end decision makes. */
const MARGIN_APPROVAL_ENDS='2026-11-30T06:38:00.000Z';
const FIRST_DAY='2026-10-13',TODAY='2026-11-12',GAP_DAY='2026-11-05',SATURDAY='2026-11-07';
const IRA=Object.freeze({accountId:'fixture-account-2',connectionKey:ACCOUNT.connectionKey});
const CASH=Object.freeze({accountId:'fixture-account-3',connectionKey:ACCOUNT.connectionKey});
/** The overview's key for an account (connection and account), and each invented account's label by that key. */
const keyOf=account=>account.connectionKey+'|'+account.accountId;
const LABELS=Object.freeze({[keyOf(ACCOUNT)]:'Example margin ···0001',[keyOf(IRA)]:'Example IRA ···0002',[keyOf(CASH)]:'Example cash ···0003'});

/** @description A fixed-seed generator, so every run draws the same made-up figures. */
function seeded(seed){
 let state=seed>>>0;
 return ()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
const cents=value=>Math.round(value*100)/100;

/**
 * @description A made-up daily walk: one value per day, each a small up or down move from the day before.
 * @param {Array<string>} days The days.
 * @param {number} start The first value.
 * @param {number} seed The generator's seed.
 * @param {number} [step] The largest daily move, as a fraction.
 * @returns {Map<string,number>} Value by day.
 */
function walk(days,start,seed,step=0.012){
 const next=seeded(seed),out=new Map();let value=start;
 for(const day of days){out.set(day,cents(value));value*=1+(next()*2-1)*step;}
 return out;
}

/** @description The market days of the invented history, and the days the saved rows fall on for each account. */
function historyDays(){
 const sessions=sessionDates(FIRST_DAY,TODAY);
 return {sessions,margin:sessions.filter(d=>d<'2026-11-11'),ira:sessions,cash:sessions.filter(d=>d!==GAP_DAY)};
}

/** @description Every saved daily value of the invented accounts, as [account, day, observedAt, equity, cash] rows. */
function valueRows(){
 const days=historyDays(),at=day=>day===TODAY?'2026-11-12T18:45:00.000Z':day+'T20:55:00.000Z',rows=[];
 for(const [day,value] of walk(days.margin,30400,11))rows.push([ACCOUNT,day,at(day),value,310.5]);
 rows.push([ACCOUNT,SATURDAY,'2026-11-07T15:00:00.000Z',30911.11,310.5]);   // a weekend record: not a market day
 for(const [day,value] of walk(days.ira,52000,23,0.009))rows.push([IRA,day,at(day),value,1250]);
 for(const [day,value] of walk(days.cash,8000,37,0.02))rows.push([CASH,day,at(day),value,2100]);
 return rows;
}

/**
 * @description Seed the invented portfolio: the margin account from today-fixtures (running, mostly parked), an IRA whose
 *   monitor needs the person, a cash account with a profile and no monitor (not set up), and every saved daily value.
 * @param {object} db createTodayDb(), or a host's seeders with the same record/value interface.
 * @returns {void}
 */
function seedPortfolio(db){
 const automation={status:'cycle-completed',ordersSubmitted:0,mandate:{mandateId:'fixture-mandate',status:'active',effectiveStatus:'active',expiresAtMs:Date.parse(MARGIN_APPROVAL_ENDS),
  terms:{capitalCents:3000000,scope:'whole-account',cadence:'monthly'}}};
 const {strategyId}=seedConnected(db,{receipt:{automation}});
 db.record(OWNER,'profile',{...IRA,registration:'ira',label:LABELS[keyOf(IRA)],strategyId},accountKey(IRA));
 const iraReceipt=receipt(strategyId,{...IRA,accountLabel:'Example IRA',accountEquity:null,positions:[]});
 db.record(OWNER,'watch',watch(strategyId,iraReceipt,{...IRA,accountLabel:'Example IRA',lastError:'Synthetic quote failure',lastRunAt:'2026-11-12T18:49:30.000Z'}),accountKey(IRA));
 db.record(OWNER,'profile',{...CASH,registration:'taxable',label:LABELS[keyOf(CASH)],strategyId:null},accountKey(CASH));
 for(const [account,day,at,equity,cash] of valueRows())db.value(OWNER,account,day,at,equity,cash);
}

/** @description The value an invented account has on a day, from the seeded rows (the margin account's last two come from today-fixtures). */
function valueOn(account,day){
 const fixed={'2026-11-11':31216.58,'2026-11-12':31204.18};
 if(account===ACCOUNT&&fixed[day])return fixed[day];
 const row=valueRows().find(r=>r[0]===account&&r[1]===day);
 return row?row[3]:null;
}

/** @description The broker's roster of the invented accounts, as the kernel's trading.accounts read answers it. */
function brokerAccounts(){
 const live={kind:'live',notTrading:true,broker:'schwab',buyingPower:0,dayChange:null};
 return [
  {...ACCOUNT,...live,accountMasked:'···0001',accountType:'margin',equity:31204.18,cash:310.5,
   positions:[{symbol:'BIL',qty:204,marketValue:18670.08,avgEntryPrice:91.54,unrealizedPl:-3.1},{symbol:'SPY',qty:9,marketValue:6180.3,avgEntryPrice:673.3,unrealizedPl:120.44},{symbol:'GLD',qty:16,marketValue:6043.3,avgEntryPrice:378.83,unrealizedPl:-18.02}]},
  {...IRA,...live,accountMasked:'···0002',accountType:'ira',equity:valueOn(IRA,TODAY),cash:1250,
   positions:[{symbol:'VTI',qty:120,marketValue:38400,avgEntryPrice:290,unrealizedPl:3600},{symbol:'BND',qty:170,marketValue:valueOn(IRA,TODAY)-1250-38400,avgEntryPrice:75,unrealizedPl:null}]},
  {...CASH,...live,accountMasked:'···0003',accountType:'cash',equity:valueOn(CASH,TODAY),cash:2100,
   positions:[{symbol:'EXMP',qty:25,marketValue:valueOn(CASH,TODAY)-2100,avgEntryPrice:200,unrealizedPl:-412.5}]},
 ];
}

/**
 * @description Made-up daily closes for a benchmark, as the charts' bars read answers them.
 * @param {string} symbol 'SPY' or 'BIL'.
 * @returns {{symbol:string,source:string,timeframe:string,bars:Array<object>}} The answer.
 */
function benchmarkBars(symbol){
 const days=sessionDates('2025-11-03',TODAY),values=symbol==='BIL'?walk(days,91.2,5,0.0004):walk(days,600,7,0.01);
 return {symbol,source:'schwab',timeframe:'1Day',bars:days.map(day=>{const c=values.get(day);return {t:Date.parse(day+'T05:00:00Z')/1000,o:c,h:c,l:c,c,v:1000};})};
}

module.exports={OWNER,ACCOUNT,IRA,CASH,LABELS,keyOf,NOW,MARGIN_APPROVAL_ENDS,FIRST_DAY,TODAY,GAP_DAY,SATURDAY,historyDays,valueRows,valueOn,seedPortfolio,brokerAccounts,benchmarkBars};
