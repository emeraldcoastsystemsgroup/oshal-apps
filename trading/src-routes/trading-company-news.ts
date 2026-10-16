/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read caller-owned Finnhub company headlines through declared fenced egress; retain publication/retrieval evidence and distinguish failures from empty results.
 */
import type { NewsItem } from '@/features/trading';
export interface NewsCoverage { source: string; fetchedAt: string; from: string; through: string; excluded: number; note: string }
export interface CompanyNews { items: NewsItem[]; coverage: NewsCoverage }
const WINDOW = 7 * 86400000;
let nextRequest = 0;

/** External article URLs are navigation only; credentials and executable schemes are refused. */
function articleUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
/** Validate the documented CompanyNews array, retaining only exact-symbol, dated recent articles. */
export function companyNews(raw: unknown, symbol: string, at: number): CompanyNews {
  if (!/^[A-Z.\-]{1,10}$/.test(symbol) || !Number.isFinite(at)) throw new Error('Company news request is invalid.');
  if (!Array.isArray(raw) || raw.length > 5000) throw new Error('Finnhub returned an invalid company news response.');
  const items: NewsItem[] = [], seen = new Set<string>(); let excluded = 0;
  for (const row of raw) {
    const url = articleUrl(row?.url), published = typeof row?.datetime === 'number' ? row.datetime * 1000 : NaN;
    const related = typeof row?.related === 'string' ? row.related.split(',').map((s: string) => s.trim().toUpperCase()) : [];
    if (!url || !Number.isSafeInteger(row?.id) || row.id < 0 || !Number.isFinite(published) || published < at-WINDOW || published > at
      || !related.includes(symbol) || typeof row?.headline !== 'string' || !row.headline.trim() || row.headline.length > 1000
      || typeof row?.source !== 'string' || !row.source.trim() || row.source.length > 240
      || (row.summary != null && typeof row.summary !== 'string')) { excluded++; continue; }
    if (seen.has(url) || seen.has('id:'+row.id)) { excluded++; continue; }
    seen.add(url); seen.add('id:'+row.id);
    items.push({id:row.id,symbols:[symbol],headline:row.headline.trim(),summary:(row.summary || '').slice(0,2000),source:row.source,url,createdAt:new Date(published).toISOString()});
  }
  if (raw.length && !items.length) throw new Error('Finnhub returned no usable recent company headlines; returned items lacked matching, safe or current evidence.');
  items.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id-a.id);
  return {items:items.slice(0,25),coverage:{source:'Finnhub company news',fetchedAt:new Date(at).toISOString(),from:new Date(at-WINDOW).toISOString(),through:new Date(at).toISOString(),excluded,
    note:'North American company headlines supplied by Finnhub; publisher and publication time are reported per article. Coverage is limited to this source and the last seven days.'}};
}
/** No credential or result cache: each caller is re-admitted against their current saved connection. */
export async function readCompanyNews(symbol: string): Promise<CompanyNews> {
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) throw new Error('Company news symbol is invalid.');
  const slot = Math.max(Date.now(),nextRequest);
  if (slot-Date.now() > 5000) throw new Error('Company news reader is busy; try again shortly.');
  nextRequest = slot+1000;
  if (slot > Date.now()) await new Promise(resolve => setTimeout(resolve,slot-Date.now()));
  const started = Date.now(), from = new Date(started-WINDOW).toISOString().slice(0,10), to = new Date(started).toISOString().slice(0,10);
  let response: Response;
  try {
    response = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`,{
      headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  } catch { throw new Error('Company news could not be read. Check your Finnhub connection in Settings → Connections or try again shortly.'); }
  if (!response.ok) throw new Error(response.status === 429 ? 'Finnhub company news is rate limited; try again shortly.'
    : [401,403].includes(response.status) ? 'Finnhub company news authorization was refused. Check your saved connection and plan access.'
    : `Finnhub company news is unavailable (HTTP ${response.status}).`);
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error('Finnhub returned invalid company news JSON.'); }
  return companyNews(raw,symbol,Date.now());
}
