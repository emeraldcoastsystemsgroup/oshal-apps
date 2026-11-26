/**
 * Venture engine — pure side-by-side scenario comparison.
 *
 * WHY THIS MODULE EXISTS. A decision-maker rarely asks "is this single scenario
 * good?" in isolation — they ask "what happens if we cut volume from 5,000 to
 * 2,500, or hold price at $69.99 instead of $79.99, or swap in a domestic
 * supplier quote?" Running two or more scenarios side by side through the exact
 * same deterministic engine (`buildVentureModel`), computing integer micro-currency
 * and basis-point deltas relative to a chosen baseline, and listing every
 * assumption or lever that differs between them makes the trade-off legible
 * without calling a language model or spending a cent.
 *
 * Pure: no I/O, no clock, no randomness, no floats in financial math.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial implementation — deterministic 2..10 scenario selection, full-engine side-by-side evaluation, integer micro-currency/bps deltas against a chosen baseline, provenance posture roll-up, and assumption/lever diffing.
 *
 * @module venture-compare
 */

import {
  weakestConfidence, type AssumptionLedger, type AssumptionUnit, type Confidence,
} from './venture-assumptions';
import type { ModelPosture } from './venture-figures';
import {
  buildVentureModel, contributionPerUnitMicros, type VentureModel, type VentureModelInput,
} from './venture-model';
import {
  addMicros, bpsOf, roundHalfUp, subMicros, type Bps, type Micros, type YearMonth,
} from './venture-primitives';

/** Minimum scenarios required for a meaningful side-by-side comparison. */
export const MIN_COMPARE_SCENARIOS = 2;

/** Maximum scenarios compared in one request to bound synchronous CPU work. */
export const MAX_COMPARE_SCENARIOS = 10;

/** Closed error codes for scenario selection and comparison refusals. */
export type ScenarioCompareErrorCode =
  | 'compare_too_few_scenarios'
  | 'compare_too_many_scenarios'
  | 'compare_scenario_not_found'
  | 'compare_baseline_not_found';

/** Explicit caller-visible refusal for invalid scenario comparison inputs. */
export class ScenarioCompareError extends Error {
  /**
   * @description Build a typed scenario-compare refusal.
   * @param code - Stable machine error code.
   * @param message - Plain explanation of why the comparison was refused.
   */
  constructor(public readonly code: ScenarioCompareErrorCode, message: string) {
    super(message);
    this.name = 'ScenarioCompareError';
  }
}

/** One composed scenario ready for pure engine comparison. */
export interface ScenarioCompareEntry {
  scenarioId: string;
  name: string;
  isBase: boolean;
  input: VentureModelInput;
}

/** Exact integer financial and operational metrics extracted from one built model. */
export interface ScenarioMetrics {
  runQtyUnits: number;
  unitsSold: number;
  shelfPriceMicros: Micros;
  landedUnitMicros: Micros | null;
  grossMarginBps: Bps | null;
  contributionPerUnitMicros: Micros;
  contributionBps: Bps | null;
  breakEvenUnits: number | null;
  breakEvenUnitsPerMonth: number | null;
  breakEvenMonth: YearMonth | null;
  cashBreakEvenMonth: YearMonth | null;
  revenueMicros: Micros;
  netIncomeMicros: Micros;
  cashTroughMicros: Micros;
  cashTroughMonth: YearMonth | null;
  fundingRequiredMicros: Micros;
  closingCashMicros: Micros;
  closingWorkingCapitalMicros: Micros;
}

/** Integer deltas for one scenario relative to the chosen baseline scenario. */
export interface ScenarioDeltas {
  runQtyUnits: number;
  unitsSold: number;
  shelfPriceMicros: Micros;
  landedUnitMicros: Micros | null;
  grossMarginBps: Bps | null;
  contributionPerUnitMicros: Micros;
  contributionBps: Bps | null;
  breakEvenUnits: number | null;
  breakEvenUnitsPerMonth: number | null;
  revenueMicros: Micros;
  netIncomeMicros: Micros;
  cashTroughMicros: Micros;
  fundingRequiredMicros: Micros;
  closingCashMicros: Micros;
  closingWorkingCapitalMicros: Micros;
}

/** Provenance and publishability posture for one scenario's model. */
export interface ScenarioProvenance {
  posture: ModelPosture;
  canPublish: boolean;
  weakestConfidence: Confidence | null;
  unsourcedFigureCount: number;
  softFigureCount: number;
  estimatedOrGuessedCount: number;
  blockingIssueCount: number;
}

/** One scenario column in the comparison result. */
export interface ComparedScenario {
  scenarioId: string;
  name: string;
  isBase: boolean;
  isBaseline: boolean;
  metrics: ScenarioMetrics;
  deltas: ScenarioDeltas;
  provenance: ScenarioProvenance;
}

/** Polarity guides whether a positive delta is favorable or unfavorable. */
export type MetricPolarity = 'higher-is-better' | 'lower-is-better' | 'neutral';

/** One row in the tabular metric matrix across all compared scenarios. */
export interface ComparisonMetricRow {
  key: keyof ScenarioDeltas;
  label: string;
  unit: 'micros' | 'bps' | 'units';
  polarity: MetricPolarity;
  baselineValue: number | null;
  values: Record<string, { value: number | null; delta: number | null }>;
}

/** One scenario's reading for a differing assumption or scenario lever. */
export interface AssumptionDiffCell {
  value: number | null;
  confidence: Confidence | null;
  deltaFromBaseline: number | null;
}

/** One assumption or scenario lever whose value or confidence differs across scenarios. */
export interface AssumptionDiffRow {
  key: string;
  label: string;
  unit: AssumptionUnit;
  kind: 'assumption' | 'scenario-lever';
  valueDiffers: boolean;
  confidenceDiffers: boolean;
  byScenario: Record<string, AssumptionDiffCell>;
}

/** Complete deterministic comparison output across 2..10 scenarios. */
export interface ScenarioComparisonResult {
  baselineScenarioId: string;
  scenarioCount: number;
  scenarios: ComparedScenario[];
  rows: ComparisonMetricRow[];
  assumptionDiffs: AssumptionDiffRow[];
}

/**
 * @description Select and validate 2..10 owned scenarios plus the baseline id.
 *
 * Unknown or foreign ids are refused with `compare_scenario_not_found` before
 * checking minimum cardinality so callers cannot probe foreign scenario ids via
 * status-code differences.
 *
 * @param allScenarios - All scenarios owned by the caller for this venture.
 * @param requestedIds - Explicit scenario ids (empty/omitted means select all up to 10).
 * @param requestedBaselineId - Optional baseline scenario id; defaults to first selected.
 * @returns Ordered, deduplicated scenarios and the resolved baseline id.
 */
export function selectScenariosForCompare<T extends { id: string }>(
  allScenarios: readonly T[],
  requestedIds: readonly string[],
  requestedBaselineId: string | null = null,
): { selected: T[]; baselineId: string } {
  const byId = new Map(allScenarios.map((s) => [s.id, s]));
  const selected = resolveSelectedScenarios(allScenarios, byId, requestedIds);
  const baselineId = resolveBaselineId(selected, byId, requestedBaselineId);
  return { selected, baselineId };
}

/** Deduplicate, bound and resolve requested scenario ids against owned scenarios. */
function resolveSelectedScenarios<T extends { id: string }>(
  allScenarios: readonly T[],
  byId: ReadonlyMap<string, T>,
  requestedIds: readonly string[],
): T[] {
  if (!requestedIds.length) {
    const auto = allScenarios.slice(0, MAX_COMPARE_SCENARIOS);
    if (auto.length < MIN_COMPARE_SCENARIOS) {
      throw new ScenarioCompareError(
        'compare_too_few_scenarios',
        `At least ${MIN_COMPARE_SCENARIOS} saved scenarios are required to compare (found ${auto.length}).`,
      );
    }
    return auto;
  }
  const deduped = dedupeIds(requestedIds);
  if (deduped.length > MAX_COMPARE_SCENARIOS) {
    throw new ScenarioCompareError(
      'compare_too_many_scenarios',
      `At most ${MAX_COMPARE_SCENARIOS} scenarios may be compared at once (received ${deduped.length}).`,
    );
  }
  const resolved: T[] = [];
  for (const id of deduped) {
    const found = byId.get(id);
    if (!found) {
      throw new ScenarioCompareError('compare_scenario_not_found', `Scenario "${id}" was not found.`);
    }
    resolved.push(found);
  }
  if (resolved.length < MIN_COMPARE_SCENARIOS) {
    throw new ScenarioCompareError(
      'compare_too_few_scenarios',
      `Select at least ${MIN_COMPARE_SCENARIOS} distinct scenarios to compare (received ${resolved.length}).`,
    );
  }
  return resolved;
}

/** Deduplicate scenario ids while preserving caller order. */
function dedupeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Resolve and validate the baseline scenario id against owned and selected sets. */
function resolveBaselineId<T extends { id: string }>(
  selected: readonly T[],
  byId: ReadonlyMap<string, T>,
  requestedBaselineId: string | null,
): string {
  if (!requestedBaselineId) return selected[0].id;
  if (!byId.has(requestedBaselineId)) {
    throw new ScenarioCompareError(
      'compare_scenario_not_found',
      `Baseline scenario "${requestedBaselineId}" was not found.`,
    );
  }
  if (!selected.some((s) => s.id === requestedBaselineId)) {
    throw new ScenarioCompareError(
      'compare_baseline_not_found',
      `Baseline scenario "${requestedBaselineId}" must be one of the selected scenarios.`,
    );
  }
  return requestedBaselineId;
}

/** Extract exact integer metrics from one built VentureModel. */
function extractMetrics(model: VentureModel): ScenarioMetrics {
  const rev = model.financials.totals.revenueMicros;
  const grossProfit = addMicros(...model.financials.pnl.map((p) => p.grossProfitMicros));
  const beUnits = model.breakEven.units;
  const horizonLen = model.horizon.length;
  const lastCash = model.financials.cash.length
    ? model.financials.cash[model.financials.cash.length - 1].closingMicros
    : model.input.openingCashMicros;
  const lastWc = model.financials.workingCapital.length
    ? model.financials.workingCapital[model.financials.workingCapital.length - 1].workingCapitalMicros
    : 0;
  return {
    runQtyUnits: model.bom.runQtyUnits,
    unitsSold: model.unitsSold,
    shelfPriceMicros: model.demand.priceMicros,
    landedUnitMicros: model.landed.buyerUnitMicros,
    grossMarginBps: bpsOf(grossProfit, rev),
    contributionPerUnitMicros: contributionPerUnitMicros(model),
    contributionBps: bpsOf(model.financials.totals.contributionMicros, rev),
    breakEvenUnits: beUnits,
    breakEvenUnitsPerMonth: beUnits !== null && horizonLen > 0 ? roundHalfUp(beUnits / horizonLen) : null,
    breakEvenMonth: model.breakEven.accountingBreakEvenMonth,
    cashBreakEvenMonth: model.breakEven.cashBreakEvenMonth,
    revenueMicros: rev,
    netIncomeMicros: model.financials.totals.netIncomeMicros,
    cashTroughMicros: model.financials.peakCash.troughMicros,
    cashTroughMonth: model.financials.peakCash.month,
    fundingRequiredMicros: model.financials.peakCash.fundingRequiredMicros,
    closingCashMicros: lastCash,
    closingWorkingCapitalMicros: lastWc,
  };
}

/** Extract provenance posture and weakest confidence from one built model. */
function extractProvenance(model: VentureModel): ScenarioProvenance {
  const byConf = model.traceability.ledger.byConfidence;
  const confidences: Confidence[] = [];
  for (const id of model.input.ledger.order) confidences.push(model.input.ledger.byId[id].confidence);
  for (const f of Object.values(model.figures)) if (f.confidence) confidences.push(f.confidence);
  return {
    posture: model.posture,
    canPublish: model.canPublish,
    weakestConfidence: weakestConfidence(confidences),
    unsourcedFigureCount: model.traceability.unsourcedFigureIds.length,
    softFigureCount: model.traceability.softFigureIds.length,
    estimatedOrGuessedCount: (byConf.estimated ?? 0) + (byConf.guessed ?? 0),
    blockingIssueCount: model.issues.filter((i) => i.severity === 'block').length,
  };
}

/** Subtract two optional micro-currency values using overflow-checked subMicros. */
function deltaMicros(val: Micros | null, base: Micros | null): Micros | null {
  return val === null || base === null ? null : subMicros(val, base);
}

/** Subtract two optional integer unit or basis-point values. */
function deltaInt(val: number | null, base: number | null): number | null {
  return val === null || base === null ? null : val - base;
}

/** Compute exact integer deltas of one scenario relative to the baseline metrics. */
function computeDeltas(m: ScenarioMetrics, b: ScenarioMetrics): ScenarioDeltas {
  return {
    runQtyUnits: m.runQtyUnits - b.runQtyUnits,
    unitsSold: m.unitsSold - b.unitsSold,
    shelfPriceMicros: subMicros(m.shelfPriceMicros, b.shelfPriceMicros),
    landedUnitMicros: deltaMicros(m.landedUnitMicros, b.landedUnitMicros),
    grossMarginBps: deltaInt(m.grossMarginBps, b.grossMarginBps),
    contributionPerUnitMicros: subMicros(m.contributionPerUnitMicros, b.contributionPerUnitMicros),
    contributionBps: deltaInt(m.contributionBps, b.contributionBps),
    breakEvenUnits: deltaInt(m.breakEvenUnits, b.breakEvenUnits),
    breakEvenUnitsPerMonth: deltaInt(m.breakEvenUnitsPerMonth, b.breakEvenUnitsPerMonth),
    revenueMicros: subMicros(m.revenueMicros, b.revenueMicros),
    netIncomeMicros: subMicros(m.netIncomeMicros, b.netIncomeMicros),
    cashTroughMicros: subMicros(m.cashTroughMicros, b.cashTroughMicros),
    fundingRequiredMicros: subMicros(m.fundingRequiredMicros, b.fundingRequiredMicros),
    closingCashMicros: subMicros(m.closingCashMicros, b.closingCashMicros),
    closingWorkingCapitalMicros: subMicros(m.closingWorkingCapitalMicros, b.closingWorkingCapitalMicros),
  };
}

/** Ordered specification of every metric row in the side-by-side matrix. */
const METRIC_SPECS: ReadonlyArray<{
  key: keyof ScenarioDeltas;
  label: string;
  unit: 'micros' | 'bps' | 'units';
  polarity: MetricPolarity;
}> = Object.freeze([
  { key: 'runQtyUnits', label: 'Planned production run', unit: 'units', polarity: 'neutral' },
  { key: 'unitsSold', label: 'Units sold', unit: 'units', polarity: 'higher-is-better' },
  { key: 'shelfPriceMicros', label: 'Blended shelf price', unit: 'micros', polarity: 'neutral' },
  { key: 'landedUnitMicros', label: 'Landed cost per unit', unit: 'micros', polarity: 'lower-is-better' },
  { key: 'grossMarginBps', label: 'Gross margin', unit: 'bps', polarity: 'higher-is-better' },
  { key: 'contributionPerUnitMicros', label: 'Contribution per unit', unit: 'micros', polarity: 'higher-is-better' },
  { key: 'contributionBps', label: 'Contribution margin', unit: 'bps', polarity: 'higher-is-better' },
  { key: 'breakEvenUnits', label: 'Break-even run size', unit: 'units', polarity: 'lower-is-better' },
  { key: 'breakEvenUnitsPerMonth', label: 'Break-even units / month', unit: 'units', polarity: 'lower-is-better' },
  { key: 'revenueMicros', label: 'Horizon revenue', unit: 'micros', polarity: 'higher-is-better' },
  { key: 'netIncomeMicros', label: 'Horizon net income', unit: 'micros', polarity: 'higher-is-better' },
  { key: 'cashTroughMicros', label: 'Cash trough', unit: 'micros', polarity: 'higher-is-better' },
  { key: 'fundingRequiredMicros', label: 'Funding required', unit: 'micros', polarity: 'lower-is-better' },
  { key: 'closingCashMicros', label: 'Closing cash', unit: 'micros', polarity: 'higher-is-better' },
  { key: 'closingWorkingCapitalMicros', label: 'Closing working capital', unit: 'micros', polarity: 'neutral' },
]);

/** Build the metric-row matrix from the already-computed scenario entries. */
function buildMetricRows(
  scenarios: readonly ComparedScenario[],
  baseline: ComparedScenario,
): ComparisonMetricRow[] {
  return METRIC_SPECS.map((spec) => {
    const values: Record<string, { value: number | null; delta: number | null }> = {};
    for (const s of scenarios) {
      values[s.scenarioId] = {
        value: s.metrics[spec.key],
        delta: s.deltas[spec.key],
      };
    }
    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      polarity: spec.polarity,
      baselineValue: baseline.metrics[spec.key],
      values,
    };
  });
}

/** Compute an assumption cell's delta from baseline using integer micros when applicable. */
function assumptionDelta(value: number | null, base: number | null, unit: AssumptionUnit): number | null {
  if (value === null || base === null) return null;
  return unit === 'micros' ? subMicros(value, base) : value - base;
}

/** Build one diff row for a scenario-level structural lever when values vary. */
function leverDiffRow(
  built: ReadonlyArray<{ entry: ScenarioCompareEntry; model: VentureModel }>,
  baselineId: string,
  spec: { key: string; label: string; unit: AssumptionUnit; read: (m: VentureModel) => number },
): AssumptionDiffRow | null {
  const distinct = new Set(built.map((b) => spec.read(b.model)));
  if (distinct.size <= 1) return null;
  const baseRow = built.find((b) => b.entry.scenarioId === baselineId) ?? built[0];
  const baseVal = spec.read(baseRow.model);
  const byScenario: Record<string, AssumptionDiffCell> = {};
  for (const b of built) {
    const val = spec.read(b.model);
    byScenario[b.entry.scenarioId] = {
      value: val,
      confidence: null,
      deltaFromBaseline: assumptionDelta(val, baseVal, spec.unit),
    };
  }
  return {
    key: spec.key, label: spec.label, unit: spec.unit, kind: 'scenario-lever',
    valueDiffers: true, confidenceDiffers: false, byScenario,
  };
}

/** Build diff rows for every ledger assumption whose value or confidence varies. */
function ledgerDiffRows(
  built: ReadonlyArray<{ entry: ScenarioCompareEntry; model: VentureModel }>,
  baselineId: string,
): AssumptionDiffRow[] {
  const keys = new Set<string>();
  for (const b of built) for (const k of b.model.input.ledger.order) keys.add(k);
  const baseLedger: AssumptionLedger = (built.find((b) => b.entry.scenarioId === baselineId) ?? built[0]).model.input.ledger;
  const rows: AssumptionDiffRow[] = [];
  for (const key of [...keys].sort()) {
    const row = oneLedgerDiffRow(built, baseLedger, key);
    if (row) rows.push(row);
  }
  return rows;
}

/** Build a single ledger diff row, or null when identical across all scenarios. */
function oneLedgerDiffRow(
  built: ReadonlyArray<{ entry: ScenarioCompareEntry; model: VentureModel }>,
  baseLedger: AssumptionLedger,
  key: string,
): AssumptionDiffRow | null {
  const vals = new Set<number | null>();
  const confs = new Set<Confidence | null>();
  let label = key;
  let unit: AssumptionUnit = 'ratio';
  for (const b of built) {
    const a = b.model.input.ledger.byId[key];
    vals.add(a ? a.value : null);
    confs.add(a ? a.confidence : null);
    if (a) { label = a.label; unit = a.unit; }
  }
  const valueDiffers = vals.size > 1;
  const confidenceDiffers = confs.size > 1;
  if (!valueDiffers && !confidenceDiffers) return null;
  const baseVal = baseLedger.byId[key]?.value ?? null;
  const byScenario: Record<string, AssumptionDiffCell> = {};
  for (const b of built) {
    const a = b.model.input.ledger.byId[key];
    const value = a ? a.value : null;
    byScenario[b.entry.scenarioId] = {
      value,
      confidence: a ? a.confidence : null,
      deltaFromBaseline: assumptionDelta(value, baseVal, unit),
    };
  }
  return { key, label, unit, kind: 'assumption', valueDiffers, confidenceDiffers, byScenario };
}

/** Collect all differing scenario levers and ledger assumptions across scenarios. */
function buildAssumptionDiffs(
  built: ReadonlyArray<{ entry: ScenarioCompareEntry; model: VentureModel }>,
  baselineId: string,
): AssumptionDiffRow[] {
  const ledgerRows = ledgerDiffRows(built, baselineId);
  const priceAlreadyInLedger = ledgerRows.some((r) => r.key === 'channel.retail-price' && r.valueDiffers);
  const levers: AssumptionDiffRow[] = [];
  const runDiff = leverDiffRow(built, baselineId, {
    key: '@scenario.runQtyUnits', label: 'Planned production run', unit: 'units',
    read: (m) => m.bom.runQtyUnits,
  });
  if (runDiff) levers.push(runDiff);
  if (!priceAlreadyInLedger) {
    const priceDiff = leverDiffRow(built, baselineId, {
      key: '@scenario.retailPriceMicros', label: 'Retail shelf price', unit: 'micros',
      read: (m) => m.demand.priceMicros,
    });
    if (priceDiff) levers.push(priceDiff);
  }
  return [...levers, ...ledgerRows];
}

/** Deduplicate entries by scenarioId while validating 2..10 bounds and baseline. */
function normalizeEntries(
  entries: readonly ScenarioCompareEntry[],
  baselineScenarioId?: string | null,
): { unique: ScenarioCompareEntry[]; baselineId: string } {
  const seen = new Set<string>();
  const unique: ScenarioCompareEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.scenarioId)) continue;
    seen.add(entry.scenarioId);
    unique.push(entry);
  }
  if (unique.length < MIN_COMPARE_SCENARIOS) {
    throw new ScenarioCompareError(
      'compare_too_few_scenarios',
      `At least ${MIN_COMPARE_SCENARIOS} distinct scenarios are required to compare (received ${unique.length}).`,
    );
  }
  if (unique.length > MAX_COMPARE_SCENARIOS) {
    throw new ScenarioCompareError(
      'compare_too_many_scenarios',
      `At most ${MAX_COMPARE_SCENARIOS} scenarios may be compared at once (received ${unique.length}).`,
    );
  }
  const baselineId = baselineScenarioId || unique[0].scenarioId;
  if (!unique.some((e) => e.scenarioId === baselineId)) {
    throw new ScenarioCompareError(
      'compare_baseline_not_found',
      `Baseline scenario "${baselineId}" is not in the compared scenario set.`,
    );
  }
  return { unique, baselineId };
}

/**
 * @description Compare 2..10 composed scenarios side by side using the exact
 *   deterministic engine (`buildVentureModel`), computing integer deltas vs the
 *   chosen baseline and surfacing every differing assumption or scenario lever.
 *
 * PURE: byte-identical output for identical input, no clock, no mutation, no LLM.
 *
 * @param entries - Composed scenarios (2..10 distinct scenario ids).
 * @param baselineScenarioId - Optional baseline scenario id; defaults to first.
 * @returns Per-scenario metrics/deltas/provenance, tabular rows, and assumption diffs.
 */
export function compareScenarios(
  entries: readonly ScenarioCompareEntry[],
  baselineScenarioId?: string | null,
): ScenarioComparisonResult {
  const { unique, baselineId } = normalizeEntries(entries, baselineScenarioId);
  const built = unique.map((entry) => ({ entry, model: buildVentureModel(entry.input) }));
  const extracted = built.map((b) => ({
    entry: b.entry,
    metrics: extractMetrics(b.model),
    provenance: extractProvenance(b.model),
  }));
  const baseItem = extracted.find((x) => x.entry.scenarioId === baselineId) ?? extracted[0];
  const scenarios: ComparedScenario[] = extracted.map((x) => ({
    scenarioId: x.entry.scenarioId,
    name: x.entry.name,
    isBase: x.entry.isBase,
    isBaseline: x.entry.scenarioId === baselineId,
    metrics: x.metrics,
    deltas: computeDeltas(x.metrics, baseItem.metrics),
    provenance: x.provenance,
  }));
  const baseline = scenarios.find((s) => s.scenarioId === baselineId) ?? scenarios[0];
  return {
    baselineScenarioId: baselineId,
    scenarioCount: scenarios.length,
    scenarios,
    rows: buildMetricRows(scenarios, baseline),
    assumptionDiffs: buildAssumptionDiffs(built, baselineId),
  };
}
