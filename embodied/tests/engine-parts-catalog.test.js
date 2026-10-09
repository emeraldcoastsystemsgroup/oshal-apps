/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the owned bought-part rows (ADR-152 D1). The drone
 *                     |                             | motors and the arm servo moved out of TypeScript literals into
 *                     |                             | ONE committed data row each (parts-catalog.json), built by id.
 *                     |                             | Proved four ways against the compiled engine: the rows are
 *                     |                             | exactly what DRONE_FITS and STS3215_12V expose; no number moved
 *                     |                             | (every figure the design document prints is pinned at its
 *                     |                             | pre-change value); the model READS the file rather than holding
 *                     |                             | a copy (a copy of the compiled engine with an edited row moves
 *                     |                             | the mass budget, the price and the joint sizing); and a missing
 *                     |                             | or malformed row fails the load by name. Also guarded: the
 *                     |                             | compiled JSON another package reads is the committed source,
 *                     |                             | and no package source restates a row's name.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROUTES_ENGINE = path.join(__dirname, '..', 'routes', 'engine');
const SRC = path.join(__dirname, '..', 'src-routes');
const CATALOG = path.join(ROUTES_ENGINE, 'design', 'parts-catalog.json');
const SRC_CATALOG = path.join(SRC, 'engine', 'design', 'parts-catalog.json');
const KGCM_TO_NM = 0.0980665;

const { DRONE_FITS, buildDrone } = require(path.join(ROUTES_ENGINE, 'design', 'parts-model.js'));
const { STS3215_12V } = require(path.join(ROUTES_ENGINE, 'design', 'servos.js'));
const { buildArm } = require(path.join(ROUTES_ENGINE, 'design', 'arm-design.js'));
const { motorRow, servoRow } = require(path.join(ROUTES_ENGINE, 'design', 'parts-catalog.js'));

/** Which owned motor row each fit flies on. */
const FIT_MOTOR = { 'recon-mini': '2306-1800kv', 'recon-3d': '2807-1300kv' };

/**
 * @description Copy the compiled engine into a fresh directory, let a test edit its parts-catalog.json, and load
 * the copy's own modules (a different path, so Node's module cache cannot hand back the originals).
 * @param {(rows: object) => void} edit Change the parsed catalog in place.
 * @returns {{ load: (rel: string) => any, done: () => void }} A loader for the copy and its cleanup.
 */
function editedEngine(edit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'embodied-parts-'));
  const engine = path.join(root, 'engine');
  fs.cpSync(ROUTES_ENGINE, engine, { recursive: true });
  const file = path.join(engine, 'design', 'parts-catalog.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(rows);
  fs.writeFileSync(file, JSON.stringify(rows), 'utf8');
  return {
    load: (rel) => require(path.join(engine, ...rel.split('/'))),
    done: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Every .ts under src-routes. */
function sources(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('every owned row carries identity, mass, price and a source line, and the fits and the arm servo expose exactly those rows', () => {
  const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  for (const row of [...data.motors, ...data.servos]) {
    assert.match(row.id, /^[a-z0-9][a-z0-9-]{1,60}$/, 'a row id another package can reference');
    assert.ok(row.name && row.massG > 0 && row.approxUsd > 0, `${row.id}: identity, mass and price`);
    assert.ok(typeof row.source === 'string' && row.source.length > 40, `${row.id} says where its numbers came from`);
  }
  for (const [fitId, rowId] of Object.entries(FIT_MOTOR)) {
    const row = motorRow(rowId);
    const motor = DRONE_FITS[fitId].motor;
    assert.equal(motor.id, 'motor', 'the bill keeps the id the MJCF generator looks the motor up by');
    assert.equal(motor.name, row.name);
    assert.equal(motor.massEachG, row.massG);
    assert.equal(motor.approxUsdEach, row.approxUsd);
    assert.ok(row.propulsion.kv > 0, `${rowId}: the propulsion block carries the KV`);
  }
  const s = servoRow('sts3215-12v');
  assert.equal(STS3215_12V.id, s.id);
  assert.equal(STS3215_12V.name, s.name);
  assert.equal(STS3215_12V.massG, s.massG);
  assert.equal(STS3215_12V.approxUsdEach, s.approxUsd);
  assert.equal(STS3215_12V.source, s.source);
  assert.equal(STS3215_12V.stallNm, s.jointDrive.stallKgCm * KGCM_TO_NM);
  assert.equal(STS3215_12V.noLoadRadS, (Math.PI / 3) / s.jointDrive.secondsPer60);
  assert.deepEqual(STS3215_12V.bodyMm, s.jointDrive.bodyMm);
  assert.equal(STS3215_12V.splineOffsetMm, s.jointDrive.splineOffsetMm);
  assert.equal(STS3215_12V.hornDiscMm, s.jointDrive.hornDiscMm);
  assert.equal(STS3215_12V.encoder, s.jointDrive.encoder);
});

test('no number moved: every figure the design documents print is the value it had while the parts were literals', () => {
  const mini = buildDrone('recon-mini');
  const big = buildDrone('recon-3d');
  assert.deepEqual(mini.fit.motor, { id: 'motor', name: '2306 brushless, 1700–1900 KV', qty: 4, massEachG: 30, role: '~1 kg peak thrust each on a 6-inch prop', approxUsdEach: 18 });
  assert.deepEqual(big.fit.motor, { id: 'motor', name: '2807 brushless, 1300 KV', qty: 4, massEachG: 45, role: 'a 7-inch prop on 6S for a 1.3 kg machine', approxUsdEach: 28 });
  assert.deepEqual(mini.massBudget, { printedG: 245, boughtG: 326, batteryG: 175, allUpG: 746 });
  assert.deepEqual(big.massBudget, { printedG: 276, boughtG: 587, batteryG: 330, allUpG: 1193 });
  assert.equal(mini.approxUsd, 582);
  assert.equal(big.approxUsd, 1447);
  assert.equal(STS3215_12V.massG, 55);
  assert.equal(STS3215_12V.approxUsdEach, 20);
  assert.equal(STS3215_12V.stallNm, 30 * KGCM_TO_NM);
  assert.equal(STS3215_12V.noLoadRadS, (Math.PI / 3) / 0.222);
  assert.deepEqual(STS3215_12V.bodyMm, [45.2, 24.7, 35]);
  const arm = buildArm('desk-6');
  assert.equal(arm.servoCount, 8);
  assert.deepEqual(arm.massBudget, { printedG: 576, servosG: 385, movingG: 961, payloadG: 150 });
  assert.equal(arm.approxUsd, 240);
});

test('the model READS the row: in a copy of the compiled engine with an edited row, the mass budget, the price and the joint sizing move', () => {
  const copy = editedEngine((rows) => {
    const m = rows.motors.find((r) => r.id === '2306-1800kv');
    m.name = 'a fixture motor, so that a read can be told from a copy';
    m.massG = 40;
    m.approxUsd = 25;
    const s = rows.servos.find((r) => r.id === 'sts3215-12v');
    s.massG = 60;
    s.approxUsd = 30;
    s.jointDrive.stallKgCm = 35;
  });
  try {
    const drone = copy.load('design/parts-model.js').buildDrone('recon-mini');
    assert.equal(drone.fit.motor.name, 'a fixture motor, so that a read can be told from a copy');
    assert.equal(drone.massBudget.boughtG, 326 + 4 * 10, 'four motors, ten grams more each');
    assert.equal(drone.massBudget.allUpG, 746 + 4 * 10);
    assert.equal(drone.sizing.auwG, drone.massBudget.allUpG, 'the hover is sized at the mass the row gave');
    assert.equal(drone.approxUsd, 582 + 4 * 7);
    assert.deepEqual(copy.load('design/parts-model.js').buildDrone('recon-3d').massBudget.allUpG, 1193, 'the other fit reads its own row and did not move');
    const servo = copy.load('design/servos.js').STS3215_12V;
    assert.equal(servo.massG, 60);
    assert.equal(servo.stallNm, 35 * KGCM_TO_NM, 'the joint-drive block is read too');
    const arm = copy.load('design/arm-design.js').buildArm('desk-6');
    const line = arm.bought.find((b) => b.id === 'servo');
    assert.equal(line.massEachG, 60);
    assert.equal(line.approxUsdEach, 30);
    assert.equal(arm.massBudget.servosG, (arm.servoCount - 1) * 60, 'the moving mass is summed from the row');
    assert.equal(arm.approxUsd, arm.bought.reduce((a, b) => a + b.qty * b.approxUsdEach, 0));
    assert.notEqual(arm.approxUsd, 240);
  } finally {
    copy.done();
  }
});

test('a missing or malformed row is the package’s own defect and fails the load by name, never a default', () => {
  const cases = [
    [(rows) => { rows.motors = rows.motors.filter((r) => r.id !== '2807-1300kv'); }, /no motors row 2807-1300kv/],
    [(rows) => { rows.motors.find((r) => r.id === '2306-1800kv').massG = 'heavy'; }, /motors#2306-1800kv\.massG/],
    [(rows) => { delete rows.motors.find((r) => r.id === '2306-1800kv').source; }, /motors#2306-1800kv\.source/],
    [(rows) => { delete rows.motors.find((r) => r.id === '2306-1800kv').propulsion; }, /motors#2306-1800kv\.propulsion/],
    [(rows) => { rows.servos.find((r) => r.id === 'sts3215-12v').jointDrive.bodyMm = [45.2, 24.7]; }, /servos#sts3215-12v\.jointDrive\.bodyMm/],
    [(rows) => { delete rows.servos; }, /no servos list/],
  ];
  for (const [edit, named] of cases) {
    const copy = editedEngine(edit);
    try {
      assert.throws(() => { copy.load('design/parts-model.js'); copy.load('design/servos.js'); }, named);
    } finally {
      copy.done();
    }
  }
});

test('the compiled rows another package reads are the committed source rows, and no package source restates a row name', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(CATALOG, 'utf8')), JSON.parse(fs.readFileSync(SRC_CATALOG, 'utf8')),
    'routes/engine/design/parts-catalog.json is what Circuit Lab reads; recompile after editing the source row');
  const data = JSON.parse(fs.readFileSync(SRC_CATALOG, 'utf8'));
  const names = [...data.motors, ...data.servos].map((r) => r.name);
  const restated = [];
  for (const file of sources()) {
    const body = fs.readFileSync(file, 'utf8');
    for (const name of names) if (body.includes(name)) restated.push(`${path.relative(SRC, file)}: ${name}`);
  }
  assert.deepEqual(restated, [], 'a row name written into package code is a second description of the part');
});
