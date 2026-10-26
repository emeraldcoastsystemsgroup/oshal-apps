/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain stored filing IDs and valid collector observation timestamps, count unavailable timing, and keep historical Congress performance explicitly unvalidated.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read bounded House/Senate purchases, screen explicit stock descriptions, retain primary filing provenance and bind current-universe research to the server-observed snapshot.
 */
import type {AppContext} from '@/app/composition/app-context';
import {PortfolioError} from './trading-portfolio-model';
import type {PortfolioStrategy} from './trading-portfolio-sim';
type Trade=Record<string,unknown>;
export const CONGRESS_UNIVERSE_NOTE='Current disclosed-purchase universe, screened from descriptions and primary filing links; broker instrument eligibility is unverified. Disclosures are delayed. A historical price test of this basket is selected-universe research, not a point-in-time backtest of following Congress. Stored first-seen time is collection evidence, not publication time; missing or invalid timestamps stay unavailable. Complete historical universe and timing validation remain separate.';
const day=(v:unknown):string|null=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const n=Date.parse(v+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v?v:null;};

/** This conservative text screen excludes uncertain instruments; it does not certify tradeability. */
export function congressStockDescription(value:unknown):boolean {
 if(typeof value!=='string'||!value.trim())return false;
 if(/\b(etf|fund|bond|treasury|option|call|put|strike|warrant|unit|trust|municipal|note|preferred)\b|exchange.traded|fixed.income/i.test(value))return false;
 return /common stock|ordinary shares|capital stock|\b(adr|ads|shs)\b/i.test(value);
}
export function projectCongressCandidates(trades:unknown[],at:Date) {
 const today=at.toISOString().slice(0,10),earliest=new Date(at.getTime()-90*86400000).toISOString().slice(0,10),seen=new Set<string>();
 const bySymbol=new Map<string,{symbol:string;buyers:Set<string>;latestDisclosure:string;filings:Trade[]}>();
 let excluded=0,duplicates=0;
 for(const raw of trades){
  const t=raw as Trade;
  if(!t||typeof t!=='object'){excluded++;continue;}
  const disclosure=day(t.disclosureDate),transaction=day(t.transactionDate),ticker=typeof t.ticker==='string'?t.ticker.toUpperCase():'';
  const rep=typeof t.representative==='string'?t.representative.trim():'';
  let filing:URL|null=null;try{filing=new URL(String(t.ptrLink));}catch{}
  const official=filing?.protocol==='https:'&&['disclosures-clerk.house.gov','efdsearch.senate.gov'].includes(filing.hostname);
  if(!['house','senate'].includes(String(t.chamber).toLowerCase())||t.direction!=='buy'||!rep||rep.toLowerCase()==='unknown'||!disclosure||!transaction||transaction>disclosure||disclosure>today||disclosure<earliest||!official||!['quiver-congress','stock-act-community-mirror'].includes(String(t.source))||!congressStockDescription(t.assetDescription)||!/^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker)){excluded++;continue;}
  const key=JSON.stringify([ticker,rep,transaction,disclosure,t.transactionType,t.amount,t.ptrLink]);
  if(seen.has(key)){duplicates++;continue;}seen.add(key);
  const row=bySymbol.get(ticker)??{symbol:ticker,buyers:new Set<string>(),latestDisclosure:disclosure,filings:[]};
  row.buyers.add(rep.toLowerCase());row.latestDisclosure=row.latestDisclosure>disclosure?row.latestDisclosure:disclosure;
  const observation=typeof t.observedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(t.observedAt)?Date.parse(t.observedAt):NaN;
  const observedAt=Number.isFinite(observation)&&observation>=Date.parse(disclosure+'T00:00:00Z')&&observation<=at.getTime()&&new Date(observation).toISOString()===t.observedAt?t.observedAt:null;
  const tradeId=typeof t.tradeId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(t.tradeId)?t.tradeId:null;
  row.filings.push({tradeId,observedAt,representative:rep,chamber:t.chamber,ticker,transactionDate:transaction,disclosureDate:disclosure,transactionType:t.transactionType,direction:t.direction,amount:t.amount,assetDescription:t.assetDescription,ptrLink:t.ptrLink,source:t.source});bySymbol.set(ticker,row);
 }
 const candidates=[...bySymbol.values()].map(r=>({symbol:r.symbol,distinctBuyers:r.buyers.size,latestDisclosure:r.latestDisclosure,filings:r.filings,instrumentStatus:'description-screened-stock; broker eligibility unverified'})).sort((a,b)=>b.distinctBuyers-a.distinctBuyers||b.latestDisclosure.localeCompare(a.latestDisclosure)||a.symbol.localeCompare(b.symbol));
 const filings=candidates.flatMap(c=>c.filings),withObservedAt=filings.filter(f=>f.observedAt!==null).length;
 return {candidates,excluded,duplicates,inputRows:trades.length,windowDays:90,readAt:at.toISOString(),observationCoverage:{filings:filings.length,withObservedAt,unavailable:filings.length-withObservedAt},note:CONGRESS_UNIVERSE_NOTE};
}

export async function readCongressCandidates(ctx:AppContext,at=new Date()) {
 const intent=(ctx as AppContext&{intent?:(name:string,input:Record<string,unknown>)=>Promise<unknown>}).intent;
 if(!intent)throw new PortfolioError(503,'congress_unavailable','The admitted disclosure archive is unavailable.');
 const requested=['House','Senate'],pages=await Promise.allSettled(requested.map(chamber=>intent('feeds.congress_trades',{chamber,direction:'buy',sinceDays:90,limit:200})));
 const trades:unknown[]=[],coverage:Array<{chamber:string;rows:number;atReadLimit:boolean}>=[];
 for(const [i,result]of pages.entries()){
  if(result.status==='rejected')throw new PortfolioError(502,'congress_unavailable','Both House and Senate purchase reads must succeed before building a candidate basket.');
  const page=result.value as {trades?:unknown[];source?:string};
  if(page.source!=='world_congress_trades'||!Array.isArray(page.trades)||page.trades.length>200)throw new PortfolioError(502,'congress_invalid','The archive did not return the expected bounded disclosure records.');
  trades.push(...page.trades);coverage.push({chamber:requested[i],rows:page.trades.length,atReadLimit:page.trades.length===200});
 }
 return {...projectCongressCandidates(trades,at),coverage,possiblyTruncated:coverage.some(r=>r.atReadLimit),status:'ok',source:'world_congress_trades'};
}

/** Current source selection is bound to immutable evidence; it is never historical entry evidence. */
export async function congressStrategyEvidence(ctx:AppContext,selection:unknown,config:PortfolioStrategy,at:Date) {
 if(!Array.isArray(selection)||selection.length<1||selection.length>10||selection.some(s=>typeof s!=='string')||new Set(selection).size!==selection.length||config.modelVersion!==2||config.kind!=='monthly-trend')throw new PortfolioError(422,'congress_selection_invalid','Choose one to ten distinct disclosed-stock candidates with the defensive monthly trend model.');
 const symbols=[...selection].sort();
 if(JSON.stringify(symbols)!==JSON.stringify(config.assets.map(a=>a.symbol).sort())||config.assets.some(a=>Math.abs(a.weightPct-100/symbols.length)>1e-6))throw new PortfolioError(422,'congress_selection_invalid','The selected disclosure symbols and equal-weight strategy basket must match.');
 const evidence=await readCongressCandidates(ctx,at),allowed=new Set(evidence.candidates.map(c=>c.symbol));
 if(symbols.some(s=>!allowed.has(s)))throw new PortfolioError(409,'congress_universe_changed','A selected name is no longer in the verified purchase candidate set. Reload and review it.');
 return {...evidence,selectedSymbols:symbols,selectedFilings:evidence.candidates.filter(c=>symbols.includes(c.symbol)),historicalCongressStrategyValidated:false};
}
