/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Contract for the New screen (1.1.0): its inline script parses; every studio it opens is a rail tile the manifest declares, at the manifest's URL; the Office cards come from AI Office's starter route (no inline copy of a template); a card opens its studio through app-navigate with a k=v query the cockpit sanitizes (kind/starter/theme); the categories rail covers every kind; no CDN script, no inline handlers; the New tile leads the rail and the route serves the page.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.2.0 — the access probe, the locked state and the Access link are pinned.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Require the 3D category alongside the retained studio categories.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Include the image-editor category and catalog-compatible theme namespace.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const SURFACE = path.join(PKG, 'tools', 'create-new.html');
const MANIFEST = path.join(PKG, 'oshal-app.yaml');
const html = () => fs.readFileSync(SURFACE, 'utf8');
const manifest = () => fs.readFileSync(MANIFEST, 'utf8');

function inlineScripts(source) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(source)) !== null) if (!/\bsrc\s*=/i.test(m[1] || '') && m[2].trim()) out.push(m[2]);
  return out;
}
function railUrls(text) {
  const urls = new Map();
  const re = /toolName:\s*([a-z0-9-]+)[\s\S]*?iframeUrl:\s*(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) urls.set(m[1], m[2]);
  return urls;
}
function literal(source, name) {
  const m = new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\n  \\}|\\[[\\s\\S]*?\\n  \\]);').exec(source);
  assert.ok(m, `surface declares ${name}`);
  return vm.runInNewContext('(' + m[1] + ')');
}

test('the New screen exists and every inline script parses', () => {
  assert.ok(fs.existsSync(SURFACE));
  const scripts = inlineScripts(html());
  assert.ok(scripts.length >= 1);
  for (const [i, code] of scripts.entries()) assert.doesNotThrow(() => new vm.Script(code, { filename: `create-new.html#${i}` }));
});

test('every studio the screen opens is a rail tile at the manifest URL', () => {
  const urls = railUrls(manifest());
  const studios = literal(html(), 'STUDIO');
  for (const key of Object.keys(studios)) {
    const s = studios[key];
    assert.ok(urls.has(s.tool), `${key} → ${s.tool} is a rail tile`);
    assert.equal(urls.get(s.tool), s.url, `${key} standalone fallback equals the rail tile URL`);
  }
  assert.equal(studios.office.tool, 'create-office');
});

test('the Office cards come from the owning app and open it on a purpose', () => {
  const source = html();
  assert.match(source, /fetchJson\('\/api\/presentations\/sections\/starters'\)/);
  assert.ok(!/outline:\s*'/.test(source), 'no template outline is inlined here — AI Office owns the catalog');
  assert.match(source, /function officeQuery\(st\) \{ return 'kind=' \+ encodeURIComponent\(st\.kind\) \+ '&starter=' \+ encodeURIComponent\(st\.id\) \+ '&theme=' \+ encodeURIComponent\(st\.theme \|\| ''\); \}/);
  assert.match(source, /var msg = \{ type: 'app-navigate', tool: s\.tool \};\s*if \(query\) msg\.query = query;/);
  assert.match(source, /window\.parent\.postMessage\(msg, window\.location\.origin\)/);
});

test('the categories rail covers the three Office kinds and the other studios', () => {
  const cats = literal(html(), 'CATEGORIES').map((c) => c.id);
  for (const id of ['foryou', 'image', 'pptx', 'docx', 'xlsx', 'portrait', 'video', 'story', '3d']) assert.ok(cats.includes(id), `category ${id}`);
  const other = literal(html(), 'OTHER');
  const studios = literal(html(), 'STUDIO');
  for (const o of other) assert.ok(studios[o.studio], `${o.id} opens a known studio`);
});

test('no CDN script, no inline handlers, wears the bundled skin', () => {
  const source = html();
  assert.doesNotMatch(source, /<script[^>]*\ssrc\s*=\s*["']https?:/i);
  assert.doesNotMatch(source, /\son[a-z]+\s*=\s*["']/i);
  assert.match(source, /<html lang="en" data-theme="create">/);
  assert.match(source, /href="\/api\/create\/theme\/create\.css"/);
});

test('the New tile leads the rail and the route serves the screen', () => {
  const text = manifest();
  const tools = [...text.matchAll(/^\s*-\s*toolName:\s*([a-z0-9-]+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(tools.slice(0, 2), ['create-new', 'create-home']);
  assert.equal(railUrls(text).get('create-new'), '/api/create/new');
  assert.match(fs.readFileSync(path.join(PKG, 'src-routes', 'create-routes.ts'), 'utf8'), /router\.get\('\/new'/);
  assert.match(fs.readFileSync(path.join(PKG, 'routes', 'create-routes.js'), 'utf8'), /'\/new'/);
});

test('a studio the person is not provisioned for is locked, never opened, never probed (ADR-149)', () => {
  const source = html();
  // One access probe per studio, before anything is offered; the answer's mode is honoured.
  assert.match(source, /fetchJson\('\/api\/authorization\/me\?app=' \+ encodeURIComponent\(app\), 3000\)/);
  assert.match(source, /if \(a\.status === 'legacy'\) return 'open';/);
  assert.match(source, /a\.denied !== true && typeof a\.tier === 'string' && a\.tier !== 'deny'\) \? 'open' : 'locked'/);
  // A locked studio shows why, links the administrator to Access, and its click never navigates.
  assert.match(source, /Not provisioned/);
  assert.match(source, /a\.href = '\/access\?app=' \+ encodeURIComponent\(app\)/);
  const lockedBranch = /if \(access === 'locked'\) \{[\s\S]*?return b;\s*\}/.exec(source)?.[0] ?? '';
  assert.ok(lockedBranch.length > 0, 'locked branch present');
  assert.ok(!/go\(/.test(lockedBranch), 'a locked card never calls go()');
  // Every studio names the package the probe asks about.
  const studios = literal(source, 'STUDIO');
  for (const key of Object.keys(studios)) assert.match(studios[key].app, /^[a-z0-9-]+$/, `${key} names its package`);
});
