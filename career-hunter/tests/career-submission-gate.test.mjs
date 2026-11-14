/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Assert the real-browser sender proof is registered in both the Career CI job and the reviewed command inventory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN||fileURLToPath(new URL('../../scripts/toolchain',import.meta.url)),'package.json'));
const yaml=deps('js-yaml');
test('the Career gate explicitly runs its real-browser submission proof and the inventory agrees',()=>{
  const workflow=yaml.load(readFileSync(new URL('../../.github/workflows/store-ci.yml',import.meta.url),'utf8'));
  const command='node --test "tests/browser/career-submission-browser-proof.mjs"';
  const step=workflow.jobs['career-hunter'].steps.find(s=>s['working-directory']==='career-hunter'&&s.run===command);
  assert.ok(step,'Career must run the sender proof explicitly, beyond tests/*.test.mjs');
  assert.match(step.env.STORE_CI_TOOLCHAIN,/scripts\/toolchain/);
  const inventory=JSON.parse(readFileSync(new URL('../../scripts/security/store-test-command-inventory.json',import.meta.url),'utf8'));
  assert.ok(inventory.commands.includes('career-hunter|'+command));
});
