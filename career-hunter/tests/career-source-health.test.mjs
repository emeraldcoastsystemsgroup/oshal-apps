/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise source-history projection on read-only SQLite and the existing administrator list without a personal Career database.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require = createRequire(import.meta.url);
const {sourceHealthByCompany} = require('../lib/career-source-health');

function corpus() {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(`CREATE TABLE corpus.companies(id INTEGER PRIMARY KEY,name TEXT,ats_type TEXT,ats_token TEXT,
    careers_url TEXT,discover_status TEXT,source_lists TEXT);
    CREATE TABLE corpus.postings_corpus(company_id INTEGER,active INTEGER);
    INSERT INTO corpus.companies VALUES(1,'Local College','pageup','reviewed','https://careers.example/','found','[]');
    INSERT INTO corpus.postings_corpus VALUES(1,1);`);
  return db;
}

test('an older read-only snapshot explicitly has no recorded source history and is never migrated', () => {
  const db = corpus();
  try {
    db.exec('PRAGMA query_only=ON');
    const health = sourceHealthByCompany(db);
    assert.equal(health.available, false);
    assert.equal(health.reason, 'not_recorded_yet');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM corpus.sqlite_master WHERE name='source_pull_state'").get().n, 0);
  } finally {db.close();}
});

test('retained failure state and counts are read without writes', () => {
  const db = corpus();
  try {
    db.exec(`CREATE TABLE corpus.source_pull_state(company_id INTEGER,last_attempt_at TEXT,last_success_at TEXT,
      completed_at TEXT,status TEXT,last_error_code TEXT,consecutive_failures INTEGER,fetched INTEGER,
      new_count INTEGER,changed_count INTEGER,unchanged_count INTEGER,closed_count INTEGER);
      INSERT INTO corpus.source_pull_state VALUES(1,'2026-10-24T12:00:00Z','2026-10-23T12:00:00Z',
      '2026-10-24T12:01:00Z','partial','pagination_incomplete',2,3,1,1,1,0);
      PRAGMA query_only=ON;`);
    const health = sourceHealthByCompany(db);
    assert.equal(health.available, true);
    assert.equal(health.states.get(1).consecutive_failures, 2);
    assert.equal(health.states.get(1).closed_count, 0);
  } finally {db.close();}
});

test('an administrator without a personal Career store can inspect the shared Companies corpus', () => {
  const db = corpus();
  const old = process.env.CAREER_HUNTER_ADMIN_SUBS;
  process.env.CAREER_HUNTER_ADMIN_SUBS = 'fixture-admin';
  try {
    db.exec('PRAGMA query_only=ON');
    const source = readFileSync(new URL('../routes/career-company-routes.js', import.meta.url), 'utf8');
    const registered = new Map();
    const module = {exports: {}};
    const leaves = {
      '@/shared/logger': {createChildLogger: () => ({info(){},warn(){},error(){}})},
      '@/shared/middleware/authz': {isOperator: () => false},
      './career-user-store': {callerSub: req => req.sub, openCorpusDb: () => ({prepare: sql => db.prepare(sql),close(){}}),
        openUserDb: () => {throw new Error('a shared list must not open a personal store');}},
      './career-engine-dispatch': {runCareerCliAwait: () => {throw new Error('read must not launch engine');}},
      './career-engine-response': {},
      './career-surface-routes': {createCareerToolFileHandler: () => () => {}},
      '../lib/career-source-health': {sourceHealthByCompany},
    };
    new Function('require','module','exports',source)((id) => {
      assert.ok(id in leaves, `inspected dependency ${id}`); return leaves[id];
    }, module, module.exports);
    module.exports.registerCareerCompanyRoutes({get: (url,...handlers) => registered.set(url,handlers), post(){}}, {});
    let answer;
    const req = {sub:'fixture-admin'};
    const res = {json: value => {answer = value;}};
    const handlers = registered.get('/companies-admin/list');
    handlers[0](req,res,() => handlers[1](req,res));
    assert.equal(answer.companies[0].name, 'Local College');
    assert.equal(answer.companies[0].active_jobs, 1);
    assert.equal(answer.companies[0].pull_health.status, 'unavailable');
  } finally {
    if (old === undefined) delete process.env.CAREER_HUNTER_ADMIN_SUBS; else process.env.CAREER_HUNTER_ADMIN_SUBS = old;
    db.close();
  }
});

test('only a verified operator or configured administrator passes the existing Companies gate', () => {
  const old = process.env.CAREER_HUNTER_ADMIN_SUBS;
  delete process.env.CAREER_HUNTER_ADMIN_SUBS;
  try {
    const verified = new WeakSet();
    const module = {exports:{}};
    const registered = new Map();
    const leaves = {
      '@/shared/logger': {createChildLogger: () => ({info(){},warn(){},error(){}})},
      '@/shared/middleware/authz': {isOperator: req => verified.has(req)},
      './career-user-store': {callerSub: req => req.sub, openCorpusDb: () => {throw new Error('gate test never reads');}},
      './career-engine-dispatch': {}, './career-engine-response': {},
      './career-surface-routes': {createCareerToolFileHandler: () => () => {}},
      '../lib/career-source-health': {sourceHealthByCompany},
    };
    new Function('require','module','exports',readFileSync(new URL('../routes/career-company-routes.js',import.meta.url),'utf8'))(
      id => {assert.ok(id in leaves);return leaves[id];},module,module.exports);
    module.exports.registerCareerCompanyRoutes({get:(url,...handlers)=>registered.set(url,handlers),post(){}},{});
    const gate = registered.get('/companies-admin/list')[0];
    const actual = {sub:'native-operator'};verified.add(actual);
    let admitted = 0;
    gate(actual,{},()=>{admitted++;});
    assert.equal(admitted,1);
    for (const forged of [{sub:'ordinary'}, {sub:'ordinary',user:{isOperator:true},headers:{'x-oshal-operator':'true'}}]) {
      let status;
      const response = {setHeader(){},status:value=>{status=value;},json:value=>assert.equal(value.error,'admin only')};
      gate({...forged,path:'/companies-admin/list',accepts:()=> 'json'},response,()=>{admitted++;});
      assert.equal(status,403);
    }
    assert.equal(admitted,1);
  } finally {
    if(old===undefined)delete process.env.CAREER_HUNTER_ADMIN_SUBS;else process.env.CAREER_HUNTER_ADMIN_SUBS=old;
  }
});

test('source-memory ingestion and conditional-fetch guards pass against real temporary SQLite', () => {
  const result = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [new URL('./career-source-memory.py', import.meta.url).pathname],
    {encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});

test('native refresh reports installation management and refuses a detached writer before acknowledgement', () => {
  const old = process.env.OSHAL_EGRESS;
  process.env.OSHAL_EGRESS = 'kernel';
  try {
    const module = {exports:{}};
    const gets = new Map(), posts = new Map();
    const noWriter = () => {throw new Error('native read cannot start an engine or shared writer');};
    const leaves = {
      '@/shared/logger': {createChildLogger: () => ({info(){},warn(){},error(){}})},
      '@/shared/middleware/authz': {getTrustedServiceUserSub: () => null},
      './career-match-prefs': {},
      './career-engine-dispatch': {runCareerCliAwait:noWriter},
      './career-engine-response': {},
      './career-company-routes': {isCareerAdmin:()=>true},
      './career-user-store': {callerSub:()=> 'fixture',listStoreUsers:()=>[],openUserDb:()=>null},
      '../lib/career-engine-runs': {},
      './career-hunter-cron': {isEveningChainRunning:()=>false,lastEveningCompletedAt:()=>null,runEveningScrapeIndex:noWriter},
    };
    new Function('require','module','exports',readFileSync(new URL('../routes/career-run-routes.js',import.meta.url),'utf8'))(
      id => {assert.ok(id in leaves,id);return leaves[id];},module,module.exports);
    module.exports.registerCareerRunRoutes({get:(url,...handlers)=>gets.set(url,handlers),post:(url,...handlers)=>posts.set(url,handlers)},{});
    let body, status=200;
    const res={json:value=>{body=value;},status(value){status=value;return this;}};
    gets.get('/run/refresh')[0]({},res);
    assert.equal(body.manualRefreshAvailable,false);
    assert.equal(body.refreshMode,'installation-managed');
    posts.get('/run/refresh')[0]({},res);
    assert.equal(status,409);
    assert.equal(body.manualRefreshAvailable,false);
    assert.match(body.error,/installation refreshes/);
  } finally {
    if(old===undefined)delete process.env.OSHAL_EGRESS;else process.env.OSHAL_EGRESS=old;
  }
});
