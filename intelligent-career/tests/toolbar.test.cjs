/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the actual Career toolbar's delegated navigation complete and its references owned by real member surfaces.
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
const members = new Map(group.dependencies.apps.map(name => [name, yaml.load(readFileSync(resolve(store, name, 'oshal-app.yaml'), 'utf8'))]));

test('Career group retains all six destinations delegated from the global Career navigation', () => {
  const delegated = ['career-board', 'career-strengthen', 'career-recruiters', 'career-approvals', 'career-insights', 'career-settings'];
  for (const surface of delegated) assert.ok(group.toolbar.some(item => item.app === 'career-hunter' && item.surface === surface), surface);
});

test('every shipped toolbar reference resolves once to its declared member rather than a copied URL', () => {
  const seen = new Set();
  for (const item of group.toolbar) {
    assert.ok(members.has(item.app), item.app);
    assert.equal(members.get(item.app).ui.static.filter(surface => surface.toolName === item.surface).length, 1, item.surface);
    assert.equal(seen.has(`${item.app}/${item.surface}`), false); seen.add(`${item.app}/${item.surface}`);
    assert.equal(Object.hasOwn(item, 'iframeUrl'), false);
  }
  for (const key of ['routes', 'tools', 'migrations', 'uses', 'ui']) assert.equal(Object.hasOwn(group, key), false, key);
});
