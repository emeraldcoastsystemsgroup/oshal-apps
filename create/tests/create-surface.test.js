/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Parse + contract guard for the Create home surface and its manifest: every inline script parses; the studio catalog and every starter name a rail tile the manifest actually declares; every rail tile points at an app the manifest depends on; the surface wears the bundled skin and speaks the ribbon's app-navigate dialect; no CDN script, no inline handler.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Pin the profile-envelope unwrap ({ profile: {...} }) the live api answers with.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | 1.1.0 — the New tile leads the rail; starters navigate with a query.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | 1.2.0 — access first: a locked studio never opens and is never probed.
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
const SURFACE = path.join(PKG, 'tools', 'create-home.html');
const MANIFEST = path.join(PKG, 'oshal-app.yaml');
const SKIN = path.join(PKG, 'ui', 'create.css');

const html = () => fs.readFileSync(SURFACE, 'utf8');
const manifest = () => fs.readFileSync(MANIFEST, 'utf8');

function inlineScripts(source) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (m[2].trim()) out.push({ code: m[2], module: /type\s*=\s*["']?module/i.test(attrs) });
  }
  return out;
}

/** The manifest's ui.static toolNames, in order. */
function railTools(text) {
  return [...text.matchAll(/^\s*-\s*toolName:\s*([a-z0-9-]+)\s*$/gm)].map((m) => m[1]);
}
/** toolName → iframeUrl from the manifest's ui.static block. */
function railUrls(text) {
  const urls = new Map();
  const re = /toolName:\s*([a-z0-9-]+)[\s\S]*?iframeUrl:\s*(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) urls.set(m[1], m[2]);
  return urls;
}
/** dependencies.apps entries. */
function dependencyApps(text) {
  const block = /dependencies:\s*\n\s+apps:\s*\n((?:\s+-\s+[a-z0-9-]+\s*\n)+)/.exec(text);
  assert.ok(block, 'manifest declares dependencies.apps');
  return [...block[1].matchAll(/-\s+([a-z0-9-]+)/g)].map((m) => m[1]);
}
/** The STUDIOS catalog literal inside the surface script, evaluated in isolation. */
function surfaceStudios(source) {
  const m = /var STUDIOS = (\[[\s\S]*?\n  \]);/.exec(source);
  assert.ok(m, 'surface declares the STUDIOS catalog');
  return vm.runInNewContext('(' + m[1] + ')');
}
function surfaceStarters(source) {
  const m = /var STARTERS = (\[[\s\S]*?\n  \]);/.exec(source);
  assert.ok(m, 'surface declares the STARTERS list');
  return vm.runInNewContext('(' + m[1] + ')');
}

test('the surface, manifest and skin exist', () => {
  for (const f of [SURFACE, MANIFEST, SKIN]) assert.ok(fs.existsSync(f), `missing ${path.relative(PKG, f)}`);
});

test('every inline script in create-home.html parses', () => {
  const scripts = inlineScripts(html());
  assert.ok(scripts.length >= 1, 'expected the surface driver script');
  for (const [i, s] of scripts.entries()) {
    assert.equal(s.module, false, 'the driver is a classic script (no top-level await, no imports)');
    assert.doesNotThrow(() => new vm.Script(s.code, { filename: `create-home.html#${i}` }), `inline script #${i} does not parse`);
  }
});

test('the surface wears the bundled skin and never a hardcoded page palette', () => {
  const source = html();
  assert.match(source, /<html lang="en" data-theme="create">/);
  assert.match(source, /href="\/api\/create\/theme\.css"/);
  // Aliases derive from framework tokens (the skin defines them); the hex after the comma is a fallback only.
  for (const token of ['--bg-primary', '--bg-card-hover', '--text-primary', '--accent-primary', '--accent-gradient', '--border-color']) {
    assert.ok(source.includes(`var(${token}`), `surface reads ${token}`);
  }
  assert.doesNotMatch(source, /<script[^>]*\ssrc\s*=\s*["']https?:/i, 'no CDN script');
  assert.doesNotMatch(source, /\son[a-z]+\s*=\s*["']/i, 'no inline event handler attributes');
});

test('the skin defines the complete framework token set for [data-theme="create"]', () => {
  const css = fs.readFileSync(SKIN, 'utf8');
  assert.match(css, /\[data-theme="create"\]\s*\{/);
  for (const token of [
    '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-card', '--bg-card-hover',
    '--border-color', '--border-color-hover', '--text-primary', '--text-secondary', '--text-muted',
    '--accent-primary', '--accent-primary-hover', '--accent-gradient', '--accent-glow',
    '--status-success', '--status-active', '--status-warning', '--status-error',
    '--glass-bg', '--glass-bg-heavy', '--glass-border', '--glass-highlight', '--glass-blur', '--glass-blur-light',
    '--scrollbar-track', '--scrollbar-thumb', '--panel-shadow', '--card-shadow', '--depth-shadow',
  ]) assert.ok(css.includes(`${token}:`), `skin defines ${token}`);
  // Every chrome rule is scoped to the skin — the file can never restyle another theme.
  const unscoped = css.split('\n').filter((l) => /^[.#a-z@\[]/.test(l) && !l.startsWith('[data-theme="create"]') && !l.startsWith('@media'));
  assert.deepEqual(unscoped, [], 'every top-level selector is scoped to [data-theme="create"]');
});

test('the studio catalog and every starter name a rail tile the manifest declares', () => {
  const source = html();
  const text = manifest();
  const rail = railTools(text);
  const urls = railUrls(text);
  assert.deepEqual(rail.slice(0, 2), ['create-new', 'create-home'], 'the New tile leads the rail, then Home');
  const studios = surfaceStudios(source);
  assert.ok(studios.length >= 4);
  for (const s of studios) {
    assert.ok(rail.includes(s.tool), `catalog studio ${s.tool} is a rail tile`);
    assert.equal(urls.get(s.tool), s.url, `standalone fallback for ${s.tool} equals the rail tile URL`);
    assert.match(s.app, /^[a-z0-9-]+$/);
  }
  for (const st of surfaceStarters(source)) {
    assert.ok(studios.some((s) => s.tool === st.tool), `starter ${st.id} opens a catalog studio`);
    assert.ok(['documents', 'images', 'video', 'story', 'training'].includes(st.cat), `starter ${st.id} has a known category`);
  }
  // Every rail tile except home is fronted by the catalog (no orphan tile the home page cannot open).
  for (const tool of rail.slice(2)) assert.ok(studios.some((s) => s.tool === tool), `rail tile ${tool} is in the catalog`);
});

test('every rail tile and every summary probe belongs to a declared member app', () => {
  const text = manifest();
  const deps = dependencyApps(text);
  const urls = railUrls(text);
  for (const [tool, url] of urls) {
    if (tool === 'create-home') { assert.equal(url, '/api/create/home'); continue; }
    if (tool === 'create-new') { assert.equal(url, '/api/create/new'); continue; }
    const app = /^\/api\/([a-z0-9-]+)\//.exec(url)?.[1];
    assert.ok(app && deps.includes(app), `rail tile ${tool} (${url}) points at a declared dependency`);
  }
  for (const s of surfaceStudios(html())) assert.ok(deps.includes(s.app), `summary probe for ${s.app} names a declared dependency`);
  assert.equal(new Set(deps).size, deps.length, 'dependencies.apps has no duplicates');
});

test('the surface speaks the ribbon app-navigate dialect and asks the probes itself', () => {
  const source = html();
  assert.match(source, /var msg = \{ type: 'app-navigate', tool: tool \};\s*if \(query\) msg\.query = query;/);
  assert.match(source, /window\.parent\.postMessage\(msg, window\.location\.origin\)/);
  assert.match(source, /\/api\/ui\/profile\?name=create/);
  // The live endpoint answers { profile: {...} } — 1.0.0 read the envelope as the profile and the
  // studios row rendered its empty state against a real api. Both shapes must be accepted.
  assert.match(source, /body\.profile && typeof body\.profile === 'object'\) \? body\.profile : body/);
  assert.match(source, /'\/api\/' \+ studio\.app \+ '\/home-summary'/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /AbortController/);
  for (const id of ['heroTitle', 'q', 'chips', 'starterTiles', 'recentGrid', 'studioGrid', 'metrics']) {
    assert.ok(source.includes(`id="${id}"`), `surface keeps #${id}`);
  }
});

test('the manifest is the launcher shape: skin, home default view, hidden console trays, no code of its own beyond the two routes', () => {
  const text = manifest();
  assert.match(text, /^theme:\s*create\b/m);
  assert.match(text, /defaultView:\s*create-home/);
  assert.match(text, /hideChatPanel:\s*true/);
  assert.match(text, /hideStatusBar:\s*true/);
  assert.match(text, /^suite:\s*ai-creative\b/m);
  const modules = [...text.matchAll(/module:\s*(routes\/[a-z-]+\.js)/g)].map((m) => m[1]).sort();
  assert.deepEqual(modules, ['routes/create-routes.js', 'routes/package-smoke.js']);
  assert.ok(!/^\s*(bots|migrations|schedules|workflow|ticketType|summary):/m.test(text), 'a launcher owns no bots, schema, queue or summary');
});

test('the home asks access first, locks a studio that is not provisioned, and never probes it', () => {
  const source = html();
  assert.match(source, /fetchJson\('\/api\/authorization\/me\?app=' \+ encodeURIComponent\(app\), 3000\)/);
  assert.match(source, /if \(studio && studio\.app && ACCESS\[studio\.app\] === 'locked'\) \{ toast\(/);
  assert.match(source, /if \(ACCESS\[studio\.app\] === 'locked'\) return Promise\.resolve\(\);/);
  // Boot order: every access answer lands BEFORE the profile and the summaries are asked.
  assert.match(source, /Promise\.all\(STUDIOS\.map\(function \(s\) \{ return accessFor\(s\.app\)[\s\S]*?\}\)\)\.then\(function \(\) \{\s*applyAccessToStarters\(\);\s*loadProfile\(\);\s*loadSummaries\(\);/);
  assert.match(source, /a\.href = '\/access\?app=' \+ encodeURIComponent\(app\)/);
});
