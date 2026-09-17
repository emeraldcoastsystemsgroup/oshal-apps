#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-157 S3: every deterministic service-route schedule declares the principal class it runs under, and a `requires:` may only name a permission the package's own imported authorization catalog defines. Both halves are the kernel's rules (src/features/swarm-apps/services/manifest-schedule-validation.ts) and BOTH fail at INSTALL, not here: an unclassified schedule cannot be activated at all, and a `requires` the catalog does not define makes the loader refuse the WHOLE manifest — which takes the app down, not just the job. Zero-dependency by design: the store's gates run on a bare checkout with no npm install, so this reads the exact YAML subset a schedules block uses rather than adding a YAML runtime, and fails closed on anything it cannot read.
 *
 * Usage: node scripts/check-service-activations.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The kernel's two principal classes (ADR-157). A third value is refused at load. */
export const RUNS_AS = ['system', 'user'];
/** The kernel's ceiling on one service's declared permission list. */
export const MAX_REQUIRES = 16;

/**
 * @description Split a top-level block out of a manifest, keeping indentation and line numbers.
 * @param {string} manifestText The raw oshal-app.yaml text.
 * @param {string} key The top-level key whose block to read.
 * @returns {{ found: boolean, lines: Array<{ indent: number, text: string, line: number, raw: string }> }}
 *  `found` separates "no block" from "an empty one" — a caller must never read one as the other.
 */
function topLevelBlock(manifestText, key) {
  const all = manifestText.split(/\r?\n/);
  const start = all.findIndex((line) => new RegExp(`^${key}:[ \\t]*(?:#.*)?$`).test(line));
  if (start === -1) return { found: false, lines: [] };
  const lines = [];
  for (let index = start + 1; index < all.length; index += 1) {
    const raw = all[index].replace(/\s+$/, '');
    if (raw === '') continue;
    if (!/^[ \t]/.test(raw)) break;
    if (/^\s*#/.test(raw)) continue;
    lines.push({ indent: raw.match(/^[ \t]*/)[0].length, text: raw.trim(), line: index + 1, raw });
  }
  return { found: true, lines };
}

/** Parse `[a, b]` / `[]`; returns null when the text is not a flow sequence. */
function flowList(value) {
  if (!/^\[.*\]$/.test(value)) return null;
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter((entry) => entry !== '');
}

/** Strip a trailing comment and surrounding quotes from a scalar value. */
function scalarValue(value) {
  return value.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
}

/**
 * @description Read a manifest's `schedules:` block into one record per declared schedule.
 *  Only the keys this gate judges are extracted; a nested mapping (`body:`) is skipped wholesale,
 *  because its contents are the kernel's business and never this gate's.
 * @param {string} manifestText The raw oshal-app.yaml text.
 * @param {string} label How to name this manifest in a problem message.
 * @returns {{ schedules: Array<object>|null, problems: string[] }} `schedules` is null when the
 *  manifest declares no block at all OR when the block could not be read; the two are told apart
 *  by `problems`, which is empty only in the first case.
 */
export function readManifestSchedules(manifestText, label = 'oshal-app.yaml') {
  const problems = [];
  const { found, lines } = topLevelBlock(manifestText, 'schedules');
  if (!found) return { schedules: null, problems };

  const schedules = [];
  let current = null;
  let requiresList = null;
  let nestedIndent = null;

  for (const entry of lines) {
    if (entry.raw.includes('\t')) {
      problems.push(`${label}:${entry.line} indents the schedules block with a tab`);
      return { schedules: null, problems };
    }
    // Inside a nested mapping (body:) — skip until the indentation returns to the entry's keys.
    if (nestedIndent !== null && entry.indent >= nestedIndent) continue;
    nestedIndent = null;

    if (entry.indent === 2 && entry.text.startsWith('- ')) {
      current = { line: entry.line, keys: new Set() };
      schedules.push(current);
      requiresList = null;
      const first = /^- ([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(entry.text);
      if (!first) {
        problems.push(`${label}:${entry.line} starts a schedule with something other than a key: ${JSON.stringify(entry.text)}`);
        return { schedules: null, problems };
      }
      current.keys.add(first[1]);
      const firstValue = scalarValue(first[2]);
      // The key on the dash line sits two columns further in, so its nested lines start four deeper.
      if (firstValue === '' || /^[>|]\d*[+-]?$/.test(firstValue)) nestedIndent = entry.indent + 4;
      current[first[1]] = firstValue === '' ? {} : firstValue;
      continue;
    }
    if (!current) {
      problems.push(`${label}:${entry.line} is inside schedules but outside any schedule entry`);
      return { schedules: null, problems };
    }
    if (requiresList && entry.indent === 6 && entry.text.startsWith('- ')) {
      requiresList.push(scalarValue(entry.text.slice(2)));
      continue;
    }
    requiresList = null;
    if (entry.indent !== 4) {
      problems.push(`${label}:${entry.line} indents a schedule key by ${entry.indent}; expected 4`);
      return { schedules: null, problems };
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(entry.text);
    if (!match) {
      problems.push(`${label}:${entry.line} is not a schedule key: ${JSON.stringify(entry.text)}`);
      return { schedules: null, problems };
    }
    const [, key, rest] = match;
    if (current.keys.has(key)) problems.push(`${label}:${entry.line} declares "${key}" twice in one schedule`);
    current.keys.add(key);
    const value = scalarValue(rest);
    if (key === 'requires') {
      const parsed = flowList(value);
      if (parsed !== null) { current.requires = parsed; continue; }
      if (value === '') { requiresList = []; current.requires = requiresList; continue; }
      problems.push(`${label}:${entry.line} requires is neither a flow list nor a block sequence: ${JSON.stringify(value)}`);
      return { schedules: null, problems };
    }
    // A nested mapping (`body:`) or a block scalar (`prompt: >-`) owns every deeper line. Neither
    // is this gate's business, so skip to the next key at the entry's own indentation.
    if (value === '' || /^[>|]\d*[+-]?$/.test(value)) { nestedIndent = entry.indent + 2; current[key] = value === '' ? {} : ''; continue; }
    current[key] = value;
  }

  if (problems.length) return { schedules: null, problems };
  return { schedules, problems };
}

/**
 * @description Read the permission names an application's imported authorization catalog defines.
 * @param {string} packageDirectory Absolute path to the package folder.
 * @param {string} manifestText The raw oshal-app.yaml text.
 * @param {string} label How to name this manifest in a problem message.
 * @returns {{ permissions: string[]|null, problems: string[] }} `permissions` is null when the
 *  manifest imports no catalog at all — which is not an error by itself, but makes any `requires`
 *  un-declarable, because the loader refuses a permission no catalog defines.
 */
export function readAuthorizationPermissions(packageDirectory, manifestText, label = 'oshal-app.yaml') {
  const problems = [];
  const { found, lines } = topLevelBlock(manifestText, 'authorization');
  if (!found) return { permissions: null, problems };
  const file = lines.find((entry) => entry.indent === 2 && entry.text.startsWith('catalog:'));
  if (!file) {
    problems.push(`${label}: authorization block declares no catalog file`);
    return { permissions: null, problems };
  }
  const relative = scalarValue(file.text.slice('catalog:'.length));
  if (!/^[A-Za-z0-9_./-]+\.ya?ml$/.test(relative) || relative.startsWith('/')
      || relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    problems.push(`${label}: authorization.catalog is not a package-relative YAML path: ${JSON.stringify(relative)}`);
    return { permissions: null, problems };
  }
  const catalogPath = path.join(packageDirectory, relative);
  if (!fs.existsSync(catalogPath)) {
    problems.push(`${label}: authorization.catalog names a missing file: ${relative}`);
    return { permissions: null, problems };
  }
  const block = topLevelBlock(fs.readFileSync(catalogPath, 'utf8'), 'permissions');
  if (!block.found) {
    problems.push(`${relative}: authorization catalog declares no permissions block`);
    return { permissions: null, problems };
  }
  const permissions = block.lines
    .filter((entry) => entry.indent === 2)
    .map((entry) => /^([A-Za-z0-9][A-Za-z0-9_.:-]*):/.exec(entry.text)?.[1])
    .filter(Boolean);
  return { permissions, problems };
}

/**
 * @description Judge one schedule's ADR-157 activation declaration.
 * @param {object} schedule One parsed schedule record.
 * @param {string[]|null} permissions The app's catalog permission names, or null when it imports none.
 * @param {string} label How to name this manifest in a problem message.
 * @returns {string[]} Every problem with this declaration.
 */
function activationProblems(schedule, permissions, label) {
  const problems = [];
  const id = typeof schedule.id === 'string' ? schedule.id : `(line ${schedule.line})`;
  const where = `${label}: schedule "${id}"`;
  if (!schedule.keys.has('runsAs')) {
    problems.push(`${where} is a service-route schedule with no runsAs (ADR-157). Declare system or user: `
      + 'an unclassified service cannot be activated, so it never runs and never says why.');
  } else if (!RUNS_AS.includes(schedule.runsAs)) {
    problems.push(`${where} declares runsAs=${JSON.stringify(schedule.runsAs)}; the loader accepts only ${RUNS_AS.join(' or ')}`);
  }
  if (!schedule.keys.has('requires')) return problems;
  const requires = schedule.requires;
  if (!Array.isArray(requires) || requires.length === 0) {
    problems.push(`${where} declares an empty requires; omit the key instead (the loader refuses an empty list)`);
    return problems;
  }
  if (requires.length > MAX_REQUIRES) {
    problems.push(`${where} requires ${requires.length} permissions; the loader allows at most ${MAX_REQUIRES}`);
  }
  const duplicates = requires.filter((name, index) => requires.indexOf(name) !== index);
  if (duplicates.length) problems.push(`${where} names ${[...new Set(duplicates)].join(', ')} twice in requires`);
  if (permissions === null) {
    problems.push(`${where} declares requires but this package imports no authorization catalog. `
      + 'The loader refuses the WHOLE manifest for this (ADR-149 §4), so the app would not install at all. '
      + 'Import a catalog (authorization: { version: 1, catalog: <file> }) or drop requires.');
    return problems;
  }
  const undefinedNames = [...new Set(requires)].filter((name) => !permissions.includes(name));
  if (undefinedNames.length) {
    problems.push(`${where} requires permission(s) this package's authorization catalog does not define: `
      + `${undefinedNames.join(', ')}. Known: ${permissions.join(', ') || '(none)'}`);
  }
  return problems;
}

/**
 * @description Every ADR-157 activation-declaration problem across the store, without mutating it.
 * @param {string} repositoryRoot Store checkout to inspect.
 * @returns {string[]} Problems in package order; empty means every declaration is sound.
 */
export function serviceActivationProblems(repositoryRoot = REPOSITORY_ROOT) {
  const problems = [];
  const packageDirs = fs.readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .filter((entry) => fs.existsSync(path.join(repositoryRoot, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();

  for (const directory of packageDirs) {
    const label = `${directory}/oshal-app.yaml`;
    const packageDirectory = path.join(repositoryRoot, directory);
    const manifestText = fs.readFileSync(path.join(packageDirectory, 'oshal-app.yaml'), 'utf8');
    const { schedules, problems: readProblems } = readManifestSchedules(manifestText, label);
    problems.push(...readProblems);
    if (!schedules) continue;
    const serviceRoutes = schedules.filter((schedule) => schedule.target === 'service-route');
    if (serviceRoutes.length === 0) continue;
    const catalog = readAuthorizationPermissions(packageDirectory, manifestText, label);
    problems.push(...catalog.problems);
    for (const schedule of serviceRoutes) problems.push(...activationProblems(schedule, catalog.permissions, label));
  }
  return problems;
}

/** @description Fail the gate when any service-route schedule's activation declaration is unsound. */
export function main(repositoryRoot = REPOSITORY_ROOT) {
  const problems = serviceActivationProblems(repositoryRoot);
  if (problems.length) {
    console.error(`Scheduled service declarations failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const covered = fs.readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(repositoryRoot, entry.name, 'oshal-app.yaml')))
    .flatMap((entry) => {
      const text = fs.readFileSync(path.join(repositoryRoot, entry.name, 'oshal-app.yaml'), 'utf8');
      return (readManifestSchedules(text, entry.name).schedules ?? []).filter((s) => s.target === 'service-route');
    });
  console.log(`Scheduled service declarations passed: ${covered.length} service-route schedule(s) classified`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? path.resolve(process.argv[2]) : REPOSITORY_ROOT);
}
