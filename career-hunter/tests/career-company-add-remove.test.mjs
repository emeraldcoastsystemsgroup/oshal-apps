/**
 * CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Load the actual source-decision library in the existing strict compiled-route dependency fixture.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add, Remove and Put back on the Companies page: the shipped routes save each change for the next nightly pull exactly as the kernel takes it, refuse a name already listed, an unusable name or link, an unlisted employer and a change that is already true, leave nothing behind when they refuse, start no engine, and admit only an administrator.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The shipped routes are handed the whole source-health library, as they are in the package: the list now also reads source maintenance through it.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const sourceRequests = require('../lib/career-source-requests');

function corpus() {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(`CREATE TABLE corpus.companies(id INTEGER PRIMARY KEY,name TEXT,ats_type TEXT,ats_token TEXT,
    careers_url TEXT,discover_status TEXT,source_lists TEXT);
    CREATE TABLE corpus.postings_corpus(company_id INTEGER,active INTEGER);
    INSERT INTO corpus.companies VALUES(1,'Local College','pageup','reviewed','https://careers.example/','found','[]');
    INSERT INTO corpus.companies VALUES(2,'Gone Industries',NULL,NULL,'https://gone.example/jobs','removed','[]');
    INSERT INTO corpus.postings_corpus VALUES(1,1);`);
  db.exec('PRAGMA query_only=ON');
  return db;
}

/** The shipped routes file, loaded with its kernel-side dependencies as plain doubles and its own library real. */
function routes({owner, db, admins = new Set(['fixture-admin'])}) {
  const registered = new Map();
  const module = {exports: {}};
  const engine = {runs: 0};
  const leaves = {
    '@/shared/logger': {createChildLogger: () => ({info(){}, warn(){}, error(){}})},
    '@/shared/middleware/authz': {isOperator: () => false},
    './career-user-store': {callerSub: req => req.sub, userPaths: () => ({userDir: owner}),
      openCorpusDb: () => ({prepare: sql => db.prepare(sql), close(){}}), openUserDb: () => { throw new Error('not used'); }},
    './career-engine-dispatch': {runCareerCliAwait: async () => { engine.runs++; return {ok: true, out: '{}'}; }},
    './career-engine-response': {},
    './career-surface-routes': {createCareerToolFileHandler: () => () => {}},
    '../lib/career-source-health': require('../lib/career-source-health'),
    '../lib/career-source-requests': sourceRequests,
    '../lib/career-source-decisions': require('../lib/career-source-decisions'),
  };
  const before = process.env.CAREER_HUNTER_ADMIN_SUBS;
  process.env.CAREER_HUNTER_ADMIN_SUBS = [...admins].join(',');
  try {
    new Function('require', 'module', 'exports', readFileSync(new URL('../routes/career-company-routes.js', import.meta.url), 'utf8'))(
      id => { assert.ok(id in leaves, `dependency ${id}`); return leaves[id]; }, module, module.exports);
  } finally {
    if (before === undefined) delete process.env.CAREER_HUNTER_ADMIN_SUBS; else process.env.CAREER_HUNTER_ADMIN_SUBS = before;
  }
  const keep = (url, ...handlers) => registered.set(url, handlers);
  module.exports.registerCareerCompanyRoutes({get: keep, post: keep}, {});
  const call = async (url, query = {}, sub = 'fixture-admin') => {
    const out = {status: 200, passed: false};
    const res = {setHeader(){}, status(code) { out.status = code; return res; }, json(value) { out.body = value; }};
    const req = {sub, query, path: url, accepts: () => 'json'};
    const handlers = registered.get(url);
    assert.ok(handlers, `route ${url}`);
    await new Promise(done => {
      handlers[0](req, res, () => { out.passed = true; handlers[1](req, res); });
      setImmediate(done);
    });
    return out;
  };
  return {call, engine};
}

function withNativeKernel(fn) {
  return async () => {
    const db = corpus();
    const owner = mkdtempSync(join(tmpdir(), 'career-add-remove-'));
    const egress = process.env.OSHAL_EGRESS;
    process.env.OSHAL_EGRESS = 'kernel';
    try {
      await fn({db, owner, outbox: () => {
        try { return readdirSync(join(owner, '.source-request-outbox')).map(name => JSON.parse(readFileSync(join(owner, '.source-request-outbox', name), 'utf8'))); }
        catch { return []; }
      }});
    } finally {
      if (egress === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = egress;
      db.close();
      rmSync(owner, {recursive: true, force: true});
    }
  };
}

test('Add saves the new employer for the next pull under the placeholder id, name and link encoded so neither can break the other', withNativeKernel(async ({db, owner, outbox}) => {
  const {call, engine} = routes({owner, db});
  const saved = await call('/companies-admin/add', {name: '  Acme   (Robotics) ', url: 'https://acme.example/careers?team=a|b&x=1'});
  assert.equal(saved.status, 202);
  assert.match(saved.body.message, /next nightly pull adds Acme \(Robotics\)/);
  const [entry] = outbox();
  assert.deepEqual(entry, {id: saved.body.request.id, companyId: sourceRequests.NEW_EMPLOYER,
    target: 'add:Acme%20%28Robotics%29|https%3A%2F%2Facme.example%2Fcareers%3Fteam%3Da%7Cb%26x%3D1'});
  assert.match(entry.target, /^add:[A-Za-z0-9._~%-]+\|[A-Za-z0-9._~%-]+$/, 'only the one separator is left bare');
  const waiting = (await call('/companies-admin/list')).body.sourceChanges;
  assert.equal(waiting[0].state, 'waiting');
  assert.equal(engine.runs, 0);
}));

test('Add refuses a name already listed in any letter case, and an unusable name or link, leaving nothing behind', withNativeKernel(async ({db, owner, outbox}) => {
  const {call} = routes({owner, db});
  const listed = await call('/companies-admin/add', {name: 'local college', url: 'https://other.example/jobs'});
  assert.equal(listed.status, 409);
  assert.equal(listed.body.error, 'Local College is already listed.');
  assert.equal(listed.body.companyId, 1);
  for (const bad of [{}, {name: 'Acme'}, {url: 'https://acme.example/'}, {name: 'A', url: 'https://acme.example/'},
    {name: 'x'.repeat(121), url: 'https://acme.example/'}, {name: 'Acme', url: 'ftp://acme.example/'},
    {name: 'Acme', url: 'javascript:alert(1)'}, {name: 'Acme', url: 'acme.example/jobs'}, {name: 'Acme', url: 'https://user:secret@acme.example/'},
    {name: 'Acme\nInc', url: 'https://acme.example/'}, {name: 'Acme', url: 'https://acme.example/\nsecond'},
    {name: 'Acme', url: `https://acme.example/${'a'.repeat(2100)}`}]) {
    assert.equal((await call('/companies-admin/add', bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  }
  assert.deepEqual(outbox(), []);
  assert.equal((await call('/companies-admin/add', {name: 'Gone Industries', url: 'https://gone.example/new'})).status, 202,
    'a removed employer can be added again; the pull puts it back');
}));

test('Remove and Put back save the change under the employer\'s own id and refuse one that is already true or not listed', withNativeKernel(async ({db, owner, outbox}) => {
  const {call} = routes({owner, db});
  const removed = await call('/companies-admin/remove', {companyId: '1'});
  assert.equal(removed.status, 202);
  assert.match(removed.body.message, /closes the jobs of Local College and stops reading it/);
  const back = await call('/companies-admin/restore', {companyId: '2'});
  assert.equal(back.status, 202);
  assert.match(back.body.message, /lists Gone Industries again/);
  assert.deepEqual(outbox().map(entry => [entry.companyId, entry.target]).sort(), [[1, 'remove:employer'], [2, 'restore:employer']]);
  assert.equal((await call('/companies-admin/remove', {companyId: '2'})).body.error, 'Gone Industries is already removed.');
  assert.equal((await call('/companies-admin/restore', {companyId: '1'})).body.error, 'Local College is not removed.');
  assert.equal((await call('/companies-admin/remove', {companyId: '999'})).status, 404);
  for (const bad of [{}, {companyId: 'x'}, {companyId: '0'}, {companyId: '-3'}]) {
    assert.equal((await call('/companies-admin/remove', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(outbox().length, 2, 'a refusal leaves nothing behind');
}));

test('only an administrator reaches Add, Remove or Put back', withNativeKernel(async ({db, owner, outbox}) => {
  const {call} = routes({owner, db});
  for (const [url, query] of [['/companies-admin/add', {name: 'Acme', url: 'https://acme.example/'}],
    ['/companies-admin/remove', {companyId: '1'}], ['/companies-admin/restore', {companyId: '2'}]]) {
    const refused = await call(url, query, 'ordinary-person');
    assert.equal(refused.status, 403, url);
    assert.equal(refused.passed, false, url);
  }
  assert.deepEqual(outbox(), []);
  const binding = readFileSync(new URL('../authorization.yaml', import.meta.url), 'utf8');
  for (const path of ['/companies-admin/add', '/companies-admin/remove', '/companies-admin/restore']) {
    assert.match(binding, new RegExp(`method: POST, path: ${path}, allOf: \\[career\\.administer\\] \\}`), path);
  }
}));

test('where no nightly pull applies changes, Add, Remove and Put back say so and start nothing', withNativeKernel(async ({db, owner, outbox}) => {
  delete process.env.OSHAL_EGRESS;
  const {call, engine} = routes({owner, db});
  for (const [url, query] of [['/companies-admin/add', {name: 'Acme', url: 'https://acme.example/'}],
    ['/companies-admin/remove', {companyId: '1'}], ['/companies-admin/restore', {companyId: '2'}]]) {
    const answer = await call(url, query);
    assert.equal(answer.status, 409, url);
    assert.match(answer.body.error, /nightly pull, which this installation does not run/);
  }
  assert.deepEqual(outbox(), []);
  assert.equal(engine.runs, 0);
}));
