/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: the answer also carries the market days of the next two months from the same verified calendar (`upcoming`), so the page can name an account's next trade day beside its approval's end date. No new statement.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: GET /api/trading/paper/values, the read behind the portfolio overview (Roger, 2026-11-16: "for the landing page i should see my accounts my positions my trendlines over time per account with daily bars and comparisons"). It answers every daily value the watcher recorded for the caller's connected accounts over the last three years, in one SELECT on the caller's own rows, with the NYSE sessions of that span from the verified calendar. It is handed the pool and a logger and nothing else, so it cannot reach a broker, a price read or an order service, and it writes nothing.
 */
'use strict';
const {measured}=require('../trading-portfolio-model');
const {sessionDates}=require('../trading-portfolio-calendar');
const {etParts}=require('../paper/market');

/** The one statement this module sends. Read by the tests so it cannot drift. No ORDER BY: rows are sorted here. */
const SQL=Object.freeze({
 VALUES_ALL:'SELECT connection_key, account_id, observed_day, observed_at, equity, cash FROM trading_account_values WHERE user_sub=$1 AND observed_day>=$2 LIMIT 9500',
});
/** The answer stays under the kernel's 10,000-row refusal: three years of days for eight accounts is about 8,800 rows. */
const LIMITS=Object.freeze({rows:9500,days:1100});
const BASIS='The last value recorded each day for each connected account, cash included. Values are recorded while an account\'s watcher checks it. A change in value is not a return: deposits and withdrawals move it too.';

/** A JSON-lines logger for a caller that passes none (tests). */
const QUIET_LOG=Object.freeze({error(fields,message){process.stderr.write(JSON.stringify({level:'error',module:'trading-values',message,...(fields&&fields.err?{error:String(fields.err.message||fields.err)}:{})})+'\n');}});

const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const dayBefore=(day,days)=>new Date(Date.parse(day+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
/** How far ahead the market days are named for an account's next trade: two months covers the next month-end decision. */
const UPCOMING_DAYS=62;

/**
 * @description One saved row as a point, or null when a figure is not a number or the day is not a date. Never a guess.
 * @param {object} row A row of SQL.VALUES_ALL.
 * @returns {{key:string,accountId:string,connectionKey:string,point:object}|null} The point and the account it belongs to.
 */
function pointOf(row){
 const equity=row.equity==null?null:measured(Number(row.equity)),at=new Date(row.observed_at);
 if(equity===null||!isDay(String(row.observed_day))||!Number.isFinite(at.getTime())||!row.account_id||!row.connection_key)return null;
 const cash=row.cash==null?null:measured(Number(row.cash));
 return {key:String(row.connection_key)+'|'+String(row.account_id),accountId:String(row.account_id),connectionKey:String(row.connection_key),
  point:{day:String(row.observed_day),at:at.toISOString(),equity,cash}};
}

/**
 * @description Group the rows by account, one point per day (the later observation wins), oldest day first.
 * @param {Array<object>} rows Rows of SQL.VALUES_ALL.
 * @returns {{accounts:Array<object>,skipped:number}} The accounts with their points, and how many rows could not be read.
 */
function accountsOf(rows){
 const byKey=new Map();let skipped=0;
 for(const row of rows){
  const read=pointOf(row);
  if(!read){skipped+=1;continue;}
  const entry=byKey.get(read.key)||{accountId:read.accountId,connectionKey:read.connectionKey,days:new Map()};
  const prior=entry.days.get(read.point.day);
  if(!prior||prior.at<read.point.at)entry.days.set(read.point.day,read.point);
  byKey.set(read.key,entry);
 }
 const accounts=[...byKey.values()].map(e=>({accountId:e.accountId,connectionKey:e.connectionKey,points:[...e.days.values()].sort((a,b)=>a.day.localeCompare(b.day))}));
 return {accounts:accounts.sort((a,b)=>(a.connectionKey+'|'+a.accountId).localeCompare(b.connectionKey+'|'+b.accountId)),skipped};
}

/**
 * @description The NYSE sessions from the first recorded day to today, or null outside the verified 2024 to 2027 calendar.
 * @param {Array<object>} accounts Accounts with their points.
 * @param {string} today New York's date.
 * @returns {Array<string>|null} Session dates, oldest first.
 */
function sessionsOf(accounts,today){
 const first=accounts.map(a=>a.points[0]?.day).filter(isDay).sort()[0];
 if(!first)return [];
 const start=first<today?first:today;
 // A span the verified calendar does not cover gets null, and the page counts Monday to Friday instead.
 return start<'2024-01-01'||today>'2027-12-31'?null:sessionDates(start,today);
}

/**
 * @description The market days from today through the next two months, or null outside the verified 2024 to 2027 calendar.
 * @param {string} today New York's date.
 * @returns {Array<string>|null} Session dates, today first when it is one.
 */
function upcomingOf(today){
 const end=dayBefore(today,-UPCOMING_DAYS),last=end<'2027-12-31'?end:'2027-12-31';
 return today<'2024-01-01'||today>last?null:sessionDates(today,last);
}

/**
 * @description What the caller's saved daily values say about every connected account, for the overview's charts. Reads only:
 * one SELECT on the caller's own rows, no broker call, no price read, no kernel order service and no write.
 * @param {{pool:object,log?:object}} ctx The package pool and, optionally, the route's logger. Nothing else is used.
 * @param {string} owner The admitted caller.
 * @param {Date} [now] The server clock.
 * @returns {Promise<object>} The accounts with their daily points, the sessions of that span and whether the answer was cut.
 */
async function valuesRead(ctx,owner,now=new Date()){
 const log=ctx.log||QUIET_LOG,today=etParts(now).date,from=dayBefore(today,LIMITS.days);
 const rows=(await ctx.pool.query(SQL.VALUES_ALL,[owner,from])).rows||[];
 const {accounts,skipped}=accountsOf(rows);
 if(skipped)log.error({err:new Error(skipped+' saved value rows could not be read'),skipped},'saved account values skipped');
 return {ok:true,asOf:now.toISOString(),today,from,accounts,sessions:sessionsOf(accounts,today),upcoming:upcomingOf(today),cut:rows.length>=LIMITS.rows,skipped,basis:BASIS};
}

module.exports={SQL,LIMITS,valuesRead,accountsOf};
