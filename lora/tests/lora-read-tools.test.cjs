/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "What LoRA models have I trained?" from Jarvis answered that LoRA Studio could not list trained models, while the studio showed them: the director had no tool. lora-characters and lora-models are read tools on the mounted GET /characters and GET /models, each bound in the catalog to lora.read, exactly the permission the route's own binding needs (the kernel offers a catalog application's tool only then), and the persona calls them.
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
