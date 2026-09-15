/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The simulation on the numbers a designer reads: a chain on station with no failure holds for the whole run with zero outage; losing a middle relay of a 1 km ESP-NOW chain at the design margin never loses the tip (the 400 m hop stays inside the modelled edge), the tip retreats under `retreat` and holds under `hold-degraded`, a spare launches once the roster goes stale and the chain is restored; a tight-margin chain where one loss opens a gap beyond the edge loses the tip, the tip shifts inward on its own, the controller detects the gap after the staleness window, the chain reconnects and is restored by the spare; a formation built from the base reaches every slot; a short endurance produces proactive swaps with no outage; a scenario that names an unknown drone is refused; the same inputs give the same bytes.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The rotation fleet agrees with the simulation: the default chain on an eight-minute battery with 6 relays forces battery returns over 30 minutes (tip still reachable, hops stretched below the design margin); with the 15 the plan asks for, none; a 900 s battery with 8 holds a full hour with none.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Postures and store-and-forward: six perched relays hold the default chain for thirty minutes with no forced return and no swap where hovering ones force battery returns; a perched relay still shifts inward on its own rule and the spare restores the chain after a loss with the same outage as hover (none); every run reports the longest outage, the buffer a collecting tip needs for it and the seconds the chain's spare capacity takes to drain it — zero for a held run, 19 KB and 1.4 s for the tight chain's 7.5 s.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

function run(specInput, scenarioInput) {
  const spec = e.validateSpec(specInput);
  const plan = e.planChain(spec);
  const scenario = e.validateScenario(scenarioInput, plan);
  return { spec, plan, result: e.simulate(spec, plan, scenario) };
}
const tipS = (frame) => frame.drones.find((d) => d.id === 'tip').s;

test('a chain on station with no failure holds', () => {
  const { result } = run({ fleetSize: 6, enduranceS: 1800 }, { durationS: 120 });
  assert.equal(result.metrics.verdict, 'held');
  assert.equal(result.metrics.tipOutageS, 0);
  assert.equal(result.metrics.tipReachableS, 120);
  assert.equal(result.metrics.sparesLaunched, 0);
  assert.equal(result.frames.length, 121);
  assert.ok(result.frames.every((f) => f.hops.every((h) => h.ok)));
  assert.ok(result.metrics.minHopMarginDb > 10);
});

test('losing a middle relay at the design margin: no outage, the tip retreats, a spare restores the chain', () => {
  const { plan, result } = run({ fleetSize: 6, enduranceS: 1800 }, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] });
  const m = result.metrics;
  assert.equal(m.failures, 1);
  assert.equal(m.tipOutageS, 0, 'a 400 m hop is still inside the modelled edge');
  assert.equal(m.verdict, 'restored');
  assert.equal(m.sparesLaunched, 1);
  const launch = result.events.find((ev) => ev.kind === 'launch');
  assert.ok(launch.atS >= 65 && launch.atS <= 68, `spare launched once the roster went stale — six seconds after the last heartbeat (${launch.atS})`);
  const lowest = Math.min(...result.frames.map(tipS));
  assert.ok(lowest < 950 && lowest > 850, `retreat pulls the tip back until the spare is half a hop out (${lowest})`);
  const noSpare = run({ fleetSize: 4, enduranceS: 1800 }, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] }).result;
  assert.equal(noSpare.metrics.sparesLaunched, 0);
  assert.ok(Math.abs(tipS(noSpare.frames[noSpare.frames.length - 1]) - 800) <= 2, 'with no spare the tip retreats to four design hops and stays');
  assert.equal(noSpare.metrics.tipOutageS, 0);
  assert.equal(noSpare.metrics.verdict, 'degraded');
  const last = result.frames[result.frames.length - 1];
  assert.ok(Math.abs(tipS(last) - 1000) <= 2);
  assert.equal(last.hops.length, 5);
  assert.ok(last.hops.every((h) => h.distanceM <= plan.hopM + 1));
  assert.deepEqual(last.hops.map((h) => h.to), ['s1', 'r1', 'r3', 'r4', 'tip']);
  assert.ok(m.restoredAtS[0] > launch.atS + 25 && m.restoredAtS[0] < launch.atS + 45, `restored ~35 s after the launch (${m.restoredAtS[0]})`);
});

test('under hold-degraded the tip never retreats for the same loss', () => {
  const { result } = run({ fleetSize: 6, enduranceS: 1800, gapPolicy: 'hold-degraded' }, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] });
  assert.equal(result.metrics.tipOutageS, 0);
  assert.ok(Math.min(...result.frames.map(tipS)) > 995);
  assert.equal(result.metrics.verdict, 'restored');
  assert.ok(result.metrics.restoredAtS[0] < 110, `restored sooner without a retreat (${result.metrics.restoredAtS[0]})`);
});

test('a tight-margin chain: one loss is a real gap; the tip shifts in on its own and the spare restores it', () => {
  const { plan, result } = run({ requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 3, enduranceS: 1800 }, { durationS: 400, events: [{ atS: 30, kind: 'fail', drone: 'r1' }] });
  assert.equal(plan.relaysNeeded, 1);
  const m = result.metrics;
  assert.ok(m.tipOutageS > 5 && m.tipOutageS < 60, `outage ${m.tipOutageS}`);
  assert.equal(m.outages.length, 1);
  assert.deepEqual(m.gapDetectedAtS, [36]);
  assert.equal(m.reconnectedAtS.length, 1);
  assert.ok(m.reconnectedAtS[0] > 30 + 4, 'the tip only starts shifting after the detect window');
  assert.ok(result.events.some((ev) => ev.kind === 'tip-lost') && result.events.some((ev) => ev.kind === 'reconnected'));
  assert.equal(m.sparesLaunched, 1);
  assert.equal(m.verdict, 'restored');
  assert.ok(Math.abs(tipS(result.frames[result.frames.length - 1]) - 1000) <= 2);
});

test('a formation built from the base reaches every slot', () => {
  const { plan, result } = run({ fleetSize: 4, enduranceS: 1800 }, { durationS: 400, startDeployed: false });
  const last = result.frames[result.frames.length - 1];
  assert.ok(Math.abs(tipS(last) - 1000) <= 2, `tip at ${tipS(last)}`);
  assert.equal(last.hops.length, 5);
  assert.ok(last.hops.every((h) => h.ok && h.distanceM <= plan.hopM + 1));
  assert.equal(result.metrics.sparesLaunched, 4);
  assert.deepEqual(result.events.filter((ev) => ev.kind === 'launch').map((ev) => ev.atS), [0, 5, 10, 15], 'one launch per interval');
  assert.match(result.events[0].text, /deploy/);
  assert.equal(result.metrics.restoredAtS.length, 1);
  assert.ok(result.metrics.restoredAtS[0] > 150 && result.metrics.restoredAtS[0] < 190, `the last relay reaches 800 m about 165 s in (${result.metrics.restoredAtS[0]})`);
  assert.equal(result.metrics.tipOutageS, 0);
  assert.equal(result.metrics.verdict, 'held');
});

test('a short endurance produces proactive swaps with no outage', () => {
  const { plan, result } = run({ fleetSize: 8, enduranceS: 600, reserveS: 30, turnaroundS: 60 }, { durationS: 1200 });
  assert.equal(plan.onStationS, 303, 'on-station time is endurance minus the round trip to the farthest slot (800 m at 6 m/s) and the reserve');
  const m = result.metrics;
  assert.ok(m.swaps >= 2, `swaps ${m.swaps}`);
  assert.equal(m.tipOutageS, 0);
  assert.equal(m.forcedReturns, 0, 'no relay had to leave before its spare arrived');
  assert.ok(m.landings >= 2);
  assert.ok(result.events.some((ev) => ev.kind === 'ready'), 'landed relays come back as spares after the turnaround');
});

test('below the rotation fleet relays leave on battery; at it they do not', () => {
  const short = run({ fleetSize: 6 }, { durationS: 1800 });
  assert.equal(short.plan.sustainFleet, 15);
  assert.ok(short.result.metrics.forcedReturns > 5, `forced returns ${short.result.metrics.forcedReturns}`);
  assert.equal(short.result.metrics.tipOutageS, 0, 'a stretched 400 m hop is still inside the modelled edge');
  assert.ok(short.result.metrics.minHopMarginDb < 10, `hops stretched below the design margin (${short.result.metrics.minHopMarginDb})`);
  const sustained = run({ fleetSize: 15 }, { durationS: 1800 });
  assert.equal(sustained.result.metrics.forcedReturns, 0);
  assert.ok(sustained.result.metrics.swaps > 20);
  const longer = run({ fleetSize: 8, enduranceS: 900 }, { durationS: 3600 });
  assert.equal(longer.plan.sustainFleet, 8);
  assert.equal(longer.result.metrics.forcedReturns, 0);
});

test('scenario refusals name the field; runs are deterministic', () => {
  const spec = e.validateSpec({ fleetSize: 6 });
  const plan = e.planChain(spec);
  assert.throws(() => e.validateScenario({ events: [{ atS: 1, kind: 'fail', drone: 'r9' }] }, plan), (err) => err.field === 'events[0].drone');
  assert.throws(() => e.validateScenario({ events: [{ atS: 1, kind: 'crash', drone: 'r1' }] }, plan), (err) => err.field === 'events[0].kind');
  assert.throws(() => e.validateScenario({ durationS: 5 }, plan), (err) => err.field === 'durationS');
  assert.throws(() => e.simulate(spec, e.planChain(e.validateSpec({ fleetSize: 1 })), e.validateScenario({}, plan)), (err) => err.field === 'plan');
  assert.deepEqual(e.rosterIds(plan), ['r1', 'r2', 'r3', 'r4', 's1', 's2', 'tip']);
  const scenario = e.validateScenario({ durationS: 200, events: [{ atS: 20, kind: 'fail', drone: 'r3' }] }, plan);
  assert.equal(JSON.stringify(e.simulate(spec, plan, scenario)), JSON.stringify(e.simulate(spec, plan, scenario)));
});

test('perched relays hold for the run on the battery that hovers eight minutes', () => {
  const perched = run({ fleetSize: 6, posture: 'perch' }, { durationS: 1800 });
  assert.equal(perched.plan.onStationS, 4111);
  assert.equal(perched.plan.sustainFleet, 5);
  assert.equal(perched.result.metrics.forcedReturns, 0);
  assert.equal(perched.result.metrics.swaps, 0, 'nobody tires in thirty minutes');
  assert.equal(perched.result.metrics.verdict, 'held');
  const far = perched.result.final.find((d) => d.id === 'r4');
  assert.ok(far.remainingS > 420 && far.remainingS < 430, `a perched relay drains about 3 % of 1800 s (${far.remainingS} s left of 480)`);
  const hover = run({ fleetSize: 6 }, { durationS: 1800 });
  assert.ok(hover.result.metrics.forcedReturns > 5);
});

test('a perched relay still shifts inward on its own rule and the spare restores the chain', () => {
  const { result } = run({ fleetSize: 6, posture: 'perch' }, { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] });
  assert.equal(result.metrics.tipOutageS, 0);
  assert.equal(result.metrics.verdict, 'restored');
  assert.equal(result.metrics.sparesLaunched, 1);
  const tight = run({ requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 3, posture: 'perch' }, { durationS: 400, events: [{ atS: 30, kind: 'fail', drone: 'r1' }] });
  assert.ok(tight.result.metrics.tipOutageS > 5 && tight.result.metrics.tipOutageS < 60);
  assert.equal(tight.result.metrics.reconnectedAtS.length, 1, 'the tip walked in on its own');
  assert.equal(tight.result.metrics.verdict, 'restored');
});

test('store and forward: the longest outage sizes the tip\'s buffer and its drain', () => {
  const held = run({ fleetSize: 6, enduranceS: 1800 }, { durationS: 120 }).result.metrics;
  assert.equal(held.longestOutageS, 0);
  assert.equal(held.tipBufferKB, 0);
  assert.equal(held.drainS, 0);
  const tight = run({ requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 3, enduranceS: 1800 }, { durationS: 400, events: [{ atS: 30, kind: 'fail', drone: 'r1' }] });
  const m = tight.result.metrics;
  assert.equal(m.outages.length, 1);
  assert.equal(m.longestOutageS, m.tipOutageS);
  assert.equal(m.tipBufferKB, Math.round((20 * m.tipOutageS) / 8 * 10) / 10, '20 kbps through the outage');
  assert.equal(tight.plan.endToEndKbps, 125, 'two hops of 250 kbps');
  assert.equal(m.drainS, Math.round((20 * m.tipOutageS) / 105 * 10) / 10, 'drained by the 105 kbps the chain has spare');
  const full = run({ requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 3, enduranceS: 1800, tipDataKbps: 125 }, { durationS: 400, events: [{ atS: 30, kind: 'fail', drone: 'r1' }] });
  assert.equal(full.result.metrics.drainS, null, 'a tip that uses every kbps never drains its buffer');
});
