/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 23:07:08 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard opaque seat DTOs, host-only transactional release, lobby cleanup, revision wake-up, and visible Party/Lobby takeover controls.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes');

const root = path.join(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => ({ rowCount: value.length, rows: value });

/** @description Invoke one authenticated D&D JSON route against a focused pool. */
async function request(pool, sub, method, url, body) {
  const router = createDndRoutes({ pool, appPackageDir: root });
  let payload = '';
  const req = { method, url, body, oidc: { user: { sub, name: sub } } };
  const res = {
    statusCode: 0, setHeader() {},
    end(value) { payload = String(value || ''); },
  };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

class SeatReleasePool {
  constructor() {
    this.campaign = { campaign_id: 'camp-1', user_sub: 'secret-host-sub', name: 'Road', status: 'active', join_code: 'ABC123' };
    this.state = { mode: 'combat', tokens: [{ id: 'bram', slug: 'bram', kind: 'pc' }], order: ['bram'], turnIndex: 0 };
    this.players = [
      { user_sub: 'secret-host-sub', display_name: 'Host', character_slug: 'pip' },
      { user_sub: 'secret-alice-sub', display_name: 'Alice', character_slug: 'bram' },
      { user_sub: 'secret-bob-sub', display_name: 'Bob', character_slug: null },
    ];
    this.rev = 7; this.queries = []; this.characters = [{ slug: 'bram' }];
  }
  async connect() { return new SeatReleaseClient(this); }
  async query(sql, params) {
    this.queries.push({ sql, params });
    if (/SELECT c\.\*,/.test(sql)) {
      const member = this.players.some((seat) => seat.user_sub === params[1]);
      if (params[0] !== 'camp-1' || (params[1] !== this.campaign.user_sub && !member)) return rows([]);
      return rows([{ ...this.campaign, is_owner: params[1] === this.campaign.user_sub }]);
    }
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.state), rev: this.rev }]);
    if (/SELECT seq, kind, content, payload, created_at FROM dnd_archive/.test(sql)) return rows([]);
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) return rows([]);
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return rows(clone(this.players));
    throw new Error('Unexpected seat-release pool SQL: ' + sql);
  }
}

class SeatReleaseClient {
  constructor(pool) { this.pool = pool; }
  async query(sql, params) {
    this.pool.queries.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return rows([]);
    if (/SELECT c\.campaign_id, c\.user_sub, e\.rev/.test(sql)) {
      return params[0] === 'camp-1' ? rows([clone(this.pool.campaign)]) : rows([]);
    }
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return rows(clone(this.pool.players));
    if (/DELETE FROM dnd_players/.test(sql)) {
      this.pool.players = this.pool.players.filter((seat) => seat.user_sub !== params[1]); return rows([]);
    }
    if (/UPDATE dnd_encounters SET rev=rev\+1/.test(sql)) return rows([{ rev: ++this.pool.rev }]);
    if (/UPDATE dnd_campaigns SET updated_at/.test(sql)) return rows([]);
    throw new Error('Unexpected seat-release client SQL: ' + sql);
  }
  release() {}
}

/** @description Load the public key for one visible seat. */
async function publicSeat(pool, sub, name) {
  const state = await request(pool, sub, 'GET', '/state?campaignId=camp-1');
  return { state, seat: state.body.players.find((candidate) => candidate.name === name) };
}

test('seat DTOs expose stable opaque keys and never account subjects', async () => {
  const pool = new SeatReleasePool();
  const first = await publicSeat(pool, 'secret-host-sub', 'Alice');
  const second = await publicSeat(pool, 'secret-host-sub', 'Alice');
  assert.match(first.seat.seatKey, /^[a-f0-9]{24}$/);
  assert.equal(first.seat.seatKey, second.seat.seatKey);
  assert.doesNotMatch(JSON.stringify(first.state.body), /user_sub|secret-host-sub|secret-alice-sub|secret-bob-sub/);
});

test('host release is atomic, wakes sync, and leaves the claimed hero for AI control', async () => {
  const pool = new SeatReleasePool();
  const { seat } = await publicSeat(pool, 'secret-host-sub', 'Alice');
  pool.queries = [];
  const result = await request(pool, 'secret-host-sub', 'POST', '/campaign/release-seat', { campaignId: 'camp-1', seatKey: seat.seatKey });
  assert.equal(result.body.ok, true); assert.equal(result.body.rev, 8);
  assert.deepEqual(result.body.released, { name: 'Alice', slug: 'bram' });
  assert.equal(result.body.players.some((player) => player.slug === 'bram'), false);
  assert.equal(pool.state.tokens.some((token) => token.slug === 'bram'), true);
  assert.deepEqual(pool.characters, [{ slug: 'bram' }]);
  const tableLock = pool.queries.findIndex((query) => /FOR UPDATE OF c, e/.test(query.sql));
  const seatLock = pool.queries.findIndex((query) => /ORDER BY joined_at FOR UPDATE/.test(query.sql));
  const deletion = pool.queries.findIndex((query) => /DELETE FROM dnd_players/.test(query.sql));
  const bump = pool.queries.findIndex((query) => /UPDATE dnd_encounters SET rev=rev\+1/.test(query.sql));
  const commit = pool.queries.findIndex((query) => query.sql === 'COMMIT');
  assert.equal(tableLock < seatLock && seatLock < deletion && deletion < bump && bump < commit, true);
});

test('host can remove an unclaimed waiting participant from the lobby', async () => {
  const pool = new SeatReleasePool(); pool.state.mode = 'setup';
  const { seat } = await publicSeat(pool, 'secret-host-sub', 'Bob');
  const result = await request(pool, 'secret-host-sub', 'POST', '/campaign/release-seat', { campaignId: 'camp-1', seatKey: seat.seatKey });
  assert.equal(result.body.ok, true); assert.deepEqual(result.body.released, { name: 'Bob', slug: null });
  assert.equal(pool.players.some((player) => player.display_name === 'Bob'), false);
});

test('release rejects unauthorized, owner, malformed, and missing targets', async (t) => {
  await t.test('a guest cannot release another guest', async () => {
    const pool = new SeatReleasePool(), { seat } = await publicSeat(pool, 'secret-alice-sub', 'Bob');
    const result = await request(pool, 'secret-alice-sub', 'POST', '/campaign/release-seat', { campaignId: 'camp-1', seatKey: seat.seatKey });
    assert.equal(result.body.code, 'HOST_REQUIRED'); assert.equal(pool.rev, 7);
  });
  await t.test('the host cannot target the owner seat', async () => {
    const pool = new SeatReleasePool(), { seat } = await publicSeat(pool, 'secret-host-sub', 'Host');
    const result = await request(pool, 'secret-host-sub', 'POST', '/campaign/release-seat', { campaignId: 'camp-1', seatKey: seat.seatKey });
    assert.equal(result.body.code, 'OWNER_SEAT_LOCKED'); assert.equal(pool.players.length, 3);
  });
  await t.test('bad and stale opaque keys do not delete anyone', async () => {
    const pool = new SeatReleasePool();
    const invalid = await request(pool, 'secret-host-sub', 'POST', '/campaign/release-seat', { campaignId: 'camp-1', seatKey: 'alice' });
    const missing = await request(pool, 'secret-host-sub', 'POST', '/campaign/release-seat', { campaignId: 'camp-1', seatKey: 'f'.repeat(24) });
    assert.equal(invalid.body.code, 'SEAT_REQUIRED'); assert.equal(missing.body.code, 'SEAT_NOT_FOUND');
    assert.equal(pool.players.length, 3);
  });
});

test('Party and Lobby render host-only confirmed AI takeover controls', () => {
  const seatUi = fs.readFileSync(path.join(root, 'ui', 'table-seats.js'), 'utf8');
  const screens = fs.readFileSync(path.join(root, 'ui', 'table-screens.js'), 'utf8');
  assert.match(seatUi, /!campaign\.is_owner \|\| !seat \|\| seat\.me \|\| !seat\.seatKey/);
  assert.match(seatUi, /Make AI Companion/); assert.match(seatUi, /Remove waiting player/);
  assert.match(seatUi, /api\('\/campaign\/release-seat'/);
  assert.match(seatUi, /players = result\.players[\s\S]*rev = Number\(result\.rev\)[\s\S]*rememberConfirmedBoard/);
  assert.match(seatUi, /wasActive[\s\S]*closeOverlay\(\); beginTurn\(\)/);
  assert.match(screens, /hostSeatReleaseButton\(taken\)/); assert.match(screens, /hostSeatReleaseButton\(seat\)/);
  assert.match(screens, /waitingSeatRoster\(\)/); assert.match(screens, /bindHostSeatReleaseControls\('party'\)/);
  assert.match(screens, /bindHostSeatReleaseControls\('lobby'\)/);
});
