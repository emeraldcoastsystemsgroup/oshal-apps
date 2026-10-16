"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FINANCIAL_CONCEPTS = void 0;
exports.secFinancialSummary = secFinancialSummary;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Select coherent annual SEC financial facts by period, unit and filing, retaining missing values and exact provenance.
 */
exports.FINANCIAL_CONCEPTS = [
    ['us-gaap', 'Revenues', 'revenue'],
    ['us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'revenue'],
    ['us-gaap', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'revenue'],
    ['us-gaap', 'SalesRevenueNet', 'revenue'],
    ['us-gaap', 'NetIncomeLoss', 'netIncome'],
    ['ifrs-full', 'Revenue', 'revenue'],
    ['ifrs-full', 'ProfitLoss', 'netIncome'],
];
const DAY = 86400000;
/** ISO calendar dates only; Date's silent normalization must not repair malformed evidence. */
function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    const at = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at : null;
}
/** Keep annual consolidated currency facts only, never quarters, instant values or filing FY labels. */
function fact(value, unit, until) {
    if (!value || typeof value !== 'object')
        return null;
    const row = value, start = day(row.start), end = day(row.end), filed = day(row.filed);
    if (start == null || end == null || filed == null || end > until || filed > until || filed < end)
        return null;
    if ((end - start) / DAY < 335 || (end - start) / DAY > 395 || row.fp !== 'FY')
        return null;
    if (typeof row.form !== 'string' || !/^(10-K|20-F|40-F)(\/A)?$/.test(row.form))
        return null;
    if (typeof row.accn !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(row.accn))
        return null;
    if (typeof row.val !== 'number' || !Number.isFinite(row.val))
        return null;
    return { start: String(row.start), end: String(row.end), filed: String(row.filed), accn: row.accn, form: row.form, val: row.val, unit };
}
/** A concept response must match the exact requested company and concept before any row is used. */
function rows(documents, cik, fetchedAt) {
    const until = day(fetchedAt.slice(0, 10));
    if (!/^\d{10}$/.test(cik) || until == null)
        throw new Error('SEC financial source identity or fetch date is invalid.');
    const out = [];
    for (const [priority, [taxonomy, tag, metric]] of exports.FINANCIAL_CONCEPTS.entries()) {
        const document = documents[priority];
        if (!document)
            continue;
        if (String(document.cik).padStart(10, '0') !== cik || document.taxonomy !== taxonomy || document.tag !== tag || !document.units || typeof document.units !== 'object')
            throw new Error('SEC financial source identity does not match the request.');
        for (const [unit, values] of Object.entries(document.units)) {
            if (!/^[A-Z]{3}$/.test(unit) || !Array.isArray(values))
                continue;
            if (values.length > 100000 || out.length + values.length > 200000)
                throw new Error('SEC financial source exceeds the supported row bound.');
            for (const value of values) {
                const row = fact(value, unit, until);
                if (row)
                    out.push({ ...row, taxonomy, tag, metric, priority });
            }
        }
    }
    return out;
}
/** Prefer total revenue within one period; tag priority never selects an older period. */
function metric(rows, name) {
    const found = rows.filter(row => row.metric === name).sort((a, b) => a.priority - b.priority);
    if (!found.length)
        return null;
    const first = found[0];
    return found.some(row => row.priority === first.priority && row.val !== first.val) ? null : first;
}
function provenance(row, cik) {
    return row && { taxonomy: row.taxonomy, concept: row.tag, start: row.start, end: row.end, unit: row.unit, filed: row.filed, accession: row.accn, form: row.form,
        url: `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${row.taxonomy}/${row.tag}.json` };
}
/** Ratios use the same annual filing context and currency; comparative FY metadata is not a year label. */
function secFinancialSummary(documents, cik, symbol, fetchedAt) {
    const all = rows(documents, cik, fetchedAt).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn) || a.priority - b.priority);
    if (!all.length)
        throw new Error('No supported annual SEC financial facts were reported for this company.');
    const anchor = all[0];
    const context = all.filter(row => row.end === anchor.end && row.start === anchor.start && row.accn === anchor.accn && row.taxonomy === anchor.taxonomy);
    const units = new Set(context.map(row => row.unit));
    if (units.size !== 1)
        throw new Error('SEC annual financial facts have ambiguous reporting currencies.');
    const revenue = metric(context, 'revenue'), income = metric(context, 'netIncome');
    if (!revenue && !income)
        throw new Error('SEC annual financial facts are conflicting or unsupported.');
    const previous = revenue && metric(all.filter(row => row.accn === revenue.accn && row.unit === revenue.unit && row.taxonomy === revenue.taxonomy && row.tag === revenue.tag && day(row.end) === Number(day(revenue.start)) - DAY), 'revenue');
    const growth = revenue && previous && previous.val > 0 ? (revenue.val / previous.val - 1) * 100 : null;
    const margin = revenue && income && revenue.val > 0 ? income.val / revenue.val * 100 : null;
    const missing = { revenue: revenue ? null : 'No unambiguous revenue in this annual filing context.', netIncome: income ? null : 'No unambiguous net income in this annual filing context.',
        revenueYoYPct: growth != null && Number.isFinite(growth) ? null : 'No coherent positive prior-year revenue in the same filing and concept.', netMarginPct: margin != null && Number.isFinite(margin) ? null : 'Net margin requires matching net income and positive revenue.' };
    return { symbol, revenue: revenue?.val ?? null, netIncome: income?.val ?? null, revenueYoYPct: missing.revenueYoYPct ? null : growth, netMarginPct: missing.netMarginPct ? null : margin, fiscalYear: null,
        summary: `Annual consolidated SEC financial facts, ${anchor.start} through ${anchor.end}.`, source: 'sec-companyconcept', cik, currency: anchor.unit, period: { start: anchor.start, end: anchor.end }, fetchedAt,
        metrics: { revenue: provenance(revenue, cik), netIncome: provenance(income, cik), priorRevenue: provenance(previous || null, cik) }, missing };
}
