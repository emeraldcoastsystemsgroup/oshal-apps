/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the automatic saved-job batch on real synthetic SQLite and actual packet templates, with every external model/browser/network leaf replaced.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('saved preparation batch checks opt-in, finishes exact drafts, retains failure and never submits or replays',()=>{
 const r=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-workflow-engine-contract.py',import.meta.url))],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout.trim()),{checks:6,failed:[]});
});
