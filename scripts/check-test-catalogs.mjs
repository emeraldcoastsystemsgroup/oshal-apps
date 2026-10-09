#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Run the framework's OWN package test-catalog loader (scripts/oshal-test-catalog.js, the function the installed-app loader and `oshal-app validate` call) over every package's Test Lab catalog on every push. The kernel refuses a WHOLE package for one bad catalog field, and that happened three times: circuit-lab 0.5.0 (an expectation of 568 characters), career-hunter (1,052 characters, its tests/test-lab.yaml CHANGE LOG 8) and embodied 0.17.0 on 2026-09-28 (`Application embodied testing.cases[19].expected[7]: must be non-empty text of at most 500 characters` - embodied was unmounted until 0.16.3 was restored). No store-ci job judged catalog content: the one caller of the loader in this repo, scripts/security/run-framework-coupled-tests.mjs, runs only in the workflow_dispatch security workflow and only for packages with a framework-coupled suite. The rule is never restated here; the check loads it from the framework checkout, so the store is judged by the rule the kernel enforces. Every failing case is named (the loader stops at the first), and a catalog the manifest does not declare is still validated as if declared and reported as undeclared.
 *
 * Usage: OSHAL_FRAMEWORK=<framework checkout with node_modules> node scripts/check-test-catalogs.mjs [storeRoot]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where a package keeps its Test Lab catalog when it follows the store convention. */
export const CONVENTIONAL_CATALOG = 'tests/test-lab.yaml';

/**
 * @description Load the framework's own catalog contract and YAML parser from a framework checkout.
 *   The store must be judged by the rule the kernel enforces at load, so the rule is never copied
 *   here: a copy drifts, and a drifted copy passes exactly the catalog the kernel then refuses.
 * @param {string} frameworkRoot A framework (core) checkout whose node_modules holds js-yaml.
 * @returns {{ root: string, catalog: { loadPackageTestCatalog: Function, validatePackageTestCatalog: Function }, yaml: { load: Function, JSON_SCHEMA: object } }}
 *   The contract module and the parser the contract itself uses.
 */
export function loadFrameworkCatalog(frameworkRoot) {
  if (!frameworkRoot) {
    throw new Error('No framework checkout: set OSHAL_FRAMEWORK to a core checkout with node_modules - refusing rather than passing unchecked');
  }
  const root = path.resolve(frameworkRoot);
  const contract = path.join(root, 'scripts', 'oshal-test-catalog.js');
  if (!fs.existsSync(contract)) throw new Error(`${root} is not a framework checkout: ${contract} is missing`);
  const frameworkRequire = createRequire(path.join(root, 'package.json'));
  const catalog = frameworkRequire(contract);
  if (typeof catalog.loadPackageTestCatalog !== 'function' || typeof catalog.validatePackageTestCatalog !== 'function') {
    throw new Error(`${contract} no longer exports loadPackageTestCatalog and validatePackageTestCatalog`);
  }
  return { root, catalog, yaml: frameworkRequire('js-yaml') };
}

/**
 * @description Read one value out of a parsed case by the field path the kernel names in its error
 *   (`expected[7]`, `isolation.cleanup`, `limits.timeoutMs`).
 * @param {object} testCase A parsed catalog case.
 * @param {string} field The field path after `cases[N].`.
 * @returns {unknown} The value, or undefined when the path does not resolve.
 */
function fieldValue(testCase, field) {
  let value = testCase;
  for (const key of field.split(/[.[\]]/).filter(Boolean)) {
    if (value === null || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

/**
 * @description Rewrite a kernel catalog error so it names the application, the case ID and the field.
 *   The kernel reports a position (`cases[19].expected[7]`); a reader fixing the file needs the ID.
 * @param {string} message The kernel's error message.
 * @param {object[]} cases The parsed catalog cases, or [] when the catalog did not parse.
 * @returns {string} `app: case <id> (cases[N]) field <path>: <rule>`, plus the offending length for text.
 */
export function describeCatalogError(message, cases) {
  const shaped = /^Application (\S+) testing\.cases\[(\d+)\]\.?([^:]*): (.*)$/.exec(message);
  if (!shaped) {
    const general = /^Application (\S+) testing\.([^:]*): (.*)$/.exec(message);
    return general ? `${general[1]}: ${general[2]}: ${general[3]}` : message;
  }
  const [, app, index, field, rule] = shaped;
  const testCase = cases[Number(index)];
  const id = typeof testCase?.id === 'string' ? testCase.id : '(no id)';
  const value = field && testCase ? fieldValue(testCase, field) : undefined;
  const length = typeof value === 'string' && /at most \d+ characters/.test(rule) ? ` (is ${value.length} characters)` : '';
  return `${app}: case ${id} (cases[${index}]) field ${field || '(case)'}: ${rule}${length}`;
}

/**
 * @description Parse a catalog file exactly as the kernel's loader parses it (JSON schema, no custom tags).
 * @param {object} framework The loaded framework contract.
 * @param {string} file Absolute catalog path.
 * @returns {object[]} The parsed cases, or [] when the file is unreadable or not a case list.
 */
function parsedCases(framework, file) {
  try {
    const parsed = framework.yaml.load(fs.readFileSync(file, 'utf8'), { schema: framework.yaml.JSON_SCHEMA });
    return Array.isArray(parsed?.cases) ? parsed.cases : [];
  } catch {
    return [];
  }
}

/**
 * @description Name every failing case, not only the first. The kernel's validator stops at its first
 *   refusal, so a catalog with two bad cases is fixed one deploy at a time; running the SAME validator
 *   over each case alone surfaces the rest. Cross-case rules (duplicate IDs) stay with the full run.
 * @param {object} framework The loaded framework contract.
 * @param {object} manifest The parsed manifest.
 * @param {object[]} cases The parsed catalog cases.
 * @returns {string[]} One described problem per failing case.
 */
function perCaseProblems(framework, manifest, cases) {
  const problems = [];
  cases.forEach((testCase, index) => {
    try {
      framework.catalog.validatePackageTestCatalog({ version: 1, cases: [testCase] }, manifest);
    } catch (error) {
      const positioned = String(error.message).replace(/testing\.cases\[0\]/, `testing.cases[${index}]`);
      problems.push(describeCatalogError(positioned, cases));
    }
  });
  return problems;
}

/**
 * @description Judge one package's catalog with the kernel's loader. A manifest that declares
 *   `testing:` is loaded exactly as the kernel loads it (declaration, catalog content, and every
 *   referenced file confined to the package). A conventional catalog the manifest does NOT declare is
 *   never loaded by the kernel, so it cannot refuse the package; it is still loaded as if declared so
 *   the day it is declared cannot be the day it breaks, and it is reported as undeclared.
 * @param {string} packageDir Absolute package directory.
 * @param {object} framework The loaded framework contract.
 * @returns {{ app: string, catalog: string|null, declared: boolean, cases: number, problems: string[] }}
 *   `catalog` is null when the package has none.
 */
export function packageCatalogResult(packageDir, framework) {
  const app = path.basename(packageDir);
  let manifest;
  try {
    manifest = framework.yaml.load(fs.readFileSync(path.join(packageDir, 'oshal-app.yaml'), 'utf8'));
  } catch (error) {
    return { app, catalog: null, declared: false, cases: 0, problems: [`${app}: oshal-app.yaml does not parse: ${error.message}`] };
  }
  const declared = manifest?.testing !== undefined;
  const conventional = fs.existsSync(path.join(packageDir, CONVENTIONAL_CATALOG));
  if (!declared && !conventional) return { app, catalog: null, declared, cases: 0, problems: [] };
  const judged = declared ? manifest : {
    ...manifest,
    uses: [...(Array.isArray(manifest?.uses) ? manifest.uses : []), 'test-catalog'],
    testing: { version: 1, catalog: CONVENTIONAL_CATALOG },
  };
  const catalog = typeof judged.testing?.catalog === 'string' ? judged.testing.catalog : CONVENTIONAL_CATALOG;
  const cases = parsedCases(framework, path.join(packageDir, catalog));
  const problems = [];
  try {
    framework.catalog.loadPackageTestCatalog(packageDir, judged);
  } catch (error) {
    problems.push(describeCatalogError(String(error.message), cases));
    for (const problem of perCaseProblems(framework, judged, cases)) {
      if (!problems.includes(problem)) problems.push(problem);
    }
  }
  return { app: manifest?.name || app, catalog, declared, cases: cases.length, problems };
}

/**
 * @description Judge every package in the store: each top-level directory carrying an oshal-app.yaml.
 *   Discovery is structural, so a new package is covered the day it lands.
 * @param {string} storeRoot The store repository root.
 * @param {object} framework The loaded framework contract.
 * @returns {Array<ReturnType<typeof packageCatalogResult>>} One result per package, sorted by directory.
 */
export function storeCatalogResults(storeRoot, framework) {
  return fs.readdirSync(storeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(storeRoot, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort()
    .map((name) => packageCatalogResult(path.join(storeRoot, name), framework));
}

/**
 * @description Fail the gate when any package catalog would be refused by the kernel's loader.
 *   Finding no package, or no catalog at all, is a refusal: an empty walk must never read as green.
 * @param {string} storeRoot The store repository root.
 * @param {string|undefined} frameworkRoot The framework checkout (OSHAL_FRAMEWORK).
 * @returns {void} Sets process.exitCode to 1 on any problem.
 */
export function main(storeRoot = REPOSITORY_ROOT, frameworkRoot = process.env.OSHAL_FRAMEWORK) {
  const framework = loadFrameworkCatalog(frameworkRoot);
  const results = storeCatalogResults(path.resolve(storeRoot), framework);
  const withCatalog = results.filter((result) => result.catalog);
  const problems = results.flatMap((result) => result.problems);
  if (!results.length || !withCatalog.length) problems.push(`no package${results.length ? ' Test Lab catalog' : ''} was found under ${storeRoot} - refusing a vacuous pass`);
  for (const result of withCatalog.filter((entry) => !entry.declared)) {
    console.log(`notice: ${result.app}: ${CONVENTIONAL_CATALOG} is not declared in oshal-app.yaml (no testing:), so the kernel never loads it; validated as if declared`);
  }
  if (problems.length) {
    console.error(`Package test catalogs the kernel loader would refuse (${problems.length}), judged by ${framework.root}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const cases = withCatalog.reduce((total, result) => total + result.cases, 0);
  console.log(`Package test catalogs passed the kernel loader: ${withCatalog.length} catalogs, ${cases} cases, ${results.length} packages`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2] ? path.resolve(process.argv[2]) : REPOSITORY_ROOT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
