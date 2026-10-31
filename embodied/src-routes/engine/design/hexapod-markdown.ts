/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the design document and the bill of materials
 *                     |                             | generated from the design object in the printed arm's style —
 *                     |                             | what the brief read, the layout, the mass budget against the
 *                     |                             | target, the loads, the reversible rule by name, both jump
 *                     |                             | options with what the plant will measure, the printed parts,
 *                     |                             | the bought parts with prices, the BOM — and the BOM as CSV.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B29: the target is named as the contract's, re-based on the parts model, not the brief's.
 */

import { buildHexapod, FOOT_FRICTION, type HexapodDesign } from './hexapod-design';
import { BRIEF_MASSES, SIGN_CONVENTION, type HexapodFit } from './hexapod-spec';
import { CONTINUOUS_FRACTION, DYNAMIC_ALLOWANCE } from './servos';

const n2 = (v: number): string => v.toFixed(2);

/**
 * @description The leg layout and where the body's parts sit.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodLayoutTable(d: HexapodDesign): string {
  const l = d.spec.layout; const b = d.body;
  const rows = ['| Item | Value | Source |', '|---|---|---|'];
  rows.push(`| Body plates | 2 × one program: hexagon ${l.bodyLengthMm} × ${l.bodyWidthMm} × ${l.plateThicknessMm} mm, ${l.plateGapMm} mm apart; ${b.plateExtentsMm.x} × ${b.plateExtentsMm.y} mm over the six coxa collars | the brief's hexagon; the extents computed |`);
  for (const leg of ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'] as const) {
    const m = l.coxaMounts[leg]; const c = b.coxaCases[leg];
    rows.push(`| Coxa ${leg} | axis (${m.xMm}, ${m.yMm}) at ${m.neutralYawDeg}°; case centre (${c.xMm}, ${c.yMm}) along ${Math.round(c.angleRad / (Math.PI / 180))}° | the axis is the contract's; the case lies along the plate edge, computed |`);
  }
  rows.push(`| Leg | coxa ${l.coxaMm}, femur ${l.femurMm}, tibia ${l.tibiaMm} mm; foot radius ${l.footRadiusMm} mm | the brief's |`);
  rows.push(`| Stand height | ${l.standHeightMm} mm, the same inverted | the brief's |`);
  rows.push(`| LiDAR | optical centre x = ${l.lidarNoseXMm}, scan plane z = ${l.lidarPlaneZMm} | the brief's |`);
  rows.push(`| Pi bay | centre (${b.piBay.xMm}, ${b.piBay.yMm}), ${b.piBay.outerX} × ${b.piBay.outerY} mm outside, the 85 mm side across the body | computed from the footprints |`);
  rows.push(`| Spring housing (latched-spring) | axis (${b.housing.xMm}, ${b.housing.yMm}) | computed: behind the bay on the centreline |`);
  rows.push(`| Battery | on edge in the tail tray, centre x = ${b.tailTab.packCentreXMm}, on the mid-plane | computed: it does not fit between the plates beside the Pi and six coxa servos |`);
  rows.push(`| Joint limits | coxa ±${d.spec.limits.coxaDeg[1]}°, femur ±${d.spec.limits.femurDeg[1]}°, tibia ±${d.spec.limits.tibiaDeg[1]}° | the contract's |`);
  return rows.join('\n');
}

/**
 * @description The mass budget row by row, with the brief's figure beside each printed group.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodMassTable(d: HexapodDesign): string {
  const rows = ['| Part | Each (g) | Qty | Total (g) | Kind |', '|---|---|---|---|---|'];
  for (const r of d.massBudget.rows) rows.push(`| ${r.name} | ${r.eachG} | ${r.qty} | ${r.totalG} | ${r.kind} |`);
  const b = d.massBudget;
  rows.push(`| **All-up (computed)** | | | **${b.totalG}** | printed ${b.printedG} g + bought ${b.boughtG} g |`);
  rows.push(`| Target | | | ${b.targetG} | the contract's, re-based on the parts model (B29); ${b.withinTarget ? 'met' : `missed by ${b.totalG - b.targetG} g`} |`);
  rows.push(`| The brief's estimate | | | ${b.briefTotalG} | allUpMassG(BRIEF_MASSES): body ${BRIEF_MASSES.bodyG}, legs 6 × (${BRIEF_MASSES.coxaLinkG} + ${BRIEF_MASSES.femurLinkG} + ${BRIEF_MASSES.tibiaLinkG}) |`);
  rows.push(`| Latched-spring option adds | | | ${b.optionAddedG['latched-spring']} | the module, two springs and the wind servo: ${b.totalG + b.optionAddedG['latched-spring']} g all up |`);
  return rows.join('\n');
}

/**
 * @description The link masses the plant builds from, computed, beside the brief's.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodLinkMassTable(d: HexapodDesign): string {
  const m = d.masses;
  return ['| Link | Computed (g) | The brief\'s (g) |', '|---|---|---|',
    `| body (plates, bay, head, tray, every bought part, six coxa servos) | ${m.bodyG} | ${BRIEF_MASSES.bodyG} |`,
    `| coxa link (bracket + femur servo) | ${m.coxaLinkG} | ${BRIEF_MASSES.coxaLinkG} |`,
    `| femur link (femur + tibia servo) | ${m.femurLinkG} | ${BRIEF_MASSES.femurLinkG} |`,
    `| tibia link (tibia + foot) | ${m.tibiaLinkG} | ${BRIEF_MASSES.tibiaLinkG} |`].join('\n');
}

/**
 * @description The worst stance load per joint type against the servo.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodJointTable(d: HexapodDesign): string {
  const rows = ['| Joint | Static (N·m) | Required (× dynamic allowance) | Continuous (N·m) | Stall (N·m) | Margin | Worst pose | How |', '|---|---|---|---|---|---|---|---|'];
  for (const j of d.joints) rows.push(`| ${j.joint} | ${n2(j.staticNm)} | ${n2(j.nm)} | ${n2(j.usableNm)} | ${n2(j.stallNm)} | ${n2(j.margin)}${j.withinContinuous ? '' : ' **over**'} | femur ${j.pose.femurDeg}°, tibia ${j.pose.tibiaDeg}°, reach ${j.pose.footReachMm} mm, body ${j.pose.bodyHeightMm} mm, ${j.pose.feetOnGround} feet | ${j.because} |`);
  return rows.join('\n');
}

/**
 * @description Both jump options, numbers and what the plant measures.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodJumpTable(d: HexapodDesign): string {
  const rows = ['| Option | Numbers | Feasible | Because |', '|---|---|---|---|'];
  for (const j of d.jump) rows.push(`| ${j.option} | ${Object.entries(j.numbers).map(([k, v]) => `${k} ${v}`).join('; ')} | ${j.feasible} | ${j.because} |`);
  return rows.join('\n');
}

/**
 * @description The printed parts.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodPartsTable(d: HexapodDesign): string {
  const rows = ['| Part | Qty | Link | Base | Features | Material | Mass each (g) | Option | Print notes |', '|---|---|---|---|---|---|---|---|---|'];
  for (const p of d.printed) {
    const b = p.cad.base;
    const base = b.kind === 'box' ? `box ${n2(b.sizeX)} × ${n2(b.sizeY)} × ${n2(b.sizeZ)} mm` : b.kind === 'cylinder' ? `cylinder Ø${b.diameter} × ${b.height} mm` : `sketch, ${b.points.length} points, ${b.height} mm`;
    rows.push(`| ${p.name} | ${p.qty} | ${p.link} | ${base} | ${p.cad.features.length} | ${p.material} | ${p.massEachG} | ${p.option ?? ''} | ${p.printNotes} |`);
  }
  return rows.join('\n');
}

/**
 * @description The bought parts with approximate prices and their source lines.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodBoughtTable(d: HexapodDesign): string {
  const rows = ['| Part | Qty | Role | Approx. each (2026, USD) | Option | Source |', '|---|---|---|---|---|---|'];
  for (const b of d.bought) rows.push(`| ${b.name} | ${b.qty} | ${b.role} | ${b.approxUsdEach} | ${b.option ?? ''} | ${b.source} |`);
  rows.push(`| **Total, approximate (base)** | | | **${d.approxUsd}** | | |`, `| **With the latched-spring option** | | | **${d.approxUsdWithSpring}** | | |`);
  return rows.join('\n');
}

/**
 * @description The bill of materials.
 * @param d - The design.
 * @returns A markdown table.
 */
export function hexapodBomTable(d: HexapodDesign): string {
  const rows = ['| Id | Kind | Name | Qty | Mass each (g) | Total (g) | USD each | USD total | Option |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of d.bom) rows.push(`| ${r.id} | ${r.kind} | ${r.name} | ${r.qty} | ${r.massEachG} | ${r.totalG} | ${r.approxUsdEach} | ${r.approxUsdTotal} | ${r.option ?? ''} |`);
  return rows.join('\n');
}

/** @description The head of the document: what it is, what the brief read, the layout and the mass budget. */
function frontSections(d: HexapodDesign): string[] {
  const s = d.servo; const b = d.massBudget;
  return [
    `# spider-18 — the six-legged robot we print (ADR-202)`, '',
    'Generated from the `embodied` parts model (`GET /api/embodied/build/hexapod/design.md`): change a number in `hexapod-spec.ts` or a servo row and every table here, the CAD programs and the plant\'s link masses follow. Designed, not built; nothing below is a measurement. A value computed from the parts says "computed"; a value from the brief says "the brief\'s".', '',
    '## What the brief read', '',
    '- hold a Raspberry Pi: a Pi 5 in a vented bay between the two plates, the official active cooler on it.',
    '- have heat: a head (the nose carrying the LiDAR) and the Pi bay\'s heat path (the cooler, the plate vent).',
    '- one eye lidar: one 2-D ring (LD19 class) in the nose, its scan plane on the body mid-plane.',
    `- six legs: three joints each, ${d.spec.servoCount} × ${s.name} on one bus — the row the printed arm uses.`,
    '- jump: two options the simulation decides between — `legs-hop` (servos only) and `latched-spring` (a pogo through the body centre).',
    '- reversible: the body is symmetric top to bottom and inverted walking is the mirror rule below.', '',
    '## Layout', '', hexapodLayoutTable(d), '',
    '## Mass budget', '',
    `Computed all-up **${b.totalG} g** against the contract's **${b.targetG} g** target (re-based on the parts model, B29): ${b.withinTarget ? 'within the target' : `**over by ${b.totalG - b.targetG} g**`}. Printed masses are each program's net volume times its fill through the arm's \`printedMassG\`; bought masses are the catalog rows' class figures.`, '',
    hexapodMassTable(d), '',
    '### Link masses for the plant', '', hexapodLinkMassTable(d), '',
  ];
}

/** @description The loads, the reversible rule and the jump options. */
function physicsSections(d: HexapodDesign): string[] {
  const s = d.servo;
  return [
    '## Loads', '',
    `Three feet carry the computed all-up weight (tripod stance); each joint's worst static hold over the stance poses the limits allow is multiplied by the arm's dynamic allowance (${DYNAMIC_ALLOWANCE}) and compared with the servo's continuous torque (${Math.round(CONTINUOUS_FRACTION * 100)} % of its ${n2(s.stallNm)} N·m rated stall). The coxa is sized on the friction-limited push (${FOOT_FRICTION}, a design assumption). The plant lane measures these holds.`, '',
    hexapodJointTable(d), '',
    '## The reversible rule', '',
    `The body is the same upside down: two copies of one plate program mounted collar to collar, the Pi bay centred on the mid-plane, the pack on the mid-plane in the tail, the LiDAR scan plane on the mid-plane, each tibia symmetric about its axis with a round foot, and no part of the coxa bracket above or below the femur axis beyond its straps — the femur swings through horizontal to the other side. The sign convention, quoted from \`SIGN_CONVENTION\`: coxa "${SIGN_CONVENTION.coxa}"; femur "${SIGN_CONVENTION.femur}"; tibia "${SIGN_CONVENTION.tibia}"; zero pose "${SIGN_CONVENTION.zeroPose}". When the IMU reports the body inverted the controller applies \`invertedJointTargets\`: coxa targets unchanged, femur and tibia targets negated, and the leg roles mirrored by \`mirrorLegRole\` (the gait that drove L1 drives R1). The plant lane tests the rule; it is a hypothesis until the simulation says so.`, '',
    '## Jump', '',
    'Neither option is asserted to work: each row says what the design gives the plant and what the plant will measure.', '',
    hexapodJumpTable(d), '',
  ];
}

/**
 * @description The whole design as markdown.
 * @param fit - Which fit.
 * @returns Markdown.
 */
export function hexapodDesignMarkdown(fit: HexapodFit): string {
  const d = buildHexapod(fit);
  return [
    ...frontSections(d),
    ...physicsSections(d),
    '## Printed parts', '', hexapodPartsTable(d), '',
    '## Bought parts', '', hexapodBoughtTable(d), '',
    '## Bill of materials', '',
    `Also as CSV: \`GET /api/embodied/build/hexapod/bom.csv\`. Each printed part's CAD Studio program: \`GET /api/embodied/build/hexapod/parts/<id>\`.`, '',
    hexapodBomTable(d), '',
    '## Assumptions', '', ...d.assumptions.map((a) => `- ${a}`), '',
    '## Print rules', '', ...d.printRules.map((r) => `- ${r}`), '',
  ].join('\n');
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * @description The bill of materials as CSV: one row per printed and bought part, the jump module's rows flagged by option.
 * @param fit - Which fit.
 * @returns CSV text with a header row.
 */
export function hexapodBomCsv(fit: HexapodFit): string {
  const d = buildHexapod(fit);
  const header = ['id', 'kind', 'name', 'qty', 'massEachG', 'totalG', 'approxUsdEach', 'approxUsdTotal', 'option', 'detail'];
  const lines = [header.join(',')];
  for (const r of d.bom) lines.push([r.id, r.kind, r.name, r.qty, r.massEachG, r.totalG, r.approxUsdEach, r.approxUsdTotal, r.option ?? '', r.detail].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}
