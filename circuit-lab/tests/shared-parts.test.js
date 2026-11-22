/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the shared-part row: a catalog row that names another
 *                     |                             | package as the OWNER of a real part READS that package's row
 *                     |                             | instead of restating its name, mass, price, source and the
 *                     |                             | pulse-and-speed block. Proved against two package trees on
 *                     |                             | disk: the real one (this lab's SG90 row equals animatronics'
 *                     |                             | own row, read back through ANIMATRONICS' OWN loader), a
 *                     |                             | fixture packages root whose owner declares different numbers
 *                     |                             | (the answer moves with it — a copy could not), and the
 *                     |                             | unhappy shapes (owner absent, list absent, row absent, owner
 *                     |                             | row malformed) where the row is withheld naming the owner and
 *                     |                             | nothing is invented in its place. Restating a field the owner
 *                     |                             | declares, or picking an operating point outside the owner's
 *                     |                             | voltage window, is refused at load with the field named.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Guard the environment the degradation is FOR. Entry 1 shipped a
 *                     |                             | fail-closed read and left two of this package's own suites
 *                     |                             | asserting that it never degrades, so a single-package install -
 *                     |                             | which is how store packages install, and exactly what the
 *                     |                             | framework's Test Lab snapshots for a package case - reported a
 *                     |                             | correctly working package as RED. This case reproduces that
 *                     |                             | environment for real: the package is copied ALONE into an empty
 *                     |                             | directory and its own catalog suite is run there in a child
 *                     |                             | process. A second case puts the old assumption back inside that
 *                     |                             | copy and requires the run to go red, which also proves the
 *                     |                             | child's exit code is readable at all (a `node --test` child
 *                     |                             | inheriting NODE_TEST_CONTEXT exits 0 even when it fails).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The MOTOR rows read embodied. The fixture packages root now
 *                     |                             | carries both owners (animatronics' servo catalog and
 *                     |                             | embodied's compiled parts-catalog.json), each replaceable or
 *                     |                             | removable on its own. New cases, the same four shapes the
 *                     |                             | servo has: a fixture embodied whose different numbers move
 *                     |                             | name, mass, price, source, KV and the derived noLoadRpm while
 *                     |                             | this lab's electrical block stays its own; embodied absent
 *                     |                             | withholds exactly the two motor rows naming embodied;
 *                     |                             | embodied present but unable to answer withholds with the
 *                     |                             | reason; restating name, mass, price, source, KV or noLoadRpm
 *                     |                             | - or dropping the operating point the read needs - is
 *                     |                             | refused with the field named. Installed alone, the package
 *                     |                             | now withholds three rows (the SG90 and both motors).
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The STS3215 bus-servo row reads embodied's `servos` row
 *                     |                             | (ADR-202, the spider-18 power lane): the fixture embodied
 *                     |                             | catalog now carries that row too, so a fixture root with
 *                     |                             | both owners resolves every shared row, embodied absent
 *                     |                             | withholds its three rows, and installed alone the package
 *                     |                             | withholds four. The row's own read-through, fixture-moves and
 *                     |                             | withheld-by-name cases live in tests/hexapod-power.test.js.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Cover all five animatronics servo rows (SG90, MG90S, MG996R,
 *                     |                             | DS3218, STS3215 7.4 V) and add the full stepper sharedPart
 *                     |                             | reader suite: fixture owner (flat and nested `stepper` block)
 *                     |                             | moves the answer, absent owner withholds naming it, malformed
 *                     |                             | owner or missing stepper field withholds with reason,
 *                     |                             | restating any owned stepper field is refused naming the field,
 *                     |                             | and an unknown type with no reader stays refused at load.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { loadDriverCatalog, listDrivers, sharedReaderFor } = require(path.resolve(__dirname, '..', 'routes', 'driver-catalog.js'));
const { ContractError } = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));
const { missingSharedOwners } = require(path.resolve(__dirname, 'shared-part-owners.js'));

const PACKAGES_ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.resolve(__dirname, '..', 'catalog', 'drivers.json');
const SHARED_ID = 'servo-micro-9g';
const ANIMATRONICS_IDS = ['servo-micro-9g', 'servo-mg90s', 'servo-mg996r', 'servo-ds3218', 'servo-sts3215-7v4'];
const OWNER_LOADER = path.join(PACKAGES_ROOT, 'animatronics', 'routes', 'engine', 'catalog.js');
const OWNER_CATALOG = path.join(PACKAGES_ROOT, 'animatronics', 'catalog', 'servos.json');
const MOTOR_OWNER_FILE = ['routes', 'engine', 'design', 'parts-catalog.json'];
const MOTOR_IDS = ['bl-2306-1800kv', 'bl-2807-1300kv'];

/** A fixture embodied parts catalog: both motor rows, with numbers no real row carries, so a read can be told from a copy. */
const MOTOR_OWNER = {
  motors: [
    { id: '2306-1800kv', name: 'A DIFFERENT MOTOR', massG: 33, approxUsd: 21, source: 'a fixture motor row, so that a read can be told from a copy', propulsion: { kv: 2000 } },
    { id: '2807-1300kv', name: 'ANOTHER FIXTURE MOTOR', massG: 50, approxUsd: 31, source: 'a second fixture motor row', propulsion: { kv: 1250 } },
  ],
  servos: [
    { id: 'sts3215-12v', name: 'A FIXTURE BUS SERVO', massG: 57, approxUsd: 23, source: 'a fixture bus-servo row, so that a read can be told from a copy', jointDrive: { stallKgCm: 25, secondsPer60: 0.3 } },
  ],
};
/** Every row this lab reads from embodied: the two motors and the bus servo. */
const EMBODIED_IDS = [...MOTOR_IDS, 'servo-bus-sts3215-12v'];

/**
 * Build a packages root on disk: this lab's catalog file, plus whatever owner trees are asked for.
 * `ownerJson` is animatronics' servo catalog and `motorOwnerJson` embodied's parts catalog; null
 * leaves that owner out, a string is written verbatim (an unreadable file).
 */
function fixtureRoot(ownerJson, motorOwnerJson = MOTOR_OWNER) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-shared-'));
  fs.mkdirSync(path.join(root, 'circuit-lab', 'catalog'), { recursive: true });
  fs.copyFileSync(FILE, path.join(root, 'circuit-lab', 'catalog', 'drivers.json'));
  const write = (file, json) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json));
  };
  if (ownerJson !== null) write(path.join(root, 'animatronics', 'catalog', 'servos.json'), ownerJson);
  if (motorOwnerJson !== null) write(path.join(root, 'embodied', ...MOTOR_OWNER_FILE), motorOwnerJson);
  return { root, file: path.join(root, 'circuit-lab', 'catalog', 'drivers.json') };
}

const OWNER_ROW = {
  id: 'sg90', name: 'A DIFFERENT SERVO', kind: 'hobby', massG: 11.5, approxUsd: 7,
  voltsMin: 4.5, voltsMax: 6.5, pulseMinUs: 600, pulseMaxUs: 2300, travelDeg: 170,
  secondsPer60: 0.15, stallKgCm: 2.5, idleMa: 12, movingMa: 260, stallMa: 820,
  source: 'a fixture row, so that a read can be told from a copy', usedBy: [],
};

const EXTRA_OWNER_SERVOS = [
  { ...OWNER_ROW, id: 'mg90s', name: 'FIXTURE MG90S', massG: 15, approxUsd: 5, voltsMin: 4.8, voltsMax: 6.2 },
  { ...OWNER_ROW, id: 'mg996r', name: 'FIXTURE MG996R', massG: 58, approxUsd: 8, voltsMin: 4.8, voltsMax: 7.2, stallKgCm: 12, stallMa: 2400 },
  { ...OWNER_ROW, id: 'ds3218', name: 'FIXTURE DS3218', massG: 62, approxUsd: 14, voltsMin: 4.8, voltsMax: 7.0, travelDeg: 270, stallKgCm: 21, stallMa: 3100 },
  { ...OWNER_ROW, id: 'feetech-sts3215', name: 'FIXTURE STS3215 7V4', kind: 'bus', massG: 66, approxUsd: 17, voltsMin: 6, voltsMax: 8.4, travelDeg: 360, stallKgCm: 19.5, stallMa: 2800 },
];

/** A fixture owner catalog carrying all five animatronics servo rows, with `sg90Row` substituted for sg90. */
function ownerCatalogWith(sg90Row) {
  return { servos: [sg90Row, ...EXTRA_OWNER_SERVOS], controllers: [] };
}

test('the shared row is READ from its owner: identity, mass, price, source and the pulse-and-speed block all move with the owner', () => {
  const { root, file } = fixtureRoot(ownerCatalogWith(OWNER_ROW));
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.deepEqual(unresolved, [], 'the owner is installed, so nothing is withheld');
  const row = drivers.find((r) => r.id === SHARED_ID);
  assert.ok(row, 'the shared row resolved');
  assert.equal(row.name, OWNER_ROW.name);
  assert.equal(row.massG, OWNER_ROW.massG);
  assert.equal(row.approxUsd, OWNER_ROW.approxUsd);
  assert.match(row.source, /a fixture row, so that a read can be told from a copy/);
  assert.match(row.source, /animatronics/, 'the resolved source names the owner the numbers came from');
  assert.equal(row.nameplate.minPulseMs, 0.6);
  assert.equal(row.nameplate.maxPulseMs, 2.3);
  assert.equal(row.nameplate.travelDeg, 170);
  assert.equal(row.nameplate.noLoadDegPerS, 400, '60 / 0.15 s per 60 deg');
  assert.equal(row.nameplate.stallTorqueMnm, 245.2, '2.5 kg*cm in mN*m');
  assert.equal(row.nameplate.idleAmps, 0.012);
  assert.equal(row.nameplate.runAmps, 0.26);
  assert.equal(row.nameplate.stallAmps, 0.82);
  assert.deepEqual(row.sharedFrom, { owner: 'animatronics', file: 'catalog/servos.json', list: 'servos', id: 'sg90' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('the lab keeps only the block it understands: the operating point and the reflected inertia are its own', () => {
  const { root, file } = fixtureRoot(ownerCatalogWith(OWNER_ROW));
  const row = loadDriverCatalog(file).drivers.find((r) => r.id === SHARED_ID);
  const declared = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === SHARED_ID);
  assert.ok(declared.sharedPart, 'the row in the file names its owner instead of restating the part');
  for (const key of ['name', 'massG', 'approxUsd', 'source']) {
    assert.equal(declared[key], undefined, key + ' is not restated in this package');
  }
  for (const key of ['minPulseMs', 'maxPulseMs', 'travelDeg', 'noLoadDegPerS', 'stallTorqueMnm', 'idleAmps', 'runAmps', 'stallAmps']) {
    assert.equal(declared.nameplate[key], undefined, key + ' is not restated in this package');
  }
  assert.equal(row.nameplate.nominalVolts, declared.nameplate.nominalVolts);
  assert.equal(row.nameplate.rotorInertiaGcm2, declared.nameplate.rotorInertiaGcm2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('with the owner absent the rows are WITHHELD naming the owner, and the rest of the catalog still loads', () => {
  const { root, file } = fixtureRoot(null);
  const { drivers, unresolved } = loadDriverCatalog(file);
  for (const id of ANIMATRONICS_IDS) assert.equal(drivers.find((r) => r.id === id), undefined, `${id}: nothing is invented in the owner place`);
  assert.deepEqual(listDrivers(drivers, 'servo').map((r) => r.id), ['servo-bus-sts3215-12v'], 'the only servo that still loads is the one embodied owns');
  const outright = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.filter((r) => !r.sharedPart).map((r) => r.id);
  for (const id of [...outright, ...EMBODIED_IDS]) assert.ok(drivers.some((r) => r.id === id), `${id} still loads: its owner is not the one missing`);
  assert.deepEqual(unresolved.map((u) => u.id).sort(), [...ANIMATRONICS_IDS].sort());
  for (const u of unresolved) {
    assert.equal(u.owner, 'animatronics');
    assert.match(u.reason, /animatronics/);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('an owner that is installed but cannot answer withholds the row with the reason, never a guess', () => {
  const cases = [
    [ownerCatalogWith({ ...OWNER_ROW, id: 'something-else' }), /no row .*sg90/i, 1],
    [{ controllers: [] }, /servos/i, ANIMATRONICS_IDS.length],
    ['{ not json', /could not be read|parse/i, ANIMATRONICS_IDS.length],
    [ownerCatalogWith({ ...OWNER_ROW, stallKgCm: 'heavy' }), /stallKgCm/, 1],
  ];
  for (const [ownerJson, reason, expectedCount] of cases) {
    const { root, file } = fixtureRoot(ownerJson);
    const { drivers, unresolved } = loadDriverCatalog(file);
    assert.equal(drivers.find((r) => r.id === SHARED_ID), undefined);
    assert.equal(unresolved.length, expectedCount);
    const sg90 = unresolved.find((u) => u.id === SHARED_ID);
    assert.ok(sg90, `${reason}: sg90 is named as withheld`);
    assert.match(sg90.reason, reason);
    assert.equal(sg90.owner, 'animatronics');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restating a field the owner declares is refused at load, with the field named', () => {
  const declared = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === SHARED_ID);
  const write = (row) => {
    const made = fixtureRoot(ownerCatalogWith(OWNER_ROW));
    fs.writeFileSync(made.file, JSON.stringify({ version: 1, drivers: [row] }));
    return made;
  };
  const cases = [
    [{ ...declared, name: 'my own name for it' }, 'drivers[0].name'],
    [{ ...declared, massG: 9 }, 'drivers[0].massG'],
    [{ ...declared, approxUsd: 3 }, 'drivers[0].approxUsd'],
    [{ ...declared, source: 'the usual sheet for the class' }, 'drivers[0].source'],
    [{ ...declared, nameplate: { ...declared.nameplate, travelDeg: 180 } }, 'drivers[0].nameplate.travelDeg'],
  ];
  for (const [row, field] of cases) {
    const { root, file } = write(row);
    assert.throws(() => loadDriverCatalog(file), (e) => e instanceof ContractError && e.field === field, field);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an operating point outside the voltage window the owner publishes is refused rather than simulated', () => {
  const declared = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === SHARED_ID);
  const { root, file } = fixtureRoot(ownerCatalogWith(OWNER_ROW));
  fs.writeFileSync(file, JSON.stringify({ version: 1, drivers: [{ ...declared, nameplate: { ...declared.nameplate, nominalVolts: 9 } }] }));
  assert.throws(() => loadDriverCatalog(file), (e) => e instanceof ContractError && e.field === 'drivers[0].nameplate.nominalVolts');
  fs.rmSync(root, { recursive: true, force: true });
});

test('against the real tree the lab and the owner describe the SAME servos (all five animatronics rows)', { skip: !fs.existsSync(OWNER_LOADER) && 'animatronics is not checked out beside this package' }, () => {
  const { loadServoCatalog, maxDegPerSOf } = require(OWNER_LOADER);
  const owners = loadServoCatalog(OWNER_CATALOG).servos;
  const declared = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.filter((r) => r.sharedPart && r.sharedPart.owner === 'animatronics');
  assert.equal(declared.length, owners.length, 'every animatronics servo row is shared into this lab');
  const { drivers } = loadDriverCatalog(FILE);
  for (const owner of owners) {
    const decl = declared.find((d) => d.sharedPart.id === owner.id);
    assert.ok(decl, `animatronics owns ${owner.id}`);
    const row = drivers.find((r) => r.id === decl.id);
    assert.ok(row, `${decl.id} resolves against the real packages root`);
    assert.equal(row.name, owner.name);
    assert.equal(row.massG, owner.massG);
    assert.equal(row.approxUsd, owner.approxUsd);
    assert.ok(row.source.includes(owner.source), `${decl.id}: the provenance the owner wrote travels with the row`);
    assert.equal(row.nameplate.minPulseMs, owner.pulseMinUs / 1000);
    assert.equal(row.nameplate.maxPulseMs, owner.pulseMaxUs / 1000);
    assert.equal(row.nameplate.travelDeg, owner.travelDeg);
    assert.equal(row.nameplate.noLoadDegPerS, maxDegPerSOf(owner));
    assert.equal(row.nameplate.idleAmps, owner.idleMa / 1000);
    assert.equal(row.nameplate.runAmps, owner.movingMa / 1000);
    assert.equal(row.nameplate.stallAmps, owner.stallMa / 1000);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The motors: embodied owns them (ADR-152 D1) and publishes each as a data row with a
// propulsion block. This lab keeps its electrical model and the operating point it solves at.
// ─────────────────────────────────────────────────────────────────────────────

test('a shared MOTOR is READ from embodied: name, mass, price, source and KV move with the owner, and noLoadRpm is KV x this lab’s operating point', () => {
  const { root, file } = fixtureRoot(ownerCatalogWith(OWNER_ROW));
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.deepEqual(unresolved, [], 'both owners are installed, so nothing is withheld');
  const declared = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === 'bl-2306-1800kv');
  const row = drivers.find((r) => r.id === 'bl-2306-1800kv');
  assert.equal(row.name, 'A DIFFERENT MOTOR');
  assert.equal(row.massG, 33);
  assert.equal(row.approxUsd, 21);
  assert.equal(row.kv, 2000);
  assert.match(row.source, /a fixture motor row, so that a read can be told from a copy/);
  assert.match(row.source, /embodied\/routes\/engine\/design\/parts-catalog\.json#2306-1800kv/, 'the resolved source names the owner row');
  assert.equal(row.nameplate.noLoadRpm, Math.round(2000 * declared.nameplate.nominalVolts), 'the owner KV at this lab’s operating point');
  for (const key of ['nominalVolts', 'stallAmps', 'noLoadAmps', 'inductanceMh', 'rotorInertiaGcm2']) {
    assert.equal(row.nameplate[key], declared.nameplate[key], `${key} is this lab's own electrical block`);
  }
  assert.equal(row.cells, declared.cells, 'the cell count is this lab’s operating point too');
  assert.deepEqual(row.sharedFrom, { owner: 'embodied', file: 'routes/engine/design/parts-catalog.json', list: 'motors', id: '2306-1800kv' });
  assert.equal(drivers.find((r) => r.id === 'bl-2807-1300kv').kv, 1250, 'the second motor reads its own row');
  for (const id of MOTOR_IDS) {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === id);
    for (const key of ['name', 'massG', 'approxUsd', 'source', 'kv']) assert.equal(d[key], undefined, `${id}: ${key} is not restated in this package`);
    assert.equal(d.nameplate.noLoadRpm, undefined, `${id}: noLoadRpm is derived from the owner KV, not restated`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('with embodied absent exactly its rows (the two motors and the bus servo) are WITHHELD naming embodied, and the rest of the catalog still loads', () => {
  const { root, file } = fixtureRoot(ownerCatalogWith(OWNER_ROW), null);
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.deepEqual(unresolved.map((u) => u.id).sort(), [...EMBODIED_IDS].sort());
  for (const u of unresolved) {
    assert.equal(u.owner, 'embodied');
    assert.equal(u.type, MOTOR_IDS.includes(u.id) ? 'motor' : 'servo');
    assert.match(u.reason, /embodied owns this part and is not installed/);
    assert.equal(drivers.find((r) => r.id === u.id), undefined, `${u.id}: nothing is invented in the owner's place`);
  }
  assert.deepEqual(listDrivers(drivers, 'motor').map((r) => r.id), ['brushed-12v-generic'], 'the motor this package owns outright still loads');
  assert.ok(drivers.some((r) => r.id === SHARED_ID), 'the servo reads its own owner, which is present');
  fs.rmSync(root, { recursive: true, force: true });
});

test('an embodied that is installed but cannot answer withholds the motor row with the reason, never a guess', () => {
  const only2807 = { motors: [MOTOR_OWNER.motors[1]] };
  const with2306 = (patch) => ({ motors: [{ ...MOTOR_OWNER.motors[0], ...patch }, MOTOR_OWNER.motors[1]] });
  const cases = [
    [only2807, /no row 2306-1800kv/],
    [{ servos: [] }, /has no motors list/],
    ['{ not json', /could not be read/],
    [with2306({ propulsion: undefined }), /no propulsion block/],
    [with2306({ propulsion: { kv: 'fast' } }), /propulsion\.kv/],
    [with2306({ massG: 'heavy' }), /massG/],
    [with2306({ source: '' }), /no source line/],
  ];
  for (const [motorOwnerJson, reason] of cases) {
    const { root, file } = fixtureRoot(ownerCatalogWith(OWNER_ROW), motorOwnerJson);
    const { drivers, unresolved } = loadDriverCatalog(file);
    assert.equal(drivers.find((r) => r.id === 'bl-2306-1800kv'), undefined, `${reason}: the row is withheld`);
    const withheld = unresolved.find((u) => u.id === 'bl-2306-1800kv');
    assert.ok(withheld, `${reason}: and named`);
    assert.match(withheld.reason, reason);
    assert.equal(withheld.owner, 'embodied');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restating a field embodied publishes, or dropping the operating point the read needs, is refused at load with the field named', () => {
  const declared = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === 'bl-2306-1800kv');
  const { nominalVolts, ...withoutVolts } = declared.nameplate;
  assert.ok(nominalVolts > 0, 'the declared row carries its operating point');
  const cases = [
    [{ ...declared, name: 'my own name for it' }, 'drivers[0].name'],
    [{ ...declared, massG: 30 }, 'drivers[0].massG'],
    [{ ...declared, approxUsd: 18 }, 'drivers[0].approxUsd'],
    [{ ...declared, source: 'the usual sheet for the class' }, 'drivers[0].source'],
    [{ ...declared, kv: 1800 }, 'drivers[0].kv'],
    [{ ...declared, nameplate: { ...declared.nameplate, noLoadRpm: 26640 } }, 'drivers[0].nameplate.noLoadRpm'],
    [{ ...declared, nameplate: withoutVolts }, 'drivers[0].nameplate.nominalVolts'],
    [{ ...declared, note: '' }, 'drivers[0].note'],
  ];
  for (const [row, field] of cases) {
    const made = fixtureRoot(ownerCatalogWith(OWNER_ROW));
    fs.writeFileSync(made.file, JSON.stringify({ version: 1, drivers: [row] }));
    assert.throws(() => loadDriverCatalog(made.file), (e) => e instanceof ContractError && e.field === field, field);
    fs.rmSync(made.root, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The stepper reader: reads identity plus core datasheet specs (stepsPerRev,
// phaseOhms, phaseMh, ratedAmps, holdingTorqueMnm) from either flat owner fields
// or a nested `stepper` block, keeping this lab's modelling defaults local.
// ─────────────────────────────────────────────────────────────────────────────

const STEPPER_REF = { owner: 'fixture-motion', file: 'catalog/steppers.json', list: 'steppers', id: 'nema17-42' };
const SHARED_STEPPER_ROW = {
  id: 'stepper-shared-nema17',
  type: 'stepper',
  kind: 'stepper',
  sharedPart: STEPPER_REF,
  nameplate: { detentTorqueMnm: 18, rotorInertiaGcm2: 68, dampingRatio: 0.2 },
  note: 'detent torque, rotor inertia and damping ratio are this lab modelling defaults',
  usedBy: [],
};
const FIXTURE_STEPPER_FLAT = {
  id: 'nema17-42', name: 'Fixture NEMA 17 0.9 deg', massG: 310, approxUsd: 19,
  stepsPerRev: 400, phaseOhms: 2.1, phaseMh: 4.2, ratedAmps: 1.5, holdingTorqueMnm: 460,
  source: 'fixture stepper datasheet (400 steps/rev, 2.1 ohm, 4.2 mH, 1.5 A, 460 mN m)',
};

function stepperFixture(ownerJson, drivers = [SHARED_STEPPER_ROW]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-stepper-'));
  const file = path.join(root, 'circuit-lab', 'catalog', 'drivers.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, drivers }));
  if (ownerJson !== null) {
    const ownerFile = path.join(root, STEPPER_REF.owner, ...STEPPER_REF.file.split('/'));
    fs.mkdirSync(path.dirname(ownerFile), { recursive: true });
    fs.writeFileSync(ownerFile, typeof ownerJson === 'string' ? ownerJson : JSON.stringify(ownerJson));
  }
  return { root, file };
}

test('a shared STEPPER is READ from its owner (flat or nested stepper block) and moves when the owner changes numbers', () => {
  const first = stepperFixture({ steppers: [FIXTURE_STEPPER_FLAT] });
  const r1 = loadDriverCatalog(first.file);
  assert.deepEqual(r1.unresolved, []);
  const row1 = r1.drivers[0];
  assert.equal(row1.name, FIXTURE_STEPPER_FLAT.name);
  assert.equal(row1.massG, 310);
  assert.equal(row1.approxUsd, 19);
  assert.match(row1.source, /fixture stepper datasheet/);
  assert.match(row1.source, /fixture-motion\/catalog\/steppers\.json#nema17-42/);
  assert.deepEqual(row1.sharedFrom, STEPPER_REF);
  assert.equal(row1.nameplate.stepsPerRev, 400);
  assert.equal(row1.nameplate.phaseOhms, 2.1);
  assert.equal(row1.nameplate.phaseMh, 4.2);
  assert.equal(row1.nameplate.ratedAmps, 1.5);
  assert.equal(row1.nameplate.holdingTorqueMnm, 460);
  assert.equal(row1.nameplate.detentTorqueMnm, 18);
  assert.equal(row1.nameplate.rotorInertiaGcm2, 68);
  assert.equal(row1.nameplate.dampingRatio, 0.2);
  fs.rmSync(first.root, { recursive: true, force: true });

  const nestedOwner = {
    steppers: [{
      id: 'nema17-42', name: 'Fixture NEMA 23 High-Torque', massG: 650, approxUsd: 34,
      source: 'nested stepper block datasheet',
      stepper: { stepsPerRev: 200, phaseOhms: 0.9, phaseMh: 2.5, ratedAmps: 2.8, holdingTorqueMnm: 1260 },
    }],
  };
  const second = stepperFixture(nestedOwner);
  const r2 = loadDriverCatalog(second.file);
  assert.deepEqual(r2.unresolved, []);
  assert.equal(r2.drivers[0].name, 'Fixture NEMA 23 High-Torque');
  assert.equal(r2.drivers[0].massG, 650);
  assert.equal(r2.drivers[0].nameplate.stepsPerRev, 200);
  assert.equal(r2.drivers[0].nameplate.holdingTorqueMnm, 1260);
  assert.equal(r2.drivers[0].nameplate.dampingRatio, 0.2, 'local modelling defaults still apply');
  fs.rmSync(second.root, { recursive: true, force: true });
});

test('with a stepper owner absent the shared stepper is WITHHELD naming the owner while owned rows still load', () => {
  const owned = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.id === 'stepper-nema17-17hs4401');
  const { root, file } = stepperFixture(null, [owned, SHARED_STEPPER_ROW]);
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.deepEqual(drivers.map((r) => r.id), ['stepper-nema17-17hs4401'], 'owned stepper still loads');
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].id, SHARED_STEPPER_ROW.id);
  assert.equal(unresolved[0].type, 'stepper');
  assert.equal(unresolved[0].owner, STEPPER_REF.owner);
  assert.match(unresolved[0].reason, /fixture-motion owns this part and is not installed/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a stepper owner that cannot answer or omits a required stepper field withholds the row with the reason', () => {
  const cases = [
    [{ steppers: [{ ...FIXTURE_STEPPER_FLAT, id: 'other' }] }, /no row nema17-42/],
    [{ motors: [] }, /has no steppers list/],
    ['{ not json', /could not be read/],
    [{ steppers: [{ ...FIXTURE_STEPPER_FLAT, stepper: 'bad' }] }, /invalid stepper block/],
    [{ steppers: [{ ...FIXTURE_STEPPER_FLAT, stepsPerRev: 0 }] }, /stepsPerRev/],
    [{ steppers: [{ ...FIXTURE_STEPPER_FLAT, phaseOhms: 'low' }] }, /phaseOhms/],
    [{ steppers: [{ ...FIXTURE_STEPPER_FLAT, phaseMh: undefined }] }, /phaseMh/],
    [{ steppers: [{ ...FIXTURE_STEPPER_FLAT, ratedAmps: -1 }] }, /ratedAmps/],
    [{ steppers: [{ ...FIXTURE_STEPPER_FLAT, holdingTorqueMnm: null }] }, /holdingTorqueMnm/],
    [{ steppers: [{ id: 'nema17-42', name: 'Nested', massG: 300, approxUsd: 15, source: 's', stepper: { stepsPerRev: 200, phaseOhms: 1.5, phaseMh: 2.8, ratedAmps: 1.7 } }] }, /stepper\.holdingTorqueMnm/],
  ];
  for (const [ownerJson, reason] of cases) {
    const { root, file } = stepperFixture(ownerJson);
    const { drivers, unresolved } = loadDriverCatalog(file);
    assert.equal(drivers.length, 0, `${reason}: withheld`);
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].owner, STEPPER_REF.owner);
    assert.match(unresolved[0].reason, reason);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restating an owner-owned stepper field is refused at load naming the field, and unknown types with no reader stay refused', () => {
  const cases = [
    [{ ...SHARED_STEPPER_ROW, name: 'my stepper' }, 'drivers[0].name'],
    [{ ...SHARED_STEPPER_ROW, massG: 280 }, 'drivers[0].massG'],
    [{ ...SHARED_STEPPER_ROW, approxUsd: 12 }, 'drivers[0].approxUsd'],
    [{ ...SHARED_STEPPER_ROW, source: 'local copy' }, 'drivers[0].source'],
    [{ ...SHARED_STEPPER_ROW, nameplate: { ...SHARED_STEPPER_ROW.nameplate, stepsPerRev: 200 } }, 'drivers[0].nameplate.stepsPerRev'],
    [{ ...SHARED_STEPPER_ROW, nameplate: { ...SHARED_STEPPER_ROW.nameplate, phaseOhms: 1.5 } }, 'drivers[0].nameplate.phaseOhms'],
    [{ ...SHARED_STEPPER_ROW, nameplate: { ...SHARED_STEPPER_ROW.nameplate, phaseMh: 2.8 } }, 'drivers[0].nameplate.phaseMh'],
    [{ ...SHARED_STEPPER_ROW, nameplate: { ...SHARED_STEPPER_ROW.nameplate, ratedAmps: 1.7 } }, 'drivers[0].nameplate.ratedAmps'],
    [{ ...SHARED_STEPPER_ROW, nameplate: { ...SHARED_STEPPER_ROW.nameplate, holdingTorqueMnm: 400 } }, 'drivers[0].nameplate.holdingTorqueMnm'],
    [{ ...SHARED_STEPPER_ROW, note: '' }, 'drivers[0].note'],
  ];
  for (const [row, field] of cases) {
    const { root, file } = stepperFixture({ steppers: [FIXTURE_STEPPER_FLAT] }, [row]);
    assert.throws(() => loadDriverCatalog(file), (e) => e instanceof ContractError && e.field === field, field);
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(sharedReaderFor('linear-actuator', 'linear'), undefined, 'an unknown type has no sharedPart reader');
  const badType = stepperFixture({ steppers: [FIXTURE_STEPPER_FLAT] }, [{ ...SHARED_STEPPER_ROW, type: 'linear-actuator' }]);
  assert.throws(() => loadDriverCatalog(badType.file), (e) => e instanceof ContractError && e.field === 'drivers[0].type', 'an unknown type with sharedPart is refused at load rather than half-resolved');
  fs.rmSync(badType.root, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Installed ALONE: the environment the fail-closed read exists for.
//
// A store package installs on its own, and the framework's Test Lab runs a package case against a
// snapshot of ONE package directory with no siblings (snapshotPackageTests). That is also the
// operator case of installing Circuit Lab without Animatronics. The read above is designed for it;
// this is the guard that the package's OWN suites still agree, because the way this broke was not
// the read failing - it was two suites asserting the degradation could not happen.
// ─────────────────────────────────────────────────────────────────────────────
const PACKAGE_DIR = path.resolve(__dirname, '..');

/**
 * @description Copy this package ALONE into an empty directory and run one of its own suites there
 * in a child process, exactly as a single-package install would.
 * @param {string[]} files Package-relative suite paths to run.
 * @param {(packageDir: string) => void} [mutate] Edit the copy before running it.
 * @returns {{ status: number|null, output: string }} The child's exit status and its TAP output.
 */
function runInstalledAlone(files, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-alone-'));
  const installed = path.join(root, 'circuit-lab');
  fs.cpSync(PACKAGE_DIR, installed, { recursive: true });
  if (mutate) mutate(installed);
  const env = { ...process.env };
  // MEASURED: a `node --test` child that inherits NODE_TEST_CONTEXT reports to its parent over a
  // side channel and exits 0 EVEN WHEN ITS TESTS FAIL. This case runs under node:test, so without
  // this delete the guard would read every red isolated suite as green. The second case below is
  // what proves the delete is doing its job.
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: installed, env, encoding: 'utf8' });
  fs.rmSync(root, { recursive: true, force: true });
  return { status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

test('installed ALONE, with no owner beside it, this package\u2019s own catalog suite still passes', () => {
  // Alone, all five animatronics servos plus both embodied motors and the 12 V bus servo are withheld, and the suite must agree.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-empty-'));
  assert.deepEqual(missingSharedOwners(FILE, empty).map((m) => m.id).sort(), [...EMBODIED_IDS, ...ANIMATRONICS_IDS].sort());
  fs.rmSync(empty, { recursive: true, force: true });
  const run = runInstalledAlone(['tests/driver-catalog.test.js']);
  assert.equal(run.status, 0, `the catalog suite must pass against a single-package install:\n${run.output}`);
  assert.match(run.output, /^# fail 0$/m, 'nothing failed');
  assert.match(run.output, /^# pass [1-9]\d*$/m, 'and cases actually ran - a suite that runs nothing is not a green one');
});

test('and the guard can see red: put back the assumption that the owner is always installed, and the isolated run fails', () => {
  // The semantic mutation is the defect itself: `missing` forced to empty is the suite claiming the
  // degradation cannot happen. If this case ever passes as green, the guard above is not reading the
  // child's verdict and is worth nothing.
  const anchor = 'const missing = missingSharedOwners(FILE);';
  const run = runInstalledAlone(['tests/driver-catalog.test.js'], (installed) => {
    const file = path.join(installed, 'tests', 'driver-catalog.test.js');
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(source.includes(anchor), 'the mutation anchor is still in the suite being guarded');
    fs.writeFileSync(file, source.replace(anchor, 'const missing = [];'), 'utf8');
  });
  assert.notEqual(run.status, 0, `an isolated run that assumes the owner is installed must FAIL:\n${run.output}`);
  assert.match(run.output, /^# fail [1-9]\d*$/m);
  assert.match(run.output, /driver-catalog\.test\.js/, 'and it is the guarded suite that went red');
});
