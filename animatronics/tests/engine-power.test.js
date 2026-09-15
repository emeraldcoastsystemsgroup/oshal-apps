/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The supply budget and the servo catalog against the COMPILED engine: every catalog row validates and derives µs/° and deg/s; idle is the sum of idle currents; the peak counts only the servos moving in that frame (one servo moving on a seven-servo rig draws one moving current plus six idle); a USB port with more than one servo is refused; a servo outside its voltage range is refused; over 80 % is a warning; the all-stalled worst case is a note, not a refusal; an unknown model refuses; a malformed catalog row fails the load naming the field.
 *
 * Dependency-free: plain node against routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

const FILE = path.join(__dirname, '..', 'catalog', 'servos.json');
const catalog = E.loadServoCatalog(FILE);
const rows = E.servoMap(catalog.servos);
const skull = E.buildTemplates(rows).find((t) => t.id === 'skull');
const lib = { poses: skull.poses, scenarios: skull.scenarios };

test('every catalog row validates, says where its numbers came from, and derives calibration', () => {
  assert.ok(catalog.servos.length >= 5 && catalog.controllers.length >= 3);
  for (const s of catalog.servos) { assert.ok(s.source.length > 20, s.id); assert.ok(s.idleMa <= s.movingMa && s.movingMa <= s.stallMa, s.id); }
  const sg90 = rows.get('sg90');
  assert.equal(E.usPerDegOf(sg90), 10.56); assert.equal(E.maxDegPerSOf(sg90), 500);
  assert.equal(E.maxDegPerSOf(rows.get('mg996r')), 353);
  assert.equal(rows.get('feetech-sts3215').kind, 'bus');
});

test('idle is the sum, the peak counts only the servos moving in that frame', () => {
  const idle = E.budgetPower(skull.rig, rows);
  assert.equal(idle.idleA, 0.07, 'seven servos at 10 mA');
  assert.equal(idle.stallA, 10.4);
  assert.equal(idle.verdict, 'ok');
  assert.match(idle.notes[0], /all servos stalled would draw 10.4 A/);
  assert.deepEqual(idle.reasons, []);
  const jawOnly = E.compileSteps(skull.rig, lib, [{ kind: 'move', pose: 'JAW_OPEN', ms: 400, ease: 'linear' }]);
  const p = E.budgetPower(skull.rig, rows, jawOnly);
  assert.equal(p.peakMovingA, 0.56, 'one MG996R moving (500 mA) + six idle (60 mA)');
  assert.deepEqual(p.peakMovingChannels, ['jaw']);
  assert.ok(p.peakMovingFrame >= 1);
  assert.equal(p.headroom, 0.888);
  const scare = E.budgetPower(skull.rig, rows, E.compileSteps(skull.rig, lib, [{ kind: 'run', scenario: 'SCARE' }]));
  assert.ok(scare.peakMovingA > p.peakMovingA, 'more servos moving at once draws more');
});

test('USB, wrong voltage, an unknown model and a too-small supply refuse; 80 % warns', () => {
  const usb = E.budgetPower({ ...skull.rig, supply: { volts: 5, amps: 0.5, source: 'usb' } }, rows);
  assert.equal(usb.verdict, 'refuse'); assert.match(usb.reasons[0], /USB port is not an actuator supply/);
  const one = E.validateRig({ channels: [skull.rig.channels[0]], supply: { source: 'usb' } });
  assert.equal(E.budgetPower(one, rows).verdict, 'ok', 'one micro servo on USB for a bench test is allowed');
  const twelve = E.budgetPower({ ...skull.rig, supply: { volts: 12, amps: 5, source: 'bench' } }, rows);
  assert.equal(twelve.verdict, 'refuse'); assert.match(twelve.reasons[0], /takes 4.8–6 V, the supply is 12 V/);
  const unknown = E.budgetPower({ ...skull.rig, channels: [{ ...skull.rig.channels[0], model: 'mystery' }] }, rows);
  assert.equal(unknown.verdict, 'refuse'); assert.match(unknown.reasons[0], /not in the servo catalog/);
  const scare = E.compileSteps(skull.rig, lib, [{ kind: 'run', scenario: 'SCARE' }]);
  const small = E.budgetPower({ ...skull.rig, supply: { volts: 6, amps: 1, source: 'bench' } }, rows, scare);
  assert.equal(small.verdict, 'refuse'); assert.match(small.reasons[0], /peak draw .* A exceeds the 1 A supply/);
  const tight = E.budgetPower({ ...skull.rig, supply: { volts: 6, amps: 1.7, source: 'bench' } }, rows, scare);
  assert.equal(tight.verdict, 'warn'); assert.match(tight.reasons[0], /over 80 %/);
});

test('a malformed catalog row fails the load naming the field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-cat-'));
  const write = (mutate) => { const c = JSON.parse(fs.readFileSync(FILE, 'utf8')); mutate(c); const f = path.join(dir, 'servos.json'); fs.writeFileSync(f, JSON.stringify(c)); return f; };
  const expect = (mutate, field) => { try { E.loadServoCatalog(write(mutate)); } catch (e) { assert.equal(e.name, 'ContractError'); assert.equal(e.field, field, e.message); return; } assert.fail(`expected ${field}`); };
  expect((c) => { c.servos[0].stallMa = 1; }, 'servos[0].movingMa');
  expect((c) => { c.servos[1].id = c.servos[0].id; }, 'servos[1].id');
  expect((c) => { delete c.servos[2].source; }, 'servos[2].source');
  expect((c) => { c.servos[0].pulseMinUs = 3000; }, 'servos[0].pulseMinUs');
  expect((c) => { c.servos[0].kind = 'linear'; }, 'servos[0].kind');
  expect((c) => { c.controllers[0].outputs = 0; }, 'controllers[0].outputs');
  fs.rmSync(dir, { recursive: true, force: true });
});
