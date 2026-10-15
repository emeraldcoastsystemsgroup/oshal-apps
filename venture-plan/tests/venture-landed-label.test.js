/**
 * Guard for how the landed cost reads beside the factory cost.
 *
 * Sweep 13: a plan's summary read "a fully loaded factory cost of $48.32 per unit ... After channel deductions of
 * $20.24 and landed logistics of $53.75 per unit", adding the landed cost on top of the factory cost. The landed
 * figures include the ex-works goods (the BOM cost per unit), and their labels said only "Landed cost". The labels
 * now say the BOM cost is included, in the document table and in the figure table the strategist narrates from
 * (venture-run phaseNarrate builds it as "<label>: <value>").
 *
 * Real: the compiled model, figure registry and formatter over the shared fixture venture. Nothing is doubled.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the landed figures' labels say the BOM cost is included, their values carry it, and the narration's figure table is built from those labels.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { engine, ventureInput } = require('./fixture-venture');

const M = engine('venture-model');
const Fg = engine('venture-figures');

test('the landed figures say the BOM cost is included, and they carry it', () => {
  const m = M.buildVentureModel(ventureInput());
  const unit = m.figures['landed.buyerUnitMicros'];
  const run = m.figures['landed.buyerTotalMicros'];
  const bom = m.figures['bom.recurringUnitMicros'];
  assert.equal(unit.label, 'Landed cost per unit (BOM cost included)');
  assert.equal(run.label, 'Landed cost of the run (BOM spend included)');
  assert.ok(Number(unit.value) >= Number(bom.value), 'the landed unit cost includes the BOM cost per unit');
  const line = `${unit.label}: ${Fg.formatFigure(unit)}`;
  assert.match(line, /^Landed cost per unit \(BOM cost included\): \$/);
  const run_ = fs.readFileSync(path.join(__dirname, '..', 'src-routes', 'venture-run.ts'), 'utf8');
  assert.match(run_, /figureTable\[id\] = `\$\{f\.label\}: \$\{formatFigure\(f as never\)\}`/, 'the narration reads the label beside the value');
});
