#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Make every package-test command in store-ci prove a non-empty file set before its runner can report green.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Fail closed on every package-local workflow command, folded run block, and missing npm-script test path without a mutable command-count floor.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Compare every discovered package command to a reviewed exact ledger so deleted and newly added jobs both require an intentional update.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @description Expand the single-directory wildcard shapes deliberately used by store-ci. */
function expandPattern(root, packageDir, pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  if (!normalized.startsWith('tests/') || dirname(normalized).includes('*')) {
    throw new Error(`${packageDir}: unsupported node --test path ${pattern}`);
  }
  const directory = join(root, packageDir, dirname(normalized));
  if (!existsSync(directory)) return [];
  const expression = new RegExp(`^${basename(normalized)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')}$`);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && expression.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** @description Resolve the files an npm test script names explicitly. */
function npmTestFiles(root, packageDir) {
  const packagePath = join(root, packageDir, 'package.json');
  if (!existsSync(packagePath)) throw new Error(`${packageDir}: npm test has no package.json`);
  const script = JSON.parse(readFileSync(packagePath, 'utf8')).scripts?.test;
  if (typeof script !== 'string' || !script.trim()) throw new Error(`${packageDir}: npm test script is empty`);
  const paths = [...script.matchAll(/(?:^|\s)(tests\/[A-Za-z0-9._/-]+\.test\.(?:cjs|mjs|js|ts))/g)]
    .map((match) => match[1]);
  if (paths.length === 0) throw new Error(`${packageDir}: npm test names no test files`);
  const duplicates = paths.filter((file, index) => paths.indexOf(file) !== index);
  if (duplicates.length) throw new Error(`${packageDir}: npm test repeats ${[...new Set(duplicates)].join(', ')}`);
  const missing = paths.filter((file) => !existsSync(join(root, packageDir, file)));
  if (missing.length) throw new Error(`${packageDir}: npm test names missing file(s): ${missing.join(', ')}`);
  return paths;
}

/** @description Resolve an explicit repository-root node:test command used for cross-package suites. */
function rootNodeTestFiles(root, command, workflowPath, stepName) {
  const rest = command.replace(/^node\s+--test\s+/, '');
  const paths = [...rest.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  if (paths.length === 0) throw new Error(`${workflowPath}: root test step ${stepName} names no files`);
  for (const file of paths) {
    const normalized = file.replaceAll('\\', '/');
    const full = resolve(root, normalized);
    const rel = relative(root, full);
    if (isAbsolute(file) || !rel || rel === '..' || rel.startsWith(`..${sep}`)) {
      throw new Error(`${workflowPath}: root test path escapes the store: ${file}`);
    }
    if (!/\.test\.(?:cjs|mjs|js|ts)$/.test(normalized)) {
      throw new Error(`${workflowPath}: root test step ${stepName} names unsupported path ${file}`);
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      throw new Error(`${workflowPath}: root test step ${stepName} names missing file ${file}`);
    }
  }
  return paths;
}

/** @description Read a YAML `run` scalar, including literal/folded blocks, from one workflow step. */
function runCommand(stepLines, workflowPath, stepName) {
  const matches = stepLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s+run:\s*/.test(line));
  if (matches.length !== 1) {
    throw new Error(`${workflowPath}: package step ${stepName} must declare exactly one run command`);
  }
  const { line, index } = matches[0];
  const field = /^(\s+)run:\s*(.*?)\s*$/.exec(line);
  const value = field?.[2] ?? '';
  if (!/^[>|][+-]?$/.test(value)) return value.trim();
  const indentation = field[1].length;
  const body = [];
  for (let cursor = index + 1; cursor < stepLines.length; cursor += 1) {
    const bodyLine = stepLines[cursor];
    if (bodyLine.trim() && (bodyLine.match(/^ */)?.[0].length ?? 0) <= indentation) break;
    if (bodyLine.trim()) body.push(bodyLine.trim());
  }
  if (body.length === 0) throw new Error(`${workflowPath}: package step ${stepName} has an empty run block`);
  return value.startsWith('>') ? body.join(' ') : body.join('\n');
}

/** @description Extract every package-local workflow step without relying on line adjacency. */
function packageCommandSteps(source, workflowPath) {
  const lines = source.split(/\r?\n/);
  const steps = [];
  let namedWorkingDirectories = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const header = /^(\s*)-\s+name:\s*(.+?)\s*$/.exec(lines[index]);
    if (!header) continue;
    const stepIndent = header[1].length;
    let end = index + 1;
    for (; end < lines.length; end += 1) {
      const nextHeader = /^(\s*)-\s+name:\s*/.exec(lines[end]);
      if (nextHeader && nextHeader[1].length === stepIndent) break;
      if (lines[end].trim() && !lines[end].trimStart().startsWith('#')
          && (lines[end].match(/^ */)?.[0].length ?? 0) < stepIndent) break;
    }
    const stepLines = lines.slice(index, end);
    const directories = stepLines
      .map((line) => /^\s+working-directory:\s*([^\s#]+)\s*$/.exec(line)?.[1])
      .filter(Boolean);
    if (directories.length > 1) throw new Error(`${workflowPath}: package step ${header[2]} repeats working-directory`);
    if (directories.length === 1) {
      namedWorkingDirectories += 1;
      steps.push({ packageDir: directories[0], command: runCommand(stepLines, workflowPath, header[2]), name: header[2] });
    } else if (stepLines.some((line) => /^\s+run:\s*/.test(line))) {
      const command = runCommand(stepLines, workflowPath, header[2]);
      if (/^node\s+--test(?:\s|$)/.test(command)) {
        steps.push({ packageDir: '.', command, name: header[2] });
      } else if (/^npm\s+test(?:\s|$)/.test(command)) {
        throw new Error(`${workflowPath}: test command in ${header[2]} has no package working-directory`);
      }
    }
    index = end - 1;
  }
  const declaredWorkingDirectories = lines.filter((line) => /^\s+working-directory:\s*/.test(line)).length;
  if (namedWorkingDirectories !== declaredWorkingDirectories) {
    throw new Error(`${workflowPath}: every working-directory must belong to a named package step`);
  }
  return steps;
}

/** @description Resolve and validate a package-local workflow directory inside the store root. */
function validatePackageDir(root, packageDir, workflowPath) {
  const full = resolve(root, packageDir);
  const rel = relative(root, full);
  if (isAbsolute(packageDir) || !rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${workflowPath}: package working-directory escapes the store: ${packageDir}`);
  }
  if (!existsSync(join(full, 'oshal-app.yaml'))) {
    throw new Error(`${workflowPath}: package working-directory has no oshal-app.yaml: ${packageDir}`);
  }
}

/** @description Parse each package-local store-ci test command and prove its discovery set. */
export function discoverStoreCiTests(root = process.cwd()) {
  const workflowPath = join(root, '.github', 'workflows', 'store-ci.yml');
  const discoveries = [];
  const source = readFileSync(workflowPath, 'utf8');
  for (const { packageDir, command, name } of packageCommandSteps(source, workflowPath)) {
    if (packageDir === '.') {
      const files = rootNodeTestFiles(root, command, workflowPath, name);
      discoveries.push({ packageDir, command, count: files.length });
      continue;
    }
    validatePackageDir(root, packageDir, workflowPath);
    const glob = /^node\s+--test\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/.exec(command);
    const files = glob ? expandPattern(root, packageDir, glob[1] ?? glob[2] ?? glob[3])
      : command === 'npm test' ? npmTestFiles(root, packageDir) : null;
    if (!files) throw new Error(`${workflowPath}: unrecognized package command in ${name}: ${command}`);
    discoveries.push({ packageDir, command, count: files.length });
  }
  return discoveries;
}

/** @description Require the exact reviewed set of package-local store-ci commands. */
export function assertStoreCiTestInventory(root, discoveries) {
  const inventoryPath = join(root, 'scripts', 'security', 'store-test-command-inventory.json');
  if (!existsSync(inventoryPath)) throw new Error(`Reviewed store-ci test command inventory is missing: ${inventoryPath}`);
  const document = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.commands) || document.commands.length === 0) {
    throw new Error(`${inventoryPath}: expected schemaVersion 1 and a non-empty commands array`);
  }
  if (document.commands.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${inventoryPath}: every reviewed command must be a non-empty string`);
  }
  const expected = [...document.commands].sort();
  const actual = discoveries.map((entry) => `${entry.packageDir}|${entry.command}`).sort();
  if (new Set(expected).size !== expected.length) throw new Error(`${inventoryPath}: reviewed commands contain duplicates`);
  if (new Set(actual).size !== actual.length) throw new Error('store-ci repeats a reviewed package test command');
  const added = actual.filter((entry) => !expected.includes(entry));
  const stale = expected.filter((entry) => !actual.includes(entry));
  if (added.length || stale.length) {
    throw new Error(`Store CI test command inventory drifted; added=${JSON.stringify(added)}, stale=${JSON.stringify(stale)}`);
  }
}

/** @description Fail if a job/glob disappears or any declared package test resolves to zero files. */
export function main(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  const discoveries = discoverStoreCiTests(resolvedRoot);
  if (discoveries.length === 0) throw new Error('store-ci declares no package-local test commands');
  const empty = discoveries.filter((entry) => entry.count === 0);
  if (empty.length) throw new Error(`store-ci has empty test discovery: ${JSON.stringify(empty)}`);
  assertStoreCiTestInventory(resolvedRoot, discoveries);
  console.log(`Store CI discovery passed: ${discoveries.length} commands, ${discoveries.reduce((n, entry) => n + entry.count, 0)} files`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
