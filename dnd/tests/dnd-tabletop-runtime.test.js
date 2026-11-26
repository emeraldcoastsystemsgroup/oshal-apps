/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify game-neutral TabletopRuntime contract validation, zero-D&D-leakage static guard, D&D 5e SRD ruleset pack execution, synthetic starship-skirmish second ruleset pack proof, and authenticated read-only GET /api/dnd/runtime (v0.22.10).
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  GAME_DEFINITION_SCHEMA_VERSION,
  TabletopRuntimeError,
  createTabletopRuntime,
  validateGameDefinition,
} = require('../lib/tabletop-runtime');
const { DND_GAME_ID, createDndRulesetPack } = require('../lib/dnd-ruleset-pack');
const { createDndRoutes } = require('../routes/dnd-routes');

const ROOT = path.join(__dirname, '..');

/** @description Load bundled D&D content fixtures for ruleset pack tests. */
function loadDndFixtures() {
  const dataDir = path.join(ROOT, 'data');
  const read = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  const party = read('party.json').party || [];
  const roster = read('srd-roster.json').roster || [];
  const bestiary = read('srd-monsters.json').monsters || {};
  const leveling = read('srd-leveling.json');
  const adventure = read('adventure-goblin-ambush.json');
  return {
    heroes: party.concat(roster),
    defaultParty: party.map((h) => h.id),
    bestiary,
    leveling,
    adventures: [adventure],
  };
}

/** @description Build a synthetic non-D&D ruleset pack (starship-skirmish) with zero fantasy concepts. */
function createStarshipSkirmishPack() {
  return {
    schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
    id: 'starship-skirmish',
    version: '1.0.0',
    name: 'Starship Skirmish',
    description: 'Tactical orbital fleet skirmish pack with shields, hull points, and sector ranks.',
    capabilities: ['sessions', 'seats', 'turns', 'shared-rolls', 'story', 'media', 'rewind', 'tactical-grid', 'progression'],
    rulesAdapter: {
      validateState: ({ proposed }) => ({ ok: !!(proposed && proposed.sector), code: proposed && proposed.sector ? 'OK' : 'INVALID_SECTOR' }),
      resolveTurnAction: ({ ship, weapon, target }) => {
        const damage = Number(weapon.power) || 4;
        const remainingHull = Math.max(0, (Number(target.hull) || 10) - damage);
        return { attacker: ship.id, target: target.id, weapon: weapon.name, damage, remainingHull, critical: damage >= 8 };
      },
      classifyBeat: (event) => {
        const outcome = event && event.outcome;
        if (outcome && outcome.critical) {
          return { tier: 'generated', beatKind: 'hull-breach', key: `skirmish:breach:${outcome.target}`, title: 'Hull Breach!', caption: `${outcome.attacker} shatters ${outcome.target}'s hull.` };
        }
        return { tier: 'local', beatKind: 'local:volley', key: null, title: 'Laser Volley', caption: 'Shields absorb glancing fire.' };
      },
      advanceProgression: ({ ship, commendations }) => {
        const rank = (Number(ship.rank) || 1) + (Number(commendations) >= 100 ? 1 : 0);
        return { ship: { ...ship, rank, hullMax: (Number(ship.hullMax) || 20) + (rank > ship.rank ? 5 : 0) }, promoted: rank > ship.rank };
      },
      evaluateEndState: ({ outcome }) => ({ resolved: !!(outcome && outcome.remainingHull <= 0), outcome: outcome && outcome.remainingHull <= 0 ? 'fleet-victory' : 'engaged' }),
    },
    narratorAdapter: {
      narrateTurn: async ({ beat }) => ({ ok: true, narration: `Bridge log: ${beat ? beat.caption : 'All stations hold steady.'}` }),
      describeBeat: (beat) => `[COMMS] ${beat.title}: ${beat.caption}`,
      voiceProfile: { provider: 'ship-comms', style: 'tactical-bridge', naturalOnly: true },
    },
    contentPack: {
      listAdventures: () => [{ id: 'vega-blockade', title: 'Vega Blockade', sectors: 3 }],
      listRoster: () => [{ id: 'corvette-alpha', name: 'ISV Horizon', hullMax: 20, rank: 1 }],
      metadata: { genre: 'sci-fi', gridUnit: 'hex', maxRank: 5 },
    },
  };
}

/** @description Build stub platform services to observe game-neutral delegation loops. */
function buildStubServices() {
  const calls = [];
  const record = (name, value) => (...args) => { calls.push({ name, args }); return value; };
  return {
    calls,
    services: {
      campaign: {
        createCampaign: record('campaign.createCampaign', { ok: true, campaignId: 'sess-1' }),
        access: record('campaign.access', { campaign_id: 'sess-1', is_owner: true }),
        listCampaigns: record('campaign.listCampaigns', { ok: true, campaigns: [] }),
        loadState: record('campaign.loadState', { ok: true, state: { sector: 'vega-1' } }),
        saveState: record('campaign.saveState', { ok: true, rev: 2 }),
        deleteCampaign: record('campaign.deleteCampaign', { ok: true }),
        claimHero: record('campaign.claimHero', { ok: true }),
        joinCampaign: record('campaign.joinCampaign', { ok: true }),
        leaveCampaign: record('campaign.leaveCampaign', { ok: true }),
        releaseGuestSeat: record('campaign.releaseGuestSeat', { ok: true }),
      },
      rolls: {
        normalizeRollPayload: record('rolls.normalizeRollPayload', { v: 1, eventId: 'ev-1', rolls: [] }),
        isRollPayload: record('rolls.isRollPayload', true),
        rollShared: record('rolls.rollShared', { ok: true, total: 14 }),
      },
      media: {
        readCutawayBudget: record('media.readCutawayBudget', { ok: true, used: 1, cap: 20, remaining: 19 }),
        budgetSummary: record('media.budgetSummary', { used: 1, cap: 20, remaining: 19 }),
        generateCutaway: async (...args) => { calls.push({ name: 'media.generateCutaway', args }); return { ok: true, url: '/api/dnd/cutaway/sess-1/breach.png' }; },
      },
      timeline: {
        saveSnapshot: record('timeline.saveSnapshot', { ok: true, snapshotId: 'snap-1' }),
        listSnapshots: record('timeline.listSnapshots', { ok: true, snapshots: [] }),
        playback: record('timeline.playback', { ok: true, frames: [] }),
        restoreSnapshot: record('timeline.restoreSnapshot', { ok: true }),
        exportReplay: record('timeline.exportReplay', { contentType: 'text/markdown', body: '# Recap' }),
        advance: record('timeline.advance', { ok: true, done: false }),
      },
    },
  };
}

/** @description Invoke one HTTP request against the real D&D router. */
function callRouter(router, sub, method, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = {
      method, url, headers: {},
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

test('static hygiene guard: tabletop-runtime.js contains zero D&D-specific ruleset terms or imports', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'tabletop-runtime.js'), 'utf8');
  const forbidden = ['goblin', 'deathSave', 'spellSlot', 'fireball', 'srd', 'character-import', 'dnd-'];
  for (const term of forbidden) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    assert.equal(re.test(source), false, `tabletop-runtime.js must not mention D&D term "${term}"`);
  }
});

test('validateGameDefinition rejects malformed contracts and duplicate registrations', () => {
  const valid = createStarshipSkirmishPack();
  assert.throws(() => validateGameDefinition({ ...valid, schemaVersion: 2 }), (e) => e instanceof TabletopRuntimeError && e.code === 'INVALID_SCHEMA_VERSION');
  assert.throws(() => validateGameDefinition({ ...valid, id: 'Bad_ID!' }), (e) => e.code === 'INVALID_GAME_ID');
  assert.throws(() => validateGameDefinition({ ...valid, version: 'latest' }), (e) => e.code === 'INVALID_GAME_VERSION');
  assert.throws(() => validateGameDefinition({ ...valid, capabilities: [] }), (e) => e.code === 'INVALID_CAPABILITIES');
  assert.throws(() => validateGameDefinition({ ...valid, rulesAdapter: { validateState: () => ({ ok: true }) } }), (e) => e.code === 'INVALID_RULES_ADAPTER');
  assert.throws(() => validateGameDefinition({ ...valid, narratorAdapter: { narrateTurn: () => {} } }), (e) => e.code === 'INVALID_NARRATOR_ADAPTER');
  assert.throws(() => validateGameDefinition({ ...valid, contentPack: { listAdventures: () => [] } }), (e) => e.code === 'INVALID_CONTENT_PACK');

  const runtime = createTabletopRuntime();
  runtime.registerGame(valid);
  assert.throws(() => runtime.registerGame(valid), (e) => e instanceof TabletopRuntimeError && e.code === 'DUPLICATE_GAME');
  assert.doesNotThrow(() => runtime.registerGame(valid, { replace: true }));
});

test('D&D 5e SRD pack registers on TabletopRuntime and executes turns, beats, progression, and end-state', () => {
  const fixtures = loadDndFixtures();
  const runtime = createTabletopRuntime({ defaultGameId: DND_GAME_ID });
  const registered = runtime.registerGame(createDndRulesetPack(fixtures));
  assert.equal(registered.id, DND_GAME_ID);
  assert.equal(Object.isFrozen(registered.capabilities), true);

  const info = runtime.describeRuntime();
  assert.equal(info.schemaVersion, 1);
  assert.equal(info.activeGameId, 'dnd-5e-srd');
  assert.equal(info.games.length, 1);
  assert.ok(info.games[0].capabilities.includes('character-import'));
  assert.ok(info.games[0].capabilities.includes('spellcasting'));
  assert.equal(info.games[0].contentSummary.rosterCount, fixtures.heroes.length);

  const bram = JSON.parse(JSON.stringify(fixtures.heroes[0]));
  const foe = { id: 'gob-1', name: 'Goblin Scout', kind: 'monster', ac: 10, hp: 7, maxHp: 7, x: 2, y: 2 };
  const actor = { id: bram.id, name: bram.name, kind: 'pc', hp: bram.hp, maxHp: bram.maxHp, x: 1, y: 2 };
  const turn = runtime.turns.resolve({
    actor, action: bram.actions[0], target: foe, tokens: [actor, foe],
    world: { tokens: [actor, foe], sheetFor: () => bram },
  });
  assert.equal(turn.gameId, 'dnd-5e-srd');
  assert.ok(turn.outcome && typeof turn.outcome.text === 'string');
  assert.ok(Array.isArray(turn.outcome.rolls) && turn.outcome.rolls.length >= 1);
  assert.equal(typeof turn.endState.resolved, 'boolean');
  assert.ok(['generated', 'local', 'none'].includes(turn.beat.tier));

  const nat20Beat = runtime.media.classifyBeat({
    sceneId: 'coast-road', round: 1, actorId: 'bram', actorName: 'Bram',
    targetId: 'gob-1', targetName: 'Goblin', actionName: 'Longsword', natural: 20, damage: 12,
  });
  assert.equal(nat20Beat.tier, 'generated');
  assert.equal(nat20Beat.beatKind, 'nat20');

  const leveled = runtime.rewind.advanceProgression({ sheet: bram, xp: 350 });
  assert.equal(leveled.sheet.level, 2);
  assert.equal(leveled.levelUps.length, 1);
});

test('second synthetic non-D&D pack (starship-skirmish) runs full runtime loops alongside D&D', async () => {
  const { calls, services } = buildStubServices();
  const runtime = createTabletopRuntime({ defaultGameId: DND_GAME_ID, services });
  runtime.registerGame(createDndRulesetPack(loadDndFixtures()));
  runtime.registerGame(createStarshipSkirmishPack());
  assert.equal(runtime.listGames().length, 2);

  const desc = runtime.describeRuntime('starship-skirmish');
  assert.equal(desc.activeGameId, 'starship-skirmish');
  assert.equal(desc.activeGame.contentSummary.adventureCount, 1);
  assert.equal(desc.activeGame.adapters.content.metadata.genre, 'sci-fi');

  const ship = { id: 'corvette-alpha', rank: 1, hullMax: 20 };
  const turn = runtime.turns.resolve({
    ship, weapon: { name: 'Heavy Railgun', power: 10 }, target: { id: 'raider-7', hull: 10 },
  }, 'starship-skirmish');
  assert.equal(turn.outcome.remainingHull, 0);
  assert.equal(turn.endState.resolved, true);
  assert.equal(turn.endState.outcome, 'fleet-victory');
  assert.equal(turn.beat.tier, 'generated');
  assert.equal(turn.beat.beatKind, 'hull-breach');

  const narration = await runtime.story.narrate({ beat: turn.beat }, 'starship-skirmish');
  assert.equal(narration.ok, true);
  assert.match(narration.narration, /shatters raider-7's hull/);
  assert.match(runtime.story.describeBeat(turn.beat, 'starship-skirmish'), /\[COMMS\] Hull Breach!/);

  const localArt = await runtime.media.generate('user-1', { campaignId: 'sess-1', beat: { outcome: { critical: false } } }, 'starship-skirmish');
  assert.equal(localArt.localOnly, true);
  const bigArt = await runtime.media.generate('user-1', { campaignId: 'sess-1', beat: { outcome: turn.outcome } }, 'starship-skirmish');
  assert.equal(bigArt.ok, true);
  assert.equal(calls.filter((c) => c.name === 'media.generateCutaway').length, 1);

  const promoted = runtime.rewind.advanceProgression({ ship, commendations: 120 }, 'starship-skirmish');
  assert.equal(promoted.promoted, true);
  assert.equal(promoted.ship.rank, 2);
  assert.equal(runtime.sessions.validateState({ proposed: { sector: 'vega-1' } }, 'starship-skirmish').ok, true);
  assert.equal((await runtime.rewind.saveSnapshot('user-1', { campaignId: 'sess-1' })).ok, true);
});

test('GET /api/dnd/runtime serves read-only metadata with zero DB writes and refuses unauthenticated callers', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; return { rows: [], rowCount: 0 }; } };
  const router = createDndRoutes({ appPackageDir: ROOT, pool });

  const unauth = await callRouter(router, null, 'GET', '/runtime');
  assert.equal(unauth.status, 401);

  const res = await callRouter(router, 'player-1', 'GET', '/runtime');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.runtime.schemaVersion, 1);
  assert.equal(res.body.runtime.activeGameId, 'dnd-5e-srd');
  assert.equal(res.body.runtime.games.length, 1);
  assert.ok(res.body.runtime.games[0].contentSummary.adventureCount >= 4);
  assert.ok(res.body.runtime.games[0].contentSummary.rosterCount >= 4);

  const missing = await callRouter(router, 'player-1', 'GET', '/runtime?gameId=nonexistent-game');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'GAME_NOT_FOUND');
  assert.equal(queries, 0, 'GET /runtime must perform zero database reads or writes');
});
