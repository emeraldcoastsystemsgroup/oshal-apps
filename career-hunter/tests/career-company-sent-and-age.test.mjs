/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.0: Verify per-company confirmed-sent count truth, deterministic tracked-application age/30-day fields across routes and native readers, owner isolation, and responsive desktop/phone badge rendering on My jobs and Prepare application.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRouter, loadCompiledModules } from './helpers/career-route-harness.mjs';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

const require = createRequire(import.meta.url);
class SqliteAdapter {
  constructor(filename, options = {}) {
    this.db = new DatabaseSync(filename, { readOnly: Boolean(options.readonly), enableForeignKeyConstraints: true });
  }
  exec(sql) { this.db.exec(sql); return this; }
  prepare(sql) {
    const stmt = this.db.prepare(sql);
    stmt.setAllowBareNamedParameters(true);
    return { get: (...a) => stmt.get(...a), all: (...a) => stmt.all(...a), run: (...a) => stmt.run(...a) };
  }
  pragma(sql) { return this.prepare(`PRAGMA ${sql}`).all(); }
  close() { this.db.close(); }
}
const Database = SqliteAdapter;
const companySent = require('../lib/career-company-sent.js');
const submissionQueue = require('../lib/career-submission-queue.js');

const root = mkdtempSync(join(tmpdir(), 'career-sent-age-'));
const previousStore = process.env.JOBHUNTER_STORE_ROOT;
const previousMount = process.env.OSHAL_CAREER_OWNER_MOUNT;
process.env.JOBHUNTER_STORE_ROOT = root;
process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
const alphaPrincipal = { subject: 'owner-alpha', issuer: 'fixture', id: 'alpha-id', tenant: 'default', state: 'active' };

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => {
  await browser?.close();
  if (previousStore === undefined) delete process.env.JOBHUNTER_STORE_ROOT;
  else process.env.JOBHUNTER_STORE_ROOT = previousStore;
  if (previousMount === undefined) delete process.env.OSHAL_CAREER_OWNER_MOUNT;
  else process.env.OSHAL_CAREER_OWNER_MOUNT = previousMount;
  rmSync(root, { recursive: true, force: true });
});

const engineDbSource = readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
const extractSchema = (name) => engineDbSource.match(new RegExp(name + '\\s*=\\s*"""([\\s\\S]*?)"""'))[1];

const pgRowsBySub = {
  'owner-alpha': [
    { posting_id: 101, company: 'Acme Systems, Inc.', title: 'Systems Lead', status: 'applied', ticket_id: 't-101', application_source: 'manual-mark', application_task_id: null, updated_at: '2026-06-12T15:00:00Z' },
    { posting_id: 107, company: 'Cinder Corp.', title: 'Platform Lead', status: 'applied', ticket_id: 't-107', application_source: 'verified-submission', application_task_id: 'task-107', updated_at: '2026-06-25T10:00:00Z' },
    { posting_id: 105, company: 'Beacon Labs', title: 'Drafted Role', status: 'pending', ticket_id: 't-105', application_source: 'unverified', application_task_id: null, updated_at: '2026-11-10T10:00:00Z' },
  ],
  'owner-bravo': [],
};

const router = createRouter();
const { modules } = loadCompiledModules({
  board: 'routes/career-board-routes.js',
  apps: 'routes/career-application-routes.js',
  submissions: 'lib/career-submission-routes.js',
  nativeRead: 'lib/native-career-read.js',
  nativeSearch: 'lib/native-career-search.js',
  store: 'routes/career-user-store.js',
}, {
  'better-sqlite3': Database,
  'express': { Router: () => router },
  './career-authorization': { registerCareerAuthorization() {} },
  './career-autofill-routes': { loadAutofillProfile: async () => ({}) },
  './career-engine-dispatch': { runCareerCliAsync: async () => ({ started: true }), runCareerCliAwait: async () => ({ ok: true, out: '{}' }) },
  './career-engine-runner': { nativeRunInProgress: async () => false, tryAcquireRun: async () => null, releaseRun: async () => {} },
});

const pool = {
  async query(sql, params) {
    if (/remote_only/i.test(sql)) return { rows: [{ remote_only: false }] };
    if (/FROM career_hunter_applications/i.test(sql)) return { rows: pgRowsBySub[params?.[1]] || [] };
    return { rows: [] };
  },
};
modules.apps.registerCareerApplicationReadRoutes(router, { pool });
modules.board.registerCareerBoardRoutes(router, { pool });
modules.submissions.createCareerSubmissionRoutes({ pool });

function seedCorpusAndOwners() {
  const alpha = modules.store.userPaths('owner-alpha');
  const bravo = modules.store.userPaths('owner-bravo');
  mkdirSync(dirname(alpha.corpusDb), { recursive: true });
  mkdirSync(alpha.userDir, { recursive: true });
  mkdirSync(bravo.userDir, { recursive: true });

  const corpus = new Database(alpha.corpusDb);
  corpus.exec(extractSchema('CORPUS_SCHEMA').replaceAll('corpus.', ''));
  corpus.exec(`INSERT INTO companies(id, name) VALUES
    (1, 'Acme Systems, Inc.'), (2, 'Acme Systems'), (3, 'Acme Systems LLC'),
    (4, 'Beacon Labs'), (5, 'Cinder Corp')`);
  corpus.exec(`INSERT INTO postings_corpus(id, company_id, ats_job_id, title, url, description, location, state, city, active, target_role, posted_date, first_seen_at) VALUES
    (101, 1, 'a-101', 'Systems Lead', 'https://acme.example/101', 'Detailed role text for 101', 'Austin, TX', 'TX', 'Austin', 1, 1, '2026-06-01', '2026-06-01T00:00:00Z'),
    (102, 2, 'a-102', 'Staff Architect', 'https://acme.example/102', 'Detailed role text for 102', 'Austin, TX', 'TX', 'Austin', 1, 1, '2026-06-15', '2026-06-15T00:00:00Z'),
    (103, 3, 'a-103', 'Delivery Director', 'https://acme.example/103', 'Detailed role text for 103', 'Austin, TX', 'TX', 'Austin', 1, 1, '2026-06-20', '2026-06-20T00:00:00Z'),
    (104, 2, 'a-104', 'Principal Engineer', 'https://acme.example/104', 'Detailed role text for 104', 'Austin, TX', 'TX', 'Austin', 1, 1, '2026-11-14', '2026-11-14T00:00:00Z'),
    (105, 4, 'b-105', 'Drafted Role', 'https://beacon.example/105', 'Detailed role text for 105', 'Dallas, TX', 'TX', 'Dallas', 1, 1, '2026-11-10', '2026-11-10T00:00:00Z'),
    (106, 4, 'b-106', 'Passed Role', 'https://beacon.example/106', 'Detailed role text for 106', 'Dallas, TX', 'TX', 'Dallas', 1, 1, '2026-11-11', '2026-11-11T00:00:00Z'),
    (107, 5, 'c-107', 'Platform Lead', 'https://cinder.example/107', 'Detailed role text for 107', 'Denver, CO', 'CO', 'Denver', 1, 1, '2026-06-20', '2026-06-20T00:00:00Z')`);
  corpus.close();

  const profileJson = JSON.stringify({
    profile: { name: 'Alex Candidate', headline: 'Principal Architect', experience_summary: 'Builds resilient platforms.' },
    roles: [{ title: 'Architect', org: 'Sample Works', start: '2020-01', end: null, deliverables: ['Delivered platform'] }],
  });
  writeFileSync(join(alpha.userDir, 'career_db.json'), profileJson);
  writeFileSync(join(bravo.userDir, 'career_db.json'), profileJson);
  writeFileSync(join(alpha.userDir, 'job-board-state.json'), JSON.stringify({ version: 1, jobs: { 104: { favorite: true }, 105: { favorite: true } } }));

  const dbAlpha = new Database(alpha.userDb);
  dbAlpha.exec(extractSchema('USER_SCHEMA'));
  require('../lib/career-signal-migrations').migrate(dbAlpha);
  const ins = dbAlpha.prepare('INSERT INTO user_signals(posting_id, fit_score, ai_fit_score, status, applied_at, ai_scored_at) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(101, 82, 88, 'applied', '2026-06-12 15:00:00', '2026-06-12T12:00:00Z');
  ins.run(102, 80, 86, 'interview', '2026-06-25 10:00:00', '2026-06-24T12:00:00Z');
  ins.run(103, 75, 79, 'dismissed', '2026-07-05 09:00:00', '2026-07-01T12:00:00Z');
  ins.run(104, 84, 91, 'new', null, '2026-11-14T12:00:00Z');
  ins.run(105, 78, 83, 'generated', null, '2026-11-10T12:00:00Z');
  ins.run(106, 60, 62, 'dismissed', null, '2026-11-11T12:00:00Z');
  dbAlpha.close();

  const dbBravo = new Database(bravo.userDb);
  dbBravo.exec(extractSchema('USER_SCHEMA'));
  require('../lib/career-signal-migrations').migrate(dbBravo);
  dbBravo.prepare('INSERT INTO user_signals(posting_id, fit_score, ai_fit_score, status, applied_at) VALUES (104, 80, 85, ?, NULL)').run('new');
  dbBravo.close();

  const queued = submissionQueue.enqueue(alpha.userDir, {
    approved: true, postingId: 104, url: 'https://acme.example/104',
    resumeSha256: 'b'.repeat(64), coverSha256: 'c'.repeat(64), profileSha256: 'd'.repeat(64),
  });
  submissionQueue.nativeUpdate(alpha.userDir, queued.item.id, { company: 'Acme Systems', title: 'Principal Engineer' });
}
seedCorpusAndOwners();

function callRoute(method, path, sub = 'owner-alpha') {
  const parsed = new URL(path, 'http://fixture.test');
  const found = router.find(method, parsed.pathname);
  assert.ok(found, `${method} ${path}`);
  return new Promise((resolve, reject) => {
    const out = { status: 200 };
    const res = {
      status(n) { out.status = n; return res; },
      setHeader() {},
      json(json) { resolve({ ...out, json }); return res; },
    };
    Promise.resolve(found.handler({
      method, oidc: { user: sub ? { sub } : null }, params: found.params,
      body: {}, query: Object.fromEntries(parsed.searchParams), headers: {},
    }, res)).catch(reject);
  });
}

test('unit: canonical company matching, confirmed-sent truth, and deterministic 30-day calendar arithmetic', () => {
  assert.equal(companySent.canonicalCompanyKey('Acme Systems, Inc.'), 'acme systems');
  assert.equal(companySent.canonicalCompanyKey('ACME Systems LLC'), 'acme systems');
  assert.equal(companySent.canonicalCompanyKey('Smith & Sons Co.'), 'smith and sons');

  const nov15 = Date.UTC(2026, 10, 15, 6, 30, 0);
  assert.equal(companySent.asOfDateString(nov15), '2026-11-15');
  assert.equal(companySent.isRecordedAsSent({ status: 'applied', applied_at: null }, nov15), true);
  assert.equal(companySent.isRecordedAsSent({ status: 'dismissed', applied_at: '2026-07-05 09:00:00' }, nov15), true, 'archived after sending still counts');
  assert.equal(companySent.isRecordedAsSent({ status: 'dismissed', applied_at: null }, nov15), false, 'dismissed unapplied never counts');
  assert.equal(companySent.isRecordedAsSent({ status: 'new', applied_at: null }, nov15), false, 'undone manual mark never counts');
  assert.equal(companySent.isRecordedAsSent({ status: 'generated', applied_at: null }, nov15), false, 'prepared packet never counts');
  assert.equal(companySent.isRecordedAsSent({ status: 'new', applied_at: '2026-12-01T00:00:00Z' }, nov15), false, 'future date rejected');

  assert.deepEqual(companySent.applicationAgeFields('2026-06-12T15:00:00Z', nov15), {
    daysSinceSent: 156, daysSinceApplied: 156, ageDays: 156, olderThan30Days: true,
  });
  assert.deepEqual(companySent.applicationAgeFields('2026-06-25 10:00:00', nov15), {
    daysSinceSent: 143, daysSinceApplied: 143, ageDays: 143, olderThan30Days: true,
  });
  assert.deepEqual(companySent.applicationAgeFields('2026-10-16T00:00:00Z', nov15), {
    daysSinceSent: 30, daysSinceApplied: 30, ageDays: 30, olderThan30Days: false,
  });
  assert.deepEqual(companySent.applicationAgeFields('2026-10-15T23:59:59Z', nov15), {
    daysSinceSent: 31, daysSinceApplied: 31, ageDays: 31, olderThan30Days: true,
  });
  assert.deepEqual(companySent.applicationAgeFields(null, nov15), {
    daysSinceSent: null, daysSinceApplied: null, ageDays: null, olderThan30Days: false,
  });
});

test('routes & native readers: companySentCount, asOfDate, ageDays and owner isolation agree everywhere', async () => {
  const saved = (await callRoute('GET', '/jobs?status=saved&per=25')).json;
  assert.match(saved.asOfDate, /^\d{4}-\d{2}-\d{2}$/);
  const byId = Object.fromEntries(saved.jobs.map((j) => [j.id, j]));
  assert.equal(byId[104].companySentCount, 3, 'counts applied + interview + archived-after-send across Acme variants');
  assert.equal(byId[104].daysSinceSent, null);
  assert.equal(byId[104].olderThan30Days, false);
  assert.equal(byId[105].companySentCount, 0, 'generated + unapplied dismissed at Beacon Labs count as 0');

  const detail = (await callRoute('GET', '/jobs/104')).json;
  assert.equal(detail.asOfDate, saved.asOfDate);
  assert.equal(detail.job.companySentCount, 3);

  const tracked = (await callRoute('GET', '/jobs?status=tracked&per=25')).json;
  const trackedById = Object.fromEntries(tracked.jobs.map((j) => [j.id, j]));
  assert.equal(trackedById[101].companySentCount, 3);
  assert.ok(trackedById[101].daysSinceSent >= 150 && trackedById[101].olderThan30Days === true);
  assert.ok(trackedById[102].daysSinceSent >= 140 && trackedById[102].olderThan30Days === true);

  const apps = (await callRoute('GET', '/applications')).json;
  assert.equal(apps.asOfDate, saved.asOfDate);
  const appsById = Object.fromEntries(apps.applications.map((a) => [a.posting_id, a]));
  assert.equal(appsById[101].companySentCount, 3, 'deduplicates posting 101 across Postgres and SQLite');
  assert.ok(appsById[101].daysSinceSent >= 150 && appsById[101].olderThan30Days === true);
  assert.equal(appsById[107].companySentCount, 1, 'Postgres-only applied row counted');
  assert.ok(appsById[107].daysSinceSent >= 140 && appsById[107].olderThan30Days === true);
  assert.equal(appsById[105].companySentCount, 0);
  assert.equal(appsById[105].olderThan30Days, false);

  const subQueue = (await callRoute('GET', '/submission-queue')).json;
  assert.equal(subQueue.asOfDate, saved.asOfDate);
  assert.equal(subQueue.items[0].companySentCount, 3);

  const snapshot = modules.nativeRead.readCareerSnapshot(alphaPrincipal, root);
  assert.equal(snapshot.asOfDate, saved.asOfDate);
  assert.equal(snapshot.topMatches.find((m) => m.postingId === 104).companySentCount, 3);
  assert.equal(snapshot.recentApplied.find((a) => a.postingId === 101).olderThan30Days, true);

  const searched = modules.nativeSearch.searchCareerOpenings(alphaPrincipal, { q: 'Engineer' }, root);
  assert.equal(searched.asOfDate, saved.asOfDate);
  assert.equal(searched.jobs.find((j) => j.id === 104).companySentCount, 3);

  const bravoDetail = (await callRoute('GET', '/jobs/104', 'owner-bravo')).json;
  assert.equal(bravoDetail.job.companySentCount, 0, 'owner-bravo never sees owner-alpha sent count');
});

function boardFixture(jobs) {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/resume/state') return { json: { hasResume: true, roles: 2, name: 'Alex', indexing: false, scored: 5 } };
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: jobs.length, byStatus: [] } };
    if (p === '/api/career-hunter/applications') return { json: { applications: [] } };
    if (p === '/api/career-hunter/submission-queue') {
      return { json: { items: [{ id: 'sub-1', postingId: 9, status: 'submitting', company: 'Acme Systems', title: 'Queued Role', companySentCount: 3 }] } };
    }
    if (p === '/api/career-hunter/jobs') return { json: { jobs, exhausted: true, exclusions: [], asOfDate: '2026-11-15' } };
    if (/^\/api\/career-hunter\/jobs\/\d+$/.test(p)) {
      const id = Number(p.split('/').pop());
      return { json: { job: jobs.find((j) => j.id === id) || { id, title: 'Queued Role', company: 'Acme Systems', location: 'Remote', status: 'promoted', companySentCount: 3 }, asOfDate: '2026-11-15' } };
    }
    if (p === '/api/auth/user') return { json: { authenticated: false } };
    return { json: {} };
  };
}

for (const [label, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: My jobs rows, deck cards, posting sheet and Prepare application render confirmed-sent mark cleanly`, async () => {
    const jobs = [
      { id: 1, title: 'Principal Architect', company: 'Acme Systems', location: 'Austin, TX', status: 'new', favorite: true, active: 1, ai_fit_score: 91, companySentCount: 3 },
      { id: 2, title: 'Harbor Master', company: 'Harbor Freight', location: 'Destin, FL', status: 'new', favorite: true, active: 1, ai_fit_score: 84, companySentCount: 1 },
      { id: 3, title: 'Fresh Engineer', company: 'Beacon Labs', location: 'Dallas, TX', status: 'new', favorite: true, active: 1, ai_fit_score: 79, companySentCount: 0 },
    ];
    const { page, context } = await openScreen(browser, 'career-job-lists.html', boardFixture(jobs), size);
    try {
      await page.locator('.job-row[data-job-id="3"]').waitFor();
      const badge1 = page.locator('.job-row[data-job-id="1"] .company-sent-badge');
      const badge2 = page.locator('.job-row[data-job-id="2"] .company-sent-badge');
      assert.equal((await badge1.innerText()).trim(), '✓ 3 sent');
      assert.equal(await badge1.getAttribute('aria-label'), '3 confirmed applications sent to Acme Systems');
      assert.equal(await badge1.getAttribute('title'), '3 confirmed applications sent to Acme Systems');
      assert.equal((await badge2.innerText()).trim(), '✓ 1 sent');
      assert.equal(await badge2.getAttribute('aria-label'), '1 confirmed application sent to Harbor Freight');
      assert.equal(await page.locator('.job-row[data-job-id="3"] .company-sent-badge').count(), 0, 'zero sent hides badge');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal overflow');

      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'midnight'));
      const colors = await badge1.evaluate((el) => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
      assert.notEqual(colors.color, colors.bg, 'readable in dark mode');

      const openBtn = page.locator('.job-row[data-job-id="1"] .job-title');
      if (size === PHONE) await openBtn.tap(); else await openBtn.click();
      const sheetBadge = page.locator('dialog.edit-dialog .company-sent-badge');
      await sheetBadge.waitFor();
      assert.equal((await sheetBadge.innerText()).trim(), '✓ 3 sent');
    } finally { await context.close(); }

    if (size === PHONE) {
      const deck = await openScreen(browser, 'career-job-lists.html', boardFixture(jobs), size, '?view=matches');
      try {
        const cardBadge = deck.page.locator('.match-card.lead .company-sent-badge');
        await cardBadge.waitFor();
        assert.equal((await cardBadge.innerText()).trim(), '✓ 3 sent');
        assert.ok(await deck.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      } finally { await deck.context.close(); }
    }

    const appScreen = await openScreen(browser, 'career-application.html', ({ url }) => {
      if (url.pathname === '/api/career-hunter/jobs/1') {
        return { json: { job: { ...jobs[0], status: 'promoted', description: 'Role details '.repeat(30), application: { workflow: { step: 'tailor' } } }, processing: false } };
      }
      if (url.pathname === '/api/career-hunter/resume/state') return { json: { hasResume: true } };
      if (url.pathname === '/api/career-hunter/experience-bank') return { json: { items: [], revision: 'r'.repeat(64) } };
      if (url.pathname === '/api/career-hunter/submission-worker') return { json: { connected: false } };
      if (url.pathname === '/api/auth/user') return { json: { authenticated: false } };
      return { json: {} };
    }, size, '?application=1');
    try {
      const headerBadge = appScreen.page.locator('#company .company-sent-badge');
      await headerBadge.waitFor();
      assert.equal((await headerBadge.innerText()).trim(), '✓ 3 sent');
    } finally { await appScreen.context.close(); }
  });
}
