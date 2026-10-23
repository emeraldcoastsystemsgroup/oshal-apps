/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Book chapters for "flashcards and a lesson summary from chapter 2 of my math book": the chapter finder (an upper-case numbered heading after a contents page, "Chapter 2" with its title on the next line, running page headers ignored, numbered sections when there are no headings, not found with the chapters a book has) and the book routes' read rule (the uploader always; anyone else an approved share in a class they belong to; another school's book is not found). The access and storage modules are scoped doubles; the live check reads real books through the kernel as a student.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A stored text book extracts again: its stored type "text/plain; charset=utf-8" classified as octet-stream and every chapter read live answered not found.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A chapter longer than the budget carries a share of every section (the outline's one-line entries are not the sections), so a lesson summary covers the whole chapter, not part of 2.1.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free node:test over the compiled routes.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const { findChapter, chapterHeadings } = require(path.join(PKG, 'routes', 'education-book-chapters.js'));

const PREALGEBRA = [
  'Contents', '1   Whole Numbers 1', '     1.1 Introduction to Whole Numbers 1', '2   The Language of Algebra 95',
  '     2.1 Use the Language of Algebra 95', '3   Integers 171', '', 'Preface', 'This book...', '',
  ' 1                           WHOLE NUMBERS', 'Counting is old.', '',
  ' 2                           THE LANGUAGE OF ALGEBRA', 'Figure 2.1 Algebra has a language of its own.',
  '2.1 Use the Language of Algebra', 'A variable is a letter that represents a number.', '',
  ' 3                           INTEGERS', 'Integers are whole numbers and their opposites.',
].join('\n');
const STATISTICS = [
  '4   TABLE OF CONTENTS', 'Chapter 1', 'Introduction to data', 'Data are everywhere.',
  '44 CHAPTER 2. SUMMARIZING DATA', 'Chapter 2', 'Summarizing data', '2.1 Examining numerical data', 'A histogram bins values.',
  'Chapter 3', 'Probability', 'Chance.',
].join('\n');

test('the chapter after the contents page is found, not its contents line', () => {
  const found = findChapter(PREALGEBRA, 2);
  assert.equal(found.found, true);
  assert.equal(found.heading, 'Chapter 2: The Language Of Algebra');
  assert.match(found.text, /^2 THE LANGUAGE OF ALGEBRA/);
  assert.match(found.text, /A variable is a letter/);
  assert.doesNotMatch(found.text, /INTEGERS|Counting is old/);
  assert.deepEqual(found.chapters, ['1 Whole Numbers', '2 The Language Of Algebra', '3 Integers']);
});

test('"Chapter 2" alone takes its title from the next line, and running page headers are not chapters', () => {
  const found = findChapter(STATISTICS, 2);
  assert.equal(found.heading, 'Chapter 2: Summarizing data');
  assert.match(found.text, /A histogram bins values/);
  assert.doesNotMatch(found.text, /Probability/);
  assert.deepEqual(chapterHeadings(STATISTICS).map((h) => h.number), [1, 2, 3]);
});

test('with no chapter headings, numbered sections mark the chapter', () => {
  const text = 'Intro\n1.1 Counting things\nOne.\n2.1 Adding Numbers\nTwo plus two.\n2.2 Carrying\nTen.\n3.1 Taking Away\nThree.';
  const found = findChapter(text, 2);
  assert.equal(found.found, true);
  assert.equal(found.heading, 'Chapter 2');
  assert.match(found.text, /Two plus two[\s\S]*Ten\./);
  assert.doesNotMatch(found.text, /Three/);
});

test('a long chapter carries a share of every section, not only its opening', () => {
  const body = (label) => `${label} ${'detail '.repeat(800)}`;
  const text = ['Chapter 2: Long', 'Chapter Outline', '  2.1 First Part', '  2.2 Second Part', '  2.3 Third Part', 'Intro.',
    '2.1 First Part', body('alpha'), '2.2 Second Part', body('beta'), '2.3 Third Part', body('gamma'), 'Chapter 3: Next', 'x'].join('\n');
  const found = findChapter(text, 2, 3000);
  assert.deepEqual(found.sections, ['2.1 First Part', '2.2 Second Part', '2.3 Third Part']);
  assert.ok(found.text.length <= 3000);
  for (const label of ['alpha', 'beta', 'gamma']) assert.match(found.text, new RegExp(label), label);
  assert.equal(found.truncated, true);
});

test('a missing chapter is not found with the chapters the book has; a book without headings has none to list', () => {
  assert.deepEqual(findChapter(PREALGEBRA, 9), { found: false, number: 9, chapters: ['1 Whole Numbers', '2 The Language Of Algebra', '3 Integers'] });
  assert.deepEqual(findChapter('Plain prose about data science with no headings.', 2), { found: false, number: 2, chapters: [] });
  const long = findChapter(`Chapter 2: Long\n${'word '.repeat(5000)}`, 2, 1000);
  assert.equal(long.text.length, 1000);
  assert.equal(long.truncated, true);
});

// ── The book routes' read rule, over scoped doubles of the access and storage modules ──────────────
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUDENT = '10000000-0000-4000-8000-000000000001';
const CLASSMATE = '10000000-0000-4000-8000-000000000002';
const OUTSIDER = '10000000-0000-4000-8000-000000000003';
const OWN_CLASS = '30000000-0000-4000-8000-000000000001';
const TEACHER_CLASS = '30000000-0000-4000-8000-000000000002';
const OTHER_SCHOOL_CLASS = '30000000-0000-4000-8000-000000000003';
const PRIVATE_BOOK = '40000000-0000-4000-8000-000000000001';
const SHARED_BOOK = '40000000-0000-4000-8000-000000000002';
const OTHER_SCHOOL_BOOK = '40000000-0000-4000-8000-000000000003';
const people = {
  [STUDENT]: { studentId: STUDENT, tenantId: TENANT, role: 'student' },
  [CLASSMATE]: { studentId: CLASSMATE, tenantId: TENANT, role: 'student' },
  [OUTSIDER]: { studentId: OUTSIDER, tenantId: TENANT, role: 'student' },
};
const classes = [
  { class_id: OWN_CLASS, tenant_id: TENANT, name: 'Pre-Algebra', subject: 'Mathematics', status: 'active', teacher_student_id: STUDENT },
  { class_id: TEACHER_CLASS, tenant_id: TENANT, name: 'Statistics', subject: 'Mathematics', status: 'active', teacher_student_id: null },
  { class_id: OTHER_SCHOOL_CLASS, tenant_id: OTHER_TENANT, name: 'Elsewhere', subject: 'Mathematics', status: 'active', teacher_student_id: null },
];
const enrollments = [{ student_id: STUDENT, class_id: TEACHER_CLASS }, { student_id: CLASSMATE, class_id: TEACHER_CLASS }];
const materials = [
  { material_id: PRIVATE_BOOK, class_id: OWN_CLASS, uploaded_by: STUDENT, title: 'Prealgebra 2e', share_status: 'private', size_bytes: 10, stored_path: 'x', created_at: 2 },
  { material_id: SHARED_BOOK, class_id: TEACHER_CLASS, uploaded_by: CLASSMATE, title: 'OpenIntro Statistics', share_status: 'approved', size_bytes: 11, stored_path: 'y', created_at: 1 },
  { material_id: OTHER_SCHOOL_BOOK, class_id: OTHER_SCHOOL_CLASS, uploaded_by: OUTSIDER, title: 'Theirs', share_status: 'approved', size_bytes: 12, stored_path: 'z', created_at: 0 },
];
const texts = { [PRIVATE_BOOK]: PREALGEBRA, [SHARED_BOOK]: STATISTICS, [OTHER_SCHOOL_BOOK]: PREALGEBRA };

class EducationAccessError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const enrolled = (studentId, classId) => enrollments.some((e) => e.student_id === studentId && e.class_id === classId);
const pool = {
  async query(sql, params) {
    if (/WHERE m\.material_id = \$1 AND c\.tenant_id = \$2/.test(sql)) {
      const row = materials.find((m) => m.material_id === params[0]);
      const cls = row && classes.find((c) => c.class_id === row.class_id && c.tenant_id === params[1]);
      return { rows: cls ? [{ ...row, class_name: cls.name }] : [] };
    }
    if (/FROM lm_materials m JOIN lm_classes c/.test(sql) && /\(m\.uploaded_by = \$1\) AS mine/.test(sql)) {
      const [me, tenant] = params;
      const rows = materials.flatMap((m) => {
        const cls = classes.find((c) => c.class_id === m.class_id && c.tenant_id === tenant && c.status === 'active');
        if (!cls) return [];
        const readable = m.uploaded_by === me || (m.share_status === 'approved' && (cls.teacher_student_id === me && params[3] || enrolled(me, cls.class_id)));
        return readable ? [{ ...m, class_name: cls.name, subject: cls.subject, mine: m.uploaded_by === me }] : [];
      });
      return { rows };
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};
const STUBS = {
  express: { Router: () => { const routes = new Map(); return { routes, get: (p, h) => routes.set(`GET ${p}`, h) }; } },
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  './education-access': {
    EducationAccessError,
    resolveAuthedStudent: async (req) => people[req.headers['x-student']],
    assertClassAccess: async (_pool, caller, classId) => {
      if (!enrolled(caller.studentId, classId)) throw new EducationAccessError('Not enrolled in this class', 403);
    },
  },
  './education-material-storage': { extractStoredMaterialText: async (row) => texts[row.material_id] },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createEducationBookRoutes } = require(path.join(PKG, 'routes', 'education-book-routes.js'));
const storage = (() => { const saved = STUBS['./education-material-storage']; delete STUBS['./education-material-storage']; try { return require(path.join(PKG, 'routes', 'education-material-storage.js')); } finally { STUBS['./education-material-storage'] = saved; } })();
Module._load = originalLoad;
const routes = createEducationBookRoutes({ pool }).routes;

/** Call one route as a person; resolves to { status, body }. */
function call(route, who, params = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    routes.get(route)({ headers: { 'x-student': who }, params, method: 'GET' }, res);
  });
}

test('my books lists the student\'s own books and approved shares in their classes, never another school\'s', async () => {
  const mine = await call('GET /my-books', STUDENT);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.books.map((b) => [b.title, b.className, b.mine]),
    [['Prealgebra 2e', 'Pre-Algebra', true], ['OpenIntro Statistics', 'Statistics', false]]);
  const outsider = await call('GET /my-books', OUTSIDER);
  assert.deepEqual(outsider.body.books, []);
});

test('a chapter reads under the material rule: the uploader, or an approved share in a class the reader belongs to', async () => {
  const own = await call('GET /materials/:materialId/chapters/:chapter', STUDENT, { materialId: PRIVATE_BOOK, chapter: '2' });
  assert.equal(own.status, 200);
  assert.equal(own.body.heading, 'Chapter 2: The Language Of Algebra');
  assert.equal(own.body.className, 'Pre-Algebra');
  const shared = await call('GET /materials/:materialId/chapters/:chapter', STUDENT, { materialId: SHARED_BOOK, chapter: '2' });
  assert.equal(shared.body.heading, 'Chapter 2: Summarizing data');
  const classmatePrivate = await call('GET /materials/:materialId/chapters/:chapter', CLASSMATE, { materialId: PRIVATE_BOOK, chapter: '2' });
  assert.equal(classmatePrivate.status, 403);
  const notEnrolled = await call('GET /materials/:materialId/chapters/:chapter', OUTSIDER, { materialId: SHARED_BOOK, chapter: '2' });
  assert.equal(notEnrolled.status, 403);
  const otherSchool = await call('GET /materials/:materialId/chapters/:chapter', STUDENT, { materialId: OTHER_SCHOOL_BOOK, chapter: '2' });
  assert.equal(otherSchool.status, 404);
});

test('a chapter request refuses a malformed id or number and answers a missing chapter with the book\'s chapters', async () => {
  assert.equal((await call('GET /materials/:materialId/chapters/:chapter', STUDENT, { materialId: 'nope', chapter: '2' })).status, 400);
  assert.equal((await call('GET /materials/:materialId/chapters/:chapter', STUDENT, { materialId: PRIVATE_BOOK, chapter: 'two' })).status, 400);
  const missing = await call('GET /materials/:materialId/chapters/:chapter', STUDENT, { materialId: PRIVATE_BOOK, chapter: '7' });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.found, false);
  assert.deepEqual(missing.body.chapters, ['1 Whole Numbers', '2 The Language Of Algebra', '3 Integers']);
});

test('a stored text book extracts again under the type it was stored with', async () => {
  const stored = storage.classifyMaterial(Buffer.from('Chapter 2: Fractions\nHalves.'), 'text/plain').mimeType;
  assert.equal(stored, 'text/plain; charset=utf-8');
  assert.equal(storage.classifyMaterial(Buffer.from('x'), stored).mimeType, stored);
  const text = await storage.extractMaterialText({ buffer: Buffer.from('Chapter 2: Fractions\nHalves.'), mimetype: stored });
  assert.equal(findChapter(text, 2).heading, 'Chapter 2: Fractions');
});
