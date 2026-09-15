#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run framework-coupled LoRA/Vids suites against the same locked checkout used for canonical compilation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Also discover and run every package's node:test framework-coupled suite (`<package>/tests/<name>.core.test.js`) against the framework checkout. Those suites are excluded from the bare-checkout store CI by design, and until now NO gate ran them: of 14, one (daily-trade-recap) had been red since the same day's tier migration with nobody seeing it. Discovery is by glob, not a hand list, so a new package's suite is gated the day it lands; finding none is a refusal, never a pass. This is the manual gate by operator decision (2026-09-14: no paid CI).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin OSHAL_CORE_ROOT as well as OSHAL_CORE_DIR for every core suite. The suites now resolve OSHAL_CORE_ROOT first, as the Test Lab sandbox does, so a value left in the caller's shell would otherwise outrank the checkout this gate names.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Discover the framework-coupled browser specs (<package>/tests/<name>.core.spec.mjs) as well. Five of them - animatronics, cad-studio, circuit-lab, embodied, scan-to-print - were run by no gate: the bare-checkout CI excludes them and this gate matched only .core.test.js. They are node:test files, so the same per-package node --test run drives them; the security workflow already installs Chromium for the Vids proof.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Check every Test Lab case that registers a framework-coupled suite against core's own catalog loader and runner admission rule, loaded from the framework checkout. A case must be runnable on a fully verified image or wait only on prerequisites withheld by name; anything else fails the gate naming the case. This is the regression guard for the twenty cases that sat pending under names the Lab did not know.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * @description Find every package's framework-coupled node:test suite: the `.core.test.js` route and
 * engine suites and the `.core.spec.mjs` browser specs (node:test driving Playwright). These need a framework
 * checkout, so the bare-checkout store CI excludes them by design — which left them run by no gate
 * at all. Discovered by glob rather than listed by hand, so a new package's suite is covered the day
 * it lands instead of the day someone remembers to add it.
 * @param storeRoot - Store repository root.
 * @returns Store-relative `<package>/tests/<name>.core.test.js` and `.core.spec.mjs` paths, sorted.
 */
const CORE_SUITE = /\.core\.(?:test\.js|spec\.mjs)$/;

export function discoverCoreSuites(storeRoot) {
  const store = resolve(storeRoot);
  const found = [];
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const tests = join(store, entry.name, 'tests');
    if (!existsSync(tests)) continue;
    for (const file of readdirSync(tests)) {
      if (CORE_SUITE.test(file)) found.push(`${entry.name}/tests/${file}`);
    }
  }
  return found.sort();
}

/**
 * @description Run each discovered node:test core suite from its own package directory with
 * OSHAL_CORE_ROOT and OSHAL_CORE_DIR pointed at the framework checkout. Fails closed twice over: discovering nothing is
 * a refusal (an empty glob must never read as green), and every red suite is named rather than the
 * run stopping at the first one.
 * @param options - `{ storeRoot, frameworkRoot, run }`; `run` is the spawn seam for tests.
 * @returns The number of suites that ran and passed.
 */
export function runCoreSuites({ storeRoot, frameworkRoot, run = spawnSync }) {
  const store = resolve(storeRoot);
  const suites = discoverCoreSuites(store);
  if (suites.length === 0) {
    throw new Error('No framework-coupled node suites (*/tests/*.core.test.js) were discovered — refusing a vacuous pass');
  }
  // A node:test child inherits NODE_TEST_CONTEXT from any node:test parent and then reports to that
  // parent over a side channel instead of through its exit code: a genuinely failing suite exits 0.
  // Measured 2026-09-14 (exit 1 standalone, 0 with NODE_TEST_CONTEXT=child-v8). Strip it so each
  // suite's own exit code is the verdict, whatever invoked this gate.
  // Suites resolve OSHAL_CORE_ROOT first (the Test Lab's name) and OSHAL_CORE_DIR second, so both are
  // pinned here: an OSHAL_CORE_ROOT left in the caller's shell must not outrank the checkout this gate names.
  const core = resolve(frameworkRoot);
  const env = { ...process.env, OSHAL_CORE_ROOT: core, OSHAL_CORE_DIR: core };
  delete env.NODE_TEST_CONTEXT;
  const failed = [];
  for (const suite of suites) {
    const [pkg, ...rest] = suite.split('/');
    const result = run(process.execPath, ['--test', rest.join('/')], {
      cwd: join(store, pkg),
      stdio: 'inherit',
      env,
    });
    if (result.error || result.status !== 0) failed.push(suite);
  }
  if (failed.length) throw new Error(`Framework-coupled node suites failed (${failed.length} of ${suites.length}): ${failed.join(', ')}`);
  return suites.length;
}

/**
 * Prerequisites the sealed Test Lab deliberately does not provide, so a framework-coupled case that
 * names one stays pending by design. Each entry is a decision, not a convenience: a new name must be
 * added here on purpose, which is what stops a drifted spelling of a capability the Lab DOES provide
 * from hiding as "pending" (twenty cases sat that way until 2026-09-14).
 */
const LAB_WITHHELD = [
  /^harness:core-test-fixtures$/, // core's tests/fixtures/ tree is not in the runner image
  /^engine-container:/, // a package engine container runs beside the stack, never inside the sandbox
];
const PENDING_PREREQUISITES = /^Additional prerequisites require verification: (.+)\.$/;

/**
 * @description Load core's own catalog loader and runner admission rule from the framework checkout,
 * so the check below judges store catalogs by the vocabulary the Lab actually enforces rather than a
 * copy that can drift. Uses the checkout's tsx, as the framework-coupled suites themselves do.
 * @param frameworkRoot - Framework checkout root.
 * @returns `{ loadCases(packageDir), pending(testCase) }`.
 */
export function frameworkLab(frameworkRoot) {
  const coreRequire = createRequire(join(resolve(frameworkRoot), 'package.json'));
  coreRequire('tsx/cjs');
  const catalog = coreRequire(join(resolve(frameworkRoot), 'scripts', 'oshal-test-catalog.js'));
  const yaml = coreRequire('js-yaml');
  const snapshot = coreRequire(join(resolve(frameworkRoot), 'src', 'features', 'swarm-apps', 'services', 'package-test-snapshot.ts'));
  const verified = new Set([...snapshot.NODE_RUNNER_CAPABILITIES, ...snapshot.PROBE_VERIFIED_PREREQUISITES]);
  return {
    loadCases(packageDir) {
      const manifestPath = join(packageDir, 'oshal-app.yaml');
      if (!existsSync(manifestPath)) return [];
      const loaded = catalog.loadPackageTestCatalog(packageDir, yaml.load(readFileSync(manifestPath, 'utf8')));
      return loaded ? loaded.catalog.cases : [];
    },
    pending: (testCase) => snapshot.packageTestRecipePending(testCase, verified),
  };
}

/**
 * @description Refuse a Test Lab registration of a framework-coupled suite that core's runner can never
 * admit. A case is fine when it is runnable on a fully probe-verified image, or when every prerequisite
 * it is still waiting on is withheld by name (LAB_WITHHELD). Anything else - an unknown spelling, an
 * unavailable runner kind, a level the runner refuses - is named, because otherwise the case looks
 * registered while never running.
 * @param options - `{ storeRoot, suites, lab }`; `lab` is the seam for tests (default: frameworkLab).
 * @returns The number of registered framework-coupled cases checked.
 */
export function checkLabRegistrations({ storeRoot, suites, lab }) {
  const store = resolve(storeRoot);
  const byPackage = new Map();
  for (const suite of suites) {
    const [pkg, ...rest] = suite.split('/');
    if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
    byPackage.get(pkg).add(rest.join('/'));
  }
  const problems = [];
  let checked = 0;
  for (const [pkg, files] of byPackage) {
    for (const testCase of lab.loadCases(join(store, pkg))) {
      if (testCase.runner?.kind === 'smoke' || !(testCase.runner?.files ?? []).some((file) => files.has(file))) continue;
      checked += 1;
      const reason = lab.pending(testCase);
      if (!reason) continue;
      const waiting = PENDING_PREREQUISITES.exec(reason);
      if (waiting && waiting[1].split(', ').every((name) => LAB_WITHHELD.some((rule) => rule.test(name)))) continue;
      problems.push(`${pkg}:${testCase.id} - ${reason}`);
    }
  }
  if (problems.length) {
    throw new Error(`Framework-coupled suites registered where the Test Lab can never run them (${problems.length}):\n  ${problems.join('\n  ')}`);
  }
  return checked;
}

/** @description Execute the non-empty framework-coupled package suite with the locked Vitest binary. */
export function runFrameworkCoupledTests({ storeRoot, frameworkRoot }) {
  const store = resolve(storeRoot);
  const framework = resolve(frameworkRoot);
  const vitest = resolve(framework, 'node_modules', 'vitest', 'vitest.mjs');
  const config = resolve(store, 'scripts', 'security', 'framework-coupled.vitest.config.mjs');
  const required = [
    'lora/tests/lora-scorecard.spec.ts',
    'lora/tests/lora-dispatch.spec.ts',
    'vids/tests/vids-public.spec.ts',
    'vids/tests/vids-dispatch.spec.ts',
  ];
  for (const file of required) {
    if (!existsSync(resolve(store, file))) throw new Error(`Framework-coupled security test is missing: ${file}`);
  }
  if (!existsSync(vitest) || !existsSync(config)) {
    throw new Error('Locked framework Vitest binary or store test configuration is missing');
  }
  const result = spawnSync(process.execPath, [vitest, 'run', '--root', store, '--config', config], {
    cwd: store,
    stdio: 'inherit',
    env: { ...process.env, OSHAL_FRAMEWORK_ROOT: framework },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Framework-coupled tests failed with exit ${result.status}`);
  const registered = checkLabRegistrations({ storeRoot: store, suites: discoverCoreSuites(store), lab: frameworkLab(framework) });
  console.log(`Test Lab registrations of framework-coupled suites admitted by core's runner: ${registered}`);
  const ran = runCoreSuites({ storeRoot: store, frameworkRoot: framework });
  console.log(`Framework-coupled node suites passed: ${ran}`);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--store', '--framework'].includes(flag) || !value) {
      throw new Error('Usage: run-framework-coupled-tests.mjs --store <store> --framework <framework>');
    }
    values[flag.slice(2)] = value;
  }
  if (!values.store || !values.framework) throw new Error('Both --store and --framework are required');
  return { storeRoot: values.store, frameworkRoot: values.framework };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    runFrameworkCoupledTests(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
