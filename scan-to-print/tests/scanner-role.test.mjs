/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.8.6: the narrow scanner role (the trial visitor's) builds the model from photos, a video, a .ply or depth, and never registers a printer address or sends a print. Read from the shipped catalog and run through the real compiled calibration guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../scripts/toolchain/package.json', import.meta.url));
const yaml = require('js-yaml');
const catalog = yaml.load(readFileSync(new URL('../authorization.yaml', import.meta.url), 'utf8'));
const role = catalog.roles.scanner;
const grants = new Set((role?.grants || []).map((g) => g.permission));
const admits = (binding) => !!binding && binding.allOf.every((p) => grants.has(p));
const http = (id) => catalog.bindings.http.find((b) => b.id === id);
const tool = (id) => catalog.bindings.tools.find((b) => b.id === id);
const actor = { isActive: true, issuer: 'https://role.fixture', sub: 'visitor', principalId: 'principal', tenantIds: ['tenant'] };

test('scanner is an editor-tier role over the visitor\'s own objects, with no execute permission', () => {
  assert.ok(role, 'scanner role is declared');
  assert.equal(role.tier, 'editor');
  for (const grant of role.grants) {
    assert.equal(grant.scope, 'own');
    assert.ok(catalog.permissions[grant.permission], grant.permission);
    assert.notEqual(catalog.permissions[grant.permission].effect, 'execute', grant.permission);
  }
  assert.deepEqual([...grants].sort(), ['app.open', 'scan.edit', 'scan.read', 'scan.source.change']);
});

test('scanner reaches every step from photos to the model and its download', () => {
  for (const id of ['app', 'create-job', 'add-images', 'change-image', 'delete-image', 'read-image', 'change-calibration',
    'reconstruct', 'add-video', 'import-pointcloud', 'add-depth', 'read-artifact', 'frame-suggestions']) {
    assert.ok(admits(http(id)), id);
  }
  for (const id of ['scan-read-calibration', 'scan-update-calibration']) assert.ok(admits(tool(id)), id);
});

test('scanner never registers, changes or removes a printer and never sends a print', () => {
  for (const id of ['add-printer', 'change-printer', 'remove-printer', 'print-job']) assert.equal(admits(http(id)), false, id);
  assert.equal(admits(tool('print-to-3d-printer')), false, 'print-to-3d-printer');
  for (const permission of ['printer.manage', 'print.send']) assert.equal(grants.has(permission), false, permission);
});

test('the real calibration guard admits scan.edit for a scanner and refuses printer control and printing', async () => {
  const { calibrationAccess } = createRequire(import.meta.url)('../routes/calibration-editor.js');
  let live = true;
  const ctx = { authorization: { currentActor: () => ({ ...actor }), authorize: async ({ permission }) => ({ allowed: live && grants.has(permission) }) } };
  const original = await calibrationAccess(ctx, 'scan.read');
  await calibrationAccess(ctx, 'scan.edit', original);
  await calibrationAccess(ctx, 'scan.source.change', original);
  for (const permission of ['printer.manage', 'print.send']) await assert.rejects(calibrationAccess(ctx, permission), { status: 403 });
  live = false;
  await assert.rejects(calibrationAccess(ctx, 'scan.edit'), { status: 403 });
});

test('maker and source-editor keep exactly what they had', () => {
  const of = (name) => catalog.roles[name].grants.map((g) => g.permission).sort();
  assert.deepEqual(of('maker'), ['app.open', 'print.send', 'printer.manage', 'scan.edit', 'scan.read', 'scan.source.change']);
  assert.deepEqual(of('source-editor'), ['app.open', 'scan.read', 'scan.source.change']);
});
