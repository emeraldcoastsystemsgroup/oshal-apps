"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the hardware design document's tables, generated
 *                     |                             | from the parts model so a number is never hand-typed twice:
 *                     |                             | propulsion sizing, the printed part list, the mass budget, the
 *                     |                             | electronics with approximate prices.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sizingTable = sizingTable;
exports.partsTable = partsTable;
exports.massTable = massTable;
exports.electronicsTable = electronicsTable;
exports.designMarkdown = designMarkdown;
const parts_model_1 = require("./parts-model");
const propulsion_1 = require("./propulsion");
const n0 = (v) => v.toFixed(0);
const n1 = (v) => v.toFixed(1);
/** @description The sizing table across candidate props, masses and batteries, plus the chosen fits. */
function sizingTable() {
    const rows = ['| Props | AUW | Battery | Disc loading | P electrical | Hover (theory) | Thrust per motor: hover / T:W 2 |', '|---|---|---|---|---|---|---|'];
    for (const propIn of [5, 6, 7])
        for (const auwG of [750, 850])
            for (const [cells, mAh, g] of [[4, 1500, 175], [4, 2200, 240]]) {
                const s = (0, propulsion_1.sizeHover)({ propIn, auwG, cells, mAh });
                rows.push(`| ${propIn} in | ${auwG} g | ${cells}S ${mAh} mAh, ${g} g | ${n0(s.discLoadingNm2)} N/m² | ${n0(s.pElectricalW)} W | ${n1(s.hoverMin)} min | ${n0(s.thrustPerMotorHoverG)} g / ${n0(s.thrustPerMotorTw2G)} g |`);
            }
    for (const id of Object.keys(parts_model_1.DRONE_FITS)) {
        const d = (0, parts_model_1.buildDrone)(id);
        const s = d.sizing;
        rows.push(`| **${s.propIn} in (${id})** | **${s.auwG} g** | **${s.cells}S ${s.mAh} mAh, ${d.fit.batteryG} g** | **${n0(s.discLoadingNm2)} N/m²** | **${n0(s.pElectricalW)} W** | **${n1(s.hoverMin)} min** | **${n0(s.thrustPerMotorHoverG)} g / ${n0(s.thrustPerMotorTw2G)} g** |`);
    }
    return rows.join('\n');
}
/** @description The printed part list for a fit. */
function partsTable(d) {
    const rows = ['| Part | Qty | Base | Features | Material | Print notes | Mass each |', '|---|---|---|---|---|---|---|'];
    for (const p of d.parts) {
        const b = p.cad.base;
        const base = b.kind === 'box' ? `box ${b.sizeX} × ${b.sizeY} × ${b.sizeZ} mm` : b.kind === 'cylinder' ? `cylinder Ø${b.diameter} × ${b.height} mm` : `sketch, ${b.points.length} points, ${b.height} mm`;
        rows.push(`| ${p.name} | ${p.qty} | ${base} | ${p.cad.features.length} | ${p.material} | ${p.printNotes} | ${p.massEachG} g |`);
    }
    return rows.join('\n');
}
/** @description The mass budget for a fit. */
function massTable(d) {
    const rows = ['| Item | g |', '|---|---|'];
    for (const p of d.parts.filter((x) => x.id !== 'pad'))
        rows.push(`| ${p.name} ×${p.qty} (printed) | ${n0(p.qty * p.massEachG)} |`);
    for (const b of d.bought)
        rows.push(`| ${b.name}${b.qty > 1 ? ` ×${b.qty}` : ''} | ${n0(b.qty * b.massEachG)} |`);
    rows.push(`| **All-up** | **${d.massBudget.allUpG}** |`);
    return rows.join('\n');
}
/** @description The bought parts with approximate prices. */
function electronicsTable(d) {
    const rows = ['| Part | Qty | Role | Approx. each (2026, USD) |', '|---|---|---|---|'];
    for (const b of d.bought)
        rows.push(`| ${b.name} | ${b.qty} | ${b.role} | ${b.approxUsdEach} |`);
    rows.push(`| **Total, approximate** | | | **${d.approxUsd}** |`);
    return rows.join('\n');
}
/**
 * @description The whole design as markdown: what the hardware document pastes in.
 * @param fit - Which fit.
 * @returns Markdown.
 */
function designMarkdown(fit) {
    const d = (0, parts_model_1.buildDrone)(fit);
    const l = d.layout;
    return [
        `# ${d.fit.label}`, '',
        `Generated from the \`embodied\` parts model (\`GET /api/embodied/build/drone/design.md?fit=${fit}\`). Sensor set \`${d.sensorSet.id}\`: ${d.sensorSet.label}.`, '',
        '## Layout', '',
        `X-quad, wheelbase ${l.wheelbaseMm} mm, arms ${l.armMm} mm to the motor axis, ${l.propDiameterMm.toFixed(0)} mm props clearing each other by ${l.propClearanceMm} mm, centre plate ${l.plateMm} × ${l.plateMm} × ${l.plateThicknessMm} mm, mast ${l.mastMm} mm.`, '',
        '## Propulsion sizing (momentum theory)', '', sizingTable(), '',
        `Tip speed at ${d.fit.hoverRpm} rpm: ${n0(d.tipSpeedMps)} m/s.`, '',
        '## Printed parts', '', partsTable(d), '',
        '## Mass budget', '', massTable(d), '',
        '## Bought parts', '', electronicsTable(d), '',
        '## Print rules', '', ...d.printRules.map((r) => `- ${r}`), '',
    ].join('\n');
}
//# sourceMappingURL=design-markdown.js.map