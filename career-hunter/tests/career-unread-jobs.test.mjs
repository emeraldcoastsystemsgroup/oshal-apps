/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "i want jobs flowing in.. even if we can only see their title .. at least run it up with a warning"): the shipped nightly launcher over invented native jobs (career-unread-jobs-contract.py) marks the jobs no reader there can describe "details needed" with no read and no model call, and the shipped board feed then lists them in New matches from the same stores: after every AI fit under Best AI fit, by keyword match under Keyword, by date under Date posted, inside a date filter, and counted; a dismissed job, an unnamed title and a close call are not listed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const {fetchBoardPage,countNewMatches}=require('../routes/career-board-feed.js');

test('a nightly pass lists the jobs it cannot read, without reading or scoring them, and New matches shows them',()=>{
  const launcher=readFileSync(new URL('../bin/oshal-jobhunter.js',import.meta.url),'utf8');
  const start=launcher.indexOf('function corpusRuns('),end=launcher.indexOf('\n/**',start);
  const code=vm.runInNewContext(launcher.slice(start,end)+';corpusRuns("score-titles",[])')[0][1];
  const root=mkdtempSync(join(tmpdir(),'career-unread-jobs-'));
  try{
    const out=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-unread-jobs-contract.py',import.meta.url))],
      {input:JSON.stringify({code,root}),encoding:'utf8',timeout:180000});
    assert.equal(out.status,0,out.stdout+out.stderr);
    assert.match(out.stderr,/Ran 4 tests/);
    const dir=join(root,'test_the_nightly_pass_lists_unreadable_jobs_without_a_read_or_a_model_call');
    const db=new DatabaseSync(join(dir,'user.db'));db.prepare('ATTACH DATABASE ? AS corpus').run(join(dir,'corpus.db'));
    try{
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_user_needs_details'").get(),'the night left the index New matches reads them through');
      const ids=query=>fetchBoardPage(db,{matches:'1',per:'50',...query}).jobs.map(job=>job.id);
      assert.deepEqual(ids({sort:'ai'}),[1,2,3,17,10,11,12,13,20],'Best AI fit: every AI fit first, then the jobs that need details');
      assert.deepEqual(ids({sort:'keyword'}),[11,17,1,2,3,12,10,20,13],'by keyword match, scored or not');
      assert.deepEqual(ids({sort:'posted'}),[1,2,3,10,17,11,12,13,20],'Date posted, the page\'s default: by date, scored or not');
      assert.deepEqual(ids({sort:'posted',days:'7'}),[1,2,3,10,17,11,12,13,20],'a date filter keeps them');
      assert.deepEqual(ids({sort:'ai',min_score:'70'}),[1,2,3],'a minimum AI fit leaves out jobs with no AI fit');
      assert.equal(countNewMatches(db,{}),9,'New matches counts them');
      const page=fetchBoardPage(db,{matches:'1',per:'50',sort:'ai'}).jobs,unread=page.find(job=>job.id===10),scored=page.find(job=>job.id===1);
      assert.equal(unread.fit_assessment.kind,'needs-details');assert.equal(unread.ai_fit_score,null);assert.equal(unread.title,'Platform Engineer');assert.equal(unread.company,'Invented EF');
      assert.equal(scored.fit_assessment.kind,'ai');
      assert.deepEqual(fetchBoardPage(db,{matches:'1',per:'4',page:'3',sort:'ai'}).jobs.map(job=>job.id),[20],'pages continue into them');
      db.exec('DROP INDEX idx_user_needs_details');
      assert.deepEqual(ids({sort:'ai'}),[1,2,3,17],'an owner generation without the index lists only scored matches, as before');
    }finally{db.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
});
