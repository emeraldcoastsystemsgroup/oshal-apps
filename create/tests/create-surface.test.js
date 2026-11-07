/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Parse + contract guard for the Create home surface and its manifest: every inline script parses; the studio catalog and every starter name a rail tile the manifest actually declares; every rail tile points at an app the manifest depends on; the surface wears the bundled skin and speaks the ribbon's app-navigate dialect; no CDN script, no inline handler.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Pin the profile-envelope unwrap ({ profile: {...} }) the live api answers with.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | 1.1.0 — the New tile leads the rail; starters navigate with a query.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | 1.2.0 — access first: a locked studio never opens and is never probed.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Accept the declared 3D category for the Scan-to-Print starter.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | Preserve launcher contracts alongside Create-owned image projects and explicit role/schema declarations.
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | Keep the reviewed artifact handoff after access gating and before profile/summary reads; reject early or duplicate boot handoffs.
 * 8   | maintainer@emeraldcoastsystemsgroup.com     | The Brand Kit tile is Create's own page (not a studio card): it follows Home, points at /api/create/brand and is the only non-studio tile after Home.
 * 9   | maintainer@emeraldcoastsystemsgroup.com     | CREATE-EDIT-05d: the Edit video quick start and the Video editor studio card open the Video-owned editor rail tile; its catalog entry never reads Video's summary a second time.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Permit the inline editing concierge while preserving no generation schedules/workflow; show its Concierge control.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: New is Home's sheet, so Home leads the rail and no create-new tile exists; the Blank row and templates replace the quick-start list and name catalog studios; the boot gate is applyAccess → artifact → profile → summaries; the hero, section pills, quick-start grid and studios grid are gone and one New button opens the sheet.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | The access probe waits ACCESS_TIMEOUT_MS (10 s, sixteen studios answered in turn) instead of 3 s.
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
/**
 * Every app named under `dependencies`, from EITHER tier or the legacy flat form.
 *
 * The manifest moved from a flat `dependencies.apps` to `dependencies.required.apps` +
 * `dependencies.optional.apps` (the ADR-085 tier addendum), so the old single-block regex matched
 * nothing and this read asserted itself to death on a manifest that declares MORE than before.
 *
 * The UNION is the right answer: what this file asks is whether a rail tile points at an app the
 * manifest DECLARES, not whether that app is required to boot. A tile may legitimately point at an
 * optional partner - that is what optional means.
 *
 * Parsed line by line rather than with one block regex. The manifests are CRLF in a Windows
 * checkout, and a `\\s`-based block pattern silently captures an empty string there instead of
 * failing loudly - which reads as "no dependencies declared" and is worse than a parse error.
 */
function dependencyApps(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^dependencies:\s*$/.test(line));
  assert.ok(start >= 0, 'manifest declares a dependencies block');
  const apps = [];
  let inApps = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break; // a line in column zero ends the block
    if (/^\s+apps:\s*$/.test(line)) { inApps = true; continue; } // a list follows
    if (/^\s+[A-Za-z_][A-Za-z0-9_-]*:/.test(line)) { inApps = false; continue; } // any other key, incl. `apps: []`
    const item = /^\s+-\s+([a-z0-9-]+)\s*$/.exec(line);
    if (inApps && item) apps.push(item[1]);
  }
  assert.ok(apps.length, 'manifest declares at least one dependency app in some tier');
  return apps;
}
/** The STUDIOS catalog literal inside the surface script, evaluated in isolation. */
function surfaceStudios(source) {
  const m = /var STUDIOS = (\[[\s\S]*?\n  \]);/.exec(source);
  assert.ok(m, 'surface declares the STUDIOS catalog');
  return vm.runInNewContext('(' + m[1] + ')');
}
/** The New sheet's Blank row and template list (each names a rail tool). */
function surfaceList(source, name) {
  const m = new RegExp('var ' + name + ' = (\\[[\\s\\S]*?\\n  \\]);').exec(source);
  assert.ok(m, `surface declares the ${name} list`);
  return vm.runInNewContext('(' + m[1] + ')');
}

/** The single incoming handoff belongs inside the resolved access gate, before ordinary data probes. */
function assertAccessBoot(source) {
  assert.match(source, /Promise\.all\(STUDIOS\.map\(function \(s\) \{ return accessFor\(s\.app\)[\s\S]*?\}\)\)\.then\(function \(\) \{\s*applyAccess\(\);\s*openIncomingArtifact\(\);\s*loadProfile\(\);\s*loadSummaries\(\);/);
  assert.equal([...source.matchAll(/\bopenIncomingArtifact\(\);/g)].length, 1, 'one access-gated boot handoff');
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
  assert.match(source, /href="\/api\/create\/theme\/create\.css"/);
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
  assert.deepEqual(rail.slice(0, 2), ['create-home', 'create-brand'], 'Home leads the rail, then the Brand Kit');
  assert.ok(!rail.includes('create-new'), 'New is the sheet behind Home\'s New button, not a rail tile');
  const studios = surfaceStudios(source);
  assert.ok(studios.length >= 4);
  for (const s of studios) {
    assert.ok(rail.includes(s.tool), `catalog studio ${s.tool} is a rail tile`);
    assert.equal(urls.get(s.tool), s.url, `standalone fallback for ${s.tool} equals the rail tile URL`);
    assert.match(s.app, /^[a-z0-9-]+$/);
  }
  const categories = vm.runInNewContext('(' + /var CATEGORIES = (\[[\s\S]*?\n  \]);/.exec(source)[1] + ')').map((c) => c.id);
  for (const blank of surfaceList(source, 'BLANKS')) assert.ok(studios.some((s) => s.tool === blank.tool), `blank ${blank.id} opens a catalog studio`);
  for (const card of surfaceList(source, 'OTHER')) {
    assert.ok(studios.some((s) => s.tool === card.tool), `template ${card.id} opens a catalog studio`);
    assert.ok(categories.includes(card.cat), `template ${card.id} has a known format`);
  }
  // Every rail tile after Home and the Brand Kit is fronted by the catalog (no orphan tile the home page cannot open).
  for (const tool of rail.slice(2)) assert.ok(studios.some((s) => s.tool === tool), `rail tile ${tool} is in the catalog`);
});

test('every rail tile and summary belongs to Create or a declared member app', () => {
  const text = manifest();
  const deps = dependencyApps(text);
  const urls = railUrls(text);
  for (const [tool, url] of urls) {
    if (tool === 'create-home') { assert.equal(url, '/api/create/home'); continue; }
    if (tool === 'create-editor') { assert.equal(url, '/api/create/editor'); continue; }
    if (tool === 'create-brand') { assert.equal(url, '/api/create/brand'); continue; }
    const app = /^\/api\/([a-z0-9-]+)\//.exec(url)?.[1];
    assert.ok(app && deps.includes(app), `rail tile ${tool} (${url}) points at a declared dependency`);
  }
  for (const s of surfaceStudios(html())) assert.ok(s.app === 'create' || deps.includes(s.app), `summary probe for ${s.app} names its owner`);
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
  for (const id of ['q', 'recentGrid', 'metrics', 'newBtn', 'newSheet', 'blankRow', 'cats', 'chips', 'sections']) {
    assert.ok(source.includes(`id="${id}"`), `surface keeps #${id}`);
  }
});

test('the manifest preserves the creative shell and declares its owned image-project boundary', () => {
  const text = manifest();
  assert.match(text, /^theme:\s*create\b/m);
  assert.match(text, /defaultView:\s*create-home/);
  assert.match(text, /hideChatPanel:\s*false/);
  assert.match(text, /hideStatusBar:\s*true/);
  assert.match(text, /^suite:\s*ai-creative\b/m);
  const modules = [...text.matchAll(/module:\s*(routes\/[a-z-]+\.js)/g)].map((m) => m[1]).sort();
  assert.deepEqual(modules, ['routes/create-project-routes.js', 'routes/create-routes.js', 'routes/package-smoke.js']);
  assert.match(text, /catalog: authorization\.yaml/);
  assert.match(text, /migrations\/001-create-projects\.sql/);
  assert.match(text, /migrations\/002-create-brand-kits\.sql/);
  assert.match(text, /path: \/api\/create\/home-summary/);
  assert.ok(!/^\s*(schedules|workflow|ticketType):/m.test(text), 'manual editing schedules no providers or generation');
  assert.match(text, /^chatBot:\s*create-editor$/m);
  assert.match(text, /name: create-editor[\s\S]*?posture: inline/);
  assert.match(text, /name: create-apply-edits[\s\S]*?requiresApproval: true/);
});

test('the home asks access first, locks a studio that is not provisioned, and never probes it', () => {
  const source = html();
  assert.match(source, /fetchJson\('\/api\/authorization\/me\?app=' \+ encodeURIComponent\(app\), ACCESS_TIMEOUT_MS\)/);
  assert.match(source, /if \(studio && studio\.app && ACCESS\[studio\.app\] === 'locked'\) \{ toast\(/);
  assert.match(source, /if \(ACCESS\[studio\.app\] === 'locked'\) return false;   \/\/ not provisioned: nothing to ask, nothing to show/);
  // Access answers gate the incoming artifact as well as profile/summary reads.
  assertAccessBoot(source);
  const beforeAccess = source.replace(/^([ \t]*)Promise\.all\(STUDIOS\.map/m, '$1openIncomingArtifact();\n$1Promise.all(STUDIOS.map');
  assert.notEqual(beforeAccess, source);
  assert.throws(() => assertAccessBoot(beforeAccess), 'an extra handoff before access must fail');
  const beforeStarters = source.replace(/applyAccess\(\);\s*openIncomingArtifact\(\);/, 'openIncomingArtifact();\n    applyAccess();');
  assert.notEqual(beforeStarters, source);
  assert.throws(() => assertAccessBoot(beforeStarters), 'a handoff before starter gating must fail');
  assert.match(source, /a\.href = '\/access\?app=' \+ encodeURIComponent\(app\)/);
});

test('Edit video opens Video Studio\'s own editor and never reads Video\'s summary twice', () => {
  const source = html(), urls = railUrls(manifest());
  assert.equal(urls.get('create-video-editor'), '/api/video/editor', 'the rail tile is the Video-owned editor');
  assert.equal(urls.get('create-video'), '/api/video/editor', 'the default studio opens the editable timeline');
  const editor = surfaceStudios(source).find((s) => s.tool === 'create-video-editor');
  assert.deepEqual([editor.app, editor.url, editor.summary], ['video', '/api/video/editor', false]);
  assert.deepEqual(JSON.parse(JSON.stringify(surfaceList(source, 'OTHER').filter((s) => s.tool === 'create-video-editor').map((s) => [s.id, s.cat]))), [['edit-video', 'video']]);
  assert.deepEqual(JSON.parse(JSON.stringify(surfaceList(source, 'BLANKS').filter((s) => s.tool === 'create-video-editor').map((s) => s.id))), ['video'], 'Blank video opens the empty timeline');
  assert.equal(surfaceStudios(source).filter((s) => s.app === 'video' && s.summary !== false).length, 1, 'one summary reader per app');
  assert.match(source, /if \(studio\.summary === false\) return false;   \/\/ another catalog entry already reads this app's summary/);
});

test('Home is your work with one New: no hero, no section pills, no quick-start or studios grid', () => {
  const source = html();
  for (const gone of [/class="hero"/, /class="seg"/, /id="starterTiles"/, /id="studioGrid"/, /id="seeAll"/, /var STARTERS = /]) assert.doesNotMatch(source, gone);
  assert.equal(source.split('id="newBtn"').length - 1, 1, 'one New button');
  assert.match(source, /<dialog class="sheet" id="newSheet"/, 'New opens a top-layer sheet/dialog');
  assert.match(source, /document\.getElementById\('newBtn'\)\.addEventListener\('click', function \(\) \{ openNew\(\{\}\); \}\);/);
  assert.doesNotMatch(source, /tool: 'create-new'|go\('create-new'/, 'Home never navigates to a create-new tile');
});
