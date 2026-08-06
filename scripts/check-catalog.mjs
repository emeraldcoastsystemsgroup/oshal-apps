#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Add the zero-dependency catalog integrity gate: every package manifest has exactly one catalog entry, mirrored identity/version/suite/displayName/source fields agree, the retired archive URL is forbidden, and the generated README is current.
 * 2026-08-06 00:10:00 | maintainer@emeraldcoastsystemsgroup.com   | Export the checker and allow fixture-only README-generation suppression so mutation tests can prove fail-closed drift detection without invoking repository-local generator code from a temporary tree.
 *
 * Usage: node scripts/check-catalog.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CURRENT_SCHEMA = 'https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/085-remote-app-packages-and-registries.md';

/** Read a top-level one-line YAML scalar without adding a YAML runtime dependency to CI. */
function scalar(text, key) {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(text);
  if (!match) return null;
  return match[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
}

/** Read a one-line scalar from the manifest's two-space-indented mapping block. */
function mappingScalar(text, mapping, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${mapping}:[ \\t]*(?:#.*)?$`).test(line));
  if (start === -1) return null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(line)) break;
    const match = new RegExp(`^  ${key}:[ \\t]*(.+)$`).exec(line);
    if (match) return match[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/** Return every catalog/manifest/generated-document drift without mutating the repository. */
export function catalogProblems(repositoryRoot = REPOSITORY_ROOT, { checkGeneratedReadme = true } = {}) {
  const problems = [];
  const marketplacePath = path.join(repositoryRoot, 'marketplace.json');
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  if (marketplace.$schema !== CURRENT_SCHEMA) {
    problems.push(`marketplace.json $schema must be ${CURRENT_SCHEMA}`);
  }
  if (!Array.isArray(marketplace.apps)) {
    return [...problems, 'marketplace.json apps must be an array'];
  }

  const duplicateNames = marketplace.apps
    .map((app) => app?.name)
    .filter((name, index, names) => typeof name === 'string' && names.indexOf(name) !== index);
  if (duplicateNames.length) problems.push(`marketplace.json repeats app name(s): ${[...new Set(duplicateNames)].join(', ')}`);

  const remaining = new Map(marketplace.apps.map((app) => [app?.name, app]));
  const packageDirs = fs.readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .filter((entry) => fs.existsSync(path.join(repositoryRoot, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();

  for (const directory of packageDirs) {
    const manifestText = fs.readFileSync(path.join(repositoryRoot, directory, 'oshal-app.yaml'), 'utf8');
    const packageName = scalar(manifestText, 'name');
    if (!packageName) {
      problems.push(`${directory}/oshal-app.yaml has no top-level name`);
      continue;
    }
    const entry = remaining.get(packageName);
    if (!entry) {
      problems.push(`${directory} (${packageName}) has no marketplace.json entry`);
      continue;
    }
    remaining.delete(packageName);

    for (const key of ['version', 'suite', 'displayName']) {
      const manifestValue = scalar(manifestText, key);
      if (!manifestValue) problems.push(`${directory}/oshal-app.yaml has no top-level ${key}`);
      else if (String(entry[key]) !== manifestValue) {
        problems.push(`${directory}: catalog ${key}=${JSON.stringify(entry[key])}, manifest ${key}=${JSON.stringify(manifestValue)}`);
      }
    }

    for (const key of ['type', 'url', 'path', 'ref']) {
      const manifestValue = mappingScalar(manifestText, 'source', key);
      if (!manifestValue) problems.push(`${directory}/oshal-app.yaml source has no ${key}`);
      else if (String(entry.source?.[key]) !== manifestValue) {
        problems.push(`${directory}: catalog source.${key}=${JSON.stringify(entry.source?.[key])}, manifest source.${key}=${JSON.stringify(manifestValue)}`);
      }
    }
  }

  for (const [name, entry] of remaining) {
    if (entry) problems.push(`marketplace.json lists ${JSON.stringify(name)} without a package manifest`);
  }

  for (const relativePath of ['marketplace.json', 'README.md']) {
    const text = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      if (line.includes('/open-shal/') || line.includes('/open-shal.git')) {
        problems.push(`${relativePath}:${index + 1} references the retired open-shal archive`);
      }
    });
  }

  if (checkGeneratedReadme) {
    try {
      execFileSync(
        process.execPath,
        [path.join(repositoryRoot, 'scripts', 'gen-readme-apps-table.mjs'), '--check'],
        { cwd: repositoryRoot, stdio: 'pipe' },
      );
    } catch {
      problems.push('README.md generated apps table is stale; run node scripts/gen-readme-apps-table.mjs');
    }
  }

  return problems;
}

export function main(repositoryRoot = REPOSITORY_ROOT) {
  const problems = catalogProblems(repositoryRoot);
  if (problems.length) {
    console.error(`Catalog integrity failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const packageCount = fs.readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(repositoryRoot, entry.name, 'oshal-app.yaml')))
    .length;
  console.log(`Catalog integrity passed: ${packageCount} package manifests, catalog entries, and generated README rows agree`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
