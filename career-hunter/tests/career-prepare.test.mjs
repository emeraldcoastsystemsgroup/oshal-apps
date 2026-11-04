/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the selected-job engine contract against real private SQLite and packet templates.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('one selected job scores, prepares documents, records failures and never submits',()=>{
 const run=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-prepare-contract.py',import.meta.url))],{encoding:'utf8',timeout:20000});
 assert.equal(run.status,0,run.stderr+run.stdout);assert.deepEqual(JSON.parse(run.stdout.trim()),{checks:13,failed:[]});
});
