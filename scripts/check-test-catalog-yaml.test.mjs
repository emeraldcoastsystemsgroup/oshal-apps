/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-prove the strict catalog YAML check with no framework checkout. Camera's real catalog passes, and the same file with its tool_call purpose unquoted again (the 2026-11-19 shape that took twelve packages' Test Lab down) is refused by both parsers, naming camera, the file and the line. Text js-yaml accepts and libyaml refuses (a U+2028 inside a plain value; an implicit key over 1024 characters) is red, so the libyaml leg is load-bearing; a duplicate key, two documents, an application tag, a list used as a key and a catalog with no cases list are each red. The single-quoted form keeps the exact text. A declared catalog path is the one judged, an undeclared conventional catalog is still judged, a store with no catalog and a missing libyaml each refuse, the CLI exits non-zero on a refused catalog, and it still judges when started through a linked scripts folder (the shape that once exited 0 having read nothing).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A python3 with no PyYAML first on PATH (the gate puts Career's fixture virtual environment there) no longer fails the check: the CLI under that PATH still refuses the unquoted tool_call purpose by libyaml and passes the quoted one, and only a list of interpreters none of which has libyaml refuses, naming each.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { libyamlProblems, storeYamlProblems, toolchainYaml } from './check-test-catalog-yaml.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '..');
const GATE = path.join(HERE, 'check-test-catalog-yaml.mjs');
const FIXTURE_PREFIX = 'check-test-catalog-yaml-';
const CATALOG = 'tests/test-lab.yaml';
const MANIFEST = ['name: sample', 'testing:', '  version: 1', `  catalog: ${CATALOG}`, ''].join('\n');
const yaml = toolchainYaml(REPOSITORY_ROOT);

/**
 * @description A one-case catalog whose purpose line is given as raw YAML text.
 * @param {string} purposeLine The whole `purpose:` line, indentation excluded.
 * @returns {string} The catalog text.
 */
function catalogWith(purposeLine) {
  return ['version: 1', 'cases:', '  - id: sample-case', '    name: Sample case', `    ${purposeLine}`, '    level: unit', ''].join('\n');
}

/**
 * @description Build a disposable store of packages from raw manifest and catalog text.
 * @param {Record<string, { manifest?: string, catalog?: string, catalogPath?: string }>} packages Package name to contents.
 * @returns {string} The fixture store root.
 */
function makeStore(packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  for (const [name, contents] of Object.entries(packages)) {
    const write = (relative, text) => {
      fs.mkdirSync(path.dirname(path.join(root, name, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, name, relative), text);
    };
    write('oshal-app.yaml', (contents.manifest ?? MANIFEST).replace('name: sample', `name: ${name}`));
    if (contents.catalog !== undefined) write(contents.catalogPath ?? CATALOG, contents.catalog);
  }
  return root;
}

/** @description Remove a fixture store, refusing any path that is not one of this suite's own. */
function removeStore(root) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  if (!relative.startsWith(FIXTURE_PREFIX) || relative.includes(path.sep)) throw new Error(`Unsafe fixture cleanup: ${root}`);
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * @description Judge one fixture store and remove it.
 * @param {Record<string, object>} packages As makeStore.
 * @returns {{ catalogs: number, problems: string[] }} The check's verdict.
 */
function judge(packages) {
  const root = makeStore(packages);
  try {
    return storeYamlProblems(root, { yaml });
  } finally {
    removeStore(root);
  }
}

test("camera's real catalog passes, and its tool_call purpose unquoted again is refused by both parsers at that line", () => {
  const real = fs.readFileSync(path.join(REPOSITORY_ROOT, 'camera', CATALOG), 'utf8');
  const quoted = /^ {4}purpose: '(Verify camera-operator [^\n]*```tool_call \{"tool": \.\.\.\}[^\n]*)'$/m.exec(real);
  assert.ok(quoted, 'camera keeps its tool_call contract purpose as one single-quoted line');
  const line = real.slice(0, quoted.index).split('\n').length;
  assert.deepEqual(judge({ camera: { catalog: real } }), { catalogs: 1, problems: [] });
  const unquoted = real.replace(quoted[0], `    purpose: ${quoted[1].replace(/''/g, "'")}`);
  const { problems } = judge({ camera: { catalog: unquoted } });
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], new RegExp(`^camera: ${CATALOG} is refused by the kernel's parser \\(libyaml, as serde_yaml reads it\\): line ${line}, column \\d+: mapping values are not allowed`));
  assert.match(problems[1], new RegExp(`^camera: ${CATALOG} is refused by js-yaml \\(the framework loader's parser\\): .*\\(${line}:\\d+\\)`));
});

test('the single-quoted form keeps backticks, braces, double quotes, # and a doubled quote exactly as written', () => {
  const text = 'Verify manifest hideChatPanel: false, cockpit #chatPanel, { flipX: false } and ```tool_call {"tool": ...} for the bot\'s oshald.';
  const catalog = catalogWith(`purpose: '${text.replace(/'/g, "''")}'`);
  assert.deepEqual(judge({ sample: { catalog } }), { catalogs: 1, problems: [] });
  assert.equal(yaml.load(catalog, { schema: yaml.JSON_SCHEMA }).cases[0].purpose, text);
});

test('text js-yaml accepts and libyaml refuses is red: the libyaml leg is the one the kernel runs', () => {
  const lineSeparator = catalogWith('purpose: one two');
  const longKey = catalogWith(`${'k'.repeat(1100)}: value`);
  for (const catalog of [lineSeparator, longKey]) {
    assert.ok(Array.isArray(yaml.load(catalog, { schema: yaml.JSON_SCHEMA }).cases), 'js-yaml alone accepts this text');
    const { problems } = judge({ sample: { catalog } });
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^sample: tests\/test-lab\.yaml is refused by the kernel's parser \(libyaml, as serde_yaml reads it\): line \d+, column \d+: /);
  }
});

test('a duplicate key, two documents, an application tag, a list used as a key and no cases list are each refused', () => {
  const shapes = {
    duplicate: [catalogWith('purpose: first').replace('    level: unit', '    level: unit\n    level: browser'), /refused by js-yaml .*duplicated mapping key/],
    documents: [`${catalogWith('purpose: one')}---\nversion: 2\n`, /refused by the kernel's parser .*more than one YAML document/],
    tag: [catalogWith('purpose: !shell echo'), /refused by the kernel's parser .*line 5: the tag !shell/],
    listKey: [catalogWith('? [a, b]\n    : value'), /refused by the kernel's parser .*line 5: a list or mapping used as a key/],
    noCases: ['version: 1\ntests: []\n', /refused by the kernel's parser .*the catalog has no cases list/],
  };
  for (const [name, [catalog, expected]] of Object.entries(shapes)) {
    const { problems } = judge({ sample: { catalog } });
    assert.ok(problems.some((problem) => expected.test(problem)), `${name}: ${problems.join('\n') || 'passed'}`);
  }
});

test('the declared catalog path is the one judged, and an undeclared conventional catalog is still judged', () => {
  const broken = catalogWith('purpose: plain then hideChatPanel: false');
  const declaredElsewhere = ['name: sample', 'testing:', '  version: 1', '  catalog: lab/cases.yaml', ''].join('\n');
  const declared = judge({ sample: { manifest: declaredElsewhere, catalog: broken, catalogPath: 'lab/cases.yaml' } });
  assert.equal(declared.catalogs, 1);
  assert.match(declared.problems[0], /^sample: lab\/cases\.yaml is refused by the kernel's parser/);
  const missing = judge({ sample: { manifest: declaredElsewhere } });
  assert.deepEqual(missing.problems, ['sample: the declared catalog lab/cases.yaml is missing']);
  const undeclared = judge({ sample: { manifest: 'name: sample\n', catalog: broken } });
  assert.equal(undeclared.catalogs, 1);
  assert.match(undeclared.problems[0], /^sample: tests\/test-lab\.yaml is refused by the kernel's parser/);
});

test('a store with no catalog and a python3 without libyaml each refuse rather than pass unchecked', () => {
  const root = makeStore({ plain: { manifest: 'name: sample\n' } });
  try {
    const run = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no package Test Lab catalog was found .* refusing a vacuous pass/);
  } finally {
    removeStore(root);
  }
  assert.throws(() => libyamlProblems(['/nonexistent.yaml'], { pythons: [path.join(os.tmpdir(), 'no-such-python3')] }), /The libyaml leg did not run .* refusing rather than passing unchecked/);
});

/**
 * @description A python3 with no PyYAML, as the gate's PATH puts first (Career's fixture virtual
 *   environment): the system interpreter started without its site packages.
 * @param {string} root A fixture store root to hold the bin folder.
 * @returns {string} The bin folder holding that python3.
 */
function pythonWithoutYaml(root) {
  const bin = path.join(root, 'no-yaml-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'python3'), '#!/bin/sh\nexec /usr/bin/python3 -S "$@"\n', { mode: 0o755 });
  return bin;
}

test('a python3 without PyYAML first on PATH falls back to the system python3, and refuses only when none has libyaml', () => {
  const root = makeStore({ sample: { catalog: catalogWith('purpose: Verify plain-prose + ```tool_call {"tool": ...} syntax.') } });
  try {
    const bin = pythonWithoutYaml(root);
    const first = spawnSync(path.join(bin, 'python3'), ['-I', '-c', 'import yaml'], { encoding: 'utf8' });
    assert.notEqual(first.status, 0, 'the PATH-first python3 really has no PyYAML');
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const red = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8', env });
    assert.equal(red.status, 1, red.stdout);
    assert.match(red.stderr, /sample: tests\/test-lab\.yaml is refused by the kernel's parser \(libyaml, as serde_yaml reads it\): line 5, column \d+: mapping values are not allowed/);
    assert.doesNotMatch(red.stderr, /The libyaml leg did not run/);
    fs.writeFileSync(path.join(root, 'sample', CATALOG), catalogWith('purpose: \'Verify plain-prose + ```tool_call {"tool": ...} syntax.\''));
    const green = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8', env });
    assert.equal(green.status, 0, green.stderr);
    const file = path.join(root, 'sample', CATALOG);
    assert.throws(() => libyamlProblems([file], { pythons: [path.join(bin, 'python3')] }), new RegExp(`The libyaml leg did not run \\(${bin}/python3: this python3 has no PyYAML built with libyaml`));
  } finally {
    removeStore(root);
  }
});

test('the CLI exits non-zero naming the refused catalog, and zero on a store that parses', () => {
  const root = makeStore({ sample: { catalog: catalogWith('purpose: Verify plain-prose + ```tool_call {"tool": ...} syntax.') } });
  try {
    const red = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8' });
    assert.equal(red.status, 1);
    assert.match(red.stderr, /sample: tests\/test-lab\.yaml is refused by the kernel's parser \(libyaml, as serde_yaml reads it\): line 5, column \d+: mapping values are not allowed/);
    assert.match(red.stderr, /Quote the value/);
    fs.writeFileSync(path.join(root, 'sample', CATALOG), catalogWith('purpose: \'Verify plain-prose + ```tool_call {"tool": ...} syntax.\''));
    const green = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8' });
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /Package test catalogs parse in libyaml \(the kernel's serde_yaml parser\) and js-yaml: 1 catalogs/);
  } finally {
    removeStore(root);
  }
});

test('started through a linked scripts folder the CLI still judges, never exiting 0 having read nothing', () => {
  const root = makeStore({ sample: { catalog: catalogWith('purpose: Verify manifest hideChatPanel: false.') } });
  try {
    fs.symlinkSync(HERE, path.join(root, 'linked-scripts'));
    const run = spawnSync(process.execPath, [path.join(root, 'linked-scripts', path.basename(GATE)), root], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /sample: tests\/test-lab\.yaml is refused by the kernel's parser/);
  } finally {
    removeStore(root);
  }
});
