/**
 * Structural guards for the engine layer, asserted as BEHAVIOUR rather than as
 * source text.
 *
 * WHY THESE MATTER. The sensitivity sweep and the break-even search rebuild the
 * model thousands of times, and every difference in the result must come from the
 * input they changed. A clock read, a random number, a mutated input or a database
 * call would each break that silently — the chart would still render, it would
 * just be measuring something other than the assumption it names.
 *
 * So: the same input must produce byte-identical output; the input object must be
 * deep-equal to a pre-call snapshot afterwards; and every compiled engine module
 * must load in a child process with an EMPTY module resolution path, so any
 * framework, express or database import fails loudly rather than at deploy time.
 *
 * Grepping the source for `Date.now` would be a substring guard, and a substring
 * guard is not a guard — a helper called through an alias would sail past it.
 * These run the code instead.
 *
 * Dependency-free `node --test` suite over the COMPILED modules.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — byte-identical determinism across repeat builds, no input mutation, isolated child-process load of every compiled module with an empty resolution path, no clock dependence, and the built/source module-set parity check.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PKG, engine, ventureInput } = require('./fixture-venture');

const M = engine('venture-model');

const ENGINE_MODULES = [
  'venture-primitives', 'venture-issues', 'venture-assumptions', 'venture-bom',
  'venture-landed', 'venture-fba-tables', 'venture-channels', 'venture-demand',
  'venture-schedule', 'venture-headcount', 'venture-financials', 'venture-sensitivity',
  'venture-figures', 'venture-model',
];

test('every engine module is COMPILED and committed beside its source', () => {
  const src = fs.readdirSync(path.join(PKG, 'src-routes')).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''));
  const built = fs.readdirSync(path.join(PKG, 'routes')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
  for (const name of ENGINE_MODULES) {
    assert.ok(src.includes(name), `${name}.ts is present in src-routes/`);
    assert.ok(built.includes(name), `${name}.js is present in routes/ — the framework loads THIS, not the source`);
  }
});

test('each compiled engine module loads in isolation with an EMPTY module resolution path', () => {
  // A framework, express or pg import would resolve here through node_modules and
  // never be noticed until deploy. With NODE_PATH emptied and the package root
  // free of a node_modules directory, any such import throws.
  for (const name of ENGINE_MODULES) {
    const file = path.join(PKG, 'routes', `${name}.js`).replace(/\\/g, '\\\\');
    const out = execFileSync(process.execPath, [
      '-e',
      `require('${file}'); process.stdout.write('ok');`,
    ], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
    assert.equal(out, 'ok', `${name} loads with nothing but node built-ins available`);
  }
});

test('no engine module requires anything but its own siblings', () => {
  // The compiled output is what the framework mounts; a require that escapes the
  // bundle is a module that will not load there.
  const allowed = new Set(ENGINE_MODULES);
  for (const name of ENGINE_MODULES) {
    const js = fs.readFileSync(path.join(PKG, 'routes', `${name}.js`), 'utf8');
    for (const m of js.matchAll(/require\("([^"]+)"\)/g)) {
      const target = m[1];
      assert.ok(target.startsWith('./'), `${name} requires "${target}" — engine modules import nothing external`);
      assert.ok(allowed.has(target.slice(2)), `${name} requires "${target}", which is not a bundled engine module`);
    }
  }
});

test('the same input produces BYTE-IDENTICAL output — no clock, no randomness', () => {
  const a = M.buildVentureModel(ventureInput());
  const b = M.buildVentureModel(ventureInput());
  assert.equal(JSON.stringify(a.figures), JSON.stringify(b.figures));
  assert.equal(JSON.stringify(a.financials), JSON.stringify(b.financials));
  assert.equal(JSON.stringify(a.schedule.events), JSON.stringify(b.schedule.events));
  assert.equal(JSON.stringify(a.issues), JSON.stringify(b.issues));
  assert.equal(a.breakEven.units, b.breakEven.units);
  // Rebuilding the SAME object twice must also agree — a cached or mutated input
  // would show up here even when two fresh inputs do not.
  const input = ventureInput();
  assert.equal(
    JSON.stringify(M.buildVentureModel(input).figures),
    JSON.stringify(M.buildVentureModel(input).figures),
  );
});

test('building a model does not MUTATE its input', () => {
  const input = ventureInput();
  const before = JSON.stringify(input);
  M.buildVentureModel(input);
  M.rebuildWithVolume(input, 500);
  M.rebuildWithAssumption(input, 'freight.container.rate', 9_999_999);
  M.withLedger(input, { byId: { ...input.ledger.byId }, order: [...input.ledger.order] });
  assert.equal(JSON.stringify(input), before, 'the input object is untouched after every rebuild');
});

test('the modelling date is a PARAMETER, so the answer does not change with the wall clock', () => {
  // Two identical models differing only in `onDate` must differ ONLY where the
  // date legitimately matters (the dated marketplace fee card). With a direct
  // channel there is no dated card, so the results must be identical.
  const early = M.buildVentureModel(ventureInput({ onDate: '2026-01-01' }));
  const late = M.buildVentureModel(ventureInput({ onDate: '2029-12-31' }));
  assert.equal(
    JSON.stringify(early.financials.totals), JSON.stringify(late.financials.totals),
    'a direct-channel plan does not depend on when it was run',
  );
});

test('a marketplace plan DOES depend on the fee card date, and reports why', () => {
  const { amazonChannel } = require('./fixture-venture');
  const stale = { ...amazonChannel(), economics: { ...amazonChannel().economics, feeTableDate: '2029-12-31' } };
  const m = M.buildVentureModel(ventureInput({ channels: [stale] }));
  assert.ok(m.issues.some((i) => i.code === 'fee-table-stale'));
  // The staleness is a warning, not a block: an out-of-date rate card is a reason
  // to go and get the current one, not a reason to refuse to model at all.
  assert.ok(!m.issues.some((i) => i.code === 'fee-table-stale' && i.severity === 'block'));
});

test('every issue the model can raise carries a code, a severity, a place and a sentence', () => {
  const Iss = engine('venture-issues');
  const models = [
    M.buildVentureModel(ventureInput()),
    M.buildVentureModel(ventureInput({ runQtyUnits: 30 })),
    M.buildVentureModel(ventureInput({ timing: { ...ventureInput().timing, poMonth: '2026-08' } })),
  ];
  for (const m of models) {
    for (const i of m.issues) {
      assert.ok(['info', 'warn', 'block'].includes(i.severity), `${i.code} has a real severity`);
      assert.ok(i.where.includes(':') || i.where.length > 2, `${i.code} says where it came from`);
      assert.ok(i.message.length > 30, `${i.code} explains itself: "${i.message}"`);
    }
  }
  assert.equal(Iss.worstSeverity([]), 'info');
  assert.equal(Iss.worstSeverity([{ severity: 'info' }, { severity: 'block' }, { severity: 'warn' }]), 'block');
  assert.equal(Iss.hasBlocker([{ severity: 'warn' }]), false);
  assert.deepEqual(Iss.mergeIssues([{ severity: 'info' }], undefined, [{ severity: 'warn' }]).length, 2);
});

test('a run of 30 units degrades gracefully: LCL freight, no price break, still a real model', () => {
  const m = M.buildVentureModel(ventureInput({ runQtyUnits: 30 }));
  assert.equal(m.landed.mode, 'lcl');
  assert.ok(m.bom.lines.some((l) => l.outsideQuotedBands === false));
  // The shell drops to its $5.00 break; the fastener minimum dominates entirely.
  assert.equal(m.bom.lines.find((l) => l.componentId === 'shell').bandUnitCostMicros, 5_000_000);
  assert.ok(m.bom.lines.find((l) => l.componentId === 'screw').moqOverbuyMicros > 0);
  // Nothing is NaN anywhere in the figure registry.
  for (const [id, f] of Object.entries(m.figures)) assert.ok(Number.isFinite(f.value), `${id} is finite`);
});

test('a zero-volume model produces no numbers rather than nonsense ones', () => {
  const m = M.buildVentureModel(ventureInput({ runQtyUnits: 0 }));
  assert.equal(m.bom.recurringUnitMicros, null);
  assert.equal(m.landed.buyerUnitMicros, null);
  assert.ok(m.issues.some((i) => i.code === 'zero-volume'));
  // Null figures are absent from the registry, so a document cannot print one.
  assert.equal(m.figures['bom.recurringUnitMicros'], undefined);
  assert.equal(m.figures['landed.buyerUnitMicros'], undefined);
  for (const [id, f] of Object.entries(m.figures)) assert.ok(Number.isFinite(f.value), `${id} is finite`);
});
