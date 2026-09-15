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
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadDriverCatalog, listDrivers } = require(path.resolve(__dirname, '..', 'routes', 'driver-catalog.js'));
const c = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));
const FILE = path.resolve(__dirname, '..', 'catalog', 'drivers.json');
const EMBODIED_PARTS = path.resolve(__dirname, '..', '..', 'embodied', 'routes', 'engine', 'design', 'parts-model.js');

test('every catalog row validates against the part contract and carries its provenance', () => {
  const rows = loadDriverCatalog(FILE);
  assert.ok(rows.length >= 5);
  for (const row of rows) {
    assert.ok(c.DRIVER_TYPES.includes(row.type), row.id);
    assert.deepEqual(row.nameplate, c.validateProps(row.type, row.nameplate, row.id), `${row.id}: the nameplate is complete (defaults filled) and in range`);
    assert.ok(row.source.length > 20, `${row.id} says where its numbers came from`);
    assert.ok(row.massG >= 0 && row.approxUsd >= 0);
  }
  assert.deepEqual(listDrivers(rows, 'servo').map((r) => r.id), ['servo-micro-9g']);
  assert.deepEqual(listDrivers(rows, 'stepper').map((r) => r.id), ['stepper-nema17-17hs4401']);
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
  const rows = loadDriverCatalog(FILE);
  for (const fit of Object.values(DRONE_FITS)) {
    const row = rows.find((r) => r.name === fit.motor.name);
    assert.ok(row, `embodied fit ${fit.id} uses "${fit.motor.name}", which the catalog must carry`);
    assert.equal(row.massG, fit.motor.massEachG, `${row.id}: mass agrees with embodied`);
    assert.equal(row.approxUsd, fit.motor.approxUsdEach, `${row.id}: price agrees with embodied`);
    assert.ok(row.usedBy.includes('embodied:' + fit.id), `${row.id} records its use by embodied:${fit.id}`);
    assert.equal(row.type, 'motor');
  }
});
