/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard real fixture-volume route latency, pipeline plans, and one-write durable relationship removal.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Database=require('../../scripts/toolchain/node_modules/better-sqlite3');
import {volumeFixture,measurements} from './helpers/career-volume-fixture.mjs';
let f;
before(()=>{f=volumeFixture();});after(()=>f?.close());
test('old published generations read without DDL, then writable migration retains every relationship and repeats safely',async()=>{
 const before=readFileSync(f.paths.userDb);assert.equal((await f.call('GET','/jobs?status=queue&sort=generated&per=25')).status,200);
 assert.deepEqual(readFileSync(f.paths.userDb),before,'a GET cannot migrate a published database');
 await f.call('POST','/jobs/1/status',{favorite:true});
 const db=new Database(f.paths.userDb);try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_signals').get().n,60000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('idx_user_queue_order','idx_user_tracked_order')").get().n,2);
  const schema=db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();require('../lib/career-signal-migrations').migrate(db);
  assert.deepEqual(db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(),schema);
 }finally{db.close();}
});
test('fixture-volume screens and Save/Remove/Prepare stay under 500ms per handler',async()=>{
 const results=await measurements(f);for(const r of results)assert.ok(r.ms<500,r.label+' took '+r.ms+'ms');
});
test('migrated Getting ready and Applications pages use ordered relationship indexes',async()=>{
 for(const url of ['/jobs?status=queue&sort=generated&per=25&current=1','/jobs?status=tracked&sort=applied&per=25']){
  f.plans.length=0;const out=await f.call('GET',url);assert.equal(out.status,200);
  const plan=f.plans.find(p=>p.sql.includes('FROM user_signals s')).plan.join('\n');
  assert.match(plan,/idx_user_(queue|tracked)_order/);assert.doesNotMatch(plan,/TEMP B-TREE FOR ORDER BY/);
 }
});
test('Remove updates one relationship, leaves board receipts unchanged, and fresh lists/counts honour it',async()=>{
 const file=join(f.paths.userDir,'job-board-state.json'),before=readFileSync(file),stats=(await f.call('GET','/jobs/stats')).json;
 f.writes.length=0;const out=await f.call('POST','/jobs/1/status',{status:'dismissed',favorite:false});assert.equal(out.status,200);
 assert.equal(f.writes.length,1,JSON.stringify(f.writes));assert.match(f.writes[0],/^UPDATE user_signals SET status/);
 assert.deepEqual(readFileSync(file),before,'Remove stores its tombstone only on the relationship');
 assert.equal((await f.call('GET','/jobs/stats')).json.saved,stats.saved-1);
 assert.ok(!(await f.call('GET','/jobs?status=saved&per=300')).json.jobs.some(j=>j.id===1));
 const removed=(await f.call('GET','/jobs/1')).json.job;assert.equal(removed.status,'dismissed');assert.equal(removed.favorite,false);
 const night=spawnSync(process.env.CAREER_PYTHON||'python3',['-c',
  'from jobhunter import match; match.rescore_new()'],{encoding:'utf8',timeout:10000,env:{...process.env,
   PYTHONPATH:new URL('../engine',import.meta.url).pathname,JOBHUNTER_STORE:'sqlite',JOBHUNTER_MULTIUSER:'1',
   JOBHUNTER_DATA:f.paths.userDir,JOBHUNTER_USER_DB:f.paths.userDb,JOBHUNTER_CORPUS_DB:f.paths.corpusDb,
   JOBHUNTER_CAREER_DB:join(f.paths.userDir,'fictional-profile-absent.json'),OSHAL_USER_SUB:'fictional-volume-person'}});
 assert.equal(night.status,0,night.stderr);
 assert.equal((await f.call('GET','/jobs/1')).json.job.status,'dismissed','real removal survives the next keyword pass');
 assert.ok(!(await f.call('GET','/jobs?matches=1&per=300')).json.jobs.some(j=>j.id===1));
 assert.equal((await f.call('POST','/jobs/1/status',{favorite:true})).status,200,'only explicit Save restores removal');
 assert.equal((await f.call('GET','/jobs/1')).json.job.status,'new');
});
