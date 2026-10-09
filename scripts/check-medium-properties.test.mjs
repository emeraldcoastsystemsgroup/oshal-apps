/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-proof the medium-property drift guard (ADR-160 S5). A disposable one-row store is built from the REAL committed medium row and the exact foreign declaration lines, and every case changes exactly one thing: each of the seven foreign constants the row names (both ocean-lab seawater densities, the kinematic viscosity, aero-lab's T0, both Sutherland constants and the ISA ladder's sea-level density) goes red on its own and names its file; the row itself going red is proven from the other side; a commented-out declaration beside the live one does not count; a deleted constant fails CLOSED rather than passing as "nothing to compare"; and a check the row declares that the guard does not implement fails closed too. The last case pins the real store, so an edit to any lab's copy of seawater turns this suite red before it turns three labs into three answers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, FOREIGN_FILES, ROW_FILE, mediumPropertyDrift, pyNumericConstant, tsNumericConstant } from './check-medium-properties.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The real committed row, read once: the fixture must drift from THIS, not from a copy that could itself drift. */
const REAL_ROW = fs.readFileSync(path.join(REPOSITORY_ROOT, ROW_FILE), 'utf8');

/** The foreign declarations exactly as the store carries them, one file per label. */
const FOREIGN = {
  oceanPowerBudget: [
    '/** @description Density of seawater at typical coastal temperature/salinity, kg/m³. */',
    'export const SEAWATER_DENSITY_KGM3 = 1025;',
    '',
  ].join('\n'),
  oceanRotorPresets: [
    '/** @description Seawater density at coastal temperature and salinity, kg/m³. */',
    'export const SEAWATER_DENSITY_KGM3 = 1025;',
    '',
  ].join('\n'),
  oceanSectionPolar: [
    '/** @description Kinematic viscosity of seawater at coastal temperature and salinity, m²/s. */',
    'export const SEAWATER_KINEMATIC_VISCOSITY_M2S = 1.05e-6;',
    '',
  ].join('\n'),
  aeroAtmosphere: [
    'R_STAR_J_PER_KMOL_K = 8314.32          # universal gas constant, J/(kmol*K)',
    'M_AIR_KG_PER_KMOL = 28.9644            # mean molar mass of dry air, kg/kmol',
    'R_AIR_J_PER_KG_K = R_STAR_J_PER_KMOL_K / M_AIR_KG_PER_KMOL   # 287.0528 J/(kg*K)',
    'G0_M_PER_S2 = 9.80665                  # standard gravity at h = 0, m/s2',
    'GAMMA_AIR = 1.4                        # ratio of specific heats, dimensionless',
    'SUTHERLAND_C1_PA_S_PER_SQRT_K = 1.458e-6   # Pa*s/(K^0.5), from the project spec',
    'SUTHERLAND_S_K = 110.4                     # Sutherland temperature, K',
    '_T0_K = 288.15          # sea-level standard temperature, K',
    '_P0_PA = 101325.0       # sea-level standard pressure, Pa',
    '    for z_m, want_rho in ((0.0, 1.2250), (5000.0, 0.7364), (10000.0, 0.4135),',
    '',
  ].join('\n'),
};

/**
 * @description Build a disposable store holding only the files the guard reads, with one optional
 *  edit applied to one of them.
 * @param {import('node:test').TestContext} t The test, for cleanup.
 * @param {{ file?: string, from?: string, to?: string, row?: string }} [edit] One replacement in one foreign file, or a replacement row.
 * @returns {string} The fixture root.
 */
function createFixture(t, edit = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-medium-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, body) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  write(ROW_FILE, edit.row ?? REAL_ROW);
  for (const [label, relative] of Object.entries(FOREIGN_FILES)) {
    let body = FOREIGN[label];
    if (edit.file === label) {
      assert.ok(body.includes(edit.from), `fixture ${label} does not contain ${JSON.stringify(edit.from)}`);
      body = body.replace(edit.from, edit.to);
    }
    write(relative, body);
  }
  return root;
}

test('the fixture built from the real row and the real declaration lines passes', (t) => {
  assert.deepEqual(mediumPropertyDrift(createFixture(t)), []);
});

test('the guard implements one comparison per check the row declares, in order', () => {
  const row = JSON.parse(REAL_ROW);
  assert.equal(CHECKS.length, row.driftTest.checks.length);
  assert.deepEqual(CHECKS.map((c) => c.index), row.driftTest.checks.map((_c, i) => i));
});

const MUTATIONS = [
  { name: 'ocean-lab power-budget.ts SEAWATER_DENSITY_KGM3', file: 'oceanPowerBudget', from: '= 1025;', to: '= 1000;', names: /power-budget\.ts SEAWATER_DENSITY_KGM3/ },
  { name: 'ocean-lab rotor-presets.ts SEAWATER_DENSITY_KGM3', file: 'oceanRotorPresets', from: '= 1025;', to: '= 1026;', names: /rotor-presets\.ts SEAWATER_DENSITY_KGM3/ },
  { name: 'ocean-lab section-polar.ts SEAWATER_KINEMATIC_VISCOSITY_M2S', file: 'oceanSectionPolar', from: '= 1.05e-6;', to: '= 1.04e-6;', names: /section-polar\.ts SEAWATER_KINEMATIC_VISCOSITY_M2S/ },
  { name: 'aero-lab atmosphere.py _T0_K', file: 'aeroAtmosphere', from: '_T0_K = 288.15', to: '_T0_K = 288.16', names: /_T0_K/ },
  { name: 'aero-lab atmosphere.py SUTHERLAND_C1_PA_S_PER_SQRT_K', file: 'aeroAtmosphere', from: '= 1.458e-6', to: '= 1.459e-6', names: /Sutherland mu\(T0\)/ },
  { name: 'aero-lab atmosphere.py SUTHERLAND_S_K', file: 'aeroAtmosphere', from: 'SUTHERLAND_S_K = 110.4', to: 'SUTHERLAND_S_K = 110.5', names: /Sutherland mu\(T0\)/ },
  { name: 'aero-lab atmosphere.py ISA ladder rho(0.0)', file: 'aeroAtmosphere', from: '(0.0, 1.2250)', to: '(0.0, 1.2260)', names: /ISA ladder rho\(0\.0\)/ },
  { name: 'aero-lab atmosphere.py GAMMA_AIR', file: 'aeroAtmosphere', from: 'GAMMA_AIR = 1.4 ', to: 'GAMMA_AIR = 1.41', names: /sqrt\(GAMMA_AIR\*R_air\*T0\)/ },
];

for (const mutation of MUTATIONS) {
  test(`changing ${mutation.name} alone turns the guard red and names it`, (t) => {
    const problems = mediumPropertyDrift(createFixture(t, mutation));
    assert.ok(problems.length >= 1, `expected at least one problem, got ${JSON.stringify(problems)}`);
    assert.ok(problems.some((p) => mutation.names.test(p)), `no problem names ${mutation.names}: ${JSON.stringify(problems)}`);
    assert.ok(problems.every((p) => p.includes(FOREIGN_FILES[mutation.file])), `every problem must name the file that drifted: ${JSON.stringify(problems)}`);
  });
}

test('changing the committed ROW is caught from the other side: both ocean-lab densities, and the derived mu/rho, now disagree', (t) => {
  const row = REAL_ROW.replace('"densityKgM3": 1025,', '"densityKgM3": 1026,');
  assert.notEqual(row, REAL_ROW);
  const problems = mediumPropertyDrift(createFixture(t, { row }));
  assert.equal(problems.length, 3, JSON.stringify(problems));
  assert.match(problems[0], /power-budget\.ts SEAWATER_DENSITY_KGM3: the medium row carries 1026/);
  assert.match(problems[1], /rotor-presets\.ts SEAWATER_DENSITY_KGM3: the medium row carries 1026/);
  assert.match(problems[2], /section-polar\.ts SEAWATER_KINEMATIC_VISCOSITY_M2S \(row mu\/rho\)/, 'kinematic viscosity is DERIVED from the row, so a density edit moves it too');
});

test('a commented-out declaration beside the live one does not count', (t) => {
  const root = createFixture(t, {
    file: 'oceanPowerBudget',
    from: 'export const SEAWATER_DENSITY_KGM3 = 1025;',
    to: '// export const SEAWATER_DENSITY_KGM3 = 1000;\n/* export const SEAWATER_DENSITY_KGM3 = 999; */\nexport const SEAWATER_DENSITY_KGM3 = 1025;',
  });
  assert.deepEqual(mediumPropertyDrift(root), []);
  assert.equal(tsNumericConstant('// const X = 1;\n/* const X = 2; */\nconst X = 3;', 'X'), 3);
  assert.equal(pyNumericConstant('# X = 1\nX = 2  # the live one\n', 'X'), 2);
});

test('a deleted constant fails CLOSED: nothing to compare is a failure, not a pass', (t) => {
  const root = createFixture(t, { file: 'oceanSectionPolar', from: 'export const SEAWATER_KINEMATIC_VISCOSITY_M2S = 1.05e-6;', to: '' });
  const problems = mediumPropertyDrift(root);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /SEAWATER_KINEMATIC_VISCOSITY_M2S is not declared as a plain numeric literal/);
  const gone = createFixture(t, { file: 'aeroAtmosphere', from: '_P0_PA = 101325.0       # sea-level standard pressure, Pa\n', to: '' });
  assert.ok(mediumPropertyDrift(gone).some((p) => /_P0_PA is not declared/.test(p)));
});

test('a missing foreign file fails closed', (t) => {
  const root = createFixture(t);
  fs.rmSync(path.join(root, FOREIGN_FILES.aeroAtmosphere));
  const problems = mediumPropertyDrift(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /atmosphere\.py: cannot be read/);
});

test('a check the row declares that the guard does not implement fails closed', (t) => {
  const parsed = JSON.parse(REAL_ROW);
  parsed.driftTest.checks.push('seawater.properties.speedOfSoundMs == something nobody implemented');
  const problems = mediumPropertyDrift(createFixture(t, { row: JSON.stringify(parsed, null, 2) }));
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /declares 7 check\(s\) and this guard implements 6/);
});

test('this repository passes: every lab agrees with the committed row', () => {
  assert.deepEqual(mediumPropertyDrift(REPOSITORY_ROOT), []);
});
