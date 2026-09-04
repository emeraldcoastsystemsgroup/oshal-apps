/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Package test runner (plain node, zero deps) against the COMPILED routes/*.js, matching the store-repo convention. Exits non-zero on any failure. Run: node print-ingest/tests/run.js
 */

'use strict';

async function main() {
  const suites = [
    ['classify', require('./classify.spec.js')],
    ['fanout', require('./fanout.spec.js')],
  ];
  let failed = 0;
  for (const [name, run] of suites) {
    try {
      const count = await run();
      console.log(`  ok    ${name} (${count} checks)`);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`);
      if (err && err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
  console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites passed');
  process.exitCode = failed ? 1 : 0;
}

main();
