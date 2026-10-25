/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the actual Career toolbar's delegated navigation complete and its references owned by real member surfaces.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Read canonical required membership and keep Career configuration and sources conspicuous without changing the group's declarative contract.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const root = resolve(__dirname, '..'), store = resolve(root, '..');
const core = resolve(process.env.OSHAL_CORE_ROOT || resolve(store, '../oshal'));
const candidates = [process.env.STORE_CI_TOOLCHAIN, resolve(store, 'scripts/toolchain/node_modules'), resolve(core, 'node_modules')].filter(Boolean);
const toolchain = candidates.find(directory => existsSync(resolve(directory, 'js-yaml/package.json')));
if (!toolchain) throw new Error('js-yaml requires scripts/toolchain dependencies or STORE_CI_TOOLCHAIN');
const yaml = createRequire(resolve(toolchain, 'js-yaml/package.json'))('./index.js');
const group = yaml.load(readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8'));
const members = new Map(group.dependencies.required.apps.map(name => [name, yaml.load(readFileSync(resolve(store, name, 'oshal-app.yaml'), 'utf8'))]));

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

test('Career configuration and sources are a visible borrowed navigation band', () => {
  assert.equal(group.kind, 'group');
  assert.equal(group.version, '1.1.2');
  assert.deepEqual([...members.keys()], ['career-hunter', 'portrait-studio', 'social', 'print-ingest']);
  for (const surface of ['career-settings', 'career-companies']) {
    const item = group.toolbar.find(item => item.app === 'career-hunter' && item.surface === surface);
    assert.equal(item?.group, 'Configuration', surface);
    assert.equal(item.section, undefined, 'configuration is not confined to the bottom tray');
  }
  assert.equal(group.setup.length, 7);
  assert.equal(group.experience, undefined, 'the group keeps its no-code contract; Career Hunter owns the authenticated experience');
});
