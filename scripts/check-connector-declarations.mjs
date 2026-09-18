#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-17 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Hold every package to a DECLARED connector allow-list. For `dependencies.connectors`, absent is not empty: the kernel forwards the key as the app's runtime allow-list (synthesiseProfile -> profile.connectors) and both consumers read an ABSENT key as UNFILTERED - RibbonNav.js pins the platform Connectors tile, and cockpit-view-controller.js renderConnectorDiscoverView offers the WHOLE provider catalog inside that app. Three packages (career-hunter and the two ADR-141 groups) were shipping exactly that. The catalog's own gates cannot see this: marketplace.json's dependency block is GENERATED from the manifests, so a key that disappears from a manifest disappears from the mirror too and `gen-catalog-dependencies.mjs --check` stays green. This is the check that goes red instead.
 *
 * Usage: node scripts/check-connector-declarations.mjs   (exit 1 when a package declares none)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifestDependencies } from './manifest-dependencies.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The ONLY packages allowed to ship without a connector allow-list, each with the reason a
 * reviewer accepted. It is empty, and it should stay empty: an undeclared package exposes every
 * OAuth provider and credential surface the platform has to whoever opens it. A package that
 * genuinely offers no account gets `connectors: []` - that is what empty is FOR - so the only
 * entry that could ever belong here is one whose surfaces must reach a provider nobody can
 * enumerate ahead of time, and that case has not existed yet.
 */
export const UNDECLARED_BY_DECISION = Object.freeze({});

/**
 * @description Find every catalogued package whose manifest declares no connector allow-list.
 * @param {string} repositoryRoot Store checkout root.
 * @param {{ exempt?: object }} options `exempt` overrides UNDECLARED_BY_DECISION (tests only).
 * @returns {string[]} One problem per package, empty when every package declares.
 */
export function connectorDeclarationProblems(repositoryRoot = REPOSITORY_ROOT, options = {}) {
  const exempt = options.exempt ?? UNDECLARED_BY_DECISION;
  const catalogPath = path.join(repositoryRoot, 'marketplace.json');
  const marketplace = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!Array.isArray(marketplace.apps)) return ['marketplace.json apps must be an array'];

  const problems = [];
  for (const entry of marketplace.apps) {
    const name = entry?.name ?? '(unnamed)';
    const directory = entry?.source?.path;
    if (typeof directory !== 'string' || !directory) {
      problems.push(`${name}: catalog entry has no source.path, so its manifest cannot be read`);
      continue;
    }
    const manifestPath = path.join(repositoryRoot, directory, 'oshal-app.yaml');
    if (!fs.existsSync(manifestPath)) {
      problems.push(`${name}: ${directory}/oshal-app.yaml does not exist`);
      continue;
    }
    const label = `${directory}/oshal-app.yaml`;
    const { dependencies, problems: readProblems } = readManifestDependencies(
      fs.readFileSync(manifestPath, 'utf8'), label,
    );
    // Fail closed. A block nobody could parse is NOT evidence that a package declares anything.
    if (readProblems.length) { problems.push(...readProblems.map((p) => `${name}: ${p}`)); continue; }
    if (dependencies && Array.isArray(dependencies.connectors)) continue;
    if (Object.hasOwn(exempt, name)) continue;
    problems.push(
      `${name}: ${label} declares no connector allow-list. ABSENT IS NOT EMPTY - the cockpit reads `
      + 'an absent key as UNFILTERED and offers every provider in the platform catalog inside this '
      + 'app. Declare `connectors: []` under a dependencies tier when the package reaches no '
      + 'provider, or list exactly the ids its own code reads a caller-owned credential for.',
    );
  }
  return problems;
}

/**
 * @description CLI entry.
 * @param {string[]} argv Process arguments (unused; the gate takes no options).
 * @param {string} repositoryRoot Store checkout root.
 * @returns {number} Process exit code.
 */
export function main(argv = process.argv.slice(2), repositoryRoot = REPOSITORY_ROOT) {
  const problems = connectorDeclarationProblems(repositoryRoot);
  if (problems.length) {
    console.error(`Connector declarations failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  const count = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'marketplace.json'), 'utf8'),
  ).apps.length;
  console.log(`Connector declarations passed: ${count} package(s) declare a connector allow-list`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
