#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S5 (first half): the cross-package medium-property drift guard. ADR-160 D3 forbids a runtime import between packages, so three labs answer "what is seawater" in three languages - ocean-lab's TypeScript constants, aero-lab's Python atmosphere, embodied's committed data row - and nothing but this file makes them agree. It reads embodied's medium-properties.json AS DATA and parses AS TEXT every foreign constant that row names in its driftTest.checks list, then fails when any pair disagrees: seawater density against BOTH of ocean-lab's declarations (power-budget.ts and rotor-presets.ts - the duplication the ADR diagnoses), seawater kinematic viscosity against section-polar.ts, and air's sea-level density, Sutherland viscosity, speed of sound and temperature against the constants atmosphere.py is built from. It imports nothing from any package, so the store's package-separation guard is not weakened, and it fails CLOSED: a constant it cannot find, a file it cannot read, or a check the row declares that this script does not implement is a failure, never a skip.
 *
 * Usage: node scripts/check-medium-properties.mjs [repository-root]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The one committed data row per medium (ADR-160 S1). Read as JSON, never imported as a module. */
export const ROW_FILE = 'embodied/src-routes/engine/medium/medium-properties.json';

/** The foreign declarations the row's driftTest.checks name, by the label each check below uses. */
export const FOREIGN_FILES = Object.freeze({
  oceanPowerBudget: 'ocean-lab/src-routes/engine/marine/services/power-budget.ts',
  oceanRotorPresets: 'ocean-lab/src-routes/engine/rotor-design/services/rotor-presets.ts',
  oceanSectionPolar: 'ocean-lab/src-routes/engine/rotor-design/services/section-polar.ts',
  aeroAtmosphere: 'aero-lab/engine/aerosim/env/atmosphere.py',
});

/**
 * Relative tolerance for a value the row carries ROUNDED against a value derived here from the
 * foreign constants at full precision. The air row quotes Sutherland viscosity to six significant
 * figures (relative distance 1.6e-7 from the exact value) and the speed of sound to seven
 * (2.3e-8); the ISA sea-level density 1.2250 is the table's own five-figure entry, 6.9e-7 from
 * p0/(R*T0). One part in 10^5 admits every one of those and refuses the smallest change a person
 * would type into any of them (a fourth-figure edit is 1e-4 or more).
 */
export const DERIVED_RELATIVE_TOLERANCE = 1e-5;

/**
 * @description Blank `//` line comments and block comments in TypeScript so a commented-out
 *  declaration is never read as a live one. String contents are not special-cased: no constant
 *  this guard reads sits inside a string.
 * @param {string} source The file text.
 * @returns {string} The same text with comments blanked, newlines preserved.
 */
export function stripTsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, before) => before);
}

/**
 * @description Read one numeric `const NAME = <number>;` declaration from TypeScript source.
 * @param {string} source The file text.
 * @param {string} name The constant's exact identifier.
 * @returns {number | null} The value, or null when the declaration is absent or not a plain numeric literal.
 */
export function tsNumericConstant(source, name) {
  const declaration = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*(?::\\s*number)?\\s*=\\s*([-+]?[0-9][0-9_]*(?:\\.[0-9_]+)?(?:[eE][-+]?[0-9]+)?)\\s*;`);
  const match = declaration.exec(stripTsComments(source));
  return match ? Number(match[1].replace(/_/g, '')) : null;
}

/**
 * @description Read one module-level `NAME = <number>` assignment from Python source. A `#`
 *  comment on the same line is ignored; a commented-out assignment is not matched because the
 *  name must start its line.
 * @param {string} source The file text.
 * @param {string} name The constant's exact identifier.
 * @returns {number | null} The value, or null when absent or not a plain numeric literal.
 */
export function pyNumericConstant(source, name) {
  const assignment = new RegExp(`(?:^|\\n)${name}\\s*=\\s*([-+]?[0-9][0-9_]*(?:\\.[0-9_]+)?(?:[eE][-+]?[0-9]+)?)\\s*(?:#[^\\n]*)?(?:\\n|$)`);
  const match = assignment.exec(source);
  return match ? Number(match[1].replace(/_/g, '')) : null;
}

/**
 * @description The sea-level entry of atmosphere.py's own ISA density ladder - the `(0.0, 1.2250)`
 *  reference pair the module checks itself against, which the air row names as its provenance.
 * @param {string} source The atmosphere.py text.
 * @returns {number | null} The density paired with 0.0 m, or null when the pair is absent.
 */
export function isaSeaLevelReferenceDensity(source) {
  const pair = /\(\s*0\.0\s*,\s*([0-9]+\.[0-9]+)\s*\)/.exec(source);
  return pair ? Number(pair[1]) : null;
}

/** @description Exact equality for a value the row carries verbatim. */
function exact(label, rowValue, foreignValue) {
  return rowValue === foreignValue ? null : `${label}: the medium row carries ${rowValue}, the foreign declaration is ${foreignValue}`;
}

/** @description Equality within DERIVED_RELATIVE_TOLERANCE for a value the row carries rounded. */
function derived(label, rowValue, foreignValue) {
  const distance = Math.abs(rowValue - foreignValue) / Math.abs(foreignValue);
  return distance <= DERIVED_RELATIVE_TOLERANCE
    ? null
    : `${label}: the medium row carries ${rowValue}, the foreign constants give ${foreignValue} (relative distance ${distance.toExponential(2)} > ${DERIVED_RELATIVE_TOLERANCE})`;
}

/**
 * @description Read a constant or fail closed: a constant nobody could find is a drift nobody
 *  checked, so it is returned as a problem rather than treated as agreement.
 * @param {Record<string, string>} sources The foreign file texts by label.
 * @param {string} file The FOREIGN_FILES label.
 * @param {string} name The constant.
 * @param {(source: string, name: string) => number | null} reader tsNumericConstant or pyNumericConstant.
 * @returns {{ value?: number, problem?: string }} The value, or the problem.
 */
function constant(sources, file, name, reader) {
  const value = reader(sources[file], name);
  return value === null
    ? { problem: `${FOREIGN_FILES[file]}: ${name} is not declared as a plain numeric literal - the guard cannot compare a value it cannot find` }
    : { value };
}

/**
 * One implemented comparison per line of the row's driftTest.checks, in the same order. `index`
 * is that line's position; a row that declares a check no entry here implements fails closed.
 */
export const CHECKS = Object.freeze([
  {
    index: 0,
    label: 'seawater density == ocean-lab SEAWATER_DENSITY_KGM3 in power-budget.ts AND rotor-presets.ts',
    evaluate({ row, sources }) {
      const problems = [];
      for (const file of ['oceanPowerBudget', 'oceanRotorPresets']) {
        const found = constant(sources, file, 'SEAWATER_DENSITY_KGM3', tsNumericConstant);
        if (found.problem) { problems.push(found.problem); continue; }
        const problem = exact(`${FOREIGN_FILES[file]} SEAWATER_DENSITY_KGM3`, row.media.seawater.properties.densityKgM3, found.value);
        if (problem) problems.push(problem);
      }
      return problems;
    },
  },
  {
    index: 1,
    label: 'seawater dynamicViscosityPaS / densityKgM3 == ocean-lab SEAWATER_KINEMATIC_VISCOSITY_M2S in section-polar.ts',
    evaluate({ row, sources }) {
      const found = constant(sources, 'oceanSectionPolar', 'SEAWATER_KINEMATIC_VISCOSITY_M2S', tsNumericConstant);
      if (found.problem) return [found.problem];
      const sea = row.media.seawater.properties;
      const problem = derived(`${FOREIGN_FILES.oceanSectionPolar} SEAWATER_KINEMATIC_VISCOSITY_M2S (row mu/rho)`, sea.dynamicViscosityPaS / sea.densityKgM3, found.value);
      return problem ? [problem] : [];
    },
  },
  {
    index: 2,
    label: 'air densityKgM3 == aero-lab atmosphere(0.0).rho_kgm3',
    evaluate({ row, sources }) {
      const problems = [];
      const ladder = isaSeaLevelReferenceDensity(sources.aeroAtmosphere);
      if (ladder === null) problems.push(`${FOREIGN_FILES.aeroAtmosphere}: the ISA density ladder's (0.0, rho) reference pair is absent`);
      else { const p = exact(`${FOREIGN_FILES.aeroAtmosphere} ISA ladder rho(0.0)`, row.media.air.properties.densityKgM3, ladder); if (p) problems.push(p); }
      const state = isaSeaLevelState(sources);
      if (state.problem) return [...problems, state.problem];
      const p = derived(`${FOREIGN_FILES.aeroAtmosphere} p0/(R_air*T0)`, row.media.air.properties.densityKgM3, state.p0 / (state.rAir * state.t0));
      if (p) problems.push(p);
      return problems;
    },
  },
  {
    index: 3,
    label: 'air dynamicViscosityPaS == aero-lab atmosphere(0.0).mu_Pas (Sutherland at T0)',
    evaluate({ row, sources }) {
      const t0 = constant(sources, 'aeroAtmosphere', '_T0_K', pyNumericConstant);
      const c1 = constant(sources, 'aeroAtmosphere', 'SUTHERLAND_C1_PA_S_PER_SQRT_K', pyNumericConstant);
      const s = constant(sources, 'aeroAtmosphere', 'SUTHERLAND_S_K', pyNumericConstant);
      const missing = [t0, c1, s].filter((c) => c.problem).map((c) => c.problem);
      if (missing.length) return missing;
      const mu = (c1.value * t0.value ** 1.5) / (t0.value + s.value);
      const problem = derived(`${FOREIGN_FILES.aeroAtmosphere} Sutherland mu(T0)`, row.media.air.properties.dynamicViscosityPaS, mu);
      return problem ? [problem] : [];
    },
  },
  {
    index: 4,
    label: 'air speedOfSoundMs == aero-lab atmosphere(0.0).a_ms (sqrt(gamma*R_air*T0))',
    evaluate({ row, sources }) {
      const state = isaSeaLevelState(sources);
      if (state.problem) return [state.problem];
      const gamma = constant(sources, 'aeroAtmosphere', 'GAMMA_AIR', pyNumericConstant);
      if (gamma.problem) return [gamma.problem];
      const problem = derived(`${FOREIGN_FILES.aeroAtmosphere} sqrt(GAMMA_AIR*R_air*T0)`, row.media.air.properties.speedOfSoundMs, Math.sqrt(gamma.value * state.rAir * state.t0));
      return problem ? [problem] : [];
    },
  },
  {
    index: 5,
    label: 'air temperatureK == aero-lab _T0_K',
    evaluate({ row, sources }) {
      const t0 = constant(sources, 'aeroAtmosphere', '_T0_K', pyNumericConstant);
      if (t0.problem) return [t0.problem];
      const problem = exact(`${FOREIGN_FILES.aeroAtmosphere} _T0_K`, row.media.air.properties.temperatureK, t0.value);
      return problem ? [problem] : [];
    },
  },
]);

/**
 * @description The sea-level state atmosphere.py is built from: p0, T0 and R_air = R_star / M_air.
 * @param {Record<string, string>} sources The foreign file texts by label.
 * @returns {{ p0?: number, t0?: number, rAir?: number, problem?: string }} The state, or the first missing constant.
 */
function isaSeaLevelState(sources) {
  const p0 = constant(sources, 'aeroAtmosphere', '_P0_PA', pyNumericConstant);
  const t0 = constant(sources, 'aeroAtmosphere', '_T0_K', pyNumericConstant);
  const rStar = constant(sources, 'aeroAtmosphere', 'R_STAR_J_PER_KMOL_K', pyNumericConstant);
  const mAir = constant(sources, 'aeroAtmosphere', 'M_AIR_KG_PER_KMOL', pyNumericConstant);
  const missing = [p0, t0, rStar, mAir].find((c) => c.problem);
  if (missing) return { problem: missing.problem };
  return { p0: p0.value, t0: t0.value, rAir: rStar.value / mAir.value };
}

/**
 * @description Read the row and every foreign file, failing closed on anything unreadable.
 * @param {string} repositoryRoot The store checkout.
 * @returns {{ row?: object, sources?: Record<string, string>, problems: string[] }} What was read, and what could not be.
 */
function readInputs(repositoryRoot) {
  const problems = [];
  let row;
  try {
    row = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ROW_FILE), 'utf8'));
  } catch (error) {
    return { problems: [`${ROW_FILE}: cannot be read as JSON (${error.message})`] };
  }
  for (const id of ['vacuum', 'air', 'seawater']) {
    if (!row?.media?.[id]?.properties) problems.push(`${ROW_FILE}: media.${id}.properties is missing`);
  }
  if (!Array.isArray(row?.driftTest?.checks)) problems.push(`${ROW_FILE}: driftTest.checks is not a list`);
  const sources = {};
  for (const [label, file] of Object.entries(FOREIGN_FILES)) {
    try { sources[label] = fs.readFileSync(path.join(repositoryRoot, file), 'utf8'); }
    catch (error) { problems.push(`${file}: cannot be read (${error.message})`); }
  }
  return problems.length ? { problems } : { row, sources, problems };
}

/**
 * @description Compare the committed medium rows against every foreign declaration they name.
 * @param {string} repositoryRoot The store checkout to read.
 * @returns {string[]} One message per disagreement or unreadable input; empty when every lab agrees.
 */
export function mediumPropertyDrift(repositoryRoot = REPOSITORY_ROOT) {
  const inputs = readInputs(repositoryRoot);
  if (inputs.problems.length) return inputs.problems;
  const { row, sources } = inputs;
  const problems = [];
  const declared = row.driftTest.checks.length;
  if (declared !== CHECKS.length) {
    problems.push(`${ROW_FILE}: driftTest.checks declares ${declared} check(s) and this guard implements ${CHECKS.length} - a declared check nobody implements is a drift nobody catches`);
  }
  for (const check of CHECKS) {
    if (check.index >= declared) continue;
    for (const problem of check.evaluate({ row, sources })) problems.push(`[${check.label}] ${problem}`);
  }
  return problems;
}

/** @description Fail the gate when any lab's copy of a medium property disagrees with the committed row. */
export function main(repositoryRoot = REPOSITORY_ROOT) {
  const problems = mediumPropertyDrift(repositoryRoot);
  if (problems.length) {
    console.error(`Medium-property drift failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('The fix is to change the committed row AND the foreign constant together, never to widen a tolerance.');
    process.exitCode = 1;
    return;
  }
  console.log(`Medium-property drift passed: ${CHECKS.length} checks, ${Object.keys(FOREIGN_FILES).length} foreign files agree with ${ROW_FILE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? path.resolve(process.argv[2]) : REPOSITORY_ROOT);
}
