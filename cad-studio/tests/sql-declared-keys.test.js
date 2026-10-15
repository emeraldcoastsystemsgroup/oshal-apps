/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard the native kernel's insert rule for this package:
 *                     |                             | the kernel refuses an INSERT unless the target table's
 *                     |                             | installed declaration names a primary key and the row
 *                     |                             | carries a value (or a declared default) for every key
 *                     |                             | column ("SQL inserts require a declared primary key").
 *                     |                             | The create path's real SQL is captured from
 *                     |                             | routes/model-store.js (create, then a recorded build that
 *                     |                             | inserts the revision row) and every INSERT target in
 *                     |                             | routes/ is checked against the CREATE TABLE statements of
 *                     |                             | the migrations oshal-app.yaml lists. Negative controls
 *                     |                             | prove the checker goes red on an undeclared table, a table
 *                     |                             | without a key, and a key column the INSERT omits.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const store = require(path.join(PKG, 'routes', 'model-store.js'));

/** @description The migration files the manifest lists under `migrations:`, in order. */
function listedMigrations() {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const block = /^migrations:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(manifest);
  assert.ok(block, 'oshal-app.yaml lists no migrations');
  return block[1].split('\n').map((line) => line.replace(/^\s*-\s*/, '').replace(/#.*$/, '').trim()).filter(Boolean);
}

/** @description Split a parenthesised body on top-level commas. */
function topLevelItems(body) {
  const items = [];
  let depth = 0, quoted = false, current = '';
  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') { items.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

/** @description Every CREATE TABLE in the SQL: its columns (with whether each has a default) and primary key. */
function declaredTables(sql) {
  const text = sql.replace(/--[^\n]*/g, '');
  const tables = {};
  const head = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi;
  let match;
  while ((match = head.exec(text))) {
    let depth = 1, i = head.lastIndex;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === '(') depth += 1;
      if (text[i] === ')') depth -= 1;
    }
    const columns = {};
    let primary = [];
    for (const item of topLevelItems(text.slice(head.lastIndex, i - 1))) {
      const tableKey = /^(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(item);
      if (tableKey) { primary = tableKey[1].split(',').map((c) => c.trim()); continue; }
      if (/^(CONSTRAINT|CHECK|UNIQUE|FOREIGN|EXCLUDE)\b/i.test(item)) continue;
      const name = item.split(/\s+/)[0];
      columns[name] = { defaulted: /\bDEFAULT\b/i.test(item) || /^\w+\s+(SMALL|BIG)?SERIAL\d?\b/i.test(item) };
      if (/\bPRIMARY\s+KEY\b/i.test(item)) primary = [name];
    }
    tables[match[1]] = { columns, primary };
  }
  return tables;
}

/** @description The kernel's insert rule applied to one statement: the reasons it would refuse, or []. */
function insertProblems(tables, text, values = []) {
  const insert = /^\s*INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)(?:\s+ON\s+CONFLICT|\s+RETURNING|\s*$)/i.exec(text);
  if (!insert) return [`not a single-row INSERT ... VALUES: ${text.slice(0, 80)}`];
  const [, table, columnList, valueList] = insert;
  const declared = tables[table];
  if (!declared) return [`${table}: no CREATE TABLE in a listed migration`];
  if (declared.primary.length === 0) return [`${table}: declaration has no primary key`];
  const columns = columnList.split(',').map((c) => c.trim());
  const supplied = topLevelItems(valueList);
  const problems = [];
  for (const column of columns) if (!declared.columns[column]) problems.push(`${table}.${column}: undeclared column`);
  for (const key of declared.primary) {
    const at = columns.indexOf(key);
    if (at < 0) {
      if (!declared.columns[key]?.defaulted) problems.push(`${table}.${key}: key column neither supplied nor defaulted`);
      continue;
    }
    const param = /^\$(\d+)/.exec(supplied[at] || '');
    if (/^NULL$/i.test(supplied[at] || '') || (param && (values[Number(param[1]) - 1] ?? null) === null)) {
      problems.push(`${table}.${key}: key value is null`);
    }
  }
  return problems;
}

const DECLARED = Object.assign({}, ...listedMigrations().map((file) => declaredTables(fs.readFileSync(path.join(PKG, file), 'utf8'))));

/** @description A pool that records every statement and answers RETURNING with a model row. */
function capturePool() {
  const sent = [];
  const row = { model_id: '7d0c2f4e-0000-4000-8000-000000000001', owner_sub: 'person-a', revision: 1, state: 'built' };
  return { sent, async query(sql, values = []) { sent.push({ text: sql, values }); return /RETURNING/i.test(sql) ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 1 }; } };
}

test('the listed migrations declare cad_model and cad_revision with their primary keys', () => {
  assert.deepEqual(DECLARED.cad_model.primary, ['model_id']);
  assert.equal(DECLARED.cad_model.columns.model_id.defaulted, true);
  assert.deepEqual(DECLARED.cad_revision.primary, ['model_id', 'revision']);
});

test('the create path\'s INSERTs satisfy the kernel\'s declared-primary-key rule', async () => {
  const pool = capturePool();
  const model = await store.createModel(pool, 'person-a', { title: 'probe', base: { kind: 'box', sizeX: 10, sizeY: 10, sizeZ: 10 }, features: [], source: {}, settings: {} });
  await store.recordBuild(pool, 'person-a', model.model_id, { features: [], report: { volumeMm3: 1000 }, featureStatus: [], engineBuild: 'c'.repeat(64), ms: 5 });
  const inserts = pool.sent.filter((s) => /^\s*INSERT/i.test(s.text));
  assert.deepEqual(inserts.map((s) => /INTO\s+(\w+)/i.exec(s.text)[1]), ['cad_model', 'cad_revision']);
  for (const statement of inserts) assert.deepEqual(insertProblems(DECLARED, statement.text, statement.values), [], statement.text);
});

test('every INSERT target in routes/ is a declared table with a primary key', () => {
  const dir = path.join(PKG, 'routes');
  const targets = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/INSERT\s+INTO\s+(\w+)/gi)) targets.add(m[1]);
  }
  assert.ok(targets.size > 0);
  for (const table of targets) assert.ok(DECLARED[table]?.primary.length > 0, `${table} is not declared with a primary key in a listed migration`);
});

test('negative controls: the checker refuses what the kernel refuses', () => {
  const tables = declaredTables(`
    CREATE TABLE IF NOT EXISTS keyless (owner_sub TEXT NOT NULL, note TEXT);
    CREATE TABLE IF NOT EXISTS keyed (item_id UUID NOT NULL, owner_sub TEXT NOT NULL, CONSTRAINT keyed_pk PRIMARY KEY (item_id));`);
  assert.deepEqual(insertProblems(tables, 'INSERT INTO cad_audit (owner_sub) VALUES ($1)', ['a']), ['cad_audit: no CREATE TABLE in a listed migration']);
  assert.deepEqual(insertProblems(tables, 'INSERT INTO keyless (owner_sub) VALUES ($1)', ['a']), ['keyless: declaration has no primary key']);
  assert.deepEqual(insertProblems(tables, 'INSERT INTO keyed (owner_sub) VALUES ($1)', ['a']), ['keyed.item_id: key column neither supplied nor defaulted']);
  assert.deepEqual(insertProblems(tables, 'INSERT INTO keyed (item_id, owner_sub) VALUES ($1, $2)', [null, 'a']), ['keyed.item_id: key value is null']);
  assert.deepEqual(insertProblems(tables, 'INSERT INTO keyed (item_id, owner_sub) VALUES ($1, $2) RETURNING item_id', ['x', 'a']), []);
});
