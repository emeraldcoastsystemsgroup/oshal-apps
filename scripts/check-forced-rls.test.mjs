/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-proof the forced row-security gate. Each case removes exactly one FORCE from a disposable one-package store - from a plain ALTER, from the `EXECUTE format(...)` loop shape that hid the live defect for the four create_project* tables, and from a repair migration that lands in a later file - and asserts the gate goes red for it. Two cases pin the shapes a lazier gate would miss: a commented-out FORCE must not count, and a dynamic statement whose table list cannot be resolved must FAIL rather than be skipped. The last case pins the real store, so deleting a FORCE from a shipped migration turns this suite red instead of leaving the gate to be quietly removed from CI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forcedRlsProblems, rowSecurityStatements } from './check-forced-rls.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The five tables this repair covers; every one must end its migration set forced. */
const CREATE_TABLES = [
  'create_projects',
  'create_project_revisions',
  'create_project_assets',
  'create_project_revision_assets',
  'create_brand_kits',
];

const PLAIN = [
  'CREATE TABLE IF NOT EXISTS example_rows (owner_sub TEXT NOT NULL);',
  'ALTER TABLE example_rows ENABLE ROW LEVEL SECURITY;',
  'ALTER TABLE example_rows FORCE ROW LEVEL SECURITY;',
  '',
].join('\n');

const LOOP = [
  'CREATE TABLE IF NOT EXISTS example_a (owner_sub TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS example_b (owner_sub TEXT NOT NULL);',
  'DO $$',
  'DECLARE t TEXT;',
  'BEGIN',
  "  FOREACH t IN ARRAY ARRAY['example_a', 'example_b'] LOOP",
  "    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);",
  "    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);",
  '  END LOOP;',
  'END $$;',
  '',
].join('\n');

/** Build a disposable one-package store whose migrations end fully enabled and forced. */
function createFixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-forced-rls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'example', 'migrations'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'example', 'migrations', name), body);
  }
  return root;
}

test('a package whose migrations enable and force every table passes', (t) => {
  const root = createFixture(t, { '001-plain.sql': PLAIN, '002-loop.sql': LOOP });
  assert.deepEqual(forcedRlsProblems(root), []);
});

test('a plain ALTER that enables without forcing is refused', (t) => {
  const root = createFixture(t, {
    '001-plain.sql': PLAIN.replace('ALTER TABLE example_rows FORCE ROW LEVEL SECURITY;\n', ''),
  });
  const problems = forcedRlsProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /example_rows has row security ENABLEd and never FORCEd/);
});

test('the EXECUTE format loop shape is read, not skipped, so a loop that only enables is refused', (t) => {
  const root = createFixture(t, {
    '001-loop.sql': LOOP.replace("    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);\n", ''),
  });
  const problems = forcedRlsProblems(root);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /example_a has row security ENABLEd and never FORCEd/);
  assert.match(problems.join('\n'), /example_b has row security ENABLEd and never FORCEd/);
});

test('a later migration that forces an earlier table repairs it, and removing that file re-opens the gap', (t) => {
  const enableOnly = PLAIN.replace('ALTER TABLE example_rows FORCE ROW LEVEL SECURITY;\n', '');
  const repaired = createFixture(t, {
    '001-plain.sql': enableOnly,
    '002-force.sql': 'ALTER TABLE example_rows FORCE ROW LEVEL SECURITY;\n',
  });
  assert.deepEqual(forcedRlsProblems(repaired), []);
  const reopened = createFixture(t, { '001-plain.sql': enableOnly });
  assert.equal(forcedRlsProblems(reopened).length, 1);
});

test('NO FORCE later in the set re-opens the gap and is refused', (t) => {
  const root = createFixture(t, {
    '001-plain.sql': PLAIN,
    '002-undo.sql': 'ALTER TABLE example_rows NO FORCE ROW LEVEL SECURITY;\n',
  });
  const problems = forcedRlsProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /example_rows has row security ENABLEd and never FORCEd/);
});

test('a commented-out FORCE does not count as one', (t) => {
  const root = createFixture(t, {
    '001-plain.sql': PLAIN.replace(
      'ALTER TABLE example_rows FORCE ROW LEVEL SECURITY;',
      '-- ALTER TABLE example_rows FORCE ROW LEVEL SECURITY;',
    ),
  });
  assert.equal(forcedRlsProblems(root).length, 1);
});

test('a dynamic statement whose table list cannot be resolved fails closed', (t) => {
  const root = createFixture(t, {
    '001-opaque.sql': [
      'DO $$',
      'DECLARE t TEXT;',
      'BEGIN',
      "  FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LOOP",
      "    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);",
      '  END LOOP;',
      'END $$;',
      '',
    ].join('\n'),
  });
  const problems = forcedRlsProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no literal table list binds 't'/);
});

test('FORCE without ENABLE is refused too: forcing is inert until row security is on', (t) => {
  const root = createFixture(t, {
    '001-plain.sql': PLAIN.replace('ALTER TABLE example_rows ENABLE ROW LEVEL SECURITY;\n', ''),
  });
  const problems = forcedRlsProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /example_rows is FORCEd but row security is never ENABLEd/);
});

test('the FOR ... SELECT unnest loop shape resolves to its literal table list', () => {
  const { statements, unresolved } = rowSecurityStatements([
    'DO $$',
    'DECLARE t TEXT;',
    'BEGIN',
    "  FOR t IN SELECT unnest(ARRAY['a_rows', 'b_rows']) LOOP",
    "    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);",
    '  END LOOP;',
    'END $$;',
  ].join('\n'));
  assert.deepEqual(unresolved, []);
  assert.deepEqual(statements, [
    { table: 'a_rows', verb: 'FORCE' },
    { table: 'b_rows', verb: 'FORCE' },
  ]);
});

test('this repository passes, and the Create Studio tables are among the tables it forces', () => {
  assert.deepEqual(forcedRlsProblems(REPOSITORY_ROOT), []);
  const forced = new Set();
  const migrations = path.join(REPOSITORY_ROOT, 'create', 'migrations');
  for (const file of fs.readdirSync(migrations).filter((entry) => entry.endsWith('.sql'))) {
    for (const statement of rowSecurityStatements(fs.readFileSync(path.join(migrations, file), 'utf8')).statements) {
      if (statement.verb === 'FORCE') forced.add(statement.table);
    }
  }
  for (const table of CREATE_TABLES) assert.ok(forced.has(table), `${table} is never FORCEd by the create package`);
});
