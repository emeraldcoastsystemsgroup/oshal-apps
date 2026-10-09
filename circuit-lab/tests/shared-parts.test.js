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
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { loadDriverCatalog, listDrivers } = require(path.resolve(__dirname, '..', 'routes', 'driver-catalog.js'));
const { ContractError } = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));
const { missingSharedOwners } = require(path.resolve(__dirname, 'shared-part-owners.js'));

const PACKAGES_ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.resolve(__dirname, '..', 'catalog', 'drivers.json');
const SHARED_ID = 'servo-micro-9g';
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
  servos: [],
};

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

/** A minimal owner catalog carrying one servo row. */
function ownerCatalogWith(row) {
  return { servos: [row], controllers: [] };
}

const OWNER_ROW = {
  id: 'sg90', name: 'A DIFFERENT SERVO', kind: 'hobby', massG: 11.5, approxUsd: 7,
  voltsMin: 4.5, voltsMax: 6.5, pulseMinUs: 600, pulseMaxUs: 2300, travelDeg: 170,
  secondsPer60: 0.15, stallKgCm: 2.5, idleMa: 12, movingMa: 260, stallMa: 820,
  source: 'a fixture row, so that a read can be told from a copy', usedBy: [],
};

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

test('with the owner absent the row is WITHHELD naming the owner, and the rest of the catalog still loads', () => {
  const { root, file } = fixtureRoot(null);
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.equal(drivers.find((r) => r.id === SHARED_ID), undefined, 'nothing is invented in the owner place');
  assert.equal(listDrivers(drivers, 'servo').length, 0);
  const outright = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.filter((r) => !r.sharedPart).map((r) => r.id);
  for (const id of [...outright, ...MOTOR_IDS]) assert.ok(drivers.some((r) => r.id === id), `${id} still loads: its owner is not the one missing`);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].id, SHARED_ID);
  assert.equal(unresolved[0].owner, 'animatronics');
  assert.match(unresolved[0].reason, /animatronics/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an owner that is installed but cannot answer withholds the row with the reason, never a guess', () => {
  const cases = [
    [ownerCatalogWith({ ...OWNER_ROW, id: 'something-else' }), /no row .*sg90/i],
    [{ controllers: [] }, /servos/i],
    ['{ not json', /could not be read|parse/i],
    [ownerCatalogWith({ ...OWNER_ROW, stallKgCm: 'heavy' }), /stallKgCm/],
  ];
  for (const [ownerJson, reason] of cases) {
    const { root, file } = fixtureRoot(ownerJson);
    const { drivers, unresolved } = loadDriverCatalog(file);
    assert.equal(drivers.find((r) => r.id === SHARED_ID), undefined);
    assert.equal(unresolved.length, 1);
    assert.match(unresolved[0].reason, reason);
    assert.equal(unresolved[0].owner, 'animatronics');
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

test('against the real tree the lab and the owner describe the SAME servo', { skip: !fs.existsSync(OWNER_LOADER) && 'animatronics is not checked out beside this package' }, () => {
  const { loadServoCatalog, maxDegPerSOf } = require(OWNER_LOADER);
  const owner = loadServoCatalog(OWNER_CATALOG).servos.find((s) => s.id === 'sg90');
  assert.ok(owner, 'animatronics owns the sg90 row');
  const row = loadDriverCatalog(FILE).drivers.find((r) => r.id === SHARED_ID);
  assert.ok(row, 'the shared row resolves against the real packages root');
  assert.equal(row.name, owner.name);
  assert.equal(row.massG, owner.massG);
  assert.equal(row.approxUsd, owner.approxUsd);
  assert.ok(row.source.includes(owner.source), 'the provenance the owner wrote travels with the row');
  assert.equal(row.nameplate.minPulseMs, owner.pulseMinUs / 1000);
  assert.equal(row.nameplate.maxPulseMs, owner.pulseMaxUs / 1000);
  assert.equal(row.nameplate.travelDeg, owner.travelDeg);
  assert.equal(row.nameplate.noLoadDegPerS, maxDegPerSOf(owner));
  assert.equal(row.nameplate.stallAmps, owner.stallMa / 1000);
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

test('with embodied absent exactly the two motor rows are WITHHELD naming embodied, and the rest of the catalog still loads', () => {
  const { root, file } = fixtureRoot(ownerCatalogWith(OWNER_ROW), null);
  const { drivers, unresolved } = loadDriverCatalog(file);
  assert.deepEqual(unresolved.map((u) => u.id).sort(), [...MOTOR_IDS].sort());
  for (const u of unresolved) {
    assert.equal(u.owner, 'embodied');
    assert.equal(u.type, 'motor');
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
  const stepper = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers.find((r) => r.type === 'stepper');
  const made = fixtureRoot(ownerCatalogWith(OWNER_ROW));
  fs.writeFileSync(made.file, JSON.stringify({ version: 1, drivers: [{ ...stepper, name: undefined, massG: undefined, approxUsd: undefined, source: undefined, note: 'n', sharedPart: { owner: 'embodied', file: 'routes/engine/design/parts-catalog.json', list: 'steppers', id: 'x1' } }] }));
  assert.throws(() => loadDriverCatalog(made.file), (e) => e instanceof ContractError && e.field === 'drivers[0].sharedPart', 'a stepper still has no reader, and is refused rather than half-resolved');
  fs.rmSync(made.root, { recursive: true, force: true });
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
  // Alone, the SG90 (animatronics) and both motors (embodied) are withheld, and the suite must agree.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-empty-'));
  assert.deepEqual(missingSharedOwners(FILE, empty).map((m) => m.id).sort(), [...MOTOR_IDS, SHARED_ID].sort());
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
