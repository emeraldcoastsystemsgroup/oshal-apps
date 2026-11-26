/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-CONCURRENT (Roger, 2026-11-25: "when im batch running resumes and trying to look for jobs i cant post them .. hit save... ect.."): the shipped tools/career-pending-writes.js (the door every Career page's changes go through), with tools/career-job-actions.js and tools/career-bulk-queue.js, against a simulated Career that does what the native kernel does while a résumé is being written (crates/host-process/src/host/career.rs career_busy): every other change of the person's is answered 409 career_run_in_progress before Career runs it. A refused change is kept and lands by itself after the run, once, in the order it was made, across the person's open pages; a page that closes hands it on; one too old is dropped with words; any other answer is the press's own, as before; batch work keeps its own waiting; and My jobs' bulk queue starts no preparation while a change of the person's waits, so that change goes first. The real routes, engine and pages are crossed by tests/career-concurrent-writes-browser.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const DOOR = read('../tools/career-pending-writes.js'), ACTIONS = read('../tools/career-job-actions.js'), QUEUE = read('../tools/career-bulk-queue.js');
const ORIGIN = 'http://career.test', OWNER = 'tenant-1:person-1';

function clock() { const time = { now: Date.parse('2026-11-25T18:00:00Z') }; time.advance = (ms) => { time.now += ms; }; return time; }
/** Browser storage shared by every page of one browser. */
function storage() {
  const data = new Map();
  return { data, get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null, getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); }, removeItem: (key) => { data.delete(key); } };
}
const reply = (status, json) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });

/**
 * @description A simulated Career for one person: while `run` is set a résumé is being written and every change is refused
 * unrun, as the kernel does; otherwise a change is applied and recorded. `answer` may give a change its own answer.
 */
function career() {
  const server = { run: null, writes: [], refused: 0, favorite: new Map(), answer: null };
  server.fetch = async (url, init = {}) => {
    const path = new URL(url, ORIGIN).pathname, method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET') return reply(200, { job: { id: 7 } });
    if (server.run) { server.refused += 1; return reply(409, { error: 'career_run_in_progress', runId: server.run }); }
    server.writes.push({ path, body, init: { ...init } });
    const own = server.answer && server.answer(path, body);
    if (own) return own;
    const id = Number(path.match(/jobs\/(\d+)/)?.[1]);
    if (typeof body?.favorite === 'boolean') server.favorite.set(id, body.favorite);
    return reply(200, { ok: true, favorite: body?.favorite });
  };
  return server;
}

/** One open Career page: the shipped door in a realm of its own, its timers run by the test. */
function page(server, time, store, name, identity = OWNER) {
  const timers = [], views = [];
  const context = vm.createContext({ URL, URLSearchParams, Response, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout });
  vm.runInContext(DOOR, context);
  const door = context.CareerPendingWrites.create({ fetch: server.fetch, storage: store, origin: ORIGIN, base: ORIGIN + '/api/career-hunter/search-ui',
    now: () => time.now, tab: name, identity: async () => identity, onView: (view) => views.push(JSON.parse(JSON.stringify(view))),
    schedule: (fn, ms) => { timers.push({ at: time.now + ms, fn }); return timers.length; } });
  context.CareerPendingWrites.door = door;
  /** Run this page's timers that are due. */
  const tick = async () => { for (const timer of timers.splice(0).filter((t) => { if (t.at > time.now) { timers.push(t); return false; } return true; })) await timer.fn(); await door.pump(); };
  return { door, views, context, tick, said: () => views.map((view) => view.text).filter(Boolean) };
}
const save = (p, id, favorite = true, init = {}) => p.door.fetch('/api/career-hunter/jobs/' + id + '/status',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite }), ...init });
/** Move time on in steps, letting every page take its turn. */
async function run(pages, time, seconds, step = 500) {
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += step) { time.advance(step); for (const p of pages) await p.tick(); }
}
/** Watch a press: its answer once it has one. A refused answer's body is read on a later turn, so let a few turns pass. */
const settled = async (promise) => {
  let done = null;
  promise.then((value) => { done = { value }; }, (error) => { done = { error }; });
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  return () => done;
};

test('a change refused while a résumé is written is kept, sent again until Career takes it, once, and its press gets that answer', async () => {
  const time = clock(), server = career(), store = storage(), a = page(server, time, store, 'a');
  server.run = 'run-1';
  const done = await settled(save(a, 7));
  await run([a], time, 1);
  assert.equal(done(), null, 'the press is still waiting, not refused');
  assert.equal(a.door.waiting(), 1);
  assert.match(a.said().at(-1), /^Saving — waiting for the résumé being written now\./);
  await run([a], time, 20);
  assert.ok(server.refused >= 5, 'sent again every few seconds while the run holds the files');
  assert.equal(server.writes.length, 0, 'nothing is written while the run holds the files');
  server.run = null;
  await run([a], time, 5);
  assert.equal(server.writes.length, 1, 'it reaches Career once');
  assert.deepEqual(server.writes[0].body, { favorite: true });
  assert.equal(server.favorite.get(7), true);
  const answered = done();
  assert.equal(answered.value.status, 200);
  assert.deepEqual(await answered.value.json(), { ok: true, favorite: true }, 'the press reads Career’s own answer');
  assert.equal(a.said().at(-1), 'Saved.');
  assert.equal(a.door.waiting(), 0);
  assert.equal([...store.data.keys()].length, 0, 'nothing is left in the browser');
});

test('any other answer is the press’s own, at once: a conflict, a refusal, a stall that may have run, and batch work', async () => {
  const time = clock(), server = career(), a = page(server, time, storage(), 'a');
  server.answer = (path, body) => body?.favorite === false ? reply(409, { error: 'This draft changed in another tab.' }) : null;
  const conflict = await save(a, 7, false);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'This draft changed in another tab.' });
  server.answer = () => reply(503, { refused: 'store_unavailable', detail: 'unavailable: package response stalled before the next protocol message' });
  assert.equal((await save(a, 7)).status, 503, 'a request that may have run is never sent again by itself');
  server.answer = null;
  server.run = 'run-1';
  const batch = await save(a, 7, true, { careerBatch: true });
  assert.equal(batch.status, 409, 'batch work hears Career is busy and keeps its own waiting');
  assert.equal(a.door.waiting(), 0);
  assert.equal(server.refused, 1);
  server.run = null;
  await save(a, 7, true, { careerBatch: true });
  assert.equal('careerBatch' in server.writes.at(-1).init, false, 'the mark never reaches Career');
  assert.equal(server.writes.length, 3, 'each was sent once');
});

test('the kernel’s busy answer that says nothing ran is kept like a run in progress', async () => {
  const time = clock(), server = career(), a = page(server, time, storage(), 'a');
  let busy = true;
  server.answer = () => busy ? reply(503, { refused: 'store_unavailable', detail: 'unavailable: Career is busy; this request did not run' }) : null;
  const done = await settled(save(a, 7));
  await run([a], time, 3);
  assert.equal(done(), null);
  busy = false;
  await run([a], time, 3);
  assert.equal(done().value.status, 200);
});

test('reads, other applications, confirmed actions and question cards pass through untouched', async () => {
  const time = clock(), server = career(), a = page(server, time, storage(), 'a');
  server.run = 'run-1';
  assert.equal((await a.door.fetch('/api/career-hunter/jobs/7')).status, 200, 'a read is served from what is published');
  const asked = [];
  const passing = page({ fetch: async (url, init) => { asked.push([url, init && init.method]); return reply(409, { error: 'career_run_in_progress' }); } }, time, storage(), 'b');
  for (const [url, init] of [['/api/apply/cards/1/answer', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OSHAL-Apply-Card': '1' }, body: '{}' }],
    ['/tickets/9/cancel', { method: 'POST', headers: { 'x-oshal-confirm': 'token' } }],
    ['/api/career-hunter/apply-runs/1/cancel', { method: 'POST', headers: { 'x-oshal-confirm': 'token' } }],
    ['/api/v1/agent/schedules/1/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }]]) {
    assert.equal((await passing.door.fetch(url, init)).status, 409, url + ' is answered as before');
  }
  assert.equal(passing.door.waiting(), 0);
  assert.equal(asked.length, 4);
});

test('changes land in the order they were made, across the person’s open pages, and a later one is never overwritten', async () => {
  const time = clock(), server = career(), store = storage(), a = page(server, time, store, 'a'), b = page(server, time, store, 'b');
  server.run = 'run-1';
  const first = await settled(save(a, 7, true));
  time.advance(100);
  const second = await settled(save(b, 7, false));
  time.advance(100);
  const third = await settled(save(a, 8, true));
  await run([a, b], time, 6);
  assert.equal(a.door.waiting(), 3, 'every page sees all three waiting');
  assert.equal(b.door.waiting(), 3);
  server.run = null;
  await run([b, a], time, 12);
  assert.deepEqual(server.writes.map((write) => [write.path, write.body.favorite]),
    [['/api/career-hunter/jobs/7/status', true], ['/api/career-hunter/jobs/7/status', false], ['/api/career-hunter/jobs/8/status', true]]);
  assert.equal(server.favorite.get(7), false, 'the later change wins');
  for (const done of [first, second, third]) assert.equal(done().value.status, 200);
  assert.equal(b.said().at(-1), 'Saved.', 'another page says Saved too');
});

test('a change made while another is waiting goes after it, even once Career is free', async () => {
  const time = clock(), server = career(), a = page(server, time, storage(), 'a');
  server.run = 'run-1';
  const first = await settled(save(a, 7, true));
  server.run = null;
  const second = await settled(save(a, 7, false));
  assert.equal(server.writes.length, 0, 'the second waits in line behind the first');
  await run([a], time, 4);
  assert.deepEqual(server.writes.map((write) => write.body.favorite), [true, false]);
  assert.equal(first().value.status, 200);
  assert.equal(second().value.status, 200);
});

test('a page that closes hands its waiting change to another open page, which saves it and says so', async () => {
  const time = clock(), server = career(), store = storage(), a = page(server, time, store, 'a'), b = page(server, time, store, 'b');
  server.run = 'run-1';
  await settled(save(a, 7));
  await run([a, b], time, 1);
  assert.equal(b.door.waiting(), 1, 'the other page sees it waiting');
  a.door.handOver();
  await run([b], time, 4);
  server.run = null;
  await run([b], time, 6);
  assert.equal(server.writes.length, 1, 'saved once, by the page still open');
  assert.equal(server.favorite.get(7), true);
  assert.equal(b.said().at(-1), 'Saved.');
});

test('a page that stopped running timers has its change saved by another page and its press answered', async () => {
  const time = clock(), server = career(), store = storage(), a = page(server, time, store, 'a'), b = page(server, time, store, 'b');
  server.run = 'run-1';
  const done = await settled(save(a, 7));
  await run([b], time, 20);
  server.run = null;
  await run([b], time, 6);
  assert.equal(server.writes.length, 1);
  await a.tick();
  const answered = done();
  assert.equal(answered.value.status, 200, 'the press on the quiet page gets Career’s answer');
  assert.deepEqual(await answered.value.json(), { ok: true, favorite: true });
  await run([a, b], time, 6);
  assert.equal(server.writes.length, 1, 'never sent twice');
});

test('a change no open page could send within 30 minutes is dropped, with words saying so, and never sent', async () => {
  const time = clock(), server = career(), store = storage(), a = page(server, time, store, 'a');
  server.run = 'run-1';
  await settled(save(a, 7));
  await run([a], time, 1);
  assert.equal(a.door.waiting(), 1);
  a.door.handOver();
  time.advance(31 * 60 * 1000);
  server.run = null;
  const b = page(server, time, store, 'b');
  await b.door.pump();
  await run([b], time, 6);
  assert.equal(server.writes.length, 0);
  assert.match(b.said().join(' '), /^A change you made at .+ was not saved: Career was busy and the page closed before it could save\. Make it again if you still want it\./);
  assert.equal(b.door.waiting(), 0);
});

test('a press the page cancels is not sent later', async () => {
  const time = clock(), server = career(), a = page(server, time, storage(), 'a'), controller = new AbortController();
  server.run = 'run-1';
  const done = await settled(save(a, 7, true, { signal: controller.signal }));
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done().error.name, 'AbortError');
  server.run = null;
  await run([a], time, 6);
  assert.equal(server.writes.length, 0);
});

test('with nobody known to the browser a change is still kept on this page, and leaving would lose it', async () => {
  const time = clock(), server = career(), store = storage(), a = page(server, time, store, 'a', '');
  server.run = 'run-1';
  const done = await settled(save(a, 7));
  await run([a], time, 1);
  assert.equal(store.data.size, 0, 'nothing is written to storage for nobody');
  assert.equal(a.door.holdsUnsaved(), true, 'the page asks before it is left');
  server.run = null;
  await run([a], time, 4);
  assert.equal(done().value.status, 200);
  assert.equal(a.door.holdsUnsaved(), false);
});

test('My jobs’ bulk queue starts no preparation while a change of the person’s waits, so the change goes first', async () => {
  const time = clock(), store = storage(), runs = [], writes = [];
  const jobs = new Map([11, 12].map((id) => [id, { id, title: `Office Manager ${id}`, company: `Example ${id}`, status: 'new', favorite: true, has_resume: 0, has_cover: 0,
    description: 'A real description.', board: { favorite: true }, application: { draft: { revision: 2, guidance: '', experienceIds: [], experienceChosen: true }, needsGeneration: true, busy: false } }]));
  const settle = () => { for (const r of runs.filter((each) => time.now >= each.endsAt)) { runs.splice(runs.indexOf(r), 1); const job = jobs.get(r.id);
    job.board = { ...job.board, requestId: r.requestId, completedAt: new Date(time.now).toISOString(), phase: 'ready' }; Object.assign(job, { status: 'generated', has_resume: 1, has_cover: 1 }); } };
  const server = { fetch: async (url, init = {}) => {
    settle();
    const path = new URL(url, ORIGIN).pathname, method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    if (method !== 'GET' && runs.length) return reply(409, { error: 'career_run_in_progress', runId: 'run-1' });
    if (method !== 'GET') writes.push({ path, body, at: time.now });
    if (path.endsWith('/experience-bank')) return reply(200, { revision: 'bank-7', entries: [] });
    const match = path.match(/jobs\/(\d+)(\/status|\/generate)?$/), job = match && jobs.get(Number(match[1]));
    if (!match[2]) return reply(200, { job: job ? structuredClone(job) : { id: Number(match[1]) }, processing: runs.length ? 'run-1' : false });
    if (match[2] === '/status') { if (body.status) job.status = body.status; return reply(200, { ok: true, status: job?.status, favorite: true, application: job?.application }); }
    runs.push({ id: job.id, requestId: body.requestId, endsAt: time.now + 180000 });
    return reply(202, { ok: true, status: 'generating', requestId: body.requestId });
  } };
  // One My jobs page, wired as tools/career-jobs-table.js wires it: the door in front of the page's fetch, the queue's writes batch work.
  const p = page(server, time, store, 'board');
  Object.assign(p.context, { setTimeout, clearTimeout, fetch: (url, init) => p.door.fetch(url, init) });
  p.context.window = p.context;
  vm.runInContext(ACTIONS, p.context);
  vm.runInContext(QUEUE, p.context);
  const actions = p.context.CareerJobActions;
  const queue = p.context.CareerBulkQueue.create({ owner: OWNER, storage: store, fetch: (url, init) => p.door.fetch(url, { ...(init || {}), careerBatch: true }),
    actions: { ...actions, ...actions.batch }, send: async () => ({}), now: () => time.now, tab: 'board', pendingWrites: () => p.door.waiting(OWNER) });
  queue.add([11, 12].map((id) => ({ id, title: `Office Manager ${id}`, company: `Example ${id}`, kind: 'prepare', experienceIds: [] })));
  const step = async (seconds) => { for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 1500) { time.advance(1500); await queue.tick(); await p.tick(); } };
  await step(6);
  assert.equal(runs.length, 1, 'the résumé for 11 is being written');
  assert.equal(runs[0].id, 11);
  const pressed = await settled(actions.save(99));
  await step(30);
  assert.equal(pressed(), null, 'the Save waits while 11 is written');
  await step(170);
  assert.ok(pressed()?.value, 'the Save landed once 11 was written');
  const saved = writes.findIndex((write) => write.path === '/api/career-hunter/jobs/99/status');
  const next = writes.findIndex((write) => write.path === '/api/career-hunter/jobs/12/generate');
  assert.ok(saved >= 0 && next > saved, 'the person’s Save went before the next résumé started');
  assert.deepEqual(writes[saved].body, { favorite: true });
});
