/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Expose the verified holiday/early-close session clock for planning quote freshness.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bounded NYSE daily-session coverage for portfolio research, including the 2025 national day of mourning. Refuse unsupported calendar years.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the verified 2024 calendar for long warmups and choose research defaults from the last completed session, including Monday mornings.
 * https://www.nyse.com/publicdocs/ICE_NYSE_2024_Yearly_Trading_Calendar.pdf
 * Sources: https://www.nyse.com/trade/hours-calendars
 * https://www.nyse.com/publicdocs/ICE_NYSE_2025_Yearly_Trading_Calendar.pdf
 * https://ir.theice.com/press/news-details/2024/The-New-York-Stock-Exchange-Will-Close-Markets-on-January-9-to-Honor-the-Passing-of-Former-President-Jimmy-Carter-on-National-Day-of-Mourning/default.aspx
 */
import { PortfolioError } from './trading-portfolio-model';
const CLOSED = new Set([
 '2024-01-01','2024-01-15','2024-02-19','2024-03-29','2024-05-27','2024-06-19','2024-07-04','2024-09-02','2024-11-28','2024-12-25',
 '2025-01-01','2025-01-09','2025-01-20','2025-02-17','2025-04-18','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
 '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
 '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
]);
const HALF = new Set(['2024-07-03','2024-11-29','2024-12-24','2025-07-03','2025-11-28','2025-12-24','2026-11-27','2026-12-24','2027-11-26']);
export function validDay(day: unknown): string {
 if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day+'T00:00:00Z')) || new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)
  throw new PortfolioError(400,'window_invalid','Use valid calendar dates in YYYY-MM-DD format.');
 return day;
}
export function sessionDates(start: string, end: string): string[] {
 validDay(start);validDay(end);
 if (start<'2024-01-01' || end>'2027-12-31' || start>end) throw new PortfolioError(422,'calendar_unavailable','The verified session calendar covers 2024 through 2027.');
 const days:string[]=[];
 for(let at=Date.parse(start+'T00:00:00Z');at<=Date.parse(end+'T00:00:00Z');at+=86400000){
  const d=new Date(at),day=d.toISOString().slice(0,10);
  if(d.getUTCDay()>0 && d.getUTCDay()<6 && !CLOSED.has(day))days.push(day);
 }
 return days;
}
/** A 15-minute close publication allowance; unfinished daily bars never enter research. */
export function lastCompletedSession(now: Date): string {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`;
 const days=sessionDates(new Date(Date.parse(today+'T00:00:00Z')-14*86400000).toISOString().slice(0,10),today);
 const minute=Number(parts.hour)*60+Number(parts.minute),close=HALF.has(today)?13*60:16*60;
 return days.filter(day=>day<today || minute>=close+15).at(-1)!;
}

/** Server-derived dates avoid a Saturday default on Monday and do not require a browser clock. */
export function portfolioResearchWindow(now=new Date()) {
 try {
  const latestCompletedSession=lastCompletedSession(now);
  return {available:true,latestCompletedSession,suggestedStart:new Date(Date.parse(latestCompletedSession+'T00:00:00Z')-365*86400000).toISOString().slice(0,10),reason:null};
 }catch(error){
  if(!(error instanceof PortfolioError))throw error;
  return {available:false,latestCompletedSession:null,suggestedStart:null,reason:error.message};
 }
}

/** Exchange-session clock for quote freshness; holidays and early closes use the same verified calendar. */
export function nyseSessionClock(now:Date) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(v=>[v.type,v.value]));
 const date=`${p.year}-${p.month}-${p.day}`,minutes=Number(p.hour)*60+Number(p.minute),close=HALF.has(date)?13*60:16*60;
 const session=sessionDates(date,date).length===1;
 return {date,minutes,close,session,regular:session&&minutes>=9*60+30&&minutes<close};
}
