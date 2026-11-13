/**
 * CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Use the pinned test interpreter for the production candidate-selector contract.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Exercise compiled board preference routing and strict refusal instead of pinning the argument shape of an extracted helper.
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the remote-only scoring contract against the production engine, and pin every place the standing preference must be honoured against the COMPILED routes — the scoring choke point, the manual run, the digest, and the board default. A preference honoured in three of four places is the defect this guards.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const routes = (name) => readFileSync(join(packageRoot, 'routes', name), 'utf8');

test('the scoring candidate query narrows to remote when the preference is set', () => {
  const result = spawnSync(process.env.CAREER_TEST_PYTHON || 'python', [join(packageRoot, 'tests', 'career-remote-only-contract.py')], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PYTHONPATH: join(packageRoot, 'engine') },
  });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.deepEqual(report.failed, [], 'every contract check must hold');
  assert.ok(report.checks >= 12, `expected the full contract, ran ${report.checks}`);
});

test('every automated path consults the preference', () => {
  // The scoring choke point: cron and boot catch-up both funnel through runUserScore, so gating
  // here is what keeps them from disagreeing about what counts as a match.
  const dispatch = routes('career-engine-dispatch.js');
  assert.match(dispatch, /readRemoteOnly\)?\(pool, userSub\)/, 'runUserScore must read the preference');
  assert.match(dispatch, /--remote-only/, 'the engine flag must be passed');

  // A manual "score now" must not disagree with the nightly pass.
  const run = routes('career-run-routes.js');
  assert.match(run, /readRemoteOnly\)?\(ctx\.pool, userSub\)/, 'the manual score must read the preference');
  assert.match(run, /--remote-only/, 'the manual score must pass the engine flag');

  // The digest.
  const digest = routes('career-digest.js');
  assert.match(digest, /readRemoteOnly\)?\(pool, userSub\)/, 'the digest must read the preference');
  assert.match(digest, /COALESCE\(pc\.remote, 0\) = 1/, 'the digest must filter on remote');

});

test('the actual compiled board uses the owner preference by default, honors explicit filters and refuses unknown match scope',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'career-remote-board-')),seen=[],reads=[];let unavailable=false,opened=0;
  const {modules}=loadCompiledModules({board:'routes/career-board-routes.js'},{
    './career-user-store':{callerSub:req=>req.userSub||null,openUserDb:()=>{opened++;return {close(){}};},userPaths:()=>({userDir:dir}),careerTenant:()=> 'default'},
    './career-engine-runner':{nativeRunInProgress:async()=>false},'./career-engine-dispatch':{},
    './career-board-feed':{fetchBoardPage:(_db,query)=>{seen.push({...query});return {jobs:[]};}},
  });
  const router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{async query(sql,args){assert.match(sql,/SELECT remote_only.*WHERE user_sub=\$1/);reads.push(args[0]);if(unavailable)throw Error('Fixture preference unavailable');return {rows:[{remote_only:true}]};}}});
  const handler=router.find('GET','/jobs').handler;
  const call=(query,userSub='fixture-owner')=>new Promise((resolve,reject)=>{const answer={code:200,body:null},res={status(code){answer.code=code;return res;},json(body){answer.body=body;resolve(answer);return res;}};Promise.resolve(handler({userSub,query},res)).catch(reject);});
  try{
    assert.equal((await call({matches:'1'})).code,200);assert.equal(seen.at(-1).remote,'1');assert.deepEqual(reads,['fixture-owner']);
    assert.equal((await call({matches:'1',remote:'0'})).code,200);assert.equal(seen.at(-1).remote,'0');assert.equal(reads.length,1,'an explicit workplace choice overrides the saved default');
    assert.equal((await call({status:'saved'})).code,200);assert.equal(seen.at(-1).remote,undefined);assert.equal(reads.length,1,'actual saved history stays outside matching preferences');
    unavailable=true;const before=seen.length;assert.equal((await call({matches:'1'})).code,500);assert.equal(seen.length,before,'unknown match scope must never reach a widened feed');
    assert.equal((await call({matches:'1',remote:'0'})).code,200);assert.equal(seen.at(-1).remote,'0','the explicit choice still works during a preference outage');
    const beforeAnonymous=opened;assert.equal((await call({matches:'1'},null)).code,401);assert.equal(opened,beforeAnonymous,'owner admission precedes the store read');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the preference is stored, readable and refused when malformed', () => {
  const settings = routes('career-title-score.js');
  assert.match(settings, /\/settings\/remote-only/, 'the save route must be registered');
  assert.match(settings, /remoteOnly !== 'boolean'/, 'a non-boolean must be refused');
  assert.match(settings, /unauthorized/, 'an unauthenticated caller must be refused');
  assert.match(settings, /remote_only = EXCLUDED\.remote_only/, 'the upsert must write only this column');
  assert.match(settings, /remote_only/, 'the state read must select the column');
});

test('the migration ships and is listed in the manifest', () => {
  const sql = readFileSync(join(packageRoot, 'migrations', '104-career-remote-only.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS remote_only BOOLEAN NOT NULL DEFAULT FALSE/,
    'additive and defaulted off, so existing users are unchanged');
  const manifest = readFileSync(join(packageRoot, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /migrations\/104-career-remote-only\.sql/, 'the migration must be applied on load');
});
