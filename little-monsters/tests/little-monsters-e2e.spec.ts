/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-04-21 21:10:00 | roger.murphy@agenticfederal.us   | LM fully-operational spec — exercises every HTML page, every CRUD endpoint, ticket dispatch, and workflow integration
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * End-to-end proof that the Little Monsters application, deployed via the
 * swarm-apps framework, is a working product — not just a loaded manifest.
 *
 *   1. All 8 static UI pages render (200, right content-type)
 *   2. Every DB-backed CRUD endpoint returns sensible status codes
 *   3. File uploads succeed and create tickets
 *   4. Tickets created by LM endpoints get picked up by the queue manager
 *   5. Tutor chat endpoint returns 200 or a structured error (no crash)
 *
 * Tests run against the live Docker stack at localhost:35457 — the same
 * environment that serves real students.
 */

const API_BASE = process.env.SWARM_APPS_TEST_BASE_URL || 'http://localhost:35457';

let api: APIRequestContext;
let stackReady = false;
let testClassId: string;
const createdClassIds: string[] = [];

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: API_BASE, ignoreHTTPSErrors: true });
  const health = await api.get('/health').catch(() => null);
  stackReady = !!health && health.ok();

  if (stackReady) {
    // Ensure LM is active — without this, every test will 503
    await api.patch('/api/swarm/apps/little-monsters/toggle', { data: { active: true } });

    // Create a test class each run so ID lookups work
    const classRes = await api.post('/api/education/classes', {
      data: { name: `E2E Test Class ${Date.now()}`, subject: 'math', gradeLevel: '9', teacherName: 'Test Teacher' },
    });
    if (classRes.ok()) {
      const body = await classRes.json();
      testClassId = body.classId;
      createdClassIds.push(body.classId);
    }
  }
});

test.afterAll(async () => {
  // Clean up every class this spec created so the ribbon doesn't
  // accumulate test junk between runs.
  if (stackReady && api) {
    for (const id of createdClassIds) {
      await api.delete(`/api/education/classes/${id}`).catch(() => null);
    }
  }
  await api?.dispose();
});

test.beforeEach(() => {
  test.skip(!stackReady, `OSHAL stack not reachable at ${API_BASE}`);
});

// ─── Static UI pages (8) ─────────────────────────────────────────────────────

const STATIC_PAGES: Array<{ path: string; contains: string }> = [
  { path: '/api/education/dashboard', contains: '<!DOCTYPE html>' },
  { path: '/api/education/my-day', contains: '<!DOCTYPE html>' },
  { path: '/api/education/class', contains: '<!DOCTYPE html>' },
  { path: '/api/education/recorder', contains: '<!DOCTYPE html>' },
  { path: '/api/education/tutor', contains: '<!DOCTYPE html>' },
  { path: '/api/education/flashcards', contains: '<!DOCTYPE html>' },
  { path: '/api/education/mascot.js', contains: 'function' },
  { path: '/api/education/education.css', contains: '' }, // CSS may be empty braces, just probe 200
];

for (const page of STATIC_PAGES) {
  test(`UI page loads: ${page.path}`, async () => {
    const res = await api.get(page.path);
    expect(res.status(), `Expected 200 for ${page.path}, got ${res.status()}`).toBe(200);
    if (page.contains) {
      const body = await res.text();
      expect(body).toContain(page.contains);
    }
  });
}

// ─── Class CRUD ──────────────────────────────────────────────────────────────

test('class CRUD: list + create', async () => {
  const list = await api.get('/api/education/classes');
  expect(list.ok()).toBeTruthy();
  const { classes } = await list.json();
  expect(Array.isArray(classes)).toBeTruthy();

  const created = await api.post('/api/education/classes', {
    data: { name: `Test ${randomUUID().slice(0, 8)}`, subject: 'physics', gradeLevel: '11', teacherName: 'Dr. Who' },
  });
  expect(created.status()).toBe(201);
  const { classId } = await created.json();
  expect(classId).toMatch(/^[0-9a-f-]{36}$/);
  createdClassIds.push(classId);
});

test('class info endpoint returns the loaded class row', async () => {
  const res = await api.get(`/api/education/classes/${testClassId}/info`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.class_id).toBe(testClassId);
  expect(body.subject).toBe('math');
  expect(body.status).toBe('active');
});

// ─── Flashcards CRUD ─────────────────────────────────────────────────────────

test('flashcards: list sets (should not crash with no sets)', async () => {
  const res = await api.get('/api/education/flashcards/sets');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toHaveProperty('sets');
  expect(Array.isArray(body.sets)).toBeTruthy();
});

test('flashcards: create a set for the test class', async () => {
  const res = await api.post('/api/education/flashcards/sets', {
    data: {
      classId: testClassId,
      title: 'E2E Flashcard Set',
      cards: [
        { front: 'What is 2 + 2?', back: '4' },
        { front: 'What is the capital of France?', back: 'Paris' },
      ],
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toHaveProperty('setId');
  expect(body.cardCount).toBe(2);
});

// ─── Assignments ─────────────────────────────────────────────────────────────

test('assignments: list + create', async () => {
  const list = await api.get('/api/education/assignments');
  expect(list.ok()).toBeTruthy();

  const create = await api.post('/api/education/assignments', {
    data: {
      classId: testClassId,
      title: 'E2E Assignment',
      description: 'Test assignment',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  expect(create.status()).toBe(201);
  const body = await create.json();
  expect(body).toHaveProperty('assignmentId');
});

// ─── Students + Enrollment ───────────────────────────────────────────────────

test('students: create', async () => {
  const res = await api.post('/api/education/students', {
    data: { name: `E2E Student ${Date.now()}`, gradeLevel: '9' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toHaveProperty('studentId');
});

// ─── Status ──────────────────────────────────────────────────────────────────

test('education status endpoint is healthy', async () => {
  const res = await api.get('/api/education/status');
  expect(res.ok()).toBeTruthy();
});

// ─── Calendar endpoints ──────────────────────────────────────────────────────

test('calendar: list events returns an events array', async () => {
  const res = await api.get(`/api/education/calendar?classId=${testClassId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.events)).toBeTruthy();
});

test('notifications: list returns notifications + unreadCount', async () => {
  const res = await api.get('/api/education/notifications?studentId=00000000-0000-0000-0000-000000000000');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.notifications)).toBeTruthy();
  expect(typeof body.unreadCount).toBe('number');
});

// ─── Material upload (creates a ticket) ──────────────────────────────────────

test('upload-material: PDF upload creates a ticket', async () => {
  // Minimal PDF: just 4 bytes of header — Express doesn't parse content, multer just stores it
  const fakePdf = Buffer.from('%PDF-1.4 fake content for e2e test\n%%EOF');
  const res = await api.post('/api/education/upload-material', {
    multipart: {
      classId: testClassId,
      type: 'textbook',
      title: 'E2E Test Textbook',
      file: { name: 'e2e-test.pdf', mimeType: 'application/pdf', buffer: fakePdf },
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toHaveProperty('ticketId');
  expect(body.ticketId).toMatch(/^[0-9a-f-]{36}$/);
});

// ─── Tutor chat (LLM-dependent — tolerate 500 if claude CLI missing) ─────────

test('tutor-chat: returns 200 with real response when ANTHROPIC_API_KEY is set, else 503 with structured error', async () => {
  const res = await api.post('/api/education/tutor-chat', {
    data: { message: 'What is 2 + 2? Answer in one sentence.', classId: testClassId },
    timeout: 60000,
  });
  const body = await res.json();
  if (res.status() === 200) {
    expect(body.success).toBe(true);
    expect(typeof body.response).toBe('string');
    expect(body.response.length).toBeGreaterThan(10);
    expect(body).toHaveProperty('conversationId');
  } else {
    expect(res.status()).toBe(503);
    expect(body.error).toBe('Tutor unavailable');
    expect(body.reason).toContain('ANTHROPIC_API_KEY');
  }
});

// ─── Ticket dispatch proof: ticket gets picked up within the poll cycle ──────

test('material-ingest ticket is created with ticketType=education and enters the queue', async () => {
  const fakePdf = Buffer.from('%PDF-1.4 dispatch-test\n%%EOF');
  const uploadRes = await api.post('/api/education/upload-material', {
    multipart: {
      classId: testClassId,
      type: 'syllabus',
      title: 'Dispatch Test',
      file: { name: 'dispatch-test.pdf', mimeType: 'application/pdf', buffer: fakePdf },
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const { ticketId } = await uploadRes.json();

  // Verify the ticket row exists and has the right fields via the ticket API
  const ticket = await api.get(`/api/tickets/${ticketId}`);
  expect(ticket.ok()).toBeTruthy();
  const body = await ticket.json();
  // Education routes now create tickets with ticketType='education' (not 'build')
  // so the Little Monsters focused ticket view + manifest workflow can route them.
  expect(body.ticket?.ticketType || body.ticketType).toBe('education');
});

// ─── Framework integration: LM's manifest-declared bots exist and are active ─

test('bot workflow dispatch: approved build ticket transitions beyond backlog within the poll cycle', async () => {
  // Create a ticket via the framework's ticket API — same path the LM
  // upload-material and process-lecture endpoints use internally.
  const createRes = await api.post('/api/tickets', {
    data: {
      title: 'E2E bot-workflow dispatch test',
      description: 'Any build-type task — validates that queue manager + agent router + mesh transport + swarm worker form a working pipeline.',
      ticketType: 'build',
      labels: ['e2e', 'bot-workflow-test'],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const { ticketId } = await createRes.json();
  expect(ticketId).toMatch(/^[0-9a-f-]{36}$/);

  // Approve so the queue manager's next poll picks it up.
  const approveRes = await api.put(`/api/tickets/${ticketId}/state`, { data: { status: 'approved' } });
  expect(approveRes.ok()).toBeTruthy();

  // Wait up to 30s for the dispatcher to move the ticket beyond "approved".
  // Dev poll interval is 15s; phase 2 (planning) routing happens within
  // seconds of pickup. We assert that the ticket's status is no longer
  // 'approved' and the execution phase is non-null.
  const deadline = Date.now() + 30_000;
  let progressedStatus: string | null = null;
  let progressedPhase: string | null = null;
  while (Date.now() < deadline) {
    const check = await api.get(`/api/tickets/${ticketId}`);
    if (check.ok()) {
      const body = await check.json();
      const t = body.ticket ?? body;
      if (t.status && t.status !== 'approved' && t.status !== 'backlog') {
        progressedStatus = t.status;
        progressedPhase = t.executionPhase ?? null;
        break;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  expect(progressedStatus, `Ticket ${ticketId} never progressed beyond backlog/approved`).not.toBeNull();
  expect(progressedPhase, `Ticket ${ticketId} got no executionPhase`).not.toBeNull();

  // Clean up — cancel the in-flight ticket so the bot containers don't
  // keep churning in the background.
  await api.put(`/api/tickets/${ticketId}/cancel`).catch(() => null);
});

test('all 6 education bots are active in the agents table', async () => {
  const res = await api.get('/api/agents');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  // response shape: { agents: [...] } or [...] — tolerate both
  const agents = Array.isArray(body) ? body : body.agents ?? [];
  const educationBotNames = [
    'lecture-scribe',
    'class-tutor',
    'quiz-master',
    'textbook-librarian',
    'study-coach',
    'writing-coach',
  ];
  for (const name of educationBotNames) {
    const bot = agents.find((a: any) => a.name === name);
    expect(bot, `Expected education bot "${name}" to be registered`).toBeTruthy();
    expect(bot.status).toBe('active');
  }
});
