/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise honest assessment provenance, real indexed board queries and the shipped score renderers without models or live data writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { assessment, decorateFit } = require('../lib/career-fit.js');
const { fetchBoardPage } = require('../routes/career-board-feed.js');
const model = { provider:'fixture', model:'evidence-model', fallback:false };
const scored = { ai_fit_score:0, fit_score:95, ai_scored_at:'2020-01-02 03:04:05',
  ai_model:JSON.stringify(model), ai_input_fingerprint:'a'.repeat(64), land_prob:100, high_win:99 };

test('AI zero, keyword-only and absent scores have distinct saved evidence', () => {
  assert.deepEqual(assessment(scored), {kind:'ai',score:0,assessedAt:'2020-01-02T03:04:05.000Z',
    model,inputRecorded:true,currentness:'not-revalidated'});
  const keyword=assessment({fit_score:95});
  assert.equal(keyword.kind,'keyword');assert.equal(keyword.score,95);
  assert.equal(keyword.assessedAt,null);assert.equal(keyword.model,null);
  assert.equal(assessment({}).kind,'none');
  for (const value of [-1,101,NaN,Infinity,'80']) assert.equal(assessment({ai_fit_score:value}).kind,'none');
  const job=decorateFit(scored);
  assert.equal(job.land_prob,null);assert.equal(job.high_win,null);
  assert.equal(job.ai_fit_score,0,'describing a saved assessment must not overwrite the model result');
});

test('missing, malformed or future provenance is unknown and never reported current', () => {
  for (const date of [undefined,'yesterday','2020-01-02','2020-01-02T03:04:05',new Date(Date.now()+120000).toISOString()]) {
    const result=assessment({...scored,ai_scored_at:date,ai_model:'legacy model name',ai_input_fingerprint:'bad'});
    assert.equal(result.assessedAt,null);assert.equal(result.model,null);assert.equal(result.inputRecorded,false);
    assert.equal(result.currentness,'not-revalidated');
  }
  assert.equal(assessment({...scored,ai_scored_at:'2020-01-02T05:04:05+02:00'}).assessedAt,'2020-01-02T03:04:05.000Z');
  assert.deepEqual(assessment({...scored,ai_model:{...model,privateKey:'must not escape'}}).model,model);
});

function fixture() {
  const db=new DatabaseSync(':memory:');db.exec("ATTACH DATABASE ':memory:' AS corpus");
  const source=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8');
  for (const name of ['CORPUS_SCHEMA','USER_SCHEMA']) {
    const sql=source.match(new RegExp(name+'\\s*=\\s*"""([^]*?)"""'));assert.ok(sql);db.exec(sql[1]);
  }
  db.exec(`INSERT INTO corpus.companies(id,name,industry,referral) VALUES(1,'Defense fixture','Defense',3),(2,'College fixture','Education',0);
    INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role,posted_date,first_seen_at)
    VALUES(1,1,'one','Top Secret Retail AI','Fixture description',1,1,date('now'),datetime('now')),
      (2,2,'two','Adjunct Business Instructor','Fixture description',1,1,date('now'),datetime('now')),
      (3,2,'three','Software Engineer','Fixture description',1,1,date('now'),datetime('now')),
      (4,2,'four','Support Technician','Fixture description',1,1,date('now'),datetime('now'));`);
  const insert=db.prepare(`INSERT INTO user_signals(posting_id,ai_fit_score,fit_score,ai_scored_at,ai_model,ai_input_fingerprint,status)
    VALUES(?,?,95,?,?,?,'generated')`);
  for (const [id,score] of [[1,60],[2,70],[3,0],[4,null]])insert.run(id,score,'2020-01-02 03:04:05',JSON.stringify(model),'a'.repeat(64));
  db.exec('PRAGMA query_only=ON');return db;
}

test('actual pooled, recent, keyword and workflow SQL all retain the owner assessment evidence', () => {
  const db=fixture();
  try {
    for (const query of [{sort:'ai'},{sort:'recent',days:'7'},{q:'Engineer'},{status:'generated'}]) {
      const page=fetchBoardPage(db,{...query,per:'20',lane:'all'});
      assert.ok(page.jobs.length);
      for (const job of page.jobs) {
        assert.equal(job.land_prob,null);assert.equal(job.high_win,null);
        assert.equal(job.fit_assessment.kind,job.id===4?'keyword':'ai');
        assert.equal(job.fit_assessment.score,job.id===4?95:job.ai_fit_score);
        if(job.id!==4){assert.deepEqual(job.fit_assessment.model,model);assert.equal(job.fit_assessment.assessedAt,'2020-01-02T03:04:05.000Z');}
      }
    }
    assert.deepEqual(db.prepare('SELECT ai_fit_score FROM user_signals ORDER BY posting_id').all().map(r=>r.ai_fit_score),[60,70,0,null]);
  } finally {db.close();}
});

test('old probability and high-win bookmarks use actual AI-fit order with no referral, clearance or substring bonuses', () => {
  const db=fixture();
  try {
    const ids=sort=>fetchBoardPage(db,{sort,per:'20',lane:'all'}).jobs.map(job=>job.id);
    assert.deepEqual(ids('ai'),[2,1,3]);
    assert.deepEqual(ids('prob'),ids('ai'));assert.deepEqual(ids('highwin'),ids('ai'));
  } finally {db.close();}
});

test('shipped cards distinguish actual AI fit, date-unknown assessments and keyword-only leads', () => {
  const html=readFileSync(new URL('../tools/career-board.html',import.meta.url),'utf8');
  const functions=['jobScoresHtml','jobFitDetailsHtml'].map(name=>html.match(new RegExp('function '+name+'\\([^]*?^}', 'm'))[0]).join('\n');
  const context={esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};
  vm.createContext(context);vm.runInContext(functions,context);
  const ai=context.jobScoresHtml(decorateFit(scored));
  assert.match(ai,/>0</);assert.match(ai,/AI fit/);assert.match(ai,/Assessed/);assert.match(ai,/2020/);
  assert.doesNotMatch(ai,/>95<|>100<|>99<|P land|hi-win/);
  const keyword=context.jobScoresHtml(decorateFit({fit_score:95}));
  assert.match(keyword,/Keyword fit/);assert.match(keyword,/Not AI assessed/);
  assert.match(context.jobScoresHtml(decorateFit({ai_fit_score:50})),/Assessment date unknown/);
  assert.equal(context.jobScoresHtml(decorateFit({})), '');
  const detail=context.jobFitDetailsHtml(decorateFit({...scored,ai_fit_rationale:'<script>bad</script>'}));
  assert.match(detail,/fixture \/ evidence-model/);assert.match(detail,/need a new score/);assert.doesNotMatch(detail,/<script>/);
  assert.match(context.jobFitDetailsHtml(decorateFit({fit_score:95})),/No saved AI assessment/);
  assert.doesNotMatch(html.match(/<select id="sort"[^]*?<\/select>/)?.[0]||'',/P\(land\)|High-Win/);
});
