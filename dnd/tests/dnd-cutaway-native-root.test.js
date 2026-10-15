/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-10-12 09:55:00 | maintainer@emeraldcoastsystemsgroup.com    | Native runtime regression: live every quest start journaled ENOENT mkdir '/package/workspace-shared/dnd-cutaways/...' because the cutaway directory fell back to <cwd>/workspace-shared and the native package's cwd is the read-only /package. With CLINE_WORKSPACE_ROOT unset and the process inside a read-only directory, a cutaway is written under os.tmpdir() (never under cwd) and the mkdir succeeds; an operator root still wins. The native runtime's real image provider (the kernel bridge's video_generation.js, configured:false) answers 'not available on this swarm' with no directory made and no error journaled.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createMediaService, _test } = require('../lib/dnd-media-service');

const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const CAMPAIGN = 'c0ffee00-1111-4222-8333-444455556666';

/** @description Run with CLINE_WORKSPACE_ROOT unset (or set to root) and restore it after. */
function withRoot(t, root) {
  const previous = process.env.CLINE_WORKSPACE_ROOT;
  if (root === undefined) delete process.env.CLINE_WORKSPACE_ROOT; else process.env.CLINE_WORKSPACE_ROOT = root;
  t.after(() => { if (previous === undefined) delete process.env.CLINE_WORKSPACE_ROOT; else process.env.CLINE_WORKSPACE_ROOT = previous; });
}

/** @description Enter a fresh read-only directory, as the native package's /package is, and leave it after. */
function inReadOnlyCwd(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-readonly-package-'));
  fs.chmodSync(dir, 0o555);
  const previous = process.cwd();
  process.chdir(dir);
  t.after(() => { process.chdir(previous); fs.chmodSync(dir, 0o755); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.throws(() => fs.mkdirSync(path.join(dir, 'workspace-shared')), /EACCES|EROFS|EPERM/, 'the fixture cwd must refuse writes');
  return dir;
}

/** @description A media service with a configured illustrator and an error journal. */
function media(provider) {
  const logged = [];
  const archived = [];
  const service = createMediaService({
    pool: {},
    logger: { error: (fields, message) => logged.push({ fields, message }), warn() {}, info() {} },
    campaign: { access: async () => ({ campaign_id: CAMPAIGN }), archive: async (_sub, _id, kind, url) => archived.push({ kind, url }) },
    imageFramework: { resolve: async () => provider, recordCost: async () => {} },
  });
  return { service, logged, archived };
}

const DRAWN = { id: 'test-image', generateWithMeta: async () => ({ image: Buffer.from('png-bytes'), costUsd: 0, model: 'm' }) };

test('with no workspace root and a read-only cwd, the cutaway is written under the temporary directory', async (t) => {
  withRoot(t, undefined);
  const cwd = inReadOnlyCwd(t);
  const root = _test.cutawayRoot();
  assert.equal(root, path.join(os.tmpdir(), 'workspace-shared'));
  assert.ok(!root.startsWith(cwd), 'never under the package folder');
  t.after(() => fs.rmSync(path.join(root, 'dnd-cutaways', CAMPAIGN), { recursive: true, force: true }));
  const { service, logged, archived } = media(DRAWN);
  const result = await service.generateCutaway('host', { campaignId: CAMPAIGN, prompt: 'The quest begins.', eventKey: 'quest:start' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(logged, [], 'no ENOENT is journaled');
  const dir = service.cutawayDir(CAMPAIGN);
  assert.equal(dir, path.join(root, 'dnd-cutaways', CAMPAIGN));
  const file = path.join(dir, path.basename(result.url));
  assert.equal(fs.readFileSync(file, 'utf8'), 'png-bytes');
  assert.deepEqual(archived, [{ kind: 'cutaway', url: result.url }]);
});

test('an operator CLINE_WORKSPACE_ROOT still wins', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-operator-root-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  withRoot(t, dir);
  assert.equal(_test.cutawayRoot(), dir);
});

test("the native runtime's real image provider (configured: false) answers not available, makes no directory and journals no error", async (t) => {
  const bridge = path.join(KERNEL, 'crates', 'host-process', 'bridge', 'video_generation.js');
  assert.ok(fs.existsSync(bridge), `the kernel checkout must be present to cross the native provider boundary (set OSHAL_KERNEL_ROOT); missing ${bridge}`);
  const { videoGeneration } = require(bridge);
  const provider = await videoGeneration.resolveStoryboardImageProvider();
  assert.equal(provider.configured, false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-native-provider-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  withRoot(t, root);
  const { service, logged, archived } = media(provider);
  const result = await service.generateCutaway('host', { campaignId: CAMPAIGN, prompt: 'x', eventKey: 'quest:start' });
  assert.deepEqual(result, { ok: false, soft: true, error: 'Cutaway art is not available on this swarm.' });
  assert.deepEqual(logged, []);
  assert.deepEqual(archived, []);
  assert.equal(fs.existsSync(path.join(root, 'dnd-cutaways')), false);
});
