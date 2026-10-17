/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "Generate a 10 second video of waves crashing on a beach" from Jarvis shaped a Veo prompt and stopped: vids-operator's only tool was the CLI vids_generate, which the native kernel never offers. vids-jobs, vids-generate-clip and vids-brand-graphic are route-backed tools on the compiled routes the Vids page uses, the two generating ones held for the person's approval, and the persona authorizes and calls them.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A recap asked for in a conversation becomes one anchor clip from the figures already given (it answered that trade_recap_pipeline was unavailable and did nothing).
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
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'vids-operator.yaml'), 'utf8'));
const routes = fs.readFileSync(path.join(ROOT, 'routes', 'vids-routes.js'), 'utf8');
const tool = (name) => manifest.tools.find((t) => t.name === name);

test('each tool is route-backed on a route the compiled module mounts under /api/vids', () => {
  for (const [name, method, route] of [['vids-jobs', 'get', '/jobs'], ['vids-generate-clip', 'post', '/jobs'], ['vids-brand-graphic', 'post', '/brand']]) {
    const t = tool(name);
    assert.ok(t, `${name} is declared`);
    assert.equal(t.executor.executorType, 'api');
    assert.equal(t.executor.apiEndpoint, `${method.toUpperCase()} /api/vids${route}`);
    assert.ok(routes.includes(`router.${method}('${route}'`), `${method} ${route} is mounted`);
  }
});

test('generating is held for approval, reading is not, and the brand route\'s confirm is required', () => {
  assert.equal(tool('vids-jobs').requiresApproval, false);
  assert.equal(tool('vids-generate-clip').requiresApproval, true);
  assert.equal(tool('vids-brand-graphic').requiresApproval, true);
  assert.deepEqual(tool('vids-brand-graphic').inputSchema.properties.confirm, { type: 'boolean', const: true });
  assert.ok(tool('vids-brand-graphic').inputSchema.required.includes('confirm'));
});

test('the operator authorizes the tools and is told to call them instead of stopping at a prompt', () => {
  assert.equal(persona.authorizations['vids-jobs'], 'auto');
  assert.equal(persona.authorizations['vids-generate-clip'], 'approval');
  assert.equal(persona.authorizations['vids-brand-graphic'], 'approval');
  assert.match(persona.perspective, /call vids-generate-clip once/);
  assert.match(persona.perspective, /do not stop at the shaped\s+prompt/);
});

test('a recap asked for in a conversation becomes an anchor clip from the figures given, never invented ones', () => {
  assert.match(persona.perspective, /In a conversation \(not a recap ticket\) the full pipeline does not run here/);
  assert.match(persona.perspective, /call\s+vids-generate-clip with it/);
  assert.match(persona.perspective, /Never invent\s+or round a figure/);
  assert.doesNotMatch(persona.perspective, /In a conversation you hold no tool/);
});

