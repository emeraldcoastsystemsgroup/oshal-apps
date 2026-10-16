/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read bounded SEC concept documents instead of oversized companyfacts through existing admitted egress, with public provenance and bounded cache.
 */
import {EDGAR_UA} from './trading-edgar-filings';
import {FINANCIAL_CONCEPTS, secFinancialSummary} from './trading-sec-fundamentals';
const cache = new Map<string,{at:number;value:ReturnType<typeof secFinancialSummary>}>();
let nextRequest = 0;

/** Four financial requests per second per process; callers never supply arbitrary URLs. */
async function financialJson(url: string): Promise<unknown | null> {
  const slot = Math.max(Date.now(),nextRequest);
  if (slot-Date.now() > 15000) throw new Error('SEC financial reader is busy; try again shortly.');
  nextRequest = slot+250;
  if (slot > Date.now()) await new Promise(resolve => setTimeout(resolve,slot-Date.now()));
  const response = await fetch(url,{headers:{'User-Agent':EDGAR_UA,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`SEC financial source is unavailable (HTTP ${response.status}).`);
  return response.json();
}

/** Public data only; each uncached read remains under the request's original egress admission. */
export async function readSecFinancialSummary(cik: string, symbol: string) {
  if (!/^\d{10}$/.test(cik) || !/^[A-Z.\-]{1,10}$/.test(symbol)) throw new Error('SEC financial company identity is invalid.');
  const hit = cache.get(cik);
  if (hit && Date.now()-hit.at < 3600000) return {...hit.value,symbol};
  const documents: unknown[] = [];
  const deadline = Date.now()+30000;
  for (const [taxonomy,tag] of FINANCIAL_CONCEPTS) {
    if (Date.now() > deadline) throw new Error('SEC financial read timed out.');
    documents.push(await financialJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`));
  }
  if (Date.now() > deadline) throw new Error('SEC financial read timed out.');
  const value = secFinancialSummary(documents,cik,symbol,new Date().toISOString());
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(cik,{at:Date.now(),value});
  return value;
}
