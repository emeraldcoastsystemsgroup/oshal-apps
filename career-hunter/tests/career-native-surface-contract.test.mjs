/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard compiled native board aliases and
 *   truthful status counters against real SQLite; identity/logger/unused services are scoped doubles.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadCompiledModules } from './helpers/career-route-harness.mjs';

let nextDb;
const { modules } = loadCompiledModules({
  board: 'routes/career-board-routes.js', surface: 'routes/career-surface-routes.js',
}, {
  './career-user-store': { callerSub: (req) => req.userSub, openUserDb: () => nextDb },
  './career-engine-dispatch': {},
});

/** Capture the actual compiled route callbacks without launching unrelated handlers. */
function routes(register) {
  const handlers = new Map();
  const router = { get: (route, handler) => handlers.set(route, handler), post() {}, delete() {} };
  register(router, { pool: {} });
  return handlers;
}

/** Record one route response. */
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('compiled stats count the actual applied and interview vocabulary in SQLite', () => {
  nextDb = new DatabaseSync(':memory:');
  nextDb.exec("CREATE TABLE user_signals(status TEXT); INSERT INTO user_signals VALUES ('applied'), ('applied'), ('interview'), ('offer'), (NULL)");
  const handler = routes(modules.board.registerCareerBoardRoutes).get('/jobs/stats');
  const reply = response();
  handler({ userSub: 'owned-career-fixture' }, reply);
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.body.total, 5);
  assert.equal(reply.body.applied, 2);
  assert.equal(reply.body.interviewing, 1);
  assert.deepEqual(reply.body.byStatus.find((row) => row.status === 'interview'), { status: 'interview', n: 1 });
  nextDb = null;
  const absent = response();
  handler({ userSub: 'no-store' }, absent);
  assert.deepEqual(absent.body, { byStatus: [], total: 0, applied: 0, interviewing: 0, empty: true });
  const anonymous = response();
  handler({}, anonymous);
  assert.equal(anonymous.statusCode, 401);
});

test('compiled root aliases serve the existing native board asset', () => {
  const handlers = routes(modules.surface.registerCareerSurfaceRoutes);
  const served = [];
  for (const route of ['', '/', '/board-native']) {
    const handler = handlers.get(route);
    assert.equal(typeof handler, 'function', `missing ${JSON.stringify(route)}`);
    handler({}, { setHeader() {}, sendFile(file) { served.push(file); } });
  }
  assert.equal(new Set(served).size, 1);
  assert.match(readFileSync(served[0], 'utf8'), /<title>[^<]*(?:Career|Job)/i);
});
