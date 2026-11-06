/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise all fourteen studios' discovery parity and actual CAD/LoRA access decisions, navigation and owner-summary calls without opening a browser or running a build or training job.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'tools/create-home.html'), 'utf8');
const fresh = fs.readFileSync(path.join(root, 'tools/create-new.html'), 'utf8');
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
const newStudios = literal(fresh, 'STUDIO');
const card = literal(fresh, 'OTHER').find(c => c.id === 'cad-model');
function navigation(source, embedded, access, key = 'cad') {
  const messages = [], urls = [], notices = [];
  const studio = newStudios[key];
  const context = {embedded, ACCESS: {[studio.app]: access}, STUDIO: newStudios,
    byTool: {[studio.tool]: studio}, surfaceUrls: {}, toast: text => notices.push(text),
    window: {parent: {postMessage: (message, origin) => messages.push([plain(message), origin])},
      location: {origin: 'https://fixture.invalid', assign: url => urls.push(url)}}};
  actual(source, 'go', context)(source === home ? studio.tool : key);
  return {messages, urls, notices};
}

test('CAD Home discovery points at the existing CAD editor and rail tile', () => {
  assert.equal(new Set(literal(home, 'STUDIOS').map(s => s.app)).size, 14, 'all fourteen modules are discoverable');
  assert.deepEqual([cad.tool, cad.name, cad.url], ['create-cad-studio', 'CAD Studio', '/api/cad-studio/app']);
  const rail = /- toolName: create-cad-studio\n([^]*?)(?=\n    - toolName:|\n\n)/.exec(manifest)?.[1];
  assert.ok(rail); assert.match(rail, /iframeUrl: \/api\/cad-studio\/app/); assert.match(rail, /group: Studios/);
});
test('the CAD quick start is discoverable in the existing 3D category', () => {
  const starter = literal(home, 'STARTERS').find(s => s.id === 'cad-model');
  assert.deepEqual([starter.tool, starter.cat, starter.art], [cad.tool, '3d', 'cube']);
  assert.match(starter.label + ' ' + starter.hint, /CAD.*dimensions/);
  assert.equal(starter.query, undefined, 'opening the studio does not create or build a part');
});
test('New opens the same CAD-owned editor as Home and the rail', () => {
  assert.equal(new Set(Object.values(newStudios).map(s => s.app)).size, 14, 'New covers the same fourteen modules');
  assert.deepEqual([...new Set(Object.values(newStudios).map(s => s.app))].sort(),
    [...new Set(literal(home, 'STUDIOS').map(s => s.app))].sort(), 'Video aliases do not hide a missing module');
  assert.deepEqual([newStudios.cad.tool, newStudios.cad.app, newStudios.cad.url], [cad.tool, cad.app, cad.url]);
});
test('New CAD card belongs to 3D parts and opens without generation parameters', () => {
  assert.deepEqual([card.cat, card.group, card.studio, card.preview], ['3d', 'cad', 'cad', 'cube']);
  assert.match(card.name + ' ' + card.desc, /CAD.*editable dimensions/);
  assert.equal(card.query, undefined);
});
test('CAD remains optional and is not implicitly added to role templates', () => {
  const deps = /^dependencies:\n([^]*?)(?=^\S)/m.exec(manifest)[1];
  assert.match(deps, /required:\n\s+apps: \[\]/);
  assert.match(deps, /optional:\n[^]*?apps:\n[^]*?      - cad-studio\n/);
  assert.doesNotMatch(manifest, /\bapp:\s*cad-studio\b|\brole:\s*cad-studio\b/);
  assert.match(manifest, /^version: 1\.18\.8$/m);
});
test('read-only audience discovery also describes CAD', () => {
  const audience = literal(fresh, 'STUDIOS');
  assert.deepEqual(audience.find(s => s[0] === 'CAD Studio'), ['CAD Studio', 'Parametric parts and editable dimensions']);
});
test('LoRA New card and category expose the existing workspace without starting training', () => {
  const loraCard = literal(fresh, 'OTHER').find(c => c.id === 'lora-character');
  assert.deepEqual([newStudios.lora.tool, newStudios.lora.app, newStudios.lora.url], ['create-lora', 'lora', '/api/lora/ui']);
  assert.deepEqual([loraCard.cat, loraCard.studio, loraCard.query], ['training', 'lora', undefined]);
  assert.ok(literal(fresh, 'CATEGORIES').some(c => c.id === loraCard.cat));
  assert.ok(literal(fresh, 'STUDIOS').some(s => s[0] === 'LoRA Studio'));
});
for (const [name, source] of [['Home', home], ['New', fresh]]) {
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
      const probe = actual(source, 'accessFor', {fetchJson: async (...args) => { calls.push(args); return answer; }});
      assert.equal(await probe(app), expected);
      assert.deepEqual(calls, [['/api/authorization/me?app=' + app, 3000]], 'read only, no role apply, build or training');
    }
    assert.equal(await actual(source, 'accessFor', {fetchJson: async () => { throw Error('unavailable'); }})(app), 'unknown');
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
    recentNote: {}, weekNote: {}, el: node, applyFilters() {},
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
