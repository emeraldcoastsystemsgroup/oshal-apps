/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.14.2: what a person reads or hears in Video Studio names the product
 *   Open Swarm (Roger, 2026-11-13: the UI says "Open Swarm"; technical identifiers keep oshal). Dependency-free plain
 *   Node guard for the store-ci video job: checks SOUND_LIBRARY and STICKER_CATALOG attributions, the surface <title>,
 *   the manifest and personas, and all shipped routes/, src-routes/ and tools/ files outside comments.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

/** Technical identifier forms that legitimately retain oshal in code, SQL, paths, headers, env vars and storage keys. */
const ALLOWED_IDENTIFIERS = [
  /https?:\/\/\S+/gi,
  /\bOSHAL_[A-Z0-9_]+\b/g,
  /\bx-oshal-[a-z0-9-]+\b/gi,
  /--oshal-[a-z0-9-]+/gi,
  /\boshal\//g,
  /\boshal-app\.yaml\b/g,
  /\boshal-(?:local\b|tts-)/g,
  /\boshal\.video\.[A-Za-z0-9_.]+\b/g,
  /\boshal_[a-z0-9_]+\b/g,
];

function stripAllowed(value) {
  let out = String(value || '');
  for (const pattern of ALLOWED_IDENTIFIERS) out = out.replace(pattern, '<ID>');
  return out;
}

function findProductName(value, where) {
  const cleaned = stripAllowed(value);
  return [...cleaned.matchAll(/\boshal\b/gi)].map(
    (m) => `${where}: "${m[0]}" in ${JSON.stringify(String(value).trim().slice(0, 160))}`,
  );
}

function stripComments(source, ext) {
  if (ext === '.yaml') return source.replace(/^\s*#.*$/gm, '');
  if (ext === '.html') return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

function walkFiles(subDir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, subDir), { withFileTypes: true })) {
    const rel = path.posix.join(subDir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(rel, exts));
    else if (entry.isFile() && exts.includes(path.extname(entry.name))) out.push(rel);
  }
  return out.sort();
}

test('the guard itself flags product-name OSHAL/oshal while allowing technical identifiers', () => {
  assert.equal(findProductName('Video Studio — OSHAL', 'title').length, 1);
  assert.equal(findProductName('OSHAL-Procedural', 'audio').length, 1);
  assert.equal(findProductName('OSHAL Original Sticker', 'sticker').length, 1);
  assert.equal(findProductName('Video Studio — Open Swarm', 'title').length, 0);
  assert.equal(
    findProductName('OSHAL_PACKAGE_DATA_DIR x-oshal-tenant-id oshal-local oshal_videos oshal.video.storyboardDraft.v1', 'id').length,
    0,
  );
});

test('SOUND_LIBRARY, STICKER_CATALOG and video.html title name Open Swarm', async () => {
  const { SOUND_LIBRARY } = require('../routes/video-editor-audio-synth.js');
  assert.equal(SOUND_LIBRARY.length, 8);
  for (const item of SOUND_LIBRARY) {
    assert.equal(item.attribution, 'Open Swarm Procedural', item.id);
    assert.deepEqual(findProductName(JSON.stringify(item), `SOUND_LIBRARY ${item.id}`), []);
  }
  const { STICKER_CATALOG } = await import(pathToFileURL(path.join(ROOT, 'tools/editor/editor-stickers.mjs')).href);
  assert.equal(STICKER_CATALOG.length, 8);
  for (const item of STICKER_CATALOG) {
    assert.equal(item.attribution, 'Open Swarm Original Sticker', item.id);
    assert.deepEqual(findProductName(JSON.stringify(item), `STICKER_CATALOG ${item.id}`), []);
  }
  const html = fs.readFileSync(path.join(ROOT, 'tools/video.html'), 'utf8');
  assert.match(html, /<title>Video Studio — Open Swarm<\/title>/);
});

test('manifest, personas, routes, TypeScript route sources and tools name Open Swarm outside comments', () => {
  const files = [
    'oshal-app.yaml',
    ...walkFiles('personas', ['.yaml']),
    ...walkFiles('routes', ['.js']),
    ...walkFiles('src-routes', ['.ts']),
    ...walkFiles('tools', ['.html', '.js', '.mjs', '.css']),
  ];
  const problems = [];
  for (const rel of files) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (rel === 'personas/screenplay-writer.yaml' || rel === 'personas/video-director.yaml') {
      assert.match(raw, /in the Open Swarm Video Studio\./, rel);
    }
    const stripped = stripComments(raw, path.extname(rel));
    stripped.split('\n').forEach((line, idx) => {
      problems.push(...findProductName(line, `${rel}:${idx + 1}`));
    });
  }
  assert.deepEqual(problems, []);
});
