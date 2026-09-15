/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the circuit contract under plain node: every
 *                     |                             | part type normalises with its defaults, ranges and enum
 *                     |                             | values are enforced with the field named, unknown
 *                     |                             | properties are refused (a typo must never be a silent
 *                     |                             | no-op), wires must join pins of one kind, a circuit
 *                     |                             | refuses duplicate ids (case-insensitively), duplicate
 *                     |                             | wires and the caps, the transient settings are bounded,
 *                     |                             | the Node library equals the library the Python worker
 *                     |                             | prints, and the Node and Python engine build hashes agree.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | firmware/cosim.py is part of the engine build hash.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A wire's route is {mid} or {points} (1 to maxRoutePoints bends):
 *                     |                             | both accepted, every malformed shape refused naming the field.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The solver knobs (sim.reltol, sim.gmin, sim.method) are kept when
 *                     |                             | set, absent when null, bounded naming the field, and published
 *                     |                             | with the lab's defaults and the two methods.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const c = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));
const { engineBuildHash, RUNTIME_FILES } = require(path.resolve(__dirname, '..', 'routes', 'engine-build-hash.js'));
const ENGINE_DIR = path.resolve(__dirname, '..', 'engine');
const TYPES = ['ground', 'junction', 'battery', 'source', 'resistor', 'potentiometer', 'capacitor', 'inductor', 'diode', 'led', 'switch', 'npn', 'nmos', 'motor', 'gear', 'load', 'zener', 'lamp', 'regulator', 'opamp', 'relay', 'sequencer', 'hbridge', 'timer555', 'servo', 'stepper', 'stepdriver', 'spring', 'pulley', 'crank', 'arduino'];

function python(args, env) {
  for (const bin of ['python3', 'python']) {
    const run = spawnSync(bin, args, { encoding: 'utf8', env: { ...process.env, ...env } });
    if (!run.error && run.status === 0) return run.stdout.trim();
  }
  return null;
}

test('the contract names exactly the engine\'s part types, each with typed pins and properties', () => {
  assert.deepEqual([...c.PART_TYPES], TYPES);
  const published = c.describeContract();
  assert.deepEqual(Object.keys(published.parts), TYPES);
  for (const [type, spec] of Object.entries(published.parts)) {
    assert.ok(['electrical', 'electromechanical', 'mechanical'].includes(spec.category), type);
    for (const pin of spec.pins) assert.ok(['electrical', 'shaft', 'teeth', 'belt'].includes(pin.kind), `${type}.${pin.name}`);
    for (const [name, prop] of Object.entries(spec.props)) assert.ok(['number', 'enum', 'boolean', 'text'].includes(prop.type), `${type}.${name}`);
  }
  assert.equal(c.pinKind('motor', 'shaft'), 'shaft'); assert.equal(c.pinKind('gear', 'teeth'), 'teeth'); assert.equal(c.pinKind('led', 'k'), 'electrical'); assert.equal(c.pinKind('led', 'x'), null);
  assert.ok(published.rules.length >= 5);
});

test('every part type normalises with defaults and refuses a bad value naming the field', () => {
  for (const type of TYPES) {
    const part = c.validatePart({ id: 'X1', type });
    assert.equal(part.type, type); assert.equal(part.rotation, 0); assert.equal(part.x, 0);
    for (const [key, spec] of Object.entries(c.PART_LIBRARY[type].props)) assert.equal(part.props[key], spec.default, `${type}.${key}`);
  }
  assert.equal(c.validatePart({ id: 'M1', type: 'motor', props: { noLoadRpm: 5000 } }).props.noLoadRpm, 5000);
  assert.equal(c.validatePart({ id: 'S1', type: 'switch', props: { toggleAtSeconds: null } }).props.toggleAtSeconds, null);
  assert.equal(c.validatePart({ id: 'Q1', type: 'sequencer', props: { pattern: '1:0.25 0:0.25 0.5:1' } }).props.pattern, '1:0.25 0:0.25 0.5:1');
  assert.deepEqual(c.parseSequence('1:0.25 0:0.25'), [[1, 0.25], [0, 0.25]]);
  const bad = [
    [{ id: 'X1', type: 'flux' }, 'part.type'],
    [{ id: '1R', type: 'resistor' }, 'part.id'],
    [{ id: 'R1', type: 'resistor', props: { ohm: 5 } }, 'part.props.ohm'],
    [{ id: 'R1', type: 'resistor', props: { ohms: 0 } }, 'part.props.ohms'],
    [{ id: 'R1', type: 'resistor', props: { ohms: 'ten' } }, 'part.props.ohms'],
    [{ id: 'D1', type: 'led', props: { color: 'pink' } }, 'part.props.color'],
    [{ id: 'S1', type: 'switch', props: { closed: 'yes' } }, 'part.props.closed'],
    [{ id: 'B1', type: 'battery', props: { volts: null } }, 'part.props.volts'],
    [{ id: 'R1', type: 'resistor', rotation: 45 }, 'part.rotation'],
    [{ id: 'R1', type: 'resistor', x: 'left' }, 'part.x'],
    [{ id: 'Q1', type: 'sequencer', props: { pattern: 'high 0.5' } }, 'part.props.pattern'],
    [{ id: 'Q1', type: 'sequencer', props: { pattern: '1:0 0:1' } }, 'part.props.pattern'],
    [{ id: 'Q1', type: 'sequencer', props: { pattern: Array.from({ length: 65 }, () => '1:1').join(' ') } }, 'part.props.pattern'],
    ['not an object', 'part'],
  ];
  for (const [input, field] of bad) assert.throws(() => c.validatePart(input), (err) => err instanceof c.ContractError && err.field === field, `expected ${field} for ${JSON.stringify(input)}`);
  assert.equal(c.validatePart({ type: 'resistor' }, 'part', 'R9').id, 'R9', 'the fallback id is used on update');
});

test('wires join pins of one kind; a circuit refuses duplicates and the caps', () => {
  const parts = [c.validatePart({ id: 'B1', type: 'battery' }), c.validatePart({ id: 'M1', type: 'motor' }), c.validatePart({ id: 'G1', type: 'gear' }), c.validatePart({ id: 'G2', type: 'gear' })];
  const ok = c.validateWire({ id: 'w1', from: { part: 'B1', pin: '+' }, to: { part: 'M1', pin: '+' } }, parts);
  assert.equal(ok.kind, 'electrical');
  assert.equal(c.validateWire({ id: 's1', from: { part: 'M1', pin: 'shaft' }, to: { part: 'G1', pin: 'shaft' } }, parts).kind, 'shaft');
  assert.equal(c.validateWire({ id: 'm1', from: { part: 'G1', pin: 'teeth' }, to: { part: 'G2', pin: 'teeth' } }, parts).kind, 'teeth');
  const bad = [
    [{ id: 'w', from: { part: 'B1', pin: '+' }, to: { part: 'G1', pin: 'shaft' } }, 'wire'],
    [{ id: 'w', from: { part: 'B1', pin: '+' }, to: { part: 'B1', pin: '+' } }, 'wire'],
    [{ id: 'w', from: { part: 'B1', pin: 'q' }, to: { part: 'M1', pin: '+' } }, 'wire.from.pin'],
    [{ id: 'w', from: { part: 'B1', pin: '+' }, to: { part: 'Z9', pin: '+' } }, 'wire.to.part'],
    [{ id: '9', from: { part: 'B1', pin: '+' }, to: { part: 'M1', pin: '+' } }, 'wire.id'],
  ];
  for (const [input, field] of bad) assert.throws(() => c.validateWire(input, parts), (err) => err instanceof c.ContractError && err.field === field, field);
  const circuit = c.validateCircuit({ parts: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }], wires: [{ id: 'w1', from: { part: 'R1', pin: 'a' }, to: { part: 'R2', pin: 'a' } }] });
  assert.equal(circuit.wires[0].kind, 'electrical');
  assert.throws(() => c.validateCircuit({ parts: [{ id: 'R1', type: 'resistor' }, { id: 'r1', type: 'resistor' }] }), (err) => err.field === 'parts[1].id');
  assert.throws(() => c.validateCircuit({ parts: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }], wires: [{ id: 'w1', from: { part: 'R1', pin: 'a' }, to: { part: 'R2', pin: 'a' } }, { id: 'w2', from: { part: 'R2', pin: 'a' }, to: { part: 'R1', pin: 'a' } }] }), (err) => err.field === 'wires[1]');
  assert.throws(() => c.validateCircuit({ parts: Array.from({ length: 201 }, (_, i) => ({ id: 'R' + i, type: 'resistor' })) }), /at most 200/);
  assert.throws(() => c.validateCircuit({ parts: {} }), /must be a list/);
});

test('a wire route is a middle segment or up to maxRoutePoints bend points; a malformed one is refused naming the field', () => {
  const parts = [c.validatePart({ id: 'R1', type: 'resistor' }), c.validatePart({ id: 'R2', type: 'resistor' })];
  const wire = (route) => ({ id: 'w1', from: { part: 'R1', pin: 'b' }, to: { part: 'R2', pin: 'a' }, route });
  assert.equal(c.LIMITS.maxRoutePoints, 16); assert.equal(c.describeContract().limits.maxRoutePoints, 16);
  assert.deepEqual(c.validateWire(wire({ mid: 140 }), parts).route, { mid: 140 });
  assert.deepEqual(c.validateWire(wire({ points: [[120, 240], [200, 240], [200, 100]] }), parts).route, { points: [[120, 240], [200, 240], [200, 100]] });
  assert.equal(c.validateWire(wire(null), parts).route, undefined, 'no route is the automatic path');
  const refused = [
    [{ mid: 'left' }, 'wire.route.mid'],
    [{}, 'wire.route.mid'],
    [{ mid: 140, points: [[1, 2]] }, 'wire.route'],
    [{ points: [] }, 'wire.route.points'],
    [{ points: 'up' }, 'wire.route.points'],
    [{ points: Array.from({ length: 17 }, (_, i) => [i * 20, 40]) }, 'wire.route.points'],
    [{ points: [[1, 2], [3]] }, 'wire.route.points[1]'],
    [{ points: [[1, 2], [3, 'x']] }, 'wire.route.points[1]'],
    [{ points: [[1, 2], [3, Infinity]] }, 'wire.route.points[1]'],
  ];
  for (const [route, field] of refused) assert.throws(() => c.validateWire(wire(route), parts), (err) => err instanceof c.ContractError && err.field === field, `${JSON.stringify(route)} -> ${field}`);
  assert.equal(c.validateCircuit({ parts: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }], wires: [wire({ points: [[1, 2]] })] }).wires[0].route.points.length, 1);
});

test('the transient settings are bounded and the point cap is enforced', () => {
  assert.deepEqual(c.validateSim({}), { stopSeconds: 1, stepSeconds: null, startFromRest: true });
  assert.deepEqual(c.validateSim({ stopSeconds: 0.5, stepSeconds: 0.0005, startFromRest: false }), { stopSeconds: 0.5, stepSeconds: 0.0005, startFromRest: false });
  assert.throws(() => c.validateSim({ stopSeconds: 0 }), (err) => err.field === 'sim.stopSeconds');
  assert.throws(() => c.validateSim({ stopSeconds: 10, stepSeconds: 1e-6 }), /at most 20000/);
  assert.throws(() => c.validateSim({ startFromRest: 'no' }), (err) => err.field === 'sim.startFromRest');
});

test('the solver knobs are kept when set, absent when null, bounded naming the field, and published with the defaults', () => {
  assert.deepEqual(c.validateSim({ reltol: 0.01, gmin: 1e-9, method: 'gear' }), { stopSeconds: 1, stepSeconds: null, startFromRest: true, reltol: 0.01, gmin: 1e-9, method: 'gear' });
  assert.deepEqual(c.validateSim({ reltol: null, gmin: null, method: null }), { stopSeconds: 1, stepSeconds: null, startFromRest: true }, 'null is the lab default');
  for (const [sim, field] of [[{ reltol: 1 }, 'sim.reltol'], [{ reltol: 0 }, 'sim.reltol'], [{ gmin: 1e-3 }, 'sim.gmin'], [{ gmin: 'small' }, 'sim.gmin'], [{ method: 'euler' }, 'sim.method'], [{ method: 1 }, 'sim.method']]) {
    assert.throws(() => c.validateSim(sim), (err) => err instanceof c.ContractError && err.field === field, `${JSON.stringify(sim)} -> ${field}`);
  }
  const published = c.describeContract().sim;
  assert.deepEqual(published.methods, ['trap', 'gear']);
  assert.deepEqual([published.defaults.reltol, published.defaults.gmin, published.defaults.method], [0.003, 1e-12, 'trap']);
  assert.deepEqual([published.limits.reltol, published.limits.gmin], [[1e-6, 0.05], [1e-15, 1e-6]]);
});

test('the Node library equals the Python library the worker prints', () => {
  const printed = python([path.join(ENGINE_DIR, 'circuit_worker.py'), '--contract'], {});
  assert.ok(printed, 'a python interpreter is required for the cross-implementation contract check (python3 or python)');
  const theirs = JSON.parse(printed);
  const ours = c.describeContract();
  assert.deepEqual(theirs.parts, JSON.parse(JSON.stringify(ours.parts)));
  assert.deepEqual(theirs.limits, ours.limits);
  assert.deepEqual(theirs.sim, JSON.parse(JSON.stringify(ours.sim)));
});

test('the Node build hash equals the bridge\'s Python build hash for the shipped engine tree', () => {
  const node = engineBuildHash(ENGINE_DIR);
  assert.match(node, /^[0-9a-f]{64}$/);
  assert.equal(engineBuildHash(path.join(ENGINE_DIR, 'does-not-exist')), null);
  assert.deepEqual([...RUNTIME_FILES], ['circuit_worker.py', 'circuit_parts.py', 'container/circuit_engine_bridge.py', 'container/Dockerfile', 'firmware/arduino_build.py', 'firmware/avr8js_run.js', 'firmware/cosim.py']);
  const result = python([path.join(ENGINE_DIR, 'container', 'circuit_engine_bridge.py'), '--build-hash'], { CIRCUIT_LAB_ENGINE_DIR: ENGINE_DIR });
  assert.ok(result, 'a python interpreter is required for the cross-implementation hash check (python3 or python)');
  assert.equal(result, node, 'the bridge and the api must agree on the engine build hash');
});
