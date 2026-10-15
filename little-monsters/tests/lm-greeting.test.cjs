/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 7: the home greeting read 'Up late?. Little Monsters is your study companion'. Runs the page's own daypart/greetLine/paintHero (tools/student-dashboard.html) at each hour band for a learner and a teacher: one end mark per sentence.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free (runs under the tests/*.test.cjs store-CI glob).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'student-dashboard.html'), 'utf8');
const pick = (re) => { const m = HTML.match(re); assert.ok(m, `${re} is on the page`); return m[0]; };
const SOURCE = [pick(/var daypart = function \(\) \{[^\n]*\n/), pick(/var greetLine = function [^\n]*\n/), pick(/function paintHero\(\) \{\n[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*\n/)].join('');

/** paintHero's first four lines at hour `h` for a person; returns the greeting and the line under it. */
function hero(h, me) {
  const els = {};
  const $ = (id) => (els[id] = els[id] || { textContent: '' });
  const FixedDate = function () { return { getHours: () => h }; };
  new Function('$', 'Date', 'isTeacher', 'firstName', `${SOURCE}}\npaintHero();`)($, FixedDate, () => me.teacher, () => me.name || '');
  return { greeting: els.greeting.textContent, sub: els.greetingSub.textContent };
}

test('a learner up late gets one question mark and no stray full stop', () => {
  const { sub } = hero(2, { teacher: false, name: 'Ada' });
  assert.equal(sub, 'Up late? Little Monsters is your study companion: ask, practise, play, grow.');
});

test('every hour band ends each sentence with exactly one mark', () => {
  for (const h of [2, 9, 14, 20]) {
    for (const me of [{ teacher: true, name: 'Roger' }, { teacher: true }, { teacher: false, name: 'Ada' }]) {
      const { greeting, sub } = hero(h, me);
      for (const text of [greeting, sub]) assert.doesNotMatch(text, /[?.!]{2}|\?,/, `${h}h ${JSON.stringify(me)}: ${text}`);
    }
  }
  assert.equal(hero(2, { teacher: true, name: 'Roger' }).greeting, 'Up late, Roger?');
  assert.equal(hero(9, { teacher: true, name: 'Roger' }).greeting, 'Good morning, Roger.');
  assert.equal(hero(20, { teacher: true }).greeting, 'Good evening.');
});
