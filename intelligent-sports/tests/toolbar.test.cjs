/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the two-member Intelligent Sports group (ADR-146 Q4): exactly fantasy-football and sports-edge, no executable surface of its own, every tile a real unique member surface, the default view a borrowed surface, and the connector allow-list exactly the members' union.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sports Quant Concierge (F22): each member owns its own specialist concierge (fantasy-quant and sports-quant), and the group borrows its default required member's canonical concierge.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.0.4: the catalog description says the group has no work of its own and gives each act to the member that does it by name. It read as if the group itself followed a game with the odds maker, and Jarvis, which names an application from its description, asked "Intelligent Sports or Sports Edge?" for a question only Sports Edge answers.
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
  for (const member of members.values()) assert.notEqual(member.chatBot, 'general-bot', 'each member owns a specialist concierge');
  assert.ok([...members.values()].some((member) => member.chatBot === group.chatBot), 'the group borrows a required member\'s canonical concierge');
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

test('the description says the group gathers its members and gives each act to the member that does it', () => {
  const text = String(group.description).split(/\s+/).join(' ');
  assert.match(text, /^One front door for sport\. Intelligent Sports is a group with no work of its own: one toolbar that opens its two member applications' screens\./, text);
  // What a member does is said of that member by name, never of the group.
  assert.match(text, /Fantasy Football manages your own fantasy football team/, text);
  assert.match(text, /Sports Edge follows a team's next game with an odds maker that is graded on closing-line value/, text);
  for (const [name, member] of members) assert.ok(text.includes(member.displayName), `${name} is named as ${member.displayName}`);
  assert.doesNotMatch(text, /front door for sport: manage/, 'the group no longer lists its members\' work as its own');
  assert.ok(text.split(/\s+/).length <= 80, 'a product description, not a word list');
});
