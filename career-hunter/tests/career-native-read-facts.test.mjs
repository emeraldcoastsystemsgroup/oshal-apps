/**
 * CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require scoped teaching/support matches, original-owner remote settings, dated AI evidence and AI-only fresh counts while preserving applied history and refusing unavailable preferences.
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Jarvis's job questions refused with "specialist context read timed out": the specialist facts ran the full AI board ranking (2.1 to 3.0 s warm on a 2.1M-signal store) inside the kernel's 3 s deadline only to count up to 10 top matches. Over a disposable store, the facts never run the board ranking, count the board's first-page matches with its own default filters, capped at 10 (an inactive or unscored posting does not count), and agree with the full snapshot's first board page; the career_database tool still reads the board.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A saved resume with no owner database yet reads as saved; with neither it still says no resume.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Merged: both the saved-resume case and the 1.47 saved-area, remote and revision cases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);

/** better-sqlite3's synchronous interface over node:sqlite, as the native bridge's sqlite_compat serves it. */
class SqliteAdapter {
  constructor(filename, options = {}) {
    if (options.fileMustExist && !fs.existsSync(filename)) throw new Error('SQLite database does not exist');
    this.db = new DatabaseSync(filename, { readOnly: Boolean(options.readonly), enableForeignKeyConstraints: true });
  }
  exec(sql) { this.db.exec(sql); return this; }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    statement.setAllowBareNamedParameters(true);
    return { get: (...a) => statement.get(...a), all: (...a) => statement.all(...a), run: (...a) => statement.run(...a) };
  }
  pragma(sql) { return this.prepare(`PRAGMA ${sql}`).all(); }
  close() { this.db.close(); }
}

const records = [];
const boardReads = { count: 0 };
const originalLoad = Module._load;
Module._load = function withSqlite(request, ...rest) {
  if (request === 'better-sqlite3') return SqliteAdapter;
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error: (fields, msg) => records.push({ fields, msg }) }) };
  if (request === '../routes/career-board-feed') {
    const real = originalLoad.call(this, request, ...rest);
    return { ...real, fetchBoardPage: (...args) => { boardReads.count += 1; return real.fetchBoardPage(...args); } };
  }
  return originalLoad.call(this, request, ...rest);
};
let reader;
try { reader = require('../lib/native-career-read.js'); } finally { Module._load = originalLoad; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-native-facts-'));
const tenant = path.join(root, 'default'), owner = path.join(tenant, 'person-f');
const principal = { subject: 'person-f', issuer: 'https://issuer.test', id: 'p-f', tenant: 't-f', state: 'active' };
process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
process.env.JOBHUNTER_STORE_ROOT = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/** The engine's own schema text, as the engine creates the stores. */
function engineSchema(name) {
  const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  return engine.match(new RegExp(`\\n${name} = """([\\s\\S]*?)"""`))[1];
}

/** A saved store with 12 scored active postings, one scored inactive posting and one unscored posting (scored = AI fit score, as the board ranks). */
function savedStore() {
  fs.mkdirSync(owner, { recursive: true });
  const db = new DatabaseSync(path.join(owner, 'user-person-f.db'));
  db.exec(`ATTACH DATABASE '${path.join(tenant, 'corpus.db')}' AS corpus`);
  db.exec(engineSchema('CORPUS_SCHEMA'));
  db.exec(engineSchema('USER_SCHEMA'));
  db.exec("INSERT INTO corpus.companies (id, name) VALUES (1, 'Fixture Co')");
  for (let id = 1; id <= 14; id += 1) {
    db.exec(`INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, title, active, target_role, first_seen_at)
      VALUES (${id}, 1, 'f-${id}', 'Fixture role ${id}', ${id === 13 ? 0 : 1}, 1, date('now'))`);
    db.exec(`INSERT INTO user_signals (posting_id, fit_score, ai_fit_score, status) VALUES (${id}, ${60 + id}, ${id === 14 ? 'NULL' : 60 + id}, 'new')`);
  }
  db.close();
  fs.writeFileSync(path.join(owner, 'career_db.json'), JSON.stringify({ roles: [{ title: 'Engineer' }], skills: {} }));
}

/** The specialist read the concierge requires, registered exactly as the package registers it. */
function specialistRead(remoteOnly = false) {
  let entry;
  reader.createNativeCareerReadRoutes({
    pool: {query:async()=>({rows:[{remote_only:remoteOnly}]})},
    tools: { register() {} },
    specialistContext: { register: (e) => { entry = e; } },
    intent: async () => ({ principal }),
  }, root);
  return () => entry.read({ sub: principal.subject, issuer: principal.issuer, signal: { aborted: false } });
}

test('the specialist facts count capped scored active matches without the board ranking', async () => {
  savedStore();
  const facts = await specialistRead()();
  assert.equal(boardReads.count, 0, 'the facts read never runs the board ranking');
  assert.equal(facts['matches.sample_count'], 10);
  assert.equal(facts['signals.total'], 14);
  assert.equal(facts['profile.roles'], 1);
  const full = reader.readCareerSnapshot(principal, root);
  assert.equal(boardReads.count, 1, 'the full snapshot still reads the board');
  assert.equal(full.topMatches.length, facts['matches.sample_count']);
  assert.equal(records.length, 0);
});

test('a saved resume with nothing matched yet reads as a saved resume, not as no resume', () => {
  const person = { subject: 'person-r', issuer: 'https://issuer.test', id: 'p-r', tenant: 't-f', state: 'active' };
  const dir = path.join(tenant, 'person-r');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(tenant, 'corpus.db'), fs.existsSync(path.join(tenant, 'corpus.db')) ? fs.readFileSync(path.join(tenant, 'corpus.db')) : '');
  fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify({ roles: [{ title: 'Staff Engineer' }, { title: 'Lead' }], skills: {} }));
  const saved = reader.readCareerSnapshot(person, root);
  assert.equal(saved.profile.present, true);
  assert.equal(saved.profile.roles.length, 2);
  assert.ok(!/No resume/.test(saved.notice), saved.notice);
  assert.equal(saved.source.reason, 'no_owner_database');
  assert.deepEqual(saved.topMatches, []);
  fs.rmSync(path.join(dir, 'career_db.json'));
  const none = reader.readCareerSnapshot(person, root);
  assert.equal(none.profile.present, false);
  assert.match(none.notice, /No resume/);
});

test('snapshot and cheap facts use the saved area and include scored teaching titles without treating keyword matches as AI fits', async()=>{
  const db=new DatabaseSync(path.join(owner,'user-person-f.db'));
  db.exec(`ATTACH DATABASE '${path.join(tenant,'corpus.db')}' AS corpus`);
  const posting=db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,active,target_role,
    first_seen_at,remote,city,lat,lon,location) VALUES(?,1,?,?,1,?,datetime('now',?),?,?,?,?,?)`);
  const signal=db.prepare(`INSERT INTO user_signals(posting_id,fit_score,ai_fit_score,status,applied_at,ai_scored_at,ai_model,ai_input_fingerprint)
    VALUES(?,99,?,?,datetime('now'),'2020-01-02 03:04:05',?,?)`);
  for(const row of [
    [15,'Adjunct Business Instructor',0,85,'new','0 days',0,'destin',30.4044,-86.4714,'Destin, FL'],
    [16,'Distant Engineer',1,98,'applied','0 days',0,'los angeles',34.0522,-118.2437,'Los Angeles, CA'],
    [17,'Remote Desktop Support',0,86,'new','0 days',1,'los angeles',34.0522,-118.2437,'Remote, US'],
    [18,'Keyword Only',1,null,'new','0 days',0,'destin',30.4044,-86.4714,'Destin, FL'],
    [19,'Dismissed Remote Role',1,99,'dismissed','0 days',1,'destin',30.4044,-86.4714,'Remote, US'],
    [20,'Older Remote Role',1,96,'new','-10 days',1,'los angeles',34.0522,-118.2437,'Remote, US'],
    [21,'Hybrid Engineer',1,88,'new','0 days',1,'destin',30.4044,-86.4714,'Destin, FL (hybrid)'],
  ]){
    const [id,title,target,fit,status,age,remote,city,lat,lon,location]=row;
    posting.run(id,'fixture-'+id,title,target,age,remote,city,lat,lon,location);
    signal.run(id,fit,status,JSON.stringify({provider:'fixture',model:'saved-model'}),'b'.repeat(64));
  }
  db.close();
  const scope={version:1,near:'Destin, FL',lat:30.4044,lon:-86.4714,radiusMiles:70,includeRemote:true};
  fs.writeFileSync(path.join(owner,'job-search-scope.json'),JSON.stringify(scope),{mode:0o600});
  const value=reader.readCareerSnapshot(principal,root);
  assert.deepEqual(value.topMatches.map(r=>r.postingId),[20,21,17,15]);
  assert.equal(value.freshHighFit.count,3,'keyword-only, dismissed, old and distant onsite jobs are not fresh high AI fits');
  assert.equal(value.freshHighFit.kind,'ai');
  assert.equal(value.recentApplied[0].postingId,16,'application history remains accessible outside the hunt area');
  assert.equal(value.ranking.scope.radiusMiles,70);
  assert.equal(value.ranking.assessmentsRevalidated,false);
  assert.equal(value.topMatches[0].fitAssessment.assessedAt,'2020-01-02T03:04:05.000Z');
  assert.equal(value.topMatches[0].fitAssessment.currentness,'not-revalidated');
  const facts=await specialistRead()();assert.equal(facts['matches.sample_count'],value.topMatches.length);
  const remote=reader.readCareerSnapshot(principal,root,{remoteOnly:true});
  assert.deepEqual(remote.topMatches.map(r=>r.postingId),[20,17]);assert.equal(remote.freshHighFit.count,1);
  const remoteFacts=await specialistRead(true)();assert.equal(remoteFacts['matches.sample_count'],2);
});

test('registered Jarvis reads use the original-owner remote setting and refuse a preference failure',async()=>{
  let tool;const calls=[];
  const register=pool=>reader.createNativeCareerReadRoutes({pool,
    tools:{register:(name,fn)=>{assert.equal(name,'career_database');tool=fn;}},
    specialistContext:{register(){}},intent:async()=>({principal}),
  },root);
  register({query:async(sql,params)=>{calls.push([sql,params]);return{rows:[{remote_only:true}]};}});
  const value=await tool({});assert.deepEqual(value.topMatches.map(r=>r.postingId),[20,17]);
  assert.deepEqual(calls,[['SELECT remote_only FROM career_score_settings WHERE user_sub=$1',[principal.subject]]]);
  for(const rows of [null,[{remote_only:'yes'}],[{remote_only:true},{remote_only:false}]]){
    register({query:async()=>({rows})});await assert.rejects(tool({}),/career_saved_source_unavailable/);
  }
  register({query:async()=>{throw new Error('private database failure');}});
  await assert.rejects(tool({}),/career_saved_source_unavailable/);
  assert.ok(records.every(r=>!JSON.stringify(r).includes('private database failure')));
});

test('copying an unchanged profile never supplies a résumé revision date or revalidates saved scores',()=>{
  const profile=path.join(owner,'career_db.json'),bytes=fs.readFileSync(profile),stat=fs.statSync(profile);
  try {
    fs.utimesSync(profile,new Date('2030-01-01T00:00:00Z'),new Date('2030-01-01T00:00:00Z'));
    const value=reader.readCareerSnapshot(principal,root);
    assert.equal(value.source.profileModifiedAt,null,'a copied/exported file clock is not a content revision');
    assert.equal(value.ranking.assessmentsRevalidated,false);
    assert.ok(value.topMatches.every(job=>job.fitAssessment.currentness==='not-revalidated'));
    assert.deepEqual(fs.readFileSync(profile),bytes,'the reader preserves the original profile');
  } finally { fs.utimesSync(profile,stat.atime,stat.mtime); }
});
