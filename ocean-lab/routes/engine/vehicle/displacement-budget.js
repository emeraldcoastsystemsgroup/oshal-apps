"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 (D6 item 2) — the displacement budget, a GATE and not
 *                     |                             | a report. It sums the parts model body by body in the medium the
 *                     |                             | sizing ran in: the sub's parts and their displaced volume give
 *                     |                             | the ballast that trims it to the vector's net weight (red when no
 *                     |                             | ballast can, because the parts already weigh more in water); the
 *                     |                             | float must carry its own parts, the tether's weight in water and
 *                     |                             | that net weight, which sets the displacement the parts DEMAND
 *                     |                             | (red when it exceeds what the float program encloses: it sinks).
 *                     |                             | Then the sizing is recomputed AT that displacement with the same
 *                     |                             | wave engine, and the budget closes only when the recomputed year
 *                     |                             | is not below the year the recorded sizing claimed: heavier than
 *                     |                             | sized is red, as the Floater's 274 g is. Any mass or placement
 *                     |                             | nobody published keeps it OPEN, naming the rows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.displacementBudget = displacementBudget;
exports.explorerPartsGate = explorerPartsGate;
const wave_1 = require("../wave");
const explorer_kind_1 = require("./explorer-kind");
const explorer_part_programs_1 = require("./explorer-part-programs");
const explorer_parts_1 = require("./explorer-parts");
/** @description Every row as the budget reads it; the derived ballast row is the budget's OUTPUT, never an input. */
function rows(parts) {
    return [...parts.printed, ...parts.bought.filter((b) => b.derived !== 'ballast')];
}
/** @description The rows whose mass or placement nobody published, named. */
function unknownsOf(parts) {
    const unknown = [];
    const noMass = rows(parts).filter((r) => r.massEachKg === null).map((r) => r.id);
    const unplaced = rows(parts).filter((r) => r.carriedBy === null).map((r) => r.id);
    if (noMass.length)
        unknown.push(`no published mass: ${noMass.join(', ')}`);
    if (unplaced.length)
        unknown.push(`placed on no body: ${unplaced.join(', ')}`);
    return unknown;
}
/** @description Mass and displaced volume of every row a body carries (a bought row's own volume is not counted: none is published). */
function sums(parts, carrier) {
    let massKg = 0;
    let displacedMm3 = 0;
    for (const r of rows(parts).filter((x) => x.carriedBy === carrier)) {
        massKg += r.qty * r.massEachKg;
        displacedMm3 += r.displacedTotalMm3 ?? 0;
    }
    return { massKg, displacedL: displacedMm3 / 1e6 };
}
/** @description The shell of a verdict that could not be computed. */
function blank(status, medium, sizedBy, unknowns, why) {
    return { status, blocks: 'parts-complete', mediumId: medium, sizedBy, unknowns, sub: null, tether: null, float: null, sizing: null, why };
}
/** @description The three bodies summed in a medium. */
function bodies(parts, v, medium) {
    const rho = medium.densityKgM3;
    const g = (0, wave_1.gravityMagnitude)(medium);
    const sub = sums(parts, 'sub');
    const tether = sums(parts, 'tether');
    const float = sums(parts, 'float');
    const netBeforeBallastN = sub.massKg * g - rho * g * (sub.displacedL / 1000);
    const ballastNetN = v.sub.netWeightN - netBeforeBallastN;
    const leadKgM3 = explorer_part_programs_1.EXPLORER_DRAWINGS.fabrication.ballastDensityGcm3 * 1000;
    const ballastKg = ballastNetN >= 0 ? ballastNetN / (g * (1 - rho / leadKgM3)) : null;
    const tetherNetN = tether.massKg * g - rho * g * (tether.displacedL / 1000);
    const loadsN = float.massKg * g + tetherNetN + v.sub.netWeightN;
    const floatPart = parts.printed.find((p) => p.id === 'float');
    const enclosedL = floatPart.displacedTotalMm3 / 1e6;
    const demandsL = (loadsN / (rho * g)) * 1000;
    return {
        loadsN,
        sub: { ...sub, netBeforeBallastN, targetNetN: v.sub.netWeightN, ballastNetN, ballastKg },
        tether: { ...tether, netN: tetherNetN },
        float: { ...float, displacedL: enclosedL, enclosedL, demandsL, reserveL: enclosedL - demandsL },
    };
}
/**
 * @description The displacement budget (ADR-160 D6 item 2) of a parts model against the sizing that the
 * stage rests on: open while any mass or placement is unknown, red when the sub cannot be trimmed, when the
 * float cannot carry its load, or when the sizing recomputed at the parts' displacement falls below the year
 * the recorded sizing claimed; green only when it closes.
 * @param parts - The parts model at the current vector. @param v - The current vector.
 * @param sized - The evaluation the stage is sized by (null when there is none at this vector).
 * @returns The budget.
 */
function displacementBudget(parts, v, sized) {
    if (!sized)
        return blank('unsized', null, null, [], 'no evaluation at the current design vector: the budget closes against a sizing, and there is none to close against');
    const unknowns = unknownsOf(parts);
    if (unknowns.length)
        return blank('open', sized.mediumId, sized.sequence, unknowns, `the budget cannot close while parts have no mass or no body (${unknowns.join('; ')}): an unknown is never read as zero`);
    const medium = (0, wave_1.mediumById)(sized.mediumId);
    const b = bodies(parts, v, medium);
    const base = { blocks: 'parts-complete', mediumId: medium.id, sizedBy: sized.sequence, unknowns: [], sub: b.sub, tether: b.tether, float: b.float };
    const sub = b.sub;
    const float = b.float;
    if (sub.ballastNetN < 0)
        return { ...base, status: 'red', sizing: null, why: `the sub's parts weigh ${sub.netBeforeBallastN.toFixed(2)} N in ${medium.id} before any ballast, more than the ${sub.targetNetN} N net the design vector trims it to: no ballast can lighten it` };
    if (float.demandsL >= float.enclosedL)
        return { ...base, status: 'red', sizing: null, why: `the float must displace ${float.demandsL.toFixed(2)} L to carry its parts, the tether and the sub, and its program encloses ${float.enclosedL.toFixed(2)} L: it sinks` };
    const sizedKmPerYear = Number(sized.result.figures?.kmPerYear);
    const recomputed = (0, explorer_kind_1.evaluateExplorer)({ ...v, float: { ...v.float, displacementL: float.demandsL } }, medium).figures.kmPerYear;
    const sizing = { sizedAtL: v.float.displacementL, sizedKmPerYear, recomputedAtL: float.demandsL, recomputedKmPerYear: recomputed };
    if (!Number.isFinite(sizedKmPerYear) || recomputed < sizedKmPerYear * (1 - 1e-9)) {
        return { ...base, status: 'red', sizing, why: `at the parts' mass the float displaces ${float.demandsL.toFixed(2)} L against the ${v.float.displacementL} L the sizing used, and the sizing recomputed there gives ${Math.round(recomputed)} km/year against the ${Math.round(sizedKmPerYear)} km/year run ${sized.sequence} claimed: set the float's displacement to what the parts demand and evaluate again` };
    }
    return { ...base, status: 'green', sizing, why: `the parts demand ${float.demandsL.toFixed(2)} L of the ${float.enclosedL.toFixed(2)} L the float encloses; recomputed at that displacement the year is ${Math.round(recomputed)} km, not below the ${Math.round(sizedKmPerYear)} km run ${sized.sequence} claimed, and ${sub.ballastNetN.toFixed(2)} N of ballast trims the sub` };
}
/**
 * @description The explorer kind's parts gate (stage.ts `PartsGate`): the parts model derived from the CURRENT
 * vector, and its displacement budget against the run the stage is sized by. A stored vector that no longer
 * validates yields no parts model and a named problem, never a partial one.
 * @param designVector - The record's current vector. @param sizedBy - The run the stage is sized by.
 * @param catalog - The bought rows (the committed catalog unless a caller passes others).
 * @returns The problems, the budget, and the parts model they came from.
 */
function explorerPartsGate(designVector, sizedBy, catalog) {
    const invalid = (0, explorer_kind_1.validateExplorerVector)(designVector);
    if (invalid.length) {
        const why = `the stored design vector is not valid (${invalid.join('; ')}), so no parts model is derived from it`;
        return { problems: [why], parts: null, budget: blank('unsized', null, null, [], why) };
    }
    const v = designVector;
    const parts = (0, explorer_parts_1.buildExplorerParts)(v, catalog);
    return { problems: parts.problems, parts, budget: displacementBudget(parts, v, sizedBy) };
}
