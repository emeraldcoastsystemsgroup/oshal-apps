/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the two-member Intelligent Sports group (ADR-146 Q4): exactly fantasy-football and sports-edge, no executable surface of its own, every tile a real unique member surface, the default view a borrowed surface, and the connector allow-list exactly the members' union.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');

const root = resolve(__dirname, '..');
const store = resolve(root, '..');
const core = resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || resolve(store, '../oshal'));
const yaml = createRequire(resolve(core, 'package.json'))('js-yaml');
const group = yaml.load(readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8'));
const required = ['fantasy-football', 'sports-edge'];
const members = new Map(required.map((name) => [name, yaml.load(readFileSync(resolve(store, name, 'oshal-app.yaml'), 'utf8'))]));

test('Intelligent Sports has exactly the operator-decided members and no executable surface of its own', () => {
  assert.equal(group.name, 'intelligent-sports');
  assert.equal(group.kind, 'group');
  assert.equal(group.suite, 'ai-productivity');
  assert.deepEqual(group.dependencies.required.apps, required);
  assert.deepEqual(group.dependencies.optional.apps, []);
  for (const key of ['bots', 'routes', 'tools', 'migrations', 'uses', 'ui', 'workflow', 'smoke']) {
    assert.equal(Object.hasOwn(group, key), false, key);
  }
  for (const member of members.values()) assert.equal(member.chatBot, group.chatBot, 'the concierge is the members\' own');
});

test('every tile is a real, unique member surface; no route or label is copied into the group', () => {
  const seen = new Set();
  for (const name of required) assert.ok(group.toolbar.some((item) => item.app === name), name);
  for (const item of group.toolbar) {
    const member = members.get(item.app);
    assert.ok(member, item.app);
    assert.equal(member.ui.static.filter((surface) => surface.toolName === item.surface).length, 1, `${item.app}/${item.surface}`);
    assert.deepEqual(Object.keys(item).filter((key) => !['app', 'surface', 'group', 'section'].includes(key)), []);
    const key = `${item.app}/${item.surface}`;
    assert.equal(seen.has(key), false, key);
    seen.add(key);
  }
  assert.ok(group.toolbar.some((item) => item.surface === group.ribbon.defaultView), 'the default view is a borrowed tile');
});

test('the connector allow-list is exactly the members\' declared connector choices', () => {
  const offered = new Set(required.flatMap((name) => members.get(name).dependencies?.optional?.connectors || []));
  assert.deepEqual(new Set(group.dependencies.optional.connectors), offered);
  assert.deepEqual(group.dependencies.required.connectors, []);
});
