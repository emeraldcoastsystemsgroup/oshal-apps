/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify combat cutaway beat classification (six big beats vs local transitions), per-campaign cutaway cap enforcement after deduplication and before provider calls, and seat-checked read-only GET /api/dnd/cutaway-budget (v0.22.9).
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const beats = require('../lib/dnd-cutaway-beats');
const { createMediaService } = require('../lib/dnd-media-service');
const { createDndRoutes } = require('../routes/dnd-routes');

/** @description Invoke one authenticated HTTP request through the real D&D router. */
function callRouter(router, sub, method, url, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = {
      method, url, body, headers: {},
      oidc: sub ? { user: { sub, name: sub }, isAuthenticated: () => true } : null,
    };
    const res = {
      statusCode: 0,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(value) { resolve({ status: this.statusCode, headers, body: JSON.parse(String(value || '{}')) }); },
    };
    Promise.resolve(router(req, res, () => reject(new Error('route fell through')))).catch(reject);
  });
}

/** @description Build an isolated media service fixture with observable renders and archive storage. */
function mediaFixture(root, archiveRows = []) {
  const observed = { renders: 0, archives: [...archiveRows], writes: 0 };
  const provider = {
    id: 'test-image',
    generateWithMeta: async () => {
      observed.renders += 1;
      return { image: Buffer.from(`png-${observed.renders}`), costUsd: 0.04, model: 'test-img' };
    },
  };
  const pool = {
    query: async (sql, params) => {
      if (!/^\s*SELECT/i.test(sql)) observed.writes += 1;
      if (/FROM dnd_archive/i.test(sql) && /kind='cutaway'/i.test(sql)) {
        const cid = params[0];
        return { rows: observed.archives.filter((r) => r.campaign_id === cid && r.kind === 'cutaway') };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const media = createMediaService({
    pool,
    campaign: {
      access: async (sub, campaignId) => (sub === 'host' && campaignId === 'camp-1' ? { campaign_id: 'camp-1' } : null),
      archive: async (_sub, campaignId, kind, content) => {
        observed.archives.push({ campaign_id: campaignId, kind, content });
      },
    },
    imageFramework: { resolve: async () => provider, recordCost: async () => {} },
  });
  process.env.CLINE_WORKSPACE_ROOT = root;
  return { media, observed, pool };
}

test('six big combat beats classify as generated with deterministic dedup keys', () => {
  const nat20 = beats.classifyCombatBeat({
    sceneId: 'coast-road', sceneTitle: 'Coast Road', round: 2,
    actorId: 'bram', actorName: 'Bram', targetId: 'gob-1', targetName: 'Rikkit',
    actionName: 'Longsword', natural: 20, damage: 14,
  });
  const nat1 = beats.classifyCombatBeat({
    sceneId: 'coast-road', sceneTitle: 'Coast Road', round: 2,
    actorId: 'pip', actorName: 'Pip', targetId: 'gob-1', targetName: 'Rikkit',
    actionName: 'Shortbow', natural: 1, outcome: 'miss',
  });
  const firstBlood = beats.classifyCombatBeat({
    sceneId: 'coast-road', sceneTitle: 'Coast Road', round: 1,
    actorId: 'bram', actorName: 'Bram', targetId: 'gob-2', targetName: 'Tallow',
    actionName: 'Longsword', damage: 6, firstBlood: true,
  });
  const heroDown = beats.classifyCombatBeat({
    sceneId: 'coast-road', sceneTitle: 'Coast Road', round: 3,
    heroId: 'fenwick', heroName: 'Fenwick', heroDown: true,
  });
  const levelUp = beats.classifyCombatBeat({
    kind: 'level-up', sceneId: 'watchtower-road', heroId: 'della', heroName: 'Della', newLevel: 3,
  });
  const bossReveal = beats.classifyCombatBeat({
    kind: 'boss-reveal', sceneId: 'citadel-sanctum', bossId: 'warden-1', bossName: 'Ashen Warden', bossRole: 'Sanctum Boss',
  });
  assert.deepEqual([nat20.tier, nat1.tier, firstBlood.tier, heroDown.tier, levelUp.tier, bossReveal.tier],
    ['generated', 'generated', 'generated', 'generated', 'generated', 'generated']);
  assert.equal(nat20.key, 'beat:nat20:2:bram:gob-1');
  assert.equal(nat1.key, 'beat:nat1:2:pip:gob-1');
  assert.equal(firstBlood.key, 'beat:first-blood:coast-road');
  assert.equal(heroDown.key, 'beat:hero-down:coast-road:fenwick:3');
  assert.equal(levelUp.key, 'beat:level-up:della:lv3');
  assert.equal(bossReveal.key, 'beat:boss-reveal:citadel-sanctum:warden-1');
});

test('common combat beats classify as local transitions and never request generated art', () => {
  const hit = beats.classifyCombatBeat({ actorName: 'Bram', targetName: 'Goblin', actionName: 'Longsword', damage: 7, outcome: 'hit', natural: 14 });
  const miss = beats.classifyCombatBeat({ actorName: 'Goblin', targetName: 'Bram', actionName: 'Scimitar', outcome: 'miss', natural: 6 });
  const spell = beats.classifyCombatBeat({ actorName: 'Fenwick', targetName: 'Goblin', actionName: 'Fire Bolt', actionType: 'spell', damage: 5 });
  const heal = beats.classifyCombatBeat({ actorName: 'Della', targetName: 'Bram', actionName: 'Cure Wounds', actionMode: 'heal', healed: 8 });
  const advance = beats.classifyCombatBeat({ kind: 'advance', sceneTitle: 'Ember Bridge' });
  for (const item of [hit, miss, spell, heal, advance]) {
    assert.equal(item.tier, 'local', item.beatKind);
    assert.equal(item.key, null, item.beatKind);
    assert.equal(item.prompt, '', item.beatKind);
  }
  assert.deepEqual([hit.beatKind, miss.beatKind, spell.beatKind, heal.beatKind, advance.beatKind],
    ['local:hit', 'local:miss', 'local:spell', 'local:heal', 'local:advance']);
});

test('outcome classifier detects boss tokens, first blood once, and big roll beats', () => {
  const tokens = [
    { id: 'bram', kind: 'pc', name: 'Bram', hp: 12, maxHp: 12 },
    { id: 'gob-1', kind: 'monster', ref: 'goblin', name: 'Rikkit', hp: 3, maxHp: 7 },
    { id: 'boss-1', kind: 'monster', ref: 'ogre-brute', name: 'Brug Bridgebreaker', role: 'Span Boss', hp: 59, maxHp: 59 },
  ];
  assert.deepEqual(beats.findBossTokens(tokens, null, {}).map((t) => t.id), ['boss-1']);
  const first = beats.classifyOutcomeBeat({
    sceneId: 'ember-bridge', round: 1, tokens, firstBloodClaimed: false,
    outcome: { rollEvent: { rolls: [{ kind: 'attack', actorId: 'bram', targetId: 'gob-1', actionName: 'Longsword', dice: '1d20', faces: [15], outcome: 'hit' }, { kind: 'damage', total: 4 }] } },
  });
  assert.equal(first.beat.beatKind, 'first-blood');
  assert.equal(first.claimedFirstBlood, true);
  const second = beats.classifyOutcomeBeat({
    sceneId: 'ember-bridge', round: 1, tokens, firstBloodClaimed: true,
    outcome: { rollEvent: { rolls: [{ kind: 'attack', actorId: 'bram', targetId: 'gob-1', actionName: 'Longsword', dice: '1d20', faces: [15], outcome: 'hit' }, { kind: 'damage', total: 4 }] } },
  });
  assert.equal(second.beat.tier, 'local');
  assert.equal(second.beat.beatKind, 'local:hit');
});

test('per-campaign cutaway cap refuses new keys with zero provider calls while serving cached replays', async (t) => {
  const previousRoot = process.env.CLINE_WORKSPACE_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-cutaway-cap-'));
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CLINE_WORKSPACE_ROOT;
    else process.env.CLINE_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const { media, observed } = mediaFixture(root);
  const r1 = await media.generateCutaway('host', { campaignId: 'camp-1', key: 'beat:nat20:1:bram:gob-1', beatKind: 'nat20', prompt: 'Crit!', cap: 2 });
  const r2 = await media.generateCutaway('host', { campaignId: 'camp-1', key: 'beat:first-blood:coast-road', beatKind: 'first-blood', prompt: 'Blood!', cap: 2 });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.cutawayBudget, { used: 1, cap: 2, remaining: 1 });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.cutawayBudget, { used: 2, cap: 2, remaining: 0 });
  assert.equal(observed.renders, 2);

  const capped = await media.generateCutaway('host', { campaignId: 'camp-1', key: 'beat:nat1:2:pip:gob-1', beatKind: 'nat1', prompt: 'Fumble!', cap: 2 });
  assert.equal(capped.ok, false);
  assert.equal(capped.soft, true);
  assert.equal(capped.capped, true);
  assert.equal(capped.beatKind, 'nat1');
  assert.equal(capped.key, 'beat:nat1:2:pip:gob-1');
  assert.deepEqual(capped.cutawayBudget, { used: 2, cap: 2, remaining: 0 });
  assert.match(capped.message, /2\/2/);
  assert.equal(observed.renders, 2, 'provider must not be called once cap is reached');

  const replay = await media.generateCutaway('host', { campaignId: 'camp-1', key: 'beat:nat20:1:bram:gob-1', beatKind: 'nat20', prompt: 'Crit!', cap: 2 });
  assert.equal(replay.ok, true);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.url, r1.url);
  assert.deepEqual(replay.cutawayBudget, { used: 2, cap: 2, remaining: 0 });
  assert.equal(observed.renders, 2, 'cached replay must not call provider or double-count');
});

test('GET /api/dnd/cutaway-budget is read-only, seat-checked, and reflects archived cutaways', async () => {
  const writes = [];
  const pool = {
    query: async (sql, params) => {
      if (!/^\s*SELECT/i.test(sql)) writes.push(sql);
      if (/FROM dnd_campaigns/i.test(sql)) {
        const [cid, sub] = params;
        return cid === 'camp-1' && ['host', 'guest'].includes(sub)
          ? { rows: [{ campaign_id: 'camp-1', user_sub: 'host', is_owner: sub === 'host' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (/FROM dnd_archive/i.test(sql)) {
        return { rows: [
          { content: '/api/dnd/cutaway/camp-1/aaa.png' },
          { content: '/api/dnd/cutaway/camp-1/bbb.png' },
          { content: '/api/dnd/cutaway/camp-1/aaa.png' },
        ] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const router = createDndRoutes({ pool, appPackageDir: path.join(__dirname, '..') });
  const ok = await callRouter(router, 'guest', 'GET', '/cutaway-budget?campaignId=camp-1');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.deepEqual(ok.body.cutawayBudget, { used: 2, cap: 20, remaining: 18 });
  assert.equal(ok.body.used, 2);
  assert.equal(ok.body.cap, 20);
  assert.equal(ok.body.remaining, 18);

  const denied = await callRouter(router, 'outsider', 'GET', '/cutaway-budget?campaignId=camp-1');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'NO_ACCESS');

  const missing = await callRouter(router, 'host', 'GET', '/cutaway-budget');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'CAMPAIGN_REQUIRED');
  assert.deepEqual(writes, [], 'cutaway-budget read must perform zero DB writes');
});
