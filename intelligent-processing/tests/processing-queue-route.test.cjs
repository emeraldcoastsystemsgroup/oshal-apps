/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0 (concierge audit T15): the queue read the front-desk concierge answers from. The compiled route runs on real Express over HTTP with a stand-in for the kernel's ticket port that answers in the port's own projection (ticketId, id, ticketType, workflow, status, position, revision, createdAt, updatedAt; crates/packages/src/ticket_reads.rs project), so the boundary doubled here is only the kernel port. It asks the port for exactly this queue's type and the port's maximum, counts total, open, waiting on a person, failed, done and cancelled the way the queue screen does, lists the newest 25 with their phase and state in words, says titles are not carried, refuses a caller with no sign-in before reading anything, answers a port failure as unavailable, reads nothing but the port (no SQL, network, bot or write) and is the canonical compile of its TypeScript source. Run: node --test intelligent-processing/tests/processing-queue-route.test.cjs
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const store = path.resolve(root, '..');
const toolchain = createRequire(path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain')), 'package.json'));
const express = toolchain('express');
const COMPILED = path.join(root, 'routes', 'processing-queue.js');
const SOURCE = path.join(root, 'src-routes', 'processing-queue.ts');
const QUEUE = 'intelligent-processing';
const NOW = Date.now();
const MINUTE = 60000;

/** Load the compiled route as the kernel would, with express from the gate's own toolchain. */
function loadRoute() {
  const module = { exports: {} };
  const local = (id) => (id === 'express' ? express : require(id));
  new Function('require', 'module', 'exports', fs.readFileSync(COMPILED, 'utf8'))(local, module, module.exports);
  return module.exports;
}

/** One ticket in the kernel ticket port's projection. */
function ticket(n, status, phase, filedMinutesAgo, movedMinutesAgo = filedMinutesAgo, kind = QUEUE) {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return { ticketId: id, id, ticketType: kind, workflow: `${kind}:rca`, status,
    position: phase ? { name: phase, index: ['investigate', 'review', 'revise'].indexOf(phase) } : null, revision: 3,
    createdAt: NOW - filedMinutesAgo * MINUTE, updatedAt: NOW - movedMinutesAgo * MINUTE };
}

/** Serve the route on an ephemeral port behind a stand-in of the kernel runner's caller stamp. */
async function serve(t, ticketService) {
  const { createProcessingQueueRoutes } = loadRoute();
  const app = express();
  app.use((req, _res, next) => {
    const sub = req.get('x-test-caller');
    if (sub) req.oidc = { isAuthenticated: () => true, user: { sub } };
    next();
  });
  app.use('/api/intelligent-processing/queue', createProcessingQueueRoutes({ ticketService }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (caller) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligent-processing/queue`,
      { headers: caller ? { 'x-test-caller': caller } : {} });
    return { status: response.status, body: await response.json() };
  };
}

/** A stand-in kernel ticket port that records every listing it is asked for. */
function port(tickets) {
  const asked = [];
  return { asked, listTickets: async (filter) => { asked.push(filter); return tickets; } };
}

test('the queue read counts the caller\'s own tickets the way the queue screen does and asks the port for this queue only', async (t) => {
  const service = port([
    ticket(1, 'running', 'review', 5, 2),
    ticket(2, 'awaiting_approval', 'revise', 90, 30),
    ticket(3, 'blocked', 'investigate', 600, 300),
    ticket(4, 'queued', null, 0, 0),
    ticket(5, 'done', null, 3000, 2000),
    ticket(6, 'failed', 'investigate', 4000, 3900),
    ticket(7, 'cancelled', null, 5000, 4900),
    ticket(8, 'running', 'review', 10, 3, 'another-queue'),
  ]);
  const get = await serve(t, service);
  const { status, body } = await get('person-1');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(service.asked, [{ ticketType: QUEUE, limit: 200 }], 'one listing of this queue, at the port maximum');
  assert.deepEqual(body.counts, { total: 7, open: 4, waitingOnPerson: 2, failed: 1, done: 1, cancelled: 1 }, 'another ticket type is left out');
  assert.equal(body.byStatus.running, 1);
  assert.equal(body.queue, QUEUE);
  assert.equal(body.executionAuthorized, false);
  assert.equal(body.open, 'Intelligent Processing');
  assert.match(body.titles, /^not carried/);
  assert.match(body.summary, /^7 tickets on this queue: 4 open \(2 waiting on a person\), 1 failed, 1 done, 1 cancelled\. /);
  assert.match(body.summary, /The most recently filed was filed just now and is queued, waiting for its first phase\.$/);
  assert.deepEqual(body.tickets.map((row) => row.status), ['queued', 'running', 'awaiting_approval', 'blocked', 'done', 'failed', 'cancelled'], 'newest move first');
  const running = body.tickets.find((row) => row.status === 'running');
  assert.deepEqual([running.phase, running.state, running.filed, running.lastMoved], ['review', 'in the review phase', '5 minutes ago', '2 minutes ago']);
  assert.match(running.filedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'an ISO time');
  assert.equal(Date.parse(running.filedAt), NOW - 5 * MINUTE, 'the port\'s own filing time');
  assert.equal(body.tickets.find((row) => row.status === 'awaiting_approval').state, 'waiting on a person to approve the revise phase');
  assert.equal(body.tickets.find((row) => row.status === 'blocked').state, 'blocked at the investigate phase: something it needs is not loaded or not reachable');
  assert.equal(body.tickets.find((row) => row.status === 'failed').state, 'failed in the investigate phase');
  for (const row of body.tickets) {
    assert.deepEqual(Object.keys(row).sort(), ['filed', 'filedAt', 'lastMoved', 'lastMovedAt', 'phase', 'state', 'status', 'ticketId']);
  }
});

test('an empty queue says so, and a full listing is marked as the newest 200 with 25 named', async (t) => {
  const empty = await (await serve(t, port([])))('person-1');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.counts, { total: 0, open: 0, waitingOnPerson: 0, failed: 0, done: 0, cancelled: 0 });
  assert.equal(empty.body.summary, 'No tickets on this queue yet. An alert filed on the Intelligent Processing screen opens one.');
  assert.deepEqual(empty.body.tickets, []);
  const full = await (await serve(t, port(Array.from({ length: 200 }, (_, n) => ticket(n + 1, 'done', null, 100 + n)))))('person-1');
  assert.equal(full.body.truncated, true);
  assert.equal(full.body.tickets.length, 25);
  assert.match(full.body.summary, /These counts cover the newest 200 tickets\.$/);
});

test('a caller with no sign-in is refused before the port is read, and a refused or missing port is answered as unavailable', async (t) => {
  const service = port([ticket(1, 'running', 'review', 5)]);
  const anonymous = await (await serve(t, service))(null);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(service.asked, [], 'nothing is read for an unknown caller');
  const refused = await (await serve(t, { listTickets: async () => { throw new Error('ticket type is not owned by this application'); } }))('person-1');
  assert.equal(refused.status, 502);
  assert.equal(refused.body.error, 'queue_unavailable');
  assert.equal(refused.body.detail, 'ticket type is not owned by this application');
  const missing = await (await serve(t, undefined))('person-1');
  assert.equal(missing.status, 503);
  assert.equal(missing.body.error, 'queue_unavailable');
});

test('the route reads only the kernel ticket port and is the canonical compile of its source', () => {
  const compiled = fs.readFileSync(COMPILED, 'utf8');
  const source = fs.readFileSync(SOURCE, 'utf8');
  for (const [name, text] of [['source', source], ['compiled', compiled]]) {
    assert.doesNotMatch(text, /ctx\.pool|\bpool\.query|\bfetch\(|executeBot|orchestrator|ctx\.http|ctx\.store|ctx\.intent|createTicket|startTicket|@\/|oshal\/src/, `${name} reads the ticket port only`);
    assert.doesNotMatch(text, /router\.(post|put|patch|delete)\(/, `${name} serves no write`);
    assert.match(text, /listTickets\(\{ ticketType: QUEUE, limit: LIMIT \}\)/, `${name} lists this queue at the port maximum`);
  }
  const ts = toolchain('typescript');
  const emitted = ts.transpileModule(source, { fileName: 'processing-queue.ts', compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, esModuleInterop: true, sourceMap: true, strict: true,
    resolveJsonModule: true } }).outputText;
  assert.equal(compiled, emitted, 'routes/processing-queue.js is the framework program\'s emit of src-routes/processing-queue.ts');
});
