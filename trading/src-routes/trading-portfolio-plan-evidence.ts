/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the defensive fund and full calendar-month warmup in version2 rotation research and planning.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read complete, bounded quote evidence through caller-owned Schwab connections. Only named read intents, exact symbols and actual trade timestamps cross into the planner.
 */
import type {AppContext} from '@/app/composition/app-context';
import {PortfolioError,type PortfolioRow} from './trading-portfolio-model';
import {canonicalPlanSymbol,type PlanQuote} from './trading-portfolio-plan';
import type {PortfolioStrategy} from './trading-portfolio-sim';
import {portfolioStrategySymbols} from './trading-portfolio-rotation';
/** Every held instrument participates in the preview, including names outside the saved strategy. */
export function planSymbols(account:PortfolioRow,config:PortfolioStrategy):string[] {
 if(!Array.isArray(account.positions)||account.positions.length>200)throw new PortfolioError(422,'plan_holdings_incomplete','A preview requires all reported holdings together, up to 200 positions. None are omitted.');
 const symbols=[...new Set([...portfolioStrategySymbols(config).map(canonicalPlanSymbol),...(account.positions as PortfolioRow[]).map(p=>canonicalPlanSymbol(p.symbol))])].sort();
 if(symbols.length>200)throw new PortfolioError(422,'plan_quote_limit','The complete preview exceeds 200 unique instruments. No partial preview is produced.');
 return symbols;
}
/** Read groups of fifty through the existing intent; no URL, owner or credential can come from a request. */
export async function readPlanQuotes(ctx:AppContext,connection:string,symbols:string[]) {
 const host=ctx as AppContext&{intent?:(name:string,input:Record<string,unknown>)=>Promise<unknown>};
 if(!host.intent)throw new PortfolioError(503,'plan_quotes_unavailable','The current caller has no native quote service.');
 const intent=host.intent,quotes:PlanQuote[]=[],deadline=Date.now()+45000;
 for(let offset=0;offset<symbols.length;offset+=50){
  if(Date.now()>deadline)throw new PortfolioError(504,'plan_quote_timeout','Quote reads exceeded the preview time budget. No incomplete preview was stored.');
  const requested=symbols.slice(offset,offset+50),answer=await intent('trading.quotes',{connection,symbols:requested}) as {source?:string;quotes?:PlanQuote[]};
  if(answer?.source!=='schwab'||!Array.isArray(answer.quotes)||answer.quotes.length!==requested.length)throw new PortfolioError(502,'plan_quotes_incomplete','Schwab did not return the complete quote roster. No holding is dropped.');
  const seen=new Set<string>();
  for(const q of answer.quotes){
   const symbol=canonicalPlanSymbol(q?.symbol);
   if(!requested.includes(symbol)||seen.has(symbol))throw new PortfolioError(502,'plan_quotes_invalid','The quote response contains a different or duplicated instrument.');
   seen.add(symbol);quotes.push({symbol,tradePrice:q.tradePrice,tradeAt:q.tradeAt,source:q.source,delayed:q.delayed,
    ...(q.quoteAt!==undefined?{quoteAt:q.quoteAt,bidPrice:q.bidPrice,askPrice:q.askPrice,bidSize:q.bidSize,askSize:q.askSize}:{})});
  }
 }
 return {connection,quotes,source:'schwab',readAt:new Date().toISOString()};
}
