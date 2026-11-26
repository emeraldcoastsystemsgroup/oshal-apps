/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5: pure integer-cents domain model for finance projects, budget allocation lines, multi-source actuals (manual, plaid, ads, sms, email, invoice), and variance rollups with zero floating-point arithmetic.
 *
 * @module finance-projects-model
 */

export const ACTUAL_SOURCES = Object.freeze(['manual', 'plaid', 'ads', 'sms', 'email', 'invoice'] as const);
export type ActualSource = (typeof ACTUAL_SOURCES)[number];

export const PROJECT_STATUSES = Object.freeze(['active', 'paused', 'completed', 'archived'] as const);
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_STRING_RE = /^-?\d+$/;
const MAX_EVIDENCE_BYTES = 8192;
const MAX_INITIAL_LINES = 50;

export type SourceTotals = Record<ActualSource, number>;

export interface NormalizedProjectInput {
  name: string;
  slug: string;
  explicitSlug: boolean;
  currency: string;
  status: ProjectStatus;
  budgetCents: number;
  externalRef: string | null;
  notes: string;
  lines: NormalizedProjectLineInput[];
}

export interface NormalizedProjectPatch {
  name?: string;
  currency?: string;
  status?: ProjectStatus;
  budgetCents?: number;
  externalRef?: string | null;
  notes?: string;
}

export interface NormalizedProjectLineInput {
  name: string;
  channel: string;
  budgetCents: number;
  committedCents: number;
  notes: string;
}

export interface NormalizedProjectLinePatch {
  name?: string;
  channel?: string;
  budgetCents?: number;
  committedCents?: number;
  notes?: string;
}

export interface NormalizedProjectActualInput {
  lineId: string | null;
  source: ActualSource;
  amountCents: number;
  occurredOn: string;
  referenceId: string | null;
  evidence: Record<string, unknown>;
  note: string;
}

export interface FinanceProjectRecord {
  projectId: string;
  slug: string;
  name: string;
  currency: string;
  status: ProjectStatus;
  budgetCents: number;
  externalRef: string | null;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FinanceProjectLineRecord {
  lineId: string;
  projectId: string;
  name: string;
  channel: string;
  budgetCents: number;
  committedCents: number;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FinanceProjectActualRecord {
  actualId: string;
  projectId: string;
  lineId: string | null;
  source: ActualSource;
  amountCents: number;
  occurredOn: string;
  referenceId: string | null;
  evidence: Record<string, unknown>;
  note: string;
  createdAt: string | null;
}

export interface ProjectLineSummary {
  lineId: string;
  name: string;
  channel: string;
  notes: string;
  budgetCents: number;
  committedCents: number;
  actualCents: number;
  varianceCents: number;
  remainingAfterCommittedCents: number;
  overBudget: boolean;
  actualCount: number;
  bySource: SourceTotals;
}

export interface FinanceProjectTotals {
  projectBudgetCents: number;
  allocatedCents: number;
  unallocatedBudgetCents: number;
  totalBudgetCents: number;
  totalCommittedCents: number;
  totalActualCents: number;
  totalVarianceCents: number;
  remainingAfterCommittedCents: number;
  unassignedActualCents: number;
  unassignedActualCount: number;
  overBudget: boolean;
  lineCount: number;
  actualCount: number;
  bySource: SourceTotals;
}

export interface FinanceProjectSummary extends FinanceProjectTotals {
  project: FinanceProjectRecord;
  totals: FinanceProjectTotals;
  lines: ProjectLineSummary[];
  actuals: FinanceProjectActualRecord[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string };

/** Create a zeroed integer-cent map across all six allowed actual sources. */
export function emptyBySource(): SourceTotals {
  return { manual: 0, plaid: 0, ads: 0, sms: 0, email: 0, invoice: 0 };
}

/** Verify a strict YYYY-MM-DD calendar date without month/day rollover. */
export function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today's UTC date formatted as YYYY-MM-DD. */
export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Derive a lowercase hyphenated slug from a project name. */
export function slugifyProjectName(name: string): string {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || 'project';
}

/** Safely coerce a stored integer-cent value (number or PG BIGINT digit string) to a safe integer. */
export function toSafeCents(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Expected a safe integer cent amount.');
    return value;
  }
  if (typeof value === 'string' && INT_STRING_RE.test(value.trim())) {
    const parsed = Number(value.trim());
    if (!Number.isSafeInteger(parsed)) throw new Error('Expected a safe integer cent amount.');
    return parsed;
  }
  throw new Error('Expected a safe integer cent amount.');
}

/** Parse a caller-supplied integer-cent value strictly rejecting floats, NaN, or out-of-range inputs. */
export function parseCentsField(
  raw: unknown,
  field: string,
  opts: { allowZero: boolean; defaultZero?: boolean },
): ValidationResult<number> {
  if (raw === undefined || raw === null || raw === '') {
    if (opts.defaultZero) return { ok: true, value: 0 };
    return { ok: false, error: `invalid_${field}`, message: `${field} must be a whole integer number of cents.` };
  }
  let n: number;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      return { ok: false, error: `invalid_${field}`, message: `${field} must be a safe integer (whole cents, no decimals).` };
    }
    n = raw;
  } else if (typeof raw === 'string' && INT_STRING_RE.test(raw.trim())) {
    n = Number(raw.trim());
    if (!Number.isSafeInteger(n)) {
      return { ok: false, error: `invalid_${field}`, message: `${field} exceeds safe integer bounds.` };
    }
  } else {
    return { ok: false, error: `invalid_${field}`, message: `${field} must be a whole integer number of cents.` };
  }
  if (opts.allowZero ? n < 0 : n <= 0) {
    const rule = opts.allowZero ? 'greater than or equal to 0' : 'greater than 0';
    return { ok: false, error: `invalid_${field}`, message: `${field} must be ${rule}.` };
  }
  return { ok: true, value: n };
}

/** Parse a bounded plain JSON object for actual evidence. */
function parseEvidenceObject(raw: unknown): ValidationResult<Record<string, unknown>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_evidence', message: 'evidence must be a JSON object.' };
  }
  let encoded: string;
  try { encoded = JSON.stringify(raw); } catch {
    return { ok: false, error: 'invalid_evidence', message: 'evidence must be JSON-serializable.' };
  }
  if (new TextEncoder().encode(encoded).length > MAX_EVIDENCE_BYTES) {
    return { ok: false, error: 'evidence_too_large', message: `evidence exceeds ${MAX_EVIDENCE_BYTES} bytes.` };
  }
  return { ok: true, value: JSON.parse(encoded) as Record<string, unknown> };
}

/** Parse an optional bounded string field. */
function parseBoundedText(raw: unknown, field: string, maxLen: number): ValidationResult<string> {
  if (raw === undefined || raw === null) return { ok: true, value: '' };
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
export function normalizeProjectInput(raw: unknown): ValidationResult<NormalizedProjectInput> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
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
  const status = (b.status === undefined || b.status === null || b.status === '' ? 'active' : String(b.status).trim().toLowerCase()) as ProjectStatus;
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: 'invalid_status', message: `Status must be one of: ${PROJECT_STATUSES.join(', ')}.` };
  }
  const budget = parseCentsField(b.budgetCents, 'budgetCents', { allowZero: true, defaultZero: true });
  if (!budget.ok) return budget;
  const ext = parseBoundedText(b.externalRef, 'externalRef', 200);
  if (!ext.ok) return ext;
  const notes = parseBoundedText(b.notes, 'notes', 2000);
  if (!notes.ok) return notes;
  const lines: NormalizedProjectLineInput[] = [];
  if (b.lines !== undefined) {
    if (!Array.isArray(b.lines) || b.lines.length > MAX_INITIAL_LINES) {
      return { ok: false, error: 'invalid_lines', message: `lines must be an array of at most ${MAX_INITIAL_LINES} allocations.` };
    }
    for (const item of b.lines) {
      const checked = normalizeProjectLineInput(item);
      if (!checked.ok) return checked;
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
export function normalizeProjectPatch(raw: unknown): ValidationResult<NormalizedProjectPatch> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const patch: NormalizedProjectPatch = {};
  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 120) return { ok: false, error: 'invalid_name', message: 'Project name must be 1–120 characters.' };
    patch.name = name;
  }
  if (b.currency !== undefined) {
    const cur = String(b.currency).trim().toUpperCase();
    if (!CURRENCY_RE.test(cur)) return { ok: false, error: 'invalid_currency', message: 'Currency must be a 3-letter ISO code.' };
    patch.currency = cur;
  }
  if (b.status !== undefined) {
    const st = String(b.status).trim().toLowerCase() as ProjectStatus;
    if (!(PROJECT_STATUSES as readonly string[]).includes(st)) {
      return { ok: false, error: 'invalid_status', message: `Status must be one of: ${PROJECT_STATUSES.join(', ')}.` };
    }
    patch.status = st;
  }
  if (b.budgetCents !== undefined) {
    const budget = parseCentsField(b.budgetCents, 'budgetCents', { allowZero: true });
    if (!budget.ok) return budget;
    patch.budgetCents = budget.value;
  }
  if (b.externalRef !== undefined) {
    const ext = parseBoundedText(b.externalRef, 'externalRef', 200);
    if (!ext.ok) return ext;
    patch.externalRef = ext.value || null;
  }
  if (b.notes !== undefined) {
    const notes = parseBoundedText(b.notes, 'notes', 2000);
    if (!notes.ok) return notes;
    patch.notes = notes.value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'empty_patch', message: 'Provide at least one field to update.' };
  }
  return { ok: true, value: patch };
}

/** Validate and normalize a budget allocation line creation payload. */
export function normalizeProjectLineInput(raw: unknown): ValidationResult<NormalizedProjectLineInput> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
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
  if (!budget.ok) return budget;
  const committed = parseCentsField(b.committedCents, 'committedCents', { allowZero: true, defaultZero: true });
  if (!committed.ok) return committed;
  const notes = parseBoundedText(b.notes, 'notes', 1000);
  if (!notes.ok) return notes;
  return {
    ok: true,
    value: { name, channel, budgetCents: budget.value, committedCents: committed.value, notes: notes.value },
  };
}

/** Validate and normalize a partial budget line update payload. */
export function normalizeProjectLinePatch(raw: unknown): ValidationResult<NormalizedProjectLinePatch> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const patch: NormalizedProjectLinePatch = {};
  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 120) return { ok: false, error: 'invalid_line_name', message: 'Line name must be 1–120 characters.' };
    patch.name = name;
  }
  if (b.channel !== undefined) {
    const channel = String(b.channel).trim().toLowerCase();
    if (!CHANNEL_RE.test(channel)) return { ok: false, error: 'invalid_channel', message: 'Channel must be 1–40 lowercase characters.' };
    patch.channel = channel;
  }
  if (b.budgetCents !== undefined) {
    const budget = parseCentsField(b.budgetCents, 'budgetCents', { allowZero: true });
    if (!budget.ok) return budget;
    patch.budgetCents = budget.value;
  }
  if (b.committedCents !== undefined) {
    const committed = parseCentsField(b.committedCents, 'committedCents', { allowZero: true });
    if (!committed.ok) return committed;
    patch.committedCents = committed.value;
  }
  if (b.notes !== undefined) {
    const notes = parseBoundedText(b.notes, 'notes', 1000);
    if (!notes.ok) return notes;
    patch.notes = notes.value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'empty_patch', message: 'Provide at least one line field to update.' };
  }
  return { ok: true, value: patch };
}

/** Validate and normalize a project actual creation payload. */
export function normalizeProjectActualInput(raw: unknown): ValidationResult<NormalizedProjectActualInput> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let lineId: string | null = null;
  if (b.lineId !== undefined && b.lineId !== null && String(b.lineId).trim() !== '') {
    const candidate = String(b.lineId).trim();
    if (!UUID_RE.test(candidate)) {
      return { ok: false, error: 'invalid_line_id', message: 'lineId must be a valid UUID.' };
    }
    lineId = candidate;
  }
  const source = typeof b.source === 'string' ? b.source.trim().toLowerCase() : '';
  if (!(ACTUAL_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, error: 'invalid_source', message: `source must be one of: ${ACTUAL_SOURCES.join(', ')}.` };
  }
  const amount = parseCentsField(b.amountCents, 'amountCents', { allowZero: false });
  if (!amount.ok) return amount;
  const occurredOn = b.occurredOn === undefined || b.occurredOn === null || b.occurredOn === ''
    ? todayUtcDate() : String(b.occurredOn).trim();
  if (!isValidCalendarDate(occurredOn)) {
    return { ok: false, error: 'invalid_occurred_on', message: 'occurredOn must be a valid YYYY-MM-DD calendar date.' };
  }
  const ref = parseBoundedText(b.referenceId, 'referenceId', 200);
  if (!ref.ok) return ref;
  const evidence = parseEvidenceObject(b.evidence);
  if (!evidence.ok) return evidence;
  const note = parseBoundedText(b.note, 'note', 1000);
  if (!note.ok) return note;
  return {
    ok: true,
    value: {
      lineId, source: source as ActualSource, amountCents: amount.value, occurredOn,
      referenceId: ref.value || null, evidence: evidence.value, note: note.value,
    },
  };
}

/** Add two integer cent values while guarding against JS safe-integer overflow. */
function addCents(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error('Integer cent sum exceeded safe integer bounds.');
  return sum;
}

interface LineBucket {
  actualCents: number;
  actualCount: number;
  bySource: SourceTotals;
}

/** Bucket actuals into per-line and unassigned integer-cent accumulators. */
function bucketProjectActuals(lines: FinanceProjectLineRecord[], actuals: FinanceProjectActualRecord[]) {
  const bySource = emptyBySource();
  const lineBuckets = new Map<string, LineBucket>();
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
    } else {
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
export function summarizeFinanceProject(
  project: FinanceProjectRecord,
  lines: FinanceProjectLineRecord[],
  actuals: FinanceProjectActualRecord[],
): FinanceProjectSummary {
  const { bySource, lineBuckets, totalActualCents, unassignedActualCents, unassignedActualCount } = bucketProjectActuals(lines, actuals);
  let allocatedCents = 0;
  let totalCommittedCents = 0;
  const lineSummaries: ProjectLineSummary[] = lines.map((line) => {
    const budgetCents = toSafeCents(line.budgetCents);
    const committedCents = toSafeCents(line.committedCents);
    allocatedCents = addCents(allocatedCents, budgetCents);
    totalCommittedCents = addCents(totalCommittedCents, committedCents);
    const bucket = lineBuckets.get(line.lineId)!;
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
  const totals: FinanceProjectTotals = {
    projectBudgetCents, allocatedCents, unallocatedBudgetCents: projectBudgetCents - allocatedCents,
    totalBudgetCents, totalCommittedCents, totalActualCents,
    totalVarianceCents: totalBudgetCents - totalActualCents,
    remainingAfterCommittedCents: totalBudgetCents - totalCommittedCents - totalActualCents,
    unassignedActualCents, unassignedActualCount, overBudget: totalActualCents > totalBudgetCents,
    lineCount: lineSummaries.length, actualCount: actuals.length, bySource,
  };
  return { project, ...totals, totals, lines: lineSummaries, actuals };
}
