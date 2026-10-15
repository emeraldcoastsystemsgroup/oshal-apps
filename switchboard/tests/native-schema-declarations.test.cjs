/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The native kernel only knows the tables a package's declared migrations create; a table
 *   declared solely by a router-build-time bootstrap has no primary key there, so POST /calendar/posts answered "SQL inserts
 *   require a declared primary key". Every INSERT target in the compiled routes must be created by a migration the manifest
 *   declares, with a primary key; the calendar and workspace tables' migration shape must match the final shape the runtime
 *   bootstrap builds (its CREATE plus every ADD COLUMN, the same key and the same status values); and no migration index
 *   may carry an ordering modifier, which a native reader cannot verify.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** The manifest's migrations list, read without a YAML dependency (the package tree has no node_modules). */
function declaredMigrations() {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  const block = manifest.split(/^migrations:\s*$/m)[1];
  assert.ok(block, 'the manifest declares migrations');
  const files = [];
  for (const line of block.split('\n').slice(1)) {
    const match = /^\s+-\s+(\S+\.sql)\s*$/.exec(line);
    if (!match) break;
    files.push(match[1]);
  }
  return files;
}

/** Strip SQL line comments so a commented-out word never counts as a declaration. */
function sqlText(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/--[^\n]*/g, '');
}

/** Split the top-level comma list inside one CREATE TABLE body. */
function topLevelParts(body) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Parse every CREATE TABLE in a SQL text into { columns: Map(name -> definition), primaryKey: string[] }. */
function createdTables(sql) {
  const tables = new Map();
  const re = /CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(/gi;
  let match;
  while ((match = re.exec(sql))) {
    let depth = 1, i = re.lastIndex;
    for (; i < sql.length && depth; i++) { if (sql[i] === '(') depth++; if (sql[i] === ')') depth--; }
    const columns = new Map();
    let primaryKey = [];
    let statusValues = null;
    for (const part of topLevelParts(sql.slice(re.lastIndex, i - 1))) {
      const pk = /^PRIMARY KEY\s*\(([^)]*)\)/i.exec(part);
      if (pk) { primaryKey = pk[1].split(',').map((s) => s.trim()); continue; }
      const check = /CHECK\s*\(\s*status IN\s*\(([^)]*)\)/i.exec(part);
      if (check) statusValues = check[1].split(',').map((s) => s.trim());
      if (/^CONSTRAINT\b/i.test(part)) continue;
      const [name, ...rest] = part.split(/\s+/);
      columns.set(name, rest.join(' '));
      if (/PRIMARY KEY/i.test(rest.join(' '))) primaryKey = [name];
    }
    tables.set(match[1], { columns, primaryKey, statusValues });
  }
  return tables;
}

/** Every table the declared migrations create, keyed by name. */
function migrationTables() {
  const all = new Map();
  for (const file of declaredMigrations()) for (const [name, table] of createdTables(sqlText(file))) all.set(name, table);
  return all;
}

/** Load a compiled route module with inert framework stand-ins and capture its runtime bootstrap statements. */
function runtimeStatements(moduleFile, exportName) {
  const captured = [];
  // Callable, constructible and readable at any depth, but never a thenable: module-scope framework calls stay inert.
  const inert = new Proxy(function inertFramework() {}, {
    get: (_t, key) => (key === '__esModule' || key === 'then' || typeof key === 'symbol' ? undefined : inert),
    apply: () => inert,
    construct: () => inert,
  });
  const stubs = {
    express: { Router: () => inert },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': {
      runRuntimeSchemaBootstrap: async ({ statements }) => { captured.push(...statements.filter((s) => typeof s === 'string')); },
      buildOwnerRlsPolicyStatements: () => [],
    },
  };
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith('@/')) return inert;
    return original.call(this, request, ...rest);
  };
  try {
    const target = path.join(ROOT, 'routes', moduleFile);
    delete require.cache[require.resolve(target)];
    return require(target)[exportName]({}).then(() => captured);
  } finally {
    Module._load = original;
  }
}

/** The final shape a runtime bootstrap builds: its CREATE TABLEs plus every ADD COLUMN, and the last status CHECK. */
function runtimeShape(statements) {
  const tables = createdTables(statements.filter((s) => /^\s*CREATE TABLE/i.test(s)).join(';\n'));
  for (const s of statements) {
    const add = /ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN IF NOT EXISTS\s+([a-z_]+)\s+(.*)$/is.exec(s);
    if (add) tables.get(add[1]).columns.set(add[2], add[3].trim());
    const check = /ALTER TABLE\s+([a-z_]+)\s+ADD CONSTRAINT\s+\S+\s+CHECK\s*\(\s*status IN\s*\(([^)]*)\)/is.exec(s);
    if (check) tables.get(check[1]).statusValues = check[2].split(',').map((v) => v.trim());
  }
  return tables;
}

/** Normalise a column definition to its type and declared default, dropping any inline CHECK. */
function columnContract(definition) {
  return definition.replace(/\s+CHECK\s*\(.*$/is, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

test('every INSERT target in the compiled routes is created by a declared migration with a primary key', () => {
  const declared = migrationTables();
  const targets = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, 'routes')).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(ROOT, 'routes', file), 'utf8').matchAll(/INSERT INTO\s+([a-z_]+)/gi)) targets.add(m[1]);
  }
  assert.ok(targets.has('oshal_switchboard_scheduled_posts'), 'the calendar insert is found');
  for (const table of targets) {
    assert.ok(declared.has(table), `${table} is inserted into but no declared migration creates it`);
    assert.ok(declared.get(table).primaryKey.length > 0, `${table} is declared without a primary key`);
  }
});

test('the calendar and workspace migrations match the final shape the runtime bootstrap builds', async () => {
  const declared = migrationTables();
  const runtime = new Map([
    ...runtimeShape(await runtimeStatements('switchboard-calendar-routes.js', 'ensureScheduledPostsSchema')),
    ...runtimeShape(await runtimeStatements('switchboard-routes.js', 'ensureWorkspaceSchema')),
  ]);
  assert.deepEqual([...runtime.keys()].sort(),
    ['oshal_switchboard_scheduled_posts', 'oshal_switchboard_workspace_accounts', 'oshal_switchboard_workspaces']);
  for (const [name, shape] of runtime) {
    const migrated = declared.get(name);
    assert.ok(migrated, `${name} has a declared migration`);
    assert.deepEqual(migrated.primaryKey, shape.primaryKey, `${name} keeps the runtime primary key`);
    assert.deepEqual([...migrated.columns.keys()].sort(), [...shape.columns.keys()].sort(), `${name} declares every runtime column`);
    for (const [column, definition] of shape.columns) {
      assert.equal(columnContract(migrated.columns.get(column)), columnContract(definition), `${name}.${column} keeps its type and default`);
    }
    assert.deepEqual(migrated.statusValues, shape.statusValues, `${name} allows the same status values`);
  }
});

test('no declared migration index carries an ordering modifier a native reader cannot verify', () => {
  for (const file of declaredMigrations().filter((f) => f >= 'migrations/003')) {
    for (const m of sqlText(file).matchAll(/CREATE (?:UNIQUE )?INDEX[^;]*\(([^;]*)\)/gi)) {
      assert.doesNotMatch(m[1], /\b(ASC|DESC)\b/i, `${file}: ${m[0]}`);
    }
  }
});
