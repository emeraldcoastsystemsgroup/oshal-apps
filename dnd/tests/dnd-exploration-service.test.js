/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 13:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove authored clues are shared, prerequisite-gated, and host-completed only after enough evidence.
 * 2026-07-26 23:50:00 | roger.murphy@emeraldcoastsystemsgroup.com  | The contract changed on purpose: a lead is no longer resolvable by an anonymous caller. Fixtures now seat a real party (tokens + sheets), the deterministic RNG is injected so the contested roll is assertable, and new cases pin the nomination refusal, the step-in override, one-attempt-per-hero, and finder attribution.
 * 2026-07-31 23:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Roadmap #13 — the contract changed again on purpose: an attempt no longer rolls server-privately. It opens a SHARED d20 request (rollRequested, with the lead contract + precomputed skill modifier), the die lands via /roll, and 'commit-roll' applies the outcome exactly once. Cases now drive request → land → commit, and new guards pin: one pending roll at a time, commit refuses an unlanded or foreign die, lead crit semantics (nat 20 finds it past any DC, nat 1 fumbles past any modifier), the muddled escape hatch staying dice-free, and a mid-roll discovery resolving the die as a dedupe instead of stranding it.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createExplorationService } = require('../lib/dnd-exploration-service');

const scene = {
  id: 'mystery-square',
  title: 'Mystery Square',
  afterword: 'The party follows the evidence.',
  exploration: {
    required: 2,
    leads: [
      { id: 'cup', name: 'Silver Cup', type: 'object', reveal: 'The rim carries poison.' },
      { id: 'ledger', name: 'Hidden Ledger', type: 'object', requires: ['cup'], reveal: 'The payment names an accomplice.' },
    ],
  },
};

// A seated party is now a precondition for working a lead: the table nominates one
// hero, so a clue cannot be resolved by an anonymous caller any more.
const DELLA = { id: 'della', name: 'Della', class: 'Rogue', prof: 2, mods: { int: 2, wis: 1, cha: 1, dex: 3, str: 0, con: 1 } };
const BRAM = { id: 'bram', name: 'Bram', class: 'Fighter', prof: 2, mods: { int: -1, wis: 1, cha: 0, dex: 1, str: 3, con: 2 } };
const SEATED = {
  tokens: [
    { id: 'della', kind: 'pc', slug: 'della', name: 'Della', x: 2, y: 2 },
    { id: 'bram', kind: 'pc', slug: 'bram', name: 'Bram', x: 3, y: 2 },
  ],
  rules: { sheets: { della: DELLA, bram: BRAM } },
};

/** @description Feed the service a scripted d20 so a contested roll is assertable. */
function scriptedRng(values) {
  const queue = values.slice();
  return () => (queue.length ? queue.shift() : 0.5);
}

/** @description Create a deterministic exploration database double. */
function makePool(state, rev = 4) {
  return {
    state: JSON.parse(JSON.stringify(state)),
    rev,
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/SELECT state, rev FROM dnd_encounters/.test(sql)) {
        return { rowCount: 1, rows: [{ state: this.state, rev: this.rev }] };
      }
      if (/UPDATE dnd_encounters SET state=/.test(sql)) {
        this.state = JSON.parse(params[0]); this.rev += 1;
        return { rowCount: 1, rows: [{ rev: this.rev }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

/** @description Assemble the service around one campaign and archive recorder. */
function makeService(pool, owner = true, rng, media) {
  const archive = [];
  const campaign = {
    access: async () => ({ campaign_id: 'camp-1', user_sub: 'host', is_owner: owner }),
    appendArchive: async (_db, _sub, _id, kind, content) => {
      const entry = { seq: archive.length + 1, kind, content }; archive.push(entry); return entry;
    },
    // Seat map: player-2 plays Bram, everything else is the host's to run.
    seatsOf: async () => [{ user_sub: 'player-2', character_slug: 'bram' }],
  };
  return {
    archive,
    service: createExplorationService({ pool, campaign, sceneById: () => scene, rng: rng || scriptedRng([0.95]), media }),
  };
}

/** @description A media double that records every server-side art request. */
function makeMedia(behavior) {
  const calls = [];
  return {
    calls,
    generateCutaway: (sub, body) => {
      calls.push({ sub, body });
      // 'soft' mirrors the REAL media service: a broken provider RESOLVES
      // {ok:false, soft:true} — it never rejects. 'reject' guards future refactors.
      if (behavior === 'reject') return Promise.reject(new Error('illustrator down'));
      if (behavior === 'soft') return Promise.resolve({ ok: false, soft: true, error: 'Cutaway art is not available on this swarm.' });
      return Promise.resolve({ ok: true });
    },
  };
}

/**
 * @description Land the pending shared d20 the way /roll (performSharedRoll)
 *   would: same natural/modifier/total shape, same lead crit semantics — so the
 *   commit phase is driven with exactly the state the DM service persists.
 */
function landRoll(pool, natural) {
  const roll = pool.state.sharedRoll;
  assert.ok(roll && roll.status === 'requested', 'a requested shared roll is pending');
  const modifier = Number(roll.modifier) || 0;
  const total = natural + modifier;
  pool.state.sharedRoll = {
    ...roll, natural, modifier, total,
    success: natural === 20 || (natural !== 1 && total >= Number(roll.dc)),
    status: 'rolled', rolledAt: '2026-07-31T00:00:00.000Z',
  };
  pool.rev += 1;
  return pool.state.sharedRoll;
}

/** @description Request the lead's shared d20, land it, and commit the outcome. */
async function playLead(service, pool, sub, requestBody, natural) {
  const requested = await service.act(sub, { campaignId: 'camp-1', ...requestBody });
  assert.equal(requested.rollRequested, true, 'the attempt opens the shared d20');
  const roll = landRoll(pool, natural);
  return service.act(sub, { campaignId: 'camp-1', action: 'commit-roll', rollId: roll.id });
}

/** @description Chebyshev distance between a hero token and a figure token. */
function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

test('discoveries enforce prerequisites and persist one shared authored reveal', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { archive, service } = makeService(pool);
  const locked = await service.act('host', { campaignId: 'camp-1', leadId: 'ledger', heroSlug: 'della' });
  assert.equal(locked.code, 'LEAD_LOCKED', 'a locked lead reports LOCKED regardless of who asks');
  assert.equal(pool.rev, 4);

  const found = await playLead(service, pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 18);
  assert.equal(found.ok, true);
  assert.deepEqual(found.state.exploration.discovered, ['cup']);
  assert.equal(found.narration, 'The rim carries poison.');
  assert.equal(found.finder.slug, 'della', 'the clue is attributed to the hero who found it');
  assert.equal(found.state.exploration.finders.cup, 'della', 'attribution persists on the board');
  assert.equal(found.state.sharedRoll.status, 'resolved', 'the shared die resolves in the same write');
  assert.match(archive[0].content, /Della uncovers Silver Cup/, 'the story log names the finder');
  assert.deepEqual(archive.map((entry) => entry.kind), ['discovery']);
});

test('the shared-roll request carries the lead contract and the skill modifier', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service } = makeService(pool);
  const requested = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'della' });
  assert.equal(requested.rollRequested, true);
  const roll = requested.roll;
  assert.equal(roll.status, 'requested');
  assert.equal(roll.actorSlug, 'della');
  assert.equal(roll.skill, 'investigation', 'an object tests investigation');
  assert.equal(roll.ability, 'intelligence', 'the die shows the full ability name');
  assert.equal(roll.dc, 12);
  assert.equal(roll.modifier, 4, 'Della: int +2 plus rogue proficiency +2 — the sheet-only derivation would say +2');
  assert.deepEqual(roll.lead, { id: 'cup', sceneId: scene.id }, 'the lead contract travels on the roll');
  assert.equal(pool.state.sharedRoll.id, roll.id, 'the request is persisted for every device');

  // The approach is visible: the hero walked over while the die is up.
  const della = pool.state.tokens.find((token) => token.slug === 'della');
  assert.ok(della.x !== 2 || della.y !== 2, 'the nominated hero crosses the room at request time');

  // One die at a time: a second lead must wait for the visible roll.
  const second = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'bram', stepIn: true });
  assert.equal(second.code, 'ROLL_PENDING', 'a pending shared roll blocks another request');
});

test('a lead nominates one hero and refuses the rest until a player steps in', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service } = makeService(pool);
  // Della the rogue is the nominee for an object; Bram may not simply take it.
  const refused = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'bram' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'NOMINATED');
  assert.equal(refused.nominee.slug, 'della');
  assert.equal(refused.nominee.skill, 'investigation');
  assert.equal(pool.rev, 4, 'a refusal writes nothing to the shared board');

  const steppedIn = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'bram', stepIn: true });
  assert.equal(steppedIn.rollRequested, true, 'stepping in is allowed — it just has to be deliberate');
  assert.equal(steppedIn.roll.actorSlug, 'bram', 'the die belongs to the hero who stepped in');
  assert.equal(steppedIn.roll.modifier, -1, 'Bram rolls his own untrained int, not the nominee\'s bonus');
});

test('a player cannot act as a hero they do not play', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service } = makeService(pool, false);
  const stolen = await service.act('player-2', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'della' });
  assert.equal(stolen.code, 'NOT_YOUR_HERO', 'player-2 plays Bram, not Della');
  const own = await service.act('player-2', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'bram', stepIn: true });
  assert.equal(own.rollRequested, true, 'their own hero is fine — the die opens for them');
});

test('only the roller may commit a landed lead die', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service } = makeService(pool, false);
  const requested = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'della' });
  assert.equal(requested.rollRequested, true);

  // Not landed yet: nobody can commit a die still tumbling.
  const early = await service.act('host', { campaignId: 'camp-1', action: 'commit-roll', rollId: requested.roll.id });
  assert.equal(early.code, 'ROLL_NOT_READY', 'a requested (unrolled) die cannot be committed');

  const roll = landRoll(pool, 18);
  const foreign = await service.act('player-2', { campaignId: 'camp-1', action: 'commit-roll', rollId: roll.id });
  assert.equal(foreign.code, 'NOT_YOUR_HERO', 'player-2 does not play Della and may not commit her roll');
  const wrongId = await service.act('host', { campaignId: 'camp-1', action: 'commit-roll', rollId: 'not-this-roll' });
  assert.equal(wrongId.code, 'ROLL_STALE', 'a foreign roll id is stale, not committable');

  const committed = await service.act('host', { campaignId: 'camp-1', action: 'commit-roll', rollId: roll.id });
  assert.equal(committed.ok, true, 'the host runs unclaimed heroes and may commit');
  assert.deepEqual(committed.state.exploration.discovered, ['cup']);

  const again = await service.act('host', { campaignId: 'camp-1', action: 'commit-roll', rollId: roll.id });
  assert.equal(again.alreadyCommitted, true, 'a second commit is a no-op, never a double ledger');
});

test('lead crit semantics ride the shared die: nat 20 always finds it, nat 1 always fumbles', async () => {
  // Natural 1 with the specialist's modifier still misses.
  const fumblePool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const fumbleBundle = makeService(fumblePool);
  const fumbled = await playLead(fumbleBundle.service, fumblePool, 'host', { leadId: 'cup', heroSlug: 'della' }, 1);
  assert.equal(fumbled.missed, true, 'a natural 1 fumbles regardless of total');
  assert.equal(fumbled.attempt.crit, 'nat1');
  assert.match(fumbleBundle.archive[0].content, /fumbles/, 'the fumble is narrated to the table');

  // Natural 20 against DC 30 still finds it.
  const heroicScene = JSON.parse(JSON.stringify(scene));
  heroicScene.exploration.leads[0].dc = 30;
  const critPool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const critService = createExplorationService({
    pool: critPool,
    campaign: {
      access: async () => ({ campaign_id: 'camp-1', user_sub: 'host', is_owner: true }),
      appendArchive: async (_db, _sub, _id, kind, content) => ({ seq: 1, kind, content }),
      seatsOf: async () => [],
    },
    sceneById: () => heroicScene, rng: scriptedRng([0.5]),
  });
  const requested = await critService.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'della' });
  assert.equal(requested.roll.dc, 30);
  const roll = landRoll(critPool, 20);
  const committed = await critService.act('host', { campaignId: 'camp-1', action: 'commit-roll', rollId: roll.id });
  assert.equal(committed.ok, true);
  assert.equal(committed.attempt.crit, 'nat20');
  assert.deepEqual(committed.state.exploration.discovered, ['cup'], 'a natural 20 beats any DC');
});

test('a failed roll keeps the lead open and blocks that hero from retrying', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service, archive } = makeService(pool);
  const missed = await playLead(service, pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 2);
  assert.equal(missed.ok, true);
  assert.equal(missed.missed, true, 'a miss is a real outcome, not an error');
  assert.deepEqual(missed.state.exploration.discovered, [], 'the clue is NOT green-lit');
  assert.deepEqual(missed.state.exploration.attempts.cup, ['della'], 'the attempt is on the ledger');
  assert.equal(missed.state.sharedRoll.status, 'resolved', 'the die resolves even on a miss');
  assert.ok(archive.length >= 1, 'the miss is narrated to the table');

  const again = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'della' });
  assert.equal(again.code, 'ALREADY_TRIED', 'the same hero cannot brute-force the same lead');
});

test('a chapter cannot deadlock once every hero has failed a lead', async () => {
  const pool = makePool({
    mode: 'exploration', sceneId: scene.id,
    exploration: { discovered: [], attempts: { cup: ['della', 'bram'] } }, ...SEATED,
  });
  // Even with the worst possible die, an exhausted party still gets through —
  // and the escape hatch never opens a roll at all: it was never a contest.
  const { service } = makeService(pool, true, scriptedRng([0]));
  const forced = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'della', stepIn: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.rollRequested, undefined, 'the muddled relent is dice-free');
  assert.deepEqual(forced.state.exploration.discovered, ['cup'], 'the lead finally gives, muddled');
  assert.ok(!forced.state.sharedRoll, 'no shared die was opened for the escape hatch');
});

test('only the host can complete an investigation after the evidence threshold', async () => {
  const state = {
    mode: 'exploration', sceneId: scene.id,
    exploration: { discovered: ['cup', 'forged-answer', 'another-forgery'] },
  };
  const guestPool = makePool(state), guest = makeService(guestPool, false).service;
  assert.equal((await guest.act('guest', { campaignId: 'camp-1', action: 'complete' })).code, 'OWNER_REQUIRED');

  const hostPool = makePool(state), hostBundle = makeService(hostPool);
  assert.equal((await hostBundle.service.act('host', { campaignId: 'camp-1', action: 'complete' })).code, 'MORE_CLUES_REQUIRED');
  hostPool.state.exploration.discovered.push('ledger');
  const completed = await hostBundle.service.act('host', { campaignId: 'camp-1', action: 'complete' });
  assert.equal(completed.complete, true);
  assert.equal(completed.state.mode, 'resolved');
  assert.deepEqual(completed.state.exploration.discovered, ['cup', 'ledger']);
  assert.deepEqual(hostBundle.archive.map((entry) => entry.kind), ['milestone']);
});

test('a discovery walks the finder beside the figure it puts on the map', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service } = makeService(pool);
  const found = await playLead(service, pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 18);
  assert.equal(found.ok, true);
  const figure = found.state.tokens.find((token) => token.id === 'lead:cup');
  const della = found.state.tokens.find((token) => token.slug === 'della');
  assert.ok(figure, 'the silver cup stands on the board');
  assert.equal(distance(della, figure), 1, 'the finder stands BESIDE the figure, in the same write');
  assert.deepEqual({ x: 2, y: 2 }, { x: SEATED.tokens[0].x, y: SEATED.tokens[0].y }, 'the fixture spawn is untouched');
});

test('a missed attempt still walks the hero over without casting the figure', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service } = makeService(pool);
  const missed = await playLead(service, pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 2);
  assert.equal(missed.missed, true);
  assert.ok(!missed.state.tokens.some((token) => token.id === 'lead:cup'), 'a miss reveals nothing on the map');
  const della = missed.state.tokens.find((token) => token.slug === 'della');
  assert.ok(della.x !== 2 || della.y !== 2, 'the hero visibly went and came up short');
});

test('discovery art is requested server-side with the exact client eventKey', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const media = makeMedia();
  const { service } = makeService(pool, true, undefined, media);
  const found = await playLead(service, pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 18);
  assert.equal(found.ok, true);
  assert.equal(found._cutaway, undefined, 'the internal art request never reaches the client');
  assert.equal(media.calls.length, 1, 'exactly one art request per discovery');
  assert.equal(media.calls[0].sub, 'host', 'requested as the campaign owner');
  assert.equal(media.calls[0].body.eventKey, `lead:camp-1:${scene.id}:cup`,
    'the eventKey matches the surface format byte-for-byte so dedup collapses duplicates');
  assert.match(media.calls[0].body.prompt, /Mystery Square/, 'the prompt is grounded in the scene');
});

test('chapter completion requests its transition art server-side', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: ['cup', 'ledger'] }, ...SEATED });
  const media = makeMedia();
  const { service } = makeService(pool, true, undefined, media);
  const completed = await service.act('host', { campaignId: 'camp-1', action: 'complete' });
  assert.equal(completed.complete, true);
  assert.equal(completed._cutaway, undefined);
  assert.equal(media.calls[0].body.eventKey, `chapter:camp-1:${scene.id}:complete`);
});

/** @description One service whose illustrator misbehaves in the given way, with a spy logger. */
function brokenIllustratorService(behavior, errors) {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const service = createExplorationService({
    pool,
    campaign: {
      access: async () => ({ campaign_id: 'camp-1', user_sub: 'host', is_owner: true }),
      appendArchive: async (_db, _sub, _id, kind, content) => ({ seq: 1, kind, content }),
      seatsOf: async () => [],
    },
    sceneById: () => scene, rng: scriptedRng([0.95]), media: makeMedia(behavior),
    logger: { error: (fields, message) => errors.push({ fields, message }) },
  });
  return { pool, service };
}

test('a rejecting illustrator never fails or blocks the discovery', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const bundle = makeService(pool, true, undefined, makeMedia('reject'));
  const errors = [];
  const logged = brokenIllustratorService('reject', errors);
  const found = await playLead(bundle.service, pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 18);
  assert.equal(found.ok, true, 'the player action succeeds even when the illustrator is down');
  const foundLogged = await playLead(logged.service, logged.pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 18);
  assert.equal(foundLogged.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1, 'the detached failure is logged, never swallowed');
});

test('a SOFT illustrator failure — the shape production actually produces — is logged', async () => {
  // The real media service never rejects: a missing/broken provider RESOLVES
  // {ok:false, soft:true}. Ignoring the settled value made outages invisible —
  // a whole session of zero cutaways with zero log lines. This is that guard.
  const errors = [];
  const logged = brokenIllustratorService('soft', errors);
  const found = await playLead(logged.service, logged.pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 18);
  assert.equal(found.ok, true, 'the discovery is never harmed by a resting illustrator');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1, 'the soft failure is visible in the log');
  assert.match(errors[0].fields.error, /not available/, 'the provider reason travels into the log line');
});

test('a raced attempt on an already-found clue dedupes instead of rolling', async () => {
  // P2's tap was in flight when P1 discovered the same lead (buttons only disable
  // on the next ~1.6s sync). Opening a die here could ledger a miss and narrate
  // "comes up short" about evidence the party already shares.
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: ['cup'], finders: { cup: 'della' } }, ...SEATED });
  const { service, archive } = makeService(pool, true, scriptedRng([0]));
  const raced = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'bram', stepIn: true });
  assert.equal(raced.ok, true);
  assert.equal(raced.deduped, true, 'the second finder gets the reveal, not a shared die');
  assert.equal(pool.rev, 4, 'nothing is written for a deduped attempt');
  assert.equal(archive.length, 0, 'no contradictory story beat is archived');
});

test('a lead discovered while the die was up resolves it as a dedupe, never a second ledger', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const { service, archive } = makeService(pool);
  const requested = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'della' });
  assert.equal(requested.rollRequested, true);
  const roll = landRoll(pool, 18);
  // Another write lands the discovery while the die is still on screen.
  pool.state.exploration = { discovered: ['cup'], attempts: {}, finders: { cup: 'bram' } };
  pool.rev += 1;
  const committed = await service.act('host', { campaignId: 'camp-1', action: 'commit-roll', rollId: roll.id });
  assert.equal(committed.ok, true);
  assert.equal(committed.deduped, true, 'the commit becomes the shared reveal');
  assert.equal(committed.state.sharedRoll.status, 'resolved', 'the die is never stranded rolled');
  assert.equal(committed.state.exploration.finders.cup, 'bram', 'the first finder keeps the credit');
  assert.equal(archive.length, 0, 'no contradictory story beat is archived');
});

test('missed attempts and refusals never request art', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] }, ...SEATED });
  const media = makeMedia();
  const { service } = makeService(pool, true, undefined, media);
  const missed = await playLead(service, pool, 'host', { leadId: 'cup', heroSlug: 'della' }, 2);
  assert.equal(missed.missed, true);
  const refused = await service.act('host', { campaignId: 'camp-1', leadId: 'cup', heroSlug: 'bram' });
  assert.equal(refused.code, 'NOMINATED');
  assert.equal(media.calls.length, 0, 'art is reserved for actual discoveries');
});
