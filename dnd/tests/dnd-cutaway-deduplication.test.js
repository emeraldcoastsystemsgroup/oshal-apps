/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove concurrent players and reconnects share one paid illustration for the same authoritative story event.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMediaService, _test } = require('../lib/dnd-media-service');

/** @description Build an isolated illustrator with observable provider and archive calls. */
function fixture(root) {
  const observed = { renders: 0, archives: [], costs: 0 };
  const provider = {
    id: 'test-image',
    generateWithMeta: async () => {
      observed.renders++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { image: Buffer.from('one-image'), costUsd: 0.04, model: 'test-model' };
    },
  };
  const media = createMediaService({
    pool: {},
    campaign: {
      access: async () => ({ campaign_id: 'camp-1' }),
      archive: async (_sub, _campaignId, kind, content) => { observed.archives.push({ kind, content }); },
    },
    imageFramework: {
      resolve: async () => provider,
      recordCost: async () => { observed.costs++; },
    },
  });
  process.env.CLINE_WORKSPACE_ROOT = root;
  return { media, observed };
}

test('one event key produces one paid file across concurrent calls and reconnects', async (t) => {
  const previousRoot = process.env.CLINE_WORKSPACE_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-cutaway-'));
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CLINE_WORKSPACE_ROOT;
    else process.env.CLINE_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const { media, observed } = fixture(root);
  const body = { campaignId: 'camp-1', eventKey: 'round:timeline:coast-road:2', prompt: 'The second round turns.' };
  const [first, shared] = await Promise.all([
    media.generateCutaway('host', body),
    media.generateCutaway('guest', body),
  ]);
  const replay = await media.generateCutaway('host', body);

  assert.equal(first.ok, true);
  assert.equal(first.url, shared.url);
  assert.equal(first.url, replay.url);
  assert.equal(shared.deduplicated, true);
  assert.equal(replay.deduplicated, true);
  assert.equal(observed.renders, 1);
  assert.equal(observed.archives.length, 1);
  assert.equal(observed.costs, 1);
  assert.equal(first.url.split('/').pop(), `${_test.cutawayIdentity(body)}.png`);
  assert.ok(fs.existsSync(path.join(media.cutawayDir('camp-1'), `${_test.cutawayIdentity(body)}.png`)));
});
