/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:09:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard executable-line caps and exact Roger-authored Change Log headers for the modular character importer, multiplayer guard, migrations, personas, and D&D test suite.
 * 2026-07-21 20:12:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extend the header contract to every production module, every test, and the package manifest after concurrent ownership ended.
 * 2026-07-21 22:43:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Enforce the repository-wide 800-line decomposition threshold and sub-50-line function rule for every D&D JavaScript module and regression guard.
 * 2026-08-06 02:43:35 | maintainer@emeraldcoastsystemsgroup.com     | Keep historical Roger-authored entries valid while requiring every new automation-owned change to use the approved project maintainer identity.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const AUTHORS = new Set([
  'roger.murphy@emeraldcoastsystemsgroup.com',
  'maintainer@emeraldcoastsystemsgroup.com',
]);
/** @description Read one package-relative UTF-8 source with normalized newlines. */
function sourceOf(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

/** @description Recognize a formatted declaration, method, callback, or block arrow. */
function functionStart(line) {
  const code = line.trim();
  if (!code || code.startsWith('//') || code.startsWith('*')) return false;
  const declaration = /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\s*=\s*)?(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(/;
  if (declaration.test(code) || /=>\s*\{\s*$/.test(code)) return true;
  const method = /^(?:(?:async|static|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/.exec(code);
  return !!(method && !['if', 'for', 'while', 'switch', 'catch', 'with'].includes(method[1]));
}

/** @description Measure consistently indented JavaScript function blocks. */
function functionBlocks(source) {
  const lines = source.split('\n'), blocks = [];
  for (let start = 0; start < lines.length; start++) {
    if (!functionStart(lines[start])) continue;
    const indent = (lines[start].match(/^\s*/) || [''])[0];
    if (lines[start].includes('{') && lines[start].includes('}')) { blocks.push({ line: start + 1, count: 1 }); continue; }
    let end = start + 1;
    while (end < lines.length && !new RegExp(`^${indent.replace(/\t/g, '\\t')}\\}`).test(lines[end])) end++;
    blocks.push({ line: start + 1, count: end < lines.length ? end - start + 1 : Infinity });
  }
  return blocks;
}

/** @description Count nonblank lines after removing line-only and block comments. */
function executableLineCount(source) {
  let inBlock = false;
  let count = 0;
  for (const rawLine of source.split('\n')) {
    let line = rawLine;
    let visible = '';
    for (let index = 0; index < line.length;) {
      if (inBlock) {
        const end = line.indexOf('*/', index);
        if (end < 0) break;
        inBlock = false;
        index = end + 2;
      } else if (line.startsWith('/*', index)) {
        inBlock = true;
        index += 2;
      } else if (line.startsWith('//', index)) break;
      else visible += line[index++];
    }
    if (visible.trim()) count++;
  }
  return count;
}

/** @description Enumerate package files below one directory by extension. */
function filesBelow(relativeDir, extension) {
  const absolute = path.join(ROOT, relativeDir);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return filesBelow(relative, extension);
    return entry.name.endsWith(extension) ? [relative.replaceAll('\\', '/')] : [];
  });
}

/** @description Assert the exact block header and every dated author entry in a JS or SQL file. */
function assertBlockHeader(relativePath) {
  const source = sourceOf(relativePath);
  const header = source.slice(0, source.indexOf('*/') + 2);
  assert.match(source, /^\/\*\*\n \* CHANGE LOG\n \* -{77}\n \* DATE\/TIME\s+\| AUTHOR\s+\| DESCRIPTION\n \* -{77}/, relativePath);
  const entries = [...header.matchAll(/^ \* \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| ([^|]+?)\s+\|/gm)];
  assert.ok(entries.length, `${relativePath} needs a dated Change Log entry`);
  for (const entry of entries) assert.ok(AUTHORS.has(entry[1].trim()), relativePath);
  assert.doesNotMatch(header, /OpenAI Codex|Claude|System\s+\|/, relativePath);
}

/** @description Assert the YAML-safe equivalent of the exact Change Log header. */
function assertYamlHeader(relativePath) {
  const source = sourceOf(relativePath);
  assert.match(source, /^# CHANGE LOG\n# -{77}\n# DATE\/TIME\s+\| AUTHOR\s+\| DESCRIPTION\n# -{77}/, relativePath);
  const entries = [...source.matchAll(/^# \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| ([^|]+?)\s+\|/gm)];
  assert.ok(entries.length, `${relativePath} needs a dated Change Log entry`);
  for (const entry of entries) assert.ok(AUTHORS.has(entry[1].trim()), relativePath);
}

test('all D&D JavaScript stays below the 800 executable-line decomposition threshold', () => {
  const files = ['lib', 'routes', 'ui', 'tests'].flatMap((directory) => filesBelow(directory, '.js'));
  for (const relativePath of files) {
    assert.ok(executableLineCount(sourceOf(relativePath)) < 800, relativePath);
  }
});

test('all D&D functions stay below 50 physical lines', () => {
  const files = ['lib', 'routes', 'ui', 'tests'].flatMap((directory) => filesBelow(directory, '.js'));
  for (const relativePath of files) {
    for (const block of functionBlocks(sourceOf(relativePath))) {
      assert.ok(block.count < 50, `${relativePath}:${block.line}`);
    }
  }
});

test('owned production modules, migrations, and D&D tests have exact safe Change Logs', () => {
  const production = ['lib', 'routes', 'ui'].flatMap((directory) => filesBelow(directory, '.js'));
  const tests = filesBelow('tests', '.test.js');
  const migrations = filesBelow('migrations', '.sql');
  for (const relativePath of [...production, 'ui/dnd.css', ...migrations, ...tests]) {
    assertBlockHeader(relativePath);
  }
});

test('logic-bearing persona YAML uses full Chicago timestamp metadata', () => {
  for (const relativePath of ['oshal-app.yaml', ...filesBelow('personas', '.yaml')]) assertYamlHeader(relativePath);
});
