/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include capped searches and a source change whose preview must not settle its full pull.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run counted Oracle transport/store and Workday restart regressions in the normal package gate.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('Oracle listings and interrupted Workday searches retain real completion evidence',()=>{
  const run=spawnSync(process.env.JOBHUNTER_PYTHON||'python3',[new URL('./career-source-readers-contract.py',import.meta.url).pathname],{encoding:'utf8',timeout:60000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  assert.match(run.stderr,/Ran 10 tests/);
});
