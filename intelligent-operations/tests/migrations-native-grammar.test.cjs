/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Hold every declared migration to the native kernel's index grammar: btree only, no CONCURRENTLY, no WITH (...) (crates/packages/src/sql_constraints/ddl.rs index_contract). Migration 031 declared a GIN expression index; the kernel refused the whole declared set, so the package's tables were never provisioned in a scope on the Spark (2026-11-03). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrations = path.join(__dirname, '..', 'migrations');
const files = fs.readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort();

/** The statements of one migration file, without -- comments, as the kernel's parser sees them. */
function statements(text) {
  return text.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}

test('every migration file is declared and non-empty', () => {
  assert.ok(files.length >= 31, `expected the declared migrations, found ${files.length}`);
  for (const name of files) assert.ok(statements(fs.readFileSync(path.join(migrations, name), 'utf8')).length > 0, `${name} declares no statement`);
});

test('every CREATE INDEX uses the native kernel index grammar (btree only, no CONCURRENTLY, no WITH)', () => {
  const offenders = [];
  for (const name of files) {
    for (const statement of statements(fs.readFileSync(path.join(migrations, name), 'utf8'))) {
      if (!/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(statement)) continue;
      const using = statement.match(/\bUSING\s+([a-z_]+)/i);
      if (using && using[1].toLowerCase() !== 'btree') offenders.push(`${name}: USING ${using[1]} in "${statement.slice(0, 90)}"`);
      if (/\bCONCURRENTLY\b/i.test(statement)) offenders.push(`${name}: CONCURRENTLY in "${statement.slice(0, 90)}"`);
      if (/\)\s*WITH\s*\(/i.test(statement)) offenders.push(`${name}: WITH (...) in "${statement.slice(0, 90)}"`);
    }
  }
  assert.deepEqual(offenders, [], 'the native kernel refuses the whole declared migration set on any of these');
});

test('the cohort index of migration 031 is the btree the kernel accepts', () => {
  const text = fs.readFileSync(path.join(migrations, '031-incident-trace-indexes.sql'), 'utf8');
  assert.match(text, /CREATE INDEX IF NOT EXISTS operations_trace_cohort_deliveries ON operations_topology_decisions\(user_sub,created_at DESC\);/);
  assert.doesNotMatch(text, /USING gin/i);
});
