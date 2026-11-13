/**
 * CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Require native current owner decision provenance through the actual compiled handler, holding plain terminal statuses.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Exercise exact native ticket correlation, reserved generic-ingress refusals, persistent uncertainty and closed-action outcome readback through the compiled handler.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The two fixture suggestions are compared by employer: they are found a moment apart, the library lists the newest first, and when a second ticked between them the expected order was wrong (one failure in six runs).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The list carries the open suggestions the engine keeps, not last night's: two found two nights before the newest report are listed, one whose employer has since been given a board is not, and the route returns at most 50 with the full count.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Source maintenance through the shipped routes and library over the corpus the engine really writes: the list carries the report, the decisions with their evidence and the open briefs, read without writes; Keep trying is saved for the next pull exactly as the kernel takes it and refused where no decision waits; the daily briefing answers short items inside the kernel's report limits and nothing on a quiet or stale night; only an administrator reaches either route.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
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
  return async (t) => {
    const egress = process.env.OSHAL_EGRESS;
    process.env.OSHAL_EGRESS = 'kernel';
    try { await fn(t); }
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

test('generic Keep trying and Remove cannot bypass the waiting native decision',onNativeKernel(async()=>{
  const {call,engine}=loadRoutes(corpus), quiet=corpus.id('Quiet Board Co');
  for(const route of ['keep','remove']) {
    const refused=await call('/companies-admin/'+route,{companyId:String(quiet)});
    assert.equal(refused.status,409); assert.match(refused.body.error,/native decision ticket/);
  }
  for(const [companyId,status,error] of [[corpus.id('Fresh Co'),409,'Fresh Co has no decision waiting.'],
    [corpus.id('Gone Co'),409,'Gone Co is removed.'],[999999,404,'That company is no longer listed.']]) {
    const refused=await call('/companies-admin/keep',{companyId:String(companyId)});
    assert.deepEqual([refused.status,refused.body.error],[status,error]);
  }
  for(const bad of [{},{companyId:'x'},{companyId:'0'},{companyId:'-3'}]) assert.equal((await call('/companies-admin/keep',bad)).status,400);
  assert.equal(corpus.outbox().length,0); assert.equal(engine.runs,0);
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
    assert.deepEqual((await loadRoutes({db, owner: '/nonexistent-owner'}).call('/companies-admin/maintenance-report')).body, {report: [],decisions:[]}, 'nothing to tell');
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
  for (const path of ['/companies-admin/maintenance-report','/companies-admin/decision-sync']) {
    assert.ok(binding.includes('path: '+path+', allOf: [career.administer, career.execute]'),path);
  }
  assert.ok(binding.includes('path: /companies-admin/keep, allOf: [career.administer]'));
}));

test('the manifest offers the daily briefing job on that route, once a morning, with a report', () => {
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  const block = manifest.slice(manifest.indexOf('  - id: career-source-maintenance\n'), manifest.indexOf('\nsurface:'));
  for (const line of ['cron: "15 7 * * *"', 'timezone: America/Chicago', 'runsAs: user', 'target: service-route',
    'route: /api/career-hunter/companies-admin/maintenance-report', 'method: POST', 'timeoutSeconds: 60', 'report: true']) {
    assert.ok(block.includes(`    ${line}\n`), line);
  }
});

/** Explicit native projection fixture; the installed kernel regression proves the actual history receipt. */
function nativeDecision(row,status) {
  row.status=status; row.revision++;
  row.applicationDecision={version:1,app:'career-hunter',ticketId:row.ticketId,ticketType:row.ticketType,workflow:row.workflow,
    revision:row.revision,status,outcome:status==='done'?'approve':'cancel',ownerVerified:true};
}

/** Native ticket port is an explicit fixture; shipped route, journal, corpus and outbox remain real. */
function nativePort() {
  const rows = new Map(), calls = {create:0,start:0};
  return {rows,calls,
    async listTickets(filter) { assert.equal(filter.ownerSub,'fixture-admin'); return [...rows.values()]; },
    async getTicket(id) { return rows.get(id) || null; },
    async createTicket(input) { calls.create++; const id = randomUUID();
      rows.set(id,{ticketId:id,ticketType:input.ticketType,workflow:'career-hunter:career-source-decision',
        title:input.title,description:input.description,status:'queued',revision:0}); return {ticketId:id}; },
    async startTicket(id,input) { calls.start++; assert.ok(input.limits.wall_ms > 0 && input.limits.output_tokens > 0 && input.limits.artifact_bytes > 0);
      rows.get(id).status='awaiting_approval'; rows.get(id).revision++; return {status:'awaiting_approval'}; }};
}

function decisionRoutes(t) {
  const owner = mkdtempSync(join(tmpdir(),'career-decision-routes-')); t.after(()=>rmSync(owner,{recursive:true,force:true}));
  const tickets = nativePort(); return {tickets,owner,...loadRoutes({db:corpus.db,owner},{ticketService:tickets})};
}

test('the original admitted morning receiver prepares one named decision per current action through its supplied native port and reuses them',onNativeKernel(async t=>{
  const f=decisionRoutes(t);
  const first=await f.call('/companies-admin/maintenance-report');
  assert.equal(first.status,200); assert.equal(f.tickets.calls.create,2,'both current source actions get native owner tickets');
  assert.equal(f.tickets.calls.start,2); assert.equal(first.body.decisions.length,2);
  assert.ok(first.body.decisions.every(item=>item.state==='awaiting_approval' && item.ticketId));
  await f.call('/companies-admin/maintenance-report'); assert.equal(f.tickets.calls.create,2);
  const before={...f.tickets.calls}, listed=await f.call('/companies-admin/list');
  assert.deepEqual(f.tickets.calls,before,'GET does not create/start/read native tickets');
  assert.equal(listed.body.sourceDecisions.length,2);
  assert.equal(readdirSyncOrEmpty(join(f.owner,'.source-request-outbox')).length,0,'preparation never approves or archives');
}));

function readdirSyncOrEmpty(folder) { try { return readdirSync(folder); } catch { return []; } }

test('decision sync queues only the same human-completed ticket and refuses a foreign/stale reference',onNativeKernel(async t=>{
  const f=decisionRoutes(t), action=sourceHealth.sourceMaintenance(corpus.db).actions[0];
  const input={companyId:action.companyId,actionId:action.id,openedAt:action.openedAt};
  const prepared=await f.call('/companies-admin/decision-sync',input);
  assert.equal(prepared.status,200); assert.equal(prepared.body.decision.state,'awaiting_approval');
  const ticketId=prepared.body.decision.ticketId;
  assert.equal((await f.call('/companies-admin/decision-sync',{...input,ticketId:randomUUID()})).status,409);
  assert.equal((await f.call('/companies-admin/decision-sync',{...input,openedAt:'2026-11-11T00:00:00Z',ticketId})).status,409);
  nativeDecision(f.tickets.rows.get(ticketId),'done');
  const queued=await f.call('/companies-admin/decision-sync',{...input,ticketId});
  assert.equal(queued.status,202); assert.equal(queued.body.queued,true); assert.equal(queued.body.decision.state,'queued_next_pull');
  assert.equal(readdirSyncOrEmpty(join(f.owner,'.source-request-outbox')).length,1);
  const repeated=await f.call('/companies-admin/decision-sync',{...input,ticketId});
  assert.equal(repeated.body.decision.requestId,queued.body.decision.requestId);
}));

test('generic source ingress cannot manufacture a reserved native decision outcome',onNativeKernel(async t=>{
  const owner=mkdtempSync(join(tmpdir(),'career-decision-ingress-')); t.after(()=>rmSync(owner,{recursive:true,force:true}));
  const library=process.env.CAREER_TEST_SOURCE_REQUESTS ? require(process.env.CAREER_TEST_SOURCE_REQUESTS) : sourceRequests;
  const f=loadRoutes({db:corpus.db,owner},{ticketService:nativePort()},library), current=sourceHealth.sourceMaintenance(corpus.db).actions[0];
  const target='decision:'+current.id+':'+encodeURIComponent(current.openedAt)+':archive';
  for(const reserved of [target,'  '+target+'  ',target.replace('decision:','Decision:'),encodeURIComponent(target),encodeURIComponent(encodeURIComponent(target))]) {
    for(const field of ['board','url']) {
      const result=await f.call('/companies-admin/seturl',{companyId:String(current.companyId),[field]:reserved});
      assert.equal(result.status,400,'reserved outcome never reaches generic Resolve: '+reserved);
    }
  }
  assert.equal(readdirSyncOrEmpty(join(owner,'.source-request-outbox')).length,0);
  assert.equal((await f.call('/companies-admin/add',{name:'Reserved target employer',url:target})).status,400);
  for(const route of ['remove','keep']) assert.equal((await f.call('/companies-admin/'+route,{companyId:String(current.companyId),target})).status,409);
  assert.equal(readdirSyncOrEmpty(join(owner,'.source-request-outbox')).length,0,'no generic ingress chose an outcome');
}));

test('a recorded successful read after opening, including microseconds, cannot prepare a stale decision',onNativeKernel(async t=>{
  const folder=mkdtempSync(join(tmpdir(),'career-decision-recovered-')); t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const copy=join(folder,'corpus.db'); copyFileSync(corpus.file,copy);
  const db=new DatabaseSync(':memory:'); db.exec(`ATTACH DATABASE '${copy.replace(/'/g,"''")}' AS corpus`); t.after(()=>db.close());
  const action=sourceHealth.sourceMaintenance(db).actions[0], tickets=nativePort();
  const success=action.openedAt.replace(/([+-]\d{2}:\d{2}|Z)$/,'.000001$1');
  db.prepare('UPDATE corpus.source_pull_state SET last_success_at=? WHERE company_id=?').run(success,action.companyId);
  const f=loadRoutes({db,owner:folder},{ticketService:tickets});
  const answer=await f.call('/companies-admin/decision-sync',{actionId:action.id,companyId:action.companyId,openedAt:action.openedAt});
  assert.equal(answer.status,409); assert.equal(tickets.calls.create,0,'no stale ticket prepared from a concretely recovered source');
  assert.equal(readdirSyncOrEmpty(join(folder,'.source-request-outbox')).length,0);
}));

test('uncertain direct sync returns a durable nonsuccess envelope and preserves its hold across service loss',onNativeKernel(async t=>{
  const f=decisionRoutes(t), action=sourceHealth.sourceMaintenance(corpus.db).actions[0];
  const input={actionId:action.id,companyId:action.companyId,openedAt:action.openedAt};
  f.tickets.createTicket=async()=>{f.tickets.calls.create++;throw new Error('fixture create acknowledgement lost');};
  let result=await f.call('/companies-admin/decision-sync',input);
  assert.equal(result.status,200,'native owner staging publishes a truthful uncertainty record');
  assert.equal(result.body.ok,false); assert.equal(result.body.queued,false); assert.equal(result.body.decision.state,'create_uncertain');
  const readback=(await f.call('/companies-admin/list')).body.sourceDecisions;
  assert.equal(readback[0].state,'create_uncertain','actual owner journal survives the direct handler');
  const unavailable=loadRoutes({db:corpus.db,owner:f.owner},{});
  result=await unavailable.call('/companies-admin/decision-sync',input); assert.equal(result.body.decision.state,'create_uncertain');
  result=await f.call('/companies-admin/decision-sync',input); assert.equal(result.body.ok,false);
  assert.equal(f.tickets.calls.create,1); assert.equal(readdirSyncOrEmpty(join(f.owner,'.source-request-outbox')).length,0);
}));

test('an actual closed-action receipt is read from the owner journal and corpus result without another queue',onNativeKernel(async t=>{
  const folder=mkdtempSync(join(tmpdir(),'career-decision-applied-')); t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const copy=join(folder,'corpus.db'); copyFileSync(corpus.file,copy);
  const db=new DatabaseSync(':memory:'); db.exec(`ATTACH DATABASE '${copy.replace(/'/g,"''")}' AS corpus`); t.after(()=>db.close());
  const action=sourceHealth.sourceMaintenance(db).actions[0], tickets=nativePort(), f=loadRoutes({db,owner:folder},{ticketService:tickets});
  const input={actionId:action.id,companyId:action.companyId,openedAt:action.openedAt};
  const ready=await f.call('/companies-admin/decision-sync',input), ticketId=ready.body.decision.ticketId;
  nativeDecision(tickets.rows.get(ticketId),'cancelled');
  const queued=await f.call('/companies-admin/decision-sync',{...input,ticketId}); assert.equal(queued.status,202);
  const request=JSON.parse(readFileSync(join(folder,'.source-request-outbox',queued.body.decision.requestId+'.json'),'utf8'));
  db.prepare('INSERT INTO corpus.source_requests(id,company_id,target,outcome,finished_at) VALUES(?,?,?,?,?)')
    .run(request.id,request.companyId,request.target,'kept',new Date().toISOString());
  db.prepare("UPDATE corpus.source_actions SET state='kept' WHERE id=?").run(action.id);
  const applied=await f.call('/companies-admin/decision-sync',{...input,ticketId});
  assert.equal(applied.status,200); assert.equal(applied.body.applied,true); assert.equal(applied.body.decision.state,'applied');
  assert.equal(readdirSyncOrEmpty(join(folder,'.source-request-outbox')).length,1,'no second handoff is fabricated');
  assert.equal((await f.call('/companies-admin/decision-sync',{...input,ticketId:randomUUID()})).status,409);
}));


test('compiled decision sync refuses a terminal native status without owner application provenance',onNativeKernel(async t=>{
  const f=decisionRoutes(t), action=sourceHealth.sourceMaintenance(corpus.db).actions[0];
  const input={companyId:action.companyId,actionId:action.id,openedAt:action.openedAt};
  const ready=await f.call('/companies-admin/decision-sync',input), ticketId=ready.body.decision.ticketId;
  f.tickets.rows.get(ticketId).status='done';
  const held=await f.call('/companies-admin/decision-sync',{...input,ticketId});
  assert.equal(held.status,200); assert.equal(held.body.queued,false); assert.equal(held.body.decision.state,'attention');
  assert.equal(readdirSyncOrEmpty(join(f.owner,'.source-request-outbox')).length,0);
}));
