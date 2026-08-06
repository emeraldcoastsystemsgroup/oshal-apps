#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fail closed on empty test discovery and run the full Little Monsters plus store migration/RLS security families.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add the canonical one-pass rebuild behavioral contract to the mandatory SEC-06 test family.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep request-scoped provider credentials out of application subprocesses and ambient child environments.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Add the dependency-free D&D owner/RLS contract to the mandatory migration security family.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Add the APP-02 audit profile, catalog binding, staged policy, and real-record mutation suite to the blocking contract family.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @description Discover test files in one directory by an explicit filename predicate. */
function discover(directory, predicate) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
}

/** @description Execute one already-proven non-empty plain-node test group. */
function runGroup(root, label, files, minimum) {
  if (files.length < minimum) throw new Error(`${label} discovered ${files.length} tests; expected at least ${minimum}`);
  const relativeFiles = files.map((file) => relative(root, file));
  console.log(`${label}: running ${relativeFiles.length} discovered test file(s)`);
  const result = spawnSync(process.execPath, ['--test', ...relativeFiles], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

/** @description Discover and execute every mandatory store security test family. */
export function main(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  const littleMonsters = discover(join(resolvedRoot, 'little-monsters', 'tests'), (name) => name.endsWith('.test.cjs'));
  const careerMigrations = discover(join(resolvedRoot, 'career-hunter', 'tests'), (name) =>
    /(?:migration|postings-provenance-view).*\.test\.mjs$/i.test(name));
  const dndOwnerRls = discover(join(resolvedRoot, 'dnd', 'tests'), (name) => name === 'dnd-owner-rls.test.js');
  const contract = [
    join(resolvedRoot, 'scripts', 'security', 'credential-carrier-source.test.js'),
    join(resolvedRoot, 'scripts', 'security', 'package-audit.test.mjs'),
    join(resolvedRoot, 'scripts', 'security', 'security-ci-contract.test.mjs'),
    join(resolvedRoot, 'scripts', 'security', 'rebuild-store-routes.test.mjs'),
  ];
  runGroup(resolvedRoot, 'Little Monsters authorization', littleMonsters, 7);
  runGroup(resolvedRoot, 'Career migration/RLS', careerMigrations, 3);
  runGroup(resolvedRoot, 'D&D owner/RLS', dndOwnerRls, 1);
  runGroup(resolvedRoot, 'SEC-06 workflow contract', contract, 4);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
