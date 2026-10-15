/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | First visit on the native kernel: the page frame turns the "complete school setup" refusal into the open-time write and re-reads /me, and every migration the native kernel applies avoids the forms it refuses (DO blocks, PL/pgSQL, DROP INDEX, platform tables), so a person's scope gets lm_students at all.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free (runs under the tests/*.test.cjs store-CI glob).
 *
 * @module native-first-visit.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const frame = require(path.join(ROOT, 'tools', 'lm-mascot.js'));
const SETUP_REFUSAL = 'Open Little Monsters to complete school setup';

/** A window whose fetch answers from a script of [method, path, status, body] and records each call. */
function scriptedWindow(script) {
  const calls = [];
  const win = {
    top: null,
    fetch(url, options) {
      const method = (options && options.method) || 'GET';
      calls.push(`${method} ${url}`);
      const next = script.shift();
      assert.ok(next, `unexpected ${method} ${url}`);
      assert.equal(`${next[0]} ${next[1]}`, `${method} ${url}`);
      return Promise.resolve({ ok: next[2] >= 200 && next[2] < 300, status: next[2], json: () => Promise.resolve(next[3]) });
    },
  };
  win.top = win;
  return { win, calls };
}

test('a first visit completes school setup with the open-time write, then answers the provisioned learner', async () => {
  const learner = { studentId: 's-1', role: 'student', name: 'Ada', classCount: 0, isNew: true };
  const { win, calls } = scriptedWindow([
    ['GET', '/api/education/me', 403, { error: SETUP_REFUSAL }],
    ['POST', '/api/education/check-reminders', 200, { processed: 0, notificationsSent: 0 }],
    ['GET', '/api/education/me', 200, learner],
  ]);
  const who = await frame.createFrame(win).me();
  assert.deepEqual(who, learner);
  assert.deepEqual(calls, ['GET /api/education/me', 'POST /api/education/check-reminders', 'GET /api/education/me']);
});

test('a provisioned learner, another refusal or a refused setup write never makes or repeats the write', async () => {
  const known = scriptedWindow([['GET', '/api/education/me', 200, { studentId: 's-2' }]]);
  assert.deepEqual(await frame.createFrame(known.win).me(), { studentId: 's-2' });
  assert.deepEqual(known.calls, ['GET /api/education/me']);

  const other = scriptedWindow([['GET', '/api/education/me', 403, { error: 'School enrollment is not configured for this identity' }]]);
  assert.equal(await frame.createFrame(other.win).me(), null, 'only the exact setup refusal triggers the write');
  assert.deepEqual(other.calls, ['GET /api/education/me']);

  const refused = scriptedWindow([
    ['GET', '/api/education/me', 403, { error: SETUP_REFUSAL }],
    ['POST', '/api/education/check-reminders', 403, { error: 'School enrollment is not configured for this identity' }],
  ]);
  assert.equal(await frame.createFrame(refused.win).me(), null, 'a refused write answers no identity instead of looping');
  assert.equal(refused.calls.length, 2);

  assert.equal(frame.needsSchoolSetup(401, { error: SETUP_REFUSAL }), false);
  assert.equal(frame.needsSchoolSetup(403, null), false);
});

test('the setup message the frame matches is the one the server sends', () => {
  const access = fs.readFileSync(path.join(ROOT, 'routes', 'education-access.js'), 'utf8');
  assert.ok(access.includes(`'${SETUP_REFUSAL}'`), 'compiled education-access still refuses with the exact setup message');
  const catalog = fs.readFileSync(path.join(ROOT, 'authorization.yaml'), 'utf8');
  assert.match(catalog, /method: POST, path: \/check-reminders, allOf: \[app\.open, study\.change\]/, 'the open-time write stays bound in the installed catalog');
});

/** The manifest's `migrations:` list and the ids `nativeMigrations:` skips (line-based, no YAML dependency). */
function manifestMigrations() {
  const lines = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8').split('\n');
  const declared = [];
  const skipped = new Set();
  let block = null;
  for (const line of lines) {
    if (/^[A-Za-z]/.test(line)) block = line.replace(/:.*$/, '');
    const entry = /^ {2}- (migrations\/\S+\.sql)\s*$/.exec(line);
    if (block === 'migrations' && entry) declared.push(entry[1]);
    const id = /^ {2}- id: (migrations\/\S+\.sql)\s*$/.exec(line);
    if (block === 'nativeMigrations' && id) skipped.add(id[1]);
  }
  return { declared, skipped };
}

/** Forms the native kernel's migration adapter refuses, which abort the whole provisioning transaction. */
const NATIVE_REFUSED = [
  [/^\s*DO\s+\$\$/im, 'a PL/pgSQL DO block'],
  [/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i, 'a PL/pgSQL function'],
  [/CREATE\s+TRIGGER/i, 'a trigger'],
  [/DROP\s+(INDEX|TRIGGER)/i, 'a DROP INDEX/TRIGGER'],
  [/COMMENT\s+ON/i, 'COMMENT ON'],
  [/INSERT\s+INTO\s+(agents|persona_layers)\b/i, 'a platform table'],
];

test('every migration the native kernel applies avoids the forms its adapter refuses', () => {
  const { declared, skipped } = manifestMigrations();
  assert.ok(declared.includes('migrations/native/001-little-monsters.sql'), 'the native final shape is declared');
  assert.equal(declared[declared.length - 1], 'migrations/native/001-little-monsters.sql', 'it runs after every base migration it extends');
  for (const id of skipped) assert.ok(declared.includes(id), `${id} is a declared migration`);
  for (const id of declared.filter((name) => !skipped.has(name))) {
    const sql = fs.readFileSync(path.join(ROOT, id), 'utf8').replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [pattern, label] of NATIVE_REFUSED) {
      assert.doesNotMatch(sql, pattern, `${id} reaches the native kernel with ${label}`);
    }
  }
});

test('the native final shape keeps the columns the identity and study routes write', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations', 'native', '001-little-monsters.sql'), 'utf8');
  for (const needed of [
    /lm_students\s+ADD COLUMN IF NOT EXISTS external_issuer/,
    /idx_lm_students_external_principal/,
    /lm_flashcard_sets\s+ADD COLUMN IF NOT EXISTS owner_student_id/,
    /lm_enrollments\s+ADD COLUMN IF NOT EXISTS tenant_id/,
    /lm_xp_events ADD COLUMN IF NOT EXISTS dedupe_key/,
    /CREATE TABLE IF NOT EXISTS lm_quiz_attempts/,
    /CREATE TABLE IF NOT EXISTS lm_authorization_audit/,
  ]) {
    assert.match(sql, needed);
  }
});
