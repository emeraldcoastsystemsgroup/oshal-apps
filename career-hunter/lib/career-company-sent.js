/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.67.0: Compute owner-scoped per-company confirmed-sent counts and deterministic tracked-application age fields (asOfDate, daysSinceSent, daysSinceApplied, ageDays, olderThan30Days) from recorded application timestamps.
 */
'use strict';

const SENT_STATUSES = new Set(['applied', 'interview', 'offer', 'rejected']);
const LEGAL_SUFFIX_RE = /(?:,|\s)+(?:\b(?:inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|lp|l\.p|llp|l\.l\.p)\.?)+\s*$/i;

/** Normalize a company display name to one stable comparison key for owner-scoped sent counts. */
function canonicalCompanyKey(name) {
  if (typeof name !== 'string') return '';
  let base = name.normalize('NFKC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/&/g, ' and ').trim();
  if (!base) return '';
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = base.replace(LEGAL_SUFFIX_RE, '').trim().replace(/[,.;:-]+$/, '').trim();
    if (!stripped || stripped === base || !/[\p{L}\p{N}]/u.test(stripped)) break;
    base = stripped;
  }
  const key = base.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return key || name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Parse SQLite UTC or explicit-offset ISO timestamps, rejecting malformed or future instants. */
function parseAppliedAtMs(raw, nowMs = Date.now()) {
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) && ms > 0 && ms <= nowMs ? ms : null;
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  let normalized = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) normalized = `${text}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) normalized = `${text.replace(' ', 'T')}Z`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) normalized = text;
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) && ms > 0 && ms <= nowMs ? ms : null;
}

/** True iff an application row is recorded as sent (including later-dismissed rows that retain a valid applied_at). */
function isRecordedAsSent(row, nowMs = Date.now()) {
  if (!row || typeof row !== 'object') return false;
  if (row.application_source === 'not-sent') return false;
  const rawAt = row.applied_at ?? row.appliedAt;
  const hasAt = rawAt !== null && rawAt !== undefined && String(rawAt).trim() !== '';
  if (hasAt) return parseAppliedAtMs(rawAt, nowMs) !== null;
  return SENT_STATUSES.has(String(row.status || ''));
}

/** Read owner-scoped recorded-sent rows from an attached user_signals + corpus SQLite connection. */
function querySignalSentRows(db) {
  if (!db || typeof db.prepare !== 'function') return [];
  const withSource = `SELECT s.posting_id, c.name AS company, s.status, s.applied_at, s.application_source
      FROM user_signals s
      JOIN corpus.postings_corpus p ON p.id = s.posting_id
      JOIN corpus.companies c ON c.id = p.company_id
     WHERE (s.applied_at IS NOT NULL AND s.applied_at <> '')
        OR s.status IN ('applied', 'interview', 'offer', 'rejected')`;
  try { return db.prepare(withSource).all(); } catch { /* fallback when legacy test fixture omits application_source */ }
  try {
    return db.prepare(withSource.replace(', s.application_source', '')).all();
  } catch { return []; }
}

/** Count distinct confirmed-sent postings per normalized company for the current owner. */
function companySentCounts(db, nowMs = Date.now(), extraRows = []) {
  const seen = new Map();
  const addRow = (row, index) => {
    if (!isRecordedAsSent(row, nowMs)) return;
    const key = canonicalCompanyKey(row.company);
    if (!key) return;
    const id = row.posting_id ?? row.postingId ?? row.id ?? `row:${index}`;
    let set = seen.get(key);
    if (!set) { set = new Set(); seen.set(key, set); }
    set.add(String(id));
  };
  const rows = querySignalSentRows(db);
  for (let i = 0; i < rows.length; i += 1) addRow(rows[i], i);
  for (let i = 0; i < extraRows.length; i += 1) addRow(extraRows[i], rows.length + i);
  const counts = new Map();
  for (const [key, set] of seen.entries()) counts.set(key, set.size);
  return counts;
}

/** Look up the integer confirmed-sent count (>= 0) for a company display name. */
function countForCompany(countsMap, companyName) {
  if (!countsMap || typeof countsMap.get !== 'function') return 0;
  const key = canonicalCompanyKey(companyName);
  return key ? (countsMap.get(key) || 0) : 0;
}

/** Return the server UTC calendar date (YYYY-MM-DD) used for application age comparisons. */
function asOfDateString(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Compute deterministic calendar-day age fields from a recorded sent/applied timestamp. */
function applicationAgeFields(appliedAt, nowMs = Date.now()) {
  const ms = parseAppliedAtMs(appliedAt, nowMs);
  if (ms === null) {
    return { daysSinceSent: null, daysSinceApplied: null, ageDays: null, olderThan30Days: false };
  }
  const todayUtc = Date.parse(`${asOfDateString(nowMs)}T00:00:00Z`);
  const sentUtc = Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00Z`);
  const days = Math.max(0, Math.round((todayUtc - sentUtc) / 86_400_000));
  return { daysSinceSent: days, daysSinceApplied: days, ageDays: days, olderThan30Days: days > 30 };
}

/** Attach companySentCount and tracked-application age fields onto a job or application record. */
function decorateJobSentAndAge(job, countsMap, nowMs = Date.now()) {
  const appliedAt = job?.applied_at ?? job?.appliedAt ?? null;
  return {
    ...job,
    companySentCount: countForCompany(countsMap, job?.company),
    ...applicationAgeFields(appliedAt, nowMs),
  };
}

module.exports = {
  SENT_STATUSES,
  canonicalCompanyKey,
  parseAppliedAtMs,
  isRecordedAsSent,
  companySentCounts,
  countForCompany,
  asOfDateString,
  applicationAgeFields,
  decorateJobSentAndAge,
};
