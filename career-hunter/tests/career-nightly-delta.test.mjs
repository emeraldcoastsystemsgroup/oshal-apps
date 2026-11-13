/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run actual launcher-selected nightly Python on invented people and jobs, without kernel or employer requests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
test('nightly uses stored relationships, skips removals and scores only pending new entries',()=>{
 const launcher=readFileSync(new URL('../bin/oshal-jobhunter.js',import.meta.url),'utf8');
 const start=launcher.indexOf('function corpusRuns('),end=launcher.indexOf('\n/**',start);
 const code=vm.runInNewContext(launcher.slice(start,end)+';corpusRuns("score-titles",[])')[0][1];
 const out=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-nightly-delta-contract.py',import.meta.url))],{input:JSON.stringify(code),encoding:'utf8',timeout:180000});
 assert.equal(out.status,0,out.stdout+out.stderr);assert.match(out.stderr,/Ran 4 tests/);
});
