#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Refuse a package migration that leaves a table with row security ENABLEd but not FORCEd. PostgreSQL exempts a table's OWNER from its own row security unless the table is forced, and in this platform the api both owns every public table and is the role that reads them - so ENABLE alone installs a policy that reads as protection in every audit and never once filters a row. Measured live 2026-09-21: the four create_project* tables had a correct exact-owner policy and returned the row anyway, as the owner, with no identity stamped and again with a wrong one. This gate reads the statements a migration actually applies, including the `EXECUTE format('ALTER TABLE %I ...', t)` loop shape that hid it - a grep for the literal `FORCE ROW LEVEL SECURITY` would have passed a file that forces nothing. It fails closed on any dynamic statement whose table list it cannot resolve.
 *
 * Usage: node scripts/check-forced-rls.mjs [repository-root]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that are never a package: tooling, dependencies and generated verification output. */
const NOT_A_PACKAGE = new Set(['node_modules', 'scripts', 'output', 'audits', '_walkthrough-shots', 'apps', 'brand-graphics']);

/** The four row-security verbs a migration can apply, normalized. */
const VERBS = ['ENABLE', 'DISABLE', 'FORCE', 'NO FORCE'];

/**
 * @description Remove SQL comments so a commented-out or merely described statement is never
 *  read as one that runs. Single-quoted strings are preserved verbatim, because every dynamic
 *  statement this gate resolves lives inside one.
 * @param {string} sql The raw migration text.
 * @returns {string} The same text with `--` line comments and block comments blanked, length preserved.
 */
export function stripComments(sql) {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    if (sql[index] === "'") {
      const end = sql.indexOf("'", index + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(index, stop);
      index = stop;
    } else if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index);
      const stop = end === -1 ? sql.length : end;
      out += ' '.repeat(stop - index);
      index = stop;
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else {
      out += sql[index];
      index += 1;
    }
  }
  return out;
}

/**
 * @description Collect every loop variable a migration binds to a literal table list, with the
 *  offset where the binding starts, so a dynamic statement resolves against the loop it is in.
 *  Both shapes the store uses are read: `FOREACH t IN ARRAY ARRAY[...]` and
 *  `FOR t IN SELECT unnest(ARRAY[...])`.
 * @param {string} sql Comment-stripped migration text.
 * @returns {Array<{ variable: string, at: number, tables: string[] }>} Bindings in file order.
 */
export function loopBindings(sql) {
  const bindings = [];
  const shapes = [
    /FOREACH\s+([A-Za-z_][A-Za-z0-9_]*)\s+IN\s+ARRAY\s+ARRAY\s*\[([^\]]*)\]/gi,
    /FOR\s+([A-Za-z_][A-Za-z0-9_]*)\s+IN\s+SELECT\s+unnest\s*\(\s*ARRAY\s*\[([^\]]*)\]/gi,
  ];
  for (const shape of shapes) {
    for (const match of sql.matchAll(shape)) {
      const tables = [...match[2].matchAll(/'([^']*)'/g)].map((entry) => entry[1].trim()).filter(Boolean);
      bindings.push({ variable: match[1], at: match.index ?? 0, tables });
    }
  }
  return bindings.sort((a, b) => a.at - b.at);
}

/** Drop a schema qualifier and quoting so `public."create_projects"` and `create_projects` agree. */
function bareTable(identifier) {
  return identifier.replace(/"/g, '').replace(/^[a-z_][a-z0-9_]*\./i, '').toLowerCase();
}

/**
 * @description Read every row-security statement a migration applies, resolving the dynamic
 *  `EXECUTE format('ALTER TABLE %I <verb> ROW LEVEL SECURITY', <variable>)` shape against the
 *  loop that binds `<variable>`. An unresolvable dynamic statement is returned as a problem
 *  rather than ignored: a statement nobody could resolve is a table nobody checked.
 * @param {string} rawSql The raw migration text.
 * @returns {{ statements: Array<{ table: string, verb: string }>, unresolved: string[] }} What runs, and what could not be read.
 */
export function rowSecurityStatements(rawSql) {
  const sql = stripComments(rawSql);
  const bindings = loopBindings(sql);
  const statements = [];
  const unresolved = [];
  const verbs = VERBS.map((verb) => verb.replace(' ', '\\s+')).join('|');

  const literal = new RegExp(
    `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))?)\\s+(${verbs})\\s+ROW\\s+LEVEL\\s+SECURITY`,
    'gi',
  );
  for (const match of sql.matchAll(literal)) {
    statements.push({ table: bareTable(match[1]), verb: match[2].replace(/\s+/g, ' ').toUpperCase() });
  }

  const dynamic = new RegExp(
    `format\\(\\s*'ALTER\\s+TABLE\\s+%I\\s+(${verbs})\\s+ROW\\s+LEVEL\\s+SECURITY'\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\)`,
    'gi',
  );
  for (const match of sql.matchAll(dynamic)) {
    const verb = match[1].replace(/\s+/g, ' ').toUpperCase();
    const variable = match[2];
    const binding = bindings.filter((entry) => entry.variable === variable && entry.at < (match.index ?? 0)).pop();
    if (!binding || binding.tables.length === 0) {
      unresolved.push(`${verb} ROW LEVEL SECURITY is applied to every value of '${variable}', and no literal table list binds '${variable}' above it`);
      continue;
    }
    for (const table of binding.tables) statements.push({ table: bareTable(table), verb });
  }
  return { statements, unresolved };
}

/** Find the package directories that ship migrations, in name order. */
function packagesWithMigrations(repositoryRoot) {
  return fs.readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !NOT_A_PACKAGE.has(entry.name))
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(repositoryRoot, name, 'migrations')))
    .sort();
}

/**
 * @description Replay every package's migration set in applied order and report the tables left
 *  in a state that reads as protection and is not. Two shapes fail: ENABLE without FORCE (the
 *  owner is exempt, so the policy never runs) and FORCE without ENABLE (forcing is inert until
 *  row security is switched on, so the table is wide open while the migration says otherwise).
 * @param {string} repositoryRoot The store checkout to read.
 * @returns {string[]} One message per problem; empty when every walled table is genuinely walled.
 */
export function forcedRlsProblems(repositoryRoot = REPOSITORY_ROOT) {
  const problems = [];
  const state = new Map(); // table -> { enabled, forced, package, file }
  for (const name of packagesWithMigrations(repositoryRoot)) {
    const directory = path.join(repositoryRoot, name, 'migrations');
    const files = fs.readdirSync(directory).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const label = `${name}/migrations/${file}`;
      const { statements, unresolved } = rowSecurityStatements(fs.readFileSync(path.join(directory, file), 'utf8'));
      for (const message of unresolved) problems.push(`${label}: ${message}`);
      for (const { table, verb } of statements) {
        const current = state.get(table) ?? { enabled: false, forced: false, package: name, file: label };
        if (verb === 'ENABLE') current.enabled = true;
        if (verb === 'DISABLE') current.enabled = false;
        if (verb === 'FORCE') current.forced = true;
        if (verb === 'NO FORCE') current.forced = false;
        current.file = label;
        state.set(table, current);
      }
    }
  }
  for (const [table, entry] of [...state.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.enabled && !entry.forced) {
      problems.push(
        `${entry.file}: ${table} has row security ENABLEd and never FORCEd. PostgreSQL exempts the `
        + 'table owner, the api owns every table and is the role that reads them, so this table\'s '
        + 'policy never runs. Add ALTER TABLE ' + table + ' FORCE ROW LEVEL SECURITY.',
      );
    }
    if (entry.forced && !entry.enabled) {
      problems.push(
        `${entry.file}: ${table} is FORCEd but row security is never ENABLEd, so no policy applies `
        + 'to it at all. Add ALTER TABLE ' + table + ' ENABLE ROW LEVEL SECURITY.',
      );
    }
  }
  return problems;
}

/** @description Fail the gate when any package migration leaves a walled table unenforced. */
export function main(repositoryRoot = REPOSITORY_ROOT) {
  const problems = forcedRlsProblems(repositoryRoot);
  if (problems.length) {
    console.error(`Forced row-level security failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  let walled = 0;
  for (const name of packagesWithMigrations(repositoryRoot)) {
    const directory = path.join(repositoryRoot, name, 'migrations');
    for (const file of fs.readdirSync(directory).filter((entry) => entry.endsWith('.sql'))) {
      walled += rowSecurityStatements(fs.readFileSync(path.join(directory, file), 'utf8'))
        .statements.filter((statement) => statement.verb === 'FORCE').length;
    }
  }
  console.log(`Forced row-level security passed: ${walled} FORCE statement(s) across every package migration set`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? path.resolve(process.argv[2]) : REPOSITORY_ROOT);
}
