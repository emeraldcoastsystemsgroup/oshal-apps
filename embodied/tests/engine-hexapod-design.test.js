/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the hexapod design against the COMPILED engine.
 *                     |                             | The mass budget sums from the parts and the catalog rows and
 *                     |                             | says, truthfully, whether it closes under the brief's target
 *                     |                             | (as designed it does not; the figures are pinned so a change
 *                     |                             | that moves them is noticed); the plant's link masses add up to
 *                     |                             | the all-up; the worst stance loads are searched inside the
 *                     |                             | limits, the reported torque is the torque in the reported pose,
 *                     |                             | every joint is inside the servo's continuous torque and a
 *                     |                             | heavier machine is not; every printed part validates against
 *                     |                             | CAD Studio's own compiled contract (its absence FAILS, never
 *                     |                             | skips); the plate is one program listed twice; both jump
 *                     |                             | options are the spec's and unmeasured; the bought parts restate
 *                     |                             | nothing; the document and the BOM are generated.
 *
 * Plain node: `node --test tests/engine-hexapod-design.test.js`.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B29: the target is re-based on the parts model (2100 g); the budget closes and the pin says so.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROUTES = path.join(__dirname, '..', 'routes');
const DESIGN = path.join(ROUTES, 'engine', 'design');
const SRC = path.join(__dirname, '..', 'src-routes');
const { buildHexapod, worstStanceLoads, FOOT_FRICTION } = require(path.join(DESIGN, 'hexapod-design.js'));
const { hexapodDesignMarkdown, hexapodBomCsv } = require(path.join(DESIGN, 'hexapod-markdown.js'));
const { SPIDER_18, BRIEF_MASSES, allUpMassG, SIGN_CONVENTION } = require(path.join(DESIGN, 'hexapod-spec.js'));
const { STS3215_12V, CONTINUOUS_FRACTION, DYNAMIC_ALLOWANCE } = require(path.join(DESIGN, 'servos.js'));
const { boughtRow } = require(path.join(DESIGN, 'parts-catalog.js'));
const { G_MPS2 } = require(path.join(ROUTES, 'engine', 'physics', 'mjcf.js'));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const DEG = Math.PI / 180;

/** The figures the design computes today: pinned so that a change which closes (or widens) the gap to the target is seen, not silent. */
const PINNED_BUDGET = { totalG: 2019, printedG: 684, boughtG: 1335, targetG: 2100, withinTarget: true, briefTotalG: 1851 };

test('the mass budget is summed from the parts and the catalog rows and says whether it closes under the target — 2019 g computed under the 2100 g target re-based on the parts model (B29)', () => {
  const d = buildHexapod('spider-18');
  const b = d.massBudget;
  assert.equal(b.totalG, b.rows.reduce((a, r) => a + r.totalG, 0), 'the total is the sum of its rows');
  assert.equal(b.printedG + b.boughtG, b.totalG);
  assert.equal(b.withinTarget, b.totalG <= b.targetG);
  assert.equal(b.targetG, SPIDER_18.massTargetG);
  assert.equal(b.briefTotalG, allUpMassG(BRIEF_MASSES));
  for (const r of b.rows) {
    assert.equal(r.totalG, r.qty * r.eachG, `${r.id}: total = qty × each`);
    if (r.kind === 'printed') { const p = d.printed.find((x) => x.id === r.id); assert.ok(p && !p.option, `${r.id} is a base printed part`); assert.equal(r.eachG, p.massEachG); }
  }
  for (const id of SPIDER_18.boughtRowIds) {
    const row = boughtRow(id); const r = b.rows.find((x) => x.id === id);
    assert.ok(r, `${id} is in the budget`); assert.equal(r.eachG, row.massG); assert.equal(r.qty, 1);
  }
  const servos = b.rows.find((r) => r.id === 'servo');
  assert.equal(servos.qty, SPIDER_18.servoCount); assert.equal(servos.eachG, STS3215_12V.massG);
  assert.ok(!b.rows.some((r) => r.id === 'die-spring' || r.id === 'wind-servo' || r.id === 'spring-housing'), 'the jump module is not in the base total');
  assert.equal(b.optionAddedG['legs-hop'], 0);
  assert.equal(b.optionAddedG['latched-spring'], d.printed.filter((p) => p.option === 'latched-spring').reduce((a, p) => a + p.qty * p.massEachG, 0) + d.bought.filter((x) => x.option === 'latched-spring').reduce((a, x) => a + x.qty * x.massEachG, 0));
  assert.deepEqual({ totalG: b.totalG, printedG: b.printedG, boughtG: b.boughtG, targetG: b.targetG, withinTarget: b.withinTarget, briefTotalG: b.briefTotalG }, PINNED_BUDGET,
    'the computed budget moved: update the pin AND the design document\'s statement about the target');
});

test('the link masses the plant builds from come from the parts and add up to the all-up', () => {
  const d = buildHexapod('spider-18');
  const each = (id) => d.printed.find((p) => p.id === id).massEachG;
  assert.equal(d.masses.coxaLinkG, each('coxa-bracket') + STS3215_12V.massG);
  assert.equal(d.masses.femurLinkG, each('femur') + STS3215_12V.massG);
  assert.equal(d.masses.tibiaLinkG, each('tibia') + each('foot'));
  assert.equal(allUpMassG(d.masses), d.massBudget.totalG, 'body + six legs = the budget');
  assert.ok(d.masses.bodyG > 6 * STS3215_12V.massG + 175 + 45, 'the body carries the six coxa servos, the pack and the Pi');
});

/** The femur and tibia holds in a pose, by hand from the same masses the design uses. */
function byHand(d, pose) {
  const l = SPIDER_18.layout; const f = l.femurMm / 1000; const t = l.tibiaMm / 1000;
  const each = (id) => d.printed.find((p) => p.id === id).massEachG / 1000;
  const footN = (d.massBudget.totalG / 1000) * G_MPS2 / 3;
  const fr = pose.femurDeg * DEG; const kr = pose.tibiaDeg * DEG;
  const rKnee = f * Math.cos(fr); const rFoot = rKnee + t * Math.cos(fr + kr);
  const femur = Math.abs(footN * rFoot - G_MPS2 * (each('femur') * rKnee / 2 + (STS3215_12V.massG / 1000) * rKnee + each('tibia') * (rKnee + rFoot) / 2 + each('foot') * rFoot));
  const tibia = Math.abs(footN * (rFoot - rKnee) - G_MPS2 * (each('tibia') * (rFoot - rKnee) / 2 + each('foot') * (rFoot - rKnee)));
  const coxa = FOOT_FRICTION * footN * (l.coxaMm / 1000 + rFoot);
  return { femur, tibia, coxa, footZ: -f * Math.sin(fr) - t * Math.sin(fr + kr) };
}

test('the worst stance loads are searched inside the limits with the foot on the ground, the reported torque is the torque in the reported pose, and every joint is inside the continuous torque — a machine twice as heavy is not', () => {
  const d = buildHexapod('spider-18');
  assert.deepEqual(d.joints.map((j) => j.joint), ['coxa', 'femur', 'tibia']);
  for (const j of d.joints) {
    const lim = SPIDER_18.limits;
    assert.ok(j.pose.femurDeg >= lim.femurDeg[0] && j.pose.femurDeg <= lim.femurDeg[1], `${j.joint}: femur inside its limits`);
    assert.ok(j.pose.tibiaDeg >= lim.tibiaDeg[0] - 0.1 && j.pose.tibiaDeg <= lim.tibiaDeg[1] + 0.1, `${j.joint}: tibia inside its limits`);
    const hand = byHand(d, j.pose);
    near(hand.footZ * 1000, -SPIDER_18.layout.standHeightMm, 0.6, `${j.joint}: the foot is on the ground at the stand height`);
    near(j.staticNm, hand[j.joint], 0.002, `${j.joint}: the reported torque is the torque in the reported pose`);
    near(j.nm, j.staticNm * DYNAMIC_ALLOWANCE, 0.002, `${j.joint}: the requirement carries the dynamic allowance`);
    near(j.usableNm, STS3215_12V.stallNm * CONTINUOUS_FRACTION, 0.001);
    assert.equal(j.withinContinuous, true, `${j.joint}: ${j.nm} N·m against ${j.usableNm} N·m continuous`);
    assert.ok(j.margin >= 1);
    assert.equal(j.pose.feetOnGround, 3, 'tripod stance');
  }
  const femur = d.joints.find((j) => j.joint === 'femur');
  assert.ok(femur.pose.footReachMm > 200, 'the femur\'s worst is the leg stretched toward horizontal');
  const heavy = worstStanceLoads(SPIDER_18, d.printed, STS3215_12V, 2 * d.massBudget.totalG);
  assert.equal(heavy.find((j) => j.joint === 'femur').withinContinuous, false, 'the search is sensitive to the mass it is given');
});

test('every printed part is a CAD Studio program its own contract accepts, and the plate is ONE program listed twice', () => {
  const contractPath = path.join(__dirname, '..', '..', 'cad-studio', 'routes', 'feature-contract.js');
  assert.ok(fs.existsSync(contractPath), 'cad-studio must be checked out beside this package: its compiled feature contract is this guard');
  const contract = require(contractPath);
  const d = buildHexapod('spider-18');
  const ids = d.printed.map((p) => p.id);
  assert.deepEqual([...new Set(ids)], ids, 'one program per part id');
  assert.deepEqual(ids, ['plate', 'pi-bay', 'head', 'battery-tray', 'coxa-bracket', 'femur', 'tibia', 'foot', 'spring-housing', 'piston', 'cam', 'latch', 'piston-foot']);
  for (const p of d.printed) {
    assert.doesNotThrow(() => contract.validateBase(p.cad.base), `${p.id} base`);
    const list = contract.validateFeatureList(p.cad.features);
    assert.equal(list.length, p.cad.features.length, `${p.id}: every feature accepted`);
    list.forEach((f, i) => { assert.equal(f.id, p.cad.features[i].id, `${p.id}: feature ids are the program's`); assert.ok(contract.FEATURE_TYPES.includes(f.type)); });
    assert.ok(p.massEachG >= 1 && p.material && p.printNotes, `${p.id}: material, notes, mass`);
    assert.equal(p.option === 'latched-spring', ['spring-housing', 'piston', 'cam', 'latch', 'piston-foot'].includes(p.id), `${p.id}: only the jump module carries the option`);
  }
  const plate = d.printed.filter((p) => p.id === 'plate');
  assert.equal(plate.length, 1); assert.equal(plate[0].qty, 2);
  assert.equal(plate[0].cad.base.kind, 'sketch'); assert.equal(plate[0].cad.base.points.length, 6, 'a hexagon');
  for (const leg of ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']) for (const kind of ['collar', 'pocket', 'spline']) assert.ok(plate[0].cad.features.some((f) => f.id === `${kind}-${leg}`), `${kind}-${leg}`);
  assert.equal(d.printed.find((p) => p.id === 'coxa-bracket').qty, 6);
  assert.ok(d.printed.find((p) => p.id === 'coxa-bracket').printNotes.includes('swings through horizontal'), 'the bracket says how the femur passes horizontal');
  assert.ok(d.printed.find((p) => p.id === 'tibia').printNotes.includes('symmetric about its axis'));
});

test('the jump entries are the spec\'s two options, the brief\'s figures labelled as the brief\'s, feasibility left to the plant', () => {
  const d = buildHexapod('spider-18');
  assert.deepEqual(d.jump.map((j) => j.option), [...SPIDER_18.jumpOptions]);
  for (const j of d.jump) {
    assert.equal(j.feasible, 'to be measured by the plant');
    assert.match(j.because, /plant measures|to measure/);
    for (const [k, v] of Object.entries(j.numbers)) assert.ok(Number.isFinite(v), `${j.option}.${k} is a number`);
  }
  const spring = d.jump.find((j) => j.option === 'latched-spring');
  assert.equal(spring.numbers.storedJ, SPIDER_18.spring.storedJ);
  near(spring.numbers.briefLosslessHeightM, SPIDER_18.spring.storedJ / ((SPIDER_18.massTargetG / 1000) * G_MPS2), 0.001, 'the brief\'s 19 cm, at the target mass');
  assert.ok(spring.numbers.losslessHeightM < spring.numbers.briefLosslessHeightM, 'the design\'s own mass lowers the lossless bound');
  assert.ok(spring.numbers.windDrumRadiusMm * SPIDER_18.spring.stiffnessNPerM * (SPIDER_18.spring.strokeMm / 1000) / 1000 <= STS3215_12V.stallNm * CONTINUOUS_FRACTION, 'the drum is what the continuous torque winds');
  assert.equal(spring.numbers.addedMassG, d.massBudget.optionAddedG['latched-spring']);
  const hop = d.jump.find((j) => j.option === 'legs-hop');
  near(hop.numbers.peakMechanicalWPerServo, (STS3215_12V.stallNm * STS3215_12V.noLoadRadS) / 4, 0.001);
  assert.equal(hop.numbers.pitchServos, 12);
});

test('the bought parts restate nothing: every name, mass, price and source is the catalog row\'s, and no package source restates a bought row\'s name', () => {
  const d = buildHexapod('spider-18');
  for (const id of SPIDER_18.boughtRowIds) {
    const row = boughtRow(id); const b = d.bought.find((x) => x.id === id);
    assert.deepEqual({ name: b.name, massEachG: b.massEachG, approxUsdEach: b.approxUsdEach, source: b.source }, { name: row.name, massEachG: row.massG, approxUsdEach: row.approxUsd, source: row.source });
  }
  const spring = d.bought.find((x) => x.id === 'die-spring');
  assert.equal(spring.option, 'latched-spring'); assert.equal(spring.qty, 2); assert.equal(spring.name, boughtRow('die-spring-5n-mm').name);
  assert.equal(d.approxUsd, d.bought.filter((x) => !x.option).reduce((a, x) => a + x.qty * x.approxUsdEach, 0));
  assert.ok(d.approxUsdWithSpring > d.approxUsd);
  const names = JSON.parse(fs.readFileSync(path.join(SRC, 'engine', 'design', 'parts-catalog.json'), 'utf8')).bought.map((r) => r.name);
  const restated = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) { const body = fs.readFileSync(p, 'utf8'); for (const n of names) if (body.includes(n)) restated.push(`${path.relative(SRC, p)}: ${n}`); } } };
  walk(SRC);
  assert.deepEqual(restated, []);
});

test('the design document is generated: it names both options as unmeasured, quotes the sign convention and the mirror rule by name, and states the budget against the target', () => {
  const d = buildHexapod('spider-18');
  const md = hexapodDesignMarkdown('spider-18');
  for (const needle of ['legs-hop', 'latched-spring', 'to be measured by the plant', SIGN_CONVENTION.coxa, SIGN_CONVENTION.femur, SIGN_CONVENTION.tibia, '`invertedJointTargets`', '`mirrorLegRole`', `**${d.massBudget.totalG} g**`, `**${d.massBudget.targetG} g**`, 'the brief\'s', 'computed']) {
    assert.ok(md.includes(needle), `design.md names ${needle}`);
  }
  assert.ok(md.includes(d.massBudget.withinTarget ? 'within the target' : `over by ${d.massBudget.totalG - d.massBudget.targetG} g`));
  assert.ok(!/hop height of \d|jumps \d+ cm/i.test(md), 'no jump height is asserted');
  for (const p of d.printed) assert.ok(md.includes(p.name), `the parts table lists ${p.name}`);
  for (const b of d.bought) assert.ok(md.includes(b.name), `the bought table lists ${b.name}`);
});

test('the BOM CSV has a header and one row per bill entry, with the fields that need quoting quoted', () => {
  const d = buildHexapod('spider-18');
  const csv = hexapodBomCsv('spider-18');
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], 'id,kind,name,qty,massEachG,totalG,approxUsdEach,approxUsdTotal,option,detail');
  assert.equal(lines.length, d.bom.length + 1);
  assert.ok(lines.some((l) => l.startsWith('servo,bought,"')), 'the servo row\'s name holds commas and is quoted');
  assert.ok(lines.some((l) => l.startsWith('plate,printed,') && l.includes(',2,')), 'the plate is one row, qty 2');
  assert.ok(lines.some((l) => l.includes(',latched-spring,')), 'the jump module rows carry their option');
});
