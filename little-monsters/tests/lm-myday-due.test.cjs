/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | My Day's Due today / Coming up read only teacher assignments, so an action item a student saved through Jarvis (lm-add-reminder, a personal /calendar row) showed on the month calendar and never under Coming up. Runs the page's own loadDueItems against stubbed /assignments and /calendar answers.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free (runs under the tests/*.test.cjs store-CI glob).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'my-day.html'), 'utf8');
const pick = (re) => { const m = HTML.match(re); assert.ok(m, `${re} is on the page`); return m[0]; };
const SOURCE = [
  pick(/function ymd\(d\) \{[^\n]*\n/),
  pick(/function parseDue\(s\) \{\n[\s\S]*?\n\}\n/),
  pick(/async function loadDueItems\(\) \{\n[\s\S]*?\n\}\n/),
].join('');

/** Run loadDueItems on a fixed day with the given route answers; returns the two lists it renders. */
async function due(assignments, events) {
  const rendered = {};
  const els = {};
  const document = { getElementById: (id) => (els[id] = els[id] || { textContent: '', innerHTML: '' }) };
  const fetch = async (url) => ({
    ok: true,
    json: async () => (url.startsWith('/api/education/calendar') ? { events } : { assignments }),
  });
  const renderDueList = (id, items) => { rendered[id] = items.map((item) => item.title); };
  const run = new Function('document', 'fetch', 'renderDueList', 'getUrgency', 'speakBriefing', 'today', 'todayStr',
    `${SOURCE}\nreturn loadDueItems();`);
  const today = new Date(2026, 9, 18);
  await run(document, fetch, renderDueList, () => 'Due soon', () => {}, today, '2026-10-18');
  return { today: rendered.dueToday, soon: rendered.dueSoon, soonCount: els.dueSoonCount.textContent };
}

test('an action item saved to the student calendar is listed under Coming up', async () => {
  const lists = await due([], [
    { student_id: 's1', title: 'Read Chapter 4', class_name: 'Biology', event_date: '2026-10-21T00:00:00.000Z', event_type: 'reminder' },
    { student_id: 's1', title: 'Finish lab write-up', class_name: 'Biology', event_date: '2026-10-23', event_type: 'assignment' },
  ]);
  assert.deepEqual(lists.soon, ['Read Chapter 4', 'Finish lab write-up']);
  assert.equal(lists.soonCount, '2');
});

test('class-wide rows and past personal items are not listed twice or late', async () => {
  const lists = await due(
    [{ title: 'Essay', class_name: 'English', due_date: '2026-10-20', assignment_type: 'homework' }],
    [
      { student_id: null, title: 'Essay', class_name: 'English', event_date: '2026-10-20' },
      { student_id: 's1', title: 'Old reminder', event_date: '2026-10-01' },
      { student_id: 's1', title: 'Today item', event_date: '2026-10-18' },
    ],
  );
  assert.deepEqual(lists.today, ['Today item']);
  assert.deepEqual(lists.soon, ['Essay']);
});
