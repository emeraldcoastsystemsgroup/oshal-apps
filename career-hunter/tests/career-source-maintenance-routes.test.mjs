/**
 * CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The two fixture suggestions are compared by employer: they are found a moment apart, the library lists the newest first, and when a second ticked between them the expected order was wrong (one failure in six runs).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The list carries the open suggestions the engine keeps, not last night's: two found two nights before the newest report are listed, one whose employer has since been given a board is not, and the route returns at most 50 with the full count.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Source maintenance through the shipped routes and library over the corpus the engine really writes: the list carries the report, the decisions with their evidence and the open briefs, read without writes; Keep trying is saved for the next pull exactly as the kernel takes it and refused where no decision waits; the daily briefing answers short items inside the kernel's report limits and nothing on a quiet or stale night; only an administrator reaches either route.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {copyFileSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCorpus, loadRoutes, sourceHealth, sourceRequests, HOSTILE} from './helpers/career-maintenance-corpus.mjs';

let corpus;
before(() => { corpus = buildCorpus(); });
after(() => corpus?.close());

/** A corpus as it was before maintenance existed: employers and jobs, and none of its tables. */
function olderCorpus() {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(`CREATE TABLE corpus.companies(id INTEGER PRIMARY KEY,name TEXT,ats_type TEXT,ats_token TEXT,careers_url TEXT,discover_status TEXT,source_lists TEXT);
    CREATE TABLE corpus.postings_corpus(company_id INTEGER,active INTEGER);
    INSERT INTO corpus.companies VALUES(1,'Local College','pageup','reviewed','https://careers.example/','found','[]');`);
  return db;
}

function onNativeKernel(fn) {
  return async () => {
    const egress = process.env.OSHAL_EGRESS;
    process.env.OSHAL_EGRESS = 'kernel';
    try { await fn(); }
    finally { if (egress === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = egress; }
  };
}

test('the list carries the newest report, each decision with what was tried, and the open briefs, read without writes', async () => {
  const {call, engine} = loadRoutes(corpus);
  const answer = (await call('/companies-admin/list')).body;
  const state = answer.sourceMaintenance;
  assert.equal(state.report.version, 1);
  assert.deepEqual(state.actions.map(action => action.company), [HOSTILE, 'Quiet Board Co'], 'the removed employer is not listed');
  assert.equal(state.actionCount, 2);
  const evidence = state.actions[0].evidence;
  assert.equal(evidence.board, 'greenhouse:hostileboard');
  assert.equal(evidence.link, 'https://hostileboard.example/careers');
  assert.deepEqual(evidence.reviews.map(run => run.outcome), ['nothing', 'nothing', 'nothing']);
  assert.deepEqual([evidence.lastErrorCode, evidence.failuresInARow, evidence.openJobs], ['empty_unconfirmed', 5, 2]);
  assert.ok(Date.parse(evidence.lastJobsReadAt) && Date.parse(evidence.reviews[0].at));
  assert.equal(state.briefs.length, 1);
  assert.deepEqual([state.briefs[0].reader, state.briefs[0].reason, state.briefs[0].employers.count, state.briefs[0].employers.jobs],
    ['pinpoint', 'completion_unverified', 3, 15]);
  assert.match(state.briefs[0].brief, /^# Repair the pinpoint reader/);
  assert.deepEqual(state.report.discovery.connected.map(entry => [entry.company, entry.board, entry.jobs]), [['Fresh Co', 'pinpoint:careers.freshco.example', 3]]);
  assert.deepEqual(state.report.discovery.suggested, [], 'last night the runbook suggested nothing');
  // Newest first, and these two were found a moment apart on one night, so they are compared by employer.
  const kept = [...state.suggestions].sort((a, b) => a.id - b.id);
  assert.deepEqual(kept.map(entry => [entry.id, entry.company, entry.options, entry.step, entry.reason, entry.jobs, entry.owner]),
    [[corpus.id('Other Co'), 'Other Co', ['greenhouse:zzholdings'], 'saved-link', "the board's name does not look like this employer", 3, null],
      [corpus.id('Sub Co'), 'Sub Co', ['pinpoint:careers.partial0.example'], 'saved-link', 'another employer already uses this board', 4, 'Partial 0 Co']],
    'the two suggestions the engine kept, in the shape Accept takes');
  assert.equal(state.suggestionCount, 2);
  for (const entry of state.suggestions) {
    assert.ok(Date.parse(state.report.since) - Date.parse(entry.suggestedAt) > 2 * 24 * 3600 * 1000, 'found more than two nights before the newest report');
  }
  assert.equal(state.keepTryingDays, 60);
  assert.equal(engine.runs, 0);
  assert.doesNotMatch(JSON.stringify(state), /Gone Co/, 'a removed employer appears nowhere in it');
});

test('the wait the page names for Keep trying is the engine\'s own', () => {
  const engine = readFileSync(new URL('../engine/jobhunter/source_maintenance.py', import.meta.url), 'utf8');
  assert.equal(Number(/^SNOOZE_DAYS = (\d+)/m.exec(engine)[1]), sourceHealth.KEEP_TRYING_DAYS);
});

test('a corpus maintenance has not reached has none of it, and one it cannot read is marked without hiding the companies', async () => {
  const db = olderCorpus();
  try {
    const {call} = loadRoutes({db, owner: '/nonexistent-owner'});
    let answer = (await call('/companies-admin/list')).body;
    assert.equal(answer.sourceMaintenance, null);
    assert.equal(answer.companies[0].name, 'Local College');
    assert.equal(sourceHealth.decisionWaiting(db, 1), false);
    assert.deepEqual(sourceHealth.maintenanceBriefing(db), []);
    db.exec('CREATE TABLE corpus.source_maintenance_runs(run_id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT, report TEXT)');
    assert.deepEqual(sourceHealth.sourceMaintenance(db), {report: null, actions: [], actionCount: 0, briefs: [], suggestions: [], suggestionCount: 0, keepTryingDays: 60},
      'run, with nothing to say');
    db.exec("INSERT INTO corpus.source_maintenance_runs VALUES('pull-a','a','2026-11-10T09:00:00+00:00','{not json')");
    answer = (await call('/companies-admin/list')).body;
    assert.deepEqual(answer.sourceMaintenance, {unreadable: true});
    assert.equal(answer.companies[0].name, 'Local College');
    assert.deepEqual(sourceHealth.maintenanceBriefing(db), [], 'an unreadable report is not briefed');
  } finally { db.close(); }
});

test('Keep trying is saved for the next pull exactly as the kernel takes it, and refused where no decision waits', onNativeKernel(async () => {
  const {call, engine} = loadRoutes(corpus);
  const quiet = corpus.id('Quiet Board Co');
  const saved = await call('/companies-admin/keep', {companyId: String(quiet)});
  assert.equal(saved.status, 202);
  assert.equal(saved.body.message, 'Saved. From the next nightly pull, Career keeps trying Quiet Board Co and does not ask about it again for 60 days.');
  assert.deepEqual(corpus.outbox(), [{id: saved.body.request.id, companyId: quiet, target: 'keep:employer'}]);
  assert.equal(sourceRequests.validTarget(sourceRequests.KEEP_TRYING), 'keep:employer');
  const waiting = (await call('/companies-admin/list')).body.sourceChanges;
  assert.deepEqual([waiting[0].state, waiting[0].target], ['waiting', 'keep:employer']);
  const refusals = [[corpus.id('Fresh Co'), 409, 'Fresh Co has no decision waiting.'], [corpus.id('Gone Co'), 409, 'Gone Co is removed.'],
    [999999, 404, 'That company is no longer listed.']];
  for (const [companyId, status, error] of refusals) {
    const refused = await call('/companies-admin/keep', {companyId: String(companyId)});
    assert.deepEqual([refused.status, refused.body.error], [status, error]);
  }
  for (const bad of [{}, {companyId: 'x'}, {companyId: '0'}, {companyId: '-3'}]) {
    assert.equal((await call('/companies-admin/keep', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(corpus.outbox().length, 1, 'a refusal leaves nothing behind');
  assert.equal(engine.runs, 0);
}));

test('where no nightly pull applies changes, Keep trying says so and saves nothing', async () => {
  const fresh = {db: corpus.db, owner: mkdtempSync(join(tmpdir(), 'career-maintenance-owner-'))};
  const egress = process.env.OSHAL_EGRESS;
  delete process.env.OSHAL_EGRESS;
  try {
    const {call} = loadRoutes(fresh);
    const answer = await call('/companies-admin/keep', {companyId: String(corpus.id(HOSTILE))});
    assert.deepEqual([answer.status, answer.body.error], [409, 'Keeping a source is applied by the nightly pull, which this installation does not run.']);
    assert.equal((await call('/companies-admin/remove', {companyId: String(corpus.id(HOSTILE))})).body.error,
      'Adding and removing employers is applied by the nightly pull, which this installation does not run.');
  } finally {
    if (egress !== undefined) process.env.OSHAL_EGRESS = egress;
    rmSync(fresh.owner, {recursive: true, force: true});
  }
});

test('the daily briefing answers short items inside the kernel\'s report limits, each opening Source health', async () => {
  const {call} = loadRoutes(corpus);
  const answer = await call('/companies-admin/maintenance-report');
  assert.equal(answer.status, 200);
  const report = answer.body.report;
  assert.deepEqual(report.map(item => [item.title, item.count]), [['2 more job sources need your decision', 2],
    ['1 new repair brief is ready for a developer', 1], ['1 job source was connected last night', 1]]);
  assert.equal(report[0].detail, `Career could not connect ${HOSTILE}, Quiet Board Co. Archive each one or keep trying. 2 decisions are waiting in all.`);
  assert.equal(report[1].detail, 'Reads keep ending part way on pinpoint (3 employers). 1 brief is open in all.');
  assert.equal(report[2].detail, 'Career found a job site for Fresh Co.');
  // The kernel's contract for a schedule report: crates/oshald/src/schedule_completion.rs `projection` and `strip_credentials`.
  assert.ok(report.length <= 8 && report.length <= 32);
  assert.ok(JSON.stringify(report).length <= 30720);
  for (const item of report) {
    assert.equal(Object.prototype.toString.call(item), '[object Object]');
    assert.equal(item.link, '/cockpit/?app=career-hunter&screen=career-companies&view=health');
    for (const field of Object.keys(item)) assert.doesNotMatch(field, /key|cookie|password|passwd|secret|token|authorization|credential/i, field);
  }
});

test('a decision or a brief is told once: the next quiet night, a stale report and a corpus that cannot be opened are an empty briefing', async () => {
  const day = 24 * 3600 * 1000;
  assert.equal(sourceHealth.maintenanceBriefing(corpus.db, Date.now() + day - 60000).length, 3, 'still last night\'s');
  assert.deepEqual(sourceHealth.maintenanceBriefing(corpus.db, Date.now() + day + 60000), [], 'a report is told once, not every morning after');
  // The night after, on a copy of the same corpus: a new report, nothing connected, and the same decisions and brief still open.
  const folder = mkdtempSync(join(tmpdir(), 'career-maintenance-next-'));
  const next = new DatabaseSync(':memory:');
  try {
    copyFileSync(corpus.file, join(folder, 'corpus.db'));
    next.exec(`ATTACH DATABASE '${join(folder, 'corpus.db')}' AS corpus`);
    const tomorrow = new Date(Date.now() + day).toISOString();
    next.prepare(`UPDATE corpus.source_maintenance_runs SET finished_at = ?, report = json_set(report, '$.since', ?, '$.finishedAt', ?,
      '$.discovery.connected', json('[]'))`).run(tomorrow, tomorrow, tomorrow);
    assert.equal(sourceHealth.sourceMaintenance(next).actionCount, 2, 'still waiting, and still on the page');
    assert.deepEqual(sourceHealth.maintenanceBriefing(next, Date.now() + day + 60000), [], 'but not told again');
    // And once one of them is answered, it is no longer a decision waiting.
    const quiet = corpus.id('Quiet Board Co');
    next.prepare("UPDATE corpus.source_actions SET state = 'kept' WHERE company_id = ?").run(quiet);
    const answered = sourceHealth.sourceMaintenance(next);
    assert.deepEqual([answered.actions.map(action => action.company), answered.actionCount], [[HOSTILE], 1]);
    assert.deepEqual([sourceHealth.decisionWaiting(next, quiet), sourceHealth.decisionWaiting(next, corpus.id(HOSTILE))], [false, true]);
    // A suggestion whose employer has been given a board, as Accept does at the next pull, is no longer listed.
    next.prepare("UPDATE corpus.companies SET ats_type = 'greenhouse', ats_token = 'zzholdings', discover_status = 'manual' WHERE id = ?").run(corpus.id('Other Co'));
    const accepted = sourceHealth.sourceMaintenance(next);
    assert.deepEqual([accepted.suggestions.map(entry => entry.company), accepted.suggestionCount], [['Sub Co'], 1]);
    // The route returns at most 50, the newest, and says how many there are.
    next.exec('BEGIN');
    for (let n = 0; n < 60; n++) {
      next.prepare("INSERT INTO corpus.companies (id, name, discover_status) VALUES (?, ?, 'pending')").run(9000 + n, `Many ${n} Co`);
      next.prepare('INSERT INTO corpus.source_suggestions VALUES (?, ?, ?, ?, ?, NULL, ?)').run(9000 + n, `lever:many${n}`, 'saved-link',
        'the board has fewer than 3 jobs', 1, new Date(Date.now() + n * 1000).toISOString());
    }
    next.exec('COMMIT');
    const many = sourceHealth.sourceMaintenance(next);
    assert.deepEqual([many.suggestions.length, many.suggestionCount, many.suggestions[0].company], [50, 61, 'Many 59 Co']);
  } finally { next.close(); rmSync(folder, {recursive: true, force: true}); }
  const db = olderCorpus();
  try {
    db.exec('CREATE TABLE corpus.source_maintenance_runs(run_id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT, report TEXT)');
    db.prepare('INSERT INTO corpus.source_maintenance_runs VALUES(?,?,?,?)').run('pull-a', 'a', new Date().toISOString(),
      JSON.stringify({version: 1, finishedAt: new Date().toISOString(), discovery: {connected: [], suggested: []}}));
    assert.deepEqual((await loadRoutes({db, owner: '/nonexistent-owner'}).call('/companies-admin/maintenance-report')).body, {report: []}, 'nothing to tell');
  } finally { db.close(); }
  assert.deepEqual((await loadRoutes({db: null, owner: '/nonexistent-owner'}).call('/companies-admin/maintenance-report')).body, {report: []});
});

test('only an administrator reaches Keep trying or the briefing, and both are bound to career.administer', onNativeKernel(async () => {
  const {call} = loadRoutes(corpus);
  const before = corpus.outbox().length;
  for (const [url, query] of [['/companies-admin/keep', {companyId: String(corpus.id(HOSTILE))}], ['/companies-admin/maintenance-report', {}]]) {
    const refused = await call(url, query, 'ordinary-person');
    assert.deepEqual([refused.status, refused.passed, refused.body], [403, false, {error: 'admin only'}], url);
  }
  assert.equal(corpus.outbox().length, before);
  const binding = readFileSync(new URL('../authorization.yaml', import.meta.url), 'utf8');
  for (const path of ['/companies-admin/keep', '/companies-admin/maintenance-report']) {
    assert.match(binding, new RegExp(`method: POST, path: ${path}, allOf: \\[career\\.administer\\] \\}`), path);
  }
}));

test('the manifest offers the daily briefing job on that route, once a morning, with a report', () => {
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  const block = manifest.slice(manifest.indexOf('  - id: career-source-maintenance\n'), manifest.indexOf('\nsurface:'));
  for (const line of ['cron: "15 7 * * *"', 'timezone: America/Chicago', 'runsAs: user', 'target: service-route',
    'route: /api/career-hunter/companies-admin/maintenance-report', 'method: POST', 'timeoutSeconds: 60', 'report: true']) {
    assert.ok(block.includes(`    ${line}\n`), line);
  }
});
