#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run framework-coupled LoRA/Vids suites against the same locked checkout used for canonical compilation.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
