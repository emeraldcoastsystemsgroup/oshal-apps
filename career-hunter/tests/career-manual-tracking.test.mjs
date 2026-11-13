/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the compiled owner-bound status route over real disposable SQLite to record interviews, offers and closed applications with durable dates and manual provenance.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRouter, loadCompiledModules} from './helpers/career-route-harness.mjs';

class SqliteAdapter {
  constructor(file, options = {}) { this.db = new DatabaseSync(file, {readOnly:Boolean(options.readonly)}); }
  exec(sql) { this.db.exec(sql); return this; }
  prepare(sql) {
    const s = this.db.prepare(sql); s.setAllowBareNamedParameters(true);
    return {get:(...a)=>s.get(...a), all:(...a)=>s.all(...a), run:(...a)=>s.run(...a)};
  }
  pragma(sql, options = {}) {
    const rows = this.prepare('PRAGMA ' + sql).all();
    return options.simple ? Object.values(rows[0] || {})[0] : rows;
  }
  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN IMMEDIATE');
      try { const out=fn(...args); this.exec('COMMIT'); return out; }
      catch (error) { this.exec('ROLLBACK'); throw error; }
    };
  }
  close() { this.db.close(); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-manual-tracking-'));
const previous = process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT = root;
const {modules} = loadCompiledModules({board:'routes/career-board-routes.js', store:'routes/career-user-store.js'}, {'better-sqlite3':SqliteAdapter});
const router = createRouter();
modules.board.registerCareerBoardRoutes(router, {pool:{query:()=>{throw Error('No external SQL or submission ledger is needed.');}}});
after(() => {
  if (previous === undefined) delete process.env.JOBHUNTER_STORE_ROOT; else process.env.JOBHUNTER_STORE_ROOT = previous;
  fs.rmSync(root, {recursive:true,force:true});
});

function seed(sub) {
  const paths = modules.store.userPaths(sub);
  fs.mkdirSync(path.dirname(paths.corpusDb), {recursive:true}); fs.mkdirSync(paths.userDir, {recursive:true});
  const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  const corpus = new DatabaseSync(':memory:');
  corpus.prepare('ATTACH DATABASE ? AS corpus').run(paths.corpusDb);
  corpus.exec(engine.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);
  corpus.exec("INSERT OR IGNORE INTO corpus.companies(id,name) VALUES(1,'Fixture employer'); INSERT OR IGNORE INTO corpus.postings_corpus(id,company_id,ats_job_id,title,active) VALUES(7,1,'fixture-7','Fixture role',1)");
  corpus.close();
  const db = new DatabaseSync(paths.userDb);
  db.exec(engine.match(/USER_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);
  db.exec("INSERT INTO user_signals(posting_id,status,applied_at,application_source) VALUES(7,'applied','2026-11-01T12:00:00Z','manual-mark')");
  db.close(); return paths;
}

function read(paths) {
  const db = new DatabaseSync(paths.userDb, {readOnly:true});
  try { return db.prepare('SELECT status,interview_at,applied_at,application_source FROM user_signals WHERE posting_id=7').get(); }
  finally { db.close(); }
}

async function call(method, pathname, sub, body = {}) {
  const found = router.find(method, pathname); assert.ok(found);
  return new Promise((resolve,reject) => {
    const out = {code:200,body:null};
    const res = {status(code){out.code=code;return res;},setHeader(){},json(value){out.body=value;resolve(out);return res;}};
    Promise.resolve(found.handler({oidc:{user:sub?{sub}:null},params:found.params,body,query:{},headers:{}},res)).catch(reject);
  });
}

test('an interview time survives the real handler, SQLite reopen, detail read and owner isolation', async () => {
  const owner=seed('tracking-owner'), other=seed('tracking-other');
  const answer=await call('POST','/jobs/7/status','tracking-owner',{status:'interview',interview_at:'2026-11-20T09:30:00-06:00'});
  assert.equal(answer.code,200);
  assert.equal(read(owner).interview_at,'2026-11-20T15:30:00.000Z');
  assert.equal(read(owner).status,'interview'); assert.equal(read(other).status,'applied');
  const detail=await call('GET','/jobs/7','tracking-owner');
  assert.equal(detail.code,200); assert.equal(detail.body.job.interview_at,'2026-11-20T15:30:00.000Z');
  assert.equal(detail.body.job.board.manualTracking.status,'interview');
  assert.equal(detail.body.job.board.manualTracking.interviewAt,detail.body.job.interview_at);
  const otherDetail=await call('GET','/jobs/7','tracking-other');
  assert.equal(otherDetail.body.job.board.manualTracking,undefined);
});

test('offer and closed are manual outcomes, preserve application evidence and survive reopen', async () => {
  const owner=seed('tracking-outcomes');
  for (const status of ['offer','rejected']) {
    assert.equal((await call('POST','/jobs/7/status','tracking-outcomes',{status})).code,200);
    const stored=read(owner); assert.equal(stored.status,status);
    assert.equal(stored.applied_at,'2026-11-01T12:00:00Z'); assert.equal(stored.application_source,'manual-mark');
    const detail=await call('GET','/jobs/7','tracking-outcomes');
    assert.equal(detail.body.job.board.manualTracking.status,status);
    assert.ok(Number.isFinite(Date.parse(detail.body.job.board.manualTracking.recordedAt)));
  }
});

test('bad interview dates and unsigned requests cannot change the recorded application', async () => {
  const owner=seed('tracking-validation');
  for (const body of [{status:'interview',interview_at:'2026-11-20T09:30'},
    {status:'interview',interview_at:'2026-02-30T09:30:00Z'}, {status:'interview',interview_at:'2026-11-20T24:00:00Z'}, {status:'interview',interview_at:123},
    {status:'offer',interview_at:'2026-11-20T09:30:00Z'}]) {
    assert.equal((await call('POST','/jobs/7/status','tracking-validation',body)).code,400,JSON.stringify(body));
    assert.equal(read(owner).status,'applied'); assert.equal(read(owner).interview_at,null);
  }
  assert.equal((await call('POST','/jobs/7/status',null,{status:'offer'})).code,401);
});
