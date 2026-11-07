/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Contract for the New screen (1.1.0): its inline script parses; every studio it opens is a rail tile the manifest declares, at the manifest's URL; the Office cards come from AI Office's starter route (no inline copy of a template); a card opens its studio through app-navigate with a k=v query the cockpit sanitizes (kind/starter/theme); the categories rail covers every kind; no CDN script, no inline handlers; the New tile leads the rail and the route serves the page.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.2.0 — the access probe, the locked state and the Access link are pinned.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Require the 3D category alongside the retained studio categories.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Include the image-editor category and catalog-compatible theme namespace.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | CREATE-EDIT-05d: the Edit video card opens the Video-owned editor rail tile; Short video still opens generation.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (create--create-new MERGE): New is the sheet inside Create Home. The old page forwards to /api/create/home?new=1 with the same known ?cat=, and a shell's ?audience= to Home's card; the manifest has no create-new tile while GET /new still answers; the sheet's templates and Blank row open rail tiles at the manifest's URLs, Office templates still come from AI Office, a locked card never navigates, and Edit video / Short video keep their editors.
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | The access probe waits ACCESS_TIMEOUT_MS (10 s, sixteen studios answered in turn) instead of 3 s.
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
const FORWARD = path.join(PKG, 'tools', 'create-new.html');
const HOME = path.join(PKG, 'tools', 'create-home.html');
const MANIFEST = path.join(PKG, 'oshal-app.yaml');
const page = () => fs.readFileSync(FORWARD, 'utf8');
const home = () => fs.readFileSync(HOME, 'utf8');
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
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + m[1] + ')')));
}
/** Run the old page's forward script with a stub location: what address does it open? */
function forward(search) {
  const tail = inlineScripts(page()).at(-1), replaced = [], link = { href: '' };
  vm.runInNewContext(tail, {
    URLSearchParams, document: { getElementById: (id) => (assert.equal(id, 'homeLink'), link) },
    window: { location: { search, replace: (to) => replaced.push(to) } },
  });
  assert.equal(link.href, replaced[0], 'the visible link names the same address');
  return replaced;
}

test('the old New page exists and every inline script parses', () => {
  for (const file of [FORWARD, HOME]) assert.ok(fs.existsSync(file));
  for (const [i, code] of inlineScripts(page()).entries()) assert.doesNotThrow(() => new vm.Script(code, { filename: `create-new.html#${i}` }));
});

test('the old address lands on Home with New open and keeps its format; a shell view lands on Home\'s card', () => {
  assert.deepEqual(forward(''), ['/api/create/home?new=1']);
  assert.deepEqual(forward('?cat=xlsx'), ['/api/create/home?new=1&cat=xlsx']);
  assert.deepEqual(forward('?cat=3d&starter=x'), ['/api/create/home?new=1&cat=3d'], 'only the format travels');
  assert.deepEqual(forward('?cat=javascript%3Aalert(1)'), ['/api/create/home?new=1'], 'an unknown format is dropped');
  assert.deepEqual(forward('?audience=family'), ['/api/create/home?audience=family'], 'Jarvis keeps its family card');
  assert.deepEqual(forward('?audience=company&cat=docx'), ['/api/create/home?audience=company'], 'a view opens no sheet');
  assert.deepEqual(forward('?audience=%3Cx%3E'), ['/api/create/home?new=1'], 'an invalid audience is not carried');
  for (const cat of literal(home(), 'CATEGORIES').map((c) => c.id)) assert.deepEqual(forward('?cat=' + cat), ['/api/create/home?new=1&cat=' + cat], `Home's ${cat} format is accepted`);
  assert.doesNotMatch(page(), /app-view\.js/, 'the old page no longer paints the view itself');
});

test('Home opens New from that address and strips it, so a reload does not reopen the sheet', () => {
  const source = home();
  assert.match(source, /if \(params\.get\('new'\) !== '1'\) return;/);
  assert.match(source, /params\.delete\('new'\); params\.delete\('cat'\);/);
  assert.match(source, /openNew\(\{ cat: cat \|\| '' \}\);/);
  assert.match(source, /renderBlanks\(\);\s*loadStarters\(\);\s*openFromAddress\(\);/);
});

test('the manifest has no separate New tile, and the route still answers the old address', () => {
  const text = manifest();
  const tools = [...text.matchAll(/^\s*-\s*toolName:\s*([a-z0-9-]+)\s*$/gm)].map((m) => m[1]);
  assert.ok(!tools.includes('create-new'), 'no create-new rail tile');
  assert.equal(tools[0], 'create-home', 'Home leads the rail');
  assert.match(text, /defaultView:\s*create-home/);
  assert.match(fs.readFileSync(path.join(PKG, 'src-routes', 'create-routes.ts'), 'utf8'), /router\.get\('\/new'/);
  assert.match(fs.readFileSync(path.join(PKG, 'routes', 'create-routes.js'), 'utf8'), /'\/new'/);
});

test('every template and blank start opens a rail tile at the manifest URL', () => {
  const urls = railUrls(manifest()), studios = literal(home(), 'STUDIOS');
  const byTool = new Map(studios.map((s) => [s.tool, s]));
  for (const item of [...literal(home(), 'OTHER'), ...literal(home(), 'BLANKS')]) {
    assert.ok(urls.has(item.tool), `${item.id} → ${item.tool} is a rail tile`);
    assert.equal(urls.get(item.tool), byTool.get(item.tool).url, `${item.id} standalone fallback equals the rail tile URL`);
  }
});

test('the Office templates come from the owning app and open it on a purpose', () => {
  const source = home();
  assert.match(source, /fetchJson\('\/api\/presentations\/sections\/starters', 4000\)/);
  assert.ok(!/outline:\s*'/.test(source), 'no template outline is inlined here — AI Office owns the catalog');
  assert.match(source, /function officeQuery\(st\) \{ return 'kind=' \+ encodeURIComponent\(st\.kind\) \+ '&starter=' \+ encodeURIComponent\(st\.id\) \+ '&theme=' \+ encodeURIComponent\(st\.theme \|\| ''\); \}/);
  assert.match(source, /var msg = \{ type: 'app-navigate', tool: tool \};\s*if \(query\) msg\.query = query;/);
  assert.match(source, /window\.parent\.postMessage\(msg, window\.location\.origin\)/);
});

test('the format chips cover the three Office kinds and the other studios', () => {
  const cats = literal(home(), 'CATEGORIES').map((c) => c.id);
  for (const id of ['foryou', 'image', 'pptx', 'docx', 'xlsx', 'portrait', 'video', 'story', 'training', '3d']) assert.ok(cats.includes(id), `format ${id}`);
  for (const o of literal(home(), 'OTHER')) assert.ok(cats.includes(o.cat), `${o.id} sits in a format`);
});

test('no CDN script, no inline handlers, both pages wear the bundled skin', () => {
  for (const source of [page(), home()]) {
    assert.doesNotMatch(source, /<script[^>]*\ssrc\s*=\s*["']https?:/i);
    assert.doesNotMatch(source, /\son[a-z]+\s*=\s*["']/i);
    assert.match(source, /<html lang="en" data-theme="create">/);
    assert.match(source, /href="\/api\/create\/theme\/create\.css"/);
  }
});

test('a studio the person is not provisioned for is locked in the sheet, never opened (ADR-149)', () => {
  const source = home();
  assert.match(source, /fetchJson\('\/api\/authorization\/me\?app=' \+ encodeURIComponent\(app\), ACCESS_TIMEOUT_MS\)/);
  assert.match(source, /Not provisioned/);
  const lockedBranch = /if \(access === 'locked'\) \{[\s\S]*?return b;\s*\}/.exec(source)?.[0] ?? '';
  assert.ok(lockedBranch.length > 0, 'locked branch present');
  assert.ok(!/go\(/.test(lockedBranch), 'a locked card never calls go()');
  assert.match(source, /if \(studio && studio\.app && ACCESS\[studio\.app\] === 'locked'\) \{ toast\(/, 'and go() refuses a locked blank start');
});

test('the Edit video card opens the Video-owned editor, and Short video still opens generation', () => {
  const other = literal(home(), 'OTHER'), urls = railUrls(manifest());
  const card = other.find((o) => o.id === 'edit-video');
  assert.deepEqual([card.cat, card.tool], ['video', 'create-video-editor']);
  assert.equal(urls.get('create-video-editor'), '/api/video/editor');
  assert.equal(other.find((o) => o.id === 'short').tool, 'create-video');
});
