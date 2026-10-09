/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pilot proof for enterprise authorization record rights: the compiled Little Monsters router behind core's real HTTP guard, over a disposable PostgreSQL 16 with every package migration applied as a NOSUPERUSER NOBYPASSRLS runtime role (school-postgres.fixture.cjs). Two schools, three teachers, an admin and three learners prove class/school confinement, own-record isolation, aggregate non-leakage, roster-write confinement and refusal before any handler SQL for unassigned, denied and revoked actors.
 */
/** Isolated fixture evidence, not live acceptance; what is real and what is doubled is listed in school-postgres.fixture.cjs. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, startSchool } = require('./school-postgres.fixture.cjs');

let env;
test.before(async () => { env = await startSchool(); });
test.after(async () => { await env?.close(); });
const call = (...args) => env.call(...args);
const ids = rows => rows.map(row => row.class_id || row.student_id).sort();

test('teacher analytics, roster and class lists stay inside the teacher\'s own class and school', async () => {
  const own = await call('teacher-a1', '/teacher/classes');
  assert.equal(own.status, 200);
  assert.deepEqual(ids(own.body.classes), [ID.classA1]);
  assert.equal(Number(own.body.classes[0].student_count), 2);
  assert.equal(Number(own.body.classes[0].class_quiz_average), 70);
  const analytics = await call('teacher-a1', `/teacher/classes/${ID.classA1}/analytics`);
  assert.equal(analytics.status, 200);
  assert.deepEqual(ids(analytics.body.students), [ID.studentA, ID.peerA].sort());
  assert.equal(Number(analytics.body.students.find(row => row.student_id === ID.studentA).quiz_average), 80, 'class A2 scores stay out');
  assert.deepEqual({ ...analytics.body.summary }, { studentCount: 2, classQuizAverage: 70, studentsWithActivity: 2, totalCardsReviewed: 0 });
  for (const [sub, classId] of [['teacher-a1', ID.classA2], ['teacher-a1', ID.classB1], ['teacher-b', ID.classA1], ['teacher-a2', ID.classA1]]) {
    assert.equal((await call(sub, `/teacher/classes/${classId}/analytics`)).status, 403, `${sub} ${classId} analytics`);
    assert.equal((await call(sub, `/classes/${classId}/students`)).status, 403, `${sub} ${classId} roster`);
  }
  const roster = await call('teacher-a1', `/classes/${ID.classA1}/students`);
  assert.deepEqual(ids(roster.body.students), [ID.studentA, ID.peerA].sort());
  assert.equal((await call('admin-a', `/teacher/classes/${ID.classA2}/analytics`)).status, 200, 'tenant admin reads own school');
  assert.equal((await call('admin-a', `/teacher/classes/${ID.classB1}/analytics`)).status, 403, 'tenant admin stops at the school');
});

test('learners read only their own study records and a teacher sees only their class slice of a learner', async () => {
  const self = await call('student-a', `/student/${ID.studentA}/dashboard`);
  assert.equal(self.status, 200);
  assert.deepEqual(ids(self.body.classes), [ID.classA1, ID.classA2].sort());
  assert.deepEqual(self.body.stats, { quizAverage: 50, quizCount: 2, flashcardsReviewed: 0 });
  for (const [sub, target] of [['student-a', ID.peerA], ['peer-a', ID.studentA], ['teacher-a2', ID.peerA], ['teacher-b', ID.studentA]]) {
    const denied = await call(sub, `/student/${target}/dashboard`);
    assert.equal(denied.status, 404, `${sub} -> ${target}`);
    assert.deepEqual(denied.body, { error: 'Student not found' });
  }
  const teacherView = await call('teacher-a1', `/student/${ID.studentA}/dashboard`);
  assert.equal(teacherView.status, 200);
  assert.deepEqual(ids(teacherView.body.classes), [ID.classA1]);
  assert.deepEqual(teacherView.body.stats, { quizAverage: 80, quizCount: 1, flashcardsReviewed: 0 });
  assert.deepEqual(ids((await call('peer-a', '/classes')).body.classes), [ID.classA1]);
  assert.equal((await call('peer-a', `/classes/${ID.classA2}/info`)).status, 403);
  assert.equal((await call('student-a', `/classes/${ID.classB1}/info`)).status, 403);
});

test('roster writes stay inside the teacher\'s own class and leave no row behind when refused', async () => {
  const added = await call('teacher-a1', `/classes/${ID.classA1}/students`, 'POST', { email: 'new-learner@a.school' });
  assert.equal(added.status, 201);
  const row = await env.db.pool.query("SELECT tenant_id FROM lm_students WHERE lower(email) = 'new-learner@a.school'");
  assert.deepEqual(row.rows, [{ tenant_id: ID.tenantA }]);
  for (const [sub, classId] of [['teacher-a1', ID.classA2], ['teacher-b', ID.classA1], ['student-a', ID.classA1]]) {
    const email = `refused-${sub}@a.school`;
    assert.equal((await call(sub, `/classes/${classId}/students`, 'POST', { email })).status, 403, `${sub} ${classId}`);
    assert.equal((await env.db.pool.query('SELECT count(*)::int AS n FROM lm_students WHERE lower(email) = $1', [email])).rows[0].n, 0);
  }
});

test('unassigned, denied and revoked actors are refused by the guard before any handler SQL', async () => {
  const unassigned = await call('student-b', '/me');
  assert.equal(unassigned.status, 403);
  assert.deepEqual(unassigned.sql, []);
  const student = await call('student-a', '/teacher/classes');
  assert.equal(student.status, 403);
  assert.deepEqual(student.sql, [], 'no teaching grant means no roster read either');
  await env.change('deny', 'teacher-a2', { permission: 'teaching.read' });
  const denied = await call('teacher-a2', `/teacher/classes/${ID.classA2}/analytics`);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.sql, []);
  assert.equal((await call('teacher-a2', `/student/${ID.studentA}/dashboard`)).status, 200, 'the deny is exactly one permission');
  await env.change('revoke', 'teacher-a1', { role: 'teacher' });
  const revoked = await call('teacher-a1', `/classes/${ID.classA1}/students`);
  assert.equal(revoked.status, 403);
  assert.deepEqual(revoked.sql, []);
  const allowed = await call('admin-a', '/teacher/classes');
  assert.equal(allowed.status, 200);
  assert.ok(allowed.sql.length > 1, 'an admitted request reaches the handler SQL');
});
