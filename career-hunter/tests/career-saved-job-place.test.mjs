/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.4 (Roger, 2026-11-16: "the job location doesnt transfer to the my jobs page and i cant look at jobs near me"). The compiled board and browse routes over real disposable SQLite (the engine's own corpus and owner schemas), with made-up towns and invented jobs: a job saved from Find jobs reaches My jobs with the place Find jobs showed; every saved job carries its place text, how it is worked, its city point and its miles from the person's own home (their saved Matching area); jobs saved before this version read the same from their postings for every person, twice alike, and the read writes nothing; a posting that names no place gets none; Within 10/25/50/100 miles and Remote only keep exactly the right jobs over every page; nearest first puts jobs with no distance last; a bad Within is refused; with no home the answer says so and where to set it, and a distance is refused rather than widened; one job's detail carries the same fields; a corpus published before the place columns still reads, and refuses a distance.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRouter, loadCompiledModules} from './helpers/career-route-harness.mjs';

/** better-sqlite3's surface over node:sqlite, as the other compiled-route suites use it. */
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
      try { const out = fn(...args); this.exec('COMMIT'); return out; }
      catch (error) { this.exec('ROLLBACK'); throw error; }
    };
  }
  close() { this.db.close(); }
}

const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
const schema = name => engine.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`))[1];
const geoIndex = [...engine.match(/\nGEO_INDEX_SQL = \(([\s\S]*?)\n\)/)[1].matchAll(/"([^"]*)"/g)].map(row => row[1]).join('');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-saved-job-place-'));
const previous = process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT = root;
const {modules} = loadCompiledModules({board:'routes/career-board-routes.js', browse:'routes/career-browse-routes.js',
  store:'routes/career-user-store.js', scope:'routes/career-search-scope.js', geo:'routes/career-geo.js'}, {'better-sqlite3':SqliteAdapter});
const router = createRouter();
modules.board.registerCareerBoardRoutes(router, {pool:{query:()=>{throw Error('No external SQL is needed.');}}});
modules.browse.registerCareerBrowseRoutes(router);
after(() => {
  if (previous === undefined) delete process.env.JOBHUNTER_STORE_ROOT; else process.env.JOBHUNTER_STORE_ROOT = previous;
  fs.rmSync(root, {recursive:true, force:true});
});

// Made-up homes in towns the offline places data knows; the jobs and employers are invented.
const HOME = modules.geo.resolveCareerLocation({near:'Bend, OR'}).center;
const OTHER_HOME = modules.geo.resolveCareerLocation({near:'Duluth, MN'}).center;
const MILES_PER_DEGREE = modules.geo.EARTH_MILES * Math.PI / 180;
/** A point `miles` due north of home: along a meridian the straight-line distance is exactly that. */
const north = miles => ({lat:HOME.lat + miles / MILES_PER_DEGREE, lon:HOME.lon});
const JOBS = [
  // id, title, place text, remote flag, miles north of home (null = the posting has no point), state
  [11, 'Warehouse Lead', 'Bend, OR', 0, 9, 'OR'],
  [12, 'Field Engineer (Onsite)', 'Redmond, OR', 0, 24.9, 'OR'],
  [13, 'Analyst - Hybrid', 'Sisters, OR', 0, 25.1, 'OR'],
  [14, 'Program Manager', 'Prineville, OR', 0, 49.9, 'OR'],
  [15, 'Designer', 'La Pine, OR', 0, 99.9, 'OR'],
  [16, 'Planner', 'Far Away, OR', 0, 150, 'OR'],
  [17, 'Software Engineer', 'Remote - US', 1, 5, null],
  [18, 'Recruiter', 'Remote', 1, null, null],
  [19, 'Coordinator', 'United States', 0, null, null],
  [20, 'Clerk', null, 0, null, null],
  [21, 'Remote Sensing Analyst', 'Bend, OR', 1, 1, 'OR'],
  [22, 'Inspector', 'Oregon', 0, null, 'OR'],
];
const ALL = JOBS.map(([id]) => id);

/** The engine's own corpus with the invented jobs, and the geographic index Find jobs needs. */
function seedCorpus() {
  const paths = modules.store.userPaths('place-seed');
  fs.mkdirSync(path.dirname(paths.corpusDb), {recursive:true});
  const corpus = new DatabaseSync(':memory:');
  corpus.prepare('ATTACH DATABASE ? AS corpus').run(paths.corpusDb);
  corpus.exec(schema('CORPUS_SCHEMA')); corpus.exec(geoIndex);
  corpus.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Invented Employer')");
  const put = corpus.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,location,remote,state,city,lat,lon,
    active,first_seen_at,description) VALUES(?,1,?,?,?,?,?,?,?,?,1,'2026-11-01T00:00:00Z','An invented job for a test.')`);
  for (const [id, title, location, remote, miles, state] of JOBS) {
    const at = miles === null ? {lat:null, lon:null} : north(miles);
    put.run(id, `fixture-${id}`, title, location, remote, state, miles === null ? null : 'fixture town', at.lat, at.lon);
  }
  corpus.close();
}
seedCorpus();

/** One person's store: the engine's owner schema, and optionally their saved Matching area. */
async function person(sub, near) {
  const paths = modules.store.userPaths(sub);
  fs.mkdirSync(paths.userDir, {recursive:true});
  const db = new DatabaseSync(paths.userDb); db.exec(schema('USER_SCHEMA')); db.close();
  if (near) await modules.scope.saveJobSearchScope(paths.userDir, {near, radiusMiles:50, includeRemote:true});
  return paths;
}

/** Saved the way every Career version before this one left a save: a signal row and a board entry with no place. */
function savedBefore(paths, ids) {
  const db = new DatabaseSync(paths.userDb);
  for (const id of ids) db.prepare('INSERT INTO user_signals(posting_id) VALUES(?)').run(id);
  db.close();
  const jobs = Object.fromEntries(ids.map(id => [id, {favorite:true, savedAt:'2026-11-01T00:00:00.000Z'}]));
  fs.writeFileSync(path.join(paths.userDir, 'job-board-state.json'), JSON.stringify({version:1, jobs}) + '\n');
}

/** Call one compiled handler as the given person. */
async function call(method, pathname, sub, {body = {}, query = {}} = {}) {
  const found = router.find(method, pathname); assert.ok(found, `${method} ${pathname} is mounted`);
  return new Promise((resolve, reject) => {
    const out = {code:200, body:null};
    const res = {status(code) { out.code = code; return res; }, setHeader() {}, json(value) { out.body = value; resolve(out); return res; }};
    Promise.resolve(found.handler({oidc:{user:sub ? {sub} : null}, params:found.params, body, query, headers:{}}, res)).catch(reject);
  });
}
const saved = (sub, query = {}) => call('GET', '/jobs', sub, {query:{status:'saved', per:'50', ...query}});
const byId = body => new Map(body.jobs.map(job => [Number(job.id), job]));
const ids = body => body.jobs.map(job => Number(job.id));
/** The haversine formula, written out here on its own so the route is checked against arithmetic it did not do. */
function miles(a, b) {
  const r = d => d * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
const one = value => Math.round(value * 10) / 10;
/** A file's bytes, to prove a read wrote nothing. */
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('save path: a job saved from Find jobs reaches My jobs with the place Find jobs showed for it', async () => {
  const paths = await person('place-saver', 'Bend, OR');
  const found = await call('GET', '/browse', 'place-saver', {query:{near:'Bend, OR', radius_miles:'250', per:'50'}});
  assert.equal(found.code, 200, JSON.stringify(found.body));
  const shown = found.body.jobs.find(job => Number(job.id) === 12);
  assert.ok(shown && typeof shown.lat === 'number' && typeof shown.distance_miles === 'number', 'Find jobs shows the job with its point and miles');
  const save = await call('POST', '/jobs/12/status', 'place-saver', {body:{favorite:true}});
  assert.equal(save.code, 200, JSON.stringify(save.body));
  const mine = byId((await saved('place-saver')).body).get(12);
  assert.ok(mine, 'the saved job is on My jobs');
  assert.equal(mine.location, shown.location, 'the same place text');
  assert.equal(mine.lat, shown.lat, 'the same map point (latitude)');
  assert.equal(mine.lon, shown.lon, 'the same map point (longitude)');
  assert.equal(mine.workplaceType, 'onsite', 'how it is worked, from the posting\'s own words');
  assert.equal(mine.distanceMiles, one(shown.distance_miles), 'the miles Find jobs showed, from the same home');
  assert.equal(mine.distanceMiles, 24.9);
  assert.ok(fs.existsSync(path.join(paths.userDir, 'job-board-state.json')));
});

test('every saved job carries its place, how it is worked, its point and its miles from home; remote and unplaced jobs say so', async () => {
  await person('place-all', 'Bend, OR');
  for (const id of ALL) assert.equal((await call('POST', `/jobs/${id}/status`, 'place-all', {body:{favorite:true}})).code, 200, `save ${id}`);
  const answer = await saved('place-all');
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.deepEqual(answer.body.home, {known:true, label:'Bend, OR', radiusMiles:50,
    line:'Miles are straight-line from Bend, OR, not driving distance.', settingsUrl:'/api/career-hunter/settings?section=matching'});
  const jobs = byId(answer.body);
  assert.deepEqual([...jobs.keys()].sort((a, b) => a - b), ALL);
  const expect = {
    11:['Bend, OR', null, 9], 12:['Redmond, OR', 'onsite', 24.9], 13:['Sisters, OR', 'hybrid', 25.1], 14:['Prineville, OR', null, 49.9],
    15:['La Pine, OR', null, 99.9], 16:['Far Away, OR', null, 150], 17:['Remote - US', 'remote', null], 18:['Remote', 'remote', null],
    19:['United States', null, null], 20:[null, null, null], 21:['Bend, OR', null, 1], 22:['Oregon', null, null]};
  for (const [id, [location, workplaceType, distanceMiles]] of Object.entries(expect)) {
    const job = jobs.get(Number(id));
    assert.deepEqual({location:job.location, workplaceType:job.workplaceType, distanceMiles:job.distanceMiles},
      {location, workplaceType, distanceMiles}, `job ${id}`);
  }
  assert.deepEqual([jobs.get(17).lat, jobs.get(17).lon], [north(5).lat, north(5).lon], 'a remote job keeps its point but has no trip to make');
  for (const id of [18, 19, 20, 22]) assert.deepEqual([jobs.get(id).lat, jobs.get(id).lon], [null, null], `job ${id} has no point`);
  assert.equal(jobs.get(21).remote, 0, 'remote sensing is an occupation, not a workplace');
});

test('backfill: jobs saved before this version read their place from their postings, for every person, alike twice, writing nothing', async () => {
  const people = {'place-before-a':'Bend, OR', 'place-before-b':'Duluth, MN', 'place-before-c':null};
  for (const [sub, near] of Object.entries(people)) savedBefore(await person(sub, near), ALL);
  for (const [sub, near] of Object.entries(people)) {
    const paths = modules.store.userPaths(sub);
    const files = ['job-board-state.json', path.basename(paths.userDb)].map(name => path.join(paths.userDir, name));
    const before = files.map(digest);
    const first = await saved(sub), second = await saved(sub);
    assert.equal(first.code, 200, JSON.stringify(first.body));
    assert.deepEqual(second.body.jobs, first.body.jobs, `${sub}: a second read answers the same`);
    assert.deepEqual(files.map(digest), before, `${sub}: reading wrote nothing`);
    const jobs = byId(first.body), home = near === 'Duluth, MN' ? OTHER_HOME : near ? HOME : null;
    assert.equal(first.body.home.known, Boolean(near));
    for (const [id, , location, , milesNorth] of JOBS) {
      const job = jobs.get(id), point = milesNorth === null ? null : north(milesNorth);
      assert.equal(job.location, location, `${sub} job ${id}: place text from the posting`);
      assert.deepEqual([job.lat, job.lon], point ? [point.lat, point.lon] : [null, null], `${sub} job ${id}: point from the posting`);
      const want = home && point && job.workplaceType !== 'remote' ? one(miles(home, point)) : null;
      assert.equal(job.distanceMiles, want, `${sub} job ${id}: miles from this person's own home`);
    }
  }
});

test('a posting that names no place gets none: no point, no distance, never inside a radius', async () => {
  await person('place-none', 'Bend, OR');
  for (const id of [19, 20, 22]) await call('POST', `/jobs/${id}/status`, 'place-none', {body:{favorite:true}});
  const jobs = byId((await saved('place-none')).body);
  assert.deepEqual([...jobs.values()].map(job => [job.lat, job.lon, job.distanceMiles, job.workplaceType]),
    [[null, null, null, null], [null, null, null, null], [null, null, null, null]], 'a country, a state or nothing is not a place to measure from');
  assert.equal(jobs.get(20).location, null, 'no place text stays empty (the page says Location unknown)');
  assert.deepEqual(ids((await saved('place-none', {within:'250'})).body), [], 'not inside even the widest radius');
});

test('distance math: the row\'s miles are the miles the SQL radius measures', async () => {
  const place = await import('../lib/career-job-place.js');
  const {careerDistanceSql} = modules.geo, db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE p(lat REAL, lon REAL)');
  const points = [north(24.9), north(25.1), {lat:HOME.lat - 0.3, lon:HOME.lon + 1.7}, OTHER_HOME, {lat:-33.8688, lon:151.2093}, {lat:64.2, lon:-179.9}];
  for (const point of points) db.prepare('INSERT INTO p VALUES(?,?)').run(point.lat, point.lon);
  const sql = db.prepare(`SELECT ${careerDistanceSql({center:HOME}, 'p')} AS d FROM p`).all().map(row => row.d);
  points.forEach((point, index) => {
    assert.ok(Math.abs(place.milesBetween(HOME, point) - sql[index]) < 1e-6, `point ${index}`);
    assert.ok(Math.abs(miles(HOME, point) - sql[index]) < 1e-6, `point ${index} (independent formula)`);
  });
  db.close();
  assert.equal(place.decorate({lat:north(24.94).lat, lon:HOME.lon, location:'x', remote:0, title:'t'}, HOME).distanceMiles, 24.9);
  assert.equal(place.decorate({lat:north(24.96).lat, lon:HOME.lon, location:'x', remote:0, title:'t'}, HOME).distanceMiles, 25);
  for (const [title, location, want] of [['Hybrid Cloud Engineer', 'Bend, OR', null], ['Analyst', 'Hybrid - 3 days in office', 'hybrid'],
    ['Nurse', 'On-site, Bend, OR', 'onsite'], ['Analyst', 'Remote 2 days', 'hybrid'], ['Driver', 'Bend, OR', null]]) {
    assert.equal(place.workplaceType({title, location, remote:0}), want, `${title} / ${location}`);
  }
});

test('Within N miles keeps exactly the jobs at or under N over every page; Remote only keeps fully remote jobs', async () => {
  await person('place-near', 'Bend, OR');
  for (const id of ALL) await call('POST', `/jobs/${id}/status`, 'place-near', {body:{favorite:true}});
  const within = async value => ids((await saved('place-near', {within:value})).body).sort((a, b) => a - b);
  assert.deepEqual(await within('10'), [11, 21]);
  assert.deepEqual(await within('25'), [11, 12, 21], '24.9 miles is inside 25; 25.1 is not; a remote job 5 miles away is not a local job');
  assert.deepEqual(await within('50'), [11, 12, 13, 14, 21]);
  assert.deepEqual(await within('100'), [11, 12, 13, 14, 15, 21]);
  assert.deepEqual(await within('remote'), [17, 18]);
  const pages = [];
  for (let page = 1; page <= 4; page += 1) pages.push(...ids((await saved('place-near', {within:'100', sort:'distance', per:'2', page:String(page)})).body));
  assert.deepEqual(pages, [21, 11, 12, 13, 14, 15], 'every page of the filtered list, nearest first, none twice');
});

test('nearest first: jobs with a distance by miles, then every job without one', async () => {
  await person('place-sort', 'Bend, OR');
  for (const id of ALL) await call('POST', `/jobs/${id}/status`, 'place-sort', {body:{favorite:true}});
  const answer = await saved('place-sort', {sort:'distance'});
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.deepEqual(ids(answer.body), [21, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22]);
  assert.deepEqual(answer.body.jobs.map(job => job.distanceMiles), [1, 9, 24.9, 25.1, 49.9, 99.9, 150, null, null, null, null, null]);
});

test('a bad Within is refused with words, not ignored', async () => {
  await person('place-bad', 'Bend, OR');
  await call('POST', '/jobs/11/status', 'place-bad', {body:{favorite:true}});
  for (const value of ['0', '251', '10.5', 'near', ['10', '25']]) {
    const answer = await saved('place-bad', {within:value});
    assert.equal(answer.code, 400, JSON.stringify(value));
    assert.equal(answer.body.error, 'invalid_within');
    assert.ok(answer.body.message && !answer.body.jobs);
  }
});

test('no home: the answer says so and where to set it; a distance is refused, never widened; Remote only still works', async () => {
  await person('place-homeless', null);
  for (const id of ALL) await call('POST', `/jobs/${id}/status`, 'place-homeless', {body:{favorite:true}});
  const answer = await saved('place-homeless');
  assert.equal(answer.code, 200);
  const home = {known:false, label:null, radiusMiles:null, line:'Set your home city or ZIP to see how far each job is from you.',
    settingsUrl:'/api/career-hunter/settings?section=matching'};
  assert.deepEqual(answer.body.home, home);
  assert.ok(answer.body.jobs.every(job => job.distanceMiles === null), 'no miles without a home');
  assert.equal(byId(answer.body).get(12).lat, north(24.9).lat, 'the job\'s own point is still there');
  for (const query of [{within:'25'}, {sort:'distance'}]) {
    const refused = await saved('place-homeless', query);
    assert.equal(refused.code, 400, JSON.stringify(query));
    assert.equal(refused.body.error, 'home_location_required');
    assert.match(refused.body.message, /Matching area/);
    assert.deepEqual(refused.body.home, home);
  }
  assert.deepEqual(ids((await saved('place-homeless', {within:'remote'})).body).sort((a, b) => a - b), [17, 18]);
});

test('one job\'s detail carries the same place; an unreadable home leaves out only the distance', async () => {
  const paths = await person('place-detail', 'Bend, OR');
  await call('POST', '/jobs/13/status', 'place-detail', {body:{favorite:true}});
  const detail = await call('GET', '/jobs/13', 'place-detail');
  assert.equal(detail.code, 200, JSON.stringify(detail.body));
  assert.deepEqual([detail.body.job.location, detail.body.job.workplaceType, detail.body.job.lat, detail.body.job.distanceMiles],
    ['Sisters, OR', 'hybrid', north(25.1).lat, 25.1]);
  fs.writeFileSync(path.join(paths.userDir, modules.scope.SEARCH_SCOPE_FILE), '{not json');
  const blind = await call('GET', '/jobs/13', 'place-detail');
  assert.equal(blind.code, 200, 'the detail still opens');
  assert.deepEqual([blind.body.job.location, blind.body.job.lat, blind.body.job.distanceMiles], ['Sisters, OR', north(25.1).lat, null]);
});

test('a corpus published before the place columns still lists saved jobs, and refuses a distance', async () => {
  const oldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-saved-job-place-old-'));
  process.env.JOBHUNTER_STORE_ROOT = oldRoot;
  try {
    const paths = modules.store.userPaths('place-old');
    fs.mkdirSync(path.dirname(paths.corpusDb), {recursive:true}); fs.mkdirSync(paths.userDir, {recursive:true});
    const corpus = new DatabaseSync(paths.corpusDb);
    corpus.exec(`CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT,industry TEXT,referral INTEGER);
      CREATE TABLE postings_corpus(id INTEGER PRIMARY KEY,company_id INTEGER,title TEXT,location TEXT,url TEXT,posted_date TEXT,first_seen_at TEXT,
        job_type TEXT,remote INTEGER,state TEXT,salary_min INTEGER,salary_max INTEGER,salary_currency TEXT,salary_period TEXT,salary_source TEXT,
        target_role INTEGER,active INTEGER,description TEXT);
      INSERT INTO companies(id,name) VALUES(1,'Invented Employer');
      INSERT INTO postings_corpus(id,company_id,title,location,remote,state,active) VALUES(1,1,'Old Job','Bend, OR',0,'OR',1),(2,1,'Old Remote Job','Remote',1,NULL,1);`);
    corpus.close();
    const db = new DatabaseSync(paths.userDb); db.exec(schema('USER_SCHEMA')); db.close();
    await modules.scope.saveJobSearchScope(paths.userDir, {near:'Bend, OR', radiusMiles:50, includeRemote:true});
    savedBefore(paths, [1, 2]);
    const answer = await saved('place-old');
    assert.equal(answer.code, 200, JSON.stringify(answer.body));
    assert.deepEqual(answer.body.jobs.map(job => [job.id, job.location, job.lat, job.lon, job.distanceMiles]).sort(),
      [[1, 'Bend, OR', null, null, null], [2, 'Remote', null, null, null]]);
    for (const query of [{within:'25'}, {sort:'distance'}]) {
      const refused = await saved('place-old', query);
      assert.equal(refused.code, 400, JSON.stringify(query));
      assert.equal(refused.body.error, 'places_unavailable');
    }
    assert.deepEqual(ids((await saved('place-old', {within:'remote'})).body), [2]);
  } finally {
    process.env.JOBHUNTER_STORE_ROOT = root;
    fs.rmSync(oldRoot, {recursive:true, force:true});
  }
});

test('a person with no Career store yet is told the same about their home', async () => {
  const paths = modules.store.userPaths('place-no-store');
  await modules.scope.saveJobSearchScope(paths.userDir, {near:'Bend, OR', radiusMiles:25, includeRemote:false});
  const known = await saved('place-no-store');
  assert.equal(known.code, 200);
  assert.deepEqual([known.body.jobs, known.body.empty, known.body.home.known, known.body.home.label], [[], true, true, 'Bend, OR']);
  const nobody = await saved('place-nobody-yet');
  assert.deepEqual([nobody.body.empty, nobody.body.home.known, nobody.body.home.settingsUrl], [true, false, '/api/career-hunter/settings?section=matching']);
});
