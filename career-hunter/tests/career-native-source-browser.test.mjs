/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the native source adapter through real temporary SQLite with no employer, model or user store.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync}from'node:child_process';
test('native source browser preserves exact evidence and reports failures without closing old jobs',()=>{
 const run=spawnSync(process.env.JOBHUNTER_PYTHON||'python3',[new URL('./career-native-source-browser-contract.py',import.meta.url).pathname],{encoding:'utf8',timeout:20000});
 assert.equal(run.status,0,run.stderr+run.stdout);assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').at(-1)),{checks:8,failed:0});
});
