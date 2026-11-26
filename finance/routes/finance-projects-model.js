"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5: pure integer-cents domain model for finance projects, budget allocation lines, multi-source actuals (manual, plaid, ads, sms, email, invoice), and variance rollups with zero floating-point arithmetic.
 *
 * @module finance-projects-model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UUID_RE = exports.PROJECT_STATUSES = exports.ACTUAL_SOURCES = void 0;
exports.emptyBySource = emptyBySource;
exports.isValidCalendarDate = isValidCalendarDate;
exports.todayUtcDate = todayUtcDate;
exports.slugifyProjectName = slugifyProjectName;
exports.toSafeCents = toSafeCents;
exports.parseCentsField = parseCentsField;
exports.normalizeProjectInput = normalizeProjectInput;
exports.normalizeProjectPatch = normalizeProjectPatch;
exports.normalizeProjectLineInput = normalizeProjectLineInput;
exports.normalizeProjectLinePatch = normalizeProjectLinePatch;
exports.normalizeProjectActualInput = normalizeProjectActualInput;
exports.summarizeFinanceProject = summarizeFinanceProject;
exports.ACTUAL_SOURCES = Object.freeze(['manual', 'plaid', 'ads', 'sms', 'email', 'invoice']);
exports.PROJECT_STATUSES = Object.freeze(['active', 'paused', 'completed', 'archived']);
exports.UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_STRING_RE = /^-?\d+$/;
const MAX_EVIDENCE_BYTES = 8192;
const MAX_INITIAL_LINES = 50;
/** Create a zeroed integer-cent map across all six allowed actual sources. */
function emptyBySource() {
    return { manual: 0, plaid: 0, ads: 0, sms: 0, email: 0, invoice: 0 };
}
/** Verify a strict YYYY-MM-DD calendar date without month/day rollover. */
function isValidCalendarDate(value) {
    if (!DATE_RE.test(value))
        return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** Today's UTC date formatted as YYYY-MM-DD. */
function todayUtcDate() {
    return new Date().toISOString().slice(0, 10);
}
/** Derive a lowercase hyphenated slug from a project name. */
function slugifyProjectName(name) {
    const base = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    return base || 'project';
}
/** Safely coerce a stored integer-cent value (number or PG BIGINT digit string) to a safe integer. */
function toSafeCents(value) {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new Error('Expected a safe integer cent amount.');
        return value;
    }
    if (typeof value === 'string' && INT_STRING_RE.test(value.trim())) {
        const parsed = Number(value.trim());
        if (!Number.isSafeInteger(parsed))
            throw new Error('Expected a safe integer cent amount.');
        return parsed;
    }
    throw new Error('Expected a safe integer cent amount.');
}
/** Parse a caller-supplied integer-cent value strictly rejecting floats, NaN, or out-of-range inputs. */
function parseCentsField(raw, field, opts) {
    if (raw === undefined || raw === null || raw === '') {
        if (opts.defaultZero)
            return { ok: true, value: 0 };
        return { ok: false, error: `invalid_${field}`, message: `${field} must be a whole integer number of cents.` };
    }
    let n;
    if (typeof raw === 'number') {
        if (!Number.isSafeInteger(raw)) {
            return { ok: false, error: `invalid_${field}`, message: `${field} must be a safe integer (whole cents, no decimals).` };
        }
        n = raw;
    }
    else if (typeof raw === 'string' && INT_STRING_RE.test(raw.trim())) {
        n = Number(raw.trim());
        if (!Number.isSafeInteger(n)) {
            return { ok: false, error: `invalid_${field}`, message: `${field} exceeds safe integer bounds.` };
        }
    }
    else {
        return { ok: false, error: `invalid_${field}`, message: `${field} must be a whole integer number of cents.` };
    }
    if (opts.allowZero ? n < 0 : n <= 0) {
        const rule = opts.allowZero ? 'greater than or equal to 0' : 'greater than 0';
        return { ok: false, error: `invalid_${field}`, message: `${field} must be ${rule}.` };
    }
    return { ok: true, value: n };
}
/** Parse a bounded plain JSON object for actual evidence. */
function parseEvidenceObject(raw) {
    if (raw === undefined || raw === null)
        return { ok: true, value: {} };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'invalid_evidence', message: 'evidence must be a JSON object.' };
    }
    let encoded;
    try {
        encoded = JSON.stringify(raw);
    }
    catch {
        return { ok: false, error: 'invalid_evidence', message: 'evidence must be JSON-serializable.' };
    }
    if (new TextEncoder().encode(encoded).length > MAX_EVIDENCE_BYTES) {
        return { ok: false, error: 'evidence_too_large', message: `evidence exceeds ${MAX_EVIDENCE_BYTES} bytes.` };
    }
    return { ok: true, value: JSON.parse(encoded) };
}
/** Parse an optional bounded string field. */
function parseBoundedText(raw, field, maxLen) {
    if (raw === undefined || raw === null)
        return { ok: true, value: '' };
    if (typeof raw !== 'string') {
        return { ok: false, error: `invalid_${field}`, message: `${field} must be a string.` };
    }
    const trimmed = raw.trim();
    if (trimmed.length > maxLen) {
        return { ok: false, error: `invalid_${field}`, message: `${field} must be at most ${maxLen} characters.` };
    }
    return { ok: true, value: trimmed };
}
/** Validate and normalize a finance project creation payload (optionally including initial lines). */
function normalizeProjectInput(raw) {
    const b = (raw && typeof raw === 'object' ? raw : {});
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 120) {
        return { ok: false, error: 'invalid_name', message: 'Project name must be between 1 and 120 characters.' };
    }
    const explicitSlug = typeof b.slug === 'string' && b.slug.trim().length > 0;
    const slug = explicitSlug ? String(b.slug).trim().toLowerCase() : slugifyProjectName(name);
    if (!SLUG_RE.test(slug)) {
        return { ok: false, error: 'invalid_slug', message: 'Project slug must be 1–80 lowercase letters, digits, or hyphens.' };
    }
    const currency = b.currency === undefined || b.currency === null || b.currency === ''
        ? 'USD' : String(b.currency).trim().toUpperCase();
    if (!CURRENCY_RE.test(currency)) {
        return { ok: false, error: 'invalid_currency', message: 'Currency must be a 3-letter ISO code (e.g. USD).' };
    }
    const status = (b.status === undefined || b.status === null || b.status === '' ? 'active' : String(b.status).trim().toLowerCase());
    if (!exports.PROJECT_STATUSES.includes(status)) {
        return { ok: false, error: 'invalid_status', message: `Status must be one of: ${exports.PROJECT_STATUSES.join(', ')}.` };
    }
    const budget = parseCentsField(b.budgetCents, 'budgetCents', { allowZero: true, defaultZero: true });
    if (!budget.ok)
        return budget;
    const ext = parseBoundedText(b.externalRef, 'externalRef', 200);
    if (!ext.ok)
        return ext;
    const notes = parseBoundedText(b.notes, 'notes', 2000);
    if (!notes.ok)
        return notes;
    const lines = [];
    if (b.lines !== undefined) {
        if (!Array.isArray(b.lines) || b.lines.length > MAX_INITIAL_LINES) {
            return { ok: false, error: 'invalid_lines', message: `lines must be an array of at most ${MAX_INITIAL_LINES} allocations.` };
        }
        for (const item of b.lines) {
            const checked = normalizeProjectLineInput(item);
            if (!checked.ok)
                return checked;
            lines.push(checked.value);
        }
    }
    return {
        ok: true,
        value: {
            name, slug, explicitSlug, currency, status, budgetCents: budget.value,
            externalRef: ext.value || null, notes: notes.value, lines,
        },
    };
}
/** Validate and normalize a partial project update payload. */
function normalizeProjectPatch(raw) {
    const b = (raw && typeof raw === 'object' ? raw : {});
    const patch = {};
    if (b.name !== undefined) {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name || name.length > 120)
            return { ok: false, error: 'invalid_name', message: 'Project name must be 1–120 characters.' };
        patch.name = name;
    }
    if (b.currency !== undefined) {
        const cur = String(b.currency).trim().toUpperCase();
        if (!CURRENCY_RE.test(cur))
            return { ok: false, error: 'invalid_currency', message: 'Currency must be a 3-letter ISO code.' };
        patch.currency = cur;
    }
    if (b.status !== undefined) {
        const st = String(b.status).trim().toLowerCase();
        if (!exports.PROJECT_STATUSES.includes(st)) {
            return { ok: false, error: 'invalid_status', message: `Status must be one of: ${exports.PROJECT_STATUSES.join(', ')}.` };
        }
        patch.status = st;
    }
    if (b.budgetCents !== undefined) {
        const budget = parseCentsField(b.budgetCents, 'budgetCents', { allowZero: true });
        if (!budget.ok)
            return budget;
        patch.budgetCents = budget.value;
    }
    if (b.externalRef !== undefined) {
        const ext = parseBoundedText(b.externalRef, 'externalRef', 200);
        if (!ext.ok)
            return ext;
        patch.externalRef = ext.value || null;
    }
    if (b.notes !== undefined) {
        const notes = parseBoundedText(b.notes, 'notes', 2000);
        if (!notes.ok)
            return notes;
        patch.notes = notes.value;
    }
    if (Object.keys(patch).length === 0) {
        return { ok: false, error: 'empty_patch', message: 'Provide at least one field to update.' };
    }
    return { ok: true, value: patch };
}
/** Validate and normalize a budget allocation line creation payload. */
function normalizeProjectLineInput(raw) {
    const b = (raw && typeof raw === 'object' ? raw : {});
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 120) {
        return { ok: false, error: 'invalid_line_name', message: 'Line name must be between 1 and 120 characters.' };
    }
    const channel = b.channel === undefined || b.channel === null || b.channel === ''
        ? 'general' : String(b.channel).trim().toLowerCase();
    if (!CHANNEL_RE.test(channel)) {
        return { ok: false, error: 'invalid_channel', message: 'Channel must be 1–40 lowercase letters, digits, hyphens, or underscores.' };
    }
    const budget = parseCentsField(b.budgetCents, 'budgetCents', { allowZero: true, defaultZero: true });
    if (!budget.ok)
        return budget;
    const committed = parseCentsField(b.committedCents, 'committedCents', { allowZero: true, defaultZero: true });
    if (!committed.ok)
        return committed;
    const notes = parseBoundedText(b.notes, 'notes', 1000);
    if (!notes.ok)
        return notes;
    return {
        ok: true,
        value: { name, channel, budgetCents: budget.value, committedCents: committed.value, notes: notes.value },
    };
}
/** Validate and normalize a partial budget line update payload. */
function normalizeProjectLinePatch(raw) {
    const b = (raw && typeof raw === 'object' ? raw : {});
    const patch = {};
    if (b.name !== undefined) {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name || name.length > 120)
            return { ok: false, error: 'invalid_line_name', message: 'Line name must be 1–120 characters.' };
        patch.name = name;
    }
    if (b.channel !== undefined) {
        const channel = String(b.channel).trim().toLowerCase();
        if (!CHANNEL_RE.test(channel))
            return { ok: false, error: 'invalid_channel', message: 'Channel must be 1–40 lowercase characters.' };
        patch.channel = channel;
    }
    if (b.budgetCents !== undefined) {
        const budget = parseCentsField(b.budgetCents, 'budgetCents', { allowZero: true });
        if (!budget.ok)
            return budget;
        patch.budgetCents = budget.value;
    }
    if (b.committedCents !== undefined) {
        const committed = parseCentsField(b.committedCents, 'committedCents', { allowZero: true });
        if (!committed.ok)
            return committed;
        patch.committedCents = committed.value;
    }
    if (b.notes !== undefined) {
        const notes = parseBoundedText(b.notes, 'notes', 1000);
        if (!notes.ok)
            return notes;
        patch.notes = notes.value;
    }
    if (Object.keys(patch).length === 0) {
        return { ok: false, error: 'empty_patch', message: 'Provide at least one line field to update.' };
    }
    return { ok: true, value: patch };
}
/** Validate and normalize a project actual creation payload. */
function normalizeProjectActualInput(raw) {
    const b = (raw && typeof raw === 'object' ? raw : {});
    let lineId = null;
    if (b.lineId !== undefined && b.lineId !== null && String(b.lineId).trim() !== '') {
        const candidate = String(b.lineId).trim();
        if (!exports.UUID_RE.test(candidate)) {
            return { ok: false, error: 'invalid_line_id', message: 'lineId must be a valid UUID.' };
        }
        lineId = candidate;
    }
    const source = typeof b.source === 'string' ? b.source.trim().toLowerCase() : '';
    if (!exports.ACTUAL_SOURCES.includes(source)) {
        return { ok: false, error: 'invalid_source', message: `source must be one of: ${exports.ACTUAL_SOURCES.join(', ')}.` };
    }
    const amount = parseCentsField(b.amountCents, 'amountCents', { allowZero: false });
    if (!amount.ok)
        return amount;
    const occurredOn = b.occurredOn === undefined || b.occurredOn === null || b.occurredOn === ''
        ? todayUtcDate() : String(b.occurredOn).trim();
    if (!isValidCalendarDate(occurredOn)) {
        return { ok: false, error: 'invalid_occurred_on', message: 'occurredOn must be a valid YYYY-MM-DD calendar date.' };
    }
    const ref = parseBoundedText(b.referenceId, 'referenceId', 200);
    if (!ref.ok)
        return ref;
    const evidence = parseEvidenceObject(b.evidence);
    if (!evidence.ok)
        return evidence;
    const note = parseBoundedText(b.note, 'note', 1000);
    if (!note.ok)
        return note;
    return {
        ok: true,
        value: {
            lineId, source: source, amountCents: amount.value, occurredOn,
            referenceId: ref.value || null, evidence: evidence.value, note: note.value,
        },
    };
}
/** Add two integer cent values while guarding against JS safe-integer overflow. */
function addCents(a, b) {
    const sum = a + b;
    if (!Number.isSafeInteger(sum))
        throw new Error('Integer cent sum exceeded safe integer bounds.');
    return sum;
}
/** Bucket actuals into per-line and unassigned integer-cent accumulators. */
function bucketProjectActuals(lines, actuals) {
    const bySource = emptyBySource();
    const lineBuckets = new Map();
    for (const line of lines) {
        lineBuckets.set(line.lineId, { actualCents: 0, actualCount: 0, bySource: emptyBySource() });
    }
    let totalActualCents = 0;
    let unassignedActualCents = 0;
    let unassignedActualCount = 0;
    for (const act of actuals) {
        const cents = toSafeCents(act.amountCents);
        totalActualCents = addCents(totalActualCents, cents);
        bySource[act.source] = addCents(bySource[act.source], cents);
        const bucket = act.lineId ? lineBuckets.get(act.lineId) : undefined;
        if (bucket) {
            bucket.actualCents = addCents(bucket.actualCents, cents);
            bucket.actualCount += 1;
            bucket.bySource[act.source] = addCents(bucket.bySource[act.source], cents);
        }
        else {
            unassignedActualCents = addCents(unassignedActualCents, cents);
            unassignedActualCount += 1;
        }
    }
    return { bySource, lineBuckets, totalActualCents, unassignedActualCents, unassignedActualCount };
}
/**
 * @description Compute exact integer-cent budget, committed, actual, and variance rollups for a
 * finance project, per allocation line and across all six actual sources.
 */
function summarizeFinanceProject(project, lines, actuals) {
    const { bySource, lineBuckets, totalActualCents, unassignedActualCents, unassignedActualCount } = bucketProjectActuals(lines, actuals);
    let allocatedCents = 0;
    let totalCommittedCents = 0;
    const lineSummaries = lines.map((line) => {
        const budgetCents = toSafeCents(line.budgetCents);
        const committedCents = toSafeCents(line.committedCents);
        allocatedCents = addCents(allocatedCents, budgetCents);
        totalCommittedCents = addCents(totalCommittedCents, committedCents);
        const bucket = lineBuckets.get(line.lineId);
        const varianceCents = budgetCents - bucket.actualCents;
        const remainingAfterCommittedCents = budgetCents - committedCents - bucket.actualCents;
        return {
            lineId: line.lineId, name: line.name, channel: line.channel, notes: line.notes,
            budgetCents, committedCents, actualCents: bucket.actualCents, varianceCents,
            remainingAfterCommittedCents, overBudget: bucket.actualCents > budgetCents,
            actualCount: bucket.actualCount, bySource: bucket.bySource,
        };
    });
    const projectBudgetCents = toSafeCents(project.budgetCents);
    const totalBudgetCents = allocatedCents > 0 ? allocatedCents : projectBudgetCents;
    const totals = {
        projectBudgetCents, allocatedCents, unallocatedBudgetCents: projectBudgetCents - allocatedCents,
        totalBudgetCents, totalCommittedCents, totalActualCents,
        totalVarianceCents: totalBudgetCents - totalActualCents,
        remainingAfterCommittedCents: totalBudgetCents - totalCommittedCents - totalActualCents,
        unassignedActualCents, unassignedActualCount, overBudget: totalActualCents > totalBudgetCents,
        lineCount: lineSummaries.length, actualCount: actuals.length, bySource,
    };
    return { project, ...totals, totals, lines: lineSummaries, actuals };
}
