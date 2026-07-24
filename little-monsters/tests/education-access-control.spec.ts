/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-13 11:10:00 | roger.murphy@agenticfederal.us   | E2E proof of the Little Monsters shared-vs-private access model: a student only sees their enrolled classes + own private data; a class they're not enrolled in is 403.
 * 2026-06-17 21:30:00 | roger.murphy@emeraldcoastsystemsgroup.com    | Added calendar/notification access-control cases (regression cover for the cross-student leak fix): stranger-class calendar reads/writes 403, assignment creation is teacher-only, notify-other is 403 for a student, notifications/calendar are scoped to the caller.
 * -----------------------------------------------------------------------------
 *
 * Run against the live docker stack (which boots with MOCK_OIDC → authenticated
 * as the seeded demo student "Alex Monster", enrolled in the demo classes):
 *
 *   PLAYWRIGHT_PORT=35460 PLAYWRIGHT_REUSE_SERVER=true MOCK_OIDC=true \
 *     npx playwright test tests/education-access-control.spec.ts
 */
import { test, expect } from '@playwright/test';

const DEMO_STUDENT_ID = '11111111-1111-4111-8111-111111111111'; // Alex Monster (demo seed)

test.describe('Little Monsters — shared-vs-private access control', () => {
  test('private dashboard: a student can only read their OWN data (path param is ignored)', async ({ request }) => {
    // Pass a random studentId — a student is always forced to their authenticated identity.
    const r1 = await request.get(`/api/education/student/00000000-0000-4000-8000-000000000abc/dashboard`);
    expect(r1.ok()).toBeTruthy();
    const d1 = await r1.json();
    expect(d1.student?.student_id).toBe(DEMO_STUDENT_ID);

    // A different bogus param returns the same (own) student — proves the param can't leak others.
    const r2 = await request.get(`/api/education/student/ffffffff-ffff-4fff-8fff-ffffffffffff/dashboard`);
    const d2 = await r2.json();
    expect(d2.student?.student_id).toBe(DEMO_STUDENT_ID);
  });

  test('a class you create is owned + enrolled (appears in your list, accessible)', async ({ request }) => {
    // Open model: anyone can create a class; the creator owns it and is enrolled.
    const created = await request.post('/api/education/classes', {
      data: { name: `Create Test ${Date.now()}`, subject: 'security' },
    });
    expect(created.ok()).toBeTruthy();
    const newClassId = (await created.json()).classId as string;

    try {
      // It appears in MY class list (I'm enrolled as the owner)…
      const list = (await (await request.get('/api/education/classes')).json()).classes as Array<{ class_id: string }>;
      expect(list.find((c) => c.class_id === newClassId)).toBeDefined();

      // …and its shared materials are reachable to me (200, not 403).
      expect((await request.get(`/api/education/classes/${newClassId}/info`)).status()).toBe(200);
      expect((await request.get(`/api/education/lectures?classId=${newClassId}`)).status()).toBe(200);
      expect((await request.get(`/api/education/flashcards/sets?classId=${newClassId}`)).status()).toBe(200);
    } finally {
      await request.delete(`/api/education/classes/${newClassId}`); // cleanup
    }
  });

  test('a class you are NOT enrolled in is 403 on every shared route', async ({ request }) => {
    // A random class id you neither own nor are enrolled in → access denied
    // (assertClassAccess runs before any existence check, so unknown ids 403 too).
    const stranger = '00000000-0000-4000-8000-0000000ac403';
    expect((await request.get(`/api/education/classes/${stranger}/info`)).status()).toBe(403);
    expect((await request.get(`/api/education/lectures?classId=${stranger}`)).status()).toBe(403);
    expect((await request.get(`/api/education/flashcards/sets?classId=${stranger}`)).status()).toBe(403);
  });

  test('GET /me returns the authenticated identity + onboarding state', async ({ request }) => {
    const me = await (await request.get('/api/education/me')).json();
    expect(me.studentId).toBe(DEMO_STUDENT_ID);
    expect(typeof me.classCount).toBe('number');
    expect(typeof me.isNew).toBe('boolean');
  });

  test('recent lectures are scoped to accessible classes only', async ({ request }) => {
    const resp = await request.get('/api/education/lectures/recent?limit=25');
    expect(resp.ok()).toBeTruthy();
    const { lectures } = await resp.json();
    const accessible = ((await (await request.get('/api/education/classes')).json()).classes as Array<{ class_id: string }>)
      .map((c) => c.class_id);
    for (const lec of lectures as Array<{ class_id: string }>) {
      expect(accessible).toContain(lec.class_id);
    }
  });
});

// A class id the demo student neither owns nor is enrolled in.
const STRANGER_CLASS = '00000000-0000-4000-8000-0000000ac403';
// A studentId that is NOT the authenticated demo student.
const OTHER_STUDENT = '00000000-0000-4000-8000-000000000abc';

test.describe('Little Monsters — calendar + notification access control', () => {
  test('calendar: reading a class you are not enrolled in is 403', async ({ request }) => {
    expect((await request.get(`/api/education/calendar?classId=${STRANGER_CLASS}`)).status()).toBe(403);
  });

  test('calendar: your own calendar (no classId) is reachable and scoped to you', async ({ request }) => {
    // No classId → own personal events + accessible classes only; never another student's.
    const resp = await request.get('/api/education/calendar');
    expect(resp.ok()).toBeTruthy();
    const { events } = await resp.json();
    expect(Array.isArray(events)).toBeTruthy();
    // Every returned event is either personal (own student_id / null) — never another student's.
    for (const e of events as Array<{ student_id: string | null }>) {
      expect(e.student_id === null || e.student_id === DEMO_STUDENT_ID).toBeTruthy();
    }
  });

  test('calendar: cannot create an event under a class you cannot access', async ({ request }) => {
    const resp = await request.post('/api/education/calendar', {
      data: { classId: STRANGER_CLASS, title: 'injected', eventDate: '2026-07-01' },
    });
    expect(resp.status()).toBe(403);
  });

  test('assignments-with-events: creating one is teacher-only (403 for a student)', async ({ request }) => {
    const resp = await request.post('/api/education/assignments-with-events', {
      data: { classId: STRANGER_CLASS, title: 'injected', dueDate: '2026-07-01' },
    });
    expect(resp.status()).toBe(403);
  });

  test('notifications: a client-supplied studentId is ignored — you only get your own', async ({ request }) => {
    // Passing another student's id must NOT return their notifications.
    const resp = await request.get(`/api/education/notifications?studentId=${OTHER_STUDENT}`);
    expect(resp.ok()).toBeTruthy();
    const { notifications } = await resp.json();
    expect(Array.isArray(notifications)).toBeTruthy();
    for (const n of notifications as Array<{ student_id: string }>) {
      expect(n.student_id).toBe(DEMO_STUDENT_ID);
    }
  });

  test('notify: a student may notify themselves but not another student', async ({ request }) => {
    // Self-notify is allowed.
    const self = await request.post('/api/education/notify', {
      data: { studentId: DEMO_STUDENT_ID, title: 'self', body: 'ok' },
    });
    expect(self.status()).toBe(201);

    // Notifying a different student requires teacher/admin → 403 for a student.
    const other = await request.post('/api/education/notify', {
      data: { studentId: OTHER_STUDENT, title: 'spam', body: 'no' },
    });
    expect(other.status()).toBe(403);
  });
});
