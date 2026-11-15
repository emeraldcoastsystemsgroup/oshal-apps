/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.5.9: what a person reads or hears in Marketing Engine names the
 *   product Open Swarm (Roger, 2026-11-13: the UI says "Open Swarm"; technical identifiers and URLs such as
 *   https://oshal.ai/product keep their forms). Dependency-free plain-Node ESM guard for the store-ci marketing-engine
 *   job over the manifest, all four personas, routes, TypeScript route sources and the HTML surface.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Technical identifier forms that legitimately retain oshal in URLs, SQL tables, paths and env vars. */
const ALLOWED_IDENTIFIERS = [
  /https?:\/\/[^\s"'<>]+/gi,
  /\bOSHAL_[A-Z0-9_]+\b/g,
  /\bx-oshal-[a-z0-9-]+\b/gi,
  /--oshal-[a-z0-9-]+/gi,
  /\boshal-app\.yaml\b/g,
  /\boshal_[a-z0-9_]+\b/g,
  /\bemeraldcoastsystemsgroup\/oshal\b/g,
  /\boshal-marketing-engine\b/g,
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

function listDirFiles(subDir, exts) {
  return readdirSync(join(ROOT, subDir), { withFileTypes: true })
    .filter((e) => e.isFile() && exts.includes(extname(e.name)))
    .map((e) => posix.join(subDir, e.name))
    .sort();
}

test('the guard itself flags product-name OSHAL/oshal while allowing technical identifiers and URLs', () => {
  assert.equal(findProductName('Marketing — oshal', 'title').length, 1);
  assert.equal(findProductName('which oshal product this campaign sells', 'placeholder').length, 1);
  assert.equal(findProductName('Marketing — Open Swarm', 'title').length, 0);
  assert.equal(
    findProductName('placeholder="https://oshal.ai/product" OSHAL_APP_PACKAGE_DIR oshal_marketing_campaigns', 'id').length,
    0,
  );
});

test('surface title, product placeholder, email fallback subject and bot honesty rules name Open Swarm', () => {
  const html = readFileSync(join(ROOT, 'tools/marketing-engine.html'), 'utf8');
  assert.match(html, /<title>Marketing — Open Swarm<\/title>/);
  assert.match(html, /placeholder="which Open Swarm product this campaign sells"/);
  assert.match(html, /placeholder="https:\/\/oshal\.ai\/product"/);

  for (const rel of ['routes/marketing-publish.js', 'src-routes/marketing-publish.ts']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(src, /\|\| 'Open Swarm update';/, rel);
  }
  for (const rel of ['routes/marketing-support.js', 'src-routes/marketing-support.ts']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(src, /The product name is "Open Swarm"\./, rel);
  }
});

test('manifest, all four personas, routes, TypeScript route sources and tools name Open Swarm outside comments', () => {
  const personas = listDirFiles('personas', ['.yaml']);
  assert.equal(personas.length, 4);
  for (const rel of personas) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(raw, /Open Swarm marketing engine/, rel);
    assert.match(raw, /The product name is "Open Swarm"/, rel);
    assert.doesNotMatch(raw, /"open swarm" never stands alone/i, rel);
  }
  const files = [
    'oshal-app.yaml',
    ...personas,
    ...listDirFiles('routes', ['.js']),
    ...listDirFiles('src-routes', ['.ts']),
    ...listDirFiles('tools', ['.html', '.js', '.mjs', '.css']),
  ];
  const problems = [];
  for (const rel of files) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const stripped = stripComments(raw, extname(rel));
    stripped.split('\n').forEach((line, idx) => {
      problems.push(...findProductName(line, `${rel}:${idx + 1}`));
    });
  }
  assert.deepEqual(problems, []);
});
