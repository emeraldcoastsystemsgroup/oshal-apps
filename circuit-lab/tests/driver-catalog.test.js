/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the shaft-driver catalog under plain node: every row
 *                     |                             | validates against the part contract (a nameplate that drifts
 *                     |                             | from the contract fails the load, naming the row and field),
 *                     |                             | the rows filter by type, a row every embodied fit names is
 *                     |                             | present with the SAME name, mass and price as embodied's own
 *                     |                             | parts model (read-only cross-package import — B4: the motor
 *                     |                             | is declared once per number and both packages agree).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The load answers { drivers, unresolved } now that a row may name
 *                     |                             | another package as the owner of a real part and read it; the
 *                     |                             | shared-row behaviour itself is proved in shared-parts.test.js.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ASSERT THE CONTRACT, NOT ONE ENVIRONMENT. Entry 2 shipped a
 *                     |                             | fail-closed degradation - an absent owner withholds its row -
 *                     |                             | and then asserted `unresolved` was empty and five rows loaded,
 *                     |                             | which is a claim that the degradation never happens. It does:
 *                     |                             | store packages install one at a time, the framework's Test Lab
 *                     |                             | snapshots ONE package directory with no siblings, and a person
 *                     |                             | may install this lab without Animatronics. Measured: this suite
 *                     |                             | went RED (1 of 3 cases) against a copy of this package alone.
 *                     |                             | The case now reads the environment - which owners are actually
 *                     |                             | installed - and holds the load to what the contract promises
 *                     |                             | there: the full set with the owner present, exactly the
 *                     |                             | owner-absent rows withheld with a reason naming the owner
 *                     |                             | without it, and never a row invented in its place.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadDriverCatalog, listDrivers } = require(path.resolve(__dirname, '..', 'routes', 'driver-catalog.js'));
const { declaredDrivers, missingSharedOwners } = require(path.resolve(__dirname, 'shared-part-owners.js'));
const c = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));
const FILE = path.resolve(__dirname, '..', 'catalog', 'drivers.json');
const EMBODIED_PARTS = path.resolve(__dirname, '..', '..', 'embodied', 'routes', 'engine', 'design', 'parts-model.js');

test('every catalog row validates against the part contract and carries its provenance', () => {
  // THE CONTRACT HAS TWO HALVES, so this reads the environment instead of assuming one of them.
  // A shared row resolves when its owner package is installed beside this one and is WITHHELD when
  // it is not, and both are correct: store packages install one at a time, the Test Lab runs a
  // package case against a snapshot of one package directory with no siblings, and a person may
  // install this lab without Animatronics. Pinning the resolved count instead reds the package in
  // exactly the environment the fail-closed read was written for.
  const declared = declaredDrivers(FILE);
  const missing = missingSharedOwners(FILE);
  const { drivers: rows, unresolved } = loadDriverCatalog(FILE);
  assert.ok(declared.length >= 5, 'the catalog declares at least the five shipped rows');
  assert.equal(rows.length, declared.length - missing.length, 'every declared row loads except the ones whose owner is not installed');
  assert.deepEqual(unresolved.map((u) => u.id).sort(), missing.map((m) => m.id).sort(), 'exactly the rows whose owner is absent are withheld');
  for (const withheld of unresolved) {
    // Withholding is never silent: the caller is told which row went and who owns it.
    assert.match(withheld.reason, new RegExp(withheld.owner), `${withheld.id}: the reason names the owner`);
    assert.equal(rows.find((r) => r.id === withheld.id), undefined, `${withheld.id}: nothing is invented in the owner's place`);
  }
  for (const row of rows) {
    assert.ok(c.DRIVER_TYPES.includes(row.type), row.id);
    assert.deepEqual(row.nameplate, c.validateProps(row.type, row.nameplate, row.id), `${row.id}: the nameplate is complete (defaults filled) and in range`);
    assert.ok(row.source.length > 20, `${row.id} says where its numbers came from`);
    assert.ok(row.massG >= 0 && row.approxUsd >= 0);
  }
  const served = (type) => declared.filter((r) => r.type === type && !missing.some((m) => m.id === r.id)).map((r) => r.id);
  assert.deepEqual(listDrivers(rows, 'servo').map((r) => r.id), served('servo'));
  assert.deepEqual(listDrivers(rows, 'stepper').map((r) => r.id), ['stepper-nema17-17hs4401'], 'a row this package owns outright loads either way');
  assert.equal(listDrivers(rows).length, rows.length);
  const part = c.validatePart({ id: 'M1', type: 'motor', props: rows.find((r) => r.id === 'bl-2306-1800kv').nameplate });
  assert.equal(part.props.noLoadRpm, 26640);
});

test('a row that drifts from the contract fails the load naming the row and the field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-catalog-'));
  const write = (drivers) => { const f = path.join(dir, 'drivers.json'); fs.writeFileSync(f, JSON.stringify({ version: 1, drivers })); return f; };
  const good = JSON.parse(fs.readFileSync(FILE, 'utf8')).drivers[0];
  assert.throws(() => loadDriverCatalog(write([{ ...good, nameplate: { ...good.nameplate, stallAmps: 0 } }])), (e) => e instanceof c.ContractError && e.field === 'drivers[0].props.stallAmps');
  assert.throws(() => loadDriverCatalog(write([{ ...good, nameplate: { ...good.nameplate, kv: 5 } }])), (e) => e.field === 'drivers[0].props.kv');
  assert.throws(() => loadDriverCatalog(write([{ ...good, type: 'gear' }])), (e) => e.field === 'drivers[0].type');
  assert.throws(() => loadDriverCatalog(write([good, good])), (e) => e.field === 'drivers[1].id');
  assert.throws(() => loadDriverCatalog(write([{ ...good, source: '' }])), (e) => e.field === 'drivers[0].source');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the motors embodied\'s parts model names are in the catalog with the same name, mass and price', { skip: !fs.existsSync(EMBODIED_PARTS) && 'embodied is not checked out beside this package' }, () => {
  const { DRONE_FITS } = require(EMBODIED_PARTS);
  const { drivers: rows } = loadDriverCatalog(FILE);
  for (const fit of Object.values(DRONE_FITS)) {
    const row = rows.find((r) => r.name === fit.motor.name);
    assert.ok(row, `embodied fit ${fit.id} uses "${fit.motor.name}", which the catalog must carry`);
    assert.equal(row.massG, fit.motor.massEachG, `${row.id}: mass agrees with embodied`);
    assert.equal(row.approxUsd, fit.motor.approxUsdEach, `${row.id}: price agrees with embodied`);
    assert.ok(row.usedBy.includes('embodied:' + fit.id), `${row.id} records its use by embodied:${fit.id}`);
    assert.equal(row.type, 'motor');
  }
});
