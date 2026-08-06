/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove concurrent draft enqueue is replica-idempotent and manual application transitions fail stopped while recording explicit provenance.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove absent auto-draft consent causes zero reads/writes and manual re-marking upgrades unverified provenance without downgrading stronger evidence.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Cover the board's separate Mark applied route so it preserves the first timestamp and cannot replace worker or confirmation-backed provenance.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Require both manual applied routes to write the authoritative Apply V2 manual_mark before their local projections.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
let enqueueRows = [];
let signalWrites = [];
let engineResult = { ok: true, out: '', err: '' };
let automationSettings = { autoGenerate: true };
let userDbOverride;
let manualRuns = [];

/** Return the narrow SQLite surface used by enqueue and manual status routes. */
function fixtureUserDb() {
  return {
    prepare(sql) {
      if (sql.includes('FROM corpus.postings_corpus')) return { all: () => enqueueRows };
      if (sql.includes('INSERT INTO user_signals')) {
        return { run: (...args) => { signalWrites.push({ sql, args }); return { changes: 1 }; } };
      }
      if (sql.includes('SELECT 1 AS found FROM user_signals')) return { get: () => ({ found: 1 }) };
      throw new Error(`unexpected fixture SQL: ${sql}`);
    },
    close() {},
  };
}

Module._load = function loadWithApplicationStubs(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/app/apply-run-ledger') {
    return { recordManualApplyRun: async (_pool, input) => {
      manualRuns.push(input);
      return { state: 'manual_mark' };
    } };
  }
  if (request === './career-automation') {
    return { readAutomationSettingsSystem: async () => automationSettings };
  }
  if (request === './career-engine-dispatch') {
    return {
      runCareerCliAwait: async () => engineResult,
      runCareerCliAsync: async () => ({ started: true }),
    };
  }
  if (request === './career-engine-response') {
    return { rejectEngineClaim: () => false, rejectEngineStart: () => false };
  }
  if (request === './career-engine-runner') {
    return { tryAcquireRun: () => ({ status: 'ok', token: 'lease' }), releaseRun() {} };
  }
  if (request === './career-user-store') {
    return {
      callerSub: (req) => req.userSub,
      careerTenant: () => 'default',
      openUserDb: () => userDbOverride || fixtureUserDb(),
    };
  }
  if (request === './career-board-feed') return { fetchBoardPage: () => ({}) };
  if (request === './career-resume-preview') {
    return {
      buildPreviewHtml: () => '', resolveContainedRegularFile: () => null,
      resolvePreviewPath: () => null,
    };
  }
  return originalLoad.call(this, request, ...rest);
};

const applicationRoutes = require('../routes/career-application-routes.js');
const boardRoutes = require('../routes/career-board-routes.js');

after(() => { Module._load = originalLoad; });
beforeEach(() => {
  enqueueRows = [];
  signalWrites = [];
  engineResult = { ok: true, out: '', err: '' };
  automationSettings = { autoGenerate: true };
  userDbOverride = undefined;
  manualRuns = [];
});

/** Minimal Express response recorder for exact status/body assertions. */
function responseRecorder() {
  return {
    statusCode: 200, body: undefined, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
  };
}

/** Capture one mutation handler from the package registrar. */
function mutationHandler(ctx, routePath) {
  let handler;
  const router = {
    get() {},
    post(path, callback) { if (path === routePath) handler = callback; },
  };
  applicationRoutes.registerCareerApplicationMutationRoutes(router, ctx);
  assert.equal(typeof handler, 'function');
  return handler;
}

/** Capture one board status mutation from its independent registrar. */
function boardStatusHandler(ctx) {
  let handler;
  const router = {
    get() {},
    post(path, callback) { if (path === '/jobs/:id/status') handler = callback; },
  };
  boardRoutes.registerCareerBoardRoutes(router, ctx);
  assert.equal(typeof handler, 'function');
  return handler;
}

test('concurrent enqueue calls share one deterministic ticket and count one inserted application', async () => {
  enqueueRows = [{ id: 42, title: 'Engineer', company: 'Acme', fit: 91, salary_max: 180000, url: 'https://jobs.example/42' }];
  const tickets = [];
  let inserts = 0;
  const ctx = {
    pool: { query: async (sql, args) => {
      if (sql.includes('SELECT 1 FROM career_hunter_applications')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO career_hunter_applications')) {
        inserts += 1;
        assert.equal(args[2], 'ticket-shared');
        return { rows: inserts === 1 ? [{ id: 1 }] : [], rowCount: inserts === 1 ? 1 : 0 };
      }
      throw new Error(`unexpected fixture SQL: ${sql}`);
    } },
    ticketService: { createTicket: async (input) => { tickets.push(input); return { ticketId: 'ticket-shared' }; } },
  };
  const counts = await Promise.all([
    applicationRoutes.enqueueForUser(ctx, ' Tenant|Exact Subject ', 10, { trigger: 'manual' }),
    applicationRoutes.enqueueForUser(ctx, ' Tenant|Exact Subject ', 10, { trigger: 'manual' }),
  ]);
  assert.equal(counts.reduce((sum, value) => sum + value, 0), 1);
  assert.equal(tickets.length, 2);
  assert.equal(tickets[0].externalProvider, 'career-hunter');
  assert.equal(tickets[0].externalId, tickets[1].externalId);
  assert.equal(tickets[0].externalId.includes(' Tenant|Exact Subject '), false);
});

test('cron enqueue with absent automation consent has zero candidate, ticket, and database writes', async () => {
  automationSettings = { autoGenerate: false };
  enqueueRows = [{ id: 99, title: 'Must not enqueue', company: 'Acme', fit: 99 }];
  const ctx = {
    pool: { query: async () => { throw new Error('database write must not run'); } },
    ticketService: { createTicket: async () => { throw new Error('ticket write must not run'); } },
  };
  const created = await applicationRoutes.enqueueForUser(ctx, 'owner-no-consent', 20, {
    trigger: 'cron',
  });
  assert.equal(created, 0);
  assert.equal(signalWrites.length, 0);
});

test('ticket failure returns 500 and performs no manual SQLite application write', async () => {
  const ctx = {
    pool: { query: async (sql) => {
      if (sql.includes('SELECT ticket_id')) return { rows: [{ ticket_id: 'ticket-1' }], rowCount: 1 };
      throw new Error(`unexpected fixture SQL: ${sql}`);
    } },
    ticketService: { updateStatus: async () => { throw new Error('ticket store unavailable'); } },
  };
  const response = responseRecorder();
  await mutationHandler(ctx, '/applications/:postingId/applied')({
    userSub: 'owner-a', params: { postingId: '42' }, body: {},
  }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.ok, false);
  assert.equal(signalWrites.length, 0);
  assert.deepEqual(manualRuns, [{
    ownerSub: 'owner-a', postingId: 42, ticketId: 'ticket-1',
    sourceRoute: 'career-application-applied',
  }]);
});

test('manual completion records manual-mark and reports a missing application row as failure', async () => {
  const queries = [];
  const ctx = {
    pool: { query: async (sql, args) => {
      queries.push({ sql, args });
      if (sql.includes('SELECT ticket_id')) return { rows: [{ ticket_id: 'ticket-1' }], rowCount: 1 };
      if (sql.includes('UPDATE career_hunter_applications')) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected fixture SQL: ${sql}`);
    } },
    ticketService: { updateStatus: async () => undefined },
  };
  const response = responseRecorder();
  await mutationHandler(ctx, '/applications/:postingId/applied')({
    userSub: 'owner-a', params: { postingId: '42' }, body: {},
  }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.ok, false);
  assert.match(signalWrites[0].sql, /application_source/);
  assert.match(signalWrites[0].sql, /manual-mark/);
  assert.match(signalWrites[0].sql, /ELSE 'manual-mark'/);
  assert.doesNotMatch(signalWrites[0].sql, /application_source=COALESCE/);
  assert.match(queries.at(-1).sql, /verified-submission/);
  assert.match(queries.at(-1).sql, /worker-reported/);
  assert.equal(queries.at(-1).args.at(-1), 'manual-mark');
});

test('successful manual completion synchronizes ticket, signal, and application state', async () => {
  const ticketTransitions = [];
  const ctx = {
    pool: { query: async (sql, args) => {
      if (sql.includes('SELECT ticket_id')) return { rows: [{ ticket_id: 'ticket-1' }], rowCount: 1 };
      if (sql.includes('UPDATE career_hunter_applications')) {
        assert.equal(args.at(-1), 'manual-mark');
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected fixture SQL: ${sql}`);
    } },
    ticketService: { updateStatus: async (...args) => { ticketTransitions.push(args); } },
  };
  const response = responseRecorder();
  await mutationHandler(ctx, '/applications/:postingId/applied')({
    userSub: 'owner-a', params: { postingId: '42' }, body: {},
  }, response);
  assert.deepEqual(response.body, { ok: true });
  assert.deepEqual(ticketTransitions, [['ticket-1', 'complete']]);
  assert.equal(signalWrites.length, 1);
  assert.equal(manualRuns.length, 1);
  assert.equal(manualRuns[0].sourceRoute, 'career-application-applied');
});

test('board Mark applied records manual_mark and preserves stronger provenance and the first applied timestamp', async () => {
  let update;
  userDbOverride = {
    prepare: (sql) => sql.includes('SELECT 1 AS found')
      ? { get: () => ({ found: 1 }) }
      : { run: (args) => { update = { sql, args }; return { changes: 1 }; } },
    close() {},
  };
  const response = responseRecorder();
  const handler = boardStatusHandler({});
  await handler({ userSub: 'owner-a', params: { id: '42' }, body: { status: 'applied' } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'applied');
  assert.match(update.sql, /COALESCE\(applied_at, datetime\('now'\)\)/);
  assert.match(update.sql, /verified-submission/);
  assert.match(update.sql, /worker-reported/);
  assert.match(update.sql, /ELSE 'manual-mark'/);
  assert.doesNotMatch(update.sql, /application_source='manual-mark'/);
  assert.deepEqual(update.args, { status: 'applied', id: 42 });
  assert.deepEqual(manualRuns, [{
    ownerSub: 'owner-a', postingId: 42, ticketId: 'career-board-manual:42',
    sourceRoute: 'career-board-status',
  }]);
});
