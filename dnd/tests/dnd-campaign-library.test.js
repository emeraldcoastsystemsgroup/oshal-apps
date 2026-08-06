/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:04:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard account-scoped saved characters, campaign creation, membership listing, and leave semantics through the public D&D route contract.
 * 2026-07-21 22:02:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Follow the additive archive roll payload through campaign-history reads.
 * 2026-07-21 22:14:13 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove join admission is serialized and rejects in-progress or full four-person tables.
 * 2026-07-21 22:16:54 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove a newly admitted seat invalidates stale concurrent starts without bumping idempotent rejoins.
 * 2026-07-21 22:36:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove claim changes lock the lobby and invalidate a concurrent Start revision without revision churn on retries.
 * 2026-07-22 01:15:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep multiple active and archived campaigns in the account library for explicit Resume or Playback.
 * 2026-08-06 02:43:35 | maintainer@emeraldcoastsystemsgroup.com     | Prove shared-table admission binds only a validated join code as a transaction-local RLS capability before campaign reads.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes.js');

const root = path.join(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const SAVED_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function rows(value) { return { rowCount: value.length, rows: value }; }

function manualHero(name, id) {
  return {
    id, name, race: 'Human', class: 'Fighter', level: 1, ac: 15, maxHp: 11, speed: 30,
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 10 },
    actions: [{ name: 'Longsword', type: 'weapon', mode: 'attack', delivery: 'melee', toHit: 4 }],
  };
}

async function request(pool, sub, method, url, body, extra) {
  const router = createDndRoutes({ pool, appPackageDir: root, ...(extra || {}) });
  let payload = '';
  const req = { method, url, body, oidc: { user: { sub, name: sub } } };
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { payload = String(value || ''); },
  };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

class ReadAndLibraryPool {
  constructor() {
    this.queries = [];
    this.library = [
      { character_id: SAVED_ID, user_sub: 'alice', campaign_id: null, slug: 'aria', name: 'Aria', sheet: manualHero('Aria', 'aria'), xp: 0, level: 1, created_at: 'c1', updated_at: 'u1' },
      { character_id: OTHER_ID, user_sub: 'mallory', campaign_id: null, slug: 'other', name: 'Other', sheet: manualHero('Other', 'other'), xp: 0, level: 1, created_at: 'c2', updated_at: 'u2' },
      { character_id: '33333333-3333-4333-8333-333333333333', user_sub: 'alice', campaign_id: 'camp-1', slug: 'bram', name: 'Bram', sheet: { id: 'bram', name: 'Bram' }, xp: 10, level: 1 },
    ];
    this.next = 4;
  }

  campaignRows() {
    return [{
      campaign_id: 'camp-1', name: 'Road', adventure_id: 'goblin-ambush', status: 'active', join_code: 'ABC123',
      created_at: 'created', updated_at: 'updated', is_owner: true, my_character: null, mode: 'combat', scene_id: 'coast-road',
      round: 2, rev: 9, player_count: 1, last_played_at: 'played', user_sub: 'secret-owner-sub',
    }, {
      campaign_id: 'camp-2', name: 'Finished Road', adventure_id: 'goblin-ambush', status: 'archived', join_code: 'OLD123',
      created_at: 'older', updated_at: 'finished', is_owner: true, my_character: null, mode: 'complete', scene_id: 'the-ravine',
      round: 5, rev: 30, player_count: 1, last_played_at: 'finished', user_sub: 'secret-owner-sub',
    }];
  }

  async query(sql, params) {
    this.queries.push({ sql, params });
    if (/LEFT JOIN dnd_players me/.test(sql)) {
      assert.doesNotMatch(sql, /c\.status = 'active'/);
      assert.doesNotMatch(sql, /SELECT c\.\*/);
      return rows(this.campaignRows());
    }
    if (/SELECT c\.\*,/.test(sql)) {
      return rows([{
        campaign_id: 'camp-1', user_sub: 'secret-owner-sub', name: 'Road', adventure_id: 'goblin-ambush',
        status: 'active', join_code: 'ABC123', created_at: 'created', updated_at: 'updated', is_owner: params[1] === 'secret-owner-sub',
      }]);
    }
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: { mode: 'setup', tokens: [] }, rev: 3 }]);
    if (/SELECT seq, kind, content, payload, created_at FROM dnd_archive/.test(sql)) return rows([]);
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) return rows([{ slug: 'bram', sheet: { id: 'bram', name: 'Bram' } }]);
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return rows([]);
    if (/SELECT character_id, slug, name, sheet, xp, level, created_at, updated_at/.test(sql) && /campaign_id IS NULL/.test(sql)) {
      return rows(this.library.filter((row) => row.user_sub === params[0] && row.campaign_id === null).map(clone));
    }
    if (/INSERT INTO dnd_characters/.test(sql) && /VALUES \(\$1,NULL/.test(sql)) {
      const row = {
        character_id: `44444444-4444-4444-8444-00000000000${this.next++}`,
        user_sub: params[0], campaign_id: null, slug: params[1], name: params[2], sheet: JSON.parse(params[3]),
        xp: 0, level: params[4], created_at: 'now', updated_at: 'now',
      };
      this.library.push(row);
      return rows([clone(row)]);
    }
    if (/UPDATE dnd_characters/.test(sql) && /campaign_id IS NULL/.test(sql)) {
      const row = this.library.find((candidate) => candidate.character_id === params[0] && candidate.user_sub === params[1] && candidate.campaign_id === null);
      if (!row) return rows([]);
      row.slug = params[2]; row.name = params[3]; row.sheet = JSON.parse(params[4]); row.level = params[5]; row.updated_at = 'later';
      return rows([clone(row)]);
    }
    if (/DELETE FROM dnd_characters/.test(sql) && /campaign_id IS NULL/.test(sql)) {
      const index = this.library.findIndex((candidate) => candidate.character_id === params[0] && candidate.user_sub === params[1] && candidate.campaign_id === null);
      if (index < 0) return rows([]);
      const [removed] = this.library.splice(index, 1);
      return rows([{ character_id: removed.character_id }]);
    }
    throw new Error('Unexpected read/library SQL: ' + sql);
  }
}

test('campaign list and load return sanitized DTOs without owner identity', async () => {
  const pool = new ReadAndLibraryPool();
  const listed = await request(pool, 'secret-owner-sub', 'GET', '/campaigns');
  assert.equal(listed.body.ok, true);
  assert.equal(listed.body.campaigns[0].campaign_id, 'camp-1');
  assert.equal(listed.body.campaigns[0].player_count, 1);
  assert.equal('user_sub' in listed.body.campaigns[0], false);
  assert.deepEqual(listed.body.campaigns.map((campaign) => campaign.status), ['active', 'archived']);

  const loaded = await request(pool, 'secret-owner-sub', 'GET', '/state?campaignId=camp-1');
  assert.equal(loaded.body.campaign.campaign_id, 'camp-1');
  assert.equal(loaded.body.campaign.is_owner, true);
  assert.equal('user_sub' in loaded.body.campaign, false);
});

test('saved-character CRUD is scoped to caller-owned NULL-campaign rows', async () => {
  const pool = new ReadAndLibraryPool();
  const listed = await request(pool, 'alice', 'GET', '/characters');
  assert.deepEqual(listed.body.characters.map((row) => row.character_id), [SAVED_ID]);

  const created = await request(pool, 'alice', 'POST', '/characters', { character: manualHero('New Hero', 'new-hero') });
  assert.equal(created.body.ok, true);
  assert.equal(created.body.character.sheet.name, 'New Hero');
  assert.equal(created.body.character.sheet.mods.str, 2);

  const foreignPatch = await request(pool, 'alice', 'PATCH', `/characters/${OTHER_ID}`, { character: manualHero('Stolen', 'stolen') });
  assert.equal(foreignPatch.body.ok, false);
  assert.equal(pool.library.find((row) => row.character_id === OTHER_ID).name, 'Other');

  const updated = await request(pool, 'alice', 'PATCH', `/characters/${SAVED_ID}`, { character: manualHero('Aria Revised', 'aria-revised') });
  assert.equal(updated.body.character.name, 'Aria Revised');
  const removed = await request(pool, 'alice', 'DELETE', `/characters/${SAVED_ID}`);
  assert.equal(removed.body.ok, true);
  assert.equal(pool.library.some((row) => row.campaign_id === 'camp-1' && row.slug === 'bram'), true);
});

class CreatePool {
  constructor(failAt) {
    this.failAt = failAt || null;
    this.data = {
      campaigns: [],
      characters: [{ character_id: SAVED_ID, user_sub: 'alice', campaign_id: null, slug: 'aria', name: 'Aria', sheet: manualHero('Aria Nightwind', 'aria-nightwind'), xp: 0, level: 1 }],
      encounters: [], archive: [],
    };
    this.queries = [];
    this.released = false;
  }
  async connect() { return new CreateClient(this); }
  async query(sql, params) {
    this.queries.push({ source: 'pool', sql, params });
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) {
      return rows(this.data.characters.filter((row) => row.campaign_id === params[0]).map((row) => ({ slug: row.slug, sheet: clone(row.sheet) })));
    }
    throw new Error('Unexpected create pool SQL: ' + sql);
  }
}

class CreateClient {
  constructor(pool) { this.pool = pool; this.tx = null; this.characterInsert = 0; }
  async query(sql, params) {
    this.pool.queries.push({ source: 'client', sql, params });
    if (sql === 'BEGIN') { this.tx = clone(this.pool.data); return rows([]); }
    if (sql === 'COMMIT') { this.pool.data = this.tx; this.tx = null; return rows([]); }
    if (sql === 'ROLLBACK') { this.tx = null; return rows([]); }
    if (/SELECT character_id, sheet FROM dnd_characters/.test(sql) && /campaign_id IS NULL/.test(sql)) {
      return rows(this.tx.characters.filter((row) => row.user_sub === params[0] && row.campaign_id === null && params[1].includes(row.character_id)).map(clone));
    }
    if (/INSERT INTO dnd_campaigns/.test(sql)) {
      const row = { campaign_id: 'camp-new', user_sub: params[0], name: params[1], adventure_id: params[2], join_code: params[3], status: 'active', created_at: 'now', updated_at: 'now' };
      this.tx.campaigns.push(row); return rows([clone(row)]);
    }
    if (/INSERT INTO dnd_characters/.test(sql)) {
      this.characterInsert++;
      if (this.pool.failAt === `character-${this.characterInsert}`) throw new Error('injected character failure');
      this.tx.characters.push({ character_id: `campaign-char-${this.characterInsert}`, user_sub: params[0], campaign_id: params[1], slug: params[2], name: params[3], sheet: JSON.parse(params[4]), xp: 0, level: params[5] });
      return rows([]);
    }
    if (/INSERT INTO dnd_encounters/.test(sql)) {
      if (this.pool.failAt === 'encounter') throw new Error('injected encounter failure');
      this.tx.encounters.push({ campaign_id: params[0], state: JSON.parse(params[3]), rev: 1 }); return rows([]);
    }
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1 AS n FROM dnd_archive/.test(sql)) {
      const seq = this.tx.archive.filter((row) => row.campaign_id === params[0]).length + 1;
      return rows([{ n: seq }]);
    }
    if (/INSERT INTO dnd_archive/.test(sql)) {
      if (this.pool.failAt === 'archive') throw new Error('injected archive failure');
      this.tx.archive.push({ user_sub: params[0], campaign_id: params[1], seq: params[2], kind: params[3], content: params[4] });
      return rows([]);
    }
    throw new Error('Unexpected create client SQL: ' + sql);
  }
  release() { this.pool.released = true; }
}

const createBody = () => ({
  name: 'Saved Heroes Test',
  party: ['bram', 'della', 'pip', 'aria-nightwind'],
  savedCharacterIds: [SAVED_ID],
});

test('campaign creation clones authorized saved sheets in one transaction', async () => {
  const pool = new CreatePool();
  const result = await request(pool, 'alice', 'POST', '/campaign', createBody());
  assert.equal(result.status, 200);
  assert.equal(result.body.campaign.campaign_id, 'camp-new');
  assert.equal(result.body.campaign.is_owner, true);
  assert.equal('user_sub' in result.body.campaign, false);
  assert.deepEqual(pool.queries.filter((query) => query.source === 'client' && query.sql === 'BEGIN').length, 1);
  assert.deepEqual(pool.queries.filter((query) => query.source === 'client' && query.sql === 'COMMIT').length, 1);
  assert.equal(pool.data.characters.filter((row) => row.campaign_id === 'camp-new').length, 4);
  assert.equal(pool.data.characters.some((row) => row.campaign_id === 'camp-new' && row.slug === 'aria-nightwind'), true);
  assert.equal(pool.data.characters.some((row) => row.campaign_id === null && row.character_id === SAVED_ID), true);
  assert.equal(pool.data.encounters.length, 1);
  assert.equal(pool.data.archive.length, 1);
  assert.equal(pool.released, true);
});

test('campaign creation rolls back every partial row when a child or milestone fails', async (t) => {
  for (const failAt of ['character-2', 'encounter', 'archive']) {
    await t.test(failAt, async () => {
      const pool = new CreatePool(failAt);
      const result = await request(pool, 'alice', 'POST', '/campaign', createBody());
      assert.equal(result.status, 500);
      assert.equal(pool.data.campaigns.length, 0);
      assert.equal(pool.data.characters.filter((row) => row.campaign_id !== null).length, 0);
      assert.equal(pool.data.encounters.length, 0);
      assert.equal(pool.data.archive.length, 0);
      assert.equal(pool.queries.some((query) => query.sql === 'ROLLBACK'), true);
      assert.equal(pool.released, true);
    });
  }
});

test('campaign creation rejects foreign saved-character ids before inserting a campaign', async () => {
  const pool = new CreatePool();
  const result = await request(pool, 'mallory', 'POST', '/campaign', createBody());
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'CHARACTER_NOT_FOUND');
  assert.equal(pool.data.campaigns.length, 0);
  assert.equal(pool.queries.some((query) => /INSERT INTO dnd_campaigns/.test(query.sql)), false);
});

class JoinPool {
  constructor(mode, players) {
    this.mode = mode;
    this.players = clone(players || []);
    this.rev = 7;
    this.queries = [];
    this.released = false;
  }
  async connect() { return new JoinClient(this); }
}

class JoinClient {
  constructor(pool) { this.pool = pool; }
  async query(sql, params) {
    this.pool.queries.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return rows([]);
    if (/set_config\('oshal\.dnd_join_code'/.test(sql)) return rows([{ set_config: params[0] }]);
    if (/JOIN dnd_encounters/.test(sql)) {
      const tokens = ['bram', 'della', 'pip', 'fenwick'].map((id) => ({ id, kind: 'pc' }));
      return params[0] === 'ABC123'
        ? rows([{ campaign_id: 'camp-1', user_sub: 'host', state: { mode: this.pool.mode, tokens } }]) : rows([]);
    }
    if (/SELECT user_sub, character_slug FROM dnd_players/.test(sql)) return rows(clone(this.pool.players));
    if (/INSERT INTO dnd_players/.test(sql)) {
      const existing = this.pool.players.find((player) => player.user_sub === params[1]);
      if (existing) existing.display_name = params[2];
      else this.pool.players.push({ user_sub: params[1], display_name: params[2], character_slug: null });
      return rows([]);
    }
    if (/UPDATE dnd_encounters SET rev=rev\+1/.test(sql)) {
      this.pool.rev++;
      return rows([{ rev: this.pool.rev }]);
    }
    throw new Error('Unexpected join SQL: ' + sql);
  }
  release() { this.pool.released = true; }
}

test('malformed join codes fail before a transaction or campaign lookup', async () => {
  const pool = new JoinPool('setup', []);
  const result = await request(pool, 'alice', 'POST', '/join', { code: "ABC123' OR TRUE" });
  assert.equal(result.body.code, 'GAME_NOT_FOUND');
  assert.equal(pool.queries.length, 0);
});

test('joining is locked to an open four-person setup lobby', async (t) => {
  await t.test('combat rejects a late join before adding a player', async () => {
    const pool = new JoinPool('combat', []);
    const result = await request(pool, 'alice', 'POST', '/join', { code: 'abc123' });
    assert.equal(result.body.code, 'QUEST_IN_PROGRESS');
    assert.equal(pool.players.length, 0);
    assert.deepEqual(pool.queries[1], {
      sql: "SELECT set_config('oshal.dnd_join_code', $1, true)", params: ['ABC123'],
    });
    assert.match(pool.queries.find((query) => /JOIN dnd_encounters/.test(query.sql)).sql, /FOR UPDATE OF c, e/);
  });
  await t.test('the fifth distinct participant is rejected', async () => {
    const pool = new JoinPool('setup', [
      { user_sub: 'bob', character_slug: 'della' }, { user_sub: 'cara', character_slug: 'pip' },
      { user_sub: 'dan', character_slug: 'fenwick' },
    ]);
    const result = await request(pool, 'alice', 'POST', '/join', { code: 'ABC123' });
    assert.equal(result.body.code, 'TABLE_FULL');
    assert.equal(pool.players.length, 3);
    assert.match(pool.queries.find((query) => /SELECT user_sub, character_slug/.test(query.sql)).sql, /FOR UPDATE/);
  });
  await t.test('a new seat invalidates any concurrent start holding the old revision', async () => {
    const pool = new JoinPool('setup', [
      { user_sub: 'bob', character_slug: 'della' }, { user_sub: 'cara', character_slug: 'pip' },
    ]);
    const staleStartRevision = pool.rev;
    const result = await request(pool, 'alice', 'POST', '/join', { code: 'ABC123' });
    assert.equal(result.body.ok, true);
    assert.equal(result.body.rev, staleStartRevision + 1);
    assert.equal(pool.rev, staleStartRevision + 1);
    assert.notEqual(staleStartRevision, pool.rev, 'a stale Start CAS must no longer match');
    assert.equal(pool.players.some((player) => player.user_sub === 'alice'), true);
    assert.equal(pool.queries.filter((query) => /UPDATE dnd_encounters SET rev=rev\+1/.test(query.sql)).length, 1);
    const insertAt = pool.queries.findIndex((query) => /INSERT INTO dnd_players/.test(query.sql));
    const bumpAt = pool.queries.findIndex((query) => /UPDATE dnd_encounters SET rev=rev\+1/.test(query.sql));
    const commitAt = pool.queries.findIndex((query) => query.sql === 'COMMIT');
    assert.equal(insertAt < bumpAt && bumpAt < commitAt, true, 'seat insert and revision bump commit atomically');
    assert.equal(pool.queries.filter((query) => query.sql === 'COMMIT').length, 1);
    assert.equal(pool.released, true);
  });
  await t.test('an existing member rejoin does not churn the board revision', async () => {
    const pool = new JoinPool('setup', [{ user_sub: 'alice', character_slug: 'bram' }]);
    const result = await request(pool, 'alice', 'POST', '/join', { code: 'ABC123' });
    assert.equal(result.body.ok, true);
    assert.equal(pool.rev, 7);
    assert.equal(pool.queries.some((query) => /UPDATE dnd_encounters SET rev=rev\+1/.test(query.sql)), false);
  });
});

class ClaimPool {
  constructor(mode) {
    this.state = { mode: mode || 'setup', tokens: ['bram', 'pip'].map((slug) => ({ id: slug, slug, kind: 'pc' })) };
    this.players = [{ user_sub: 'alice', display_name: 'Alice', character_slug: 'bram' }];
    this.rev = 7; this.queries = []; this.released = false;
  }
  async connect() { return new ClaimClient(this); }
  async query(sql, params) {
    this.queries.push({ sql, params });
    if (/SELECT c\.\*,/.test(sql)) return rows([{ campaign_id: 'camp-1', user_sub: 'host', is_owner: false }]);
    if (/SELECT user_sub, display_name, character_slug/.test(sql)) return rows(clone(this.players));
    throw new Error('Unexpected claim pool SQL: ' + sql);
  }
}

class ClaimClient {
  constructor(pool) { this.pool = pool; }
  async query(sql, params) {
    this.pool.queries.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return rows([]);
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.pool.state), rev: this.pool.rev }]);
    if (/SELECT user_sub, display_name, character_slug/.test(sql)) return rows(clone(this.pool.players));
    if (/SELECT slug FROM dnd_characters/.test(sql)) return this.pool.state.tokens.some((token) => token.slug === params[1]) ? rows([{ slug: params[1] }]) : rows([]);
    if (/INSERT INTO dnd_players/.test(sql)) {
      const seat = this.pool.players.find((player) => player.user_sub === params[1]);
      seat.character_slug = params[3] || null; seat.display_name = params[2]; return rows([]);
    }
    if (/UPDATE dnd_encounters SET rev=rev\+1/.test(sql)) { this.pool.rev++; return rows([{ rev: this.pool.rev }]); }
    throw new Error('Unexpected claim client SQL: ' + sql);
  }
  release() { this.pool.released = true; }
}

test('claim changes serialize with Start and bump only the effective claim', async (t) => {
  await t.test('a changed claim invalidates a Start holding the prior revision', async () => {
    const pool = new ClaimPool('setup'), staleStartRevision = pool.rev;
    const result = await request(pool, 'alice', 'POST', '/claim', { campaignId: 'camp-1', slug: 'pip' });
    assert.equal(result.body.ok, true); assert.equal(result.body.rev, 8);
    assert.equal(pool.players[0].character_slug, 'pip'); assert.notEqual(pool.rev, staleStartRevision);
    const boardLock = pool.queries.findIndex((query) => /SELECT state, rev/.test(query.sql));
    const seatsLock = pool.queries.findIndex((query) => /SELECT user_sub, display_name/.test(query.sql) && /FOR UPDATE/.test(query.sql));
    const bump = pool.queries.findIndex((query) => /UPDATE dnd_encounters SET rev=rev\+1/.test(query.sql));
    const commit = pool.queries.findIndex((query) => query.sql === 'COMMIT');
    assert.match(pool.queries[boardLock].sql, /FOR UPDATE/);
    assert.equal(boardLock < seatsLock && seatsLock < bump && bump < commit, true);
    assert.equal(pool.released, true);
  });
  await t.test('same-claim retry commits without revision churn', async () => {
    const pool = new ClaimPool('setup');
    const result = await request(pool, 'alice', 'POST', '/claim', { campaignId: 'camp-1', slug: 'bram' });
    assert.equal(result.body.ok, true); assert.equal(result.body.unchanged, true); assert.equal(pool.rev, 7);
    assert.equal(pool.queries.some((query) => /UPDATE dnd_encounters SET rev=rev\+1/.test(query.sql)), false);
  });
  await t.test('combat rejects a late effective claim change', async () => {
    const pool = new ClaimPool('combat');
    const result = await request(pool, 'alice', 'POST', '/claim', { campaignId: 'camp-1', slug: 'pip' });
    assert.equal(result.body.code, 'CLAIMS_CLOSED'); assert.equal(pool.players[0].character_slug, 'bram');
    assert.equal(pool.rev, 7); assert.equal(pool.queries.some((query) => /INSERT INTO dnd_players/.test(query.sql)), false);
  });
});

class LeavePool {
  constructor() {
    this.campaign = { campaign_id: 'camp-1', user_sub: 'host' };
    this.players = [{ user_sub: 'alice', character_slug: 'bram' }, { user_sub: 'bob', character_slug: 'della' }];
    this.characters = [{ slug: 'bram' }, { slug: 'della' }];
    this.rev = 7;
    this.queries = [];
  }
  async connect() { return new LeaveClient(this); }
}

class LeaveClient {
  constructor(pool) { this.pool = pool; }
  async query(sql, params) {
    this.pool.queries.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return rows([]);
    if (/SELECT c\.campaign_id, c\.user_sub/.test(sql)) {
      const member = this.pool.players.some((row) => row.user_sub === params[1]);
      if (params[0] !== this.pool.campaign.campaign_id || (params[1] !== 'host' && !member)) return rows([]);
      return rows([{ ...this.pool.campaign, is_owner: params[1] === 'host' }]);
    }
    if (/DELETE FROM dnd_players/.test(sql)) {
      this.pool.players = this.pool.players.filter((row) => !(row.user_sub === params[1])); return rows([]);
    }
    if (/UPDATE dnd_encounters SET rev=rev\+1/.test(sql)) { this.pool.rev++; return rows([{ rev: this.pool.rev }]); }
    if (/UPDATE dnd_campaigns SET updated_at/.test(sql)) return rows([]);
    throw new Error('Unexpected leave SQL: ' + sql);
  }
  release() {}
}

test('member leave releases only their claim and bumps the shared board revision', async () => {
  const pool = new LeavePool();
  const left = await request(pool, 'alice', 'POST', '/campaign/leave', { campaignId: 'camp-1' });
  assert.equal(left.body.ok, true);
  assert.equal(left.body.rev, 8);
  assert.deepEqual(pool.players, [{ user_sub: 'bob', character_slug: 'della' }]);
  assert.deepEqual(pool.characters, [{ slug: 'bram' }, { slug: 'della' }]);
  const deletion = pool.queries.find((query) => /DELETE FROM dnd_players/.test(query.sql));
  assert.deepEqual(deletion.params, ['camp-1', 'alice']);
});

test('campaign owner cannot leave even if they could have a player row', async () => {
  const pool = new LeavePool();
  pool.players.push({ user_sub: 'host', character_slug: 'pip' });
  const result = await request(pool, 'host', 'POST', '/campaign/leave', { campaignId: 'camp-1' });
  assert.equal(result.body.code, 'OWNER_CANNOT_LEAVE');
  assert.equal(pool.players.some((row) => row.user_sub === 'host'), true);
  assert.equal(pool.queries.some((query) => /DELETE FROM dnd_players/.test(query.sql)), false);
});
