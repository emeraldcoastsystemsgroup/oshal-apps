"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 (D4, D6) — the generated design document for ONE
 *                     |                             | explorer record: what a person reads for their vehicle, not the
 *                     |                             | dated study (which stays a record of one run). Every table is
 *                     |                             | generated from the parts model and the displacement budget at
 *                     |                             | the record's current vector, so no number is typed twice: the
 *                     |                             | stage with the fabricable sentence, the printed parts with their
 *                     |                             | programs' bases and features, the bought rows with the masses
 *                     |                             | and prices nobody published shown as not published, the budget,
 *                     |                             | each part's named attachment points, what keeps the model from
 *                     |                             | complete, the fabrication assumptions, and the open limits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeProgram = describeProgram;
exports.explorerDesignMarkdown = explorerDesignMarkdown;
const n = (v, places) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(places) : 'not published');
const cell = (text) => text.replace(/\|/g, '/').replace(/\n/g, ' ');
/** @description A program's base and feature list in one line. @param p - The program. @returns Text. */
function describeProgram(p) {
    const b = p.base;
    const base = b.kind === 'box' ? `box ${b.sizeX} x ${b.sizeY} x ${b.sizeZ} mm` : `cylinder ${b.diameter} x ${b.height} mm`;
    return p.features.length ? `${base}; ${p.features.map((f) => f.type).join(', ')}` : base;
}
/** @description The printed parts table. */
function printedTable(parts) {
    const rows = ['| Part | Qty | Program | Material | Print notes | Mass each, g | Displaces, L |', '|---|---|---|---|---|---|---|'];
    for (const p of parts.printed)
        rows.push(`| ${p.name} | ${p.qty} | ${cell(describeProgram(p.geometry.program))} | ${p.material} | ${cell(p.printNotes)} | ${n(p.massEachKg * 1000, 1)} | ${n(p.displacedTotalMm3 / 1e6, 3)} |`);
    return rows;
}
/** @description The bought and fabricated rows table. */
function boughtTable(parts) {
    const rows = ['| Item | Qty | Make | Specification | Carried by | Mass each, g | Approx. each, USD | Source |', '|---|---|---|---|---|---|---|---|'];
    for (const b of parts.bought) {
        const mass = b.derived === 'ballast' ? 'derived by the budget' : n(b.massEachKg === null ? null : b.massEachKg * 1000, 0);
        rows.push(`| ${b.name} | ${b.qty} | ${b.make} | ${cell(b.spec)} | ${b.carriedBy ?? 'not placed'} | ${mass} | ${n(b.approxUsdEach, 0)} | ${cell(b.source)} |`);
    }
    return rows;
}
/** @description The displacement budget section. */
function budgetLines(budget) {
    const lines = [`**${budget.status.toUpperCase()}** — ${budget.why}.`, ''];
    if (budget.unknowns.length)
        lines.push(...budget.unknowns.map((u) => `- ${u}`), '');
    if (budget.sub && budget.float && budget.tether) {
        lines.push('| Body | Mass, kg | Displaces, L | In water |', '|---|---|---|---|');
        lines.push(`| Sub (before ballast) | ${n(budget.sub.massKg, 3)} | ${n(budget.sub.displacedL, 3)} | ${n(budget.sub.netBeforeBallastN, 2)} N; ballast ${n(budget.sub.ballastNetN, 2)} N (${n(budget.sub.ballastKg, 3)} kg) trims it to ${budget.sub.targetNetN} N |`);
        lines.push(`| Tether | ${n(budget.tether.massKg, 3)} | ${n(budget.tether.displacedL, 3)} | ${n(budget.tether.netN, 2)} N |`);
        lines.push(`| Float | ${n(budget.float.massKg, 3)} | encloses ${n(budget.float.enclosedL, 3)} | must displace ${n(budget.float.demandsL, 3)} L, reserve ${n(budget.float.reserveL, 3)} L |`, '');
    }
    if (budget.sizing)
        lines.push(`Sizing recomputed at ${n(budget.sizing.recomputedAtL, 3)} L: ${Math.round(budget.sizing.recomputedKmPerYear)} km/year against the ${Math.round(budget.sizing.sizedKmPerYear)} km/year run ${budget.sizedBy} claimed at ${budget.sizing.sizedAtL} L.`, '');
    return lines;
}
/** @description Each watertight part's named attachment points. */
function attachmentLines(parts) {
    const objects = [...parts.printed.map((p) => p.portableObject), ...parts.bought.flatMap((b) => (b.portableObject ? [b.portableObject] : []))];
    const lines = ['| Part | Point | Position, mm | Why |', '|---|---|---|---|'];
    for (const o of objects)
        for (const p of o.attachmentFrame.points)
            lines.push(`| ${o.identity.name} | ${p.name} | ${p.positionMm.map((c) => c.toFixed(1)).join(', ')} | ${cell(p.why)} |`);
    return lines;
}
/**
 * @description The design document for one explorer record.
 * @param input - The record's name, its stage, the parts model, the budget and the vehicle id.
 * @returns Markdown.
 */
function explorerDesignMarkdown(input) {
    const { stage, parts, budget } = input;
    const fab = parts.fabrication;
    return [
        `# ${input.name} — design`, '',
        `Generated from the \`ocean-lab\` parts model (${parts.engine.id} ${parts.engine.version}) at design vector \`${parts.vectorFingerprint.slice(0, 16)}\` (\`GET /api/ocean-lab/vehicles/${input.vehicleId}/design.md\`). The design study (docs/research/autonomous-explorer-design-study.md) stays the dated record of one run; this document is regenerated whenever the vector changes.`, '',
        `**Stage: ${stage.stage}.** ${stage.fabricable}`, '',
        ...(stage.next ? [`To reach ${stage.next}:`, ...stage.blockedBy.map((b) => `- ${b}`), ''] : []),
        `## Printed parts (${parts.watertightParts} watertight parts, the tether included)`, '', ...printedTable(parts), '',
        '## Bought and fabricated parts', '', ...boughtTable(parts), '',
        '## Displacement budget', '', ...budgetLines(budget),
        '## Attachment points', '', ...attachmentLines(parts), '',
        '## What keeps the parts model from complete', '', ...(parts.problems.length ? parts.problems.map((p) => `- ${p}`) : ['- nothing']), '',
        '## Fabrication assumptions', '', `- Material: ${fab.material} at ${fab.densityGcm3} g/cm3 (assumed: the report names no material).`, `- Hulls: ${fab.hulls} (the wall is assumed).`, `- Foils: ${fab.foils}.`, `- Ballast: lead at ${fab.ballastDensityGcm3} g/cm3 (assumed; it sets the ballast's mass, never the net weight it trims to).`, '',
        `## Open limits (${stage.openLimits.length})`, '', ...stage.openLimits.map((l) => `- ${l.sentence}${l.blocking ? ' (blocks built)' : ''}`), '',
    ].join('\n');
}
