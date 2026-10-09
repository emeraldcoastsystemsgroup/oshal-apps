/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Per-caller filtering moved to the server (tool-keys + the profile route); the client renders the served profile unchanged
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The frame now lives in lm-mascot.js (already bound), so the contract is read from there
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Behaviour of the shared page frame: navigation entries come only from the caller's ribbon profile (class tools excluded, teacher-only views hidden from learners), the active tab matches the page path, legacy view names resolve to the package's own URLs, level progress follows the package XP rule, and a hosted page relays navigation to its host instead of navigating itself
 * -----------------------------------------------------------------------------
 *
 * Dependency-free contract for the page frame carried by tools/lm-mascot.js (served at /api/education/mascot.js). Runs under the tests/*.test.cjs store-CI glob.
 *
 * @module lm-frame.test
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const frame = require(path.resolve(__dirname, '..', 'tools', 'lm-mascot.js'));

/** A ribbon profile shaped like GET /api/ui/profile?name=little-monsters answers. */
function profile() {
  return {
    ribbon: {
      items: [
        { id: 'tool-lm-dashboard', label: 'Home', icon: 'codicon codicon-home', section: 'top', toolUi: { iframeUrl: '/api/education/dashboard' } },
        { id: 'tool-lm-recorder', label: 'Record', icon: 'codicon codicon-record', section: 'top', toolUi: { iframeUrl: '/api/education/recorder' } },
        { id: 'tool-lm-class-1a2b3c4d', label: 'Algebra I', icon: 'codicon codicon-book', section: 'top', toolUi: { iframeUrl: '/api/education/class?classId=1a2b3c4d-0000' } },
        { id: 'tool-lm-teacher', label: 'Teacher', icon: 'codicon codicon-mortar-board', section: 'bottom', toolUi: { iframeUrl: '/api/education/teacher' } },
        { id: 'tool-lm-voice-settings', label: 'Voice', icon: '', section: 'bottom', toolUi: { iframeUrl: '/api/education/voice-settings' } },
        { id: 'settings', label: 'Settings', icon: '', section: 'bottom', toolUi: { iframeUrl: '/settings' } },
        { id: 'tool-lm-broken', label: 'No url', icon: '', section: 'top' }
      ]
    }
  };
}

test('navigation entries are the served profile: this package\'s tools in order, class tools left to the pages, nothing hidden or added by the client', () => {
  assert.deepEqual(frame.navEntries(profile()).map(e => e.view), ['dashboard', 'recorder', 'teacher', 'voice-settings'], 'the server already filtered the profile per caller; the client renders what it was given');
  assert.deepEqual(frame.navEntries(null), [], 'no profile answers with no navigation, never an invented list');
  const entry = frame.navEntries(profile())[0];
  assert.deepEqual(entry, { view: 'dashboard', id: 'tool-lm-dashboard', label: 'Home', href: '/api/education/dashboard', icon: 'codicon codicon-home', section: 'top' });
});

test('active entry matches the page path, ignoring query strings and trailing slashes', () => {
  const entries = frame.navEntries(profile());
  assert.equal(frame.activeEntry(entries, '/api/education/recorder').view, 'recorder');
  assert.equal(frame.activeEntry(entries, '/api/education/recorder/').view, 'recorder');
  assert.equal(frame.activeEntry(entries, '/api/education/quiz'), null, 'a page that is not a top-level tool has no active tab');
});

test('legacy view names resolve to the package\'s own URLs, classes to the class page', () => {
  const entries = frame.navEntries(profile());
  assert.equal(frame.hrefForView('recorder', entries), '/api/education/recorder');
  assert.equal(frame.hrefForView('class-9f8e7d6c-1111', entries), '/api/education/class?classId=9f8e7d6c-1111');
  assert.equal(frame.hrefForView('nope', entries), '', 'an unknown view opens nothing');
});

test('level progress follows the package rule (100 × 1.5^(level−1)) and refuses partial data', () => {
  assert.deepEqual(frame.levelProgress({ xp: 110, level: 2 }), { level: 2, pct: 73, inLevel: 110, needed: 150 });
  assert.deepEqual(frame.levelProgress({ xp: 0, level: 1 }), { level: 1, pct: 0, inLevel: 0, needed: 100 });
  assert.equal(frame.levelProgress({ level: 2 }), null);
  assert.equal(frame.levelProgress(null), null);
});

/** A minimal window double: hosted when `top` differs from `self`. */
function fakeWindow(hosted) {
  const posted = [];
  const w = { location: { href: '', pathname: '/api/education/dashboard' }, fetch: () => Promise.resolve({ ok: false }), document: null,
    parent: { postMessage: (msg, origin) => posted.push({ msg, origin }) }, setTimeout, clearTimeout };
  w.self = w; w.top = hosted ? {} : w;
  return { w, posted };
}

test('a hosted page relays navigation to its host through the shapes the cockpit ribbon honours', () => {
  const { w, posted } = fakeWindow(true);
  const api = frame.createFrame(w);
  assert.equal(api.isEmbedded, true);
  api.navigate('flashcards'); api.openClass('abc-123'); api.classesChanged();
  assert.deepEqual(posted.map(p => p.msg), [{ type: 'lm-navigate', view: 'flashcards' }, { type: 'lm-open-class', classId: 'abc-123' }, 'lm-classes-changed']);
  assert.equal(w.location.href, '', 'a hosted page never navigates its own window');
});

test('a standalone page opens classes itself and never posts to a host', () => {
  const { w, posted } = fakeWindow(false);
  const api = frame.createFrame(w);
  assert.equal(api.isEmbedded, false);
  api.openClass('abc-123'); api.classesChanged();
  assert.equal(w.location.href, '/api/education/class?classId=abc-123');
  assert.deepEqual(posted, []);
});

test('escaping covers every HTML-significant character', () => {
  assert.equal(frame.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(frame.esc(null), '');
});
