"use strict";
/**
 * Venture engine — the assumption ledger. This is the honesty spine.
 *
 * THE PROBLEM THIS SOLVES. A business plan whose numbers were narrated by a
 * language model is worse than no plan: it reads as researched, and a human
 * commits tooling money against it. So the engine splits at the arithmetic line —
 * a model may PROPOSE a value, but the value enters as an `Assumption` record
 * carrying where it came from and how much it is worth, and every computed figure
 * can name the assumptions it rests on.
 *
 * THE RULE WITH TEETH is `normalizeAssumption`: an assumption whose source is
 * `model-estimate` is hard-capped at confidence `'estimated'`. A language model
 * cannot launder its own guess into a quoted figure, because the cap is applied
 * on the way in rather than checked on the way out.
 *
 * UNITS ARE CHECKED, NOT ASSUMED. `readMicros` on a ledger entry recorded in
 * basis points throws. A rate read as money is the kind of defect that produces a
 * plausible number and no error at all.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — Assumption/AssumptionSource/Confidence, the model-estimate confidence cap, unit-checked readers, transitive reference collection, and the generated ledger statistics documents print instead of a hand-typed count.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | The confidence cap was scoped to source kind `model-estimate` alone, so a bot that emitted `published-rate` with a URL it never opened kept whatever confidence it claimed — up to `quoted`, which flipped the posture of an entire document set from ESTIMATE to quoted with no issue raised. `quoted` and `observed` are now reachable only through a vendor quote or an operator's own entry; every source kind a bot can author is capped at `benchmarked`. The persona instruction not to do this remains, but it is no longer the control.
 *
 * @module venture-assumptions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_CONFIDENCE_CEILING = exports.SOURCE_KINDS = exports.CONFIDENCE_ORDER = void 0;
exports.isWeakerConfidence = isWeakerConfidence;
exports.weakestConfidence = weakestConfidence;
exports.normalizeAssumption = normalizeAssumption;
exports.buildLedger = buildLedger;
exports.readAssumption = readAssumption;
exports.readMicros = readMicros;
exports.readBps = readBps;
exports.readRatio = readRatio;
exports.collectRefs = collectRefs;
exports.ledgerStats = ledgerStats;
exports.unresolvedRefs = unresolvedRefs;
const venture_issues_1 = require("./venture-issues");
/** Confidence values in descending strength. Index order is load-bearing. */
exports.CONFIDENCE_ORDER = [
    'quoted',
    'observed',
    'benchmarked',
    'estimated',
    'guessed',
];
/** Every source discriminant, for generated statistics. */
exports.SOURCE_KINDS = [
    'vendor-quote',
    'published-rate',
    'operator-input',
    'benchmark',
    'model-estimate',
];
/**
 * @description Whether `a` is a weaker confidence than `b`.
 * @param a - Candidate confidence.
 * @param b - Reference confidence.
 * @returns True when `a` sits later in CONFIDENCE_ORDER than `b`.
 */
function isWeakerConfidence(a, b) {
    return exports.CONFIDENCE_ORDER.indexOf(a) > exports.CONFIDENCE_ORDER.indexOf(b);
}
/**
 * @description The weakest confidence in a set — the honest headline for a
 *   figure that rests on several inputs, because a chain is worth its worst link.
 * @param values - Confidence values, possibly empty.
 * @returns The weakest value, or null when the set is empty.
 */
function weakestConfidence(values) {
    let worst = null;
    for (const v of values)
        if (worst === null || isWeakerConfidence(v, worst))
            worst = v;
    return worst;
}
/**
 * The strongest confidence each source kind may claim.
 *
 * WHY THIS IS A TABLE AND NOT A SINGLE `if`. The cap used to apply to
 * `model-estimate` alone, which meant a bot that labelled its own guess
 * `published-rate` and attached a plausible URL it had never opened kept the
 * confidence it claimed — including `quoted`. Executed against the engine, that one
 * relabelling flipped the posture of a whole document set from "ESTIMATE — nothing
 * here is a quote" to "quoted", with no issue raised anywhere. `quoted` and
 * `observed` are the two grades that mean somebody looked, so they are reachable
 * only through the two source kinds a human has to create: a recorded vendor quote,
 * and an operator's own entry. Everything a bot can author stops at `benchmarked`.
 */
exports.SOURCE_CONFIDENCE_CEILING = {
    'vendor-quote': 'quoted',
    'operator-input': 'observed',
    'published-rate': 'benchmarked',
    benchmark: 'benchmarked',
    'model-estimate': 'estimated',
};
/**
 * @description Normalise one assumption on the way in. FAIL-CLOSED: no source kind
 *   may claim a confidence above its ceiling, so a language model asserting its own
 *   guess is a vendor quote — or dressing it as a published rate — is downgraded
 *   here rather than trusted and caught later.
 * @param a - The candidate assumption.
 * @returns The normalised record plus any issues raised (a downgrade, a bad band).
 */
function normalizeAssumption(a) {
    const issues = [];
    let confidence = a.confidence;
    const ceiling = exports.SOURCE_CONFIDENCE_CEILING[a.source.kind] ?? 'estimated';
    if (isWeakerConfidence(ceiling, confidence)) {
        issues.push((0, venture_issues_1.issue)('model-confidence-downgraded', 'warn', `assumption:${a.id}`, `"${a.label}" carries a "${a.source.kind}" source and claimed confidence "${a.confidence}". A ${a.source.kind} may not certify itself above "${ceiling}" — "quoted" and "observed" mean a vendor put it in writing or an operator recorded what they saw — so it is recorded as "${ceiling}".`, { assumptionId: a.id, sourceKind: a.source.kind, claimed: a.confidence, recorded: ceiling }));
        confidence = ceiling;
    }
    let band = a.band;
    if (band && (!Number.isFinite(band.low) || !Number.isFinite(band.high) || band.low > band.high)) {
        issues.push((0, venture_issues_1.issue)('unsourced-estimate', 'warn', `assumption:${a.id}`, `"${a.label}" carries an inverted or non-finite band; it is dropped rather than swept over nonsense.`, { assumptionId: a.id }));
        band = undefined;
    }
    const normalised = { ...a, confidence };
    if (band === undefined)
        delete normalised.band;
    else
        normalised.band = band;
    return { assumption: normalised, issues };
}
/**
 * @description Build a ledger from a flat list, normalising every record and
 *   preserving declaration order. A duplicate id is a defect, not a merge: the
 *   later record wins and the collision is surfaced.
 * @param assumptions - The candidate records.
 * @returns The ledger plus every issue raised during normalisation.
 */
function buildLedger(assumptions) {
    const byId = {};
    const order = [];
    const issues = [];
    for (const raw of assumptions) {
        const { assumption, issues: normIssues } = normalizeAssumption(raw);
        issues.push(...normIssues);
        if (byId[assumption.id]) {
            issues.push((0, venture_issues_1.issue)('unsourced-estimate', 'warn', `assumption:${assumption.id}`, `Duplicate assumption id "${assumption.id}"; the later record replaces the earlier one.`, { assumptionId: assumption.id }));
        }
        else {
            order.push(assumption.id);
        }
        byId[assumption.id] = assumption;
    }
    return { ledger: { byId, order }, issues };
}
/**
 * @description Read one assumption with its unit checked. Throws on a missing id
 *   or a unit mismatch — reading a basis-point rate as money produces a plausible
 *   figure and no error, which is the worst possible failure here.
 * @param l - The ledger.
 * @param id - The assumption id.
 * @param expect - The unit the caller intends to use.
 * @returns The assumption record.
 */
function readAssumption(l, id, expect) {
    const a = l.byId[id];
    if (!a)
        throw new RangeError(`assumption "${id}" is not in the ledger`);
    if (a.unit !== expect) {
        throw new TypeError(`assumption "${id}" is recorded in ${a.unit} but was read as ${expect}`);
    }
    return a;
}
/**
 * @description Read a money assumption.
 * @param l - The ledger.
 * @param id - The assumption id.
 * @returns The value in integer micros.
 */
function readMicros(l, id) {
    return readAssumption(l, id, 'micros').value;
}
/**
 * @description Read a rate assumption.
 * @param l - The ledger.
 * @param id - The assumption id.
 * @returns The value in basis points.
 */
function readBps(l, id) {
    return readAssumption(l, id, 'bps').value;
}
/**
 * @description Read a unitless factor assumption.
 * @param l - The ledger.
 * @param id - The assumption id.
 * @returns The float factor.
 */
function readRatio(l, id) {
    return readAssumption(l, id, 'ratio').value;
}
/**
 * @description Collect distinct assumption references from mixed sources —
 *   bare id arrays and any object carrying `assumptionRefs`. Deduped and sorted so
 *   the provenance chain of a figure is stable output, which is what lets a guard
 *   assert on it.
 * @param sources - Ref arrays or ref-carrying objects, possibly undefined.
 * @returns Sorted distinct assumption ids.
 */
function collectRefs(...sources) {
    const set = new Set();
    for (const s of sources) {
        if (!s)
            continue;
        if (Array.isArray(s)) {
            for (const r of s)
                if (typeof r === 'string' && r)
                    set.add(r);
        }
        else {
            const refs = s.assumptionRefs;
            if (refs)
                for (const r of refs)
                    if (typeof r === 'string' && r)
                        set.add(r);
        }
    }
    return [...set].sort();
}
/**
 * @description Generated ledger statistics. Anti-drift rule: a document prints
 *   these counts, it never carries a hand-typed one.
 * @param l - The ledger.
 * @returns Totals by confidence and source kind, plus the soft-money and banded id lists.
 */
function ledgerStats(l) {
    const byConfidence = { quoted: 0, observed: 0, benchmarked: 0, estimated: 0, guessed: 0 };
    const bySourceKind = {
        'vendor-quote': 0, 'published-rate': 0, 'operator-input': 0, benchmark: 0, 'model-estimate': 0,
    };
    const softMoneyIds = [];
    const bandedIds = [];
    for (const id of l.order) {
        const a = l.byId[id];
        byConfidence[a.confidence] += 1;
        bySourceKind[a.source.kind] += 1;
        if (a.unit === 'micros' && (a.source.kind === 'model-estimate' || a.confidence === 'guessed'))
            softMoneyIds.push(id);
        if (a.band)
            bandedIds.push(id);
    }
    return { total: l.order.length, byConfidence, bySourceKind, softMoneyIds, bandedIds };
}
/**
 * @description Assumption ids referenced by the model but absent from the ledger.
 *   These are the numbers with NO provenance at all, and they are what turns
 *   `canPublish` false — an unlabelled input is the failure this app exists to
 *   prevent.
 * @param l - The ledger.
 * @param refs - Referenced assumption ids.
 * @returns The sorted distinct ids that are not registered.
 */
function unresolvedRefs(l, refs) {
    return [...new Set(refs.filter((r) => !l.byId[r]))].sort();
}
//# sourceMappingURL=venture-assumptions.js.map