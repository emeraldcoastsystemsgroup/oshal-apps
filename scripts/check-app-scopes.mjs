#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Refuse any package whose `scope:` is outside the framework's app-scope vocabulary, judged by the framework's OWN contract (scripts/oshal-app-scope.js, the function `oshal-app validate` and the installed-app loader call). dev-workspace-index 0.2.0 declared `scope: deployment`, passed every check in this gate, and was refused by the kernel database's swarm_applications CHECK mid-install on 2026-09-28. The vocabulary is never restated here; a framework checkout that does not carry the contract is a refusal, never a pass.
 *
 * Usage: OSHAL_FRAMEWORK=<framework checkout with node_modules> node scripts/check-app-scopes.mjs [storeRoot]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @description Load the framework's app-scope contract and the YAML parser it ships with. The store is
 *   judged by the rule the kernel enforces, so the rule is loaded, never copied: a copy drifts.
 * @param {string|undefined} frameworkRoot A framework (core) checkout whose node_modules holds js-yaml.
 * @returns {{ root: string, scope: { APP_SCOPES: readonly string[], validateAppScope: Function }, yaml: { load: Function } }} The contract.
 */
export function loadFrameworkScope(frameworkRoot) {
  if (!frameworkRoot) {
    throw new Error('No framework checkout: set OSHAL_FRAMEWORK to a core checkout with node_modules - refusing rather than passing unchecked');
  }
  const root = path.resolve(frameworkRoot);
  const contract = path.join(root, 'scripts', 'oshal-app-scope.js');
  if (!fs.existsSync(contract)) throw new Error(`${root} carries no app-scope contract: ${contract} is missing (a framework older than the scope check cannot judge scopes)`);
  const frameworkRequire = createRequire(path.join(root, 'package.json'));
  const scope = frameworkRequire(contract);
  if (typeof scope.validateAppScope !== 'function' || !Array.isArray(scope.APP_SCOPES)) {
    throw new Error(`${contract} no longer exports validateAppScope and APP_SCOPES`);
  }
  return { root, scope, yaml: frameworkRequire('js-yaml') };
}

/**
 * @description Judge one package's declared scope with the framework's contract.
 * @param {string} packageDir Absolute package directory.
 * @param {ReturnType<typeof loadFrameworkScope>} framework The loaded contract.
 * @returns {{ app: string, scope: unknown, problems: string[] }} The declared scope (undefined when none) and any refusal.
 */
export function packageScopeResult(packageDir, framework) {
  const dir = path.basename(packageDir);
  let manifest;
  try {
    manifest = framework.yaml.load(fs.readFileSync(path.join(packageDir, 'oshal-app.yaml'), 'utf8'));
  } catch (error) {
    return { app: dir, scope: undefined, problems: [`${dir}: oshal-app.yaml does not parse: ${error.message}`] };
  }
  const app = manifest?.name || dir;
  try {
    return { app, scope: framework.scope.validateAppScope(manifest), problems: [] };
  } catch (error) {
    return { app, scope: manifest?.scope, problems: [`${app} (${dir}/oshal-app.yaml): ${error.message}`] };
  }
}

/**
 * @description Judge every package in the store: each top-level directory carrying an oshal-app.yaml.
 *   Discovery is structural, so a new package is covered the day it lands.
 * @param {string} storeRoot The store repository root.
 * @param {ReturnType<typeof loadFrameworkScope>} framework The loaded contract.
 * @returns {Array<ReturnType<typeof packageScopeResult>>} One result per package, sorted by directory.
 */
export function storeScopeResults(storeRoot, framework) {
  return fs.readdirSync(storeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(storeRoot, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort()
    .map((name) => packageScopeResult(path.join(storeRoot, name), framework));
}

/**
 * @description Fail the gate when any package declares a scope the kernel would refuse. Finding no
 *   package is a refusal too: an empty walk must never read as green.
 * @param {string} storeRoot The store repository root.
 * @param {string|undefined} frameworkRoot The framework checkout (OSHAL_FRAMEWORK).
 * @returns {void} Sets process.exitCode to 1 on any problem.
 */
export function main(storeRoot = REPOSITORY_ROOT, frameworkRoot = process.env.OSHAL_FRAMEWORK) {
  const framework = loadFrameworkScope(frameworkRoot);
  const results = storeScopeResults(path.resolve(storeRoot), framework);
  const problems = results.flatMap((result) => result.problems);
  if (!results.length) problems.push(`no package was found under ${storeRoot} - refusing a vacuous pass`);
  if (problems.length) {
    console.error(`Package scopes the kernel would refuse (${problems.length}), judged by ${framework.root}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const declared = results.filter((result) => result.scope !== undefined).length;
  console.log(`Package scopes passed the framework's contract: ${results.length} packages, ${declared} declare a scope (known: ${framework.scope.APP_SCOPES.join(', ')})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2] ? path.resolve(process.argv[2]) : REPOSITORY_ROOT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
