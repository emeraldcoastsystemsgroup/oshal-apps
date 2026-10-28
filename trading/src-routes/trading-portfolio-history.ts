/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Bound study evidence by its requested end before comparing daily closes; later conflicting prices cannot enter or invalidate an earlier study.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the defensive fund and full calendar-month warmup in version2 rotation research and planning.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read bounded caller-owned Schwab daily history, retain source snapshots, reject contradictory overlap, unfinished bars and future windows.
 */
import type {AppContext} from '@/app/composition/app-context';
import {PortfolioError,measured} from './trading-portfolio-model';
import {lastCompletedSession,validDay} from './trading-portfolio-calendar';
import type {DailyPrice,PortfolioStrategy} from './trading-portfolio-sim';
import {portfolioStrategySymbols,portfolioWarmupSessions} from './trading-portfolio-rotation';
export async function portfolioHistory(ctx:AppContext,connection:string,strategy:PortfolioStrategy,start:string,end:string,now=new Date()) {
 validDay(start);validDay(end);
 const latest=lastCompletedSession(now),nowMs=now.getTime();
 if(start>=end || end>latest || Date.parse(end)-Date.parse(start)>370*86400000 || Date.parse(start)<nowMs-700*86400000)
  throw new PortfolioError(422,'window_invalid','Choose a completed historical window of at most one year within the available history.');
 const host=ctx as AppContext & {intent?:(name:string,input:Record<string,unknown>)=>Promise<unknown>};
 if(!host.intent)throw new PortfolioError(503,'history_unavailable','Caller-authorized price history is unavailable.');
 const intent=host.intent;
 const symbols=[...new Set([...portfolioStrategySymbols(strategy),'SPY'])],series:Record<string,DailyPrice[]>={};
 const earliestNeeded=Date.parse(start)-Math.ceil(portfolioWarmupSessions(strategy)*1.6+20)*86400000;
 const ends=[nowMs];if(earliestNeeded<nowMs-380*86400000)ends.push(nowMs-350*86400000);
 const deadline=Date.now()+90000;
 const readSymbol=async(symbol:string)=>{
  const rows=new Map<string,number>();
  for(const endMs of ends){
   if(Date.now()>deadline)throw new PortfolioError(504,'history_timeout','Historical reads exceeded their time budget. Narrow the asset universe and retry.');
   const answer=await intent('trading.bars',{symbol,timeframe:'1Day',connection,end:Math.floor(endMs)}) as {symbol?:string;source?:string;bars?:Array<{t:number;c:number}>};
   if(answer.symbol!==symbol||answer.source!=='schwab'||!Array.isArray(answer.bars)||answer.bars.length>10000)
    throw new PortfolioError(502,'history_invalid',`${symbol} history did not provide the expected source and symbol.`);
   for(const bar of answer.bars){
    if(measured(bar.t)===null)throw new PortfolioError(502,'history_invalid',`${symbol} contains a malformed daily timestamp.`);
    const date=new Date(bar.t*1000).toISOString().slice(0,10);
    if(date>end)continue;
    if(measured(bar.c)===null||bar.c<=0)throw new PortfolioError(502,'history_invalid',`${symbol} contains malformed daily prices.`);
    const old=rows.get(date);if(old!==undefined&&old!==bar.c)throw new PortfolioError(409,'history_changed',`${symbol} history changed between reads. Retry the backtest.`);
    rows.set(date,bar.c);
   }
  }
  series[symbol]=[...rows].sort(([a],[b])=>a.localeCompare(b)).map(([date,close])=>({date,close}));
 };
 for(let offset=0;offset<symbols.length;offset+=2){
  const results=await Promise.allSettled(symbols.slice(offset,offset+2).map(readSymbol));
  const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult|undefined;
  if(failed)throw failed.reason;
 }
 return {series,source:'schwab',readAt:now.toISOString(),lastCompletedSession:latest,requestedEndDate:end,priceBasis:'provider daily closes; no total-return adjustment asserted'};
}
