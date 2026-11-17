/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0, coordinator's added scope: an account's approval end date in words (approvalNotice). It warns when the approval ends within 14 days, or before the account's next trade: the market day after the month-end close the next monthly decision uses, or the next market day for a daily plan (a review found two approvals ending Nov 30, 2026 06:38Z, before the Dec 1 monthly trade).
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: the portfolio overview's arithmetic, kept apart from the page so it can be tested on its own. Each account's recorded daily values are laid on the market days (the NYSE sessions the server sends, or Monday to Friday without them); a day with no record is a gap and is never filled, smoothed or bridged. A daily bar is the change from the market day before, and only when both days are recorded. The total adds the accounts on the days every one of them is recorded. A range is cut back from the newest day; percent change counts from the first recorded value inside the range. This module makes no request and changes nothing.
 */
'use strict';
// A private lexical block keeps classic-script names isolated, as account-story.js does.
{
 const DAY_MS=86400000;
 const RANGES=Object.freeze(['1W','1M','3M','YTD','1Y','ALL']);
 const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'));
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const round=(value,places)=>Math.round(value*10**places)/10**places;
 const addDays=(day,days)=>new Date(Date.parse(day+'T00:00:00Z')+days*DAY_MS).toISOString().slice(0,10);

 /**
  * @description The days a value is expected on, oldest first: the sessions the server sent, or Monday to Friday when it sent none.
  * @param {string} from First day, inclusive.
  * @param {string} to Last day, inclusive.
  * @param {Array<string>|null} sessions NYSE session dates, or null when the verified calendar does not cover the span.
  * @returns {Array<string>} The expected days.
  */
 function expectedDays(from,to,sessions){
  if(!isDay(from)||!isDay(to)||from>to)return [];
  if(Array.isArray(sessions))return sessions.filter(day=>isDay(day)&&day>=from&&day<=to).sort();
  const days=[];
  for(let day=from;day<=to;day=addDays(day,1)){const weekday=new Date(day+'T00:00:00Z').getUTCDay();if(weekday>0&&weekday<6)days.push(day);}
  return days;
 }

 /**
  * @description Drop the days with no value before the first recorded day and after the last one; gaps inside stay.
  * @param {Array<{day:string,value:number|null}>} series A series.
  * @returns {Array<object>} The trimmed series.
  */
 function trim(series){
  const first=series.findIndex(p=>finite(p.value));
  if(first<0)return [];
  let last=series.length-1;
  while(!finite(series[last].value))last-=1;
  return series.slice(first,last+1);
 }

 /**
  * @description One account's recorded values on the expected days between its first and last record. A day with no record
  *   is null (a gap). A record made on a day that is not a market day (a weekend or a holiday) is not on the grid.
  * @param {Array<{day:string,at?:string,equity:number}>} points Recorded points, one per day.
  * @param {Array<string>|null} sessions NYSE sessions, or null.
  * @returns {Array<{day:string,value:number|null,at:string|null}>} The series, oldest first.
  */
 function accountSeries(points,sessions){
  const byDay=new Map((points||[]).filter(p=>p&&isDay(p.day)&&finite(p.equity)).map(p=>[p.day,p]));
  const recorded=[...byDay.keys()].sort();
  if(!recorded.length)return [];
  return trim(expectedDays(recorded[0],recorded.at(-1),sessions).map(day=>{const p=byDay.get(day);return {day,value:p?p.equity:null,at:p&&p.at||null};}));
 }

 /**
  * @description The change from the expected day before, in dollars and percent. It is null when either day has no record:
  *   a gap is never bridged, so a bar never spans two market days.
  * @param {Array<{day:string,value:number|null}>} series A series on expected days.
  * @returns {Array<{day:string,change:number|null,pct:number|null}>} One entry per day of the series.
  */
 function dailyChanges(series){
  return series.map((p,i)=>{
   const before=i>0?series[i-1].value:null;
   if(!finite(p.value)||!finite(before))return {day:p.day,change:null,pct:null};
   return {day:p.day,change:round(p.value-before,2),pct:before>0?round((p.value/before-1)*100,4):null};
  });
 }

 /**
  * @description The total of the accounts on each expected day that every one of them is recorded. It starts on the first
  *   day all accounts have a record (an account that starts later would otherwise add its whole value as a change) and a day
  *   any account is missing is a gap.
  * @param {Array<Array<object>>} list The accounts' series.
  * @returns {Array<{day:string,value:number|null}>} The total, oldest first.
  */
 function totalSeries(list){
  const series=(list||[]).filter(s=>Array.isArray(s)&&s.length);
  if(!series.length)return [];
  const maps=series.map(s=>new Map(s.map(p=>[p.day,p.value])));
  const start=series.map(s=>s[0].day).sort().at(-1),end=series.map(s=>s.at(-1).day).sort().at(-1);
  const days=[...new Set(series.flatMap(s=>s.map(p=>p.day)))].filter(day=>day>=start&&day<=end).sort();
  return trim(days.map(day=>{const values=maps.map(m=>m.get(day));return {day,value:values.every(finite)?round(values.reduce((n,v)=>n+v,0),2):null};}));
 }

 /**
  * @description The first day a range shows, counted back from the newest day: a week, one or three calendar months, the
  *   calendar year, or a year. ALL has no start.
  * @param {string} last The newest day.
  * @param {string} range One of RANGES.
  * @returns {string|null} The first day, inclusive, or null for everything.
  */
 function rangeStart(last,range){
  if(!isDay(last)||range==='ALL'||!RANGES.includes(range))return null;
  if(range==='1W')return addDays(last,-7);
  const [year,month,day]=last.split('-').map(Number);
  if(range==='YTD')return year+'-01-01';
  const back=new Date(Date.UTC(year,month-1-{'1M':1,'3M':3,'1Y':12}[range],1));
  const length=new Date(Date.UTC(back.getUTCFullYear(),back.getUTCMonth()+1,0)).getUTCDate();
  return new Date(Date.UTC(back.getUTCFullYear(),back.getUTCMonth(),Math.min(day,length))).toISOString().slice(0,10);
 }

 /**
  * @description The rows on or after a range's first day.
  * @param {Array<{day:string}>} rows Any rows with a day.
  * @param {string|null} start First day, or null for all.
  * @returns {Array<object>} The rows in the range.
  */
 function inRange(rows,start){return start?rows.filter(r=>r.day>=start):rows.slice();}

 /**
  * @description The change between the first and the last recorded value of a series, in dollars and percent.
  * @param {Array<{day:string,value:number|null}>} series A series, usually cut to a range.
  * @returns {{first:object|null,last:object|null,change:number|null,pct:number|null}} The change, null with fewer than two values.
  */
 function spanChange(series){
  const known=series.filter(p=>finite(p.value)),first=known[0]||null,last=known.at(-1)||null;
  if(known.length<2)return {first,last,change:null,pct:null};
  return {first,last,change:round(last.value-first.value,2),pct:first.value>0?round((last.value/first.value-1)*100,4):null};
 }

 /**
  * @description Each value as the percent change from the series' first recorded value; gaps stay gaps.
  * @param {Array<{day:string,value:number|null}>} series A series, usually cut to a range.
  * @returns {{base:string|null,points:Array<{day:string,pct:number|null}>}} The first day counted from, and the points.
  */
 function percentSeries(series){
  const base=series.find(p=>finite(p.value)&&p.value>0)||null;
  return {base:base?base.day:null,points:series.map(p=>({day:p.day,pct:base&&finite(p.value)?round((p.value/base.value-1)*100,4):null}))};
 }

 /**
  * @description Daily closes by day from a bars answer: the broker's candles, or the price archive's line. A day with two
  *   different closes makes the whole answer unreadable rather than picking one.
  * @param {object} answer GET /api/trading-charts/bars.
  * @returns {Map<string,number>|null} Close by day, or null when the answer cannot be read.
  */
 function closesOf(answer){
  const rows=Array.isArray(answer?.bars)&&answer.bars.length?answer.bars.map(b=>[b?.t,b?.c]):Array.isArray(answer?.line)?answer.line.map(p=>[p?.t,p?.v]):null;
  if(!rows)return null;
  const closes=new Map();
  for(const [t,close] of rows){
   if(!finite(t)||!finite(close)||close<=0)continue;
   const day=new Date(t*1000).toISOString().slice(0,10);
   if(closes.has(day)&&closes.get(day)!==close)return null;
   closes.set(day,close);
  }
  return closes.size?closes:null;
 }

 /**
  * @description A benchmark on the comparison's days, as percent change from its close on the first day it has one on or
  *   after the comparison's first day.
  * @param {Map<string,number>|null} closes Close by day.
  * @param {Array<string>} days The comparison's days.
  * @returns {{base:string|null,points:Array<{day:string,pct:number|null}>}|null} The benchmark, or null without closes.
  */
 function benchmarkSeries(closes,days){
  if(!closes||!days.length)return null;
  const series=days.map(day=>({day,value:closes.has(day)?closes.get(day):null}));
  return series.some(p=>finite(p.value))?percentSeries(series):null;
 }

 /**
  * @description Whether a range asks for more than the history holds, and the day the history starts.
  * @param {Array<{day:string}>} series The full series.
  * @param {string|null} start The range's first day.
  * @param {Array<string>|null} sessions NYSE sessions, or null.
  * @returns {{starts:string|null,short:boolean}} The first recorded day and whether the range reaches before it.
  */
 function coverage(series,start,sessions){
  const first=series[0]?.day||null;
  if(!first||!start||first<=start)return {starts:first,short:false};
  // The sessions the server sends begin at the first record, so a range reaching before it is counted in weekdays.
  const covered=Array.isArray(sessions)&&sessions.length>0&&sessions[0]<=start;
  return {starts:first,short:expectedDays(start,addDays(first,-1),covered?sessions:null).length>0};
 }

 /**
  * @description One series with everything the page draws for it inside a range: the cut points, the daily changes (the
  *   first one counts from the market day before the range), the newest day's change, the change over the range and its
  *   percent points.
  * @param {Array<object>} all The full series.
  * @param {string|null} start The range's first day.
  * @param {Array<string>|null} sessions NYSE sessions, or null.
  * @returns {object} The series in the range.
  */
 function described(all,start,sessions){
  const changes=dailyChanges(all),points=inRange(all,start);
  return {all,points,changes:inRange(changes,start),latest:[...all].reverse().find(p=>finite(p.value))||null,day:changes.at(-1)||null,
   span:spanChange(points),percent:percentSeries(points),coverage:coverage(all,start,sessions)};
 }

 /**
  * @description Everything the overview draws for one range, from GET /paper/values: each account's series, the total, the
  *   range's first day, the days the comparison runs over and which accounts stop before the newest day.
  * @param {{accounts:Array<object>,sessions:Array<string>|null}} input The values read.
  * @param {string} range One of RANGES.
  * @returns {object} The accounts, the total, the range and the comparison days.
  */
 function overview(input,range){
  const sessions=Array.isArray(input?.sessions)?input.sessions:null;
  const accounts=(input?.accounts||[]).map(a=>({key:a.connectionKey+'|'+a.accountId,accountId:a.accountId,connectionKey:a.connectionKey,series:accountSeries(a.points,sessions)}))
   .filter(a=>a.series.length);
  const total=totalSeries(accounts.map(a=>a.series));
  const last=accounts.map(a=>a.series.at(-1).day).sort().at(-1)||null,start=rangeStart(last,range);
  const shown=accounts.map(a=>({...a,...described(a.series,start,sessions)}));
  const bases=shown.map(a=>a.percent.base).filter(isDay).sort();
  return {range,start,last,sessions,accounts:shown,total:described(total,start,sessions),
   compareDays:bases.length?expectedDays(bases[0],last,sessions):[],lagging:shown.filter(a=>a.series.at(-1).day<last).map(a=>a.key)};
 }


 const WARN_DAYS=14;
 const NY_DAY=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
 const NY_TIME=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const words=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});

 /**
  * @description The first market day after a day: from the sessions the server named ahead, or Monday to Friday past them.
  * @param {string} after A day.
  * @param {Array<string>|null} upcoming The next market days, oldest first, or null.
  * @returns {string|null} The next market day.
  */
 function nextSession(after,upcoming){
  if(!isDay(after))return null;
  const known=Array.isArray(upcoming)?upcoming.filter(isDay).sort():[];
  if(known.length&&after<known.at(-1))return known.find(day=>day>after)||null;
  return expectedDays(addDays(after,1),addDays(after,7),null)[0]||null;
 }

 /** @description The instant the regular session opens (9:30 in New York) on a day. @param {string} day A day. @returns {number} Epoch milliseconds. */
 function sessionOpenMs(day){
  const [year,month,date]=day.split('-').map(Number);
  for(const hour of [13,14]){const at=Date.UTC(year,month-1,date,hour,30);if(NY_TIME.format(new Date(at))==='09:30')return at;}
  return Date.UTC(year,month-1,date,14,30);
 }

 /**
  * @description An account's next trade day: the market day after the month-end close its next monthly decision uses, or for
  *   a daily plan the market day after the last completed one.
  * @param {object|null} plan GET /paper/today's plan ({cadence, nextDecisionUses}).
  * @param {{upcoming:Array<string>|null,latestSession:string|null}} options The next market days and the last completed one.
  * @returns {string|null} The day, or null when the plan does not say.
  */
 function nextTradeDay(plan,options){
  if(plan&&plan.cadence==='monthly')return isDay(plan.nextDecisionUses)?nextSession(plan.nextDecisionUses,options.upcoming):null;
  return plan&&plan.cadence==='daily'&&isDay(options.latestSession)?nextSession(options.latestSession,options.upcoming):null;
 }

 /**
  * @description What the overview says about an account's approval: when it ends, and plainly when that is within 14 days or
  *   before the account's next trade. An approval that is off for another reason (stopped, a changed source) is the status
  *   tab's to explain, so it says nothing here.
  * @param {object|null} approval GET /paper/today's monitor.approval ({status, active, expiresAt}).
  * @param {object|null} plan GET /paper/today's plan.
  * @param {{now:number,upcoming:Array<string>|null,latestSession:string|null}} options The clock, the next market days and the last completed one.
  * @returns {{endDay:string,nextTrade:string|null,daysLeft:number,reason:string|null,warn:boolean,text:string}|null} The notice, or null.
  */
 function approvalNotice(approval,plan,options){
  const ends=approval&&typeof approval.expiresAt==='string'?Date.parse(approval.expiresAt):NaN;
  if(!Number.isFinite(ends))return null;
  const endDay=NY_DAY.format(new Date(ends)),daysLeft=Math.ceil((ends-options.now)/86400000),ended=ends<=options.now||approval.status==='expired';
  if(!ended&&approval.active!==true)return null;
  const nextTrade=ended?null:nextTradeDay(plan,options),beforeTrade=Boolean(nextTrade)&&ends<sessionOpenMs(nextTrade);
  const reason=ended?'ended':beforeTrade?'before-trade':daysLeft<=WARN_DAYS?'soon':null;
  const today=NY_DAY.format(new Date(options.now)),soon=endDay===today?'today':endDay===addDays(today,1)?'tomorrow':'in '+daysLeft+' days';
  const text=ended?'Approval ended '+words(endDay)+'.':'Approval ends '+words(endDay)+(reason==='before-trade'?', before the '+words(nextTrade)+' trade.':reason==='soon'?', '+soon+'.':'.');
  return {endDay,nextTrade,daysLeft,reason,warn:reason!==null,text};
 }

 const api={RANGES,isDay,expectedDays,trim,accountSeries,dailyChanges,totalSeries,rangeStart,inRange,spanChange,percentSeries,closesOf,benchmarkSeries,coverage,overview,
  nextSession,sessionOpenMs,nextTradeDay,approvalNotice,WARN_DAYS};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof globalThis==='object')globalThis.PortfolioSeries=api;
}
