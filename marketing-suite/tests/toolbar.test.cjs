/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the Marketing group's borrowed navigation complete and owned by real member surfaces, and keep every setup step pointing at a readiness probe its member actually declares — the two ways an ADR-141 group rots into dead tiles or a setup page that can never complete.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const root = resolve(__dirname, '..'), store = resolve(root, '..');
const core = resolve(process.env.OSHAL_CORE_ROOT || resolve(store, '../oshal'));
const yaml = createRequire(resolve(core, 'package.json'))('js-yaml');
const group = yaml.load(readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8'));
const members = new Map(group.dependencies.apps.map((name) => [name, yaml.load(readFileSync(resolve(store, name, 'oshal-app.yaml'), 'utf8'))]));

test('the group carries no code of its own', () => {
  for (const key of ['routes', 'tools', 'migrations', 'uses', 'ui', 'bots', 'schedules', 'smoke', 'ticketType']) {
    assert.equal(Object.hasOwn(group, key), false, key);
  }
  assert.equal(group.kind, 'group');
});

test('every toolbar reference resolves once to its declared member rather than a copied URL', () => {
  const seen = new Set();
  for (const item of group.toolbar) {
    assert.ok(members.has(item.app), item.app);
    assert.equal(members.get(item.app).ui.static.filter((surface) => surface.toolName === item.surface).length, 1, item.surface);
    assert.equal(seen.has(`${item.app}/${item.surface}`), false, `${item.app}/${item.surface} repeats`);
    seen.add(`${item.app}/${item.surface}`);
    assert.equal(Object.hasOwn(item, 'iframeUrl'), false);
    assert.equal(Object.hasOwn(item, 'label'), false);
  }
});

test('the campaign board, the compose desk and connected accounts stay reachable', () => {
  for (const [app, surface] of [['marketing-engine', 'marketing-engine'], ['switchboard', 'switchboard-compose'], ['social', 'social-accounts']]) {
    assert.ok(group.toolbar.some((item) => item.app === app && item.surface === surface), `${app}/${surface}`);
  }
});

test('every setup step names a readiness probe its member declares and a surface in this toolbar', () => {
  const surfaces = new Set(group.toolbar.map((item) => item.surface));
  for (const step of group.setup) {
    const member = members.get(step.app);
    assert.ok(member, step.app);
    const declared = (member.readiness || []).map((probe) => probe.name);
    assert.ok(declared.includes(step.readiness), `${step.app} declares no readiness "${step.readiness}" (declares: ${declared.join(', ') || 'none'})`);
    assert.ok(surfaces.has(step.fix), `${step.fix} is not a toolbar surface`);
    assert.ok(step.label && step.label.trim().length > 0);
  }
});

test('finance stays out until the budget link exists', () => {
  assert.equal(group.dependencies.apps.includes('finance'), false,
    'a campaign budget held as a finance project is phase P2; until then this group must not force the finance app on an installer');
});
