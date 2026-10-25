/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise offline place/ZIP resolution and every geographic browse path against real SQLite, proving exact distance before pools/pages, coordinate provenance and index readiness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const geo = require('../routes/career-geo.js');
const browse = require('../routes/career-browse-feed.js');
const engine = readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
const CENTER = { lat: 30.4605, lon: -86.5505 };
const query = { near: 'a regional federal hub, FL', radius_miles: '10' };
const schema = engine.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1];
const indexSql = [...engine.match(/\nGEO_INDEX_SQL = \(([\s\S]*?)\n\)/)[1].matchAll(/"([^"]*)"/g)].map(row => row[1]).join('');

function fixture({ fullText = true, index = true } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec("ATTACH DATABASE ':memory:' AS corpus"); db.exec(schema);
  if (index) db.exec(indexSql);
  db.exec("INSERT INTO corpus.companies(id,name,hq) VALUES(1,'Orbital Systems','a regional federal hub, FL')");
  const put = db.prepare(`INSERT INTO corpus.postings_corpus
    (id,company_id,ats_job_id,title,description,location,state,city,lat,lon,active,first_seen_at,salary_min,salary_max,salary_source)
    VALUES(?,1,?,'Engineer','engineer systems','posted location','FL',?,?,?,1,?,?,?,?)`);
  const add = (id, { lat = CENTER.lat, lon = CENTER.lon, city = 'a regional federal hub', salaryMin = null, salaryMax = null, salarySource = null } = {}) => put.run(id, `ats-${id}`, city, lat, lon, `2026-01-01T00:00:${String(id % 60).padStart(2, '0')}Z`, salaryMin, salaryMax, salarySource);
  if (!fullText) {
    db.exec('DROP TRIGGER corpus.postings_fts_insert; DROP TRIGGER corpus.postings_fts_update; DROP TRIGGER corpus.postings_fts_delete; DROP TABLE corpus.postings_fts');
  }
  return { db, add };
}
const ids = page => page.jobs.map(job => job.id);

test('offline towns cover multiple states and full state names, with explicit approximate accuracy', () => {
  for (const near of ['a regional federal hub, FL', 'a regional federal hub FL', 'Eglin Air Force Base, Florida']) {
    const location = geo.resolveCareerLocation({ near }); assert.deepEqual(location.center, CENTER); assert.equal(location.radius_miles, 25); assert.equal(location.accuracy, 'city-centroid');
  }
  assert.ok(geo.resolveCareerLocation({ near: 'New York, NY' }).center.lon < -70);
  assert.ok(geo.resolveCareerLocation({ near: 'Honolulu, HI' }).center.lon < -150);
  assert.ok(geo.resolveCareerLocation({ near: 'Adak, AK' }).center.lat > 50);
});

test('Census ZCTA ZIPs retain leading zeros and expose internal-point rather than address accuracy', () => {
  for (const near of ['32542', '10001', '00601']) {
    const location = geo.resolveCareerLocation({ near, radius_miles: '50' }); assert.equal(location.accuracy, 'zcta-internal-point'); assert.equal(location.label, `ZIP ${near}`); assert.equal(location.radius_miles, 50);
  }
  const source = JSON.parse(readFileSync(new URL('../engine/jobhunter/data/us_zcta_2025.source.json', import.meta.url)));
  const data = readFileSync(new URL('../engine/jobhunter/data/us_zcta_2025.tsv', import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), source.derived_sha256); assert.equal(data.toString().trim().split('\n').length, 33791); assert.equal(source.rows, 33791); assert.match(source.source_url, /^https:\/\/www2\.census\.gov\//);
});

test('invalid, ambiguous, incomplete and unbounded locations fail closed before any database query', () => {
  const bad = [{ near: 'Springfield' }, { near: 'No Such Town, FL' }, { near: '00000' }, { near: ['a regional federal hub, FL'] }, { lat: '91', lon: '0' }, { lat: '0', lon: '-181' }, { lat: 'NaN', lon: '0' }, { lat: '0' }, { near: '32542', lat: '1', lon: '2' }, { ...query, radius_miles: '0' }, { ...query, radius_miles: '251' }, { ...query, radius_miles: 'Infinity' }, { radius_miles: '25' }];
  for (const input of bad) assert.throws(() => browse.fetchBrowsePage({ prepare() { assert.fail('invalid request reached SQLite'); } }, input), error => error.status === 400 && error.code === 'invalid_location' && error.message.length > 12, JSON.stringify(input));
  assert.equal(geo.resolveCareerLocation({}), null); assert.deepEqual(geo.resolveCareerLocation({ lat: '0', lon: '0' }).center, { lat: 0, lon: 0 });
});

test('radius uses posting coordinates, excludes missing or non-city coordinates, and removes bounding-box corners', () => {
  const { db, add } = fixture();
  try {
    add(1); add(2, { lat: CENTER.lat + 0.13, lon: CENTER.lon + 0.15 }); add(3, { lat: null }); add(4, { city: null }); add(5, { lat: 40, lon: -74 }); add(6, { lat: CENTER.lat + 0.05 });
    const page = browse.fetchBrowsePage(db, query); assert.deepEqual(ids(page).sort(), [1, 6]); assert.equal(page.location.accuracy, 'city-centroid');
    const origin = page.jobs.find(job => job.id === 1); assert.equal(origin.distance_miles, 0); assert.equal(origin.city, 'a regional federal hub'); assert.equal(origin.lat, CENTER.lat); assert.equal(origin.lon, CENTER.lon);
    const next = page.jobs.find(job => job.id === 6); assert.ok(next.distance_miles > 3.4 && next.distance_miles < 3.5);
  } finally { db.close(); }
});

test('geographic predicates precede every LIKE title, employer and description candidate bound', () => {
  for (const term of ['engineer', 'Orbital']) {
    const { db, add } = fixture({ fullText: false });
    try {
      add(1); for (let id = 2; id <= browse.ARM_POOL + 25; id++) add(id, { lat: 40, lon: -74 });
      for (const extra of [{}, { description: term }]) assert.deepEqual(ids(browse.fetchBrowsePage(db, { ...query, q: term, ...extra })), [1]);
    } finally { db.close(); }
  }
});

test('geographic predicates precede the bounded FTS employer union and final pagination', () => {
  const { db, add } = fixture();
  try {
    add(1); add(2); add(3); for (let id = 4; id <= browse.ARM_POOL + 25; id++) add(id, { lat: 40, lon: -74 });
    assert.deepEqual(ids(browse.fetchBrowsePage(db, { ...query, q: 'Orbital', per: '2', page: '1' })), [3, 2]);
    assert.deepEqual(ids(browse.fetchBrowsePage(db, { ...query, q: 'Orbital', per: '2', page: '2' })), [1]);
    assert.deepEqual(ids(browse.fetchBrowsePage(db, { ...query, title: 'Engineer', per: '2', page: '2' })), [1]);
  } finally { db.close(); }
});

test('city matching is exact and optional, and ordinary jobs expose null distance without guessing company HQ', () => {
  const { db, add } = fixture();
  try {
    add(1); add(2, { city: 'niceville', lat: 30.5288, lon: -86.476 }); add(3, { city: null, lat: null, lon: null });
    assert.deepEqual(ids(browse.fetchBrowsePage(db, { city: 'a regional federal hub' })), [1]); assert.deepEqual(ids(browse.fetchBrowsePage(db, { city: 'eglin' })), []);
    const ordinary = browse.fetchBrowsePage(db, {}); assert.equal(ordinary.location, null); assert.ok(ordinary.jobs.every(job => job.distance_miles === null)); assert.equal(ordinary.jobs.find(job => job.id === 3).lat, null);
  } finally { db.close(); }
});

test('minimum pay optionally retains genuinely unlisted pay and exposes salary provenance', () => {
  const { db, add } = fixture();
  try {
    add(1, { salaryMin: 140000, salarySource: 'listed' }); add(2); add(3, { salaryMax: 139999, salarySource: 'ai_estimated' }); add(4, { salaryMax: 180000, salarySource: 'ai_estimated' });
    assert.deepEqual(ids(browse.fetchBrowsePage(db, { ...query, min_pay: '140000' })).sort(), [1, 4]);
    const broad = browse.fetchBrowsePage(db, { ...query, min_pay: '140000', include_unknown_pay: '1' }); assert.deepEqual(ids(broad).sort(), [1, 2, 4]); assert.equal(broad.jobs.find(job => job.id === 4).salary_source, 'ai_estimated');
  } finally { db.close(); }
});

test('missing or malformed geo index blocks only radius requests, with a closed readiness reason', () => {
  const { db, add } = fixture({ index: false });
  try {
    add(1); assert.equal(browse.fetchBrowsePage(db, {}).jobs.length, 1); assert.throws(() => browse.fetchBrowsePage(db, query), error => error.status === 503 && error.code === 'geo_index_unavailable');
    db.exec('CREATE INDEX corpus.idx_corpus_geo ON postings_corpus(active, state)'); assert.throws(() => browse.fetchBrowsePage(db, query), error => error.code === 'geo_index_unavailable');
  } finally { db.close(); }
});

test('explicit coordinates handle the antimeridian and poles without dropping nearby points', () => {
  const { db, add } = fixture();
  try {
    add(1, { lat: 0, lon: -179.9 }); add(2, { lat: 89.99, lon: 175 });
    assert.deepEqual(ids(browse.fetchBrowsePage(db, { lat: '0', lon: '179.9', radius_miles: '20' })), [1]);
    assert.deepEqual(ids(browse.fetchBrowsePage(db, { lat: '89.9', lon: '0', radius_miles: '100' })), [2]);
  } finally { db.close(); }
});

test('radius SQL uses the covering coordinate range before reading representative large corpus rows', () => {
  const { db, add } = fixture({ fullText: false });
  try {
    db.exec('BEGIN'); for (let id = 1; id <= 50000; id++) add(id, { lat: 39 + (id % 100) / 100, lon: -75 }); add(50001); db.exec('COMMIT');
    const plans = [];
    const observed = { prepare(sql) { const statement = db.prepare(sql); return { all(...args) { if (/SELECT .*p\.id/s.test(sql)) plans.push(...db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args)); return statement.all(...args); }, get: (...args) => statement.get(...args) }; } };
    const started = performance.now(); assert.deepEqual(ids(browse.fetchBrowsePage(observed, query)), [50001]); const elapsed = performance.now() - started;
    assert.ok(plans.some(row => /SEARCH p USING INDEX idx_corpus_geo \(active=\? AND lat>\? AND lat<\?\)/.test(row.detail)), JSON.stringify(plans));
    assert.ok(!plans.some(row => /SCAN p\b/.test(row.detail)), JSON.stringify(plans));
    console.log(`50,001-row geographic query: ${elapsed.toFixed(2)} ms; indexed latitude range`);
  } finally { db.close(); }
});

test('production engine persists the geo index on writable ingests and keeps older read-only corpora usable', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('python3', [new URL('./career-geo-index-contract.py', import.meta.url).pathname], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop()); assert.deepEqual(report.failed, []); assert.equal(report.checks, 6);
});

test('compiled HTTP handler exposes 400/503 reasons and ordinary browse does not build a missing geo index', () => {
  const Module = require('node:module'); const oldLoad = Module._load; let storeDb = null, writes = 0;
  const logs = [];
  Module._load = function (request, ...rest) {
    if (request === '@/shared/logger') return { createChildLogger: () => Object.fromEntries(['info', 'warn', 'error'].map(key => [key, (...args) => logs.push(args)])) };
    if (request === './career-user-store') return { callerSub: req => req.userSub, openCorpusDb: readonly => { if (readonly === false) { writes++; return null; } return storeDb; } };
    return oldLoad.call(this, request, ...rest);
  };
  let routes;
  try { routes = require('../routes/career-browse-routes.js'); } finally { Module._load = oldLoad; }
  let handler; routes.registerCareerBrowseRoutes({ get: (path, fn) => { if (path === '/browse') handler = fn; } });
  const request = (input, userSub = 'fixture-person') => {
    const result = { status: 200, body: null }; const response = { status(code) { result.status = code; return response; }, json(body) { result.body = body; return response; } };
    handler({ userSub, query: input }, response); return result;
  };
  assert.equal(request({ near: 'unknown town' }).status, 400);
  assert.equal(request({}, null).status, 401);
  assert.equal(request(query).body.empty, true);
  const one = fixture({ index: false }); storeDb = one.db; routes.resetBrowseIndexState();
  assert.equal(routes.ensureBrowseIndex(storeDb), true); assert.equal(writes, 0, 'ordinary browse never starts a large geo index build');
  const refused = request({ lat: '35.123456', lon: '-80.987654', radius_miles: '15' });
  assert.equal(refused.status, 503); assert.equal(refused.body.code, 'geo_index_unavailable'); assert.ok(refused.body.message.length > 20);
  assert.doesNotMatch(JSON.stringify(logs), /35\.123456|80\.987654/);
  storeDb = null;
});
