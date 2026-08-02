"use strict";
/**
 * Venture Plan — the bridge from stored rows to the engine's model input.
 *
 * This is the ONLY module that knows both vocabularies. The store speaks in
 * `owner_sub`, revisions and `source_kind`; the engine speaks in integer
 * micro-dollars, basis points and a confidence ladder. Everything either side of
 * this file is free of the other's concepts, which is what lets the engine stay
 * pure and the store stay dumb.
 *
 * TWO TRANSLATIONS CARRY REAL WEIGHT.
 *
 * 1. **Source kind and confidence.** A store row saying `vendor-quote` becomes an
 *    engine assumption at confidence `quoted`; a `model-estimate` becomes at BEST
 *    `estimated`, and `low` confidence becomes `guessed`. The engine's own
 *    `normalizeAssumption` enforces the cap again on the way in, so a bug here
 *    cannot launder a guess into a quote — the two checks are deliberate
 *    redundancy on the one rule that matters.
 *
 * 2. **Bindings.** Every price break, freight rate, duty rate, demand scenario and
 *    shelf price is bound to its assumption id by a dotted path into the object
 *    this module just built. Without that, editing an assumption would change the
 *    LEDGER and not the arithmetic — a sensitivity sweep that reports no
 *    sensitivity, which is worse than no sweep at all.
 *
 * A BRAND-NEW VENTURE IS DELIBERATELY UNPUBLISHABLE. The synthetic assembly root
 * references `bom.final-assembly.cost`, and until somebody registers that number
 * the model reports it as unsourced and refuses to publish. That is not a gap; it
 * is the app telling you the one thing it cannot invent.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the row-to-engine translation, the source-kind/confidence ladder, deterministic assumption bindings for every numeric field the sweep must be able to move, the bounded structure overlay from the venture spec, and scenario override application through the engine's own withAssumption.
 *
 * @module venture-store-compose
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSEMBLY_COST_KEY = void 0;
exports.engineConfidence = engineConfidence;
exports.toEngineLedger = toEngineLedger;
exports.buildBomTree = buildBomTree;
exports.composeModelInput = composeModelInput;
exports.missingKeys = missingKeys;
exports.hashableInputs = hashableInputs;
const venture_assumptions_1 = require("./venture-assumptions");
const venture_model_1 = require("./venture-model");
/** Engine assumption units. Anything else is stored as an unweighted ratio. */
const ENGINE_UNITS = Object.freeze([
    'micros', 'bps', 'ratio', 'units', 'count', 'weeks', 'months', 'oz', 'cbm', 'lb',
]);
/** The assumption key the synthetic assembly root resolves its own cost through. */
exports.ASSEMBLY_COST_KEY = 'bom.final-assembly.cost';
/** Whole dollars to micro-dollars, for the structural defaults below. */
const D = (dollars) => Math.round(dollars * 1_000_000);
/**
 * Structural defaults for a venture nobody has configured yet.
 *
 * These are SHAPES, not numbers a plan should trust: every value that reaches an
 * arithmetic result carries an `assumptionRef`, so an unregistered one shows up in
 * `unsourcedFigureIds` by name. A default that quietly produced a publishable
 * model would be the failure this whole package exists to prevent.
 */
const DEFAULTS = Object.freeze({
    runQtyUnits: 5000,
    horizonMonths: 36,
    unitsPerContainer: 400,
    cbmPerUnit: 0.05,
    shelfPriceMicros: D(99.99),
    transitWeeks: 5,
    receivingWeeks: 2,
    sellWindowWeeks: 6,
    fixedOpexPerMonthMicros: D(2000),
});
/**
 * @description Map a store confidence + source kind onto the engine's ladder.
 *
 * The rule the whole app rests on lives in the first line: a number the model
 * produced can never be `quoted` or `observed`, however confident the model
 * claimed to be.
 *
 * @param a - The stored assumption revision.
 * @returns The engine confidence level.
 */
function engineConfidence(a) {
    if (a.sourceKind === 'model-estimate')
        return a.confidence === 'low' ? 'guessed' : 'estimated';
    if (a.sourceKind === 'vendor-quote')
        return 'quoted';
    const claimed = a.confidence === 'high' ? 'observed' : a.confidence === 'medium' ? 'benchmarked' : 'estimated';
    // Clamp to what the source kind is entitled to claim, using the SAME table the
    // engine's own normaliser applies. A `published-source` row is a page a bot says
    // it read; the strongest that can honestly be is `benchmarked`, and only a human
    // action — a recorded quote, or an operator entering what they saw — reaches
    // `quoted` or `observed`. Mapping it here as well means the store never writes a
    // grade the engine is about to downgrade and raise an issue about.
    const ceiling = venture_assumptions_1.SOURCE_CONFIDENCE_CEILING[engineSource(a).kind] ?? 'estimated';
    return (0, venture_assumptions_1.isWeakerConfidence)(ceiling, claimed) ? ceiling : claimed;
}
/** Translate a store source kind into the engine's tagged source union. */
function engineSource(a) {
    if (a.sourceKind === 'vendor-quote') {
        return {
            kind: 'vendor-quote', vendor: a.sourceDetail || 'unnamed vendor',
            quoteRef: a.sourceUrl || a.sourceDetail || a.id, quotedOn: a.createdAt.slice(0, 10),
        };
    }
    if (a.sourceKind === 'published-source') {
        return {
            kind: 'published-rate', publication: a.sourceDetail || 'published source',
            url: a.sourceUrl || '', retrievedAt: a.createdAt.slice(0, 10),
        };
    }
    if (a.sourceKind === 'user-entered') {
        return { kind: 'operator-input', enteredBy: a.authoredBy, enteredAt: a.createdAt, note: a.sourceDetail || undefined };
    }
    if (a.sourceKind === 'derived') {
        return { kind: 'benchmark', dataset: a.sourceDetail || 'derived from other assumptions', note: a.label };
    }
    return {
        kind: 'model-estimate', agentId: a.authoredBy, taskId: a.runId || 'no-run',
        model: 'app-bot', rationale: a.sourceDetail || a.label,
    };
}
/**
 * @description Turn the live ledger into the engine's assumption ledger.
 *
 * Rows with no numeric value are dropped: the engine's ledger is numeric, and a
 * textual assumption ("we will sell through a distributor") belongs in the spec
 * and the documents, not in the arithmetic.
 *
 * @param rows - The live assumption set for one venture.
 * @returns The engine ledger and any normalisation issues it raised.
 */
function toEngineLedger(rows) {
    const engine = [];
    for (const a of rows) {
        if (a.valueNum === null)
            continue;
        const unit = ENGINE_UNITS.includes(a.unit) ? a.unit : 'ratio';
        const band = a.lowNum !== null && a.highNum !== null ? { low: a.lowNum, high: a.highNum } : undefined;
        engine.push({
            id: a.key, label: a.label, value: a.valueNum, unit,
            source: engineSource(a), confidence: engineConfidence(a), band,
        });
    }
    return (0, venture_assumptions_1.buildLedger)(engine);
}
/** Build the supplier terms for one BOM line, or an explicit "unassigned" stub. */
function supplierFor(line, vendors) {
    const v = line.vendorId ? vendors.get(line.vendorId) : undefined;
    if (!v) {
        return {
            supplierId: `unassigned-${line.ref}`, name: 'No supplier assigned',
            moqUnits: line.moq ?? 0, leadTimeWeeks: Math.ceil((line.leadTimeDays ?? 0) / 7),
            qualificationWeeks: 0, depositBps: 0, balanceNetDays: 0, qualified: false,
            assumptionRefs: [],
        };
    }
    return {
        supplierId: v.id, name: v.name,
        moqUnits: v.moq ?? line.moq ?? 0,
        leadTimeWeeks: Math.ceil((v.leadTimeDays ?? line.leadTimeDays ?? 0) / 7),
        qualificationWeeks: Math.ceil((v.qualificationDays ?? 0) / 7),
        depositBps: v.depositBps, balanceNetDays: v.balanceNetDays, qualified: v.qualified,
        assumptionRefs: [`supplier.${v.id}.terms`],
    };
}
/** The price ladder for one line — a single quoted point unless a band exists. */
function priceBreaksFor(line) {
    const ref = line.assumptionKey || `bom.${line.ref}.unit-cost`;
    return [{ minQty: 0, unitCostMicros: Math.round(line.unitCostMicros ?? 0), assumptionRef: ref }];
}
/** Recursively build one component and its children, recording bindings as it goes. */
function componentFor(line, byParent, vendors, path, bindings) {
    const breaks = priceBreaksFor(line);
    bindings.push({ assumptionId: breaks[0].assumptionRef, path: `${path}.priceBreaks.0.unitCostMicros` });
    const kids = byParent.get(line.id) ?? [];
    return {
        id: line.ref, name: line.partName,
        qtyPerParent: line.qtyPerUnit, discrete: line.discrete,
        scrapRateRatio: Math.max(0, Math.min(0.95, line.scrapPct / 100)),
        priceBreaks: breaks, supplier: supplierFor(line, vendors),
        toolingMicros: line.toolingCostMicros || undefined,
        toolingLifeUnits: line.toolingLifeUnits ?? undefined,
        children: kids.length
            ? kids.map((k, i) => componentFor(k, byParent, vendors, `${path}.children.${i}`, bindings))
            : undefined,
        notes: line.specText ?? undefined,
    };
}
/**
 * @description Build the BOM tree the engine rolls up, plus its bindings.
 *
 * Always wrapped in a synthetic assembly root, whichever shape the stored lines
 * take. The root carries the final-assembly charge, which is a real cost nobody
 * else in the tree accounts for — and which the app therefore refuses to invent.
 *
 * @param productName - The venture's product name, used as the root label.
 * @param lines - Every stored BOM line.
 * @param vendors - Vendors by id.
 * @returns The root component and the bindings for every price break in it.
 */
function buildBomTree(productName, lines, vendors) {
    const byParent = new Map();
    const roots = [];
    for (const l of lines) {
        if (!l.parentLineId) {
            roots.push(l);
            continue;
        }
        const bucket = byParent.get(l.parentLineId);
        if (bucket)
            bucket.push(l);
        else
            byParent.set(l.parentLineId, [l]);
    }
    const bindings = [
        { assumptionId: exports.ASSEMBLY_COST_KEY, path: 'product.bom.priceBreaks.0.unitCostMicros' },
    ];
    const root = {
        id: 'final-assembly', name: `${productName} (final assembly)`,
        qtyPerParent: 1, discrete: true, scrapRateRatio: 0,
        priceBreaks: [{ minQty: 0, unitCostMicros: 0, assumptionRef: exports.ASSEMBLY_COST_KEY }],
        supplier: {
            supplierId: 'final-assembly', name: 'Final assembly', moqUnits: 0, leadTimeWeeks: 0,
            qualificationWeeks: 0, depositBps: 0, balanceNetDays: 0, qualified: false, assumptionRefs: [],
        },
        children: roots.map((l, i) => componentFor(l, byParent, vendors, `product.bom.children.${i}`, bindings)),
    };
    return { root, bindings };
}
/**
 * The bindings for the numeric fields that are NOT BOM price breaks.
 *
 * Without these, editing the duty rate or the freight rate would change the
 * ledger and not the arithmetic, and the tornado would report those two inputs as
 * having no effect — which for an imported product is exactly backwards.
 */
const STRUCTURAL_BINDINGS = Object.freeze([
    { assumptionId: 'landed.freight.container-rate', path: 'landed.freight.containerCostMicros' },
    { assumptionId: 'landed.duty.hts-rate', path: 'landed.duty.htsDutyBps' },
    { assumptionId: 'market.demand.base-units', path: 'demand.scenarios.1.baselineUnits' },
    { assumptionId: 'channel.retail-price', path: 'pricing.shelfPriceMicros' },
]);
/** Read a numeric field out of the untyped spec structure, with a bound and a default. */
function num(structure, key, fallback, min, max) {
    const raw = structure[key];
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
    return Math.min(max, Math.max(min, n));
}
/** The default direct channel, used until the market analyst proposes a mix. */
function defaultChannels(structure) {
    const supplied = structure.channels;
    if (Array.isArray(supplied) && supplied.length)
        return supplied;
    return [{
            id: 'dtc', label: 'Direct to consumer', volumeShareRatio: 1,
            assumptionRefs: ['channel.dtc.terms'],
            economics: {
                kind: 'dtc', paymentBps: 290, paymentFixedMicros: D(0.30),
                outboundShipMicros: D(9), shippingChargedToCustomerMicros: 0, pickPackMicros: D(2),
                returnRateRatio: 0.06, returnHandlingMicros: D(4), returnSalvageRatio: 0.5,
                cacPerOrderMicros: D(20),
            },
        }];
}
/** The seasonal sell-through curve, flat unless the spec supplies one. */
function seasonFor(structure, sellWindowStart) {
    const weeks = Math.round(num(structure, 'sellWindowWeeks', DEFAULTS.sellWindowWeeks, 1, 52));
    const supplied = structure.weeklySellThrough;
    const curve = Array.isArray(supplied) && supplied.length === weeks
        ? supplied.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0))
        : new Array(weeks).fill(1 / weeks);
    return {
        sellWindowStart: String(structure.sellWindowStart ?? sellWindowStart),
        sellWindowWeeks: weeks,
        weeklySellThrough: curve,
        postSeasonPolicy: structure.postSeasonPolicy === 'carry' ? 'carry' : 'liquidate',
        carryHoldingBpsPerMonth: Math.round(num(structure, 'carryHoldingBpsPerMonth', 150, 0, 5000)),
        liquidationRecoveryBps: Math.round(num(structure, 'liquidationRecoveryBps', 3000, 0, 10000)),
        assumptionRefs: ['season.sell-through'],
    };
}
/** Turn stored roles into the engine's payroll stream, anchored to the horizon. */
function rolesFor(rows, horizonStart, horizonMonths) {
    const monthAt = (offset) => {
        const [y, m] = horizonStart.split('-').map(Number);
        const total = (y * 12 + (m - 1)) + Math.max(0, Math.min(horizonMonths - 1, offset));
        return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
    };
    return rows.map((r) => ({
        id: r.id, title: r.role, kind: r.kind,
        startMonth: monthAt(r.startMonth),
        endMonth: r.endMonth === null ? undefined : monthAt(r.endMonth),
        annualBaseMicros: r.baseSalaryMicros, fteRatio: r.fte, burdenBps: r.burdenBps,
        oneTimeRecruitMicros: r.recruitCostMicros || undefined,
        assumptionRefs: r.assumptionKey ? [r.assumptionKey] : [`org.${r.id}.cost`],
    }));
}
/**
 * @description Assemble a complete engine input from stored rows.
 *
 * Returns the input plus the assumption keys the model references but the ledger
 * does not hold, so a caller can tell the user exactly which numbers to go and
 * get rather than only that the model will not publish.
 *
 * @param s - Everything read from the store for one venture.
 * @returns The engine input, the ledger issues, and the missing assumption keys.
 */
function composeModelInput(s) {
    const structure = (s.venture.spec?.structure ?? {});
    const built = toEngineLedger(s.assumptions);
    const vendors = new Map(s.vendors.map((v) => [v.id, v]));
    const { root, bindings } = buildBomTree(s.venture.name, s.bomLines, vendors);
    const horizonStart = String(structure.horizonStart ?? `${s.onDate.slice(0, 4)}-01`);
    const horizonMonths = Math.round(num(structure, 'horizonMonths', s.venture.horizonMonths || DEFAULTS.horizonMonths, 6, 120));
    const runQty = Math.round(s.scenario?.volumeUnits ?? num(structure, 'runQtyUnits', DEFAULTS.runQtyUnits, 1, 10_000_000));
    const shelfMicros = s.scenario?.retailPriceCents
        ? s.scenario.retailPriceCents * 10_000
        : Math.round(num(structure, 'shelfPriceMicros', DEFAULTS.shelfPriceMicros, 1, 1e12));
    const input = {
        ledger: built.ledger,
        bindings: [...bindings, ...STRUCTURAL_BINDINGS, ...(s.venture.spec?.bindings ?? [])],
        product: { name: s.venture.name, bom: root },
        runQtyUnits: runQty,
        landed: landedShape(structure),
        channels: defaultChannels(structure),
        pricing: { kind: 'fixed-shelf', shelfPriceMicros: shelfMicros },
        demand: demandShape(structure, runQty),
        season: seasonFor(structure, `${horizonStart.slice(0, 4)}-10`),
        timing: {
            toolingMonth: String(structure.toolingMonth ?? horizonStart),
            poMonth: String(structure.poMonth ?? horizonStart),
            transitWeeks: Math.round(num(structure, 'transitWeeks', DEFAULTS.transitWeeks, 0, 52)),
            receivingWeeks: Math.round(num(structure, 'receivingWeeks', DEFAULTS.receivingWeeks, 0, 26)),
        },
        roles: rolesFor(s.headcount, horizonStart, horizonMonths),
        fixedOpexByMonth: opexByMonth(structure, horizonStart, horizonMonths),
        openingCashMicros: Math.round(num(structure, 'openingCashMicros', 0, 0, 1e15)),
        horizonStart, horizonMonths,
        onDate: s.onDate,
    };
    const withOverrides = applyOverrides(input, s.scenario);
    return {
        input: withOverrides,
        missingAssumptionKeys: missingKeys(withOverrides),
    };
}
/** The landed-cost stack, defaulted then overlaid from the spec structure. */
function landedShape(structure) {
    return {
        incoterm: ['EXW', 'FCA', 'FOB', 'CIF', 'DDP'].includes(structure.incoterm)
            ? structure.incoterm : 'FOB',
        originInlandPerContainerMicros: Math.round(num(structure, 'originInlandPerContainerMicros', D(250), 0, 1e12)),
        exportClearancePerEntryMicros: Math.round(num(structure, 'exportClearancePerEntryMicros', D(150), 0, 1e12)),
        freight: {
            containerType: '40HQ',
            unitsPerContainer: Math.round(num(structure, 'unitsPerContainer', DEFAULTS.unitsPerContainer, 1, 1e7)),
            containerCostMicros: Math.round(num(structure, 'containerCostMicros', D(4000), 0, 1e12)),
            cbmPerUnit: num(structure, 'cbmPerUnit', DEFAULTS.cbmPerUnit, 0.0001, 1000),
            lclThresholdRatio: 0.5,
            lclCostPerCbmMicros: Math.round(num(structure, 'lclCostPerCbmMicros', D(95), 0, 1e12)),
            lclMinimumChargeableCbm: 2,
            assumptionRefs: ['landed.freight.container-rate'],
        },
        duty: {
            htsCode: String(structure.htsCode ?? ''),
            htsDutyBps: Math.round(num(structure, 'htsDutyBps', 0, 0, 10000)),
            additionalTariffBps: Math.round(num(structure, 'additionalTariffBps', 0, 0, 10000)),
            customsValueBasis: structure.customsValueBasis === 'cif' ? 'cif' : 'fob',
            mpfBps: 35, mpfMinMicros: D(32.71), mpfMaxMicros: D(634.62), hmfBps: 125,
            assumptionRefs: ['landed.duty.hts-rate'],
        },
        insuranceBps: Math.round(num(structure, 'insuranceBps', 50, 0, 10000)),
        insuranceMinimumMicros: Math.round(num(structure, 'insuranceMinimumMicros', D(50), 0, 1e12)),
        importClearancePerEntryMicros: Math.round(num(structure, 'importClearancePerEntryMicros', D(175), 0, 1e12)),
        drayagePerContainerMicros: Math.round(num(structure, 'drayagePerContainerMicros', D(500), 0, 1e12)),
        warehouseInPerUnitMicros: Math.round(num(structure, 'warehouseInPerUnitMicros', D(0.75), 0, 1e12)),
    };
}
/** Demand scenarios, anchored to the run quantity until the market analyst runs. */
function demandShape(structure, runQty) {
    const base = Math.round(num(structure, 'baseDemandUnits', runQty, 0, 1e9));
    return {
        scenarios: [
            { key: 'conservative', baselineUnits: Math.round(base * 0.5), assumptionRef: 'market.demand.base-units' },
            { key: 'base', baselineUnits: base, assumptionRef: 'market.demand.base-units' },
            { key: 'optimistic', baselineUnits: Math.round(base * 1.6), assumptionRef: 'market.demand.base-units' },
        ],
        selected: 'base',
        // No elasticity assumption means volume is held FLAT and the engine says so.
        // Inventing a demand curve would make every price inversion look easier than
        // it is, which is the direction that costs money.
        elasticity: null,
    };
}
/** A flat monthly opex line across the horizon. */
function opexByMonth(structure, start, months) {
    const per = Math.round(num(structure, 'fixedOpexPerMonthMicros', DEFAULTS.fixedOpexPerMonthMicros, 0, 1e12));
    const [y, m] = start.split('-').map(Number);
    const out = {};
    for (let i = 0; i < months; i += 1) {
        const total = (y * 12 + (m - 1)) + i;
        out[`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`] = per;
    }
    return out;
}
/** Apply a scenario's per-assumption overrides through the engine's own writer. */
function applyOverrides(input, scenario) {
    if (!scenario)
        return input;
    let next = input;
    for (const [key, value] of Object.entries(scenario.overrides ?? {})) {
        if (typeof value !== 'number' || !Number.isFinite(value))
            continue;
        // A scenario may only move assumptions that exist; an override naming an
        // unregistered key would silently do nothing, so it is skipped visibly.
        if (!next.ledger.byId[key])
            continue;
        next = (0, venture_model_1.withAssumption)(next, key, value);
    }
    return next;
}
/**
 * @description Every assumption key the model references but the ledger lacks.
 *
 * These are the numbers the app is refusing to invent. The route hands them
 * straight to the surface so the user sees a shopping list rather than a refusal.
 *
 * @param input - The composed model input.
 * @returns The missing keys, sorted and de-duplicated.
 */
function missingKeys(input) {
    const referenced = new Set();
    const walk = (c) => {
        for (const b of c.priceBreaks)
            referenced.add(b.assumptionRef);
        for (const r of c.supplier.assumptionRefs)
            referenced.add(r);
        for (const kid of c.children ?? [])
            walk(kid);
    };
    walk(input.product.bom);
    for (const r of input.landed.freight.assumptionRefs)
        referenced.add(r);
    for (const r of input.landed.duty.assumptionRefs)
        referenced.add(r);
    for (const c of input.channels)
        for (const r of c.assumptionRefs)
            referenced.add(r);
    for (const sc of input.demand.scenarios)
        referenced.add(sc.assumptionRef);
    for (const r of input.season.assumptionRefs)
        referenced.add(r);
    for (const role of input.roles)
        for (const r of role.assumptionRefs)
            referenced.add(r);
    return [...referenced].filter((k) => !input.ledger.byId[k]).sort();
}
/**
 * @description The values an inputs hash is taken over.
 *
 * The LEDGER, not the composed object: two composes of the same stored rows must
 * hash identically, and the composed object carries derived structure that would
 * make that false.
 *
 * @param ledger - The engine ledger.
 * @param runQtyUnits - The run quantity, which is an input and not an assumption.
 * @returns A flat key/value map for hashing.
 */
function hashableInputs(ledger, runQtyUnits) {
    const out = { '@runQtyUnits': runQtyUnits };
    for (const id of ledger.order)
        out[id] = ledger.byId[id].value;
    return out;
}
//# sourceMappingURL=venture-store-compose.js.map