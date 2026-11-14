/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career Coaching 0.1.0 red-before proof: each refusal guard is removed from a private copy of the package, one at a time, and the route case that guards it must then fail; the untouched copy passes the same cases. A mutation whose source text is no longer found fails here, so a guard cannot be renamed out of this proof. Guards: the exact deadline, the organization, the closed participant-status reader, closed request bodies, one live consent per coach, approval replay, the stale person row of an earlier account, the ticket marker, the owner-verified receipt and the person-only caller.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: the closed status reader is gone, so its one mutation is replaced by the four guards of the kernel status read: an inactive participant closes their snapshot, a kernel that gives no answer closes every coach read, only the kernel's two exact answers count, and the installation is proved able to confirm people before any coaching row is read.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {STORE, PACKAGE, expressHome} = require('./support/stand-ins.cjs');

const MUTATIONS = [
  // The deadline is checked on the consent and again on the snapshot; both checks go for this proof.
  {guard: 'access ends at the deadline itself', file: 'lib/consent.js', from: 'now >= deadline) return', to: 'now > deadline) return',
    also: {file: 'routes/coaching-routes.js', from: 'now >= Date.parse(snapshot.expires_at)', to: 'now > Date.parse(snapshot.expires_at)'},
    cases: 'access ends at the deadline itself'},
  {guard: 'another organization is refused', file: 'lib/consent.js', from: ' || link.tenant_id !== caller.tenant) return {ok: false',
    to: ') return {ok: false', cases: 'another organization'},
  {guard: 'an inactive participant closes their snapshot', file: 'lib/participant-status.js',
    from: "if (exact && answer.status === 'inactive') return INACTIVE;", to: "if (exact && answer.status === 'inactive') return {ok: true};",
    cases: 'a suspended, deactivated'},
  {guard: 'a kernel that gives no answer closes every coach read', file: 'lib/participant-status.js',
    from: "'the kernel did not answer the person status read');\n    return UNAVAILABLE;", to: "'the kernel did not answer the person status read');\n    return {ok: true};",
    cases: 'a kernel without the status read'},
  {guard: 'only the kernel\'s two exact answers count', file: 'lib/participant-status.js',
    from: "something other than active or inactive');\n  return UNAVAILABLE;", to: "something other than active or inactive');\n  return {ok: true};",
    cases: 'not exactly active or inactive'},
  {guard: 'the installation is proved able to confirm people before any row is read', file: 'routes/coaching-routes.js',
    from: 'if (!await participants.ready(deps.status, caller)) {', to: 'if (false) {', cases: 'a kernel without the status read'},
  {guard: 'request bodies are closed', file: 'lib/projection.js', from: 'if (extra.length) refuse(', to: 'if (false) refuse(',
    cases: 'identity: headers|confirmation: only'},
  {guard: 'one live consent per seeker and coach', file: 'lib/consent.js', from: 'return links.some((link) => link.link_id !== preview.link_id',
    to: 'return false && links.some((link) => link.link_id !== preview.link_id', cases: 'consent revision moved on'},
  {guard: 'a used approval is not replayed', file: 'lib/consent.js', from: '&& Number(link.revision) === Number(preview.expected_revision) + 1) return',
    to: '|| true) return', cases: 'replayed after revocation'},
  {guard: 'a new account does not inherit an old person row', file: 'routes/coaching-routes.js',
    from: 'if (row.person_id !== caller.personId || row.tenant_id !== caller.tenant) return', to: 'if (false) return', cases: 'newly enrolled'},
  {guard: 'an approval binds its own preview', file: 'lib/approval.js', from: "ticket.description.split('\\n')[0] === markerFor(preview))",
    to: 'true)', cases: 'changed recipient'},
  {guard: 'only an owner-verified receipt shares', file: 'lib/approval.js', from: '&& proof.ownerVerified === true &&', to: '&&',
    cases: 'not verified for the seeker'},
  {guard: 'only a person takes part', file: 'lib/identity.js', from: "if (principal.kind !== 'person' || ", to: 'if (', cases: 'a bot'},
];

/** @description Copy the package beside a tests folder that can still find the gate toolchain. @returns {string} Copy root. */
function copy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-coaching-red-'));
  fs.cpSync(PACKAGE, path.join(root, 'career-coaching'), {recursive: true});
  return path.join(root, 'career-coaching');
}

/** @description Run the named route cases in a copy. @returns {{status: number, output: string}} */
function run(dir, cases) {
  // The child is its own test run: the parent's runner context must not leak into it.
  const env = {...process.env, STORE_CI_TOOLCHAIN: path.dirname(path.dirname(expressHome())), CAREER_COACHING_QUIET_LOG: '1'};
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', cases, 'tests/coaching-routes.test.cjs'],
    {cwd: dir, encoding: 'utf8', timeout: 120000, env});
  return {status: result.status, output: (result.stdout || '') + (result.stderr || '')};
}

test('the untouched package passes every guarded case', () => {
  const dir = copy();
  try {
    const all = MUTATIONS.map((m) => m.cases).join('|');
    const result = run(dir, all);
    assert.equal(result.status, 0, result.output.slice(-2000));
    assert.match(result.output, /# pass ([1-9]\d*)/);
  } finally { fs.rmSync(path.dirname(dir), {recursive: true, force: true}); }
});

for (const mutation of MUTATIONS) {
  test(`red without its guard: ${mutation.guard}`, () => {
    const dir = copy();
    try {
      for (const edit of [mutation, mutation.also].filter(Boolean)) {
        const file = path.join(dir, edit.file), source = fs.readFileSync(file, 'utf8');
        assert.equal(source.split(edit.from).length, 2, `the guard text is found exactly once in ${edit.file}`);
        fs.writeFileSync(file, source.replace(edit.from, edit.to));
      }
      const result = run(dir, mutation.cases);
      assert.notEqual(result.status, 0, `removing "${mutation.guard}" left ${mutation.cases} green`);
      assert.match(result.output, /# fail [1-9]/);
    } finally { fs.rmSync(path.dirname(dir), {recursive: true, force: true}); }
  });
}

test('the proof runs against this store\'s toolchain', () => {
  assert.ok(expressHome().startsWith(STORE) || process.env.STORE_CI_TOOLCHAIN);
});
