/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Lattices (backlog B9): a spec with a polygon tiles it with slots on a square grid at the design hop — a 600 × 400 m area 200 m east of the base takes twelve slots five hops deep, every point of the area within 146 m of one, and the plan counts the relays, the rotation and the shared channel over them; an area away from the base is joined to it by feeder slots; the refusals name the field; the assignment rule keeps the tip reachable from any point inside the polygon with every hop within the design hop — with every slot held, and with only the route to the tip's slot — and fills inner slots first; the simulation flies the tip round its sweep and reports the chain's metrics: held with every slot on station, a lost relay routed around with no outage and replaced by one spare, the same run twice the same bytes; and a lattice whose feeder loss opens a gap no walk-in can close within the RTL window is lost — the controller holds slots, it does not stretch toward a gap.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

/** A 600 × 400 m survey area starting 200 m east of the base: ESP-NOW at the default margin. */
const RECT = { area: [{ x: 200, y: -200 }, { x: 800, y: -200 }, { x: 800, y: 200 }, { x: 200, y: 200 }], fleetSize: 20, enduranceS: 1800 };

function sized(input) {
  const spec = e.validateSpec(input);
  const plan = e.planChain(spec);
  return { spec, plan, geo: e.latticeGeometry(spec.area, e.latticeSpacingM(spec, plan)) };
}

function run(input, scenario) {
  const { spec, plan } = sized(input);
  return e.simulate(spec, plan, e.validateScenario(scenario, plan));
}

function refused(field, input) {
  assert.throws(() => e.validateSpec(input), (err) => err.name === 'SpecError' && err.field === field, `expected a SpecError naming ${field}`);
}

/** Points inside the polygon every `step` metres, plus its vertices. */
function samples(area, step) {
  const xs = area.map((p) => p.x);
  const ys = area.map((p) => p.y);
  const out = area.map((p) => ({ x: p.x, y: p.y }));
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) if (e.pointInPolygon({ x, y }, area)) out.push({ x, y });
  return out;
}

/** The tip at `p` is reachable over the held slots with every link within `hop`: a held slot in its reach, joined to the base slot by slot. */
function reachableOver(geo, held, p, hop) {
  const node = (i) => geo.nodes[i - 1];
  const set = new Set(held);
  const link = held.find((i) => Math.hypot(node(i).x - p.x, node(i).y - p.y) <= hop + 1e-6);
  if (!link) return false;
  for (let i = link; i > 0; i = node(i).parent) {
    if (!set.has(i)) return false;
    const up = node(i).parent ? node(node(i).parent) : { x: 0, y: 0 };
    if (Math.hypot(node(i).x - up.x, node(i).y - up.y) > hop + 1e-6) return false;
  }
  return true;
}

test('a polygon is tiled with slots at the design hop, and the plan counts the relays, the rotation and the channel', () => {
  const { plan, geo } = sized(RECT);
  assert.equal(plan.hopM, 206.6, 'the grid spacing is the design hop: 0.6 × 344 m');
  assert.equal(plan.relaysNeeded, 12);
  assert.equal(plan.sparesAvailable, 8);
  assert.deepEqual(plan.slots.map((s) => [s.cell.i, s.cell.j]), [[1, 0], [2, 0], [1, 1], [1, -1], [3, 0], [2, 1], [2, -1], [4, 0], [3, 1], [3, -1], [4, 1], [4, -1]], 'numbered breadth-first from the base: inner slots first');
  assert.deepEqual(plan.slots.map((s) => s.cell.depth), [1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5]);
  assert.deepEqual(plan.slots[0].pt, { x: 206.6, y: 0, z: 40 });
  assert.equal(plan.lattice.maxDepth, 5);
  assert.equal(plan.lattice.feederSlots, 0, 'the area starts inside one hop of the base');
  assert.equal(plan.lattice.coverM, 146.1, 'half a cell diagonal');
  assert.equal(plan.lattice.areaM2, 240000);
  assert.equal(plan.hops, 6, 'the deepest route plus the tip\'s own hop');
  assert.equal(plan.endToEndKbps, 41.7, '250 kbps over six hops');
  assert.equal(plan.onStationS, 1366, 'the deepest slot, 1033 m along the lattice, on a 30-minute battery');
  assert.equal(plan.sustainFleet, 17);
  assert.equal(plan.perHopMarginDb, 14.9);
  assert.ok(geo.nodes.every((n) => Math.hypot(n.x - (n.parent ? geo.nodes[n.parent - 1].x : 0), n.y - (n.parent ? geo.nodes[n.parent - 1].y : 0)) <= plan.hopM + 0.1), 'every slot is one hop from its parent');
  assert.ok(samples(RECT.area, 20).every((p) => geo.nodes.some((n) => Math.hypot(n.x - p.x, n.y - p.y) <= geo.coverM + 1e-6)), 'every point of the area has a slot within the cover');
  assert.deepEqual(plan.lattice.survey.map((p) => [p.x, p.y]), [[200, -100], [800, -100], [800, 100], [200, 100]], 'two passes across the area, back and forth');
  assert.equal(plan.lattice.surveyM, 1600);
  assert.deepEqual(e.rosterIds(plan).slice(-2), ['s8', 'tip']);
  assert.deepEqual(e.chainOrderTo(plan, 'r11'), ['r1', 'r2', 'r5', 'r8', 'r11'], 'a route to a slot walks its parents');
  const short = e.planChain(e.validateSpec({ ...RECT, fleetSize: 10 }));
  assert.equal(short.feasible, false);
  assert.match(short.reasons[0], /the lattice needs 12 relays/);
});

test('an area away from the base is joined to it by feeder slots', () => {
  const { plan } = sized({ area: [{ x: 1000, y: -150 }, { x: 1400, y: -150 }, { x: 1400, y: 150 }, { x: 1000, y: 150 }], fleetSize: 20, enduranceS: 1800 });
  assert.equal(plan.lattice.feederSlots, 4);
  assert.deepEqual(plan.slots.filter((s) => s.cell.feeder).map((s) => [s.cell.i, s.cell.j, s.cell.depth]), [[1, 0, 1], [2, 0, 2], [3, 0, 3], [4, 0, 4]], 'the shortest run of grid nodes out to the area');
  assert.equal(plan.relaysNeeded, 13);
  assert.equal(plan.lattice.maxDepth, 8);
});

test('area refusals name their field', () => {
  refused('area', { area: [{ x: 100, y: 0 }, { x: 200, y: 0 }] });
  refused('area', { area: 'north field' });
  refused('area[1]', { area: [{ x: 100, y: 0 }, { x: 'far', y: 0 }, { x: 100, y: 100 }] });
  refused('area[1]', { area: [{ x: 100, y: 0 }, { x: 100.5, y: 0 }, { x: 100, y: 100 }] });
  refused('area', { area: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] });
  refused('area', { area: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }] });
  refused('area', { area: [{ x: 0, y: 0 }, { x: 25_000, y: 0 }, { x: 25_000, y: 100 }] });
  refused('path', { ...RECT, path: [{ x: 0, y: 0 }, { x: 500, y: 0 }] });
  refused('groundNodes', { ...RECT, groundNodes: [300] });
  refused('controlChannel', { ...RECT, controlChannel: 'lora-915' });
  refused('courierMB', { ...RECT, courierMB: 5 });
  refused('area', { area: [{ x: 0, y: 0 }, { x: 19_000, y: 0 }, { x: 19_000, y: 19_000 }, { x: 0, y: 19_000 }], spacingFactor: 0.2, pathLossExponent: 4 });
  assert.equal(Object.prototype.hasOwnProperty.call(e.validateSpec({}), 'area'), false, 'a chain carries no area');
  assert.equal(Object.prototype.hasOwnProperty.call(e.planChain(e.validateSpec({})), 'lattice'), false);
});

test('the assignment rule keeps the tip reachable from any point inside the polygon with every hop within the design hop', () => {
  const { plan, geo } = sized(RECT);
  assert.equal(Math.round(geo.spacingM * 10) / 10, plan.hopM, 'the design hop, unrounded, is the grid spacing');
  const points = samples(RECT.area, 10);
  assert.ok(points.length > 2000);
  const all = e.latticeAssign(geo, plan.relaysNeeded, { x: 0, y: 0 });
  assert.equal(all.length, 12);
  assert.ok(points.every((p) => reachableOver(geo, all, p, geo.spacingM)), 'with every slot held the tip is in reach everywhere');
  assert.ok(points.every((p) => reachableOver(geo, e.latticeAssign(geo, geo.maxDepth, p), p, geo.spacingM)), 'with only as many relays as the deepest route, the rule still holds the route to wherever the tip is');
  assert.deepEqual(e.latticeRoute(geo, e.nearestNode(geo, { x: 800, y: 200 })), [1, 2, 5, 8, 11]);
  assert.deepEqual(e.latticeAssign(geo, 3, { x: 800, y: 200 }), [1, 2, 5], 'too few for the route: its inner slots first');
  assert.deepEqual(e.latticeAssign(geo, 6, { x: 800, y: 200 }), [1, 2, 5, 8, 11, 3], 'the route, then every other slot inner first');
});

test('the tip flies its sweep over a lattice held on station: every metric, no outage', () => {
  const result = run(RECT, { durationS: 600 });
  const m = result.metrics;
  assert.equal(m.verdict, 'held');
  assert.equal(m.tipOutageS, 0);
  assert.equal(m.tipReachableS, 600);
  assert.equal(m.minHopMarginDb, 14.9, 'the routes run slot to slot, one hop each');
  assert.deepEqual([m.sparesLaunched, m.swaps, m.forcedReturns, m.failures, m.longestOutageS, m.tipBufferKB], [0, 0, 0, 0, 0, 0]);
  const tips = result.frames.map((f) => f.drones.find((d) => d.id === 'tip'));
  assert.deepEqual([Math.min(...tips.map((t) => t.x)), Math.max(...tips.map((t) => t.x)), Math.min(...tips.map((t) => t.y)), Math.max(...tips.map((t) => t.y))], [200, 800, -100, 100], 'the tip covered the sweep end to end');
  assert.ok(result.frames.every((f) => f.drones.every((d) => typeof d.x === 'number' && typeof d.y === 'number')));
});

test('a lost relay is routed around with no outage, and one spare restores the lattice; runs are deterministic', () => {
  const result = run(RECT, { durationS: 600, events: [{ atS: 60, kind: 'fail', drone: 'r1' }] });
  const m = result.metrics;
  assert.equal(m.tipOutageS, 0, 'the base still reaches the slots beside the one lost');
  assert.deepEqual(result.events.map((ev) => [ev.atS, ev.kind, ev.drone]), [[60, 'fail', 'r1'], [65.5, 'launch', 's1'], [207.5, 'restored', undefined]]);
  assert.equal(m.verdict, 'restored');
  const last = result.frames[result.frames.length - 1];
  assert.equal(last.drones.filter((d) => d.role === 'relay' && d.state === 'active').length, 12);
  const scenario = { durationS: 300, events: [{ atS: 40, kind: 'fail', drone: 'r5' }, { atS: 100, kind: 'fail', drone: 'r9' }] };
  assert.equal(JSON.stringify(run(RECT, scenario)), JSON.stringify(run(RECT, scenario)));
});

test('a feeder loss no walk-in can close within the RTL window is lost: the lattice holds slots, it does not stretch toward a gap', () => {
  const tight = { area: [{ x: 2500, y: -400 }, { x: 3300, y: -400 }, { x: 3300, y: 400 }, { x: 2500, y: 400 }], requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 12, enduranceS: 1800 };
  const { plan } = sized(tight);
  assert.equal(plan.lattice.feederSlots, 2);
  assert.ok(plan.warnings.some((w) => /no second route/.test(w) && /1432 m gap beyond the 981 m modelled edge/.test(w)));
  const lost = run(tight, { durationS: 600, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] });
  assert.equal(lost.metrics.verdict, 'lost');
  assert.equal(lost.events.find((ev) => ev.kind === 'rtl').drone, 'r3', 'the first slot beyond the cut walked in for its RTL window and went home');
  const near = run(tight, { durationS: 600, events: [{ atS: 60, kind: 'fail', drone: 'r1' }] });
  assert.deepEqual(near.metrics.outages, [{ fromS: 60, toS: 115.5 }], 'losing the first feeder instead, the second walks in before its window closes');
  assert.equal(near.metrics.verdict, 'restored');
});
