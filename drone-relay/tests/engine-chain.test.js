/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The chain planner: spec defaults and every refusal naming its field (unknown transport, spacing out of range, degraded margin above the design margin, a base off the origin, a reserve that eats the endurance, return band too close to the relay band); a 1 km ESP-NOW corridor at 0.6 sizing to five 200 m hops, four relays and two spares; infeasibility naming the relay count; a LoRa chain refusing a tip that streams; elastic targets evenly spaced; the tip's reach under both gap policies; the move guard clamping against both neighbours.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The end-to-end latency follows the corrected ESP-NOW per-hop figure (Espressif's measured 20 ms): five hops, 100 ms.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The rotation fleet: per-slot station times, the default chain needing about 15 relays in rotation on an eight-minute battery (warned with 6, silent with 15), 900 s needing 8, and a slot beyond one battery's round trip refusing the plan.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Postures, the control plane and the courier: a perch stretches the far slot's 123 s to 4111 s at a 3 % draw and shrinks the rotation from 15 to 5, states the 1.5 m of antenna height a 200 m hop needs and warns about the ground exponent (at 3 the same corridor needs more than 20 relays); a LoRa control channel reaches the tip direct but five nodes heartbeating every 2 s occupy 82.5 % of it (19 % first-try delivery unscheduled) and every 10 s 16.5 %; BLE as a control channel does not reach; a 100 MB courier over ESP-NOW cannot make the trip on eight minutes and over Wi-Fi Direct on fifteen amounts to about 1.3 Mbps; refusals name posture, perchDrawFraction, controlChannel (unknown, or the chain's own radio) and courierTransport.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const refuses = (input, field) => {
  try { e.validateSpec(input); } catch (err) { assert.equal(err.name, 'SpecError'); assert.equal(err.field, field, err.message); return err; }
  assert.fail(`expected a refusal naming ${field}`);
};

test('a spec takes defaults and refuses naming the field', () => {
  const spec = e.validateSpec({});
  assert.equal(spec.transport, 'esp-now');
  assert.equal(spec.spacingFactor, 0.6);
  assert.equal(spec.requiredMarginDb, 10);
  assert.equal(spec.degradedMarginDb, 5);
  assert.equal(spec.fleetSize, 6);
  assert.equal(spec.gapPolicy, 'retreat');
  assert.deepEqual(spec.path, [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }]);
  assert.deepEqual(spec.altitudes, { relayM: 40, tipM: 30, returnM: 50 });
  refuses({ transport: 'pigeon' }, 'transport');
  refuses({ spacingFactor: 0.1 }, 'spacingFactor');
  refuses({ requiredMarginDb: 6, degradedMarginDb: 8 }, 'degradedMarginDb');
  refuses({ path: [{ x: 5, y: 0 }, { x: 100, y: 0 }] }, 'path[0]');
  refuses({ path: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }] }, 'path[1]');
  refuses({ path: [{ x: 0, y: 0 }] }, 'path');
  refuses({ enduranceS: 300, reserveS: 300 }, 'reserveS');
  refuses({ detectS: 60, rtlAfterS: 60 }, 'rtlAfterS');
  refuses({ altitudes: { relayM: 40, returnM: 45 } }, 'altitudes.returnM');
  refuses({ gapPolicy: 'panic' }, 'gapPolicy');
  refuses({ fleetSize: 'many' }, 'fleetSize');
});

test('a 1 km ESP-NOW corridor at 0.6 spacing needs four relays and leaves two spares', () => {
  const spec = e.validateSpec({ fleetSize: 6 });
  const plan = e.planChain(spec);
  assert.equal(plan.transport.id, 'esp-now');
  assert.ok(plan.designRangeM > 330 && plan.designRangeM < 360, `design ${plan.designRangeM}`);
  assert.equal(plan.hops, 5);
  assert.equal(plan.relaysNeeded, 4);
  assert.equal(plan.sparesAvailable, 2);
  assert.equal(plan.hopM, 200);
  assert.deepEqual(plan.slots.map((s) => s.s), [200, 400, 600, 800]);
  assert.deepEqual(plan.slots[0].pt, { x: 200, y: 0, z: 40 });
  assert.deepEqual(plan.tip, { index: 5, s: 1000, pt: { x: 1000, y: 0, z: 30 } });
  assert.ok(plan.perHopMarginDb > 10, 'the actual hop is shorter than the design hop, so the margin is above the requirement');
  assert.equal(plan.feasible, true);
  assert.equal(plan.throughputOk, true);
  assert.equal(plan.endToEndKbps, 50);
  assert.equal(plan.endToEndLatencyMs, 100, 'five hops at the 20 ms Espressif measured per ESP-NOW hop');
  assert.ok(plan.hardRangeM > 2 * plan.hopM, 'one loss stays inside the modelled edge at these numbers');
  assert.ok(!plan.warnings.some((w) => /disconnects/.test(w)));
});

test('the rotation fleet: relays needed to hold every slot through battery swaps', () => {
  const spec = e.validateSpec({ fleetSize: 6 });
  const plan = e.planChain(spec);
  assert.equal(plan.onStationS, 123, '480 s less 2 × 800 m at 6 m/s less the 90 s reserve');
  assert.deepEqual(plan.slots.map((s) => Math.round(e.stationTimeS(spec, s.s))), [323, 257, 190, 123]);
  assert.equal(plan.sustainFleet, 15, 'Σ (480 + 240) / station time over the four slots = 14.7');
  assert.ok(plan.warnings.some((w) => /about 15 relays in rotation/.test(w) && /with 6/.test(w)));
  const enough = e.planChain(e.validateSpec({ fleetSize: 15 }));
  assert.ok(!enough.warnings.some((w) => /rotation/.test(w)));
  const longer = e.planChain(e.validateSpec({ fleetSize: 8, enduranceS: 900 }));
  assert.equal(longer.sustainFleet, 8);
  assert.ok(!longer.warnings.some((w) => /rotation/.test(w)));
  const tooFar = e.planChain(e.validateSpec({ fleetSize: 8, enduranceS: 300, reserveS: 60 }));
  assert.equal(tooFar.feasible, false);
  assert.match(tooFar.reasons.join(' '), /cannot fly out, hold and fly home/);
});

test('infeasible plans say why, and a tight margin makes one loss a real gap', () => {
  const small = e.planChain(e.validateSpec({ fleetSize: 2 }));
  assert.equal(small.feasible, false);
  assert.match(small.reasons[0], /needs 4 relays .* fleet has 2/);
  const noSpare = e.planChain(e.validateSpec({ fleetSize: 4 }));
  assert.equal(noSpare.feasible, true);
  assert.ok(noSpare.warnings.some((w) => /no spare/.test(w)));
  const stream = e.planChain(e.validateSpec({ transport: 'lora-915', tipDataKbps: 100, fleetSize: 1 }));
  assert.equal(stream.feasible, false);
  assert.match(stream.reasons.join(' '), /needs 100 kbps/);
  const tight = e.planChain(e.validateSpec({ requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 3 }));
  assert.ok(2 * tight.hopM > tight.hardRangeM, `hop ${tight.hopM} hard ${tight.hardRangeM}`);
  assert.ok(tight.warnings.some((w) => /disconnects/.test(w)));
  assert.equal(tight.relaysNeeded, 1);
  const bent = e.planChain(e.validateSpec({ path: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }], fleetSize: 6 }));
  assert.equal(bent.pathLengthM, 700);
  assert.equal(bent.hops, 4);
  assert.deepEqual(bent.slots[1].pt, { x: 300, y: 50, z: 40 }, 'a slot past the corner lies on the second leg');
});

test('elastic targets, the tip reach and the move guard', () => {
  assert.deepEqual(e.elasticTargets(1000, 4), [200, 400, 600, 800]);
  assert.deepEqual(e.elasticTargets(825, 3).map(Math.round), [206, 413, 619]);
  assert.deepEqual(e.spread(667, 1), [667]);
  assert.deepEqual(e.spread(600, 3), [200, 400, 600]);
  assert.deepEqual(e.elasticTargets(500, 0), []);
  const spec = e.validateSpec({ fleetSize: 6 });
  const plan = e.planChain(spec);
  assert.equal(e.allowedTipS(spec, plan, 4), 1000);
  assert.equal(e.allowedTipS(spec, plan, 3), 800, 'retreat: three relays hold four design hops of the ACTUAL 200 m hop');
  const held = e.validateSpec({ fleetSize: 6, gapPolicy: 'hold-degraded' });
  assert.equal(e.allowedTipS(held, e.planChain(held), 3), 1000);
  assert.equal(e.allowedTipS(held, e.planChain(held), 0), Math.min(1000, e.planChain(held).degradedRangeM));
  assert.equal(e.guardMove(900, 100, null, 500), 600, 'outward capped by the inner link');
  assert.equal(e.guardMove(100, 0, 700, 500), 200, 'inward capped by the outer link');
  assert.equal(e.guardMove(-50, 0, null, 500), 0);
  assert.equal(e.guardMove(300, 100, 700, 500), 300);
  assert.equal(e.hopMarginDb(spec, plan, plan.hopM) > e.hopMarginDb(spec, plan, 2 * plan.hopM), true);
});

test('postures: a perch stretches the station time by the draw fraction and states the antenna height it needs', () => {
  const hover = e.planChain(e.validateSpec({ fleetSize: 6 }));
  assert.equal(hover.perchAntennaHeightM, 0);
  assert.equal(hover.control, null);
  assert.equal(hover.courier, null);
  const perch = e.planChain(e.validateSpec({ fleetSize: 6, posture: 'perch' }));
  assert.equal(perch.onStationS, 4111, '123.3 s of flight budget at the far slot over a 3 % draw');
  assert.equal(perch.sustainFleet, 5, 'about one relay per slot plus one in rotation');
  assert.equal(perch.hopM, 200, 'the hop is the same: a perch changes the battery, not the radio');
  assert.equal(perch.perchAntennaHeightM, 1.5, '60 % of the first Fresnel zone at a 200 m hop, 2.4 GHz');
  assert.ok(perch.warnings.some((w) => /1\.5 m at every perch/.test(w) && /pathLossExponent 3/.test(w) && /73 m/.test(w)), perch.warnings.join(' | '));
  assert.ok(!perch.warnings.some((w) => /rotation/.test(w)), 'six relays sustain a perched chain');
  const ground = e.planChain(e.validateSpec({ fleetSize: 30, posture: 'perch', pathLossExponent: 3 }));
  assert.ok(ground.hopM < 50 && ground.relaysNeeded > 20, `ground-level perches: ${ground.relaysNeeded} relays at ${ground.hopM} m`);
  assert.ok(!ground.warnings.some((w) => /Fresnel/.test(w)), 'planned on the ground exponent, no clearance warning');
  refuses({ posture: 'sit' }, 'posture');
  refuses({ perchDrawFraction: 0.9 }, 'perchDrawFraction');
});

test('an out-of-band control channel: direct reach and the air time the heartbeat cadence costs', () => {
  const lora = e.planChain(e.validateSpec({ fleetSize: 6, controlChannel: 'lora-915' }));
  const c = lora.control;
  assert.equal(c.transport, 'lora-915');
  assert.equal(c.reachesTipDirect, true);
  assert.equal(c.nodesOnAir, 5, 'four relays and the tip');
  assert.equal(c.frameS, 0.33, 'the catalog\'s 50-byte time on air');
  assert.equal(c.dutyPct, 82.5, '5 × 0.33 s every 2 s');
  assert.equal(c.alohaDeliveryPct, 19.2);
  assert.equal(c.ok, false);
  assert.ok(lora.warnings.some((w) => /occupy 82\.5 %/.test(w) && /lengthen heartbeatS/.test(w)));
  const slower = e.planChain(e.validateSpec({ fleetSize: 6, controlChannel: 'lora-915', heartbeatS: 10 })).control;
  assert.equal(slower.dutyPct, 16.5);
  assert.equal(slower.alohaDeliveryPct, 71.9);
  assert.equal(slower.ok, true);
  const ble = e.planChain(e.validateSpec({ fleetSize: 6, controlChannel: 'ble-coded' }));
  assert.equal(ble.control.reachesTipDirect, false);
  assert.ok(ble.control.directRangeM < 300, `BLE keeps 10 dB only to ${ble.control.directRangeM} m`);
  assert.ok(ble.warnings.some((w) => /control channel keeps 10 dB only to/.test(w)));
  refuses({ controlChannel: 'esp-now' }, 'controlChannel');
  refuses({ controlChannel: 'smoke' }, 'controlChannel');
  assert.deepEqual(e.controlChannelIds().slice(0, 2), ['in-band', 'esp-now']);
});

test('a courier: load time, trip time and the rate the trips amount to', () => {
  const slow = e.planChain(e.validateSpec({ fleetSize: 6, courierMB: 100 }));
  assert.equal(slow.courier.transport, 'esp-now');
  assert.equal(slow.courier.loadS, 3200, '100 MB at 250 kbps');
  assert.equal(slow.courier.feasible, false, '333 s of flight plus 96 s of landed load plus the reserve exceed 480 s');
  assert.ok(slow.warnings.some((w) => /courier cannot fly 1000 m out/.test(w)));
  const fast = e.planChain(e.validateSpec({ fleetSize: 6, courierMB: 100, courierTransport: 'wifi-direct', enduranceS: 900 }));
  assert.equal(fast.courier.loadS, 40);
  assert.equal(fast.courier.tripS, 613, 'out, load, home, turnaround');
  assert.equal(fast.courier.feasible, true);
  assert.equal(fast.courier.equivalentKbps, 1304.3, 'more than twenty times the chain\'s 50 kbps');
  assert.equal(fast.courier.mbPerHour, 587);
  assert.ok(!fast.warnings.some((w) => /courier/.test(w)));
  const pointless = e.planChain(e.validateSpec({ fleetSize: 6, courierMB: 1, enduranceS: 900 }));
  assert.ok(pointless.warnings.some((w) => /no more than the chain's own/.test(w)));
  refuses({ courierTransport: 'pigeon' }, 'courierTransport');
});
