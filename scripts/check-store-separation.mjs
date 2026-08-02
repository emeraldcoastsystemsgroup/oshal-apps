#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Store-side repo-separation guard (ADR-115 done-when #3). Core ships check-repo-separation.js, which asserts that no application code has leaked INTO the platform trunk; nothing asserted the reverse from inside the store, so platform code arriving here — or a package with no manifest — was caught only by whoever happened to look. Runs on every store PR, inside the public-snapshot emit, and as a pre-push hook in both the trunk and the published repo.
 */

/**
 * @file Repo-separation guard for the application store.
 *
 * The invariant, stated once: **this repo contains packages and nothing else.** A package is a
 * top-level directory with an `oshal-app.yaml`. The only non-package top-level directories are
 * repo infrastructure (`scripts/`, `.github/`). Platform code — the FSD source layers, the kernel
 * manifest set, the bot-execution layer, the compose/image build — belongs to the core trunk and
 * reaching kernel capability is done through a manifest's `uses:` block, never by copying platform
 * code into a package (ADR-090).
 *
 * Why it is worth a guard rather than a convention: ADR-085 spent 21 carves separating the two
 * repos, and the public core snapshot is app-free *by construction*. A violation in this direction
 * is not found by reading a diff — it is found in a published artifact, which is the expensive
 * place to find it.
 *
 * Usage:  node scripts/check-store-separation.mjs [tree-root]
 * Exit:   0 = clean   1 = violations (each named with the fix)   2 = cannot read the tree
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

/** Top-level directories that are repo infrastructure rather than a package. */
const INFRA_DIRS = new Set(['scripts', '.github', '.git', 'node_modules']);

/**
 * Platform-only paths. Presence of any of these means core code has been copied into the store.
 * Matched at the TOP LEVEL only — a package may legitimately have its own `src/` or `tests/`;
 * what it may not do is reproduce the platform's own tree at the repo root.
 */
const CORE_ONLY_TOP_LEVEL = [
  'src', 'any-bot', 'swarm-apps', 'ai-lab', 'config-seed', 'docs', 'tests',
  'Dockerfile.oshal', 'docker-compose.oshal-local.yml', 'tsconfig.json', 'playwright.config.ts',
];

/**
 * NOT CHECKED HERE: the carved commercial packages. That rule lives in the trunk-side emit gate
 * (build-store-public.sh step 3), and deliberately stays there — this file is PUBLISHED into the
 * public store, so naming those packages here would republish the very list the carve-out exists
 * to protect. Same reason the emit script deletes itself from its own output. Verified the hard
 * way: the first draft of this guard hardcoded the three names and the emit script's
 * personal-identifier gate refused the cut.
 */

/**
 * @description Run every separation rule over a store tree and report each violation with the
 * action that resolves it. Collects ALL violations rather than stopping at the first — a guard
 * that reports one problem per run turns a five-minute fix into five runs.
 * @param root - absolute path to the store tree to check
 * @returns the violation messages, empty when the tree is clean
 */
export function checkStoreSeparation(root) {
  const violations = [];
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') || e.name === '.github');

  for (const name of CORE_ONLY_TOP_LEVEL) {
    if (existsSync(join(root, name))) {
      violations.push(
        `platform path '${name}/' is present — that belongs to the core trunk. ` +
        `A package reaches kernel capability through its manifest's uses: block, never by copying platform code.`,
      );
    }
  }

  if (existsSync(join(root, 'oshal-app.yaml'))) {
    violations.push(
      `'oshal-app.yaml' at the repo root — the store is a collection of packages, not itself a package. ` +
      `Move it under its package directory.`,
    );
  }

  let packages = 0;
  for (const e of entries) {
    if (!e.isDirectory() || INFRA_DIRS.has(e.name)) continue;
    if (existsSync(join(root, e.name, 'oshal-app.yaml'))) { packages += 1; continue; }
    violations.push(
      `top-level directory '${e.name}/' has no oshal-app.yaml — every top-level directory here is ` +
      `either a package or repo infrastructure (${[...INFRA_DIRS].join(', ')}).`,
    );
  }

  if (packages === 0) {
    violations.push('no packages found — this does not look like the store tree.');
  }

  return violations;
}

const root = resolve(process.argv[2] || process.cwd());
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`check-store-separation: not a directory: ${root}`);
  process.exit(2);
}

const violations = checkStoreSeparation(root);
if (violations.length > 0) {
  console.error(`Repo separation FAILED in ${basename(root)}/ — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error('');
  console.error('The fix is to move the code to the repo it belongs in, never to widen this list.');
  process.exit(1);
}
console.log('Store-side repo-separation guard clean.');
