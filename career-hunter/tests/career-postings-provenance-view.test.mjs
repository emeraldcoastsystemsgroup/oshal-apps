/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard migration 100's additive postings-view provenance projection and security-invoker/RLS contract against drift.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration097 = readFileSync(
  new URL('../migrations/097-career-postings-view.sql', import.meta.url),
  'utf8',
);
const migration100 = readFileSync(
  new URL('../migrations/100-career-application-provenance.sql', import.meta.url),
  'utf8',
);

/** Remove explanatory line comments before delimiters inside prose can affect parsing. */
function stripSqlComments(value) {
  return value.replaceAll(/--[^\r\n]*/g, ' ');
}

/** Remove formatting without changing SQL tokens. */
function normalizeSql(value) {
  return stripSqlComments(value).replaceAll(/\s+/g, ' ').trim();
}

/** Extract one postings view's projection and joins for structural comparison. */
function postingsView(sql, replace) {
  const create = replace ? 'CREATE\\s+OR\\s+REPLACE' : 'CREATE';
  const pattern = new RegExp(
    `${create}\\s+VIEW\\s+public\\.postings\\s+WITH\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`
      + '\\s+AS\\s+SELECT([\\s\\S]*?)FROM\\s+career_postings\\s+p([\\s\\S]*?);',
    'i',
  );
  const match = stripSqlComments(sql).match(pattern);
  assert.ok(match, 'postings view must be created explicitly with security_invoker = true');
  return { projection: normalizeSql(match[1]), joins: normalizeSql(match[2]) };
}

test('migration 100 replaces the view only after both provenance columns exist', () => {
  const sourceColumn = migration100.search(
    /ALTER TABLE\s+career_user_applications[\s\S]*?ADD COLUMN IF NOT EXISTS\s+application_source\s+TEXT/i,
  );
  const taskColumn = migration100.search(
    /ALTER TABLE\s+career_user_applications[\s\S]*?ADD COLUMN IF NOT EXISTS\s+application_task_id\s+TEXT/i,
  );
  const replacement = migration100.search(/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.postings/i);
  assert.ok(sourceColumn >= 0, 'application_source base column is missing');
  assert.ok(taskColumn >= 0, 'application_task_id base column is missing');
  assert.ok(replacement > sourceColumn && replacement > taskColumn, 'view replacement must follow ALTER TABLE');
  assert.doesNotMatch(migration100, /DROP\s+(?:MATERIALIZED\s+)?VIEW[\s\S]*?public\.postings/i);
});

test('migration 100 preserves the migration 097 projection and appends only provenance', () => {
  const legacy = postingsView(migration097, false);
  const upgraded = postingsView(migration100, true);
  assert.equal(
    upgraded.projection,
    `${legacy.projection}, a.application_source, a.application_task_id`,
    'existing compatibility columns must not be removed, reordered, or retyped',
  );
  assert.equal(upgraded.joins, legacy.joins, 'the FORCE-RLS-filtered base-table joins must not drift');
});
