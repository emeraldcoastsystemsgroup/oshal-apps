/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Shared-window adapter and compiled tutor contract suite (RED-first): model failure/refusal/empty/persistence failures never award XP or mint receipts; strict optional choice:{provider,model} validation; separated images, text/unreadable documents, and retained PDF route; teacher-visibility and material-revocation invariants; real Chromium 412x915 touch + 1440x900 desktop per-tab class/thread isolation, UUID history list/replay/delete/New, model pick, single-pass image/doc attach, and default non-adapter concierge regression guard.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The tutor mapper lives inline in tools/tutor-chat.html (no new asset route or authorization binding), so the suite no longer serves tutor-chat-transport.js.
 * -----------------------------------------------------------------------------
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const rawToolchain = process.env.STORE_CI_TOOLCHAIN || path.join(STORE, 'scripts', 'toolchain');
const TOOLCHAIN = rawToolchain.endsWith('node_modules') ? rawToolchain : path.join(rawToolchain, 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const TOOLS = path.join(PKG, 'tools');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEACHER_A1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TEACHER_A2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const STUDENT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLASS_BIO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const CLASS_CHEM = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const CLASS_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const MAT_BIO = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Build an isolated in-memory school database + RAG + bot/XP spy harness for the compiled tutor route. */
function createTutorHarness(opts = {}) {
  const state = {
    teacherVisible: Boolean(opts.teacherVisible),
    failPersist: Boolean(opts.failPersist),
    botImpl: opts.botImpl || (async () => ({ response: 'What happens to chromosomes during prophase?' })),
    visionImpl: opts.visionImpl || (async () => 'Walk me through step 1 of your PDF worksheet.'),
    ragHits: opts.ragHits || { [`lm-mat-${MAT_BIO}`]: [{ text: 'Chapter 4, p. 88: Mitosis divides duplicated chromosomes.', score: 0.94 }] },
    materials: [{
      material_id: MAT_BIO, class_id: CLASS_BIO, uploaded_by: TEACHER_A1,
      share_status: 'approved', rag_collection: `lm-mat-${MAT_BIO}`, title: 'Biology 2e',
    }],
    threads: [],
    messages: [],
    xpCalls: [],
    botCalls: [],
    visionCalls: [],
  };

  const actors = {
    'sub-student-a': { student_id: STUDENT_A, tenant_id: TENANT_A, role: 'student', name: 'Ella', email: 'ella@a.edu' },
    'sub-teacher-a1': { student_id: TEACHER_A1, tenant_id: TENANT_A, role: 'teacher', name: 'Ms. Rivera', email: 'rivera@a.edu' },
    'sub-teacher-a2': { student_id: TEACHER_A2, tenant_id: TENANT_A, role: 'teacher', name: 'Mr. Cho', email: 'cho@a.edu' },
    'sub-student-b': { student_id: STUDENT_B, tenant_id: TENANT_B, role: 'student', name: 'Liam', email: 'liam@b.edu' },
  };
  const classes = [
    { class_id: CLASS_BIO, tenant_id: TENANT_A, teacher_student_id: TEACHER_A1, name: 'Biology', subject: 'Science', teacher_name: 'Ms. Rivera', status: 'active' },
    { class_id: CLASS_CHEM, tenant_id: TENANT_A, teacher_student_id: TEACHER_A2, name: 'Chemistry', subject: 'Chemistry', teacher_name: 'Mr. Cho', status: 'active' },
    { class_id: CLASS_B, tenant_id: TENANT_B, teacher_student_id: STUDENT_B, name: 'Other School', subject: 'History', teacher_name: 'Dr. B', status: 'active' },
  ];
  const enrollments = [
    { student_id: STUDENT_A, class_id: CLASS_BIO },
    { student_id: STUDENT_A, class_id: CLASS_CHEM },
  ];

  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [], rowCount: 0 };
    if (/FROM lm_students WHERE oidc_sub = \$1/i.test(s)) {
      const hit = actors[params[0]];
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (/SELECT tutor_history_teacher_visible FROM lm_tenants/i.test(s)) {
      return { rows: [{ tutor_history_teacher_visible: state.teacherVisible }], rowCount: 1 };
    }
    if (/FROM lm_classes c[\s\S]*WHERE c\.class_id = \$1/i.test(s) || /FROM lm_classes WHERE class_id = \$1/i.test(s)) {
      const cls = classes.find((c) => c.class_id === params[0] && (!params[1] || s.includes('lm_enrollments') || c.tenant_id === params[1]));
      if (!cls) return { rows: [], rowCount: 0 };
      if (/lm_enrollments/i.test(s)) {
        const sid = params[1], tid = params[2];
        if (cls.tenant_id !== tid) return { rows: [], rowCount: 0 };
        const ok = cls.teacher_student_id === sid || enrollments.some((e) => e.class_id === cls.class_id && e.student_id === sid);
        return { rows: ok ? [cls] : [], rowCount: ok ? 1 : 0 };
      }
      return { rows: [cls], rowCount: 1 };
    }
    if (/FROM lm_enrollments WHERE student_id = \$1 AND class_id = \$2/i.test(s) || /FROM lm_enrollments WHERE class_id = \$1 AND student_id = \$2/i.test(s)) {
      const ok = enrollments.some((e) => (e.student_id === params[0] && e.class_id === params[1]) || (e.class_id === params[0] && e.student_id === params[1]));
      return { rows: ok ? [{ ok: 1 }] : [], rowCount: ok ? 1 : 0 };
    }
    if (/SELECT m\.rag_collection FROM lm_materials m/i.test(s)) {
      const [cid, sid, tid] = params;
      const cls = classes.find((c) => c.class_id === cid && c.tenant_id === tid);
      if (!cls) return { rows: [], rowCount: 0 };
      const rows = state.materials.filter((m) => m.class_id === cid && (m.uploaded_by === sid || m.share_status === 'approved'));
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO lm_tutor_threads/i.test(s)) {
      if (state.failPersist) throw new Error('simulated database write failure');
      const [thread_id, student_id, tenant_id, class_id, title, first_question] = params;
      const now = new Date(Date.now() + state.threads.length * 1000).toISOString();
      const existing = state.threads.find((t) => t.thread_id === thread_id);
      if (existing) existing.updated_at = now;
      else state.threads.push({ thread_id, tenant_id, student_id, class_id, title, first_question, created_at: now, updated_at: now });
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE lm_tutor_threads SET updated_at/i.test(s)) {
      if (state.failPersist) throw new Error('simulated database write failure');
      const hit = state.threads.find((t) => t.thread_id === params[0] && t.student_id === params[1] && t.tenant_id === params[2]);
      if (hit) hit.updated_at = new Date().toISOString();
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (/INSERT INTO lm_tutor_messages/i.test(s)) {
      if (state.failPersist) throw new Error('simulated database write failure');
      const [, thread_id, student_id, tenant_id, turn_index] = params;
      const isAssistant = /'assistant'/i.test(s);
      const role = isAssistant ? 'assistant' : 'user';
      const content = params[5];
      const sources = isAssistant ? params[6] : '[]';
      state.messages.push({ thread_id, tenant_id, student_id, turn_index, role, content, sources, created_at: new Date().toISOString() });
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT thread_id, class_id, title, first_question, created_at, updated_at FROM lm_tutor_threads/i.test(s)) {
      const [sid, tid, cid] = params;
      const rows = state.threads
        .filter((t) => t.student_id === sid && t.tenant_id === tid && (!cid || t.class_id === cid))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return { rows, rowCount: rows.length };
    }
    if (/SELECT thread_id, student_id, class_id, title, first_question, created_at, updated_at FROM lm_tutor_threads WHERE thread_id = \$1 AND tenant_id = \$2/i.test(s)) {
      const hit = state.threads.find((t) => t.thread_id === params[0] && t.tenant_id === params[1]);
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (/FROM lm_tutor_threads WHERE thread_id = \$1 AND student_id = \$2 AND tenant_id = \$3/i.test(s)) {
      if (/^DELETE/i.test(s)) {
        const idx = state.threads.findIndex((t) => t.thread_id === params[0] && t.student_id === params[1] && t.tenant_id === params[2]);
        if (idx < 0) return { rows: [], rowCount: 0 };
        const [removed] = state.threads.splice(idx, 1);
        return { rows: [{ thread_id: removed.thread_id }], rowCount: 1 };
      }
      const hit = state.threads.find((t) => t.thread_id === params[0] && t.student_id === params[1] && t.tenant_id === params[2]);
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (/DELETE FROM lm_tutor_messages/i.test(s)) {
      state.messages = state.messages.filter((m) => !(m.thread_id === params[0] && m.student_id === params[1] && m.tenant_id === params[2]));
      return { rows: [], rowCount: 1 };
    }
    if (/FROM lm_tutor_messages WHERE thread_id = \$1/i.test(s)) {
      const rows = state.messages
        .filter((m) => m.thread_id === params[0] && (!params[1] || m.tenant_id === params[1]))
        .sort((a, b) => a.turn_index - b.turn_index);
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }

  const pool = { query, connect: async () => ({ query, release() {} }) };
  const stubs = {
    express,
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/features/swarm-orchestration/services/prompt-containment': {
      wrapUntrustedPromptContent: (tag, text, limit) => `<${tag}>${String(text || '').slice(0, limit)}</${tag}>`,
    },
    '@/features/rag': {
      RagService: class {
        async deleteCollection() {}
        async search(_q, col) { return state.ragHits[col] || []; }
      },
    },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async (_ctx, _client, agentId, params) => {
        state.botCalls.push({ agentId, params });
        return state.botImpl(params);
      },
    },
    '@anthropic-ai/sdk': class {
      constructor() {
        this.messages = {
          create: async (payload) => {
            state.visionCalls.push(payload);
            const text = await state.visionImpl(payload);
            return { content: [{ type: 'text', text }] };
          },
        };
      }
    },
  };

  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request === './education-progress' && parent && parent.filename && parent.filename.includes('education-tutor-routes')) {
      return {
        awardXP: async (_ctx, studentId, action, meta, dedupeKey) => {
          const duplicate = state.xpCalls.some((x) => x.studentId === studentId && x.dedupeKey === dedupeKey);
          state.xpCalls.push({ studentId, action, meta, dedupeKey, duplicate });
          return { awarded: !duplicate };
        },
      };
    }
    if (request === './education-access' && parent && parent.filename && parent.filename.includes('little-monsters')) {
      const realAccess = origLoad.call(this, path.join(PKG, 'routes', 'education-access.js'), parent, isMain);
      return {
        ...realAccess,
        resolveAuthedStudent: async (req) => {
          const sub = req.oidc?.user?.sub;
          const actor = actors[sub];
          if (!actor) throw new realAccess.EducationAccessError('Not authenticated', 401);
          return { studentId: actor.student_id, tenantId: actor.tenant_id, role: actor.role, name: actor.name };
        },
        assertClassAccess: async (_pool, student, classId) => {
          const cls = classes.find((c) => c.class_id === classId);
          if (!cls || cls.tenant_id !== student.tenantId) {
            throw new realAccess.EducationAccessError('You do not have access to this class', 403);
          }
          const ok = student.role === 'admin'
            || (student.role === 'teacher' && cls.teacher_student_id === student.studentId)
            || enrollments.some((en) => en.class_id === classId && en.student_id === student.studentId);
          if (!ok) throw new realAccess.EducationAccessError('You do not have access to this class', 403);
        },
      };
    }
    return origLoad.call(this, request, parent, isMain);
  };

  for (const mod of ['routes/education-tutor-routes.js', 'routes/education-tutor-history.js']) {
    delete require.cache[path.join(PKG, mod)];
  }
  let router;
  try {
    const { createEducationTutorRoutes } = require(path.join(PKG, 'routes', 'education-tutor-routes.js'));
    router = createEducationTutorRoutes({ pool });
  } finally {
    Module._load = origLoad;
  }

  async function post(sub, body) {
    Module._load = function runtimePatched(request, parent, isMain) {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      return origLoad.call(this, request, parent, isMain);
    };
    try {
      const app = express();
      app.use(express.json({ limit: '10mb' }));
      app.use((req, _res, next) => { if (sub) req.oidc = { user: { sub } }; next(); });
      app.use('/api/education', router);
      const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
      try {
        const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/education/tutor-chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.json().catch(() => ({})) };
      } finally {
        srv.close();
      }
    } finally {
      Module._load = origLoad;
    }
  }

  return { state, router, stubs, origLoad, post };
}

test('compiled tutor route: model refusal, empty answer, and persistence failure never award XP or mint completion receipts', async () => {
  const refused = createTutorHarness({
    botImpl: async () => { throw Object.assign(new Error('You cannot choose that model; use Automatic'), { status: 403 }); },
  });
  const r1 = await refused.post('sub-student-a', { message: 'Explain mitosis', classId: CLASS_BIO });
  assert.ok(r1.status >= 400, `expected refusal status >= 400, got ${r1.status}: ${JSON.stringify(r1.body)}`);
  assert.equal(refused.state.threads.length, 0, 'refused model turn must write zero threads');
  assert.equal(refused.state.messages.length, 0, 'refused model turn must write zero messages');
  assert.equal(refused.state.xpCalls.length, 0, 'refused model turn must award zero XP');
  assert.equal(Boolean(r1.body.grounded), false, 'refused model turn must not return grounded:true');

  const empty = createTutorHarness({ botImpl: async () => ({ response: '   ' }) });
  const r2 = await empty.post('sub-student-a', { message: 'Explain mitosis', classId: CLASS_BIO });
  assert.ok(r2.status >= 500, `expected empty model turn to fail >= 500, got ${r2.status}`);
  assert.equal(empty.state.threads.length, 0, 'empty model turn must write zero threads');
  assert.equal(empty.state.xpCalls.length, 0, 'empty model turn must award zero XP');

  const persistFail = createTutorHarness({ failPersist: true });
  const r3 = await persistFail.post('sub-student-a', {
    message: 'Continue thread', classId: CLASS_BIO,
  });
  assert.ok(r3.status >= 500, `expected persistence failure >= 500, got ${r3.status}`);
  assert.equal(persistFail.state.xpCalls.length, 0, 'unpersisted turn must award zero XP');
  assert.equal(r3.body.threadId, undefined, 'unpersisted turn must not return a fake saved threadId');
});

test('compiled tutor route: validates optional choice:{provider,model} strictly and preserves 5-minute server XP dedupe', async () => {
  const h = createTutorHarness();
  for (const bad of [
    null,
    'picked/model',
    {},
    { provider: 'picked' },
    { provider: 'picked', model: '' },
    { provider: 'picked', model: 'm', extra: true },
    { provider: 'picked\n', model: 'm' },
    { provider: 'p'.repeat(513), model: 'm' },
  ]) {
    const res = await h.post('sub-student-a', { message: 'Hello', classId: CLASS_BIO, choice: bad });
    assert.equal(res.status, 400, `malformed choice ${JSON.stringify(bad)} must return 400`);
  }
  assert.equal(h.state.botCalls.length, 0, 'malformed choice must fail before model execution');
  assert.equal(h.state.xpCalls.length, 0, 'malformed choice must award zero XP');

  const autoRes = await h.post('sub-student-a', { message: 'First question', classId: CLASS_BIO });
  assert.equal(autoRes.status, 200);
  assert.equal('choice' in h.state.botCalls[0].params, false, 'omitted choice means Automatic');
  assert.equal(autoRes.body.grounded, true);
  assert.ok(autoRes.body.threadId, 'completed turn returns server UUID threadId');

  const pickedRes = await h.post('sub-student-a', {
    message: 'Follow-up question',
    classId: CLASS_BIO,
    threadId: autoRes.body.threadId,
    choice: { provider: 'picked', model: 'picked-model' },
  });
  assert.equal(pickedRes.status, 200);
  assert.deepEqual(h.state.botCalls[1].params.choice, { provider: 'picked', model: 'picked-model' });
  assert.equal(h.state.xpCalls.length, 2);
  assert.equal(h.state.xpCalls[0].dedupeKey, h.state.xpCalls[1].dedupeKey, 'same 5-minute XP bucket deduplicates');
});

test('compiled tutor route: separates images, text/unreadable documents, and retained PDF path without PDF-as-picture', async () => {
  const h = createTutorHarness();
  const docRes = await h.post('sub-student-a', {
    message: 'Help me study these files',
    classId: CLASS_CHEM,
    documents: [
      { name: 'notes.txt', text: 'Avogadro constant is 6.022e23.' },
      { name: 'scanned-diagram.pdf', unreadable: true, reason: 'PDF contains no extractable text' },
    ],
  });
  assert.equal(docRes.status, 200);
  const sentPrompt = h.state.botCalls[0].params.text;
  assert.match(sentPrompt, /Avogadro constant is 6\.022e23/);
  assert.match(sentPrompt, /scanned-diagram\.pdf[\s\S]*no extractable text/);
  assert.equal('images' in h.state.botCalls[0].params, false, 'text/unreadable docs never travel as pictures');

  const imgRes = await h.post('sub-student-a', {
    message: 'Check step 1 of my photo',
    classId: CLASS_CHEM,
    images: [{ kind: 'image/png', base64: TINY_PNG_B64 }],
    choice: { provider: 'picked', model: 'picked-vision' },
  });
  assert.equal(imgRes.status, 200);
  assert.deepEqual(h.state.botCalls[1].params.images, [{ kind: 'image/png', base64: TINY_PNG_B64 }]);
  assert.deepEqual(h.state.botCalls[1].params.choice, { provider: 'picked', model: 'picked-vision' });

  const pdfAsPic = await h.post('sub-student-a', {
    message: 'Bad pdf image',
    images: [{ kind: 'application/pdf', base64: TINY_PNG_B64 }],
  });
  assert.equal(pdfAsPic.status, 400, 'PDF must never be accepted in images[]');

  const priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-pdf-key';
  try {
    const pdfRes = await h.post('sub-student-a', {
      message: 'Help with this PDF worksheet',
      imageData: Buffer.from('%PDF-1.4 test').toString('base64'),
      imageMediaType: 'application/pdf',
    });
    assert.equal(pdfRes.status, 200, 'legacy base64 PDF route remains intact');
    assert.equal(h.state.visionCalls.length, 1);
  } finally {
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  }
});

test('compiled tutor route: enforces material revocation immediately and preserves teacher-visibility policy', async () => {
  const h = createTutorHarness({ teacherVisible: false });
  const r1 = await h.post('sub-student-a', { message: 'What is mitosis?', classId: CLASS_BIO });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.grounded, true);
  assert.equal(r1.body.sources.length, 1);

  h.state.materials[0].share_status = 'private';
  const r2 = await h.post('sub-student-a', { message: 'What else about mitosis?', classId: CLASS_BIO });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.grounded, false, 'revoked material is excluded on the very next turn');
  assert.deepEqual(r2.body.sources, []);

  const denyTeacher = await h.post('sub-teacher-a1', { action: 'list', studentId: STUDENT_A, classId: CLASS_BIO });
  assert.equal(denyTeacher.status, 403, 'teacher visibility off denies teacher');

  h.state.teacherVisible = true;
  const allowTeacher = await h.post('sub-teacher-a1', { action: 'list', studentId: STUDENT_A, classId: CLASS_BIO });
  assert.equal(allowTeacher.status, 200);
  assert.equal(allowTeacher.body.threads.length, 2);

  const otherClassTeacher = await h.post('sub-teacher-a2', { action: 'list', studentId: STUDENT_A, classId: CLASS_BIO });
  assert.equal(otherClassTeacher.status, 403, 'teacher of another class stays denied');

  const crossTenant = await h.post('sub-student-b', { action: 'get', threadId: r1.body.threadId });
  assert.equal(crossTenant.status, 404, 'foreign tenant cannot read student thread');
});

test('shared iframe (412x915 touch + 1440x900 desktop): preserves classroom design, isolates concurrent class tabs, owns UUID history, and keeps non-adapter concierges intact', async () => {
  const helperUrl = pathToFileURL(path.join(STORE, 'scripts', 'one-chat-window', 'kernel-window.mjs')).href;
  const { kernelPlatform, mountWindow, windowKernel, chatWindow, windowControls, pickModel } = await import(helperUrl);
  const platform = kernelPlatform(path.resolve(STORE, '..', 'oshal-kernel', 'platform'));

  let holdBio = null;
  let failDeleteOnce = false;
  let visionDescribeCalls = 0;
  const h = createTutorHarness({
    botImpl: async (params) => {
      if (/HOLD_BIO/.test(params.text) && holdBio) await holdBio.promise;
      return { response: '| Phase | Action |\n| --- | --- |\n| Prophase | Condense |\n\nWhat comes next?' };
    },
  });

  const origLoad = h.origLoad;
  Module._load = function browserPatched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(h.stubs, request)) return h.stubs[request];
    return origLoad.call(this, request, parent, isMain);
  };

  const app = express();
  const kernel = windowKernel({ answer: (ask) => `Standard concierge reply to: ${ask.message}` });
  app.use(express.json({ limit: '10mb' }));
  app.post('/api/vision/describe', (_req, res) => { visionDescribeCalls += 1; res.json({ description: 'described' }); });
  app.post('/api/vision/read-doc', (req, res) => {
    const name = String(req.body?.name || '');
    if (/scan/i.test(name)) return res.status(422).json({ ok: false, reason: 'PDF contains no extractable text' });
    return res.json({ ok: true, text: 'Extracted chapter summary from PDF.' });
  });
  mountWindow(app, { platform, kernel });

  app.get('/api/education/tutor', (_req, res) => res.sendFile(path.join(TOOLS, 'tutor-chat.html')));

  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/education/lm-voice.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-voice.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [
    { id: 'tool-lm-dashboard', label: 'Class dashboard', toolUi: { iframeUrl: '/api/education/dashboard' } },
    { id: 'tool-lm-tutor', label: 'Tutor', toolUi: { iframeUrl: '/api/education/tutor' } }] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella Student', role: 'student' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 40, level: 1 }));
  app.get('/api/education/classes', (_req, res) => res.json({ classes: [
    { class_id: CLASS_BIO, name: 'Biology', subject: 'Science' },
    { class_id: CLASS_CHEM, name: 'Chemistry', subject: 'Chemistry' },
  ] }));
  app.get('/api/education/classes/:id/materials', (_req, res) => res.json({ materials: [] }));
  app.get('/api/education/classes/:id/shared-materials', (req, res) => res.json({
    materials: req.params.id === CLASS_BIO ? [{ material_id: MAT_BIO, title: 'Biology 2e' }] : [],
  }));
  app.use('/api/education', (req, res, next) => {
    if (req.path === '/tutor-chat' && req.method === 'POST' && req.body?.action === 'delete' && failDeleteOnce) {
      failDeleteOnce = false;
      return res.status(500).json({ error: 'Temporary delete failure' });
    }
    req.oidc = { user: { sub: 'sub-student-a' } };
    return next();
  }, h.router);
  app.get('/other-app', (_req, res) => res.type('html').send(`<!doctype html><div id="host" style="height:600px"></div>
    <script type="module">
      import { mountJarvisChat } from '/shared/ui/js/jarvis-chat-frame.js';
      window.__refreshed = [];
      mountJarvisChat(document.getElementById('host'), {
        app: 'hello-oshal', bot: 'oshal-assistant', title: 'Hello Assistant', closable: false,
        chatHost: { prepare: async () => ({ screen_state: { title: 'Hello' } }), refresh: (snap, out) => window.__refreshed.push({ snap, out }) },
      });
    </script>`));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js|png)$/.test(req.path)
    ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));

  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    // 1. Phone (412x915 touch) Tab A on Biology + Desktop (1440x900) Tab B on Chemistry
    const tabA = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const tabB = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await tabA.goto(`${base}/api/education/tutor?classId=${CLASS_BIO}`);
    await tabB.goto(`${base}/api/education/tutor?classId=${CLASS_CHEM}`);
    await tabA.locator('#groundBadge').waitFor();
    await tabB.locator('#groundBadge').waitFor();
    assert.equal(await tabA.textContent('#groundBadge'), 'Textbook grounded');
    assert.equal(await tabB.textContent('#groundBadge'), 'No class materials yet');
    assert.equal(await tabA.getAttribute('body', 'data-lm-assistant'), 'self');

    const chatA = await chatWindow(tabA, '#tutorChatWindow iframe.jarvis-chat-frame');
    const chatB = await chatWindow(tabB, '#tutorChatWindow iframe.jarvis-chat-frame');
    await windowControls(chatA);
    await windowControls(chatB);

    // Hold Tab A's turn in flight while Tab B completes a turn in Chemistry
    let releaseBio;
    holdBio = { promise: new Promise((r) => { releaseBio = r; }) };
    await chatA.locator('.jc-composer #typein').fill('HOLD_BIO prophase question');
    await chatA.locator('.jc-composer button[type="submit"], .jc-composer #sendBtn').first().tap();

    await pickModel(chatB, (loc) => loc.click(), 'picked');
    await chatB.locator('.jc-composer #typein').fill('Chemistry moles question');
    await chatB.locator('.jc-composer button[type="submit"], .jc-composer #sendBtn').first().click();
    await chatB.locator('#convo .msg.bot table').waitFor();
    assert.equal(await tabB.locator('#groundingNotice').isVisible(), false, 'ungrounded Chemistry tab shows no textbook badge');

    releaseBio();
    holdBio = null;
    await chatA.locator('#convo .msg.bot table').waitFor();
    await tabA.locator('#groundingNotice:not(.hide)').waitFor();
    assert.match(await tabA.textContent('#groundingNotice'), /Grounded in your class textbook/);
    assert.equal(kernel.asks.length, 0, 'tutor turns go through authoritative POST /api/education/tutor-chat, never /api/swarm/bots/ask');

    // AbortController Stop in Tab A: aborts in-flight turn, restores draft, clears grounding badge, and awards zero extra XP
    let releaseStopped;
    const xpBeforeStop = h.state.xpCalls.length;
    holdBio = { promise: new Promise((r) => { releaseStopped = r; }) };
    await chatA.locator('.jc-composer #typein').fill('HOLD_BIO stop this turn');
    await chatA.locator('.jc-composer button[type="submit"], .jc-composer #sendBtn').first().tap();
    await chatA.locator('.turn-stop').last().waitFor({ state: 'visible' });
    await chatA.locator('.turn-stop').last().tap();
    await chatA.locator('#convo .msg.bot .err', { hasText: 'Stopped at your request.' }).waitFor();
    assert.equal(await chatA.locator('.jc-composer #typein').inputValue(), 'HOLD_BIO stop this turn', 'stopped turn restores typed draft');
    assert.equal(await tabA.locator('#groundingNotice').isVisible(), false, 'stopped turn hides textbook grounding notice');
    releaseStopped();
    holdBio = null;
    assert.equal(h.state.xpCalls.length, xpBeforeStop, 'aborted/stopped turn does not award XP');

    // Attach PNG image in Tab B: must NOT call /api/vision/describe (no double spend)
    await chatB.locator('#fileInput').setInputFiles({
      name: 'worksheet.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64'),
    });
    await chatB.locator('.jc-composer #typein').fill('Check my worksheet photo');
    await chatB.locator('.jc-composer button[type="submit"], .jc-composer #sendBtn').first().click();
    await tabB.waitForFunction(() => document.querySelector('iframe.jarvis-chat-frame').contentDocument.querySelectorAll('#convo .msg.bot').length >= 2);
    assert.equal(visionDescribeCalls, 0, 'adapter image turn must not double-spend on /api/vision/describe');

    // Open Recent conversations in Tab B: lists Chemistry UUID thread, failed delete keeps row, second delete removes it
    await chatB.locator('.jc-header button[aria-label="Recent conversations"]').click();
    await chatB.locator('#threads .thread-item').first().waitFor();
    failDeleteOnce = true;
    await chatB.locator('#threads .thread-item [data-thread-delete]').first().click();
    assert.equal(await chatB.locator('#threads .thread-item').count(), 1, 'failed server delete retains the thread row');
    await chatB.locator('#threads .thread-item [data-thread-delete]').first().click();
    await chatB.locator('#jarvis-history-empty:not([hidden])').waitFor();

    // Non-adapter concierge page keeps standard bot /ask + refresh(snapshot) intact
    const other = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await other.goto(`${base}/other-app`);
    const otherChat = await chatWindow(other);
    await otherChat.locator('.jc-composer #typein').fill('Check standard concierge');
    await otherChat.locator('.jc-composer button[type="submit"], .jc-composer #sendBtn').first().click();
    await otherChat.locator('#convo .msg.bot .bx', { hasText: 'Standard concierge reply' }).waitFor();
    await other.waitForFunction(() => window.__refreshed.length === 1);
    assert.equal(kernel.asks.length, 1, 'non-adapter concierge still calls /api/swarm/bots/<bot>/ask');
    const refreshed = await other.evaluate(() => window.__refreshed);
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].snap.screen_state.title, 'Hello');
    assert.equal(refreshed[0].out.status, 'completed');
  } finally {
    Module._load = origLoad;
    await browser.close();
    srv.close();
  }
});
