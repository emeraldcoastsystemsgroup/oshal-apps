/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Verify 168-topic curriculum video catalog, lasting-media fallback, and compiled route ownership/isolation for RP-LM-01 through RP-LM-05
 * -----------------------------------------------------------------------------
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');

const origLoad = Module._load;
Module._load = function stubFrameworkModules(name, ...rest) {
  if (name === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (name === '@/features/swarm-orchestration/services/prompt-containment') {
    return {
      wrapUntrustedPromptContent: (source, content) =>
        JSON.stringify({ source, content: String(content ?? '') }),
    };
  }
  return origLoad.call(this, name, ...rest);
};

test.after(() => {
  Module._load = origLoad;
});

test('168/168 curriculum video catalog and manifest match without local path leaks', () => {
  const catalogRaw = fs.readFileSync(path.join(PKG, 'data/test-prep/curriculum-videos.json'), 'utf8');
  const manifestRaw = fs.readFileSync(path.join(PKG, 'tools/prep-media/curriculum-manifest.json'), 'utf8');
  const localPrefix = ['/', 'home', '/'].join('');
  assert.ok(!catalogRaw.includes(localPrefix), 'curriculum-videos.json must not contain developer paths');
  assert.ok(!manifestRaw.includes(localPrefix), 'curriculum-manifest.json must not contain developer paths');

  const catalog = JSON.parse(catalogRaw);
  const manifest = JSON.parse(manifestRaw);
  assert.equal(catalog.topics.length, 168);
  assert.equal(catalog.courses.length, 8);

  let variantCount = 0;
  const seenTopicIds = new Set();
  for (const topic of catalog.topics) {
    assert.match(topic.id, /^[a-z0-9-]+$/);
    assert.ok(!seenTopicIds.has(topic.id), `duplicate topic id ${topic.id}`);
    seenTopicIds.add(topic.id);
    const variants = Object.values(topic.levels || {});
    assert.ok(variants.length >= 1, `topic ${topic.id} must declare at least one level`);
    for (const v of variants) {
      variantCount += 1;
      assert.equal(v.video, `/api/education/prep-media/${v.mediaId}.mp4`);
      assert.equal(v.poster, `/api/education/prep-media/${v.mediaId}.jpg`);
      assert.equal(v.captions, `/api/education/prep-media/${v.mediaId}.vtt`);
      assert.ok(v.seconds >= 20, `${v.mediaId} duration too short`);
      const entry = manifest.lessons[v.mediaId];
      assert.ok(entry, `missing manifest entry for ${v.mediaId}`);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.match(entry.posterSha256, /^[0-9a-f]{64}$/);
      assert.match(entry.captionsSha256, /^[0-9a-f]{64}$/);
    }
  }
  assert.equal(variantCount, 338);
  assert.equal(Object.keys(manifest.lessons).length, 338);
});

test('prep-media handler serves curriculum mp4, poster, and captions from lasting storage', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-curr-media-'));
  try {
    const mediaRoot = path.join(work, 'tools-prep-media');
    const dataRoot = path.join(work, 'pkg-data');
    const prepMedia = path.join(dataRoot, 'prep-media');
    fs.mkdirSync(mediaRoot, { recursive: true });
    fs.mkdirSync(prepMedia, { recursive: true });

    const mp4Bytes = Buffer.from('curriculum-mp4-stream-payload-0123456789');
    const mp4Sha = crypto.createHash('sha256').update(mp4Bytes).digest('hex');
    const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const vttText = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello learners!\n';

    fs.writeFileSync(path.join(mediaRoot, 'manifest.json'), JSON.stringify({ version: '1', lessons: {} }));
    fs.writeFileSync(
      path.join(mediaRoot, 'curriculum-manifest.json'),
      JSON.stringify({ version: '1', lessons: { 'lm-curr-demo': { sha256: mp4Sha } } }),
    );
    fs.writeFileSync(path.join(prepMedia, `lm-curr-demo-${mp4Sha.slice(0, 16)}.mp4`), mp4Bytes);
    fs.writeFileSync(path.join(prepMedia, 'lm-curr-demo.jpg'), jpgBytes);
    fs.writeFileSync(path.join(prepMedia, 'lm-curr-demo.vtt'), vttText);

    const { createPrepMediaHandler } = require(path.join(PKG, 'routes/education-prep-media.js'));
    const handler = createPrepMediaHandler(mediaRoot, { OSHAL_PACKAGE_DATA_DIR: dataRoot });

    let sentRef = null;
    await handler(
      { params: { file: 'lm-curr-demo.mp4' }, headers: {} },
      {
        setHeader() {},
        lastingFile(rel, opts) { sentRef = { rel, opts }; },
      },
    );
    assert.deepEqual(sentRef, {
      rel: `prep-media/lm-curr-demo-${mp4Sha.slice(0, 16)}.mp4`,
      opts: { filename: 'lm-curr-demo.mp4', inline: true },
    });

    const directFiles = [];
    await handler(
      { params: { file: 'lm-curr-demo.vtt' }, headers: {} },
      { sendFile(f, cb) { directFiles.push(f); if (cb) cb(); } },
    );
    await handler(
      { params: { file: 'lm-curr-demo.jpg' }, headers: {} },
      { sendFile(f, cb) { directFiles.push(f); if (cb) cb(); } },
    );
    assert.equal(directFiles[0], path.join(prepMedia, 'lm-curr-demo.vtt'));
    assert.equal(directFiles[1], path.join(prepMedia, 'lm-curr-demo.jpg'));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('RP-LM-03 citation lookup resolves ISBN, DOI, and https HTML while refusing private hosts and bad checksums', async () => {
  const { lookupCitationSource } = require(path.join(PKG, 'routes/education-citation-lookup.js'));
  const fakeFetch = async (url) => {
    if (url.startsWith('https://openlibrary.org/api/books')) {
      return new Response(JSON.stringify({
        'ISBN:9780140328721': {
          title: 'Fantastic Mr. Fox',
          authors: [{ name: 'Roald Dahl' }],
          publishers: [{ name: 'Puffin Books' }],
          publish_date: 'October 1, 1988',
          url: 'https://openlibrary.org/books/OL1M',
        },
      }), { status: 200 });
    }
    if (url.startsWith('https://api.crossref.org/works/')) {
      return new Response(JSON.stringify({
        message: {
          type: 'journal-article',
          title: ['Nanometer-scale thermometry in a living cell'],
          author: [{ family: 'Kucsko', given: 'G.' }],
          'container-title': ['Nature'],
          issued: { 'date-parts': [[2013, 8, 1]] },
          volume: '500',
          issue: '7460',
          page: '54-58',
        },
      }), { status: 200 });
    }
    if (url === 'https://en.wikipedia.org/wiki/Octopus') {
      return new Response(
        '<html><head><meta property="og:site_name" content="Wikipedia"><meta name="author" content="Jane Marine"><meta property="article:published_time" content="2025-04-12"><title>Octopus - Wikipedia</title></head></html>',
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
  };

  const book = await lookupCitationSource('978-0-14-032872-1', fakeFetch);
  assert.equal(book.type, 'book');
  assert.equal(book.author, 'Dahl, Roald');
  assert.equal(book.title, 'Fantastic Mr. Fox');
  assert.equal(book.year, '1988');

  const article = await lookupCitationSource('10.1038/nature12373', fakeFetch);
  assert.equal(article.type, 'journal');
  assert.equal(article.author, 'Kucsko, G.');
  assert.equal(article.source, 'Nature');
  assert.equal(article.volume, '500');

  const web = await lookupCitationSource('https://en.wikipedia.org/wiki/Octopus', fakeFetch);
  assert.equal(web.type, 'website');
  assert.equal(web.author, 'Marine, Jane');
  assert.equal(web.source, 'Wikipedia');
  assert.equal(web.year, '2025');

  await assert.rejects(() => lookupCitationSource('9780140328722', fakeFetch), /checksum|No source found|valid ISBN/i);
  await assert.rejects(() => lookupCitationSource('http://127.0.0.1:8080/secret', fakeFetch), /https:\/\//);
  await assert.rejects(() => lookupCitationSource('https://127.0.0.1/secret', fakeFetch), /private or local/);
  await assert.rejects(() => lookupCitationSource('not-an-identifier', fakeFetch), /No source found|valid ISBN/i);
});

function handleGuardianSql(state, s, params) {
  if (s.startsWith('SELECT xp, level FROM lm_rewards')) return { rows: [{ xp: 240, level: 3 }] };
  if (s.includes('FROM lm_assignments a')) {
    const title = params[1] === '00000000-0000-4000-8000-0000000000a1' ? 'Cell Diagram' : 'Secret Peer Essay';
    return { rows: [{ title, due_date: '2099-05-01T12:00:00Z', status: 'active', class_name: 'Biology 1' }] };
  }
  if (s.includes('FROM lm_quiz_results')) return { rows: [] };
  if (s.includes('FROM lm_flashcard_progress')) return { rows: [{ reviewed_count: 4, latest_at: '2026-11-06T12:00:00Z' }] };
  if (s.startsWith('UPDATE lm_guardian_links SET learner_name = $1')) {
    for (const l of state.guardianLinks) {
      if (l.student_id === params[2] && l.tenant_id === params[3]) {
        l.learner_name = params[0];
        l.summary_snapshot = JSON.parse(params[1]);
      }
    }
    return { rows: [] };
  }
  if (s.includes('FROM lm_guardian_links WHERE student_id = $1 AND tenant_id = $2 AND guardian_email = $3')) {
    return { rows: state.guardianLinks.filter((l) => l.student_id === params[0] && l.tenant_id === params[1] && l.guardian_email === params[2]) };
  }
  if (s.includes('FROM lm_guardian_links WHERE student_id = $1 AND tenant_id = $2 ORDER BY')) {
    return { rows: state.guardianLinks.filter((l) => l.student_id === params[0] && l.tenant_id === params[1]) };
  }
  if (s.includes('FROM lm_guardian_links WHERE tenant_id = $1 AND guardian_email = $2 AND student_id != $3')) {
    return { rows: state.guardianLinks.filter((l) => l.tenant_id === params[0] && l.guardian_email === params[1] && l.student_id !== params[2]) };
  }
  if (s.startsWith('INSERT INTO lm_guardian_links')) {
    state.guardianLinks.push({
      link_id: params[0], student_id: params[1], tenant_id: params[2], learner_name: params[3],
      guardian_email: params[4], cadence: params[5], summary_snapshot: JSON.parse(params[6]),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return { rows: [] };
  }
  if (s.startsWith('UPDATE lm_guardian_links SET cadence = $1')) {
    const hit = state.guardianLinks.find((l) =>
      l.link_id === params[1] &&
      l.tenant_id === params[2] &&
      (l.student_id === params[3] || (params[4] && l.guardian_email === params[4])),
    );
    if (!hit) return { rows: [] };
    hit.cadence = params[0];
    return { rows: [hit] };
  }
  if (s.startsWith('DELETE FROM lm_guardian_links')) {
    const idx = state.guardianLinks.findIndex((l) => l.link_id === params[0] && l.student_id === params[1] && l.tenant_id === params[2]);
    return { rows: idx < 0 ? [] : state.guardianLinks.splice(idx, 1) };
  }
  return null;
}

function handleTutorSql(state, s, params) {
  if (s.startsWith('SELECT 1 FROM lm_classes WHERE class_id = $1 AND teacher_student_id = $2 AND tenant_id = $3')) {
    return { rows: state.classes.filter((c) => c.class_id === params[0] && c.teacher_student_id === params[1] && c.tenant_id === params[2]) };
  }
  if (s.includes('FROM lm_enrollments e JOIN lm_classes c ON c.class_id = e.class_id')) {
    return { rows: state.enrollments.filter((e) => e.student_id === params[0] && e.class_id === params[1] && e.tenant_id === params[2]) };
  }
  if (s.startsWith('SELECT tutor_history_teacher_visible FROM lm_tenants')) {
    return { rows: state.tenants.filter((t) => t.tenant_id === params[0]) };
  }
  if (s.startsWith('SELECT teacher_student_id FROM lm_classes')) {
    return { rows: state.classes.filter((c) => c.class_id === params[0] && c.tenant_id === params[1]) };
  }
  if (s.startsWith('INSERT INTO lm_tutor_threads')) {
    state.tutorThreads.push({
      thread_id: params[0], student_id: params[1], tenant_id: params[2], class_id: params[3],
      title: params[4], first_question: params[5], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return { rows: [] };
  }
  if (s.startsWith('UPDATE lm_tutor_threads SET updated_at')) {
    const hit = state.tutorThreads.find((t) => t.thread_id === params[0] && t.student_id === params[1]);
    if (hit) hit.updated_at = new Date().toISOString();
    return { rows: [] };
  }
  if (s.startsWith('INSERT INTO lm_tutor_messages')) {
    const role = s.includes("'assistant'") ? 'assistant' : 'user';
    state.tutorMessages.push({
      message_id: params[0], thread_id: params[1], student_id: params[2], tenant_id: params[3],
      turn_index: params[4], role, content: params[5], sources: role === 'assistant' ? JSON.parse(params[6]) : [],
      created_at: new Date().toISOString(),
    });
    return { rows: [] };
  }
  if (s.startsWith('SELECT') && s.includes('FROM lm_tutor_threads WHERE student_id = $1 AND tenant_id = $2')) {
    return { rows: state.tutorThreads.filter((t) => t.student_id === params[0] && t.tenant_id === params[1] && (!params[2] || t.class_id === params[2])) };
  }
  if (s.startsWith('SELECT') && s.includes('FROM lm_tutor_threads WHERE thread_id = $1 AND tenant_id = $2')) {
    return { rows: state.tutorThreads.filter((t) => t.thread_id === params[0] && t.tenant_id === params[1]) };
  }
  if (s.startsWith('SELECT') && s.includes('FROM lm_tutor_threads WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3')) {
    return { rows: state.tutorThreads.filter((t) => t.thread_id === params[0] && t.student_id === params[1] && t.tenant_id === params[2]) };
  }
  if (s.startsWith('SELECT') && s.includes('FROM lm_tutor_messages WHERE thread_id = $1')) {
    return { rows: state.tutorMessages.filter((m) => m.thread_id === params[0]).sort((a, b) => a.turn_index - b.turn_index) };
  }
  if (s.startsWith('DELETE FROM lm_tutor_messages')) {
    state.tutorMessages = state.tutorMessages.filter((m) => !(m.thread_id === params[0] && m.student_id === params[1]));
    return { rows: [] };
  }
  if (s.startsWith('DELETE FROM lm_tutor_threads')) {
    const idx = state.tutorThreads.findIndex((t) => t.thread_id === params[0] && t.student_id === params[1] && t.tenant_id === params[2]);
    return { rows: idx < 0 ? [] : state.tutorThreads.splice(idx, 1) };
  }
  return null;
}

function handleStudyAndTimelineSql(state, s, params) {
  if (s.startsWith('SELECT fs.set_id FROM lm_flashcard_sets fs')) {
    const setId = params[0];
    const studentId = params[2];
    const hit = state.flashcardSets.find((fsRow) => fsRow.set_id === setId && (fsRow.owner_student_id === studentId || fsRow.shared));
    return { rows: hit ? [{ set_id: hit.set_id }] : [] };
  }
  if (s.startsWith('SELECT shuffle, prompt_side FROM lm_flashcard_study_prefs')) {
    return { rows: state.flashcardPrefs.filter((p) => p.student_id === params[0] && p.tenant_id === params[1] && p.set_id === params[2]) };
  }
  if (s.startsWith('INSERT INTO lm_flashcard_study_prefs')) {
    const existing = state.flashcardPrefs.find((p) => p.student_id === params[0] && p.set_id === params[2]);
    if (existing) {
      existing.shuffle = params[3];
      existing.prompt_side = params[4];
    } else {
      state.flashcardPrefs.push({ student_id: params[0], tenant_id: params[1], set_id: params[2], shuffle: params[3], prompt_side: params[4] });
    }
    return { rows: [] };
  }
  if (s.includes('FROM lm_timelines WHERE student_id = $1 AND tenant_id = $2')) {
    return { rows: state.timelines.filter((t) => t.student_id === params[0] && t.tenant_id === params[1]) };
  }
  if (s.startsWith('INSERT INTO lm_timelines')) {
    const row = { timeline_id: params[0], student_id: params[1], tenant_id: params[2], title: params[3], events: JSON.parse(params[4]), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    state.timelines.push(row);
    return { rows: [row] };
  }
  if (s.startsWith('UPDATE lm_timelines SET title = $1')) {
    const hit = state.timelines.find((t) => t.timeline_id === params[1] && t.student_id === params[2] && t.tenant_id === params[3]);
    if (!hit) return { rows: [] };
    hit.title = params[0];
    return { rows: [hit] };
  }
  if (s.startsWith('UPDATE lm_timelines SET events = $1')) {
    const hit = state.timelines.find((t) => t.timeline_id === params[1] && t.student_id === params[2] && t.tenant_id === params[3]);
    if (!hit) return { rows: [] };
    hit.events = JSON.parse(params[0]);
    return { rows: [hit] };
  }
  if (s.startsWith('DELETE FROM lm_timelines')) {
    const idx = state.timelines.findIndex((t) => t.timeline_id === params[0] && t.student_id === params[1] && t.tenant_id === params[2]);
    return { rows: idx < 0 ? [] : state.timelines.splice(idx, 1) };
  }
  return null;
}

function createInMemorySchoolPool() {
  const tenantId = '00000000-0000-4000-8000-00000000d001';
  const classId = '00000000-0000-4000-8000-000000000101';
  const state = {
    tenants: [{ tenant_id: tenantId, tutor_history_teacher_visible: false }],
    students: [
      { student_id: '00000000-0000-4000-8000-0000000000a1', tenant_id: tenantId, name: 'Leo Learner', email: 'leo@school.org', role: 'student', external_issuer: 'https://issuer.test', external_id: 'sub-leo' },
      { student_id: '00000000-0000-4000-8000-0000000000a2', tenant_id: tenantId, name: 'Maya Peer', email: 'maya@school.org', role: 'student', external_issuer: 'https://issuer.test', external_id: 'sub-maya' },
      { student_id: '00000000-0000-4000-8000-0000000000b1', tenant_id: tenantId, name: 'Pat Parent', email: 'parent@family.org', role: 'student', external_issuer: 'https://issuer.test', external_id: 'sub-parent' },
      { student_id: '00000000-0000-4000-8000-0000000000c1', tenant_id: tenantId, name: 'Ms. Rivera', email: 'rivera@school.org', role: 'teacher', external_issuer: 'https://issuer.test', external_id: 'sub-teacher' },
    ],
    classes: [{ class_id: classId, tenant_id: tenantId, teacher_student_id: '00000000-0000-4000-8000-0000000000c1', name: 'Biology 1', published: true, status: 'active' }],
    enrollments: [
      { student_id: '00000000-0000-4000-8000-0000000000a1', class_id: classId, tenant_id: tenantId },
      { student_id: '00000000-0000-4000-8000-0000000000a2', class_id: classId, tenant_id: tenantId },
    ],
    flashcardSets: [
      { set_id: '00000000-0000-4000-8000-000000000501', shared: true, owner_student_id: null },
      { set_id: '00000000-0000-4000-8000-000000000502', shared: false, owner_student_id: '00000000-0000-4000-8000-0000000000a1' },
    ],
    flashcardPrefs: [],
    guardianLinks: [],
    tutorThreads: [],
    tutorMessages: [],
    timelines: [],
  };
  const query = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('FROM lm_students WHERE external_issuer = $1 AND external_id = $2')) {
      return { rows: state.students.filter((u) => u.external_issuer === params[0] && u.external_id === params[1]) };
    }
    if (s.startsWith('SELECT name FROM lm_students WHERE student_id = $1 AND tenant_id = $2')) {
      return { rows: state.students.filter((u) => u.student_id === params[0] && u.tenant_id === params[1]) };
    }
    const res = handleGuardianSql(state, s, params) || handleTutorSql(state, s, params) || handleStudyAndTimelineSql(state, s, params);
    if (res) return res;
    throw new Error(`Unhandled SQL in test pool: ${s}`);
  };
  return { state, query };
}

function mockRes() {
  return {
    code: 200,
    payload: null,
    status(c) { this.code = c; return this; },
    json(p) { this.payload = p; return this; },
  };
}

function authedReq(sub, email, body = {}) {
  return {
    method: 'POST',
    oidc: {
      isAuthenticated: () => true,
      user: { iss: 'https://issuer.test', sub, email, email_verified: true },
    },
    body,
  };
}

test('RP-LM-01 guardian summary enforces single-learner visibility, cadence changes, and link removal', async () => {
  const pool = createInMemorySchoolPool();
  const { getGuardianSummaryPayload, handleGuardianMutation } = require(path.join(PKG, 'routes/education-guardian-service.js'));

  const inviteRes = mockRes();
  await handleGuardianMutation(pool, authedReq('sub-leo', 'leo@school.org', {
    guardianAction: 'invite',
    guardianEmail: 'parent@family.org',
    cadence: 'weekly',
  }), inviteRes);
  assert.equal(inviteRes.code, 201);
  const linkId = inviteRes.payload.linkId;

  const parentView = mockRes();
  await getGuardianSummaryPayload(pool, authedReq('sub-parent', 'parent@family.org'), parentView);
  assert.equal(parentView.code, 200);
  assert.equal(parentView.payload.linkedLearners.length, 1);
  assert.equal(parentView.payload.linkedLearners[0].summary.learnerName, 'Leo Learner');
  assert.equal(parentView.payload.linkedLearners[0].summary.due[0].title, 'Cell Diagram');
  assert.ok(!JSON.stringify(parentView.payload.linkedLearners).includes('Maya Peer'));
  assert.ok(!JSON.stringify(parentView.payload.linkedLearners).includes('Secret Peer Essay'));

  const cadenceRes = mockRes();
  await handleGuardianMutation(pool, authedReq('sub-parent', 'parent@family.org', {
    guardianAction: 'cadence',
    linkId,
    cadence: 'daily',
  }), cadenceRes);
  assert.equal(cadenceRes.code, 200);
  assert.equal(cadenceRes.payload.cadence, 'daily');

  const removeRes = mockRes();
  await handleGuardianMutation(pool, authedReq('sub-leo', 'leo@school.org', {
    guardianAction: 'remove',
    linkId,
  }), removeRes);
  assert.equal(removeRes.code, 200);

  const afterRemove = mockRes();
  await getGuardianSummaryPayload(pool, authedReq('sub-parent', 'parent@family.org'), afterRemove);
  assert.equal(afterRemove.payload.linkedLearners.length, 0);
});

test('RP-LM-02 tutor history saves turns, restores threads, and refuses teacher reads unless policy allows', async () => {
  const pool = createInMemorySchoolPool();
  const {
    recordTutorTurn,
    listTutorThreads,
    getTutorThread,
    deleteTutorThread,
  } = require(path.join(PKG, 'routes/education-tutor-history.js'));

  const leo = { studentId: '00000000-0000-4000-8000-0000000000a1', tenantId: '00000000-0000-4000-8000-00000000d001', name: 'Leo', email: 'leo@school.org', role: 'student' };
  const teacher = { studentId: '00000000-0000-4000-8000-0000000000c1', tenantId: '00000000-0000-4000-8000-00000000d001', name: 'Ms. Rivera', email: 'rivera@school.org', role: 'teacher' };
  const classId = '00000000-0000-4000-8000-000000000101';

  const threadId = await recordTutorTurn(pool, leo, {
    threadId: null,
    nextIndex: 0,
    classId,
    question: 'Why do plant cells have a cell wall?',
    response: 'Think about how a plant stands upright without bones. What role might a rigid outer wall play?',
    sources: [{ n: 1, text: 'Chapter 4: Plant cell walls' }],
  });

  const listed = await listTutorThreads(pool, leo, { action: 'list', classId });
  assert.equal(listed.threads.length, 1);
  assert.equal(listed.threads[0].threadId, threadId);

  const restored = await getTutorThread(pool, leo, { action: 'get', threadId });
  assert.equal(restored.thread.messages.length, 2);
  assert.equal(restored.thread.messages[0].role, 'user');
  assert.equal(restored.thread.messages[1].role, 'assistant');

  await assert.rejects(
    () => listTutorThreads(pool, teacher, { action: 'list', studentId: leo.studentId, classId }),
    /School policy keeps student tutoring threads private/,
  );

  pool.state.tenants[0].tutor_history_teacher_visible = true;
  const allowedList = await listTutorThreads(pool, teacher, { action: 'list', studentId: leo.studentId, classId });
  assert.equal(allowedList.threads.length, 1);

  await deleteTutorThread(pool, leo, { action: 'delete', threadId });
  const empty = await listTutorThreads(pool, leo, { action: 'list', classId });
  assert.equal(empty.threads.length, 0);
});

test('RP-LM-04 flashcard study preferences persist per learner and per set without leaking to peers', async () => {
  const pool = createInMemorySchoolPool();
  const { getStudySetPreferences, saveStudySetPreferences } = require(path.join(PKG, 'routes/education-study-store.js'));
  const leo = { studentId: '00000000-0000-4000-8000-0000000000a1', tenantId: '00000000-0000-4000-8000-00000000d001', name: 'Leo', email: 'leo@school.org', role: 'student' };
  const maya = { studentId: '00000000-0000-4000-8000-0000000000a2', tenantId: '00000000-0000-4000-8000-00000000d001', name: 'Maya', email: 'maya@school.org', role: 'student' };
  const sharedSet = '00000000-0000-4000-8000-000000000501';
  const privateLeoSet = '00000000-0000-4000-8000-000000000502';

  const defaults = await getStudySetPreferences(pool, leo, sharedSet);
  assert.deepEqual(defaults, { shuffle: false, promptSide: 'term' });

  const saved = await saveStudySetPreferences(pool, leo, sharedSet, { shuffle: true, promptSide: 'definition' });
  assert.deepEqual(saved, { shuffle: true, promptSide: 'definition' });

  const leoReloaded = await getStudySetPreferences(pool, leo, sharedSet);
  assert.deepEqual(leoReloaded, { shuffle: true, promptSide: 'definition' });

  const mayaPrefs = await getStudySetPreferences(pool, maya, sharedSet);
  assert.deepEqual(mayaPrefs, { shuffle: false, promptSide: 'term' });

  await assert.rejects(
    () => saveStudySetPreferences(pool, maya, privateLeoSet, { shuffle: true, promptSide: 'term' }),
    /not found/i,
  );
});

test('RP-LM-05 named timelines import once, rename, sync events, and isolate per student', async () => {
  const pool = createInMemorySchoolPool();
  const { listStudentTimelines, handleTimelineMutation } = require(path.join(PKG, 'routes/education-timelines-service.js'));

  const firstImport = mockRes();
  await handleTimelineMutation(pool, authedReq('sub-leo', 'leo@school.org', {
    timelineAction: 'import',
    title: 'World History',
    events: [{ id: 'e1', date: '1776', sortKey: 17760101, title: 'Declaration signed', note: 'Philadelphia' }],
  }), firstImport);
  assert.equal(firstImport.payload.imported, true);
  const tlId = firstImport.payload.timeline.timelineId;

  const secondImport = mockRes();
  await handleTimelineMutation(pool, authedReq('sub-leo', 'leo@school.org', {
    timelineAction: 'import',
    title: 'Duplicate Import',
    events: [],
  }), secondImport);
  assert.equal(secondImport.payload.imported, false);

  const peerAttempt = mockRes();
  await handleTimelineMutation(pool, authedReq('sub-maya', 'maya@school.org', {
    timelineAction: 'rename',
    timelineId: tlId,
    title: 'Hijacked',
  }), peerAttempt);
  assert.equal(peerAttempt.code, 404);

  const renameRes = mockRes();
  await handleTimelineMutation(pool, authedReq('sub-leo', 'leo@school.org', {
    timelineAction: 'rename',
    timelineId: tlId,
    title: 'US History',
  }), renameRes);
  assert.equal(renameRes.code, 200);
  assert.equal(renameRes.payload.timeline.title, 'US History');

  const leoList = mockRes();
  await listStudentTimelines(pool, authedReq('sub-leo', 'leo@school.org'), leoList);
  assert.equal(leoList.payload.timelines.length, 1);
  assert.equal(leoList.payload.timelines[0].events.length, 1);
});

test('storage/relationships.json covers all 5 reference tables within policy table bounds', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(PKG, 'storage/relationships.json'), 'utf8'));
  const names = Object.keys(rel.tables);
  assert.ok(names.length <= 48, `table count ${names.length} exceeds kernel bound 48`);
  for (const required of [
    'lm_guardian_links',
    'lm_tutor_threads',
    'lm_tutor_messages',
    'lm_flashcard_study_prefs',
    'lm_timelines',
  ]) {
    assert.ok(rel.tables[required], `missing relationship policy for ${required}`);
    assert.ok(typeof rel.tables[required].read === 'string' && rel.tables[required].read.length > 0);
  }
});
