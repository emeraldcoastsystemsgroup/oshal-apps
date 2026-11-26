'use strict';
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: what a person reads or hears in Brand Graphics names the
 *   product Open Swarm and retires the Oh-shal voiceover pronunciation rule (Roger, 2026-11-13: the UI says
 *   "Open Swarm"; technical identifiers keep their forms). Dependency-free plain-Node CommonJS guard over the
 *   manifest, persona, routes, TypeScript route sources and tools outside comments.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: allow the technical brandStyle enum value "oshal" in schemas, route validators, and option value attributes while keeping all person-facing labels and copy naming Open Swarm.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Technical identifier forms that legitimately retain oshal in paths, headers, globals and env vars. */
const ALLOWED_IDENTIFIERS = [
  /https?:\/\/[^\s"'<>]+/gi,
  /\bOSHAL_[A-Z0-9_]+\b/g,
  /\bX-Oshal-[A-Za-z0-9-]+\b/g,
  /\bx-oshal-[a-z0-9-]+\b/gi,
  /--oshal-[a-z0-9-]+/gi,
  /\b__oshal[A-Za-z0-9_]+\b/g,
  /\boshal-(?:app\.yaml|brand\.js)\b/g,
  /\boshal_[a-z0-9_]+\b/g,
  /\boshal\.current_[a-z_]+\b/g,
  /value="oshal"/g,
  /brandStyle[^;\n]*['"`]oshal['"`]/g,
  /['"`]my-brand['"`]\s*\|\s*['"`]oshal['"`]/g,
  /enum:\s*\[my-brand,\s*oshal\]/g,
  /brandStyle:\s*\{[^}\n]*\boshal\b[^}\n]*\}/g,
  /value\s*===\s*['"`]oshal['"`]/g,
  /return\s*['"`]oshal['"`]/g,
  /brandStyle must be my-brand or oshal/g,
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
  if (ext === '.yaml') return source.replace(/^\s*(?!##\s)#.*$/gm, '');
  if (ext === '.html') return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

function listDirFiles(subDir, exts) {
  return fs
    .readdirSync(path.join(ROOT, subDir), { withFileTypes: true })
    .filter((e) => e.isFile() && exts.includes(path.extname(e.name)))
    .map((e) => path.posix.join(subDir, e.name))
    .sort();
}

test('the guard itself flags product-name OSHAL/oshal while allowing technical identifiers and paths', () => {
  assert.equal(findProductName('Make an OSHAL brand graphic', 'tool').length, 1);
  assert.equal(findProductName('- oshal intro', 'keyword').length, 1);
  assert.equal(findProductName('Make an Open Swarm brand graphic', 'tool').length, 0);
  assert.equal(
    findProductName('tools/oshal-brand.js OSHAL_USER_SUB X-Oshal-User-Sub-B64 __oshalDocumentSession oshal-app.yaml', 'id').length,
    0,
  );
});

test('manifest tool labels, persona role and naming rules name Open Swarm and retire Oh-shal', () => {
  const manifest = stripComments(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'), '.yaml');
  assert.match(manifest, /displayName: Make an Open Swarm brand graphic/);
  assert.match(manifest, /Create an on-brand Open Swarm motion graphic \/ intro clip/);
  assert.doesNotMatch(manifest, /Oh-shal/i);

  const persona = stripComments(fs.readFileSync(path.join(ROOT, 'personas/brand-graphics.yaml'), 'utf8'), '.yaml');
  assert.match(persona, /^role: Open Swarm Brand Marketing & Motion-Graphics Specialist$/m);
  assert.match(persona, /You are the \*\*Open Swarm Brand Marketing \/ Graphics specialist\*\*/);
  assert.match(persona, /## The Open Swarm look/);
  assert.match(persona, /The product name in on-screen copy and voiceover scripts is "Open Swarm"\./);
  assert.match(persona, /- open swarm intro/);
  assert.doesNotMatch(persona, /Oh-shal/i);
});

test('manifest, persona, routes, TypeScript route sources and tools name Open Swarm outside comments', () => {
  const files = [
    'oshal-app.yaml',
    ...listDirFiles('personas', ['.yaml']),
    ...listDirFiles('routes', ['.js', '.mjs']),
    ...listDirFiles('src-routes', ['.ts']),
    ...listDirFiles('tools', ['.html', '.js', '.mjs', '.css']),
  ];
  const problems = [];
  for (const rel of files) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const stripped = stripComments(raw, path.extname(rel));
    stripped.split('\n').forEach((line, idx) => {
      problems.push(...findProductName(line, `${rel}:${idx + 1}`));
    });
  }
  assert.deepEqual(problems, []);
});
