/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 11:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard the conversation-path server truths: "Question Tovin about Elira" must WALK the acting hero beside Tovin's figure in an authoritative write and request a first-meeting portrait, an unillustrated run of story beats must earn a scene image, and combat boards must stay untouched. The 2026-07-30 playtest ran a whole investigation with frozen tokens and zero art because none of this existed on the path the table actually plays.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createStoryMotionService, BEAT_ART_EVERY, _test } = require('../lib/dnd-story-motion');
const { createDmService } = require('../lib/dnd-dm-service');

const clone = (value) => JSON.parse(JSON.stringify(value));

// A chapter shaped like the Wintervale observatory: two authored people standing
// on the map, a linked person lead, an unlinked person lead, and object leads.
const SCENE = {
  id: 'vale', title: 'Wintervale Observatory', grid: { w: 18, h: 12 },
  terrain: { blocking: [] },
  exploration: {
    required: 3,
    leads: [
      { id: 'chalkboard', name: "Elira's Chalkboard", type: 'object', reveal: 'Orbits.' },
      { id: 'assistant', prop: 'tovin-quill', name: 'Tovin Quill, Assistant', type: 'person', reveal: 'He burned a chart.' },
      { id: 'sister', name: 'Mara Venn', type: 'person', reveal: 'She begged Elira to stop.' },
    ],
  },
  props: [
    { id: 'tovin-quill', name: 'Tovin Quill', x: 11, y: 4 },
    { id: 'beryl-soon', name: 'Beryl Soon', x: 3, y: 3 },
  ],
};

const BOARD = {
  mode: 'exploration', sceneId: 'vale',
  tokens: [
    { id: 'tovin-quill', kind: 'prop', name: 'Tovin Quill', x: 11, y: 4 },
    { id: 'beryl-soon', kind: 'prop', name: 'Beryl Soon', x: 3, y: 3 },
    { id: 'zin', kind: 'pc', slug: 'zin', name: 'Zin', x: 4, y: 9 },
    { id: 'della', kind: 'pc', slug: 'della', name: 'Della', x: 5, y: 9 },
  ],
};

/** @description Deterministic encounter + archive database double. */
function makePool(state, archiveKinds, rev = 4) {
  return {
    state: clone(state), rev, updates: 0,
    async query(sql, params) {
      if (/SELECT state, rev FROM dnd_encounters/.test(sql)) {
        return { rowCount: 1, rows: [{ state: this.state, rev: this.rev }] };
      }
      if (/UPDATE dnd_encounters SET state=/.test(sql)) {
        this.state = JSON.parse(params[0]); this.rev += 1; this.updates += 1;
        return { rowCount: 1, rows: [{ rev: this.rev }] };
      }
      if (/SELECT kind FROM dnd_archive/.test(sql)) {
        return { rowCount: (archiveKinds || []).length, rows: (archiveKinds || []).map((kind) => ({ kind })) };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

/** @description A media double that records every server-side art request. */
function makeMedia() {
  const calls = [];
  return { calls, generateCutaway: async (sub, body) => { calls.push({ sub, body }); return { ok: true }; } };
}

/** @description Assemble the motion service around one seated campaign. */
function makeService(pool, media, seats) {
  return createStoryMotionService({
    pool, media,
    campaign: { seatsOf: async () => seats || [{ user_sub: 'player-zin', character_slug: 'zin' }] },
    sceneById: (id) => (id === 'vale' ? SCENE : null),
  });
}

/** @description Wait out the detached fire-and-forget art request. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** @description Chebyshev distance between two tokens. */
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

test('the player naming a person picks that person over an ambient object mention', () => {
  const targets = _test.storyTargets(SCENE);
  const match = _test.matchStoryTarget(
    targets, 'Question Tovin about Elira',
    'Zin, you cross east toward Tovin Quill, and he tightens both arms around folders labeled ELIRA.',
  );
  assert.equal(match.key, 'lead:assistant', 'Tovin outweighs the chalkboard the word Elira also matches');
});

test('the player\'s own words outweigh the narration\'s crowd of names', () => {
  const targets = _test.storyTargets(SCENE);
  const match = _test.matchStoryTarget(
    targets, 'I study the chalkboard equations.',
    'Tovin Quill watches you work through the chalkboard, wincing whenever you erase.',
  );
  assert.equal(match.key, 'lead:chalkboard');
});

test('a prop no lead covers is still a destination the fiction can send a hero to', () => {
  const targets = _test.storyTargets(SCENE);
  assert.ok(targets.some((target) => target.key === 'prop:beryl-soon'), 'Beryl has no lead but stands on the map');
  assert.ok(!targets.some((target) => target.key === 'prop:tovin-quill'), 'a linked prop is covered by its lead');
  const match = _test.matchStoryTarget(targets, 'I approach Beryl Soon and her clocks.', '');
  assert.equal(match.key, 'prop:beryl-soon');
});

test('the acting hero is whoever the narration names, then the speaker\'s claimed hero', () => {
  const seats = [{ user_sub: 'player-zin', character_slug: 'zin' }];
  assert.equal(_test.actingHeroSlug(BOARD, seats, 'host', {}, 'Della, you slip toward the door.'), 'della');
  assert.equal(_test.actingHeroSlug(BOARD, seats, 'player-zin', { message: 'I ask about the folders.' }, 'You cross the floor.'), 'zin');
  assert.equal(_test.actingHeroSlug(BOARD, seats, 'host', {}, 'The room holds its breath.'), '', 'no mention, no seat: nobody is guessed onto the board');
});

test('a conversation about a person WALKS the hero beside their figure in an authoritative write', async () => {
  const pool = makePool(BOARD, ['table-talk']);
  const media = makeMedia();
  const service = makeService(pool, media);
  const outcome = await service.conversationBeat(
    'player-zin', { campaignId: 'camp-1', message: 'Question Tovin about Elira' },
    'Zin, you cross east toward Tovin Quill.', { seq: 9 },
  );
  assert.equal(outcome.moved, true);
  assert.equal(outcome.rev, 5, 'the walk is one committed board revision');
  assert.equal(outcome.heroSlug, 'zin');
  const zin = pool.state.tokens.find((token) => token.slug === 'zin');
  const tovin = pool.state.tokens.find((token) => token.id === 'tovin-quill');
  assert.equal(distance(zin, tovin), 1, 'Zin stands beside Tovin, not on him and not at party start');
  assert.equal(pool.state.tokens.find((token) => token.slug === 'della').x, 5, 'nobody else moves');
});

test('reaching a person requests a first-meeting portrait under a stable dedup key', async () => {
  const pool = makePool(BOARD, ['table-talk']);
  const media = makeMedia();
  const service = makeService(pool, media);
  await service.conversationBeat(
    'player-zin', { campaignId: 'camp-1', message: 'Question Tovin about Elira' },
    'Zin, you cross east toward Tovin Quill.', { seq: 9 },
  );
  await settled();
  assert.equal(media.calls.length, 1);
  assert.equal(media.calls[0].body.eventKey, 'meet:camp-1:vale:lead:assistant',
    'every later mention collapses into this same key, so a meeting only ever costs once');
  assert.match(media.calls[0].body.prompt, /Wintervale Observatory/);
  assert.match(media.calls[0].body.prompt, /meets Tovin Quill/);
});

test('an unillustrated run of story beats earns the newest beat a scene image', async () => {
  const quiet = Array.from({ length: BEAT_ART_EVERY }, () => 'table-talk');
  const pool = makePool(BOARD, quiet);
  const media = makeMedia();
  const service = makeService(pool, media);
  const outcome = await service.conversationBeat(
    'player-zin', { campaignId: 'camp-1', message: 'We take a moment and think it through.' },
    'Frost creeps up the tall windows while the clocks argue.', { seq: 41 },
  );
  await settled();
  assert.equal(outcome, null, 'nothing to walk toward — the reply itself is untouched');
  assert.equal(media.calls.length, 1);
  assert.equal(media.calls[0].body.eventKey, 'beat:camp-1:41');
  assert.match(media.calls[0].body.prompt, /Frost creeps/);
});

test('a recent image keeps the cadence quiet — art only returns when the story has gone visually silent', async () => {
  const pool = makePool(BOARD, ['table-talk', 'cutaway', 'table-talk', 'table-talk', 'table-talk']);
  const media = makeMedia();
  const service = makeService(pool, media);
  await service.conversationBeat(
    'player-zin', { campaignId: 'camp-1', message: 'We keep thinking.' },
    'The clocks tick unevenly.', { seq: 42 },
  );
  await settled();
  assert.equal(media.calls.length, 0);
});

test('combat boards are never touched by conversation — tactical movement stays tactical', async () => {
  const pool = makePool({ ...clone(BOARD), mode: 'combat' }, []);
  const media = makeMedia();
  const service = makeService(pool, media);
  const outcome = await service.conversationBeat(
    'player-zin', { campaignId: 'camp-1', message: 'Question Tovin about Elira' },
    'Zin, you cross east toward Tovin Quill.', { seq: 9 },
  );
  await settled();
  assert.equal(outcome, null);
  assert.equal(pool.updates, 0, 'no board write');
  assert.equal(media.calls.length, 0, 'no art');
});

test('a failed embellishment never breaks the exchange', async () => {
  const service = createStoryMotionService({
    pool: { query: async () => { throw new Error('db down'); } },
    campaign: { seatsOf: async () => [] }, media: makeMedia(), sceneById: () => SCENE,
  });
  assert.equal(await service.conversationBeat('host', { campaignId: 'camp-1', message: 'x' }, 'y', { seq: 1 }), null);
});

// ---------------------------------------------------------------------------
// Wiring: the DM service must actually CALL the motion service on the narrate
// path — with the directive-stripped narration — and must not call it for
// combat highlights. Asserting the call, not a substring, per the guard rules.
// ---------------------------------------------------------------------------

/** @description Minimal storyteller fixture with a recording motion stub. */
function dmFixture(motionResult) {
  const rows = (value) => ({ rowCount: value.length, rows: value });
  const pool = {
    state: { mode: 'exploration', sceneId: 'vale', turnSerial: 1, turnIndex: 0, order: [], tokens: [] },
    rev: 7,
    async query(sql) {
      if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.state), rev: this.rev }]);
      if (/SELECT slug, name, sheet, level FROM dnd_characters/.test(sql)) return rows([]);
      if (/SELECT kind, content FROM dnd_archive/.test(sql)) return rows([]);
      if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return rows([]);
      throw new Error(`Unexpected storyteller SQL: ${sql}`);
    },
  };
  const motionCalls = [];
  const archive = [];
  const service = createDmService({
    pool,
    campaign: {
      access: async () => ({ campaign_id: 'camp-1' }),
      archive: async (_sub, _id, kind, content) => {
        const entry = { seq: archive.length + 1, kind, content }; archive.push(entry); return entry;
      },
      sheetsOfWithRev: async () => ({ sheets: {}, sheetsRev: 'none' }),
    },
    storyMotion: {
      conversationBeat: async (sub, body, narration, archiveEntry) => {
        motionCalls.push({ sub, body, narration, archiveEntry });
        return motionResult || null;
      },
    },
    orchestrator: { processMessage: async () => ({ success: true, response: 'You cross toward Tovin.\nCHOICES: Press him | Step back | Search the desk' }) },
    root: require('node:path').join(__dirname, '..'),
    adventure: { title: 'The Astronomer\'s Last Night' },
    sceneById: () => ({ title: 'Wintervale', objective: 'Find Elira.', grid: { w: 18, h: 12 } }),
    hydratedSheet: (_slug, sheet) => sheet,
  });
  return { pool, motionCalls, service };
}

test('a narrate exchange hands its committed, directive-stripped prose to the motion service', async () => {
  const moved = { moved: true, state: { marker: 'walked' }, rev: 99, heroSlug: 'zin', target: { key: 'lead:assistant', name: 'Tovin Quill' } };
  const { motionCalls, service } = dmFixture(moved);
  const result = await service.dungeonMaster('player-zin', {
    campaignId: 'camp-1', sceneId: 'vale', mode: 'narrate', requestId: 'talk-1', message: 'Question Tovin about Elira',
  });
  assert.equal(result.ok, true);
  assert.equal(motionCalls.length, 1, 'the walk is part of the exchange, not an optional client follow-up');
  assert.equal(motionCalls[0].narration, 'You cross toward Tovin.', 'CHOICES was stripped before matching');
  assert.equal(motionCalls[0].archiveEntry.seq, 1);
  assert.equal(result.state.marker, 'walked', 'the caller applies the post-walk board');
  assert.equal(result.rev, 99);
  assert.equal(result.walked.hero, 'zin');
});

test('combat highlights never reach the motion service', async () => {
  const { pool, motionCalls, service } = dmFixture();
  pool.state.mode = 'combat'; pool.state.order = ['zin'];
  const result = await service.dungeonMaster('player-zin', {
    campaignId: 'camp-1', sceneId: 'vale', mode: 'combat', requestId: 'hl-1', message: 'Zin hits the husk for 6.',
  });
  assert.equal(result.ok, true);
  assert.equal(motionCalls.length, 0);
});
