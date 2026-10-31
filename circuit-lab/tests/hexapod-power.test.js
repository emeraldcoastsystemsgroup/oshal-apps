/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the spider-18 power lane (ADR-202). The hexapod power
 *                     |                             | example validates within the contract's caps with its eighteen
 *                     |                             | servos in embodied's canonical actuator order and fits the
 *                     |                             | breadboard; its servo nameplate equals the catalog row the lab
 *                     |                             | resolves from embodied; the STS3215 shared row READS embodied's
 *                     |                             | jointDrive row (a fixture owner with other numbers moves the
 *                     |                             | answer, the real tree agrees with embodied's own data file), is
 *                     |                             | withheld naming embodied when the owner is absent or cannot
 *                     |                             | answer, and restating an owned field or dropping this lab's
 *                     |                             | electrical block is refused naming the field; the example goes
 *                     |                             | through the real engine client to a fake bridge (not the real
 *                     |                             | solve); and, when the engine container is reachable, the example
 *                     |                             | SOLVES on the real ngspice at 11.1, 12.6 and 9.9 V and the
 *                     |                             | stance bus current, the stall peak, the pack sag and the 5 V
 *                     |                             | rail land within stated bounds — printed as diagnostics so the
 *                     |                             | evaluation note can cite this command.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

// The compiled engine client imports the framework logger by its `@/` alias; resolve it to a silent stub.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

const PKG = path.resolve(__dirname, '..');
const PACKAGES_ROOT = path.resolve(PKG, '..');
const FILE = path.join(PKG, 'catalog', 'drivers.json');
const c = require(path.join(PKG, 'routes', 'circuit-contract.js'));
const { loadDriverCatalog } = require(path.join(PKG, 'routes', 'driver-catalog.js'));
const { findExample, listExamples, hexapodServoId } = require(path.join(PKG, 'routes', 'examples.js'));
const { EngineClient, BRIDGE_PROTOCOL } = require(path.join(PKG, 'routes', 'engine-client.js'));
const { engineBuildHash } = require(path.join(PKG, 'routes', 'engine-build-hash.js'));
const M = require(path.join(PKG, 'tools', 'circuit-lab-board-model.js'));
const { missingSharedOwners } = require(path.join(__dirname, 'shared-part-owners.js'));

const ROW_ID = 'servo-bus-sts3215-12v';
const OWNER_FILE = ['routes', 'engine', 'design', 'parts-catalog.json'];
const OWNER_REF = { owner: 'embodied', file: OWNER_FILE.join('/'), list: 'servos', id: 'sts3215-12v' };
/** The brief's canonical order (embodied ACTUATOR_ORDER): left side front to rear, then right; coxa, femur, tibia. */
const LEGS = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
const JOINTS = ['coxa', 'femur', 'tibia'];
const STANCE_LEGS = ['L1', 'R2', 'L3'];
const STALL_SERVO = 'R1_femur';
const KGCM_TO_MNM = 98.0665;
const EXAMPLE_PARTS = 38;
const EXAMPLE_WIRES = 79;

/** A fixture embodied parts catalog carrying the bus-servo row with numbers no real row has, so a read can be told from a copy. */
const FIXTURE_OWNER_ROW = { id: 'sts3215-12v', name: 'A FIXTURE BUS SERVO', massG: 57, approxUsd: 23, source: 'a fixture bus-servo row, so that a read can be told from a copy', jointDrive: { stallKgCm: 25, secondsPer60: 0.3 } };

const declaredRow = () => JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === ROW_ID);
const circuitOf = (example) => c.validateCircuit({ parts: example.parts, wires: example.wires });

/**
 * @description A packages root on disk: this lab's catalog beside an embodied that publishes `ownerJson`
 * (null leaves embodied out, a string is written verbatim as an unreadable file).
 * @param {object|string|null} ownerJson - embodied's parts catalog.
 * @returns {{ root: string, file: string }} The root and this lab's catalog file inside it.
 */
function fixtureRoot(ownerJson) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-hexapod-'));
  fs.mkdirSync(path.join(root, 'circuit-lab', 'catalog'), { recursive: true });
  fs.copyFileSync(FILE, path.join(root, 'circuit-lab', 'catalog', 'drivers.json'));
  if (ownerJson !== null) {
    const file = path.join(root, 'embodied', ...OWNER_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof ownerJson === 'string' ? ownerJson : JSON.stringify(ownerJson));
  }
  return { root, file: path.join(root, 'circuit-lab', 'catalog', 'drivers.json') };
}

/** Write one declared row as the whole catalog of a fixture root and load it. */
function loadDeclared(row) {
  const made = fixtureRoot({ motors: [], servos: [FIXTURE_OWNER_ROW] });
  fs.writeFileSync(made.file, JSON.stringify({ version: 1, drivers: [row] }));
  try { return loadDriverCatalog(made.file); } finally { fs.rmSync(made.root, { recursive: true, force: true }); }
}

test('the hexapod power example validates within the caps: eighteen STS3215 servos in the canonical order, the stance loads, the jam, the pack, the regulator and its loads', () => {
  const example = findExample('hexapod-power');
  assert.ok(example, 'the example is served');
  assert.ok(listExamples().some((e) => e.id === 'hexapod-power' && e.title === example.title), 'and listed by its title');
  const { parts, wires } = circuitOf(example);
  assert.equal(parts.length, EXAMPLE_PARTS); assert.ok(parts.length <= c.LIMITS.maxParts);
  assert.equal(wires.length, EXAMPLE_WIRES); assert.ok(wires.length <= c.LIMITS.maxWires);
  const servos = parts.filter((p) => p.type === 'servo');
  assert.deepEqual(servos.map((p) => p.id), LEGS.flatMap((leg) => JOINTS.map((joint) => hexapodServoId(leg, joint))), 'the servos are the eighteen joints in the canonical order');
  const nameplate = servos[0].props;
  assert.equal(nameplate.nominalVolts, 12); assert.equal(nameplate.stallAmps, 2.7); assert.equal(nameplate.stallTorqueMnm, 2942); assert.equal(nameplate.noLoadDegPerS, 270); assert.equal(nameplate.travelDeg, 360);
  for (const s of servos) assert.deepEqual(s.props, nameplate, `${s.id} carries the same STS3215 nameplate`);
  const loads = parts.filter((p) => p.type === 'load');
  const stance = STANCE_LEGS.flatMap((leg) => ['femur', 'tibia'].map((joint) => `LD_${hexapodServoId(leg, joint)}`));
  assert.deepEqual(loads.filter((l) => l.props.torqueMnm === 850).map((l) => l.id).sort(), stance.sort(), 'six stance servos hold the brief\'s 0.85 N m');
  assert.equal(loads.find((l) => l.id === 'JAM').props.frictionMnm, 10000, 'the jammed foot is a 10 N m coulomb friction on the stall servo');
  assert.ok(wires.some((w) => w.from.part === STALL_SERVO && w.to.part === 'JAM' && w.kind === 'shaft'));
  assert.ok(wires.some((w) => w.from.part === 'SEQ1' && w.to.part === STALL_SERVO && w.to.pin === 'sig'), 'the stall servo is commanded by the sequencer');
  assert.equal(wires.filter((w) => w.from.part === 'VHOLD' && w.to.pin === 'sig').length, 17, 'the other seventeen hold on the 1 ms pulse');
  assert.equal(c.parseSequence(parts.find((p) => p.id === 'SEQ1').props.pattern).length, 40, '10 hold frames, 5 step frames, 5 hold frames');
  const pack = parts.find((p) => p.id === 'B1').props;
  assert.deepEqual([pack.volts, pack.internalOhms, pack.capacityMah], [11.1, 0.045, 2200]);
  assert.equal(parts.find((p) => p.id === 'REG1').props.maxAmps, 5);
  assert.equal(parts.find((p) => p.id === 'SW_BUSY').props.toggleAtSeconds, 0.5);
  assert.deepEqual(c.validateSim(example.sim), { stopSeconds: 2, stepSeconds: 0.0005, startFromRest: true });
  assert.ok(M.autoLayout(parts, wires, c.describeContract()), 'the example fits the breadboard like every other starter');
});

test('the example\'s servo nameplate IS the catalog row the lab resolves from embodied (the restated copy cannot drift)', { skip: missingSharedOwners(FILE).some((m) => m.id === ROW_ID) && 'embodied is not checked out beside this package' }, () => {
  const row = loadDriverCatalog(FILE).drivers.find((r) => r.id === ROW_ID);
  assert.ok(row, 'the row resolves against the real packages root');
  const servo = circuitOf(findExample('hexapod-power')).parts.find((p) => p.type === 'servo');
  assert.deepEqual(servo.props, c.validateProps('servo', row.nameplate, ROW_ID));
});

test('the STS3215 row is READ from embodied: identity, mass, price, source, stall torque and speed move with the owner; the electrical block stays this lab\'s', () => {
  const { root, file } = fixtureRoot({ motors: [], servos: [FIXTURE_OWNER_ROW] });
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.equal(unresolved.find((u) => u.id === ROW_ID), undefined, 'the owner answers, so the row is not withheld');
  const row = drivers.find((r) => r.id === ROW_ID);
  assert.ok(row, 'the row resolved');
  const declared = declaredRow();
  assert.equal(row.name, FIXTURE_OWNER_ROW.name); assert.equal(row.massG, 57); assert.equal(row.approxUsd, 23);
  assert.match(row.source, /a fixture bus-servo row/); assert.match(row.source, /embodied\/routes\/engine\/design\/parts-catalog\.json#sts3215-12v/);
  assert.equal(row.nameplate.stallTorqueMnm, 2451.7, '25 kg cm in mN m');
  assert.equal(row.nameplate.noLoadDegPerS, 200, '60 / 0.3 s per 60 deg');
  for (const key of ['nominalVolts', 'stallAmps', 'runAmps', 'idleAmps', 'rotorInertiaGcm2', 'minPulseMs', 'maxPulseMs', 'travelDeg']) {
    assert.equal(row.nameplate[key], declared.nameplate[key], `${key} is this lab's declared block`);
  }
  assert.equal(row.kind, 'bus-servo'); assert.equal(row.type, 'servo');
  assert.deepEqual(row.sharedFrom, OWNER_REF);
  for (const key of ['name', 'massG', 'approxUsd', 'source']) assert.equal(declared[key], undefined, `${key} is not restated in this package`);
  for (const key of ['stallTorqueMnm', 'noLoadDegPerS']) assert.equal(declared.nameplate[key], undefined, `${key} is not restated in this package`);
  assert.deepEqual(c.validateProps('servo', row.nameplate, ROW_ID), row.nameplate, 'the resolved nameplate is a servo the contract accepts');
  fs.rmSync(root, { recursive: true, force: true });
});

test('with embodied absent the row is WITHHELD naming embodied, nothing is invented in its place, and the rows this lab owns outright still load', () => {
  const { root, file } = fixtureRoot(null);
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.equal(drivers.find((r) => r.id === ROW_ID), undefined);
  const withheld = unresolved.find((u) => u.id === ROW_ID);
  assert.ok(withheld, 'the row is named as withheld');
  assert.equal(withheld.owner, 'embodied'); assert.equal(withheld.type, 'servo');
  assert.match(withheld.reason, /embodied owns this part and is not installed/);
  assert.deepEqual(withheld.ref, OWNER_REF);
  for (const r of JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.filter((d) => !d.sharedPart)) assert.ok(drivers.some((d) => d.id === r.id), `${r.id} still loads`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an embodied that is installed but cannot answer withholds the row with the reason, never a guess', () => {
  const cases = [
    [{ motors: [] }, /has no servos list/],
    [{ servos: [{ ...FIXTURE_OWNER_ROW, id: 'something-else' }] }, /no row sts3215-12v/],
    ['{ not json', /could not be read/],
    [{ servos: [{ ...FIXTURE_OWNER_ROW, jointDrive: undefined }] }, /no jointDrive block/],
    [{ servos: [{ ...FIXTURE_OWNER_ROW, jointDrive: { stallKgCm: 'strong', secondsPer60: 0.3 } }] }, /jointDrive\.stallKgCm/],
    [{ servos: [{ ...FIXTURE_OWNER_ROW, jointDrive: { stallKgCm: 25 } }] }, /jointDrive\.secondsPer60/],
    [{ servos: [{ ...FIXTURE_OWNER_ROW, massG: 'heavy' }] }, /massG/],
    [{ servos: [{ ...FIXTURE_OWNER_ROW, source: '' }] }, /no source line/],
  ];
  for (const [ownerJson, reason] of cases) {
    const { root, file } = fixtureRoot(ownerJson);
    const { drivers, unresolved } = loadDriverCatalog(file);
    assert.equal(drivers.find((r) => r.id === ROW_ID), undefined, `${reason}: the row is withheld`);
    const withheld = unresolved.find((u) => u.id === ROW_ID);
    assert.ok(withheld, `${reason}: and named`);
    assert.match(withheld.reason, reason);
    assert.equal(withheld.owner, 'embodied');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restating what embodied publishes, or dropping this lab\'s electrical block, is refused at load naming the field', () => {
  const declared = declaredRow();
  const without = (key) => { const { [key]: dropped, ...rest } = declared.nameplate; assert.ok(dropped > 0); return rest; };
  const cases = [
    [{ ...declared, name: 'my own name for it' }, 'drivers[0].name'],
    [{ ...declared, massG: 55 }, 'drivers[0].massG'],
    [{ ...declared, approxUsd: 20 }, 'drivers[0].approxUsd'],
    [{ ...declared, source: 'the usual sheet for the class' }, 'drivers[0].source'],
    [{ ...declared, nameplate: { ...declared.nameplate, stallTorqueMnm: 2942 } }, 'drivers[0].nameplate.stallTorqueMnm'],
    [{ ...declared, nameplate: { ...declared.nameplate, noLoadDegPerS: 270 } }, 'drivers[0].nameplate.noLoadDegPerS'],
    [{ ...declared, nameplate: without('nominalVolts') }, 'drivers[0].nameplate.nominalVolts'],
    [{ ...declared, nameplate: without('stallAmps') }, 'drivers[0].nameplate.stallAmps'],
    [{ ...declared, nameplate: without('runAmps') }, 'drivers[0].nameplate.runAmps'],
    [{ ...declared, nameplate: without('idleAmps') }, 'drivers[0].nameplate.idleAmps'],
    [{ ...declared, nameplate: without('rotorInertiaGcm2') }, 'drivers[0].nameplate.rotorInertiaGcm2'],
    [{ ...declared, note: '' }, 'drivers[0].note'],
  ];
  for (const [row, field] of cases) assert.throws(() => loadDeclared(row), (e) => e instanceof c.ContractError && e.field === field, field);
  assert.ok(loadDeclared(declared).drivers.some((r) => r.id === ROW_ID), 'the declared row itself loads against the fixture owner');
});

test('against the real tree the lab\'s row and embodied\'s own data file describe the SAME servo (read as data, never imported)', { skip: missingSharedOwners(FILE).some((m) => m.id === ROW_ID) && 'embodied is not checked out beside this package' }, () => {
  const owner = JSON.parse(fs.readFileSync(path.join(PACKAGES_ROOT, 'embodied', ...OWNER_FILE), 'utf8')).servos.find((s) => s.id === 'sts3215-12v');
  assert.ok(owner, 'embodied owns the sts3215-12v row');
  const row = loadDriverCatalog(FILE).drivers.find((r) => r.id === ROW_ID);
  assert.ok(row, 'the shared row resolves against the real packages root');
  assert.equal(row.name, owner.name); assert.equal(row.massG, owner.massG); assert.equal(row.approxUsd, owner.approxUsd);
  assert.ok(row.source.includes(owner.source), 'the provenance the owner wrote travels with the row');
  assert.equal(row.nameplate.stallTorqueMnm, Math.round(owner.jointDrive.stallKgCm * KGCM_TO_MNM * 10) / 10);
  assert.equal(row.nameplate.noLoadDegPerS, Math.round(60 / owner.jointDrive.secondsPer60));
  assert.deepEqual(row.sharedFrom, OWNER_REF);
});

// ─────────────────────────────────────────────────────────────────────────────
// The engine: first through the real client to a fake bridge (NOT the real solve), then, when the
// engine container is reachable from this box, the real ngspice solve of the whole hexapod.
// ─────────────────────────────────────────────────────────────────────────────

/** A fake bridge speaking the wire protocol: a hello with this package's build hash, then one canned simulate answer per request. */
function fakeBridge(seen) {
  const hash = engineBuildHash(path.join(PKG, 'engine'));
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write(JSON.stringify({ bridge: { protocol: BRIDGE_PROTOCOL, buildHash: hash } }) + '\n');
    let tail = '';
    socket.on('data', (chunk) => {
      const lines = (tail + chunk).split('\n'); tail = lines.pop();
      for (const line of lines.filter((l) => l.trim())) {
        const req = JSON.parse(line); seen.push(req);
        socket.write(JSON.stringify({ id: req.id, ok: true, result: { readings: [], warnings: [], waveforms: { time: [0], signals: {} }, ms: 1 } }) + '\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close(), hash })));
}

test('through the real engine client the example reaches a bridge speaking the wire protocol with every part and wire (a fake bridge: NOT the real solve)', async () => {
  const seen = [];
  const bridge = await fakeBridge(seen);
  const client = new EngineClient({ host: '127.0.0.1', port: bridge.port, expectedBuildHash: bridge.hash, installHint: 'sh engine/install-engine.sh', helloTimeoutMs: 2000, requestTimeoutMs: 2000 });
  const example = findExample('hexapod-power');
  const result = await client.request('simulate', { circuit: circuitOf(example), sim: c.validateSim(example.sim) });
  assert.deepEqual(result.warnings, []);
  assert.equal(seen.length, 1); assert.equal(seen[0].cmd, 'simulate');
  assert.equal(seen[0].args.circuit.parts.length, EXAMPLE_PARTS); assert.equal(seen[0].args.circuit.wires.length, EXAMPLE_WIRES); assert.equal(seen[0].args.sim.stopSeconds, 2);
  client.close(); bridge.close();
});

/**
 * @description Where the real engine answers: CIRCUIT_LAB_ENGINE_ADDR (host:port), else the running
 * `oshal-circuit-lab-engine` container's address on its network (docker inspect), else null.
 * @returns {{ host: string, port: number } | null}
 */
function realEngineAddr() {
  const env = process.env.CIRCUIT_LAB_ENGINE_ADDR;
  if (env) { const m = /^(.+):(\d{1,5})$/.exec(env.trim()); return m ? { host: m[1], port: Number(m[2]) } : null; }
  const run = spawnSync('docker', ['inspect', 'oshal-circuit-lab-engine', '--format', '{{.State.Running}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  const [running, ip] = run.stdout.trim().split(/\s+/);
  return running === 'true' && ip ? { host: ip, port: 7413 } : null;
}

const ENGINE = realEngineAddr();

/** The mean, max and min of a signal over a time window. */
function over(result, signal, a, b) {
  const t = result.waveforms.time, s = result.waveforms.signals[signal];
  assert.ok(Array.isArray(s), `${signal} is a solved signal`);
  const xs = t.map((x, i) => (x >= a && x <= b ? s[i] : null)).filter((v) => v !== null);
  return { mean: xs.reduce((p, v) => p + v, 0) / xs.length, max: Math.max(...xs), min: Math.min(...xs) };
}

/** Solve the example on the real engine with the pack at `volts`. */
async function solveAt(client, volts) {
  const example = findExample('hexapod-power');
  const circuit = circuitOf(example);
  circuit.parts.find((p) => p.id === 'B1').props.volts = volts;
  return client.request('simulate', { circuit, sim: c.validateSim(example.sim), timeoutSeconds: 120 }, 150000);
}

/** The numbers the evaluation note cites, from one solve. */
function hexapodNumbers(r) {
  const pack = `v(${r.netOfPin['B1.+']})`, bus = `v(${r.netOfPin['RBUS.b']})`, rail = `v(${r.netOfPin['REG1.out']})`;
  const reading = (id) => r.readings.find((x) => x.id === id);
  return {
    stance: { bus: over(r, 'i(RBUS)', 0.3, 0.5), pack: over(r, 'i(B1)', 0.3, 0.5), packV: over(r, pack, 0.3, 0.5), busV: over(r, bus, 0.3, 0.5), loaded: over(r, 'i(L1_femur)', 0.3, 0.5), idle: over(r, 'i(L1_coxa)', 0.3, 0.5) },
    busy: { pack: over(r, 'i(B1)', 0.7, 1.0), packV: over(r, pack, 0.7, 1.0), rail: over(r, rail, 0.6, 2.0), regulator: reading('REG1') },
    stall: { servo: over(r, `i(${STALL_SERVO})`, 1.05, 1.5), bus: over(r, 'i(RBUS)', 1.05, 1.5), pack: over(r, 'i(B1)', 1.05, 1.5), packV: over(r, pack, 1.05, 1.5), busV: over(r, bus, 1.05, 1.5), peak: reading(STALL_SERVO).ampsPeak },
    battery: reading('B1'), warnings: r.warnings, ms: r.ms,
  };
}

test('SOLVED on the real engine: the stance bus current, the stall peak, the pack sag and the 5 V rail at 11.1, 12.6 and 9.9 V (needs the engine container)', { skip: !ENGINE && 'no engine: set CIRCUIT_LAB_ENGINE_ADDR or start oshal-circuit-lab-engine (engine/install-engine.sh)' }, async (t) => {
  const client = new EngineClient({ ...ENGINE, expectedBuildHash: engineBuildHash(path.join(PKG, 'engine')), installHint: 'sh engine/install-engine.sh', requestTimeoutMs: 150000 });
  try {
    const nominal = hexapodNumbers(await solveAt(client, 11.1));
    t.diagnostic(`11.1 V: stance bus ${nominal.stance.bus.mean.toFixed(3)} A (loaded servo ${nominal.stance.loaded.mean.toFixed(3)} A, idle ${nominal.stance.idle.mean.toFixed(3)} A), pack ${nominal.stance.pack.mean.toFixed(3)} A at ${nominal.stance.packV.mean.toFixed(3)} V (bus ${nominal.stance.busV.min.toFixed(3)} V); Pi busy: pack ${nominal.busy.pack.mean.toFixed(3)} A at ${nominal.busy.packV.mean.toFixed(3)} V, rail min ${nominal.busy.rail.min.toFixed(3)} V, regulator ${nominal.busy.regulator.ampsFinal.toFixed(3)} A; stall: ${STALL_SERVO} ${nominal.stall.servo.mean.toFixed(3)} A (peak ${nominal.stall.peak.toFixed(3)}), bus ${nominal.stall.bus.mean.toFixed(3)} A max ${nominal.stall.bus.max.toFixed(3)}, pack ${nominal.stall.pack.mean.toFixed(3)} A max ${nominal.stall.pack.max.toFixed(3)}, pack min ${nominal.stall.packV.min.toFixed(3)} V, bus min ${nominal.stall.busV.min.toFixed(3)} V; run average ${nominal.battery.ampsAvg.toFixed(3)} A, peak ${nominal.battery.ampsPeak.toFixed(3)} A, runtime at the run average ${(nominal.battery.runtimeHours * 60).toFixed(1)} min; engine ${nominal.ms} ms`);
    assert.deepEqual(nominal.warnings, [], 'the solve carries no warning');
    assert.ok(nominal.stance.bus.mean > 5.3 && nominal.stance.bus.mean < 5.9, `stance bus ${nominal.stance.bus.mean} A: six servos holding 0.85 N m plus twelve idle`);
    assert.ok(nominal.stance.loaded.mean > 0.78 && nominal.stance.loaded.mean < 0.88, 'a loaded servo holds 0.85 N m at about 0.83 A');
    assert.ok(nominal.stance.idle.mean > 0.045 && nominal.stance.idle.mean < 0.08, 'an idle servo draws its idle current');
    const sag = 11.1 - nominal.stance.packV.mean;
    assert.ok(Math.abs(sag - nominal.stance.pack.mean * 0.045) < 0.01, `the stance sag ${sag.toFixed(3)} V is the pack current through 45 mohm`);
    assert.ok(nominal.stall.peak > 2.2 && nominal.stall.peak < 2.5, `the stall peak ${nominal.stall.peak} A is the sagged bus over the 4.44 ohm winding`);
    assert.ok(Math.abs(nominal.stall.peak - nominal.stall.busV.min / (12 / 2.7)) < 0.05 * nominal.stall.peak);
    assert.ok(nominal.stall.packV.min > 10.55 && nominal.stall.packV.min < 10.75, 'the pack sags under half a volt in the stall');
    assert.ok(nominal.stall.bus.max > 8.4 && nominal.stall.bus.max < 9.3, 'the bus peaks near 9 A with the stall on top of the stance');
    assert.ok(nominal.busy.rail.min > 4.99, 'the 5 V rail holds through the Pi busy step');
    assert.equal(nominal.busy.regulator.overMax, false); assert.equal(nominal.busy.regulator.inDropout, false);
    assert.ok(nominal.busy.regulator.ampsFinal > 2.65 && nominal.busy.regulator.ampsFinal < 2.75, '12 W Pi plus 0.3 A LiDAR on the 5 V rail');
    assert.ok(nominal.busy.pack.mean - nominal.stance.pack.mean > 0.8 && nominal.busy.pack.mean - nominal.stance.pack.mean < 0.95, 'the busy step adds the buck stand-in current on the pack');
    const runtimeMin = (2.2 / nominal.stance.pack.mean) * 60;
    assert.ok(runtimeMin > 20 && runtimeMin < 24, `about ${runtimeMin.toFixed(1)} min from 2200 mAh at the stance draw`);

    const full = hexapodNumbers(await solveAt(client, 12.6)), cutoff = hexapodNumbers(await solveAt(client, 9.9));
    t.diagnostic(`12.6 V: stance bus ${full.stance.bus.mean.toFixed(3)} A, pack ${full.stance.pack.mean.toFixed(3)} A at ${full.stance.packV.mean.toFixed(3)} V; stall peak ${full.stall.peak.toFixed(3)} A, pack min ${full.stall.packV.min.toFixed(3)} V; rail min ${full.busy.rail.min.toFixed(3)} V`);
    t.diagnostic(`9.9 V: stance bus ${cutoff.stance.bus.mean.toFixed(3)} A, pack ${cutoff.stance.pack.mean.toFixed(3)} A at ${cutoff.stance.packV.mean.toFixed(3)} V; stall peak ${cutoff.stall.peak.toFixed(3)} A, pack min ${cutoff.stall.packV.min.toFixed(3)} V; rail min ${cutoff.busy.rail.min.toFixed(3)} V`);
    assert.deepEqual([full.warnings, cutoff.warnings], [[], []]);
    assert.ok(full.stall.peak > 2.6 && full.stall.peak < 2.75, 'at a full pack the stall peak is the rated 2.7 A');
    assert.ok(cutoff.stall.peak > 2.0 && cutoff.stall.peak < 2.2, 'at cutoff it falls with the bus voltage');
    assert.ok(Math.abs(full.stance.bus.mean - cutoff.stance.bus.mean) < 0.05, 'the stance current is set by the torque, not the voltage');
    assert.ok(cutoff.busy.rail.min > 4.99 && cutoff.stall.packV.min > 9.4, 'the 5 V rail still holds at the 9.9 V cutoff');
  } finally {
    client.close();
  }
});
