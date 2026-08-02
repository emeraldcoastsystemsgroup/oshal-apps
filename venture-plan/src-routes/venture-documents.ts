/**
 * Venture Plan — deterministic document rendering.
 *
 * A DOCUMENT IS ASSEMBLED FROM A SNAPSHOT, NEVER FROM A PROMPT. Figure sections
 * resolve ids out of the stored `figures` map; table sections print the computed
 * tables verbatim; only `prose` sections carry model-written language, and every
 * numeral in those is checked against the model's own numbers before the document
 * is stored. A number therefore cannot enter a document as prose without being
 * visible as an unverified number on the surface.
 *
 * THE HEADER IS COMPUTED AND IT CHANGES EVERY TIME. Not a boilerplate disclaimer —
 * a generated line stating the posture, how many of the plan's assumptions are
 * still the model's own guesses, and whether the model would publish at all. A
 * reader cannot learn to skim it, because it is never the same twice.
 *
 * A REQUIRED FIGURE THE ENGINE DID NOT PRODUCE THROWS. `MissingFiguresError` names
 * every one of them, and the route turns that into a 409 the surface can act on.
 * The alternative — printing a blank — is indistinguishable from printing a zero,
 * and in a funding document the difference is the whole point.
 *
 * `optionalKeys` are for figures that are legitimately ABSENT rather than missing:
 * a break-even volume when contribution is negative is the answer "never", and it
 * renders as that sentence rather than as a hole.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the computed posture header, figure/table/assumption/prose section rendering, the throw-on-missing-required-figure rule, the assumption register and its CSV projection, and the model-table builder that freezes engine results into a snapshot.
 *
 * @module venture-documents
 */

import { formatFigure } from './venture-figures';
import type { Figure as EngineFigure } from './venture-figures';
import { formatUsd } from './venture-primitives';
import type { VentureModel } from './venture-model';
import { verifyProseNumbers } from './venture-bot-contracts';
import type { DocSpec } from './venture-doc-catalog';
import type { Assumption, BomLine, Coverage, HeadcountRow, ScheduleTask, Vendor } from './venture-types';

/** Thrown when a document specification names a figure the engine did not produce. */
export class MissingFiguresError extends Error {
  /**
   * @description Build the error naming every absent figure.
   * @param docKey - The document that could not be rendered.
   * @param figureIds - The required figure ids missing from the registry.
   */
  constructor(public readonly docKey: string, public readonly figureIds: string[]) {
    super(`document "${docKey}" requires figures the model did not compute: ${figureIds.join(', ')}`);
    this.name = 'MissingFiguresError';
  }
}

/** A rendered document, before it is versioned and stored. */
export interface RenderedDocument {
  docKey: string;
  title: string;
  bodyMd: string;
  sections: Array<{ heading: string; kind: string }>;
  unverifiedNumbers: string[];
  assumptionsCited: string[];
  estimatePct: number;
}

/** Everything the renderer reads. All of it already computed or stored. */
export interface RenderSources {
  figures: Record<string, EngineFigure>;
  tables: Record<string, unknown[]>;
  coverage: Coverage;
  posture: string;
  canPublish: boolean;
  warnings: string[];
  assumptions: readonly Assumption[];
  /** Prose by section key. Absent keys render as an explicit "not written" line. */
  prose: Record<string, string>;
  ventureName: string;
  computedAt: string;
}

/** Format one figure for a markdown table cell. */
function cell(f: EngineFigure): string {
  return formatFigure(f);
}

/** Escape a markdown table cell so a pipe in a part name cannot break the table. */
function md(v: unknown): string {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * @description The generated posture header every document carries.
 *
 * Regenerated on every render from the model's own coverage, so the sentence a
 * reader sees moves as the evidence does. That is the difference between a
 * disclaimer and a measurement.
 *
 * @param s - The render sources.
 * @param spec - The document being rendered.
 * @returns The markdown header block.
 */
export function postureHeader(s: RenderSources, spec: DocSpec): string {
  const soft = s.figures['ledger.softMoneyCount']?.value ?? 0;
  const total = s.coverage.totalAssumptions;
  const lines = [
    `# ${spec.title}`,
    '',
    `**${s.ventureName}** · for ${spec.audience}`,
    '',
    `> **Decision this supports:** ${spec.decision}`,
    '>',
    `> **Posture: ${s.posture}.** ${total} assumption${total === 1 ? '' : 's'} registered, `
      + `${s.coverage.bySourceKind['model-estimate']} of them written by a model rather than sourced `
      + `(${s.coverage.estimatePct}%). ${soft} money assumption${soft === 1 ? ' has' : 's have'} no quote behind `
      + `${soft === 1 ? 'it' : 'them'}.`,
    '>',
    s.canPublish
      ? '> Every figure below traces to a registered assumption or to a computation over one.'
      : '> **This model will not publish.** At least one figure rests on an input that is not '
        + 'registered as an assumption at all, or a blocking condition was raised. Treat every '
        + 'number here as a placeholder until the register is complete.',
    '>',
    `> Computed ${s.computedAt}. Every number is either a computation or a labelled assumption; `
      + 'none is a quoted result unless the register says so.',
    '',
  ];
  return lines.join('\n');
}

/** Render one figures section, collecting any required ids that are absent. */
function figuresSection(
  s: RenderSources, heading: string, keys: readonly string[], optional: readonly string[],
  missing: string[], cited: Set<string>,
): string {
  const rows: string[] = ['| Figure | Value | How it was derived | Rests on |', '|---|---|---|---|'];
  for (const key of keys) {
    const f = s.figures[key];
    if (!f) { missing.push(key); continue; }
    for (const r of f.assumptionRefs) cited.add(r);
    rows.push(`| ${md(f.label)} | ${md(cell(f))} | ${md(f.formula)} | ${md(f.assumptionRefs.join(', ') || 'no registered inputs')} |`);
  }
  for (const key of optional) {
    const f = s.figures[key];
    if (!f) {
      rows.push(`| ${md(key)} | *not reachable* | the model produced no value for this at the planned volume | — |`);
      continue;
    }
    for (const r of f.assumptionRefs) cited.add(r);
    rows.push(`| ${md(f.label)} | ${md(cell(f))} | ${md(f.formula)} | ${md(f.assumptionRefs.join(', ') || 'no registered inputs')} |`);
  }
  return `## ${heading}\n\n${rows.join('\n')}\n`;
}

/** Column order per computed table. Keeps a document's columns stable across runs. */
const TABLE_COLUMNS: Readonly<Record<string, string[]>> = Object.freeze({
  bom: ['name', 'supplierId', 'effectiveQtyPerUnit', 'purchaseQty', 'bandUnitCostMicros',
    'extendedMicros', 'moqOverbuyMicros', 'outsideQuotedBands'],
  landedLegs: ['key', 'paidBy', 'totalMicros', 'perUnitMicros', 'basis'],
  waterfall: ['channelId', 'step', 'amountMicros', 'basis'],
  pnl: ['month', 'revenueMicros', 'cogsMicros', 'grossProfitMicros', 'channelFeeMicros',
    'marketingMicros', 'payrollMicros', 'opexMicros', 'ebitdaMicros', 'netIncomeMicros',
    'cumulativeNetIncomeMicros'],
  cash: ['month', 'openingMicros', 'inflowsMicros', 'outflowsMicros', 'netMicros', 'cumulativeMicros'],
  schedule: ['phase', 'name', 'ownerRole', 'durationDays', 'confidence'],
  headcount: ['role', 'kind', 'fte', 'startMonth', 'endMonth', 'baseSalaryMicros', 'burdenBps', 'confidence'],
  vendors: ['name', 'kind', 'country', 'moq', 'leadTimeDays', 'status', 'confidence'],
  tornado: ['label', 'baseValue', 'lowValue', 'highValue', 'swingMicros', 'direction'],
});

/** Columns whose values are micro-dollars and are formatted as money. */
const MONEY_COLUMNS = new Set([
  'bandUnitCostMicros', 'extendedMicros', 'moqOverbuyMicros', 'totalMicros', 'perUnitMicros',
  'amountMicros', 'revenueMicros', 'cogsMicros', 'grossProfitMicros', 'channelFeeMicros',
  'marketingMicros', 'payrollMicros', 'opexMicros', 'ebitdaMicros', 'netIncomeMicros',
  'cumulativeNetIncomeMicros', 'openingMicros', 'inflowsMicros', 'outflowsMicros', 'netMicros',
  'cumulativeMicros', 'baseSalaryMicros', 'swingMicros',
]);

/** Render one computed table section. */
function tableSection(s: RenderSources, heading: string, table: string): string {
  const rows = Array.isArray(s.tables[table]) ? s.tables[table] as Array<Record<string, unknown>> : [];
  const cols = TABLE_COLUMNS[table] ?? (rows.length ? Object.keys(rows[0]) : []);
  if (!rows.length) {
    return `## ${heading}\n\n*Nothing computed for this table yet — the plan has no rows to fill it.*\n`;
  }
  const head = `| ${cols.join(' | ')} |`;
  const rule = `|${cols.map(() => '---').join('|')}|`;
  const body = rows.slice(0, 400).map((r) => `| ${cols.map((c) => (
    MONEY_COLUMNS.has(c) && typeof r[c] === 'number' ? formatUsd(r[c] as number) : md(r[c])
  )).join(' | ')} |`);
  return `## ${heading}\n\n${[head, rule, ...body].join('\n')}\n`;
}

/** Render the assumption register, optionally narrowed to some domains. */
function assumptionSection(
  s: RenderSources, heading: string, domains: readonly string[] | undefined, cited: Set<string>,
): string {
  const rows = s.assumptions.filter((a) => !domains || domains.includes(a.domain));
  if (!rows.length) return `## ${heading}\n\n*No assumptions registered yet.*\n`;
  const out = [
    '| Key | What it is | Value | Band | Source | Confidence | Author |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const a of rows) {
    cited.add(a.key);
    const value = a.valueNum === null ? (a.valueText ?? '') : `${a.valueNum} ${a.unit}`;
    const band = a.lowNum !== null && a.highNum !== null ? `${a.lowNum} – ${a.highNum}` : '—';
    out.push(`| \`${md(a.key)}\` | ${md(a.label)} | ${md(value)} | ${md(band)} | ${md(a.sourceKind)}`
      + `${a.sourceUrl ? ` ([source](${md(a.sourceUrl)}))` : ''} | ${md(a.confidence)} | ${md(a.authoredBy)} |`);
  }
  return `## ${heading}\n\n${out.join('\n')}\n`;
}

/** Render one prose section, or say plainly that nobody has written it. */
function proseSection(s: RenderSources, heading: string, proseKey: string): string {
  const text = s.prose[proseKey];
  if (!text) {
    return `## ${heading}\n\n*Not written. Ask for narration on this document to have the strategist `
      + 'draft it over the computed model.*\n';
  }
  return `## ${heading}\n\n${text}\n`;
}

/**
 * @description Render one document from a computed snapshot.
 *
 * Throws `MissingFiguresError` when a required figure is absent — loudly, naming
 * every one, so the caller can tell the user what the model could not compute
 * instead of handing them a document with holes in it.
 *
 * @param spec - The document specification.
 * @param s - The snapshot, ledger and prose to render from.
 * @returns The rendered markdown, the sections, the cited assumption keys and the
 *   numerals in the prose that match nothing in the model.
 */
export function renderDocument(spec: DocSpec, s: RenderSources): RenderedDocument {
  const missing: string[] = [];
  const cited = new Set<string>();
  const parts: string[] = [postureHeader(s, spec)];
  const sections: Array<{ heading: string; kind: string }> = [];

  for (const section of spec.sections) {
    sections.push({ heading: section.heading, kind: section.kind });
    if (section.kind === 'figures') {
      parts.push(figuresSection(s, section.heading, section.keys, section.optionalKeys ?? [], missing, cited));
    } else if (section.kind === 'table') {
      parts.push(tableSection(s, section.heading, section.table));
    } else if (section.kind === 'assumptions') {
      parts.push(assumptionSection(s, section.heading, section.domains, cited));
    } else {
      parts.push(proseSection(s, section.heading, section.proseKey));
    }
  }

  if (missing.length) throw new MissingFiguresError(spec.key, missing);

  if (s.warnings.length) {
    parts.push(`## Conditions the engine raised\n\n${s.warnings.map((w) => `- ${w}`).join('\n')}\n`);
  }

  const bodyMd = parts.join('\n');
  return {
    docKey: spec.key,
    title: spec.title,
    bodyMd,
    sections,
    unverifiedNumbers: verifyProseNumbers(
      spec.sections.filter((x) => x.kind === 'prose')
        .map((x) => s.prose[(x as { proseKey: string }).proseKey] ?? '').join('\n'),
      knownValues(s),
    ),
    assumptionsCited: [...cited].sort(),
    estimatePct: s.coverage.estimatePct,
  };
}

/** Every number the model legitimately holds — figures, values and band endpoints. */
function knownValues(s: RenderSources): number[] {
  const out: number[] = [];
  for (const f of Object.values(s.figures)) out.push(f.value);
  for (const a of s.assumptions) {
    if (a.valueNum !== null) out.push(a.valueNum);
    if (a.lowNum !== null) out.push(a.lowNum);
    if (a.highNum !== null) out.push(a.highNum);
  }
  return out;
}

/**
 * @description The assumption register as CSV, for the export bundle.
 *
 * The one artefact somebody can open in a spreadsheet and work through line by
 * line, replacing guesses with quotes. Deliberately plain.
 *
 * @param assumptions - The live assumption set.
 * @returns CSV text with a header row.
 */
export function renderRegisterCsv(assumptions: readonly Assumption[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['key', 'domain', 'label', 'unit', 'value', 'low', 'high', 'source_kind',
    'source_detail', 'source_url', 'confidence', 'authored_by', 'created_at'];
  const rows = assumptions.map((a) => [
    a.key, a.domain, a.label, a.unit,
    a.valueNum === null ? (a.valueText ?? '') : a.valueNum,
    a.lowNum ?? '', a.highNum ?? '', a.sourceKind, a.sourceDetail ?? '', a.sourceUrl ?? '',
    a.confidence, a.authoredBy, a.createdAt,
  ].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}

/** Everything the snapshot's `tables` field holds, built once at compute time. */
export interface ModelTables extends Record<string, unknown[]> {
  bom: unknown[];
  landedLegs: unknown[];
  waterfall: unknown[];
  pnl: unknown[];
  cash: unknown[];
  schedule: unknown[];
  headcount: unknown[];
  vendors: unknown[];
  tornado: unknown[];
}

/**
 * @description Freeze the engine's results into the plain tables a snapshot stores.
 *
 * Nothing is recomputed here — every value is copied from what the engine already
 * produced, because a table that re-derived its own numbers would be a second
 * source for a figure and the two would eventually disagree.
 *
 * @param model - The computed engine model.
 * @param stored - The stored rows the engine does not own (vendors, tasks, roles).
 * @param tornado - The sensitivity bars, when a sweep was run.
 * @returns The tables, ready to persist as JSONB.
 */
export function buildTables(
  model: VentureModel,
  stored: { vendors: readonly Vendor[]; tasks: readonly ScheduleTask[]; roles: readonly HeadcountRow[];
    bomLines: readonly BomLine[] },
  tornado: unknown[] = [],
): ModelTables {
  return {
    bom: model.bom.lines.map((l) => ({
      name: l.name, supplierId: l.supplierId, effectiveQtyPerUnit: l.effectiveQtyPerUnit,
      purchaseQty: l.purchaseQty, bandUnitCostMicros: l.bandUnitCostMicros,
      extendedMicros: l.extendedMicros, moqOverbuyMicros: l.moqOverbuyMicros,
      outsideQuotedBands: l.outsideQuotedBands,
    })),
    landedLegs: model.landed.legs.map((g) => ({
      key: g.key, paidBy: g.paidBy, totalMicros: g.totalMicros,
      perUnitMicros: g.perUnitMicros, basis: g.basis,
    })),
    waterfall: model.waterfalls.flatMap((w) => w.steps.map((st) => ({
      channelId: w.channelId, step: st.label, amountMicros: st.amountMicros, basis: st.basis,
    }))),
    pnl: model.financials.pnl,
    cash: model.financials.cash,
    schedule: stored.tasks.map((t) => ({
      phase: t.phase, name: t.name, ownerRole: t.ownerRole,
      durationDays: t.durationDays, confidence: t.confidence,
    })),
    headcount: stored.roles.map((r) => ({
      role: r.role, kind: r.kind, fte: r.fte, startMonth: r.startMonth, endMonth: r.endMonth,
      baseSalaryMicros: r.baseSalaryMicros, burdenBps: r.burdenBps, confidence: r.confidence,
    })),
    vendors: stored.vendors.map((v) => ({
      name: v.name, kind: v.kind, country: v.country, moq: v.moq,
      leadTimeDays: v.leadTimeDays, status: v.status, confidence: v.confidence,
    })),
    tornado,
  };
}
