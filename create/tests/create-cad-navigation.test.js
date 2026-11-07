/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise all fourteen studios' discovery parity and actual CAD/LoRA access decisions, navigation and owner-summary calls without opening a browser or running a build or training job.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: New is the sheet inside Home, so its CAD and LoRA cards are read from Home's OTHER list (each names its rail tool) and open through Home's own go(); the quick-start list is gone; the summary read keeps its single CAD request with the progressive renderer stubbed; the read-only audience list lives on Home as AUDIENCE_STUDIOS.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The version check accepts any later version than the 1.18.8 that shipped CAD discovery, so a version bump does not fail it (1.19.0, UX audit 2026-11-06).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The access probe now waits ACCESS_TIMEOUT_MS (10 s) so sixteen studios answered in turn do not time out; the read-only probe case expects it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'tools/create-home.html'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function literal(source, name) {
  const match = new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\n  \\}|\\[[\\s\\S]*?\\n  \\]);').exec(source);
  assert.ok(match, name + ' is present');
  return plain(vm.runInNewContext('(' + match[1] + ')'));
}
function actual(source, name, context) {
  const match = new RegExp('  function ' + name + '\\([^]*?\\n  \\}').exec(source);
  assert.ok(match, name + ' is present');
  return vm.runInNewContext('(' + match[0] + ')', context);
}
const cad = literal(home, 'STUDIOS').find(s => s.app === 'cad-studio');
const homeStudios = literal(home, 'STUDIOS');
const sheet = literal(home, 'OTHER').concat(literal(home, 'BLANKS'));
const card = literal(home, 'OTHER').find(c => c.id === 'cad-model');
const TOOLS = {cad: 'create-cad-studio', lora: 'create-lora'};
function navigation(source, embedded, access, key = 'cad') {
  const messages = [], urls = [], notices = [];
  const studio = homeStudios.find(s => s.tool === TOOLS[key]);
  const context = {embedded, ACCESS: {[studio.app]: access},
    byTool: {[studio.tool]: studio}, surfaceUrls: {}, toast: text => notices.push(text),
    window: {parent: {postMessage: (message, origin) => messages.push([plain(message), origin])},
      location: {origin: 'https://fixture.invalid', assign: url => urls.push(url)}}};
  actual(source, 'go', context)(studio.tool);
  return {messages, urls, notices};
}

test('CAD Home discovery points at the existing CAD editor and rail tile', () => {
  assert.equal(new Set(literal(home, 'STUDIOS').map(s => s.app)).size, 14, 'all fourteen modules are discoverable');
  assert.deepEqual([cad.tool, cad.name, cad.url], ['create-cad-studio', 'CAD Studio', '/api/cad-studio/app']);
  const rail = /- toolName: create-cad-studio\n([^]*?)(?=\n    - toolName:|\n\n)/.exec(manifest)?.[1];
  assert.ok(rail); assert.match(rail, /iframeUrl: \/api\/cad-studio\/app/); assert.match(rail, /group: Studios/);
});
test('New opens the same CAD-owned editor as Home and the rail', () => {
  const apps = [...new Set(sheet.map(item => homeStudios.find(s => s.tool === item.tool).app))].sort();
  assert.equal(apps.length, 14, 'the New sheet covers the same fourteen modules');
  assert.deepEqual(apps, [...new Set(homeStudios.map(s => s.app))].sort(), 'Video aliases do not hide a missing module');
  assert.equal(card.tool, cad.tool);
});
test('New CAD card belongs to 3D parts and opens without generation parameters', () => {
  assert.deepEqual([card.cat, card.group, card.tool, card.preview], ['3d', 'cad', cad.tool, 'cube']);
  assert.match(card.name + ' ' + card.desc, /CAD.*editable dimensions/);
  assert.equal(card.query, undefined);
});
test('CAD remains optional and is not implicitly added to role templates', () => {
  const deps = /^dependencies:\n([^]*?)(?=^\S)/m.exec(manifest)[1];
  assert.match(deps, /required:\n\s+apps: \[\]/);
  assert.match(deps, /optional:\n[^]*?apps:\n[^]*?      - cad-studio\n/);
  assert.doesNotMatch(manifest, /\bapp:\s*cad-studio\b|\brole:\s*cad-studio\b/);
  const [major, minor] = /^version: (\d+)\.(\d+)\.\d+$/m.exec(manifest).slice(1).map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 18), 'CAD discovery shipped in 1.18.8; a later version keeps it');
});
test('read-only audience discovery also describes CAD', () => {
  const audience = literal(home, 'AUDIENCE_STUDIOS');
  assert.deepEqual(audience.find(s => s[0] === 'CAD Studio'), ['CAD Studio', 'Parametric parts and editable dimensions']);
});
test('LoRA New card and category expose the existing workspace without starting training', () => {
  const loraCard = literal(home, 'OTHER').find(c => c.id === 'lora-character');
  const lora = homeStudios.find(s => s.tool === 'create-lora');
  assert.deepEqual([lora.tool, lora.app, lora.url], ['create-lora', 'lora', '/api/lora/ui']);
  assert.deepEqual([loraCard.cat, loraCard.tool, loraCard.query], ['training', 'create-lora', undefined]);
  assert.ok(literal(home, 'CATEGORIES').some(c => c.id === loraCard.cat));
  assert.ok(literal(home, 'AUDIENCE_STUDIOS').some(s => s[0] === 'LoRA Studio'));
});
for (const [name, source] of [['Home and its New sheet', home]]) {
  test(name + ' embedded CAD navigation uses the exact rail tool and current origin', () => {
    const result = navigation(source, true, 'open');
    assert.deepEqual(result.messages, [[{type: 'app-navigate', tool: cad.tool}, 'https://fixture.invalid']]);
    assert.deepEqual(result.urls, []);
  });
  test(name + ' standalone CAD navigation uses the existing editor URL', () => {
    const result = navigation(source, false, 'open');
    assert.deepEqual(result.urls, ['/api/cad-studio/app']); assert.deepEqual(result.messages, []);
  });
  test(name + ' locked CAD navigation cannot open a URL or post a navigation', () => {
    for (const embedded of [true, false]) {
      const result = navigation(source, embedded, 'locked');
      assert.deepEqual(result.messages, []); assert.deepEqual(result.urls, []);
      assert.match(result.notices[0], /CAD Studio is not assigned/);
    }
  });
  test(name + ' CAD and LoRA access use the real authorization answer without assigning a role', async () => {
    for (const app of ['cad-studio', 'lora']) {
    for (const [answer, expected] of [[{status: 'catalog', tier: 'editor', denied: false}, 'open'],
      [{status: 'catalog', tier: 'deny'}, 'locked'], [{status: 'catalog', tier: 'editor', denied: true}, 'locked'],
      [{status: 'legacy'}, 'open'], [{}, 'locked'], [null, 'unknown']]) {
      const calls = [];
      const probe = actual(source, 'accessFor', {ACCESS_TIMEOUT_MS: 10000, fetchJson: async (...args) => { calls.push(args); return answer; }});
      assert.equal(await probe(app), expected);
      assert.deepEqual(calls, [['/api/authorization/me?app=' + app, 10000]], 'read only, no role apply, build or training');
    }
    assert.equal(await actual(source, 'accessFor', {ACCESS_TIMEOUT_MS: 10000, fetchJson: async () => { throw Error('unavailable'); }})(app), 'unknown');
    }
  });
  test(name + ' LoRA navigation opens only its existing workspace and respects locked access', () => {
    assert.deepEqual(navigation(source, false, 'open', 'lora').urls, ['/api/lora/ui']);
    assert.deepEqual(navigation(source, true, 'open', 'lora').messages,
      [[{type: 'app-navigate', tool: 'create-lora'}, 'https://fixture.invalid']]);
    for (const embedded of [true, false]) {
      const result = navigation(source, embedded, 'locked', 'lora');
      assert.deepEqual(result.messages, []); assert.deepEqual(result.urls, []);
      assert.match(result.notices[0], /LoRA Studio is not assigned/);
    }
  });
}

async function summary(access) {
  const requests = [];
  const node = () => ({replaceChildren() {}, appendChild() {}});
  const context = {STUDIOS: [cad], ACCESS: {'cad-studio': access}, recentGrid: node(), metricsEl: node(),
    recentNote: {}, weekNote: {}, el: node, applyFilters() {}, renderRecent() {}, collectSummary() {}, finishSummaries() {},
    fetchJson: async route => { requests.push(route); return {items: [], metrics: []}; }};
  await actual(home, 'loadSummaries', context)();
  return requests;
}
test('a locked CAD studio never reads its owner summary', async () => {
  assert.deepEqual(await summary('locked'), []);
});
test('an accessible CAD studio reads its own summary once without creating a model', async () => {
  assert.deepEqual(await summary('open'), ['/api/cad-studio/home-summary']);
});
