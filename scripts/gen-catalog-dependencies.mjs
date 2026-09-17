#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | marketplace.json's dependency block is GENERATED from each package's oshal-app.yaml, never hand-typed. It had drifted unguarded through the tiered-dependency migration: every one of the 61 entries still carried the pre-tier flat shape, creative-studio listed one app where its manifest lists four, and the launchers (games, life, system) advertised as hard dependencies the apps they merely route to.
 *
 * Usage: node scripts/gen-catalog-dependencies.mjs          (rewrites marketplace.json in place)
 *        node scripts/gen-catalog-dependencies.mjs --check  (exit 1 when the catalog has drifted)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifestDependencies, sameDependencies } from './manifest-dependencies.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @description Rebuild one catalog entry with the manifest's dependency block, keeping the entry's
 * existing key order (and placing a newly added `dependencies` where the catalog already puts it,
 * immediately before `source`) so a regeneration produces a readable diff.
 * @param {object} entry The catalog entry.
 * @param {object|null} dependencies The mirrored block, or null when the manifest declares none.
 * @returns {object} A new entry object.
 */
function withDependencies(entry, dependencies) {
  const rebuilt = {};
  let placed = false;
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'dependencies') {
      if (dependencies) { rebuilt.dependencies = dependencies; placed = true; }
      continue;
    }
    if (key === 'source' && dependencies && !placed) { rebuilt.dependencies = dependencies; placed = true; }
    rebuilt[key] = value;
  }
  if (dependencies && !placed) rebuilt.dependencies = dependencies;
  return rebuilt;
}

/**
 * @description Compute the catalog every package manifest implies, and every problem found reading
 * one. A manifest whose dependency block cannot be read is a problem, never a silent "no deps".
 * @param {string} repositoryRoot Store checkout root.
 * @returns {{ marketplace: object, problems: string[], drifted: string[] }}
 */
export function generateCatalogDependencies(repositoryRoot = REPOSITORY_ROOT) {
  const marketplace = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'marketplace.json'), 'utf8'));
  const problems = [];
  const drifted = [];
  if (!Array.isArray(marketplace.apps)) return { marketplace, problems: ['marketplace.json apps must be an array'], drifted };
  marketplace.apps = marketplace.apps.map((entry) => {
    const directory = entry?.source?.path;
    if (typeof directory !== 'string' || !directory) {
      problems.push(`${entry?.name ?? '(unnamed)'}: catalog entry has no source.path, so its manifest cannot be read`);
      return entry;
    }
    const manifestPath = path.join(repositoryRoot, directory, 'oshal-app.yaml');
    if (!fs.existsSync(manifestPath)) {
      problems.push(`${entry.name}: ${directory}/oshal-app.yaml does not exist`);
      return entry;
    }
    const { dependencies, problems: readProblems } = readManifestDependencies(
      fs.readFileSync(manifestPath, 'utf8'), `${directory}/oshal-app.yaml`,
    );
    if (readProblems.length) { problems.push(...readProblems); return entry; }
    if (!sameDependencies(entry.dependencies ?? null, dependencies)) drifted.push(entry.name);
    return withDependencies(entry, dependencies);
  });
  return { marketplace, problems, drifted };
}

/**
 * @description CLI entry: rewrite marketplace.json, or report drift under `--check`.
 * @param {string[]} argv Process arguments.
 * @param {string} repositoryRoot Store checkout root.
 * @returns {number} Process exit code.
 */
export function main(argv = process.argv.slice(2), repositoryRoot = REPOSITORY_ROOT) {
  const { marketplace, problems, drifted } = generateCatalogDependencies(repositoryRoot);
  if (problems.length) {
    console.error(`Cannot generate the catalog dependency mirror (${problems.length} problem(s)):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  if (argv.includes('--check')) {
    if (drifted.length) {
      console.error(`marketplace.json dependency mirror is stale for ${drifted.length} package(s): ${drifted.join(', ')}`);
      console.error('Run node scripts/gen-catalog-dependencies.mjs');
      return 1;
    }
    console.log(`Catalog dependency mirror is current for ${marketplace.apps.length} package(s)`);
    return 0;
  }
  fs.writeFileSync(path.join(repositoryRoot, 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
  console.log(drifted.length
    ? `Rewrote the dependency mirror for ${drifted.length} package(s): ${drifted.join(', ')}`
    : `Catalog dependency mirror already current for ${marketplace.apps.length} package(s)`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
