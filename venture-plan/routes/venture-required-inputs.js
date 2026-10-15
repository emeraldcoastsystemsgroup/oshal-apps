"use strict";
/**
 * Venture Plan — the inputs the model names, and the analyst slots that supply them.
 *
 * The composed model refers to a handful of assumptions BY KEY: the final-assembly
 * charge on the BOM root, the container freight rate, the HTS duty rate, base demand,
 * the shelf price, the direct channel's per-order cost and the season's sell-through
 * (venture-store-compose). The analysts used to be asked to "cover" them inside a
 * free-form assumption list, and live they did not: they invented their own names
 * ("demand.units.base", "logistics.ocean.container-cost" in "usd", "market.retail.price"
 * at 2500 micros), so after bom, market and ops had all run, the model still refused
 * with model:traceability on every one of these keys and no document could stand.
 *
 * So the KEY, the DOMAIN and the UNIT belong to code. Each analyst fills named slots
 * in plain units (dollars, percent, units), and this module turns each slot into the
 * exact assumption row the model looks up, scaled to the ledger's unit and bounded.
 * A slot the analyst did not fill is reported by name, never invented.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The model's named inputs as code-owned analyst slots: key, domain, unit, scale and bounds fixed here; the prompt text for each analyst; the parser that turns a filled slot into the exact assumption row and names every slot left empty or out of bounds.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Two ops slots for the container fill the freight stack computes with: units per 40ft container and the shipped volume per unit in CBM (stored unrounded, like a ratio). Live, the ops analyst registered its own logistics.unitsPerContainer 2500 and logistics.cbPerUnit 0.0015 for a reading light while the model shipped the default 400 units of 0.05 CBM per container.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | CBM_PER_UNIT_BOUNDS is the one range for the shipped volume per unit: the slot and venture-store-compose's freight clamp both read it (they disagreed, 0.00001 here and 0.0001 there, so a registered value between them was cited at one number and computed at another).
 *
 * @module venture-required-inputs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_INPUTS = exports.CBM_PER_UNIT_BOUNDS = void 0;
exports.slotsFor = slotsFor;
exports.requiredPromptLines = requiredPromptLines;
exports.parseRequiredInputs = parseRequiredInputs;
/** Every input the composed model names by key and an analyst can estimate. */
/**
 * The one range a shipped volume per unit (cubic metres) may take: the cbmPerUnit slot accepts exactly this range and
 * the composed freight stack clamps to it, so a registered value is cited and computed at the same number. Round 8:
 * the slot took 0.00001 while compose clamped to 0.0001, so a registered 0.00005 was cited at one value and computed
 * at twice it.
 */
exports.CBM_PER_UNIT_BOUNDS = Object.freeze({ min: 0.00001, max: 100 });
exports.REQUIRED_INPUTS = Object.freeze([
    {
        slot: 'baseDemandUnits', key: 'market.demand.base-units', analyst: 'market', domain: 'market', unit: 'units',
        label: 'Base-case demand', scale: 1, min: 1, max: 100_000_000,
        ask: 'units customers would buy over the selling season at the planned price, base case',
    },
    {
        slot: 'retailPriceUsd', key: 'channel.retail-price', analyst: 'market', domain: 'channel', unit: 'micros',
        label: 'Retail price per unit', scale: 1_000_000, min: 0.01, max: 1_000_000,
        ask: 'the shelf price a customer pays per unit, in US dollars (24.99 means $24.99)',
    },
    {
        slot: 'dtcCostPerOrderUsd', key: 'channel.dtc.terms', analyst: 'market', domain: 'channel', unit: 'micros',
        label: 'Direct-to-consumer cost per order', scale: 1_000_000, min: 0, max: 100_000,
        ask: 'what one direct order costs to win and deliver (acquisition, payment fee, pick-pack, outbound shipping), in US dollars',
    },
    {
        slot: 'seasonSellThroughPercent', key: 'season.sell-through', analyst: 'market', domain: 'market', unit: 'ratio',
        label: 'Season sell-through', scale: 0.01, min: 0, max: 100,
        ask: 'percent of the production run sold within the selling season, 0 to 100',
    },
    {
        slot: 'containerFreightUsd', key: 'landed.freight.container-rate', analyst: 'ops', domain: 'logistics', unit: 'micros',
        label: 'Ocean freight per 40ft container', scale: 1_000_000, min: 1, max: 1_000_000,
        ask: 'ocean freight for one 40ft high-cube container, origin port to destination port, in US dollars',
    },
    {
        slot: 'htsDutyPercent', key: 'landed.duty.hts-rate', analyst: 'ops', domain: 'compliance', unit: 'bps',
        label: 'HTS import duty rate', scale: 100, min: 0, max: 100,
        ask: 'the base import duty rate of the likely HTS heading, in percent (3.9 means 3.9%)',
    },
    {
        slot: 'finalAssemblyCostUsd', key: 'bom.final-assembly.cost', analyst: 'ops', domain: 'manufacturing', unit: 'micros',
        label: 'Final assembly cost per unit', scale: 1_000_000, min: 0, max: 100_000,
        ask: 'final assembly, test and pack-out labour and overhead per finished unit, in US dollars, parts excluded',
    },
    {
        slot: 'unitsPerContainer', key: 'landed.freight.units-per-container', analyst: 'ops', domain: 'logistics', unit: 'units',
        label: 'Units per 40ft container', scale: 1, min: 1, max: 10_000_000,
        ask: 'how many finished, retail-packed units fit in one 40ft high-cube container, master cartons included',
    },
    {
        slot: 'cbmPerUnit', key: 'landed.freight.cbm-per-unit', analyst: 'ops', domain: 'logistics', unit: 'cbm',
        label: 'Shipped volume per unit', scale: 1, min: exports.CBM_PER_UNIT_BOUNDS.min, max: exports.CBM_PER_UNIT_BOUNDS.max,
        ask: 'the shipped volume of one retail-packed unit in cubic metres, its share of the master carton included (0.0015 means 1.5 litres)',
    },
]);
/** The slot fields every filled slot carries. */
const SLOT_FIELDS = new Set(['value', 'low', 'high', 'confidence', 'basis', 'sourceUrl']);
/**
 * @description The slots one analyst must fill.
 * @param analyst - The analyst.
 * @returns Its slots, in prompt order.
 */
function slotsFor(analyst) {
    return exports.REQUIRED_INPUTS.filter((r) => r.analyst === analyst);
}
/**
 * @description The prompt block that asks one analyst for its slots. The schema line is what the
 * analyst copies; each slot is then named with what it means and the unit it answers in.
 * @param analyst - The analyst.
 * @param detailChars - The longest `basis` the contract allows.
 * @returns Prompt lines.
 */
function requiredPromptLines(analyst, detailChars) {
    const slots = slotsFor(analyst);
    return [
        'REQUIRED: also return "required", an object with EXACTLY these fields, each',
        '{"value": number, "low": number, "high": number, "confidence": "low"|"medium"|"high", "basis": string, "sourceUrl": string|null}',
        `in the unit named (plain dollars or percent, NOT micro-dollars); basis under ${detailChars} characters says where the number comes from:`,
        ...slots.map((s) => `- ${s.slot}: ${s.ask}.`),
        'The model cannot run without these; fill every one with your best banded estimate.',
    ];
}
/** A finite number, or null. */
function finite(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
/** Parse one filled slot into its assumption row, or say why it was not used. */
function slotRow(spec, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return { reject: `${spec.slot}: not supplied` };
    const r = raw;
    const extra = Object.keys(r).find((k) => !SLOT_FIELDS.has(k));
    if (extra)
        return { reject: `${spec.slot}: unknown field "${extra}"` };
    const value = finite(r.value);
    if (value === null)
        return { reject: `${spec.slot}: no value` };
    const low = finite(r.low) ?? value;
    const high = finite(r.high) ?? value;
    if (low > high || value < low || value > high)
        return { reject: `${spec.slot}: the band does not hold the value` };
    if (low < spec.min || high > spec.max)
        return { reject: `${spec.slot}: outside ${spec.min} to ${spec.max}` };
    const url = typeof r.sourceUrl === 'string' && /^https?:\/\//.test(r.sourceUrl) ? r.sourceUrl.slice(0, 500) : null;
    const claimed = r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low';
    // A ratio or a volume has no integer granularity; rounding 0.0015 CBM would store zero.
    const scaled = (n) => (spec.unit === 'ratio' || spec.unit === 'cbm' ? n * spec.scale : Math.round(n * spec.scale));
    return {
        row: {
            key: spec.key, domain: spec.domain, label: spec.label, unit: spec.unit,
            valueNum: scaled(value), lowNum: scaled(low), highNum: scaled(high),
            sourceKind: url ? 'published-source' : 'model-estimate',
            sourceDetail: typeof r.basis === 'string' && r.basis.trim() ? r.basis.trim().slice(0, 500) : spec.ask,
            sourceUrl: url,
            // A model estimate is capped at medium, the same rule the free-form contract applies.
            confidence: !url && claimed === 'high' ? 'medium' : claimed,
        },
    };
}
/**
 * @description Turn an analyst reply's "required" object into the exact assumption rows the model
 * names, and list every slot that could not be used, by name and reason.
 * @param payload - The parsed reply object.
 * @param analyst - Which analyst replied.
 * @returns The rows to register and the slots missing from them.
 */
function parseRequiredInputs(payload, analyst) {
    const block = payload && typeof payload.required === 'object' && !Array.isArray(payload.required)
        ? payload.required : {};
    const rows = [];
    const missing = [];
    for (const spec of slotsFor(analyst)) {
        const out = slotRow(spec, block[spec.slot]);
        if (out.row)
            rows.push(out.row);
        else
            missing.push(out.reject ?? `${spec.slot}: not supplied`);
    }
    return { rows, missing };
}
//# sourceMappingURL=venture-required-inputs.js.map