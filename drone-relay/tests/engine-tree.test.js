/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Trees (backlog B5): a spec with two work points sizes a trunk (its last relay AT the fork) and two branches, every tip's frames crossing the trunk; the refusals name the branch point, and ground nodes, a control channel and a courier are refused on a tree; a spec without branches plans with no tree block at all; the tree's elastic rule keeps every hop within the allowed hop for every relay count from none to more than the plan needs, puts the tips on their work points exactly when the plan's count is in the tree, and at that count reproduces the plan's slots; a relay short, the branch farthest short keeps its tip and the other retreats one hop (hold-degraded holds both); a trunk loss on a tight tree cuts both branches and is met in the middle — the connected relay stretches out, the junction walks in, both tips come back at the same instant and one spare restores the tree (at 6 s staleness the same loss drops the stranded far side from the roster and spends both spares); a branch loss is a chain loss on that branch while the other tip never loses reach, and the spare shifts the tree outward; a tree built from the base reaches every slot; the same inputs give the same bytes.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

/** A 600 m trunk east, then two 500 m branches north and south: ESP-NOW at the default margin. */
const TREE = { path: [{ x: 0, y: 0 }, { x: 600, y: 0 }], branches: [[{ x: 600, y: 500 }], [{ x: 600, y: -500 }]], fleetSize: 9, enduranceS: 1800 };
/** A tight tree (2 dB, spacing 0.9): a 1600 m trunk, a 1200 m branch north and a 600 m branch south — one trunk loss opens a gap beyond the edge. */
const TIGHT = { path: [{ x: 0, y: 0 }, { x: 1600, y: 0 }], branches: [[{ x: 1600, y: 1200 }], [{ x: 1600, y: -600 }]], requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 6, enduranceS: 1800, staleS: 20 };

function run(specInput, scenarioInput) {
  const spec = e.validateSpec(specInput);
  const plan = e.planChain(spec);
  return { spec, plan, result: e.simulate(spec, plan, e.validateScenario(scenarioInput, plan)) };
}

function refused(field, input) {
  assert.throws(() => e.validateSpec(input), (err) => err.name === 'SpecError' && err.field === field, `expected a SpecError naming ${field}`);
}

const at = (frame, id) => frame.drones.find((d) => d.id === id);
const lastFrame = (result) => result.frames[result.frames.length - 1];
const lowest = (result, id) => Math.min(...result.frames.map((f) => at(f, id).s));

/** Every hop a layout implies: base → trunk, then from the trunk's end out each branch to its tip. */
function layoutHops(layout) {
  const hops = [];
  let prev = 0;
  for (const s of layout.trunk) { hops.push(s - prev); prev = s; }
  layout.tips.forEach((tip, b) => {
    let from = prev;
    for (const s of layout.branches[b]) { hops.push(s - from); from = s; }
    hops.push(tip - from);
  });
  return hops;
}

test('a spec with two work points sizes a trunk and two branches', () => {
  const { plan } = run(TREE, { durationS: 10 });
  assert.deepEqual(plan.slots.map((s) => [s.index, Math.round(s.s * 10) / 10, s.branch || 0]), [[1, 200, 0], [2, 400, 0], [3, 600, 0], [4, 766.7, 1], [5, 933.3, 1], [6, 766.7, 2], [7, 933.3, 2]]);
  assert.deepEqual(plan.slots[2].pt, { x: 600, y: 0, z: 40 }, 'the trunk\'s last relay sits AT the fork');
  assert.deepEqual(plan.slots[5].pt, { x: 600, y: -166.7, z: 40 }, 'a branch slot lies on its own branch');
  assert.equal(plan.relaysNeeded, 7);
  assert.equal(plan.sparesAvailable, 2);
  assert.equal(plan.hops, 9, 'three trunk hops and three on each branch');
  assert.equal(plan.hopM, 200);
  assert.equal(plan.pathLengthM, 1100, 'the farthest tip');
  assert.deepEqual(plan.tree.branches.map((b) => [b.index, b.lengthM, b.hops, b.relays, b.tipS]), [[1, 500, 3, 2, 1100], [2, 500, 3, 2, 1100]]);
  assert.equal(plan.tree.forkS, 600);
  assert.equal(plan.tree.trunkHops, 3);
  assert.deepEqual(plan.tree.branches.map((b) => b.tip.pt), [{ x: 600, y: 500, z: 30 }, { x: 600, y: -500, z: 30 }]);
  assert.equal(plan.endToEndKbps, 20.8, 'every frame of both tips crosses the trunk: 250 kbps over 6 + 6 hops');
  assert.equal(plan.endToEndLatencyMs, 120, 'six hops to either tip at 20 ms');
  assert.equal(plan.feasible, true);
  assert.deepEqual(e.rosterIds(plan), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 's1', 's2', 'tip1', 'tip2']);
  assert.deepEqual(e.chainOrderTo(plan, 'tip2'), ['r1', 'r2', 'r3', 'r6', 'r7', 'tip2'], 'a route to tip2 walks the trunk and branch 2');
  assert.deepEqual(e.routeThrough(e.chainOrderTo(plan, 'r4'), 'r4', 'outward'), ['base', 'r1', 'r2', 'r3', 'r4']);
  const stream = e.planChain(e.validateSpec({ ...TREE, tipDataKbps: 25 }));
  assert.equal(stream.feasible, false);
  assert.match(stream.reasons[0], /each of the 2 tips needs 25 kbps and every tip's frames cross the trunk: 12 hops' worth/);
});

test('tree refusals name their field, and a chain carries no tree at all', () => {
  refused('branches', { branches: 'north' });
  refused('branches', { branches: [[{ x: 1000, y: 500 }]] });
  refused('branches', { branches: new Array(5).fill(0).map((_, i) => [{ x: 1000 + i * 10, y: 500 }]) });
  refused('branches[1]', { branches: [[{ x: 1000, y: 500 }], []] });
  refused('branches[0][0]', { branches: [[{ x: 1000.5, y: 0 }], [{ x: 1000, y: -500 }]] });
  refused('branches[1][0]', { branches: [[{ x: 1000, y: 500 }], [{ x: 'far', y: 0 }]] });
  refused('branches[0][1]', { branches: [[{ x: 1000, y: 500 }, { x: 1000, y: 500.2 }], [{ x: 1000, y: -500 }]] });
  refused('branches[0]', { branches: [[{ x: 1000, y: 49_900 }], [{ x: 1000, y: -500 }]] });
  refused('groundNodes', { ...TREE, groundNodes: [300] });
  refused('controlChannel', { ...TREE, controlChannel: 'lora-915' });
  refused('courierMB', { ...TREE, courierMB: 10 });
  const chain = e.validateSpec({ fleetSize: 6 });
  assert.equal(Object.prototype.hasOwnProperty.call(chain, 'branches'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(e.planChain(chain), 'tree'), false, 'a chain plans exactly as it did');
  assert.deepEqual(e.rosterIds(e.planChain(chain)), ['r1', 'r2', 'r3', 'r4', 's1', 's2', 'tip']);
});

test('the elastic targets keep every branch\'s hop under the design hop, for every relay count', () => {
  const { plan } = run(TREE, { durationS: 10 });
  const shape = { forkS: 600, branchM: [500, 500] };
  for (let k = 0; k <= 10; k += 1) {
    const layout = e.treeTargets(shape, k, k, plan.hopM);
    const hops = layoutHops(layout);
    assert.equal(layout.trunk.length + layout.branches.flat().length, k, `exactly ${k} relay targets`);
    assert.ok(hops.every((h) => h > 0 && h <= plan.hopM + 1e-9), `k = ${k}: hops ${hops.map(Math.round).join(', ')}`);
    assert.equal(layout.tips.every((t) => t === 1100), k >= plan.relaysNeeded, `k = ${k}: the tips are on their work points exactly when the plan's count is in the tree`);
  }
  const full = e.treeTargets(shape, 7, 7, plan.hopM);
  assert.deepEqual([...full.trunk, ...full.branches.flat()].map((s) => Math.round(s * 10) / 10), plan.slots.map((s) => Math.round(s.s * 10) / 10), 'at full strength the rule is the plan');
  assert.deepEqual(e.treeTargets(shape, 2, 2, 200).tips, [600, 600], 'two relays cannot hold the junction: both tips wait at the fork');
  assert.deepEqual(e.treeTargets(shape, 3, 3, 200), { trunk: [200, 400, 600], branches: [[], []], tips: [800, 800] });
  assert.deepEqual(e.treeTargets(shape, 6, 6, 200).tips, [1100, 1000], 'a relay short: branch 2 retreats one hop (ties go to the lower branch)');
  assert.deepEqual(e.treeTargets(shape, 6, 6, 480).tips, [1100, 1100], 'on the degraded range six relays hold both tips');
  assert.deepEqual(e.treeSpreadTo(shape, [{ s: 1100, held: false }, { s: 900, held: true }], 5), { trunk: [200, 400, 600], branches: [[850], [900]], tips: [1100, 900] }, 'a held end (a meeting point) gets a relay AT it');
});

test('a relay short on a tree: the branch farthest short keeps its tip, the other retreats one hop; hold-degraded holds both', () => {
  const retreat = run(TREE, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] }).result;
  assert.equal(retreat.metrics.tipOutageS, 0, 'a 400 m trunk hop is inside the modelled edge');
  assert.equal(lowest(retreat, 'tip1'), 1100);
  assert.equal(lowest(retreat, 'tip2'), 1000, 'tip2 came back one design hop while the spare flew out');
  assert.equal(retreat.metrics.sparesLaunched, 1);
  assert.equal(retreat.metrics.verdict, 'restored');
  const held = run({ ...TREE, gapPolicy: 'hold-degraded' }, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] }).result;
  assert.equal(lowest(held, 'tip1'), 1100);
  assert.equal(lowest(held, 'tip2'), 1100, 'under hold-degraded neither tip moves');
  assert.equal(held.metrics.verdict, 'restored');
});

test('a trunk loss cuts both branches and is met in the middle: both tips come back at once and one spare restores the tree', () => {
  const { plan, result } = run(TIGHT, { durationS: 300, events: [{ atS: 30, kind: 'fail', drone: 'r2' }] });
  assert.deepEqual(plan.slots.map((s) => [Math.round(s.s), s.branch || 0]), [[533, 0], [1067, 0], [1600, 0], [2200, 1]]);
  assert.ok(2 * 533.3 > plan.hardRangeM, 'one trunk loss opens a gap beyond the modelled edge');
  const m = result.metrics;
  assert.deepEqual(m.branches.map((b) => [b.tip, b.outages, b.reconnectedAtS]), [['tip1', [{ fromS: 30, toS: 41 }], [41]], ['tip2', [{ fromS: 30, toS: 41 }], [41]]], 'both branches lost at the cut and back at the same instant');
  assert.equal(m.tipOutageS, 11);
  assert.deepEqual(m.gapDetectedAtS, [], 'the tree closed inside the 20 s staleness window');
  const before = result.frames.find((f) => f.atS === 29);
  const back = result.frames.find((f) => f.atS === 41);
  assert.ok(at(back, 'r1').s - at(before, 'r1').s > 50, `the connected relay stretched toward the midpoint (${at(before, 'r1').s} → ${at(back, 'r1').s})`);
  assert.ok(at(before, 'r3').s - at(back, 'r3').s > 15, `the junction walked in on its own rule (${at(before, 'r3').s} → ${at(back, 'r3').s})`);
  assert.equal(at(back, 'r3').lane, 0);
  const launches = result.events.filter((ev) => ev.kind === 'launch');
  assert.deepEqual(launches.map((ev) => [ev.drone, ev.atS]), [['s1', 49.5]], 'one spare, once the lost relay went stale');
  assert.deepEqual(m.restoredAtS, [158.5]);
  assert.equal(m.verdict, 'restored');
  const last = lastFrame(result);
  assert.deepEqual(last.hops.map((h) => [h.from, h.to, Math.round(h.distanceM)]), [['base', 's1', 533], ['s1', 'r1', 533], ['r1', 'r3', 533], ['r3', 'r4', 600], ['r4', 'tip1', 600], ['r3', 'tip2', 600]]);
  const short = run({ ...TIGHT, staleS: 6 }, { durationS: 300, events: [{ atS: 30, kind: 'fail', drone: 'r2' }] }).result;
  assert.equal(short.metrics.tipOutageS, 11, 'the same meet in the middle');
  assert.deepEqual(short.events.filter((ev) => ev.kind === 'launch').map((ev) => [ev.drone, ev.atS]), [['s1', 35.5], ['s2', 40.5]], 'at 6 s staleness the stranded far side drops off the roster and both spares go');
  assert.equal(lastFrame(short).drones.filter((d) => d.role === 'relay' && d.state === 'active').length, 5, 'five relays for four slots once it reconnects');
  assert.equal(short.metrics.verdict, 'degraded');
});

test('a branch loss is a chain loss on that branch: the other tip never loses reach, and the spare shifts the tree outward', () => {
  const { result } = run(TIGHT, { durationS: 300, events: [{ atS: 30, kind: 'fail', drone: 'r4' }] });
  const m = result.metrics;
  assert.deepEqual(m.branches.map((b) => [b.tip, b.outageS]), [['tip1', 25.5], ['tip2', 0]]);
  assert.deepEqual(m.branches[0].reconnectedAtS, [55.5]);
  assert.equal(m.verdict, 'restored');
  const last = lastFrame(result);
  assert.deepEqual(['r1', 'r2', 'r3', 's1'].map((id) => [id, at(last, id).s, at(last, id).lane]), [['r1', 1066.7, 0], ['r2', 1600, 0], ['r3', 2200, 1], ['s1', 533.3, 0]], 'every relay moved out one slot: the old junction onto the branch, the spare in at the base');
  assert.ok(last.hops.every((h) => h.ok));
});

test('a tree built from the base reaches every slot, and runs are deterministic', () => {
  const { plan, result } = run(TREE, { durationS: 400, startDeployed: false });
  assert.deepEqual(result.events.filter((ev) => ev.kind === 'launch').map((ev) => ev.atS), [0, 5, 10, 15, 20, 25, 30], 'one launch per interval');
  assert.deepEqual(result.metrics.restoredAtS, [182.5]);
  assert.equal(result.metrics.verdict, 'held');
  assert.equal(result.metrics.tipOutageS, 0);
  const last = lastFrame(result);
  const placed = last.drones.filter((d) => d.role === 'relay' && d.state === 'active').map((d) => [d.s, d.lane]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const slots = plan.slots.map((s) => [Math.round(s.s * 10) / 10, s.branch || 0]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.deepEqual(placed, slots, 'every slot of the plan is held, each on its own branch');
  assert.deepEqual([at(last, 'tip1').s, at(last, 'tip2').s], [1100, 1100]);
  const scenario = { durationS: 200, events: [{ atS: 30, kind: 'fail', drone: 'r2' }, { atS: 90, kind: 'fail', drone: 'r6' }] };
  const a = run(TREE, scenario).result;
  const b = run(TREE, scenario).result;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
