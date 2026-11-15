/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "make the user get the position details and paste them before generating the resume"): the engine contract (career-pasted-details-contract.py) over two invented people, then the shipped lib/career-job-context.js reads the first person's pasted copy as that job's description with basis person-pasted, and finds nothing for the other person; the pasted text never reaches the engine's output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {applyJobContext}=require('../lib/career-job-context.js');

test('a pasted description is kept for that person only, bounded, and is what scoring and generation read',()=>{
  const root=mkdtempSync(join(tmpdir(),'career-pasted-'));
  try{
    const run=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-pasted-details-contract.py',import.meta.url))],
      {input:JSON.stringify({root}),encoding:'utf8',timeout:60000});
    assert.equal(run.status,0,run.stderr+run.stdout);
    const out=JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(out.checks.length,6,out.checks.join('; '));
    assert.doesNotMatch(run.stdout.replace(JSON.stringify(out.rows),''),/invented build farm/,'the engine prints no pasted text');
    const olive=out.rows.olive,mine=applyJobContext(olive.dir,olive.row);
    assert.equal(mine.description,olive.expected,'the job page reads the pasted copy as the description');
    assert.equal(mine.description_context.basis,'person-pasted');
    const other=out.rows.other;
    assert.equal(applyJobContext(other.dir,other.row).description,null,"the other person's job has no description");
  }finally{rmSync(root,{recursive:true,force:true});}
});
