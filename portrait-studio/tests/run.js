/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-17 11:58:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Package test runner (plain node, zero deps): catalog invariants + ops primitives against the COMPILED routes/*.js. Exits non-zero on any failure — CI-gate-able for the store repo. Run: node portrait-studio/tests/run.js
 */

'use strict';

async function main() {
  const suites = [
    ['catalog-invariants', require('./catalog-invariants.spec.js')],
    ['ops', require('./ops.spec.js')],
    ['capture', require('./capture.spec.js')],
  ];
  let failed = 0;
  for (const [name, run] of suites) {
    try {
      const count = await run();
      console.log(`  ok    ${name} (${count} checks/groups)`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`);
    }
  }
  console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites passed');
  process.exitCode = failed ? 1 : 0;
}

main();
