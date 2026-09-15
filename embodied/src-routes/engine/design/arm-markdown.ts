/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printed arm's design document, every table
 *                     |                             | generated from the parts model: the sizing rules and where their
 *                     |                             | figures come from, the joint table, the sweep that chose the link
 *                     |                             | lengths, the printed parts, the mass budget, the bill of materials
 *                     |                             | and the repeatability budget.
 */

import { ARM_FITS, buildArm, buildArmFrom, type ArmDesign, type ArmFit } from './arm-design';
import { BACKLASH_DEG, CONTINUOUS_FRACTION, DYNAMIC_ALLOWANCE, SPEED_FRACTION } from './servos';

const n2 = (v: number): string => v.toFixed(2);
const deg = (r: number): string => `${Math.round((r * 180) / Math.PI)}°`;

/** @description Every joint: what it holds, what drives it, the margin and the commanded speed. */
export function jointTable(d: ArmDesign): string {
  const rows = ['| Joint | Worst gravity (N·m) | Accelerating (N·m) | Required (N·m) | Drive | Continuous (N·m) | Margin | Speed (rad/s) | Limits |', '|---|---|---|---|---|---|---|---|---|'];
  for (const j of d.joints) {
    const lim = d.spec.joints[j.joint - 1];
    rows.push(`| J${j.joint} ${j.name} | ${n2(j.gravityNm)} | ${n2(j.inertialNm)} | ${n2(j.requiredNm)} | ${j.drive ? j.drive.cfg.label : '**none holds it**'} | ${j.drive ? n2(j.drive.output.usableNm) : '—'} | ${j.drive ? n2(j.drive.margin) : '—'} | ${j.drive ? n2(j.drive.output.commandedRadS) : '—'} | ${deg(lim.min)} … ${deg(lim.max)} |`);
  }
  return rows.join('\n');
}

/** @description The sweep that chose the links: reach and the shoulder and elbow drives across lengths and payloads. */
export function armSizingTable(fitId: ArmFit): string {
  const base = ARM_FITS[fitId];
  const rows = ['| Upper arm / forearm | Payload | Reach | Shoulder needs | Shoulder drive | Elbow drive | Moving mass |', '|---|---|---|---|---|---|---|'];
  for (const [u, f] of [[180, 180], [170, 170], [160, 160], [150, 160]]) for (const pay of [0.15, 0.1]) {
    const d = buildArmFrom({ ...base, layout: { ...base.layout, upperArmMm: u, forearmMm: f }, payloadKg: pay });
    const chosen = u === base.layout.upperArmMm && f === base.layout.forearmMm && pay === base.payloadKg;
    const drive = (i: number): string => { const j = d.joints[i]; return j.drive ? `${j.drive.cfg.servos} × servo${j.drive.cfg.ratio > 1 ? `, ${j.drive.cfg.ratio}:1 belt` : ''}, margin ${n2(j.drive.margin)}` : 'none'; };
    const cells = [`${u} / ${f} mm`, `${pay} kg`, `${d.reachM.toFixed(3)} m`, `${n2(d.joints[1].requiredNm)} N·m`, drive(1), drive(2), `${d.massBudget.movingG} g`];
    rows.push(`| ${cells.map((c) => (chosen ? `**${c}**` : c)).join(' | ')} |`);
  }
  return rows.join('\n');
}

/** @description The printed parts. */
export function armPartsTable(d: ArmDesign): string {
  const rows = ['| Part | Qty | Base | Features | Material | Print notes | Mass each |', '|---|---|---|---|---|---|---|'];
  for (const p of d.parts) {
    const b = p.cad.base;
    const base = b.kind === 'box' ? `box ${n2(b.sizeX)} × ${n2(b.sizeY)} × ${n2(b.sizeZ)} mm` : b.kind === 'cylinder' ? `cylinder Ø${b.diameter} × ${b.height} mm` : `sketch, ${b.points.length} points`;
    rows.push(`| ${p.name} | ${p.qty} | ${base} | ${p.cad.features.length} | ${p.material} | ${p.printNotes} | ${p.massEachG} g |`);
  }
  return rows.join('\n');
}

/** @description What rotates with each joint, and the budget. */
export function armMassTable(d: ArmDesign): string {
  const rows = ['| Carried by | kg |', '|---|---|'];
  d.linkMassesKg.forEach((m, i) => rows.push(`| J${i + 1} ${d.joints[i].name} | ${m.toFixed(3)} |`));
  rows.push(`| **Moving arm (printed ${d.massBudget.printedG} g + servos ${d.massBudget.servosG} g)** | **${(d.massBudget.movingG / 1000).toFixed(3)}** |`, `| Payload it is sized for | ${(d.massBudget.payloadG / 1000).toFixed(3)} |`);
  return rows.join('\n');
}

/** @description The bought parts with approximate prices. */
export function armBoughtTable(d: ArmDesign): string {
  const rows = ['| Part | Qty | Role | Approx. each (2026, USD) |', '|---|---|---|---|'];
  for (const b of d.bought) rows.push(`| ${b.name} | ${b.qty} | ${b.role} | ${b.approxUsdEach} |`);
  rows.push(`| **Total, approximate** | | | **${d.approxUsd}** |`);
  return rows.join('\n');
}

/**
 * @description The whole arm design as markdown.
 * @param fitId - Which fit.
 * @returns Markdown.
 */
export function armDesignMarkdown(fitId: ArmFit): string {
  const d = buildArm(fitId);
  const s = d.fit.servo;
  return [
    `# ${d.fit.label}`,
    '',
    'Generated from the `embodied` parts model (ADR-152 D1): change a number there and every table here, the CAD programs and the physics model follow. Simulated and designed; not yet built.',
    '',
    `Reach from the shoulder **${d.reachM.toFixed(3)} m**, payload **${d.fit.payloadKg} kg**, **${d.servoCount} servos** on one bus, about **USD ${d.approxUsd}** in bought parts.${d.undersized.length ? `\n\n**Undersized:** ${d.undersized.join('; ')}.` : ''}`,
    '',
    '## How a joint is sized',
    '',
    `- The servo: ${s.name} — rated ${(s.stallNm / 0.0980665).toFixed(0)} kg·cm (${n2(s.stallNm)} N·m) stall, ${n2(s.noLoadRadS)} rad/s no-load, ${s.massG} g, ${s.encoder}. Sources: ${s.source}.`,
    `- A servo holds at most **${Math.round(CONTINUOUS_FRACTION * 100)} %** of its rated stall continuously: the bench test ran stable at half its rating and tripped its overload protection at two thirds.`,
    `- A joint must deliver its worst static gravity torque × **${DYNAMIC_ALLOWANCE}** (to accelerate the same load), plus, on a vertical axis, the stretched arm's inertia × 4 rad/s². The worst pose is searched over the joint limits, not assumed.`,
    `- The node commands **${Math.round(SPEED_FRACTION * 100)} %** of the no-load speed. Each joint takes the simplest drive that holds: one servo, two in parallel (only the shoulder has two cheeks), then a printed belt stage.`,
    '',
    jointTable(d),
    '',
    '## The sweep that chose the links',
    '',
    armSizingTable(fitId),
    '',
    '## Printed parts',
    '',
    armPartsTable(d),
    '',
    '## Mass',
    '',
    armMassTable(d),
    '',
    '## Bought parts',
    '',
    armBoughtTable(d),
    '',
    '## Repeatability',
    '',
    `The servo's measured backlash (about ${BACKLASH_DEG}°) at each pitch and yaw joint, times its lever to the tool with the arm stretched: **${d.repeatability.worstMm} mm** stacked worst case, **${d.repeatability.rssMm} mm** root sum of squares. A grasp is planned with a jaw opening wider than the object by at least the stacked figure; the swarm's map and the wrist camera close the rest.`,
    '',
    '## Print rules',
    '',
    ...d.printRules.map((r) => `- ${r}`),
    '',
    '## The physics check',
    '',
    'The engine container flies the same arm in MuJoCo (`GET /physics/arm/mjcf` is the model it loads): it holds the payload in each joint\'s worst pose and compares the measured holding torque with the table above, then runs the taught pick-and-place of a block on a bench (ADR-152 D5 task 3\'s baseline). `POST /physics/arm/check` runs it.',
    '',
  ].join('\n');
}
