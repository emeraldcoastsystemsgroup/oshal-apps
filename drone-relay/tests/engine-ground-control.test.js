/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Ground nodes (backlog B7) and the control plane inside the simulation (B8): a spec takes ground nodes as slot positions and refuses a list that is not one, a position on the base or past the work point, more than the limit, a gap of less than a metre and a hole in the list; the plan spreads the MOBILE relays over what is left and counts and rotates only those; the elastic rule distributes around the fixed anchors and, with none, returns the even spread position for position; a ground node holds its slot for the whole run on no battery, is never launched, swapped or flown home, can be failed by an event, and the mobile relays close a gap on either side of it; a control channel that reaches the tip detects a loss at the heartbeat instead of the staleness window and commands the outer segment to the meeting point, cutting the tight chain's reconnect by 7.0 s; a channel that stops short, and a chain with no ground node, run the 0.2.0 bytes exactly.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

/** The tight-margin chain the 0.2.0 suite already uses: one loss opens a gap beyond the modelled edge. */
const TIGHT = { requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 3, enduranceS: 1800 };
const TIGHT_SCENARIO = { durationS: 400, events: [{ atS: 30, kind: 'fail', drone: 'r1' }] };

/** The metrics the 0.2.0 engine produced for that run, recorded before the control plane existed. */
const GOLDEN_IN_BAND = '{"durationS":400,"tipReachableS":392.5,"tipOutageS":7.5,"outages":[{"fromS":30,"toS":37.5}],"gapDetectedAtS":[36],"reconnectedAtS":[37.5],"restoredAtS":[120],"minHopMarginDb":0,"sparesLaunched":1,"swaps":0,"forcedReturns":0,"landings":0,"failures":1,"longestOutageS":7.5,"tipBufferKB":18.8,"drainS":1.4,"verdict":"restored"}';

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

test('ground nodes cut the corridor into segments the mobile relays fill', () => {
  const { plan } = run({ groundNodes: [400], fleetSize: 6, enduranceS: 1800 }, { durationS: 10 });
  assert.deepEqual(plan.slots.map((s) => s.s), [200, 400, 600, 800]);
  assert.deepEqual(plan.slots.map((s) => s.ground === true), [false, true, false, false]);
  assert.deepEqual(plan.groundNodes, [400]);
  assert.deepEqual(plan.mobileSlots.map((s) => s.s), [200, 600, 800]);
  assert.equal(plan.relaysNeeded, 3, 'the ground node holds the fourth slot, so the fleet flies three');
  assert.equal(plan.sparesAvailable, 3);
  assert.equal(plan.hops, 5, 'the ground node still relays: five hops of 200 m');
  assert.equal(plan.hopM, 200);
  assert.equal(plan.endToEndKbps, 50, 'a ground node costs the shared channel a hop like any other relay');
  const base = run({ fleetSize: 6, enduranceS: 1800 }, { durationS: 10 }).plan;
  assert.equal(base.relaysNeeded, 4);
  assert.equal(plan.sustainFleet, 5, 'the rotation counts the mobile relays alone');
  assert.equal(base.sustainFleet, 6, 'without the ground node the same chain needs one more in rotation');
});

test('an uneven corridor gives its relays to the stretch with the longest hop', () => {
  assert.deepEqual(e.elasticTargetsAround(1000, 2, [400]), [200, 700], 'the 600 m stretch takes the first relay, the 400 m one the second');
  assert.deepEqual(e.spreadAround(800, 3, [400]), [200, 600, 800], 'the outermost lands on the meeting point; the rest straddle the ground node');
  const { plan } = run({ groundNodes: [150], fleetSize: 8, enduranceS: 1800 }, { durationS: 10 });
  assert.deepEqual(plan.slots.map((s) => Math.round(s.s)), [150, 320, 490, 660, 830], 'the 150 m stretch to the ground node needs no relay of its own; the 850 m beyond it takes five 170 m hops');
  assert.equal(plan.relaysNeeded, 4);
  assert.equal(plan.hopM, 170);
});

test('with no ground node the elastic rule is the even spread it always was', () => {
  assert.deepEqual(e.elasticTargetsAround(1000, 4, []), e.elasticTargets(1000, 4));
  assert.deepEqual(e.elasticTargetsAround(743.5, 3, []), e.elasticTargets(743.5, 3));
  assert.deepEqual(e.spreadAround(800, 3, []), e.spread(800, 3));
  assert.deepEqual(e.spreadAround(0, 0, []), e.spread(0, 0));
});

test('ground-node refusals name their field', () => {
  refused('groundNodes', { groundNodes: 400 });
  refused('groundNodes', { groundNodes: 'ten' });
  refused('groundNodes', { groundNodes: new Array(17).fill(0).map((_, i) => 50 + i * 50) });
  refused('groundNodes[0]', { groundNodes: [0] });
  refused('groundNodes[0]', { groundNodes: [1000] });
  refused('groundNodes[0]', { groundNodes: [1200] });
  refused('groundNodes[0]', { groundNodes: [null] });
  refused('groundNodes[1]', { groundNodes: [400, 400.5] });
  assert.deepEqual(e.validateSpec({ groundNodes: [600, 200] }).groundNodes, [200, 600], 'a list out of order is sorted, not refused');
  assert.deepEqual(e.validateSpec({}).groundNodes, [], 'a chain with no ground node is the default');
});

test('a ground node holds its slot on no battery and is never launched, swapped or flown home', () => {
  const { result } = run({ groundNodes: [400], fleetSize: 6, enduranceS: 1800 }, { durationS: 300 });
  const m = result.metrics;
  assert.equal(m.verdict, 'held');
  assert.equal(m.tipOutageS, 0);
  assert.equal(m.sparesLaunched, 0);
  assert.equal(m.forcedReturns, 0);
  assert.equal(m.landings, 0);
  const g1 = result.final.find((d) => d.id === 'g1');
  assert.equal(g1.role, 'ground');
  assert.equal(g1.state, 'active');
  assert.equal(g1.s, 400, 'it never moved');
  assert.equal(g1.remainingS, 0, 'it has no flight budget at all — and that never made it fly home');
  assert.ok(result.frames.every((f) => at(f, 'g1').s === 400 && at(f, 'g1').state === 'active'));
  assert.ok(result.events.every((ev) => ev.drone !== 'g1'), 'nothing in the timeline happens to it');
});

test('losing a mobile relay beside a ground node: the mobile ones close the gap around it', () => {
  const { plan, result } = run({ groundNodes: [400], fleetSize: 6, enduranceS: 1800 }, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] });
  const m = result.metrics;
  assert.equal(m.failures, 1);
  assert.equal(m.tipOutageS, 0);
  assert.equal(m.sparesLaunched, 1);
  assert.equal(m.verdict, 'restored');
  assert.ok(m.restoredAtS[0] > 100 && m.restoredAtS[0] < 180, `restored while the ground node sat still (${m.restoredAtS[0]})`);
  const last = lastFrame(result);
  assert.equal(at(last, 'g1').s, 400, 'the ground node is where it was placed');
  assert.deepEqual(last.hops.map((h) => h.to), ['s1', 'g1', 'r1', 'r3', 'tip']);
  assert.ok(last.hops.every((h) => h.distanceM <= plan.hopM + 1), 'every hop back at the design spacing');
  assert.ok(Math.abs(at(last, 'tip').s - 1000) <= 2);
  assert.equal(at(last, 'r1').s, 600, 'the inner mobile relay moved OUT past the ground node to take the lost slot');
});

test('a ground node can be failed by an event, and then it anchors nothing', () => {
  const { result } = run({ groundNodes: [400], fleetSize: 6, enduranceS: 1800 }, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'g1' }] });
  const last = lastFrame(result);
  assert.equal(result.metrics.failures, 1);
  assert.equal(at(last, 'g1').state, 'failed');
  assert.equal(result.metrics.tipOutageS, 0, 'a 400 m hop is still inside the modelled edge while the relays redistribute');
  assert.deepEqual(last.hops.map((h) => h.distanceM), [200, 200, 200, 200], 'the three mobile relays spread evenly over the whole corridor again');
  assert.ok(Math.abs(at(last, 'tip').s - 800) <= 2, 'nothing replaces a ground node: the tip holds one hop short');
  assert.equal(result.metrics.verdict, 'degraded');
});

test('a control channel that reaches the tip knows the loss a heartbeat later and commands the meeting point', () => {
  const inBand = run(TIGHT, TIGHT_SCENARIO).result.metrics;
  const { plan, result } = run({ ...TIGHT, controlChannel: 'lora-915' }, TIGHT_SCENARIO);
  assert.equal(plan.control.reachesTipDirect, true);
  const m = result.metrics;
  assert.equal(inBand.reconnectedAtS[0] - m.reconnectedAtS[0], 7, 'the commanded segment closes the gap 7.0 s sooner than one walking in blind');
  assert.equal(m.reconnectedAtS[0], 30.5);
  assert.equal(m.tipOutageS, 0.5);
  assert.equal(inBand.tipOutageS, 7.5);
  assert.deepEqual(m.gapDetectedAtS, [], 'the gap closed inside the 2 s heartbeat window, so it never had to be declared');
  assert.deepEqual(inBand.gapDetectedAtS, [36], 'in band the same gap is declared only after the 6 s staleness window');
  assert.equal(m.verdict, 'restored');
  assert.ok(m.tipBufferKB < inBand.tipBufferKB, 'a shorter outage is a smaller buffer at the tip');
  const launch = result.events.find((ev) => ev.kind === 'launch');
  assert.ok(launch.atS <= 32, `the replacement launches one heartbeat after the loss, not one staleness window (${launch.atS})`);
});

test('a control channel that stops short of the tip changes nothing', () => {
  const short = run({ ...TIGHT, controlChannel: 'wifi-direct' }, TIGHT_SCENARIO);
  assert.equal(short.plan.control.reachesTipDirect, false, 'Wi-Fi Direct reaches 184 m of a 1 km corridor');
  assert.equal(JSON.stringify(short.result.metrics), GOLDEN_IN_BAND, 'those heartbeats ride the chain again: the in-band run exactly');
});

test('the in-band run is byte for byte the one 0.2.0 produced', () => {
  assert.equal(JSON.stringify(run(TIGHT, TIGHT_SCENARIO).result.metrics), GOLDEN_IN_BAND);
  const held = run({ fleetSize: 6, enduranceS: 1800 }, { durationS: 120 }).result.metrics;
  assert.equal(JSON.stringify(held), '{"durationS":120,"tipReachableS":120,"tipOutageS":0,"outages":[],"gapDetectedAtS":[],"reconnectedAtS":[],"restoredAtS":[],"minHopMarginDb":15.2,"sparesLaunched":0,"swaps":0,"forcedReturns":0,"landings":0,"failures":0,"longestOutageS":0,"tipBufferKB":0,"drainS":0,"verdict":"held"}');
});

test('a chain with ground nodes and a control channel is still the same run twice', () => {
  const spec = { groundNodes: [300, 700], controlChannel: 'lora-915', fleetSize: 6, enduranceS: 1800 };
  const scenario = { durationS: 240, events: [{ atS: 40, kind: 'fail', drone: 'r1' }, { atS: 120, kind: 'fail', drone: 'g2' }] };
  const a = run(spec, scenario).result;
  const b = run(spec, scenario).result;
  assert.equal(JSON.stringify(a.metrics), JSON.stringify(b.metrics));
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.equal(JSON.stringify(a.frames), JSON.stringify(b.frames));
  assert.deepEqual(e.rosterIds(run(spec, scenario).plan), ['r1', 'r2', 'r3', 'g1', 'g2', 's1', 's2', 's3', 'tip']);
});
