/**
 * Venture Plan — the four bot output contracts and their parsers.
 *
 * THIS FILE IS THE WALL. Everything upstream of it is a language model; everything
 * downstream is arithmetic. A persona instruction saying "do not make up numbers"
 * is a hope; a parser that refuses the payload is a control, and this is the
 * parser.
 *
 * FOUR RULES, EACH ENFORCED AS CODE RATHER THAN AS A PROMPT:
 *
 * 1. **Unknown keys reject the whole row.** A bot that returns
 *    `{contributionMargin: 0.42}` alongside its assumptions is not returning a
 *    slightly wrong assumption, it is returning a computed financial result the
 *    engine alone may produce. The row is dropped and the reason is logged.
 *
 * 2. **A bot cannot self-certify.** `sourceKind` may only be `model-estimate`
 *    unless a `sourceUrl` or a `sourceDetail` document reference came with it.
 *    Claiming `vendor-quote` with nothing attached is downgraded, not honoured —
 *    the only way a `vendor-quote` enters this system is a human recording a real
 *    quote through `POST /quotes`.
 *
 * 3. **An estimate needs a band.** A single point price at high confidence with no
 *    source is the exact shape that reads as researched. Any row whose source is
 *    `model-estimate` and which carries no low/high band is rejected.
 *
 * 4. **Prose may not carry a number the model did not get from the figure table.**
 *    `verifyProseNumbers` extracts every numeric token from narration and returns
 *    the ones that match no figure and no assumption. It catches fabricated
 *    VALUES, not fabricated CONTEXT — "a gross margin of 42%" passes when 42% is
 *    the retailer margin — so the flag list is a floor, not a proof, and the
 *    document says so.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the four literal JSON contracts embedded in the prompts, strict parsers that reject unknown keys and force-downgrade an unsourced source-kind claim, the mandatory band rule for model estimates, and the prose numeral verifier the document store flags on.
 *
 * @module venture-bot-contracts
 */

import { createChildLogger } from '@/shared/logger';
import type { AssumptionInput, Confidence, Domain, SourceKind } from './venture-types';
import { isConfidence, isDomain, isSourceKind } from './venture-types';

const log = createChildLogger({ module: 'venture-bot-contracts' });

/** A parse either succeeds with rows or fails with a reason. Never partially. */
export type ParseResult<T> =
  | { ok: true; rows: T[]; rejected: string[] }
  | { ok: false; error: string };

/** Keys an assumption row may carry. Anything else rejects the row. */
const ASSUMPTION_KEYS = new Set([
  'key', 'domain', 'label', 'unit', 'valueNum', 'valueText', 'lowNum', 'highNum',
  'sourceKind', 'sourceDetail', 'sourceUrl', 'confidence', 'rationale',
]);

/** Keys a BOM row may carry. */
const BOM_KEYS = new Set([
  'ref', 'parentRef', 'partName', 'specText', 'qtyPerUnit', 'uom', 'discrete', 'material',
  'process', 'makeOrBuy', 'lowMicros', 'highMicros', 'scrapPct', 'moq', 'leadTimeDays',
  'toolingCostMicros', 'toolingLifeUnits', 'vendorName', 'htsCode', 'dutyPct',
  'confidence', 'rationale',
]);

/** Keys a vendor candidate may carry. */
const VENDOR_KEYS = new Set([
  'name', 'kind', 'country', 'url', 'contact', 'moq', 'leadTimeDays', 'qualificationDays',
  'depositBps', 'balanceNetDays', 'notes', 'confidence',
]);

/** Keys a schedule task may carry. */
const TASK_KEYS = new Set(['phase', 'name', 'ownerRole', 'durationDays', 'dependsOn', 'confidence']);

/** Keys a headcount role may carry. */
const ROLE_KEYS = new Set([
  'role', 'kind', 'fte', 'startMonth', 'endMonth', 'baseSalaryMicros', 'burdenBps', 'confidence',
]);

/**
 * @description Extract the first JSON object from a model's reply.
 *
 * Bots wrap JSON in prose and in fences however they feel that day. This finds the
 * outermost balanced object rather than regex-matching a fence, so a fenced reply,
 * a bare reply and a reply with a sentence in front all parse — and a reply with
 * no object at all fails loudly instead of silently yielding `{}`.
 *
 * @param text - The raw bot reply.
 * @returns The parsed object, or null when there is no balanced object in it.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(s.slice(start, i + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** True when every key of `row` is in `allowed`. Reports the first offender. */
function unknownKey(row: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  for (const k of Object.keys(row)) if (!allowed.has(k)) return k;
  return null;
}

/** A finite number, or null. Never NaN, never Infinity, never a numeric string. */
function fin(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * @description Decide the source kind a bot-authored row is allowed to claim.
 *
 * The one rule: without external evidence attached, everything is a model
 * estimate. A bot asserting `vendor-quote` with no URL and no document reference
 * is not lying on purpose — it is pattern-matching what a confident answer looks
 * like — and the fix is to make the claim unrepresentable rather than to ask it
 * not to.
 *
 * @param claimed - What the bot said.
 * @param sourceUrl - A URL it attached, if any.
 * @param sourceDetail - A document reference it attached, if any.
 * @returns The source kind the row will actually be stored with.
 */
export function resolveSourceKind(
  claimed: unknown, sourceUrl: unknown, sourceDetail: unknown,
): SourceKind {
  if (!isSourceKind(claimed)) return 'model-estimate';
  if (claimed === 'model-estimate') return 'model-estimate';
  // A URL is the only evidence a parser can even partially check. The earlier
  // version also accepted any `sourceDetail` of eight characters or more, which
  // meant the string "see p.12" manufactured provenance — a bot that writes eight
  // characters is not a bot that read a page. That branch is gone.
  const hasEvidence = typeof sourceUrl === 'string' && /^https?:\/\/\S+/i.test(sourceUrl);
  if (!hasEvidence) return 'model-estimate';
  // Even with a URL a bot may never assert a received quote or a user's own entry:
  // both are human actions, recorded through POST /quotes and the assumption editor.
  // The URL itself is never fetched, so `published-source` here means "the model
  // says this page says so", which is what the confidence cap downstream grades it as.
  return claimed === 'vendor-quote' || claimed === 'user-entered' ? 'published-source' : claimed;
}

/** Parse one assumption row, or explain why it was rejected. */
function parseAssumptionRow(raw: unknown): { row?: AssumptionInput; reject?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reject: 'not an object' };
  const r = raw as Record<string, unknown>;
  const bad = unknownKey(r, ASSUMPTION_KEYS);
  if (bad) return { reject: `unknown key "${bad}" — a bot may not return a computed result` };
  const key = typeof r.key === 'string' ? r.key.trim() : '';
  if (!/^[a-z0-9][a-z0-9.\-]{2,158}$/i.test(key)) return { reject: `bad key "${key}"` };
  if (!isDomain(r.domain)) return { reject: `key ${key}: unknown domain` };
  if (!isConfidence(r.confidence)) return { reject: `key ${key}: unknown confidence` };
  const valueNum = fin(r.valueNum);
  const valueText = typeof r.valueText === 'string' ? r.valueText : null;
  if (valueNum === null && !valueText) return { reject: `key ${key}: no value` };
  const sourceKind = resolveSourceKind(r.sourceKind, r.sourceUrl, r.sourceDetail);
  const lowNum = fin(r.lowNum);
  const highNum = fin(r.highNum);
  if (sourceKind === 'model-estimate' && valueNum !== null && (lowNum === null || highNum === null)) {
    return { reject: `key ${key}: a model estimate must carry a low/high band` };
  }
  if (lowNum !== null && highNum !== null && lowNum > highNum) {
    return { reject: `key ${key}: band is inverted` };
  }
  return {
    row: {
      key,
      domain: r.domain as Domain,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 300) : key,
      unit: typeof r.unit === 'string' ? r.unit.trim().slice(0, 24) : 'ratio',
      valueNum, valueText, lowNum, highNum,
      sourceKind,
      sourceDetail: typeof r.sourceDetail === 'string' ? r.sourceDetail.slice(0, 500) : null,
      sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl.slice(0, 500) : null,
      // A model estimate is capped at medium: the model may not tell you it is
      // confident in a number it invented.
      confidence: sourceKind === 'model-estimate' && r.confidence === 'high'
        ? 'medium' : (r.confidence as Confidence),
    },
  };
}

/** Collect an array field, parsing each entry and separating the rejects. */
function collect<T>(
  payload: Record<string, unknown>, field: string,
  parse: (raw: unknown) => { row?: T; reject?: string },
): { rows: T[]; rejected: string[] } {
  const raw = payload[field];
  if (!Array.isArray(raw)) return { rows: [], rejected: [] };
  const rows: T[] = [];
  const rejected: string[] = [];
  for (const entry of raw.slice(0, 400)) {
    const out = parse(entry);
    if (out.row) rows.push(out.row);
    else rejected.push(out.reject ?? 'rejected');
  }
  return { rows, rejected };
}

/**
 * @description Parse a market or ops analyst reply into assumption rows.
 * @param text - The raw bot reply.
 * @returns The accepted rows and the reasons the rest were dropped, or a failure
 *   when the reply contained no JSON object at all.
 */
export function parseAssumptionOutput(text: string): ParseResult<AssumptionInput> {
  const payload = extractJsonObject(text);
  if (!payload) return { ok: false, error: 'no JSON object in the reply' };
  const { rows, rejected } = collect(payload, 'assumptions', parseAssumptionRow);
  if (rejected.length) log.warn({ rejected: rejected.slice(0, 20), count: rejected.length }, 'assumption rows rejected');
  return { ok: true, rows, rejected };
}

/** One BOM line as the analyst draws it, before the store assigns ids. */
export interface BomDraft {
  ref: string;
  parentRef: string | null;
  partName: string;
  specText: string | null;
  qtyPerUnit: number;
  uom: string;
  discrete: boolean;
  material: string | null;
  process: string | null;
  makeOrBuy: string;
  lowMicros: number;
  highMicros: number;
  scrapPct: number;
  moq: number | null;
  leadTimeDays: number | null;
  toolingCostMicros: number;
  toolingLifeUnits: number | null;
  vendorName: string | null;
  htsCode: string | null;
  dutyPct: number | null;
  confidence: Confidence;
}

/** Parse one BOM line draft, or explain why it was rejected. */
function parseBomRow(raw: unknown): { row?: BomDraft; reject?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reject: 'not an object' };
  const r = raw as Record<string, unknown>;
  const bad = unknownKey(r, BOM_KEYS);
  if (bad) return { reject: `unknown key "${bad}"` };
  const ref = typeof r.ref === 'string' ? r.ref.trim().slice(0, 32) : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(ref)) return { reject: `bad ref "${ref}"` };
  if (typeof r.partName !== 'string' || !r.partName.trim()) return { reject: `${ref}: no part name` };
  if (!isConfidence(r.confidence)) return { reject: `${ref}: unknown confidence` };
  const low = fin(r.lowMicros);
  const high = fin(r.highMicros);
  // A BOM line WITHOUT a price band is the single most dangerous thing this app
  // can store: it becomes a cost the roll-up treats as known.
  if (low === null || high === null) return { reject: `${ref}: a cost line must carry a low/high band` };
  if (low < 0 || high < low) return { reject: `${ref}: band is negative or inverted` };
  return {
    row: {
      ref, parentRef: typeof r.parentRef === 'string' ? r.parentRef.trim().slice(0, 32) : null,
      partName: r.partName.trim().slice(0, 200),
      specText: typeof r.specText === 'string' ? r.specText.slice(0, 1000) : null,
      qtyPerUnit: Math.max(0, fin(r.qtyPerUnit) ?? 1),
      uom: typeof r.uom === 'string' ? r.uom.slice(0, 16) : 'ea',
      discrete: r.discrete !== false,
      material: typeof r.material === 'string' ? r.material.slice(0, 200) : null,
      process: typeof r.process === 'string' ? r.process.slice(0, 200) : null,
      makeOrBuy: r.makeOrBuy === 'make' ? 'make' : 'buy',
      lowMicros: Math.round(low), highMicros: Math.round(high),
      scrapPct: Math.max(0, Math.min(95, fin(r.scrapPct) ?? 0)),
      moq: fin(r.moq) === null ? null : Math.round(fin(r.moq) as number),
      leadTimeDays: fin(r.leadTimeDays) === null ? null : Math.round(fin(r.leadTimeDays) as number),
      toolingCostMicros: Math.max(0, Math.round(fin(r.toolingCostMicros) ?? 0)),
      toolingLifeUnits: fin(r.toolingLifeUnits) === null ? null : Math.round(fin(r.toolingLifeUnits) as number),
      vendorName: typeof r.vendorName === 'string' ? r.vendorName.slice(0, 200) : null,
      htsCode: typeof r.htsCode === 'string' ? r.htsCode.slice(0, 16) : null,
      dutyPct: fin(r.dutyPct),
      confidence: r.confidence as Confidence,
    },
  };
}

/** A vendor candidate as the analyst proposes it. */
export interface VendorDraft {
  name: string; kind: string; country: string | null; url: string | null; contact: string | null;
  moq: number | null; leadTimeDays: number | null; qualificationDays: number | null;
  depositBps: number; balanceNetDays: number; notes: string | null; confidence: Confidence;
}

/** Parse one vendor candidate. */
function parseVendorRow(raw: unknown): { row?: VendorDraft; reject?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reject: 'not an object' };
  const r = raw as Record<string, unknown>;
  const bad = unknownKey(r, VENDOR_KEYS);
  if (bad) return { reject: `unknown key "${bad}"` };
  if (typeof r.name !== 'string' || !r.name.trim()) return { reject: 'no vendor name' };
  if (!isConfidence(r.confidence)) return { reject: `${r.name}: unknown confidence` };
  return {
    row: {
      name: r.name.trim().slice(0, 200),
      kind: typeof r.kind === 'string' ? r.kind.slice(0, 24) : 'component',
      country: typeof r.country === 'string' ? r.country.slice(0, 64) : null,
      url: typeof r.url === 'string' ? r.url.slice(0, 500) : null,
      contact: typeof r.contact === 'string' ? r.contact.slice(0, 300) : null,
      moq: fin(r.moq) === null ? null : Math.round(fin(r.moq) as number),
      leadTimeDays: fin(r.leadTimeDays) === null ? null : Math.round(fin(r.leadTimeDays) as number),
      qualificationDays: fin(r.qualificationDays) === null ? null : Math.round(fin(r.qualificationDays) as number),
      depositBps: Math.max(0, Math.min(10000, Math.round(fin(r.depositBps) ?? 0))),
      balanceNetDays: Math.max(0, Math.min(365, Math.round(fin(r.balanceNetDays) ?? 0))),
      notes: typeof r.notes === 'string' ? r.notes.slice(0, 1000) : null,
      confidence: r.confidence as Confidence,
    },
  };
}

/**
 * @description Parse the BOM analyst's reply: lines plus vendor candidates.
 * @param text - The raw bot reply.
 * @returns The accepted BOM lines, vendor candidates and rejection reasons.
 */
export function parseBomOutput(text: string): ParseResult<BomDraft> & { vendors?: VendorDraft[] } {
  const payload = extractJsonObject(text);
  if (!payload) return { ok: false, error: 'no JSON object in the reply' };
  const lines = collect(payload, 'bom_lines', parseBomRow);
  const vendors = collect(payload, 'vendor_candidates', parseVendorRow);
  const rejected = [...lines.rejected, ...vendors.rejected];
  if (rejected.length) log.warn({ rejected: rejected.slice(0, 20), count: rejected.length }, 'BOM rows rejected');
  return { ok: true, rows: lines.rows, rejected, vendors: vendors.rows };
}

/** A schedule task the ops analyst proposes. */
export interface TaskDraft {
  phase: string; name: string; ownerRole: string | null; durationDays: number;
  dependsOn: string[]; confidence: Confidence;
}

/** A planned role the ops analyst proposes. */
export interface RoleDraft {
  role: string; kind: 'employee' | 'contractor'; fte: number; startMonth: number;
  endMonth: number | null; baseSalaryMicros: number; burdenBps: number; confidence: Confidence;
}

/** Parse one schedule task. */
function parseTaskRow(raw: unknown): { row?: TaskDraft; reject?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reject: 'not an object' };
  const r = raw as Record<string, unknown>;
  const bad = unknownKey(r, TASK_KEYS);
  if (bad) return { reject: `unknown key "${bad}"` };
  if (typeof r.name !== 'string' || !r.name.trim()) return { reject: 'no task name' };
  if (!isConfidence(r.confidence)) return { reject: `${r.name}: unknown confidence` };
  const days = fin(r.durationDays);
  if (days === null || days < 0) return { reject: `${r.name}: no duration` };
  return {
    row: {
      phase: typeof r.phase === 'string' ? r.phase.slice(0, 32) : 'plan',
      name: r.name.trim().slice(0, 300),
      ownerRole: typeof r.ownerRole === 'string' ? r.ownerRole.slice(0, 120) : null,
      durationDays: Math.round(days),
      dependsOn: Array.isArray(r.dependsOn) ? r.dependsOn.filter((d) => typeof d === 'string').slice(0, 20) as string[] : [],
      confidence: r.confidence as Confidence,
    },
  };
}

/** Parse one planned role. */
function parseRoleRow(raw: unknown): { row?: RoleDraft; reject?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reject: 'not an object' };
  const r = raw as Record<string, unknown>;
  const bad = unknownKey(r, ROLE_KEYS);
  if (bad) return { reject: `unknown key "${bad}"` };
  if (typeof r.role !== 'string' || !r.role.trim()) return { reject: 'no role name' };
  if (!isConfidence(r.confidence)) return { reject: `${r.role}: unknown confidence` };
  const base = fin(r.baseSalaryMicros);
  if (base === null || base < 0) return { reject: `${r.role}: no base salary` };
  const end = fin(r.endMonth);
  return {
    row: {
      role: r.role.trim().slice(0, 200),
      kind: r.kind === 'contractor' ? 'contractor' : 'employee',
      fte: Math.max(0, Math.min(50, fin(r.fte) ?? 1)),
      startMonth: Math.max(0, Math.round(fin(r.startMonth) ?? 0)),
      endMonth: end === null ? null : Math.max(0, Math.round(end)),
      baseSalaryMicros: Math.round(base),
      burdenBps: Math.max(0, Math.min(10000, Math.round(fin(r.burdenBps) ?? 3000))),
      confidence: r.confidence as Confidence,
    },
  };
}

/**
 * @description Parse the ops analyst's reply: assumptions, tasks and roles.
 * @param text - The raw bot reply.
 * @returns The accepted assumptions plus the task and role drafts.
 */
export function parseOpsOutput(text: string): ParseResult<AssumptionInput> & {
  tasks?: TaskDraft[]; roles?: RoleDraft[];
} {
  const payload = extractJsonObject(text);
  if (!payload) return { ok: false, error: 'no JSON object in the reply' };
  const assumptions = collect(payload, 'assumptions', parseAssumptionRow);
  const tasks = collect(payload, 'schedule_tasks', parseTaskRow);
  const roles = collect(payload, 'headcount_roles', parseRoleRow);
  const rejected = [...assumptions.rejected, ...tasks.rejected, ...roles.rejected];
  if (rejected.length) log.warn({ rejected: rejected.slice(0, 20), count: rejected.length }, 'ops rows rejected');
  return { ok: true, rows: assumptions.rows, rejected, tasks: tasks.rows, roles: roles.rows };
}

/**
 * @description Parse the strategist's scoping reply into a qualitative spec.
 *
 * Numbers are NOT read out of this reply. The strategist's job is language, and a
 * target launch date is the only quantity it may set, because a date is a
 * constraint the user stated rather than a figure the model derived.
 *
 * @param text - The raw bot reply.
 * @returns The spec fields, the open questions, and a suggested name.
 */
export function parseScopeOutput(text: string): {
  name: string | null;
  spec: { productClass?: string; customer?: string; positioning?: string; constraints?: string[] };
  openQuestions: string[];
} {
  const payload = extractJsonObject(text) ?? {};
  const str = (v: unknown, max: number): string | undefined =>
    (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const list = (v: unknown): string[] =>
    (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => (x as string).slice(0, 400)).slice(0, 20) : []);
  return {
    name: str(payload.name, 120) ?? null,
    spec: {
      productClass: str(payload.productClass, 300),
      customer: str(payload.customer, 500),
      positioning: str(payload.positioning, 800),
      constraints: list(payload.constraints),
    },
    openQuestions: list(payload.openQuestions),
  };
}

/**
 * @description Parse a narration reply into per-section prose.
 * @param text - The raw bot reply.
 * @returns Section key -> prose. Values that are not strings are dropped.
 */
export function parseProseOutput(text: string): Record<string, string> {
  const payload = extractJsonObject(text);
  const sections = payload && typeof payload.sections === 'object' && payload.sections
    ? payload.sections as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) {
    if (typeof v === 'string' && v.trim()) out[k.slice(0, 64)] = v.trim().slice(0, 8000);
  }
  return out;
}

/** Numerals in prose, including $1,234.50, 42%, 1.2k and 3.4m. */
const NUMERAL_RE = /(?:\$\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(%|k\b|m\b|bn\b)?/gi;

/** Normalise a matched numeral to a plain number, applying any suffix. */
function numeralValue(digits: string, suffix?: string): number {
  const base = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(base)) return NaN;
  const s = (suffix ?? '').toLowerCase();
  if (s === 'k') return base * 1_000;
  if (s === 'm') return base * 1_000_000;
  if (s === 'bn') return base * 1_000_000_000;
  return base;
}

/**
 * @description Every numeral in prose that matches no figure and no assumption.
 *
 * Matching is tolerant on scale — a figure held in micro-dollars is compared
 * against its dollar and cent projections too, because prose says "$18.42" for a
 * figure stored as 18,420,000. Small integers (0-100) are ignored: they are
 * overwhelmingly counts and percentages that appear in ordinary sentences, and
 * flagging them would drown the real hits.
 *
 * THIS CATCHES FABRICATED VALUES, NOT FABRICATED CONTEXT. "A gross margin of 42%"
 * passes when 42% is the RETAILER margin. The returned list is a floor.
 *
 * @param prose - The narrated text.
 * @param values - Every number the model legitimately holds (figures, assumption
 *   values and band endpoints).
 * @returns The unmatched numerals as they appeared, de-duplicated.
 */
export function verifyProseNumbers(prose: string, values: readonly number[]): string[] {
  const allowed = new Set<number>();
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    for (const scaled of [v, v / 1_000_000, v / 10_000, v / 100]) {
      allowed.add(Math.round(scaled * 100) / 100);
      allowed.add(Math.round(scaled));
    }
  }
  const unmatched = new Set<string>();
  for (const m of String(prose ?? '').matchAll(NUMERAL_RE)) {
    const value = numeralValue(m[1], m[2]);
    if (!Number.isFinite(value)) continue;
    if (Number.isInteger(value) && value >= 0 && value <= 100 && !m[0].includes('$')) continue;
    // Compare at two decimal places ONLY. An earlier draft also accepted a
    // numeral whose INTEGER part matched an allowed value, which sounded
    // forgiving and was in fact a hole big enough to drive the whole defect
    // through: $18.43 passed because $18.42 rounded to 18. The mutation guard in
    // venture-contracts.test.js is what found it. Allowed values already carry
    // their own integer projection, so prose that legitimately says "$18" for a
    // figure of $18.42 still matches — a wrong cent does not.
    if (allowed.has(Math.round(value * 100) / 100)) continue;
    unmatched.add(m[0].trim());
  }
  return [...unmatched].slice(0, 100);
}
