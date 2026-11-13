/**
 * CHANGE LOG
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Load the actual source-decision library in every strict compiled-route fixture while preserving admission and no-writer assertions.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The shipped routes are handed the whole source-health library, as they are in the package: the list now also reads source maintenance through it, and a hand-picked pair of its functions answered 500.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The child's time limit is a guard against a hang, not a speed check: it ended this test at exactly its limit on a busy machine (load 13 to 22 on 20 cores, 2026-11-11) while the engine was still working. Raised to 3 minutes for the source-memory contract.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Resolve on the native kernel: saved for the next pull with no engine started, read back as waiting and then as what the pull did.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Read the latest nightly source review on read-only SQLite through the existing administrator list; an absent or unreadable report never hides the companies.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep the read-only refresh fixture current with the lazily dispatched manual-score dependency; starting a native writer remains forbidden.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise source-history projection on read-only SQLite and the existing administrator list without a personal Career database.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require = createRequire(import.meta.url);
const {sourceHealthByCompany, latestSourceReview} = require('../lib/career-source-health');
const sourceRequests = require('../lib/career-source-requests');

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

test('the newest source review is read without writes, and a bad one is marked instead of breaking the list', () => {
  const db = corpus();
  try {
    assert.equal(latestSourceReview(db), null, 'an older snapshot has no review table');
    db.exec(`CREATE TABLE corpus.source_review_runs(run_id TEXT PRIMARY KEY,started_at TEXT,finished_at TEXT,report TEXT);`);
    assert.equal(latestSourceReview(db), null, 'no report yet');
    db.exec(`INSERT INTO corpus.source_review_runs VALUES('old','a','2026-11-01T00:00:00+00:00','{"version":1,"seconds":1}'),
      ('new','a','2026-11-02T00:00:00+00:00','{"version":1,"seconds":2}');
      PRAGMA query_only=ON;`);
    assert.equal(latestSourceReview(db).seconds, 2);
    db.exec(`PRAGMA query_only=OFF; UPDATE corpus.source_review_runs SET report='{not json' WHERE run_id='new'; PRAGMA query_only=ON;`);
    assert.deepEqual(latestSourceReview(db), {unreadable: true});
    db.exec(`PRAGMA query_only=OFF; DROP TABLE corpus.source_review_runs; CREATE TABLE corpus.source_review_runs(run_id TEXT);`);
    assert.deepEqual(latestSourceReview(db), {unreadable: true}, 'a table of the wrong shape never fails the company list');
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
      './career-user-store': {callerSub: req => req.sub, userPaths: () => ({userDir: '/nonexistent-owner'}), openCorpusDb: () => ({prepare: sql => db.prepare(sql),close(){}}),
        openUserDb: () => {throw new Error('a shared list must not open a personal store');}},
      './career-engine-dispatch': {runCareerCliAwait: () => {throw new Error('read must not launch engine');}},
      './career-engine-response': {},
      './career-surface-routes': {createCareerToolFileHandler: () => () => {}},
      '../lib/career-source-health': require('../lib/career-source-health'),
      '../lib/career-source-requests': sourceRequests,
    '../lib/career-source-decisions': require('../lib/career-source-decisions'),
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
    assert.equal(answer.sourceReview, null, 'before the first review the list answers exactly as it did');
  } finally {
    if (old === undefined) delete process.env.CAREER_HUNTER_ADMIN_SUBS; else process.env.CAREER_HUNTER_ADMIN_SUBS = old;
    db.close();
  }
});

test('on the native kernel Resolve saves the change for the next pull and starts no engine', async () => {
  const db = corpus();
  const owner = mkdtempSync(join(tmpdir(), 'career-source-change-'));
  const old = {admins: process.env.CAREER_HUNTER_ADMIN_SUBS, egress: process.env.OSHAL_EGRESS};
  process.env.CAREER_HUNTER_ADMIN_SUBS = 'fixture-admin';
  try {
    const source = readFileSync(new URL('../routes/career-company-routes.js', import.meta.url), 'utf8');
    const routes = new Map();
    const module = {exports: {}};
    let engineRuns = 0;
    const leaves = {
      '@/shared/logger': {createChildLogger: () => ({info(){},warn(){},error(){}})},
      '@/shared/middleware/authz': {isOperator: () => false},
      './career-user-store': {callerSub: req => req.sub, userPaths: () => ({userDir: owner}),
        openCorpusDb: () => ({prepare: sql => db.prepare(sql),close(){}}), openUserDb: () => { throw new Error('not used'); }},
      './career-engine-dispatch': {runCareerCliAwait: async () => { engineRuns++; return {ok: true, out: '{}'}; }},
      './career-engine-response': {},
      './career-surface-routes': {createCareerToolFileHandler: () => () => {}},
      '../lib/career-source-health': require('../lib/career-source-health'),
      '../lib/career-source-requests': sourceRequests,
    '../lib/career-source-decisions': require('../lib/career-source-decisions'),
    };
    new Function('require','module','exports',source)((id) => leaves[id], module, module.exports);
    const keep = (url,...handlers) => routes.set(url,handlers);
    module.exports.registerCareerCompanyRoutes({get: keep, post: keep}, {});
    const call = async (url, query = {}) => {
      const out = {status: 200};
      const res = {status(code){ out.status = code; return res; }, json(value){ out.body = value; }};
      const req = {sub: 'fixture-admin', query};
      const handlers = routes.get(url);
      await new Promise(done => handlers[0](req, res, () => { handlers[1](req, res); setImmediate(done); }));
      return out;
    };
    const company = db.prepare('SELECT id FROM corpus.companies LIMIT 1').get().id;
    const link = 'https://boards.greenhouse.io/fixture';

    process.env.OSHAL_EGRESS = 'kernel';
    assert.equal((await call('/companies-admin/list')).body.sourceChangeMode, 'next-pull');
    assert.deepEqual((await call('/companies-admin/list')).body.sourceChanges, []);
    const saved = await call('/companies-admin/seturl', {companyId: String(company), url: link});
    assert.equal(saved.status, 202);
    assert.equal(saved.body.queued, true);
    assert.equal(engineRuns, 0, 'it never starts an engine that cannot write');
    const handed = readdirSync(join(owner, '.source-request-outbox'));
    assert.equal(handed.length, 1, 'left for the kernel to take');
    const entry = JSON.parse(readFileSync(join(owner, '.source-request-outbox', handed[0]), 'utf8'));
    assert.deepEqual(entry, {id: saved.body.request.id, companyId: company, target: link}, 'the person is not the package\'s to name');

    const waiting = (await call('/companies-admin/list')).body.sourceChanges;
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].state, 'waiting');
    assert.equal(waiting[0].target, link);

    const board = await call('/companies-admin/seturl', {companyId: String(company), board: 'greenhouse:fixture'});
    assert.equal(board.status, 202, 'a board the review named needs no link');

    for (const bad of [{companyId: String(company)}, {url: link}, {companyId: 'x', url: link}, {companyId: '0', url: link},
      {companyId: String(company), url: 'file:///etc/passwd'}, {companyId: String(company), url: 'javascript:alert(1)'},
      {companyId: String(company), url: 'two words'}, {companyId: String(company), board: 'web:<script>'}, {companyId: String(company), url: `https://x.example/${'a'.repeat(2100)}`},
      {companyId: String(company), url: 'https://x.example/\nsecond'}]) {
      assert.equal((await call('/companies-admin/seturl', bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    }
    assert.equal((await call('/companies-admin/seturl', {companyId: '999999', url: link})).status, 404);
    assert.equal(readdirSync(join(owner, '.source-request-outbox')).length, 2, 'a refusal leaves nothing behind');

    delete process.env.OSHAL_EGRESS;
    assert.equal((await call('/companies-admin/list')).body.sourceChangeMode, 'now');
    assert.equal((await call('/companies-admin/seturl', {companyId: String(company), url: link})).status, 200);
    assert.equal(engineRuns, 1, 'an installation with a writable corpus still resolves at once');
  } finally {
    for (const [name, value] of [['CAREER_HUNTER_ADMIN_SUBS', old.admins], ['OSHAL_EGRESS', old.egress]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    db.close();
    rmSync(owner, {recursive: true, force: true});
  }
});

test('what the pulls did is read without writes, and what no pull has reached still shows as waiting', () => {
  const db = corpus();
  const owner = mkdtempSync(join(tmpdir(), 'career-source-change-'));
  try {
    const sent = sourceRequests.saveChange(owner, 1, 'https://boards.greenhouse.io/waiting');
    const done = sourceRequests.saveChange(owner, 1, 'greenhouse:done');
    assert.deepEqual(sourceRequests.sourceChanges(db, owner).map(change => change.state).sort(), ['waiting', 'waiting'], 'before any pull');
    db.exec(`CREATE TABLE corpus.source_requests (id TEXT PRIMARY KEY, company_id INTEGER, target TEXT, requested_by TEXT, requested_at INTEGER,
      finished_at TEXT, attempts INTEGER, outcome TEXT, detail TEXT)`);
    db.prepare(`INSERT INTO corpus.source_requests VALUES (?,1,'greenhouse:done','someone',1,'2026-11-05T00:00:00Z',1,'applied',?)`)
      .run(done.id, JSON.stringify({board: 'greenhouse:done', jobs: 3, new: 1}));
    db.prepare(`INSERT INTO corpus.source_requests VALUES ('other-admin',1,'lever:x','someone',1,'2026-11-05T00:00:01Z',1,'no_jobs','not json')`).run();
    db.exec('PRAGMA query_only=ON');
    const changes = sourceRequests.sourceChanges(db, owner);
    assert.equal(changes.find(change => change.id === sent.id).state, 'waiting');
    assert.equal(changes.find(change => change.id === done.id).state, 'applied', 'the corpus outranks the caller\'s record');
    assert.equal(changes.find(change => change.id === done.id).detail.jobs, 3);
    assert.equal(changes.find(change => change.id === 'other-admin').state, 'no_jobs', 'another administrator\'s change shows, and a damaged detail costs only the detail');
    assert.equal(changes.filter(change => change.id === done.id).length, 1, 'never listed twice');
    assert.deepEqual(sourceRequests.sourceChanges(db, join(owner, 'nobody')).map(change => change.id).sort(), [done.id, 'other-admin'].sort(), 'a person with no store');
  } finally {
    db.close();
    rmSync(owner, {recursive: true, force: true});
  }
});

test('only so many of a person\'s sent changes are kept', () => {
  const owner = mkdtempSync(join(tmpdir(), 'career-source-change-'));
  try {
    for (let n = 0; n < 53; n++) sourceRequests.saveChange(owner, 1, `greenhouse:board${n}`);
    assert.equal(readdirSync(join(owner, 'source-requests-sent')).length, 50);
  } finally {
    rmSync(owner, {recursive: true, force: true});
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
      '../lib/career-source-requests': sourceRequests,
    '../lib/career-source-decisions': require('../lib/career-source-decisions'),
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
    {encoding:'utf8',timeout:180000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
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
      '../lib/career-manual-score': {},
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
