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
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The embodied motor check is a READ-THROUGH equality now. The
 *                     |                             | two brushless rows no longer restate name, mass, price or KV:
 *                     |                             | they name embodied as the owner and read its row. The old case
 *                     |                             | matched a catalog row to each fit BY NAME, which a read makes
 *                     |                             | circular; this one goes through embodied's own compiled parts
 *                     |                             | model and its own row reader and requires the resolved row, the
 *                     |                             | owner's row and the fit's motor to agree on name, mass, price
 *                     |                             | and KV, with noLoadRpm = KV x this lab's operating point. The
 *                     |                             | brushless noLoadRpm check moved into it, because installed
 *                     |                             | alone that row is withheld, not loaded.
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
const EMBODIED_ROWS = path.resolve(__dirname, '..', '..', 'embodied', 'routes', 'engine', 'design', 'parts-catalog.js');

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
  const part = c.validatePart({ id: 'M1', type: 'motor', props: rows.find((r) => r.id === 'brushed-12v-generic').nameplate });
  assert.equal(part.props.noLoadRpm, 3000, 'a row this package owns outright is a nameplate the part contract accepts');
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

test('the motors embodied\'s fits fly are READ from embodied\'s own rows: the lab, the owner row and the fit agree', { skip: !(fs.existsSync(EMBODIED_PARTS) && fs.existsSync(EMBODIED_ROWS)) && 'embodied is not checked out beside this package' }, () => {
  // Read-through, not a name match: every value on the resolved row must equal what embodied's OWN
  // compiled code answers - its row reader (parts-catalog.js) and the fit it builds from that row
  // (parts-model.js) - so a drift in either package, or a row this lab restated, goes red here.
  const { DRONE_FITS } = require(EMBODIED_PARTS);
  const { motorRow } = require(EMBODIED_ROWS);
  const { drivers: rows } = loadDriverCatalog(FILE);
  const shared = declaredDrivers(FILE).filter((r) => r.type === 'motor' && r.sharedPart && r.sharedPart.owner === 'embodied');
  assert.equal(shared.length, Object.keys(DRONE_FITS).length, 'one shared motor row per embodied fit');
  for (const fit of Object.values(DRONE_FITS)) {
    const declared = shared.find((r) => r.usedBy.includes('embodied:' + fit.id));
    assert.ok(declared, `embodied fit ${fit.id}'s motor is a row here that names embodied as its owner`);
    const row = rows.find((r) => r.id === declared.id);
    assert.ok(row, `${declared.id} resolves against the real packages root`);
    const owner = motorRow(declared.sharedPart.id);
    for (const [ours, theirs, fits, what] of [[row.name, owner.name, fit.motor.name, 'name'], [row.massG, owner.massG, fit.motor.massEachG, 'mass'], [row.approxUsd, owner.approxUsd, fit.motor.approxUsdEach, 'price']]) {
      assert.equal(ours, theirs, `${row.id}: ${what} is embodied's row`);
      assert.equal(ours, fits, `${row.id}: ${what} is what embodied's ${fit.id} fit flies`);
    }
    assert.equal(row.kv, owner.propulsion.kv, `${row.id}: KV is embodied's`);
    assert.equal(row.nameplate.noLoadRpm, Math.round(owner.propulsion.kv * row.nameplate.nominalVolts), 'noLoadRpm is the owner KV at this lab\'s operating point');
    assert.ok(row.source.includes(owner.source), `${row.id}: the owner's source line travels with the row`);
    assert.deepEqual(row.sharedFrom, declared.sharedPart);
    assert.equal(row.type, 'motor');
  }
  const brushless = c.validatePart({ id: 'M1', type: 'motor', props: rows.find((r) => r.id === 'bl-2306-1800kv').nameplate });
  assert.equal(brushless.props.noLoadRpm, 26640, '1800 KV x 14.8 V');
});
