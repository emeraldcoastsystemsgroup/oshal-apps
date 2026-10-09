/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the fixed six-member Home Workspace group and owner-app surface references without copied routes or a group bot.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pin the metadata-only concierge to the canonical bot of the required Smart Home member while keeping the group free of executable bots and workflows.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');

const root = resolve(__dirname, '..');
const store = resolve(root, '..');
const core = resolve(process.env.OSHAL_CORE_ROOT || resolve(store, '../oshal'));
const yaml = createRequire(resolve(core, 'package.json'))('js-yaml');
const group = yaml.load(readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8'));
const required = ['home', 'social', 'career-hunter', 'storage', 'switchboard', 'video'];
const members = new Map(required.map(name => [name, yaml.load(readFileSync(resolve(store, name, 'oshal-app.yaml'), 'utf8'))]));

test('Home Workspace has exactly the operator-approved required members and no own executable surface', () => {
  assert.equal(group.name, 'workspace');
  assert.equal(group.kind, 'group');
  assert.deepEqual(group.dependencies.required.apps, required);
  assert.deepEqual(group.dependencies.optional.apps, []);
  for (const key of ['bots', 'routes', 'tools', 'migrations', 'uses', 'ui', 'workflow']) {
    assert.equal(Object.hasOwn(group, key), false, key);
  }
  assert.equal(group.chatBot, 'home-bot');
  assert.equal(members.get('home').workflow.workerBot, group.chatBot);
});

test('all six members lend real unique surfaces; no route or label is copied into the group', () => {
  const seen = new Set();
  for (const name of required) assert.ok(group.toolbar.some(item => item.app === name), name);
  for (const item of group.toolbar) {
    const member = members.get(item.app);
    assert.ok(member, item.app);
    assert.equal(member.ui.static.filter(surface => surface.toolName === item.surface).length, 1, `${item.app}/${item.surface}`);
    assert.deepEqual(Object.keys(item).sort(), Object.keys(item).filter(key => ['app', 'surface', 'group', 'section'].includes(key)).sort());
    const key = `${item.app}/${item.surface}`;
    assert.equal(seen.has(key), false, key);
    seen.add(key);
  }
  assert.equal(group.ribbon.defaultView, 'home-dashboard');
});

test('the connector rail is limited to the six members declared connector choices', () => {
  const offered = new Set(required.flatMap(name => members.get(name).dependencies?.optional?.connectors || []));
  assert.deepEqual(new Set(group.dependencies.optional.connectors), offered);
  assert.deepEqual(group.dependencies.required.connectors, []);
});
