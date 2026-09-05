"use strict";
/**
 * EDGAR filings decoder (ADR-138) — the PURE half of single-stock research. Given the SEC's keyless
 * JSON (company_tickers.json and submissions/CIK##########.json) it picks out the latest 10-K and
 * 10-Q, the recent 8-Ks with their item codes decoded to plain English, the events those 8-Ks
 * announce, and a cadence-based ESTIMATE of the next earnings date. Nothing here fetches or logs:
 * the research routes do the network I/O (with the SEC's required contact User-Agent) and hand the
 * parsed JSON in, so every function is unit-testable against a fixture and the route can mark a
 * section 'unavailable' instead of guessing when EDGAR is unreachable.
 *
 * The estimate is a cadence (last item-2.02 8-K + ~91 days, rolled forward to today or later). The
 * route labels it 'cadence-estimate' and reaches for the world calendar first — an estimate is
 * never presented as the calendar.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ticker→CIK lookup over company_tickers.json (10-digit zero-padded), submissions parse over the parallel recent arrays (form/filingDate/accessionNumber/primaryDocument/items), document url builder (numeric CIK + un-dashed accession + primaryDocument), the 8-K item decoder (1.01…9.01; 9.01 Exhibits dropped from the plain list when other items exist), an event kind per item code, past results = item-2.02 dates, and the next-earnings cadence estimate.
 *
 * @module trading-edgar-filings
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EIGHT_K_ITEMS = exports.EARNINGS_CADENCE_DAYS = exports.EDGAR_TICKER_CACHE_MS = exports.EDGAR_TICKERS_URL = exports.EDGAR_UA = void 0;
exports.edgarSubmissionsUrl = edgarSubmissionsUrl;
exports.edgarDocumentUrl = edgarDocumentUrl;
exports.cikFromTickerTable = cikFromTickerTable;
exports.parseItemCodes = parseItemCodes;
exports.decode8kItems = decode8kItems;
exports.eventKindForItem = eventKindForItem;
exports.recentFilings = recentFilings;
exports.summarizeSubmissions = summarizeSubmissions;
exports.earningsResultDates = earningsResultDates;
exports.filingEvents = filingEvents;
exports.isoDate = isoDate;
exports.estimateNextEarnings = estimateNextEarnings;
/** The contact User-Agent the SEC requires on every EDGAR request (keyless access). */
exports.EDGAR_UA = 'oshal-trading/1.0 (maintainer@emeraldcoastsystemsgroup.com)';
/** The SEC's ticker → CIK table. */
exports.EDGAR_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
/** How long the ticker table is trusted before a re-fetch (it changes rarely). */
exports.EDGAR_TICKER_CACHE_MS = 24 * 60 * 60 * 1000;
/** Quarterly reporting cadence the earnings estimate steps by. */
exports.EARNINGS_CADENCE_DAYS = 91;
/** Form 8-K item codes → what they mean and the event kind the surface groups them under. */
exports.EIGHT_K_ITEMS = {
    '1.01': { label: 'Material agreement', kind: 'agreement' },
    '1.02': { label: 'Termination of agreement', kind: 'agreement-termination' },
    '2.01': { label: 'Acquisition/disposition', kind: 'acquisition' },
    '2.02': { label: 'Results of operations (earnings)', kind: 'earnings' },
    '2.03': { label: 'Financial obligation', kind: 'debt' },
    '2.05': { label: 'Exit/disposal costs', kind: 'restructuring' },
    '2.06': { label: 'Material impairment', kind: 'impairment' },
    '3.01': { label: 'Listing notice', kind: 'listing' },
    '3.02': { label: 'Unregistered equity sale', kind: 'equity-sale' },
    '4.01': { label: 'Auditor change', kind: 'auditor' },
    '4.02': { label: 'Non-reliance on prior financials', kind: 'restatement' },
    '5.01': { label: 'Change in control', kind: 'control' },
    '5.02': { label: 'Officer/director change', kind: 'leadership' },
    '5.03': { label: 'Charter/bylaws change', kind: 'governance' },
    '5.07': { label: 'Shareholder vote', kind: 'shareholder-vote' },
    '7.01': { label: 'Reg FD disclosure', kind: 'reg-fd' },
    '8.01': { label: 'Other events', kind: 'other' },
    '9.01': { label: 'Exhibits', kind: 'exhibits' },
};
const EXHIBITS_ITEM = '9.01';
const ITEM_CODE_RE = /^\d\.\d\d$/;
const EIGHT_K_FORMS = new Set(['8-K', '8-K/A']);
/**
 * @description The submissions endpoint for a 10-digit zero-padded CIK.
 * @param cik10 - The zero-padded CIK.
 * @returns The data.sec.gov submissions url.
 */
function edgarSubmissionsUrl(cik10) {
    return `https://data.sec.gov/submissions/CIK${cik10}.json`;
}
/**
 * @description The archive url of a filing's primary document (numeric CIK, un-dashed accession).
 * @param cik10 - The zero-padded CIK.
 * @param accession - The accession number as EDGAR lists it (with dashes).
 * @param primaryDocument - The primary document file name.
 * @returns The www.sec.gov archive url, or '' when any part is missing.
 */
function edgarDocumentUrl(cik10, accession, primaryDocument) {
    if (!cik10 || !accession || !primaryDocument)
        return '';
    return `https://www.sec.gov/Archives/edgar/data/${Number(cik10)}/${accession.replace(/-/g, '')}/${primaryDocument}`;
}
/**
 * @description Resolve a ticker to its 10-digit zero-padded CIK from the SEC ticker table
 * (`{ "0": { cik_str, ticker, title }, … }`).
 * @param table - The parsed company_tickers.json.
 * @param symbol - The ticker (any case).
 * @returns The zero-padded CIK, or null when the ticker is not an SEC registrant.
 */
function cikFromTickerTable(table, symbol) {
    if (!table || typeof table !== 'object')
        return null;
    const want = symbol.trim().toUpperCase();
    for (const row of Object.values(table)) {
        const r = row;
        if (String(r?.ticker ?? '').toUpperCase() !== want)
            continue;
        const cik = String(r.cik_str ?? '').replace(/\D/g, '');
        return cik ? cik.padStart(10, '0') : null;
    }
    return null;
}
/**
 * @description Split an 8-K `items` field ("2.02,9.01") into its item codes.
 * @param raw - The items field as EDGAR lists it.
 * @returns The item codes in filing order (unknown tokens dropped).
 */
function parseItemCodes(raw) {
    return String(raw ?? '').split(',').map((t) => t.trim()).filter((t) => ITEM_CODE_RE.test(t));
}
/**
 * @description Decode an 8-K's items to codes + plain-English labels. 9.01 (Exhibits) is dropped
 * from the plain list when any other item exists — it says nothing about the event itself.
 * @param raw - The items field as EDGAR lists it.
 * @returns The codes and their labels.
 */
function decode8kItems(raw) {
    const items = parseItemCodes(raw);
    const substantive = items.filter((c) => c !== EXHIBITS_ITEM);
    const shown = substantive.length ? substantive : items;
    return { items, itemsPlain: shown.map((c) => exports.EIGHT_K_ITEMS[c]?.label ?? `Item ${c}`) };
}
/**
 * @description The event kind an 8-K item code maps to.
 * @param code - The item code.
 * @returns The kind slug ('other' for a code the table does not know).
 */
function eventKindForItem(code) {
    return exports.EIGHT_K_ITEMS[code]?.kind ?? 'other';
}
/**
 * @description Normalize the submissions `filings.recent` parallel arrays into one row per filing.
 * @param submissions - The parsed submissions JSON.
 * @returns The recent filings in EDGAR order (newest first), empty when the shape is missing.
 */
function recentFilings(submissions) {
    const recent = submissions?.filings?.recent;
    if (!recent || !Array.isArray(recent.form))
        return [];
    const col = (name, i) => String(recent[name]?.[i] ?? '');
    return recent.form.map((_, i) => ({
        form: col('form', i), date: col('filingDate', i), accession: col('accessionNumber', i),
        document: col('primaryDocument', i), items: parseItemCodes(col('items', i)),
    }));
}
/**
 * @description Pick the latest 10-K, the latest 10-Q and the most recent 8-Ks (decoded) out of a
 * company's submissions.
 * @param submissions - The parsed submissions JSON.
 * @param cik10 - The zero-padded CIK (for document urls).
 * @param limit8k - How many 8-Ks to keep.
 * @returns The filings summary (nulls/empty when absent — never invented).
 */
function summarizeSubmissions(submissions, cik10, limit8k = 12) {
    const out = { latest10K: null, latest10Q: null, recent8K: [] };
    for (const f of recentFilings(submissions)) {
        const ref = { form: f.form, date: f.date, url: edgarDocumentUrl(cik10, f.accession, f.document) };
        if (f.form === '10-K' && !out.latest10K)
            out.latest10K = ref;
        else if (f.form === '10-Q' && !out.latest10Q)
            out.latest10Q = ref;
        else if (EIGHT_K_FORMS.has(f.form) && out.recent8K.length < limit8k)
            out.recent8K.push({ ...ref, ...decode8kItems(f.items.join(',')) });
    }
    return out;
}
/**
 * @description The filing dates of every item-2.02 (results of operations) 8-K — the company's
 * past earnings releases, newest first.
 * @param submissions - The parsed submissions JSON.
 * @param limit - How many dates to keep.
 * @returns ISO dates, newest first.
 */
function earningsResultDates(submissions, limit = 8) {
    return recentFilings(submissions)
        .filter((f) => EIGHT_K_FORMS.has(f.form) && f.items.includes('2.02') && f.date)
        .map((f) => f.date)
        .slice(0, limit);
}
/**
 * @description Decode 8-Ks into events: one per substantive item (9.01 only when it stands alone).
 * @param recent8K - The decoded 8-Ks.
 * @returns Events in filing order.
 */
function filingEvents(recent8K) {
    const events = [];
    for (const f of recent8K) {
        const substantive = f.items.filter((c) => c !== EXHIBITS_ITEM);
        for (const code of substantive.length ? substantive : f.items) {
            events.push({ date: f.date, kind: eventKindForItem(code), label: exports.EIGHT_K_ITEMS[code]?.label ?? `Item ${code}`, url: f.url });
        }
    }
    return events;
}
/**
 * @description A calendar date as YYYY-MM-DD (UTC).
 * @param d - The date.
 * @returns The ISO date.
 */
function isoDate(d) {
    return d.toISOString().slice(0, 10);
}
/**
 * @description ESTIMATE the next earnings date from the reporting cadence: the latest past results
 * date + 91 days, stepped forward by 91 days until it is today or later. Null with no history.
 * The caller must label the result 'cadence-estimate' — this is not the calendar.
 * @param resultsDates - Past item-2.02 8-K dates (any order).
 * @param today - The reference date.
 * @returns The estimated ISO date, or null.
 */
function estimateNextEarnings(resultsDates, today) {
    const stamps = resultsDates.map((d) => Date.parse(d)).filter((t) => Number.isFinite(t));
    if (!stamps.length)
        return null;
    const todayStart = Date.parse(isoDate(today));
    let next = Math.max(...stamps);
    for (let step = 0; step < 12 && next < todayStart; step++)
        next += exports.EARNINGS_CADENCE_DAYS * 24 * 60 * 60 * 1000;
    return next < todayStart ? null : isoDate(new Date(next));
}
//# sourceMappingURL=trading-edgar-filings.js.map