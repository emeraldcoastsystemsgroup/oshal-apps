/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard package-relative links, current install/build guidance, retired startup-path removal, and truthful inline operator help.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free documentation contract for the Little Monsters store package.
 * It deliberately runs under the existing tests/*.test.cjs store-CI glob.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DOC_EXTENSIONS = new Set(['.md', '.html']);

function collectFiles(root, predicate) {
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(fullPath, predicate));
    else if (predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

function read(relativePath) {
  return fs.readFileSync(path.join(PACKAGE_ROOT, relativePath), 'utf8');
}

function markdownLinkTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let raw = match[1].trim();
    if (raw.startsWith('<')) raw = raw.slice(1, raw.indexOf('>'));
    else raw = raw.split(/\s+["']/u, 1)[0];
    targets.push(raw);
  }
  return targets;
}

function localLinkPath(rawTarget) {
  if (!rawTarget || rawTarget.startsWith('#') || rawTarget.startsWith('/')) return null;
  if (/^[a-z][a-z\d+.-]*:/iu.test(rawTarget) || rawTarget.startsWith('//')) return null;
  const withoutAnchor = rawTarget.split('#', 1)[0].split('?', 1)[0];
  return decodeURIComponent(withoutAnchor);
}

function isInsidePackage(targetPath) {
  const relative = path.relative(PACKAGE_ROOT, targetPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

const markdownFiles = collectFiles(PACKAGE_ROOT, file => path.extname(file) === '.md');
const documentationFiles = collectFiles(PACKAGE_ROOT, file => DOC_EXTENSIONS.has(path.extname(file)));

test('every package-relative Markdown link resolves inside Little Monsters', () => {
  const failures = [];
  for (const file of markdownFiles) {
    for (const rawTarget of markdownLinkTargets(fs.readFileSync(file, 'utf8'))) {
      const localPath = localLinkPath(rawTarget);
      if (!localPath) continue;
      const resolved = path.resolve(path.dirname(file), localPath);
      const display = `${path.relative(PACKAGE_ROOT, file)} -> ${rawTarget}`;
      if (!isInsidePackage(resolved)) failures.push(`${display} escapes the package`);
      else if (!fs.existsSync(resolved)) failures.push(`${display} does not exist`);
    }
  }
  assert.deepEqual(failures, []);
});

test('documentation excludes retired repository, manifest, profile, and port guidance', () => {
  const corpus = documentationFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const retiredGuidance = [
    ['former private-core name', ['open', 'shal'].join('-')],
    ['kernel-resident app manifest', ['swarm-apps', 'little-monsters.yaml'].join('/')],
    ['app-specific compose profile', ['--profile', 'little-monsters'].join(' ')],
    ['retired local API port', ['354', '60'].join('')],
  ];
  for (const [label, value] of retiredGuidance) {
    assert.equal(corpus.includes(value), false, `${label} returned to package documentation`);
  }
});

test('operator docs pin the current package install, build, manifest, and port contracts', () => {
  const operatorDocs = [read('README.md'), read('docs/installation.md'), read('docs/runbook.md')].join('\n');
  assert.match(operatorDocs, /node scripts\/oshal-app\.js install little-monsters/u);
  assert.match(operatorDocs, /node scripts\/oshal-app\.js build C:\/Projects\/oshal-apps\/little-monsters --framework \./u);
  assert.match(operatorDocs, /localhost:35457\/cockpit\/\?app=little-monsters/u);
  assert.match(read('docs/README.md'), /\[Package manifest[^\]]*\]\(\.\.\/oshal-app\.yaml\)/u);
  assert.equal(fs.existsSync(path.join(PACKAGE_ROOT, 'oshal-app.yaml')), true);
});

test('inline help describes the shipped arcade and package-owned voice defaults', () => {
  const voiceSettings = read('tools/voice-settings.html');
  const arcade = read('tools/games-arcade.html');
  assert.match(voiceSettings, /installed Little Monsters <code>oshal-app\.yaml<\/code>/u);
  assert.match(voiceSettings, /node scripts\/oshal-app\.js install little-monsters/u);
  assert.match(arcade, /loadCurriculum below replaces it with the student's current flashcards/u);
  assert.doesNotMatch(arcade, /\bTODO\b/u);
});
