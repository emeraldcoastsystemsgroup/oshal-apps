/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "What LoRA models have I trained?" from Jarvis answered that LoRA Studio could not list trained models, while the studio showed them: the director had no tool. lora-characters and lora-models are read tools on the mounted GET /characters and GET /models, each bound in the catalog to lora.read, exactly the permission the route's own binding needs (the kernel offers a catalog application's tool only then), and the persona calls them.
 *
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped saved-source handoff and verify its persona mapping, approved mutations and narrow source role against the actual manifest/catalog.
 *
 * Dependency-free `node --test` suite apart from the store toolchain's js-yaml.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(ROOT, 'authorization.yaml'), 'utf8'));
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'lora-director.yaml'), 'utf8'));

for (const [name, route] of [['lora-characters', '/characters'], ['lora-models', '/models']]) {
  test(`${name} reads GET ${route} under the same permission the route needs`, () => {
    const tool = manifest.tools.find((t) => t.name === name);
    assert.equal(tool.executor.apiEndpoint, `GET /api/lora${route}`);
    assert.equal(tool.requiresApproval, false);
    const http = catalog.bindings.http.find((b) => b.method === 'GET' && b.path === route);
    const bound = catalog.bindings.tools.find((b) => b.id === name);
    assert.deepEqual(bound.allOf, http.allOf);
    assert.ok(fs.readFileSync(path.join(ROOT, 'routes', 'bot-lora-routes.js'), 'utf8').includes(`router.get('${route}'`));
  });
}

test('the director calls the read tools instead of saying it cannot see them', () => {
  assert.match(persona.perspective, /call lora-characters or\s+lora-models/);
  assert.match(persona.perspective, /Never say you cannot see them/);
});

test('the actual saved-source handoff distinguishes character UUID, subject and selected caption revision', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'tools', 'lora.html'), 'utf8');
  const source = html.slice(html.indexOf('async function prepareLoraSource()'), html.indexOf('async function refreshLoraSource('));
  assert.ok(source.startsWith('async function prepareLoraSource()'));
  const characterId = '6831f88d-26b6-4d21-952d-2b92cf6c2e10';
  const imageId = '9ea8931d-9811-487f-bab1-4ef37e46e71e';
  const context = {
    document: {activeElement: {blur() {}}}, loraEditor: {async flushPending() {}}, creationDraft: false,
    SEL: 'saved-character-subject', identitySource: {characterId, displayName: 'Saved name', canConfigure: true},
    sourceDirty: () => false, captionObject: {id: imageId, caption_status: 'pending'},
    sourceSelection: () => ({kind: 'caption', imageId}), sourceRevision: () => 0,
  };
  const prepare = require('node:vm').runInNewContext(source + '; prepareLoraSource', context);
  const handoff = await prepare();
  assert.equal(handoff.recordId, characterId);
  assert.equal(handoff.fields.subject, 'saved-character-subject');
  assert.equal(handoff.fields.imageId, imageId);
  assert.equal(handoff.fields.revision, 0);
  assert.match(persona.perspective, /recordId is the character UUID, NOT the subject/);
  assert.match(persona.perspective, /Use fields\.subject as the tools' subject; use fields\.imageId as imageId/);
  assert.match(persona.perspective, /characterId matches recordId/);
  assert.match(persona.perspective, /fresh caption read's image\.caption_revision, including revision zero/);
  assert.match(persona.perspective, /After manual changes, read the selected saved source AGAIN/);
  assert.doesNotMatch(persona.perspective, /You ONLY reason/);
});

test('the source tools named by the persona remain offered to source-editor with actual held writes', () => {
  const granted = new Set(catalog.roles['source-editor'].grants.map(g => g.permission));
  const expected = [
    ['lora-editor-contract', 'GET', '/editor-contract', false],
    ['lora-editor-character', 'GET', '/characters/:subject/editor', false],
    ['lora-editor-caption', 'GET', '/dataset/:imageId/caption', false],
    ['lora-editor-character-edit', 'PATCH', '/characters/:subject/editor', true],
    ['lora-editor-caption-edit', 'PATCH', '/dataset/:imageId/caption', true],
    ['lora-editor-caption-retry', 'POST', '/dataset/:imageId/caption/retry', true],
  ];
  for (const [name, method, route, held] of expected) {
    const tool = manifest.tools.find(t => t.name === name);
    assert.ok(tool, name);
    assert.ok(persona.perspective.includes(name), name);
    assert.equal(tool.requiresApproval, held, name);
    const binding = catalog.bindings.tools.find(b => b.id === name);
    const http = catalog.bindings.http.find(b => b.method === method && b.path === route);
    assert.deepEqual(binding.allOf, http.allOf, name);
    assert.ok(binding.allOf.every(permission => granted.has(permission)), name);
  }
  assert.equal(granted.has('lora.execute'), false);
  assert.equal(granted.has('lora.configure'), false);
  assert.match(persona.perspective, /prepare the native approval card, then wait\s+for approval and its result/);
  assert.match(persona.perspective, /Source editing never authorizes training, image generation or autonomous execution/);
  assert.match(persona.perspective, /image\.applied_revision and image\.caption_revision and applied status/);
});
