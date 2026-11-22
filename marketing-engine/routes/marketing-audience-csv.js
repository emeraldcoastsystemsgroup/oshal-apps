"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure RFC-4180 CSV parser and consent-attestation
 *     normalizer for marketing-engine 0.6.1 P1 CSV audience import (zero I/O): bounded size
 *     (1 MiB) and row cap (5,000), UTF-8 BOM stripping, quoted fields with embedded commas/
 *     newlines and escaped quotes, case-insensitive snake/camel header aliases, atomic refusal
 *     when any row lacks a consent source, strict pending-by-default downgrade unless prior
 *     consent carries confirmed status + non-empty evidence text + valid ISO-8601 timestamp,
 *     and structured consent-evidence assembly for storage in oshal_marketing_consents.evidence.
 *
 * @module marketing-audience-csv
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CSV_ROWS = exports.MAX_CSV_BYTES = void 0;
exports.parseRfc4180Csv = parseRfc4180Csv;
exports.parseStrictIsoTimestamp = parseStrictIsoTimestamp;
exports.parseAudienceCsv = parseAudienceCsv;
const marketing_audience_model_1 = require("./marketing-audience-model");
/** @description Maximum accepted CSV payload size in UTF-8 bytes (1 MiB). */
exports.MAX_CSV_BYTES = 1_048_576;
/** @description Maximum accepted data rows per CSV import (excluding header). */
exports.MAX_CSV_ROWS = 5_000;
/** @description Map of normalized CSV header names to canonical field identifiers. */
const HEADER_ALIASES = {
    email: 'email',
    email_address: 'email',
    emailaddress: 'email',
    display_name: 'display_name',
    displayname: 'display_name',
    name: 'display_name',
    full_name: 'display_name',
    fullname: 'display_name',
    tags: 'tags',
    tag: 'tags',
    consent_source: 'consent_source',
    consentsource: 'consent_source',
    source: 'consent_source',
    consent_status: 'consent_status',
    consentstatus: 'consent_status',
    status: 'consent_status',
    consent_recorded_at: 'consent_recorded_at',
    consentrecordedat: 'consent_recorded_at',
    consent_timestamp: 'consent_recorded_at',
    consenttimestamp: 'consent_recorded_at',
    recorded_at: 'consent_recorded_at',
    recordedat: 'consent_recorded_at',
    consent_evidence: 'consent_evidence',
    consentevidence: 'consent_evidence',
    consent_form_text: 'consent_evidence',
    consentformtext: 'consent_evidence',
    form_text: 'consent_evidence',
    formtext: 'consent_evidence',
    consent_ip: 'consent_ip',
    consentip: 'consent_ip',
    ip: 'consent_ip',
    consent_user_agent: 'consent_user_agent',
    consentuseragent: 'consent_user_agent',
    user_agent: 'consent_user_agent',
    useragent: 'consent_user_agent',
    consent_token_hash: 'consent_token_hash',
    consenttokenhash: 'consent_token_hash',
    token_hash: 'consent_token_hash',
    tokenhash: 'consent_token_hash',
    utm_source: 'utm_source',
    utmsource: 'utm_source',
    utm_medium: 'utm_medium',
    utmmedium: 'utm_medium',
    utm_campaign: 'utm_campaign',
    utmcampaign: 'utm_campaign',
    utm_content: 'utm_content',
    utmcontent: 'utm_content',
    utm_term: 'utm_term',
    utmterm: 'utm_term',
};
/** @description Strict ISO-8601 timestamp with date, time, and explicit UTC/offset zone. */
const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
/** Trim and bound an optional string value. */
function cleanText(raw, max) {
    return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}
/** Read one RFC-4180 quoted field starting at the opening quote index. */
function readQuotedField(text, start) {
    let i = start + 1;
    let value = '';
    let newlines = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"') {
            if (text[i + 1] === '"') {
                value += '"';
                i += 2;
                continue;
            }
            const after = text[i + 1];
            if (after !== undefined && after !== ',' && after !== '\r' && after !== '\n') {
                return { value: '', next: i, newlines, error: 'invalid_csv_format' };
            }
            return { value, next: i + 1, newlines };
        }
        if (ch === '\r') {
            value += text[i + 1] === '\n' ? '\n' : '\r';
            i += text[i + 1] === '\n' ? 2 : 1;
            newlines += 1;
            continue;
        }
        if (ch === '\n')
            newlines += 1;
        value += ch;
        i += 1;
    }
    return { value: '', next: i, newlines, error: 'invalid_csv_format' };
}
/** Read one RFC-4180 unquoted field starting at index start. */
function readUnquotedField(text, start) {
    let i = start;
    while (i < text.length) {
        const ch = text[i];
        if (ch === ',' || ch === '\r' || ch === '\n')
            break;
        if (ch === '"')
            return { value: '', next: i, error: 'invalid_csv_format' };
        i += 1;
    }
    return { value: text.slice(start, i), next: i };
}
/** Parse one logical RFC-4180 record starting at index start. */
function readCsvRecord(text, start, rowNumber) {
    const cells = [];
    let i = start;
    let line = rowNumber;
    while (true) {
        if (text[i] === '"') {
            const q = readQuotedField(text, i);
            if (q.error)
                return { next: q.next, nextRowNumber: line, error: q.error };
            cells.push(q.value);
            i = q.next;
            line += q.newlines;
        }
        else {
            const u = readUnquotedField(text, i);
            if (u.error)
                return { next: u.next, nextRowNumber: line, error: u.error };
            cells.push(u.value);
            i = u.next;
        }
        if (text[i] === ',') {
            i += 1;
            continue;
        }
        if (text[i] === '\r' && text[i + 1] === '\n') {
            i += 2;
            line += 1;
            break;
        }
        if (text[i] === '\n' || text[i] === '\r') {
            i += 1;
            line += 1;
            break;
        }
        break;
    }
    return { row: { rowNumber, cells }, next: i, nextRowNumber: line };
}
/**
 * @description Strictly parse RFC-4180 CSV text, stripping UTF-8 BOM and enforcing size and row caps.
 * @param raw - Raw CSV document text.
 * @returns Non-empty parsed rows with 1-based line numbers, or a structured error code.
 */
function parseRfc4180Csv(raw) {
    if (Buffer.byteLength(raw, 'utf8') > exports.MAX_CSV_BYTES)
        return { error: 'csv_too_large' };
    const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
    const parsed = [];
    let i = 0;
    let line = 1;
    while (i < text.length) {
        const rec = readCsvRecord(text, i, line);
        if (rec.error || !rec.row)
            return { error: rec.error ?? 'invalid_csv_format' };
        i = rec.next;
        line = rec.nextRowNumber;
        if (rec.row.cells.every((cell) => cell.trim() === ''))
            continue;
        parsed.push(rec.row);
        if (parsed.length - 1 > exports.MAX_CSV_ROWS)
            return { error: 'csv_too_many_rows' };
    }
    return { rows: parsed };
}
/** Map recognized header names (case-insensitive snake/camel aliases) to column indexes. */
function mapHeaderColumns(headerCells) {
    const cols = {};
    headerCells.forEach((raw, idx) => {
        const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
        const canonical = HEADER_ALIASES[key];
        if (canonical && cols[canonical] === undefined)
            cols[canonical] = idx;
    });
    return cols;
}
/**
 * @description Validate a strict ISO-8601 timestamp string and return its canonical UTC ISO form.
 * @param raw - Candidate timestamp string.
 * @returns Canonical ISO-8601 timestamp, or null when missing or invalid.
 */
function parseStrictIsoTimestamp(raw) {
    const trimmed = raw.trim();
    const match = ISO_TIMESTAMP_RE.exec(trimmed);
    if (!match)
        return null;
    const [, yStr, mStr, dStr, hStr, minStr, secStr] = match;
    const year = Number(yStr);
    const month = Number(mStr);
    const day = Number(dStr);
    const hour = Number(hStr);
    const minute = Number(minStr);
    const second = secStr !== undefined ? Number(secStr) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
        return null;
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
        return null;
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
/** Split semicolon-, pipe-, or comma-delimited tags and merge with import-level defaults. */
function parseCsvTags(raw, defaultTags) {
    const parts = raw ? raw.split(/[;|,]/) : [];
    return (0, marketing_audience_model_1.normalizeTags)([...defaultTags, ...parts]);
}
/** Extract recognized UTM columns from one CSV row. */
function extractRowUtm(get) {
    return (0, marketing_audience_model_1.normalizeUtm)({
        source: get('utm_source'),
        medium: get('utm_medium'),
        campaign: get('utm_campaign'),
        content: get('utm_content'),
        term: get('utm_term'),
    });
}
/** Build consent status (pending unless documented prior consent) and structured evidence JSON. */
function buildRowConsent(get, rowNumber, consentSource, opts) {
    const rawStatus = get('consent_status').toLowerCase();
    const formText = get('consent_evidence').slice(0, 4000);
    const priorRecordedAt = parseStrictIsoTimestamp(get('consent_recorded_at'));
    const requestedConfirmed = rawStatus === 'confirmed';
    const priorConsentDocumented = requestedConfirmed && formText.length > 0 && priorRecordedAt !== null;
    const status = priorConsentDocumented ? 'confirmed' : 'pending';
    const downgradedToPending = requestedConfirmed && !priorConsentDocumented;
    const baseEvidence = (0, marketing_audience_model_1.normalizeConsentEvidence)({
        formText,
        recordedAt: priorRecordedAt ?? opts.importRecordedAt,
        ip: get('consent_ip') || undefined,
        userAgent: get('consent_user_agent') || undefined,
        utm: extractRowUtm(get),
        tokenHash: get('consent_token_hash') || undefined,
    }, { ip: opts.fallbackIp, userAgent: opts.fallbackUserAgent, recordedAt: opts.importRecordedAt });
    const evidence = {
        ...baseEvidence,
        consentSource,
        attestation: opts.attestation,
        importBatchId: opts.importBatchId,
        rowNumber,
        priorConsentDocumented,
        ...(downgradedToPending ? { requestedStatus: 'confirmed' } : {}),
    };
    return { status, priorConsentDocumented, downgradedToPending, evidence };
}
/** Validate that every data row carries a non-empty consent source (per-row or import-level). */
function findMissingConsentSourceRows(dataRows, cols, importConsentSource) {
    if (importConsentSource)
        return [];
    const sourceIdx = cols.consent_source;
    const missing = [];
    for (const row of dataRows) {
        const val = sourceIdx !== undefined ? cleanText(row.cells[sourceIdx], 500) : '';
        if (!val)
            missing.push(row.rowNumber);
    }
    return missing;
}
/**
 * @description Parse and validate an audience CSV payload with mandatory consent-source attestation.
 * Refuses atomically when any row lacks a consent source, downgrades undocumented confirmed claims
 * to pending, and returns normalized contacts plus invalid-email diagnostics.
 * @param csv - Untrusted CSV string from request body.
 * @param opts - Import-level attestation, defaults, batch identifier, and request fallbacks.
 * @returns Parsed result or structured refusal error.
 */
function parseAudienceCsv(csv, opts) {
    if (typeof csv !== 'string' || csv.trim() === '')
        return { ok: false, error: 'csv_required' };
    const parsed = parseRfc4180Csv(csv);
    if (parsed.error || !parsed.rows?.length)
        return { ok: false, error: parsed.error ?? 'csv_required' };
    const [headerRow, ...dataRows] = parsed.rows;
    const cols = mapHeaderColumns(headerRow.cells);
    if (cols.email === undefined)
        return { ok: false, error: 'email_column_required' };
    const importConsentSource = cleanText(opts.consentSource, 500);
    if (!dataRows.length && !importConsentSource) {
        return { ok: false, error: 'consent_source_required', missingConsentSourceRows: [] };
    }
    const missingRows = findMissingConsentSourceRows(dataRows, cols, importConsentSource);
    if (missingRows.length > 0) {
        return { ok: false, error: 'consent_source_required', missingConsentSourceRows: missingRows };
    }
    const normOpts = {
        importConsentSource,
        attestation: cleanText(opts.attestation, 2000) || null,
        importBatchId: opts.importBatchId,
        defaultTags: (0, marketing_audience_model_1.normalizeTags)(opts.defaultTags ?? []),
        fallbackIp: opts.fallbackIp,
        fallbackUserAgent: opts.fallbackUserAgent,
        importRecordedAt: opts.recordedAt ?? new Date().toISOString(),
    };
    const rows = [];
    const invalidRows = [];
    for (const row of dataRows) {
        const get = (col) => (cols[col] !== undefined ? cleanText(row.cells[cols[col]], 4000) : '');
        const rawEmail = get('email');
        const email = (0, marketing_audience_model_1.normalizeEmail)(rawEmail);
        if (!email) {
            invalidRows.push({ rowNumber: row.rowNumber, rawEmail, reason: 'invalid_email' });
            continue;
        }
        const consentSource = cleanText(get('consent_source'), 500) || importConsentSource;
        const consent = buildRowConsent(get, row.rowNumber, consentSource, normOpts);
        rows.push({
            rowNumber: row.rowNumber,
            email,
            emailHash: (0, marketing_audience_model_1.hashAddress)(email),
            displayName: cleanText(get('display_name'), 200),
            tags: parseCsvTags(get('tags'), normOpts.defaultTags),
            consentSource,
            ...consent,
        });
    }
    return { ok: true, consentSource: importConsentSource || null, totalRows: dataRows.length, rows, invalidRows };
}
