/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | DELETE /calendar/:eventId through the compiled calendar router behind core's real policy service and HTTP guard, over the disposable PostgreSQL school (school-postgres.fixture.cjs): the owner removes their own personal event; another learner, the class teacher and the owner on a class event are refused 404 and the row stays; a malformed id is refused 400; an unassigned actor and an actor denied study.delete are refused by the guard before any handler SQL. Personal events added from a homebase schedule could never be deleted (the route did not exist and the binding was absent).
 */
/** Isolated fixture evidence, not live acceptance; what is real and what is doubled is listed in school-postgres.fixture.cjs. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, startSchool } = require('./school-postgres.fixture.cjs');

const EVENT = Object.freeze({
  own: '31000000-0000-4000-8000-000000000001',
  peer: '32000000-0000-4000-8000-000000000002',
  klass: '33000000-0000-4000-8000-000000000003',
  kept: '34000000-0000-4000-8000-000000000004',
});

let env;
test.before(async () => {
  env = await startSchool();
  await env.db.pool.query(`INSERT INTO lm_calendar_events (event_id, class_id, student_id, title, event_type, event_date) VALUES
    ($1, NULL, $5, 'Own moment', 'custom', '2026-10-15'), ($2, NULL, $6, 'Peer moment', 'custom', '2026-10-15'),
    ($3, $7, NULL, 'Class quiz', 'quiz', '2026-10-16'), ($4, NULL, $5, 'Kept moment', 'custom', '2026-10-17')`,
  [EVENT.own, EVENT.peer, EVENT.klass, EVENT.kept, ID.studentA, ID.peerA, ID.classA1]);
});
test.after(async () => { await env?.close(); });
const call = (...args) => env.call(...args);
const exists = async id => (await env.db.pool.query('SELECT count(*)::int AS n FROM lm_calendar_events WHERE event_id = $1', [id])).rows[0].n === 1;

test('the owner deletes their own personal event and it leaves their calendar', async () => {
  const before = await call('student-a', '/calendar?month=2026-10');
  assert.equal(before.status, 200);
  assert.ok(before.body.events.some(e => e.event_id === EVENT.own));
  const deleted = await call('student-a', `/calendar/${EVENT.own}`, 'DELETE');
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { deleted: true, eventId: EVENT.own });
  assert.equal(await exists(EVENT.own), false);
  const after = await call('student-a', '/calendar?month=2026-10');
  assert.deepEqual(after.body.events.map(e => e.event_id).sort(), [EVENT.klass, EVENT.kept].sort());
  assert.equal((await call('student-a', `/calendar/${EVENT.own}`, 'DELETE')).status, 404, 'a second delete finds nothing');
});

test('another learner, the class teacher and the owner on a class event are refused and nothing is removed', async () => {
  for (const [sub, id] of [['student-a', EVENT.peer], ['teacher-a1', EVENT.kept], ['teacher-a1', EVENT.klass], ['student-a', EVENT.klass], ['admin-a', EVENT.kept]]) {
    const refused = await call(sub, `/calendar/${id}`, 'DELETE');
    assert.equal(refused.status, 404, `${sub} -> ${id}`);
    assert.deepEqual(refused.body, { error: 'Personal event not found' }, 'the same answer whether or not the row exists');
    assert.equal(await exists(id), true, `${id} stays`);
  }
  assert.equal((await call('student-a', '/calendar/not-a-uuid', 'DELETE')).status, 400);
});

test('an unassigned actor and an actor denied study.delete are refused by the guard before any handler SQL', async () => {
  const unassigned = await call('student-b', `/calendar/${EVENT.kept}`, 'DELETE');
  assert.equal(unassigned.status, 403);
  assert.deepEqual(unassigned.sql, []);
  await env.change('deny', 'student-a', { permission: 'study.delete' });
  const denied = await call('student-a', `/calendar/${EVENT.kept}`, 'DELETE');
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.sql, []);
  assert.equal(await exists(EVENT.kept), true);
  assert.equal((await call('student-a', '/calendar?month=2026-10')).status, 200, 'the deny is exactly one permission');
});
