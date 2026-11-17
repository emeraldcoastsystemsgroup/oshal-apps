/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "this is not a choice in bulk edit"): a bulk preparation carries the Other experience the person chose in bulk Prepare's step. The simulated Career keeps each job's tailoring as the draft writer does (POST /jobs/:id/status draft: the revision must be the saved one, it moves on only when the inputs change, experienceChosen is kept). The queue saves the choice on the job's tailoring before it moves and prepares the job (no write when it already holds it), Generate sends exactly that choice with experienceChosen, the choice survives a reload and Prepare the failed ones again, with the person's preparation choice on the job's tailoring holds it before the move starts its preparation, and a preparation queued before 1.68.1 (no choice) is cancelled with words and writes nothing.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.0 (Roger, 2026-11-16: "select multiple rows on a table and push all the applications to prepare application"). The shipped tools/career-job-actions.js and tools/career-bulk-queue.js run together against a simulated Career that behaves as the native kernel does: one run holds a person's Career files, every other write of that person is refused 409 career_run_in_progress before the package runs, and a run's writes appear only when it ends. Bulk Prepare makes each job's own two writes (status promoted, then generate with the job's saved tailoring), at most two preparations at a time, waits instead of failing while Career is busy, keeps its progress through a reload, cancels what is still queued, ends a failed preparation with its reason in words, pauses after three failures in a row with one reason, reports a run that ended without its receipt, lets one tab drive (only it writes), and puts only the failed preparations back when asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ACTIONS = read('../tools/career-job-actions.js');
const QUEUE = read('../tools/career-bulk-queue.js');
const NEEDED = 'Career could not read this job’s details, so it cannot check your fit or write a résumé for it yet.';

/** A clock the test moves. */
function clock() { const time = { now: Date.parse('2026-11-16T19:00:00Z') }; time.advance = (ms) => { time.now += ms; }; return time; }

/** Browser storage shared by every tab of one browser. */
function storage() {
  const data = new Map();
  return { data, getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, String(value)); }, removeItem: (key) => { data.delete(key); } };
}

/**
 * @description A simulated Career for one person. `parallel` lets runs overlap (no host does today); otherwise a run holds
 * the person's files and every other write is refused before the package runs, as the native kernel does.
 * @param {object} time The clock.
 * @param {{parallel?:boolean, seconds?:number, outcome?:(id:number)=>string, setting?:boolean}} options
 * @returns {object} The server: fetch, jobs, writes, runs and the most runs that were ever active at once.
 */
function career(time, options = {}) {
  const server = { jobs: new Map(), writes: [], runs: [], peak: 0, started: [], refusedBusy: 0 };
  server.add = (id, extra = {}) => server.jobs.set(id, { id, title: `Office Manager ${id}`, company: `Example ${id}`, status: 'new', favorite: true,
    has_resume: 0, has_cover: 0, description: 'A real description of the job.', board: { favorite: true },
    application: { draft: { revision: 2, guidance: `Lead with operations for ${id}.`, experienceIds: [] }, needsGeneration: true, busy: false }, ...extra });
  const answer = (status, json) => ({ ok: status < 400, status, json: async () => json });
  const settle = () => {
    for (const run of server.runs.filter((r) => time.now >= r.endsAt)) {
      server.runs.splice(server.runs.indexOf(run), 1);
      const job = server.jobs.get(run.id), outcome = options.outcome ? options.outcome(run.id) : 'ready';
      if (outcome === 'vanish') continue;
      const at = new Date(time.now).toISOString();
      job.board = { ...job.board, requestId: run.requestId, completedAt: at, phase: outcome === 'ready' ? 'ready' : 'failed', error: outcome === 'ready' ? null : outcome };
      if (outcome === 'ready') Object.assign(job, { status: 'generated', has_resume: 1, has_cover: 1, application: { ...job.application, needsGeneration: false } });
    }
  };
  const startRun = (id, requestId) => {
    server.runs.push({ id, requestId, endsAt: time.now + (options.seconds || 90) * 1000 });
    server.started.push({ id, requestId });
    server.peak = Math.max(server.peak, server.runs.length);
  };
  server.fetch = async (url, init = {}) => {
    settle();
    const path = new URL(url, 'http://career.test').pathname, method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    // The kernel refuses another write of the person while a run holds their files, before the package runs: nothing is written.
    if (method !== 'GET' && !options.parallel && server.runs.length) { server.refusedBusy += 1; return answer(409, { error: 'career_run_in_progress', runId: 'run-1' }); }
    if (method !== 'GET') server.writes.push({ method, path, body });
    if (path === '/api/career-hunter/experience-bank') return answer(200, { revision: 'bank-7', entries: [] });
    const match = path.match(/^\/api\/career-hunter\/jobs\/(\d+)(\/status|\/generate)?$/), job = match && server.jobs.get(Number(match[1]));
    if (!job) return answer(404, { error: 'not found' });
    if (!match[2]) return answer(200, { job: structuredClone(job), processing: server.runs.length ? 'run-1' : false });
    if (match[2] === '/status' && body.draft) return answer(...tailor(job, body.draft));
    if (match[2] === '/status') {
      if (body.status) job.status = body.status;
      if (typeof body.favorite === 'boolean') job.favorite = body.favorite;
      if (body.status === 'promoted' && options.setting) { startRun(job.id, `setting-${job.id}`); return answer(200, { ok: true, status: 'promoted', favorite: true, preparation: { queued: 1, started: true } }); }
      return answer(200, { ok: true, status: job.status, favorite: job.favorite });
    }
    if (job.detailsNeeded) return answer(409, { error: NEEDED, code: 'job_details_needed' });
    assert.equal(body.documents, true, 'documents are generated');
    assert.match(body.requestId, /^[a-zA-Z0-9-]{8,80}$/, 'a request id the route accepts');
    assert.equal(body.draftRevision, job.application.draft.revision, 'the saved draft is the one prepared');
    assert.deepEqual(body.experienceIds, job.application.draft.experienceIds, 'the job is prepared with the choice its tailoring holds');
    startRun(job.id, body.requestId);
    return answer(202, { ok: true, status: 'generating', requestId: body.requestId });
  };
  /** The draft writer (lib/career-application-draft.js save): the saved revision only; it moves on when the inputs change. */
  const tailor = (job, draft) => {
    const saved = job.application.draft;
    if (draft.revision !== saved.revision) return [409, { error: 'This draft changed in another tab.' }];
    const same = draft.guidance === saved.guidance && JSON.stringify(draft.experienceIds) === JSON.stringify(saved.experienceIds);
    job.application.draft = { revision: same ? saved.revision : saved.revision + 1, guidance: draft.guidance, experienceIds: [...draft.experienceIds],
      experienceRevision: draft.experienceRevision, ...(draft.experienceChosen === true || saved.experienceChosen ? { experienceChosen: true } : {}) };
    return [200, { ok: true, application: structuredClone(job.application) }];
  };
  return server;
}

/**
 * @description One tab of My jobs: the shipped job actions and queue running in a page of their own.
 * @param {object} server The simulated Career. @param {object} time The clock. @param {object} store Shared storage.
 * @param {string} tab The tab's id.
 * @returns {{queue:object, actions:object, changes:number}} The queue and its page's CareerJobActions.
 */
function tab(server, time, store, name = 'tab-a') {
  // Every write is tagged with the tab that sent it, so a test can tell which tab drove the queue.
  const fetch = (url, init = {}) => { if ((init.method || 'GET') !== 'GET') (server.by ||= []).push(name); return server.fetch(url, init); };
  const context = vm.createContext({ URL, URLSearchParams, setTimeout, clearTimeout, AbortController, AbortSignal, crypto: globalThis.crypto, fetch });
  context.window = context;
  vm.runInContext(ACTIONS, context);
  vm.runInContext(QUEUE, context);
  const page = { changes: 0, actions: context.CareerJobActions, Queue: context.CareerBulkQueue };
  page.queue = context.CareerBulkQueue.create({ owner: 'tenant-1:person-1', storage: store, fetch, actions: context.CareerJobActions,
    send: async () => ({}), now: () => time.now, tab: name, onChange: () => { page.changes += 1; } });
  return page;
}

/** Move time on and let the queue take as many passes as it needs. */
async function run(page, time, seconds, step = 1500) {
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += step) { time.advance(step); await page.queue.tick(); }
}
/** Bulk Prepare's entries, each carrying the Other experience the person ticked in its step (none ticked by default). */
const prepare = (ids, experienceIds = []) => ids.map((id) => ({ id, title: `Office Manager ${id}`, company: `Example ${id}`, kind: 'prepare', experienceIds }));
/** A value made inside a page, as plain data of this test (another realm's objects never compare equal). */
const plain = (value) => JSON.parse(JSON.stringify(value));
const states = (page) => Object.fromEntries(page.queue.items().map((item) => [item.id, item.state]));

test('bulk Prepare makes each job its own writes: its choice on its tailoring, moved to Getting ready, then generated with that tailoring', async () => {
  const time = clock(), server = career(time);
  for (const id of [11, 12, 13]) server.add(id);
  const page = tab(server, time, storage());
  assert.deepEqual(plain(page.queue.add(prepare([11, 12, 13]))), { added: 3, already: 0, batch: page.queue.items()[0].batch });
  await run(page, time, 400);
  assert.deepEqual(states(page), { 11: 'done', 12: 'done', 13: 'done' });
  const accepted = server.writes.filter((write) => write.path.endsWith('/generate'));
  for (const id of [11, 12, 13]) {
    const own = server.writes.filter((write) => write.path.startsWith(`/api/career-hunter/jobs/${id}/`));
    const firstDraft = own.findIndex((write) => write.body.draft), firstPromote = own.findIndex((write) => write.body.status), firstGenerate = own.findIndex((write) => write.path.endsWith('/generate'));
    assert.deepEqual(own[firstDraft].body, { draft: { revision: 2, guidance: `Lead with operations for ${id}.`, experienceIds: [], experienceRevision: 'bank-7', experienceChosen: true } },
      'the choice (here none ticked) is saved on the job\'s own tailoring first');
    assert.deepEqual(own[firstPromote].body, { status: 'promoted', favorite: true }, 'the body one job\'s Prepare application sends');
    assert.ok(firstDraft < firstPromote && firstPromote < firstGenerate, 'its choice saved, then moved to Getting ready, then its documents generated');
    const generate = accepted.filter((write) => write.path === `/api/career-hunter/jobs/${id}/generate`).at(-1).body;
    assert.deepEqual({ ...generate, requestId: 'x' }, { documents: true, requestId: 'x', guidance: `Lead with operations for ${id}.`, experienceIds: [], experienceRevision: 'bank-7', draftRevision: 2, experienceChosen: true },
      'the fields the application page sends with Generate résumé & cover letter');
  }
  assert.equal(server.started.length, 3, 'one preparation per job, none twice');
  assert.equal(page.queue.summary().prepare.done, 3);
});

test('at most two preparations run at a time, even where Career would take more', async () => {
  const time = clock(), server = career(time, { parallel: true, seconds: 120 });
  const ids = [21, 22, 23, 24, 25, 26];
  for (const id of ids) server.add(id);
  const page = tab(server, time, storage());
  page.queue.add(prepare(ids));
  let most = 0;
  for (let pass = 0; pass < 600; pass += 1) {
    time.advance(1500); await page.queue.tick();
    most = Math.max(most, page.queue.summary().prepare.running);
    if (page.queue.summary().prepare.done === ids.length) break;
  }
  assert.equal(page.queue.summary().prepare.done, ids.length);
  assert.equal(most, 2, 'two at once at most, by the queue');
  assert.equal(server.peak, 2, 'and never more than two runs at the server');
});

test('while Career works on the account the next job waits in the queue: nothing fails and the refused write is not hammered', async () => {
  const time = clock(), server = career(time, { seconds: 90 });
  for (const id of [31, 32, 33]) server.add(id);
  const page = tab(server, time, storage());
  page.queue.add(prepare([31, 32, 33]));
  await run(page, time, 30);
  const waiting = page.queue.items().find((item) => item.id === 32);
  assert.equal(waiting.state, 'queued');
  assert.match(waiting.note, /Waiting for Career to finish what it is doing on your account/);
  assert.ok(server.refusedBusy <= 3, `a refused write is tried again after a pause, not every pass (${server.refusedBusy} in 30 s)`);
  await run(page, time, 600);
  assert.deepEqual(states(page), { 31: 'done', 32: 'done', 33: 'done' });
  assert.equal(page.queue.summary().failed, 0);
  assert.equal(server.peak, 1, 'one run at a time, as the kernel allows');
});

test('progress survives a reload: the new page shows the same states and finishes without starting a job twice', async () => {
  const time = clock(), server = career(time, { seconds: 90 }), store = storage();
  for (const id of [41, 42, 43]) server.add(id);
  const first = tab(server, time, store, 'tab-before');
  first.queue.add(prepare([41, 42, 43]));
  await run(first, time, 20);
  const before = plain(first.queue.items().map((item) => [item.id, item.state, item.requestId || '']));
  assert.deepEqual(before.map(([id, state]) => [id, state]), [[41, 'running'], [42, 'queued'], [43, 'queued']]);
  first.queue.stop();
  const second = tab(server, time, store, 'tab-after');
  assert.deepEqual(plain(second.queue.items().map((item) => [item.id, item.state, item.requestId || ''])), before, 'the reloaded page reads the same progress');
  await run(second, time, 600);
  assert.deepEqual(states(second), { 41: 'done', 42: 'done', 43: 'done' });
  assert.equal(server.started.filter((start) => start.id === 41).length, 1, 'the running job was followed, not started again');
});

test('a person cancels what is still queued; the running preparation finishes and nothing cancelled is written', async () => {
  const time = clock(), server = career(time, { seconds: 60 });
  for (const id of [51, 52, 53, 54]) server.add(id);
  const page = tab(server, time, storage());
  page.queue.add(prepare([51, 52, 53, 54]));
  await run(page, time, 10);
  assert.equal(page.queue.cancelQueued(), 3);
  const atCancel = server.writes.length;
  await run(page, time, 300);
  assert.deepEqual(states(page), { 51: 'done', 52: 'cancelled', 53: 'cancelled', 54: 'cancelled' });
  assert.deepEqual(server.writes.slice(atCancel).filter((write) => !write.path.includes('/51/')), [], 'no write for a cancelled job after Cancel');
  assert.deepEqual(server.writes.filter((write) => !write.path.includes('/51/')), [], 'and none went through before it either');
  assert.match(page.queue.items().find((item) => item.id === 52).reason, /Cancelled before it started/);
});

test('a failed preparation ends with its reason in words; three in a row with one reason pause the rest until Resume', async () => {
  const time = clock(), server = career(time, { seconds: 30, outcome: (id) => (id < 65 ? 'renderer_unavailable' : 'ready') });
  for (const id of [61, 62, 63, 64, 65]) server.add(id);
  const page = tab(server, time, storage());
  page.queue.add(prepare([61, 62, 63, 64, 65]));
  await run(page, time, 400);
  const words = page.actions.message('renderer_unavailable');
  assert.match(words, /cannot make PDF documents/);
  for (const id of [61, 62, 63]) assert.equal(page.queue.items().find((item) => item.id === id).reason, words);
  assert.deepEqual(states(page), { 61: 'failed', 62: 'failed', 63: 'failed', 64: 'queued', 65: 'queued' });
  assert.equal(page.queue.summary().paused.reason, words, 'paused, and says why');
  assert.equal(server.started.length, 3, 'nothing started while paused');
  page.queue.resume();
  await run(page, time, 400);
  assert.deepEqual(states(page), { 61: 'failed', 62: 'failed', 63: 'failed', 64: 'failed', 65: 'done' });
  assert.equal(page.Queue.words(page.queue.latest(61)).word, 'Failed');
});

test('a job Career could not read fails with the paste words, is not moved and is never generated; it pauses nothing', async () => {
  const time = clock(), server = career(time, { seconds: 20 });
  for (const id of [71, 72, 73]) server.add(id, { details_needed: NEEDED + ' Open the job’s posting.', description: '' });
  server.add(74, { detailsNeeded: true, description: '' });
  server.add(75);
  const page = tab(server, time, storage());
  page.queue.add(prepare([71, 72, 73, 74, 75]));
  await run(page, time, 200);
  for (const id of [71, 72, 73, 74]) {
    const item = page.queue.latest(id);
    assert.equal(item.state, 'failed');
    assert.ok(item.reason.startsWith(NEEDED), item.reason);
  }
  assert.deepEqual(server.writes.filter((write) => /\/(71|72|73)\//.test(write.path)), [], 'a job the job route already calls unreadable is not moved');
  assert.equal(page.queue.summary().paused, null, 'one job\'s missing description never pauses the others');
  assert.equal(page.queue.latest(75).state, 'done');
  assert.deepEqual(server.started.map((start) => start.id), [75]);
});

test('a run that ended without its receipt is reported in words and not tried again by itself', async () => {
  const time = clock(), server = career(time, { seconds: 40, outcome: () => 'vanish' });
  server.add(81);
  const page = tab(server, time, storage());
  page.queue.add(prepare([81]));
  await run(page, time, 120);
  const item = page.queue.latest(81);
  assert.equal(item.state, 'failed');
  assert.equal(item.reason, page.Queue.STOPPED);
  assert.equal(server.started.length, 1, 'no second start');
});

test('a job already applied to or already prepared is skipped with words; a preparation already running is followed', async () => {
  const time = clock(), server = career(time, { seconds: 30 });
  server.add(91, { status: 'applied' });
  server.add(92, { status: 'generated', has_resume: 1, has_cover: 1, application: { draft: { revision: 1, guidance: '', experienceIds: [] }, needsGeneration: false } });
  server.add(93, { status: 'promoted', board: { favorite: true, generationDraft: { requestId: 'earlier-press-0001', state: 'requested' } }, application: { draft: { revision: 1 }, needsGeneration: true, busy: true } });
  server.runs.push({ id: 93, requestId: 'earlier-press-0001', endsAt: time.now + 20000 });
  const page = tab(server, time, storage());
  page.queue.add(prepare([91, 92, 93]));
  await run(page, time, 120);
  assert.deepEqual(states(page), { 91: 'skipped', 92: 'skipped', 93: 'done' });
  assert.equal(page.queue.latest(91).reason, 'Already applied.');
  assert.match(page.queue.latest(92).reason, /Already prepared/);
  assert.deepEqual(server.writes, [], 'nothing written for any of them');
});

test('with the person\'s own preparation choice on, moving the job starts its preparation and the queue follows it', async () => {
  const time = clock(), server = career(time, { seconds: 40, setting: true });
  server.add(101);
  const page = tab(server, time, storage());
  page.queue.add(prepare([101]));
  await run(page, time, 120);
  assert.equal(page.queue.latest(101).state, 'done');
  assert.deepEqual(server.writes.map((write) => [write.path, Object.keys(write.body)[0]]), [['/api/career-hunter/jobs/101/status', 'draft'], ['/api/career-hunter/jobs/101/status', 'status']],
    'the choice on its tailoring, then the move that starts its preparation, and no second preparation');
});

test('a bulk Remove waits for a running preparation, then sends each job the body its own Remove sends', async () => {
  const time = clock(), server = career(time, { seconds: 60 });
  for (const id of [111, 112, 113]) server.add(id);
  const page = tab(server, time, storage());
  page.queue.add(prepare([111]));
  await run(page, time, 5);
  page.queue.add([112, 113].map((id) => ({ id, kind: 'status', body: { status: 'dismissed', favorite: false }, label: 'Remove', done: 'Removed' })));
  await run(page, time, 20);
  assert.equal(page.queue.latest(112).state, 'queued', 'waits while the preparation holds the account');
  await run(page, time, 120);
  assert.deepEqual(states(page), { 111: 'done', 112: 'done', 113: 'done' });
  assert.equal(page.Queue.words(page.queue.latest(112)).word, 'Removed');
  for (const id of [112, 113]) assert.deepEqual(server.writes.filter((w) => w.path === `/api/career-hunter/jobs/${id}/status`).at(-1).body, { status: 'dismissed', favorite: false });
});

test('two tabs of one person: one drives the queue, the other reads its progress, and no write goes out twice', async () => {
  const time = clock(), server = career(time, { seconds: 30 }), store = storage();
  for (const id of [121, 122]) server.add(id);
  const a = tab(server, time, store, 'tab-a'), b = tab(server, time, store, 'tab-b');
  a.queue.add(prepare([121, 122]));
  // The two tabs' passes run at the same time, as two open tabs' timers do.
  for (let pass = 0; pass < 200; pass += 1) { time.advance(1500); await Promise.all([a.queue.tick(), b.queue.tick()]); }
  assert.deepEqual(states(b), { 121: 'done', 122: 'done' }, 'the other tab shows the same progress');
  assert.deepEqual([...new Set(server.by)], ['tab-a'], 'only the tab that holds the queue writes');
  assert.equal(server.started.length, 2);
  assert.equal(server.writes.filter((write) => write.path.endsWith('/generate')).length, 2, 'each job generated once');
});

test('without an owner the queue keeps nothing in storage, and a busy answer is told apart from a refusal', () => {
  const time = clock(), store = storage(), server = career(time);
  const page = tab(server, time, store);
  const visit = page.Queue.create({ owner: '', storage: store, fetch: server.fetch, actions: page.actions, now: () => time.now });
  visit.add(prepare([1]));
  assert.equal([...store.data.keys()].some((key) => key.includes('career-bulk:v1:')), false);
  const busy = Object.assign(Error('x'), { status: 409, careerRunInProgress: true });
  assert.equal(page.Queue.isBusy(busy), true);
  assert.equal(page.Queue.isBusy(Object.assign(Error('tailor already running'), { status: 409 })), true);
  assert.equal(page.Queue.isBusy(Object.assign(Error('busy - too many career runs in progress'), { status: 429 })), true);
  assert.equal(page.Queue.isBusy(Object.assign(Error(NEEDED), { status: 409 })), false);
  assert.equal(page.Queue.MAX_AT_ONCE, 2);
});

test('"Prepare the failed ones again" puts only the failed preparations back, and they start fresh', async () => {
  const tries = new Map();
  const time = clock(), server = career(time, { seconds: 20, outcome: (id) => { tries.set(id, (tries.get(id) || 0) + 1); return id === 131 && tries.get(id) === 1 ? 'score_unavailable' : 'ready'; } });
  for (const id of [131, 132]) server.add(id);
  const page = tab(server, time, storage());
  page.queue.add(prepare([131, 132]));
  await run(page, time, 200);
  assert.deepEqual(states(page), { 131: 'failed', 132: 'done' });
  assert.equal(page.queue.retryFailed(), 1);
  assert.equal(page.queue.latest(131).state, 'queued');
  assert.equal(page.queue.latest(131).reason, '', 'the old reason is gone');
  await run(page, time, 200);
  assert.deepEqual(states(page), { 131: 'done', 132: 'done' });
  const generated = server.writes.filter((write) => write.path === '/api/career-hunter/jobs/131/generate').map((write) => write.body.requestId);
  assert.equal(new Set(generated).size, 2, 'the second try is a new request, not the failed one again');
  assert.equal(server.started.filter((start) => start.id === 132).length, 1, 'the prepared job is not prepared again');
});

test('the Other experience chosen in bulk Prepare is saved on each job\'s tailoring before it is prepared, and Generate sends exactly it', async () => {
  const time = clock(), server = career(time, { seconds: 30 });
  for (const id of [141, 142]) server.add(id);
  // One job already holds this choice, chosen by the person: nothing is written to its tailoring.
  server.add(143, { application: { draft: { revision: 5, guidance: '', experienceIds: ['saved-portfolio'], experienceChosen: true }, needsGeneration: true, busy: false } });
  const store = storage(), first = tab(server, time, store, 'tab-before');
  first.queue.add(prepare([141, 142, 143], ['saved-portfolio']));
  first.queue.stop();
  const page = tab(server, time, store, 'tab-after');
  assert.deepEqual(plain(page.queue.items().map((item) => item.experienceIds)), [['saved-portfolio'], ['saved-portfolio'], ['saved-portfolio']], 'the choice is kept with each queued job, through a reload');
  await run(page, time, 400);
  assert.deepEqual(states(page), { 141: 'done', 142: 'done', 143: 'done' });
  for (const id of [141, 142]) {
    const own = server.writes.filter((write) => write.path.startsWith(`/api/career-hunter/jobs/${id}/`));
    assert.deepEqual(own.map((write) => write.body.draft ? 'tailoring' : write.body.status ? 'move' : 'generate'), ['tailoring', 'move', 'generate']);
    assert.deepEqual(own[0].body.draft, { revision: 2, guidance: `Lead with operations for ${id}.`, experienceIds: ['saved-portfolio'], experienceRevision: 'bank-7', experienceChosen: true });
    assert.deepEqual(plain(server.jobs.get(id).application.draft.experienceIds), ['saved-portfolio'], 'the job\'s own tailoring holds the choice');
    const generate = own.at(-1).body;
    assert.deepEqual([generate.experienceIds, generate.experienceChosen, generate.draftRevision], [['saved-portfolio'], true, 3], 'Generate sends exactly the ticked entry, from the saved tailoring');
  }
  assert.deepEqual(server.writes.filter((write) => write.path === '/api/career-hunter/jobs/143/status' && write.body.draft), [], 'no write to a tailoring that already holds the choice');
  assert.deepEqual(server.writes.find((write) => write.path === '/api/career-hunter/jobs/143/generate').body.experienceIds, ['saved-portfolio']);
});

test('Prepare the failed ones again keeps the choice the person made in bulk Prepare', async () => {
  const tries = new Map();
  const time = clock(), server = career(time, { seconds: 20, outcome: (id) => { tries.set(id, (tries.get(id) || 0) + 1); return tries.get(id) === 1 ? 'score_unavailable' : 'ready'; } });
  server.add(151);
  const page = tab(server, time, storage());
  page.queue.add(prepare([151], ['saved-portfolio']));
  await run(page, time, 120);
  assert.equal(page.queue.latest(151).state, 'failed');
  assert.equal(page.queue.retryFailed(), 1);
  await run(page, time, 120);
  assert.equal(page.queue.latest(151).state, 'done');
  const sent = server.writes.filter((write) => write.path.endsWith('/151/generate')).map((write) => write.body.experienceIds);
  assert.deepEqual(sent, [['saved-portfolio'], ['saved-portfolio']], 'both tries carry the same choice');
});

test('a preparation queued before Career asked about other experience (no choice) is cancelled with words, and nothing is written', async () => {
  const time = clock(), server = career(time, { seconds: 20 });
  for (const id of [161, 162]) server.add(id);
  const page = tab(server, time, storage());
  page.queue.add([161, 162].map((id) => ({ id, title: `Office Manager ${id}`, company: `Example ${id}`, kind: 'prepare' })));
  await run(page, time, 60);
  assert.deepEqual(states(page), { 161: 'cancelled', 162: 'cancelled' });
  assert.equal(page.queue.latest(161).reason, page.Queue.UNASKED);
  assert.match(page.Queue.UNASKED, /before Career asked about your other experience.*Prepare applications/);
  assert.deepEqual(server.writes, [], 'no move, no tailoring, no preparation');
  assert.equal(page.queue.summary().paused, null, 'it pauses nothing');
});
