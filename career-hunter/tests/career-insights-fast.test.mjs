/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Live 2026-10-12 GET /api/career-hunter/analytics answered 503 "package response stalled before the next protocol message" after ~10 s on every call and Insights showed all zeros: its five aggregates read each in-lane posting row past the inline description (44.3 s cold on a copy of the live corpus). Guards, on real SQLite with the engine's own schema: the served readAnalytics answers exactly what the previous five statements answered; its corpus reads plan only against the covering idx_corpus_insights (never a row of postings_corpus); without that index it refuses at once with InsightsNotReady; the production engine creates the index on a writable corpus and still connects to a read-only one without it (tests/career-insights-index-contract.py); both board routes answer that refusal as 503 with its reason; and the Insights page shows a refused read's reason instead of zeros.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const insights = require('../routes/career-insights.js');
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

/** The engine's own schema text and the Insights index statement, as the engine creates them. */
function engine(name) {
  const source = read('../engine/jobhunter/db.py');
  if (name === 'INSIGHTS_INDEX_SQL') {
    const block = source.match(/\nINSIGHTS_INDEX_SQL = \(([\s\S]*?)\n\)/)[1];
    return [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
  }
  return source.match(new RegExp(`\\n${name} = """([\\s\\S]*?)"""`))[1];
}

/** The five statements GET /analytics ran before (career-board-routes.ts seq 8), as the reference answer. */
function previousAnswer(db) {
  const lane = 'FROM corpus.postings_corpus p LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.active=1 AND COALESCE(p.target_role,0)=1';
  const score = 'COALESCE(s.ai_fit_score,s.fit_score,0)';
  const pay = 'CASE WHEN p.salary_max>0 AND p.salary_max<=1000000 THEN p.salary_max END';
  const plain = (rows) => rows.map((r) => ({ ...r }));
  return {
    headline: { ...db.prepare(`SELECT COUNT(*) AS inlane, SUM(CASE WHEN ${score}>=70 THEN 1 ELSE 0 END) AS fit70,
      SUM(CASE WHEN ${score}>=80 THEN 1 ELSE 0 END) AS fit80, SUM(CASE WHEN p.posted_date>=date('now','-7 days') THEN 1 ELSE 0 END) AS fresh7d,
      CAST(AVG(CASE WHEN ${score}>=70 THEN ${pay} END) AS INT) AS avg_pay_fit70, COUNT(DISTINCT p.company_id) AS companies ${lane}`).get() },
    funnel: { ...db.prepare(`SELECT (SELECT COUNT(*) ${lane}) AS sourced, (SELECT COUNT(*) ${lane} AND ${score}>=70) AS qualified,
      (SELECT COUNT(*) FROM user_signals WHERE status='generated') AS generated, (SELECT COUNT(*) FROM user_signals WHERE status='applied') AS applied,
      (SELECT COUNT(*) FROM user_signals WHERE status='interview') AS interview, (SELECT COUNT(*) FROM user_signals WHERE status='offer') AS offer,
      (SELECT COUNT(*) FROM user_signals WHERE status='promoted') AS promoted`).get() },
    topCompanies: plain(db.prepare(`SELECT c.name AS company, COUNT(*) AS roles, CAST(AVG(${score}) AS INT) AS avg_fit, MAX(COALESCE(c.referral,0)) AS referral
      FROM corpus.postings_corpus p JOIN corpus.companies c ON c.id=p.company_id LEFT JOIN user_signals s ON s.posting_id=p.id
      WHERE p.active=1 AND COALESCE(p.target_role,0)=1 GROUP BY c.id ORDER BY roles DESC, avg_fit DESC LIMIT 12`).all()),
    states: plain(db.prepare(`SELECT COALESCE(NULLIF(p.state,''),'(remote/—)') AS state, COUNT(*) AS n ${lane} GROUP BY 1 ORDER BY n DESC LIMIT 12`).all()),
    salaryBands: plain(db.prepare(`SELECT CASE WHEN ${pay} IS NULL THEN 'n/a' WHEN ${pay}<150000 THEN '<150k' WHEN ${pay}<200000 THEN '150-200k'
      WHEN ${pay}<250000 THEN '200-250k' WHEN ${pay}<350000 THEN '250-350k' ELSE '350k+' END AS band, COUNT(*) AS n
      ${lane} AND ${score}>=70 GROUP BY band ORDER BY n DESC`).all()),
  };
}

/** A caller's store with the corpus attached, seeded with distinct counts so every ordering is unambiguous. */
function store({ index = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(engine('CORPUS_SCHEMA'));
  db.exec(engine('USER_SCHEMA'));
  if (index) db.exec(engine('INSIGHTS_INDEX_SQL'));
  db.exec(`INSERT INTO corpus.companies (id, name, referral) VALUES (1, 'Acme', 2), (2, 'Beta', 0), (3, 'Gamma', NULL);`);
  const posting = db.prepare(`INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, active, target_role, state, posted_date, salary_max, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const signal = db.prepare('INSERT INTO user_signals (posting_id, fit_score, ai_fit_score, status) VALUES (?, ?, ?, ?)');
  const today = db.prepare("SELECT date('now') AS d, date('now','-30 days') AS old").get();
  const rows = [
    // id, company, active, lane, state, posted, pay, fit, aiFit, status
    [1, 1, 1, 1, 'TX', today.d, 180000, 60, 85, 'applied'], [2, 1, 1, 1, 'TX', today.d, 120000, 72, null, 'generated'],
    [3, 1, 1, 1, 'TX', today.old, 400000, null, 91, 'interview'], [4, 1, 1, 1, '', today.old, 2000000, 75, null, 'new'],
    [5, 2, 1, 1, null, today.d, null, 71, null, 'generated'], [6, 2, 1, 1, 'FL', today.old, 260000, null, null, null],
    [7, 3, 1, 1, 'TX', today.d, 210000, 50, 40, 'promoted'], [8, 9, 1, 1, 'TX', today.d, 0, 79, null, 'offer'],
    [9, 1, 0, 1, 'TX', today.d, 300000, 99, 99, 'applied'], [10, 1, 1, 0, 'CA', today.d, 300000, 99, 99, null],
    [11, 1, 1, null, 'CA', today.d, 300000, 99, 99, null],
  ];
  for (const [id, company, active, lane, state, posted, pay, fit, ai, status] of rows) {
    posting.run(id, company, `j${id}`, active, lane, state, posted, pay, 'x'.repeat(3000));
    if (status !== null || fit !== null || ai !== null) signal.run(id, fit, ai, status || 'new');
  }
  return db;
}

test('the served Insights answer equals the previous five statements', () => {
  const db = store();
  const served = JSON.parse(JSON.stringify(insights.readAnalytics(db)));
  const previous = JSON.parse(JSON.stringify(previousAnswer(db)));
  // SQL leaves the order of equal counts open; compare tied rows as a set, keeping the count order.
  const tied = (rows) => Array.isArray(rows) ? [...rows].sort((a, b) => (b.n ?? b.roles) - (a.n ?? a.roles) || JSON.stringify(a).localeCompare(JSON.stringify(b))) : rows;
  for (const key of Object.keys(previous)) assert.deepEqual(tied(served[key]), tied(previous[key]), key);
  for (const key of ['states', 'salaryBands']) {
    const counts = served[key].map((r) => r.n);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a), `${key} most first`);
  }
  assert.equal(served.headline.inlane, 8);
  assert.deepEqual(served.states[0], { state: 'TX', n: 5 });
  db.close();
});

test('every corpus read plans against the covering index, never a posting row', () => {
  const db = store();
  const plans = [];
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (/postings_corpus/.test(sql)) {
      plans.push(...original(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).filter((d) => /postings_corpus/.test(d)));
    }
    return original(sql);
  };
  insights.readAnalytics(db);
  assert.ok(plans.length >= 2, `plans: ${plans}`);
  for (const detail of plans) assert.match(detail, /USING COVERING INDEX idx_corpus_insights/, detail);
  db.close();
});

test('without the index the read refuses at once instead of scanning', () => {
  const db = store({ index: false });
  const lanes = [];
  const original = db.prepare.bind(db);
  db.prepare = (sql) => { if (/postings_corpus/.test(sql)) lanes.push(sql); return original(sql); };
  assert.throws(() => insights.readAnalytics(db), (err) => err instanceof insights.InsightsNotReady && err.code === 'insights_index_missing');
  assert.deepEqual(lanes, [], 'no posting is read');
  db.close();
});

test('the production engine creates the index on a writable corpus and still opens a read-only one without it', () => {
  const result = spawnSync('python3', [new URL('./career-insights-index-contract.py', import.meta.url).pathname], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.deepEqual(report.failed, []);
  assert.equal(report.checks, 6);
});

test('both board routes read through career-insights and answer its refusal as 503 with the reason', () => {
  const ts = read('../src-routes/career-board-routes.ts');
  const js = read('../routes/career-board-routes.js');
  assert.match(ts, /import \{ InsightsNotReady, readAnalytics \} from '\.\/career-insights';/);
  assert.match(ts, /err instanceof InsightsNotReady[\s\S]{0,200}res\.status\(503\)\.json\(\{ error: err\.message, reason: err\.code \}\)/);
  assert.match(js, /require\("\.\/career-insights"\)/);
  assert.match(js, /err instanceof career_insights_1\.InsightsNotReady[\s\S]{0,200}res\.status\(503\)\.json\(\{ error: err\.message, reason: err\.code \}\)/);
  for (const source of [ts, js]) assert.doesNotMatch(source, /function readAnalytics/, 'no second copy of the slow statements');
});

/** Run the Insights page's script against a stubbed fetch; returns what #body shows. */
async function page(status, body) {
  const html = read('../tools/career-insights.html');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const el = { innerHTML: '' };
  const context = {
    document: { getElementById: () => el },
    fetch: async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }),
    Math, String, Number,
  };
  vm.runInNewContext(script, context);
  for (let i = 0; i < 20 && /Loading|^$/.test(el.innerHTML); i += 1) await new Promise((r) => setImmediate(r));
  return el.innerHTML;
}

test('the Insights page shows a refused read\'s reason instead of zeros', async () => {
  const stalled = await page(503, { detail: 'unavailable: package response stalled before the next protocol message', refused: 'store_unavailable' });
  assert.match(stalled, /Insights could not be loaded: unavailable: package response stalled before the next protocol message/);
  assert.doesNotMatch(stalled, /In-lane roles/);
  const notReady = await page(503, { error: new insights.InsightsNotReady().message, reason: 'insights_index_missing' });
  assert.match(notReady, /Insights are not ready yet/);
  const served = await page(200, insights.readAnalytics(store()));
  assert.match(served, /<div class="v">8<\/div><div class="l">In-lane roles<\/div>/);
});
