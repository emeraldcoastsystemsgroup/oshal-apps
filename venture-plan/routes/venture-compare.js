"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScenarioCompareError = exports.MAX_COMPARE_SCENARIOS = exports.MIN_COMPARE_SCENARIOS = void 0;
exports.selectScenariosForCompare = selectScenariosForCompare;
exports.compareScenarios = compareScenarios;
const venture_assumptions_1 = require("./venture-assumptions");
const venture_model_1 = require("./venture-model");
const venture_primitives_1 = require("./venture-primitives");
/** Minimum scenarios required for a meaningful side-by-side comparison. */
exports.MIN_COMPARE_SCENARIOS = 2;
/** Maximum scenarios compared in one request to bound synchronous CPU work. */
exports.MAX_COMPARE_SCENARIOS = 10;
/** Explicit caller-visible refusal for invalid scenario comparison inputs. */
class ScenarioCompareError extends Error {
    code;
    /**
     * @description Build a typed scenario-compare refusal.
     * @param code - Stable machine error code.
     * @param message - Plain explanation of why the comparison was refused.
     */
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ScenarioCompareError';
    }
}
exports.ScenarioCompareError = ScenarioCompareError;
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
function selectScenariosForCompare(allScenarios, requestedIds, requestedBaselineId = null) {
    const byId = new Map(allScenarios.map((s) => [s.id, s]));
    const selected = resolveSelectedScenarios(allScenarios, byId, requestedIds);
    const baselineId = resolveBaselineId(selected, byId, requestedBaselineId);
    return { selected, baselineId };
}
/** Deduplicate, bound and resolve requested scenario ids against owned scenarios. */
function resolveSelectedScenarios(allScenarios, byId, requestedIds) {
    if (!requestedIds.length) {
        const auto = allScenarios.slice(0, exports.MAX_COMPARE_SCENARIOS);
        if (auto.length < exports.MIN_COMPARE_SCENARIOS) {
            throw new ScenarioCompareError('compare_too_few_scenarios', `At least ${exports.MIN_COMPARE_SCENARIOS} saved scenarios are required to compare (found ${auto.length}).`);
        }
        return auto;
    }
    const deduped = dedupeIds(requestedIds);
    if (deduped.length > exports.MAX_COMPARE_SCENARIOS) {
        throw new ScenarioCompareError('compare_too_many_scenarios', `At most ${exports.MAX_COMPARE_SCENARIOS} scenarios may be compared at once (received ${deduped.length}).`);
    }
    const resolved = [];
    for (const id of deduped) {
        const found = byId.get(id);
        if (!found) {
            throw new ScenarioCompareError('compare_scenario_not_found', `Scenario "${id}" was not found.`);
        }
        resolved.push(found);
    }
    if (resolved.length < exports.MIN_COMPARE_SCENARIOS) {
        throw new ScenarioCompareError('compare_too_few_scenarios', `Select at least ${exports.MIN_COMPARE_SCENARIOS} distinct scenarios to compare (received ${resolved.length}).`);
    }
    return resolved;
}
/** Deduplicate scenario ids while preserving caller order. */
function dedupeIds(ids) {
    const seen = new Set();
    const out = [];
    for (const raw of ids) {
        const id = raw.trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
/** Resolve and validate the baseline scenario id against owned and selected sets. */
function resolveBaselineId(selected, byId, requestedBaselineId) {
    if (!requestedBaselineId)
        return selected[0].id;
    if (!byId.has(requestedBaselineId)) {
        throw new ScenarioCompareError('compare_scenario_not_found', `Baseline scenario "${requestedBaselineId}" was not found.`);
    }
    if (!selected.some((s) => s.id === requestedBaselineId)) {
        throw new ScenarioCompareError('compare_baseline_not_found', `Baseline scenario "${requestedBaselineId}" must be one of the selected scenarios.`);
    }
    return requestedBaselineId;
}
/** Extract exact integer metrics from one built VentureModel. */
function extractMetrics(model) {
    const rev = model.financials.totals.revenueMicros;
    const grossProfit = (0, venture_primitives_1.addMicros)(...model.financials.pnl.map((p) => p.grossProfitMicros));
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
        grossMarginBps: (0, venture_primitives_1.bpsOf)(grossProfit, rev),
        contributionPerUnitMicros: (0, venture_model_1.contributionPerUnitMicros)(model),
        contributionBps: (0, venture_primitives_1.bpsOf)(model.financials.totals.contributionMicros, rev),
        breakEvenUnits: beUnits,
        breakEvenUnitsPerMonth: beUnits !== null && horizonLen > 0 ? (0, venture_primitives_1.roundHalfUp)(beUnits / horizonLen) : null,
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
function extractProvenance(model) {
    const byConf = model.traceability.ledger.byConfidence;
    const confidences = [];
    for (const id of model.input.ledger.order)
        confidences.push(model.input.ledger.byId[id].confidence);
    for (const f of Object.values(model.figures))
        if (f.confidence)
            confidences.push(f.confidence);
    return {
        posture: model.posture,
        canPublish: model.canPublish,
        weakestConfidence: (0, venture_assumptions_1.weakestConfidence)(confidences),
        unsourcedFigureCount: model.traceability.unsourcedFigureIds.length,
        softFigureCount: model.traceability.softFigureIds.length,
        estimatedOrGuessedCount: (byConf.estimated ?? 0) + (byConf.guessed ?? 0),
        blockingIssueCount: model.issues.filter((i) => i.severity === 'block').length,
    };
}
/** Subtract two optional micro-currency values using overflow-checked subMicros. */
function deltaMicros(val, base) {
    return val === null || base === null ? null : (0, venture_primitives_1.subMicros)(val, base);
}
/** Subtract two optional integer unit or basis-point values. */
function deltaInt(val, base) {
    return val === null || base === null ? null : val - base;
}
/** Compute exact integer deltas of one scenario relative to the baseline metrics. */
function computeDeltas(m, b) {
    return {
        runQtyUnits: m.runQtyUnits - b.runQtyUnits,
        unitsSold: m.unitsSold - b.unitsSold,
        shelfPriceMicros: (0, venture_primitives_1.subMicros)(m.shelfPriceMicros, b.shelfPriceMicros),
        landedUnitMicros: deltaMicros(m.landedUnitMicros, b.landedUnitMicros),
        grossMarginBps: deltaInt(m.grossMarginBps, b.grossMarginBps),
        contributionPerUnitMicros: (0, venture_primitives_1.subMicros)(m.contributionPerUnitMicros, b.contributionPerUnitMicros),
        contributionBps: deltaInt(m.contributionBps, b.contributionBps),
        breakEvenUnits: deltaInt(m.breakEvenUnits, b.breakEvenUnits),
        breakEvenUnitsPerMonth: deltaInt(m.breakEvenUnitsPerMonth, b.breakEvenUnitsPerMonth),
        revenueMicros: (0, venture_primitives_1.subMicros)(m.revenueMicros, b.revenueMicros),
        netIncomeMicros: (0, venture_primitives_1.subMicros)(m.netIncomeMicros, b.netIncomeMicros),
        cashTroughMicros: (0, venture_primitives_1.subMicros)(m.cashTroughMicros, b.cashTroughMicros),
        fundingRequiredMicros: (0, venture_primitives_1.subMicros)(m.fundingRequiredMicros, b.fundingRequiredMicros),
        closingCashMicros: (0, venture_primitives_1.subMicros)(m.closingCashMicros, b.closingCashMicros),
        closingWorkingCapitalMicros: (0, venture_primitives_1.subMicros)(m.closingWorkingCapitalMicros, b.closingWorkingCapitalMicros),
    };
}
/** Ordered specification of every metric row in the side-by-side matrix. */
const METRIC_SPECS = Object.freeze([
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
function buildMetricRows(scenarios, baseline) {
    return METRIC_SPECS.map((spec) => {
        const values = {};
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
function assumptionDelta(value, base, unit) {
    if (value === null || base === null)
        return null;
    return unit === 'micros' ? (0, venture_primitives_1.subMicros)(value, base) : value - base;
}
/** Build one diff row for a scenario-level structural lever when values vary. */
function leverDiffRow(built, baselineId, spec) {
    const distinct = new Set(built.map((b) => spec.read(b.model)));
    if (distinct.size <= 1)
        return null;
    const baseRow = built.find((b) => b.entry.scenarioId === baselineId) ?? built[0];
    const baseVal = spec.read(baseRow.model);
    const byScenario = {};
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
function ledgerDiffRows(built, baselineId) {
    const keys = new Set();
    for (const b of built)
        for (const k of b.model.input.ledger.order)
            keys.add(k);
    const baseLedger = (built.find((b) => b.entry.scenarioId === baselineId) ?? built[0]).model.input.ledger;
    const rows = [];
    for (const key of [...keys].sort()) {
        const row = oneLedgerDiffRow(built, baseLedger, key);
        if (row)
            rows.push(row);
    }
    return rows;
}
/** Build a single ledger diff row, or null when identical across all scenarios. */
function oneLedgerDiffRow(built, baseLedger, key) {
    const vals = new Set();
    const confs = new Set();
    let label = key;
    let unit = 'ratio';
    for (const b of built) {
        const a = b.model.input.ledger.byId[key];
        vals.add(a ? a.value : null);
        confs.add(a ? a.confidence : null);
        if (a) {
            label = a.label;
            unit = a.unit;
        }
    }
    const valueDiffers = vals.size > 1;
    const confidenceDiffers = confs.size > 1;
    if (!valueDiffers && !confidenceDiffers)
        return null;
    const baseVal = baseLedger.byId[key]?.value ?? null;
    const byScenario = {};
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
function buildAssumptionDiffs(built, baselineId) {
    const ledgerRows = ledgerDiffRows(built, baselineId);
    const priceAlreadyInLedger = ledgerRows.some((r) => r.key === 'channel.retail-price' && r.valueDiffers);
    const levers = [];
    const runDiff = leverDiffRow(built, baselineId, {
        key: '@scenario.runQtyUnits', label: 'Planned production run', unit: 'units',
        read: (m) => m.bom.runQtyUnits,
    });
    if (runDiff)
        levers.push(runDiff);
    if (!priceAlreadyInLedger) {
        const priceDiff = leverDiffRow(built, baselineId, {
            key: '@scenario.retailPriceMicros', label: 'Retail shelf price', unit: 'micros',
            read: (m) => m.demand.priceMicros,
        });
        if (priceDiff)
            levers.push(priceDiff);
    }
    return [...levers, ...ledgerRows];
}
/** Deduplicate entries by scenarioId while validating 2..10 bounds and baseline. */
function normalizeEntries(entries, baselineScenarioId) {
    const seen = new Set();
    const unique = [];
    for (const entry of entries) {
        if (seen.has(entry.scenarioId))
            continue;
        seen.add(entry.scenarioId);
        unique.push(entry);
    }
    if (unique.length < exports.MIN_COMPARE_SCENARIOS) {
        throw new ScenarioCompareError('compare_too_few_scenarios', `At least ${exports.MIN_COMPARE_SCENARIOS} distinct scenarios are required to compare (received ${unique.length}).`);
    }
    if (unique.length > exports.MAX_COMPARE_SCENARIOS) {
        throw new ScenarioCompareError('compare_too_many_scenarios', `At most ${exports.MAX_COMPARE_SCENARIOS} scenarios may be compared at once (received ${unique.length}).`);
    }
    const baselineId = baselineScenarioId || unique[0].scenarioId;
    if (!unique.some((e) => e.scenarioId === baselineId)) {
        throw new ScenarioCompareError('compare_baseline_not_found', `Baseline scenario "${baselineId}" is not in the compared scenario set.`);
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
function compareScenarios(entries, baselineScenarioId) {
    const { unique, baselineId } = normalizeEntries(entries, baselineScenarioId);
    const built = unique.map((entry) => ({ entry, model: (0, venture_model_1.buildVentureModel)(entry.input) }));
    const extracted = built.map((b) => ({
        entry: b.entry,
        metrics: extractMetrics(b.model),
        provenance: extractProvenance(b.model),
    }));
    const baseItem = extracted.find((x) => x.entry.scenarioId === baselineId) ?? extracted[0];
    const scenarios = extracted.map((x) => ({
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
