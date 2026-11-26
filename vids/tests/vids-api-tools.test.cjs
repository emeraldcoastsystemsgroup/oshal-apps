/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "Generate a 10 second video of waves crashing on a beach" from Jarvis shaped a Veo prompt and stopped: vids-operator's only tool was the CLI vids_generate, which the native kernel never offers. vids-jobs, vids-generate-clip and vids-brand-graphic are route-backed tools on the compiled routes the Vids page uses, the two generating ones held for the person's approval, and the persona authorizes and calls them.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A recap asked for in a conversation becomes one anchor clip from the figures already given (it answered that trade_recap_pipeline was unavailable and did nothing).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.6.8 (tool parity): verify orientation & insertMode enums on vids-generate-clip, vids-generate-story, export management tools (vids-export-status, vids-publish-export, vids-revoke-export, vids-remove-export), and job lifecycle tools (vids-cancel-job, vids-retry-job) across manifest, compiled routes, and persona.
 *
 * Dependency-free `node --test` suite apart from the store toolchain's js-yaml.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const toolchain = process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, '..', 'scripts', 'toolchain');
const yaml = require(path.join(toolchain, 'node_modules', 'js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'vids-operator.yaml'), 'utf8'));
const routes = fs.readFileSync(path.join(ROOT, 'routes', 'vids-routes.js'), 'utf8');
const publishRoutes = fs.readFileSync(path.join(ROOT, 'routes', 'vids-publish-routes.js'), 'utf8');
const controlRoutes = fs.readFileSync(path.join(ROOT, 'routes', 'vids-job-controls.js'), 'utf8');
const tool = (name) => manifest.tools.find((t) => t.name === name);

test('each Vids operator tool is route-backed on a route the compiled modules mount under /api/vids', () => {
  const cases = [
    ['vids-jobs', 'GET', '/api/vids/jobs', routes, "router.get('/jobs'"],
    ['vids-generate-clip', 'POST', '/api/vids/jobs', routes, "router.post('/jobs'"],
    ['vids-brand-graphic', 'POST', '/api/vids/brand', routes, "router.post('/brand'"],
    ['vids-generate-story', 'POST', '/api/vids/story', routes, "router.post('/story'"],
    ['vids-export-status', 'GET', '/api/vids/jobs/{input.id}/artifact', publishRoutes, 'router.get(BASE'],
    ['vids-publish-export', 'POST', '/api/vids/jobs/{input.id}/artifact/publish', publishRoutes, 'router.post(`${BASE}/publish`'],
    ['vids-revoke-export', 'POST', '/api/vids/jobs/{input.id}/artifact/unpublish', publishRoutes, 'router.post(`${BASE}/unpublish`'],
    ['vids-remove-export', 'DELETE', '/api/vids/jobs/{input.id}/artifact', publishRoutes, 'router.delete(BASE'],
    ['vids-cancel-job', 'POST', '/api/vids/jobs/{input.id}/cancel', controlRoutes, "router.post('/jobs/:id/cancel'"],
    ['vids-retry-job', 'POST', '/api/vids/jobs/{input.id}/retry', controlRoutes, "router.post('/jobs/:id/retry'"],
  ];
  for (const [name, method, endpoint, source, marker] of cases) {
    const t = tool(name);
    assert.ok(t, `${name} is declared`);
    assert.equal(t.executor.executorType, 'api');
    assert.equal(t.executor.apiEndpoint, `${method} ${endpoint}`);
    assert.ok(source.includes(marker), `${name}: compiled route mounts ${marker}`);
  }
});

test('orientation and insertMode enums match backend contracts and approval posture is enforced', () => {
  const clip = tool('vids-generate-clip');
  assert.deepEqual(clip.inputSchema.properties.orientation.enum, ['Landscape', 'Portrait', 'Square']);
  assert.deepEqual(clip.inputSchema.properties.insertMode.enum, ['Insert', 'Extend', 'none']);
  const story = tool('vids-generate-story');
  assert.deepEqual(story.inputSchema.properties.orientation.enum, ['Landscape', 'Portrait', 'Square']);

  for (const ro of ['vids-jobs', 'vids-export-status']) {
    assert.equal(tool(ro).requiresApproval, false, `${ro} is read-only`);
    assert.equal(tool(ro).defaultAuthMode, 'auto', `${ro} is auto`);
  }
  for (const mut of [
    'vids-generate-clip', 'vids-brand-graphic', 'vids-generate-story',
    'vids-publish-export', 'vids-revoke-export', 'vids-remove-export',
    'vids-cancel-job', 'vids-retry-job',
  ]) {
    assert.equal(tool(mut).requiresApproval, true, `${mut} requires approval`);
    assert.equal(tool(mut).defaultAuthMode, 'ask', `${mut} defaults to ask`);
    assert.ok(typeof tool(mut).cardText === 'string' && tool(mut).cardText.trim().length > 0, `${mut} declares cardText`);
  }
  for (const confirmed of ['vids-brand-graphic', 'vids-publish-export', 'vids-revoke-export', 'vids-remove-export']) {
    assert.deepEqual(tool(confirmed).inputSchema.properties.confirm, { type: 'boolean', const: true });
    assert.ok(tool(confirmed).inputSchema.required.includes('confirm'));
  }
  assert.ok(tool('vids-publish-export').inputSchema.required.includes('sha256'));
});

test('the operator authorizes all parity tools and is told to call them instead of stopping at a prompt', () => {
  assert.equal(persona.authorizations['vids-jobs'], 'auto');
  assert.equal(persona.authorizations['vids-export-status'], 'auto');
  for (const mut of [
    'vids-generate-clip', 'vids-brand-graphic', 'vids-generate-story',
    'vids-publish-export', 'vids-revoke-export', 'vids-remove-export',
    'vids-cancel-job', 'vids-retry-job',
  ]) {
    assert.equal(persona.authorizations[mut], 'approval', `${mut} authorized as approval`);
  }
  assert.match(persona.perspective, /call vids-generate-clip once/);
  assert.match(persona.perspective, /do not stop at the shaped\s+prompt/);
  for (const name of ['vids-generate-story', 'vids-export-status', 'vids-publish-export', 'vids-revoke-export', 'vids-remove-export', 'vids-cancel-job', 'vids-retry-job']) {
    assert.ok(persona.perspective.includes(name), `persona perspective documents ${name}`);
  }
});

test('a recap asked for in a conversation becomes an anchor clip from the figures given, never invented ones', () => {
  assert.match(persona.perspective, /In a conversation \(not a recap ticket\) the full pipeline does not run here/);
  assert.match(persona.perspective, /call\s+vids-generate-clip with it/);
  assert.match(persona.perspective, /Never invent\s+or round a figure/);
  assert.doesNotMatch(persona.perspective, /In a conversation you hold no tool/);
});
