/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Two native-kernel refusals, live on 2026-10-11. (1) "Solo night" and "+ Team A" added no AI players: addPodium wrote npc:<skill>:<uuid> / house:<uuid> into user_sub and the kernel answered "SQL owner field does not match the admitted principal" (POST /podium 500). (2) Every poll after a show started answered 500: GET /sync resolved the lapsed round clock with a write, and a GET is a reader admission ("SQL mutation requires original writer admission"). The pool below applies both kernel rules to every statement; AI and house podiums must insert a NULL owner with their identity in seat_key, GET /sync must issue no write even with a lapsed clock, and POST /sync must resolve it.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The kernel double now also fills a NULL owner with the caller and keeps uq_gameshow_seat, as the native kernel does: a NULL-owner podium in gameshow_seats collided with the host's seat live (23505). Podiums are the host's gameshow_podiums rows; three AI players and two house podiums add beside the host, a seat read returns them all, and the host resolves to their own seat, never a podium.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRoomService } = require('../lib/room-service');
const { seatDto } = require('../lib/route-helpers');
const npc = require('../lib/npc');

const MUTATION = /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i;
const ROOM = '11111111-1111-1111-1111-111111111111';
const HOST = 'host-sub';

/**
 * @description The native owner rule on an INSERT: user_sub must be the admitted caller, and a NULL
 *   (or omitted) user_sub is filled with the caller (legacy_sql.rs insert_defaults). Returns the
 *   column-to-value row so the unique rule can be applied to what is actually stored.
 * @param {string} sql - The statement.
 * @param {Array} params - Its parameters.
 * @param {string} principal - The admitted caller.
 * @returns {object|null} The inserted row, or null for a non-INSERT.
 */
function ownedRow(sql, params, principal) {
  const m = /^\s*INSERT INTO \w+ \(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
  if (!m) return null;
  const columns = m[1].split(',').map((c) => c.trim());
  const values = m[2].split(',').map((v) => v.trim());
  const row = {};
  columns.forEach((column, i) => {
    const raw = values[i];
    row[column] = /^\$\d+$/.test(raw) ? params[Number(raw.slice(1)) - 1] : (/^NULL$/i.test(raw) ? null : raw.replace(/^'|'$/g, ''));
  });
  if (row.user_sub === null || row.user_sub === undefined) row.user_sub = principal;
  if (row.user_sub !== principal) throw new Error('refused: SQL owner field does not match the admitted principal');
  return row;
}

/**
 * @description An in-memory room behind the kernel's rules: `mode` 'reader' refuses every write,
 *   every INSERT's owner field is the caller (NULL is filled with the caller), and gameshow_seats
 *   keeps uq_gameshow_seat (room_id, user_sub).
 */
function kernelPool({ mode, principal, state, seats = [] }) {
  const store = { state: JSON.parse(JSON.stringify(state)), rev: 3, seats: [...seats], podiums: [], statements: [] };
  const room = { room_id: ROOM, user_sub: HOST, show_id: 'family-feud', status: 'live', name: 'r', join_code: 'ABC123' };
  const insert = (table, row) => {
    if (table === 'gameshow_seats' && store.seats.some((s) => s.room_id === row.room_id && s.user_sub === row.user_sub)) {
      throw new Error('refused: SQL unique key already exists (23505)');
    }
    const saved = { seat_id: `seat-${store.seats.length + store.podiums.length + 1}`, ...row };
    (table === 'gameshow_seats' ? store.seats : store.podiums).push(saved);
    return { rows: [saved], rowCount: 1 };
  };
  const query = async (text, params = []) => {
    const sql = String(text);
    store.statements.push(sql);
    if (mode === 'reader' && MUTATION.test(sql)) throw new Error('refused: SQL mutation requires original writer admission');
    const row = ownedRow(sql, params, principal);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM gameshow_rooms/.test(sql)) return { rows: [room], rowCount: 1 };
    if (/^\s*SELECT \* FROM gameshow_seats/.test(sql)) return { rows: store.seats, rowCount: store.seats.length };
    if (/^\s*SELECT \* FROM gameshow_podiums/.test(sql)) return { rows: store.podiums, rowCount: store.podiums.length };
    if (/SELECT state, rev FROM gameshow_state/.test(sql)) return { rows: [{ state: store.state, rev: store.rev }], rowCount: 1 };
    if (/UPDATE gameshow_state SET state=\$1/.test(sql)) { store.state = JSON.parse(params[0]); store.rev += 1; return { rows: [{ rev: store.rev }], rowCount: 1 }; }
    if (/COALESCE\(MAX\(seq\)/.test(sql)) return { rows: [{ n: 1 }], rowCount: 1 };
    const into = /^\s*INSERT INTO (gameshow_seats|gameshow_podiums)\b/.exec(sql);
    if (into) return insert(into[1], { room_id: ROOM, ...row });
    return { rows: [], rowCount: 0 };
  };
  const pool = { store, query, connect: async () => ({ query, release() {} }) };
  return pool;
}

const registry = require('../lib/shows/show-registry');
/** A real Family Feud state whose open round clock lapsed five seconds ago. */
const LAPSED = {
  ...registry.get('family-feud').initialState({ room_id: ROOM, user_sub: HOST }, [], Date.now()),
  phase: 'faceoff', round: 1, timer: { key: 'x', endsAt: Date.now() - 5000, ms: 1000 },
};
const HOST_SEAT = { seat_id: 'seat-host', room_id: ROOM, user_sub: HOST, role: 'host', display_name: 'Host', seat_key: null };

test('an AI podium is the host\'s gameshow_podiums row, identified by seat_key', async () => {
  const pool = kernelPool({ mode: 'writer', principal: HOST, state: { phase: 'lobby' }, seats: [HOST_SEAT] });
  const room = createRoomService({ pool });
  for (const body of [{ npc: 'sharp', team: 'A' }, { npc: 'casual', team: 'B' }, { npc: 'wild', team: 'B' }]) {
    const result = await room.addPodium(HOST, ROOM, body);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  assert.equal(pool.store.seats.length, 1, 'the people\'s seats are untouched: only the host sits there');
  assert.equal(pool.store.podiums.length, 3, 'three AI players beside the host');
  for (const podium of pool.store.podiums) {
    assert.equal(podium.user_sub, HOST);
    assert.match(podium.seat_key, /^npc:(sharp|casual|wild):[0-9a-f-]{36}$/);
  }
  const seats = await room.seatsOf(ROOM);
  assert.equal(seats.length, 4, 'a seat read returns the host and the three podiums');
});

test('a house podium is a host-owned podium with a house: seat_key', async () => {
  const pool = kernelPool({ mode: 'writer', principal: HOST, state: { phase: 'lobby' }, seats: [HOST_SEAT] });
  const room = createRoomService({ pool });
  assert.equal((await room.addPodium(HOST, ROOM, { team: 'A' })).ok, true);
  assert.equal((await room.addPodium(HOST, ROOM, { team: 'B' })).ok, true);
  assert.deepEqual(pool.store.podiums.map((p) => p.seat_key.split(':')[0]), ['house', 'house']);
});

test('the host acts as their own seat, never as one of their podiums', async () => {
  const pool = kernelPool({ mode: 'writer', principal: HOST, state: { phase: 'lobby' }, seats: [] });
  const room = createRoomService({ pool });
  await room.addPodium(HOST, ROOM, { npc: 'sharp' });
  pool.store.seats.push({ ...HOST_SEAT, joined_at: '2030-01-01T00:00:00Z' });
  const seats = await room.seatsOf(ROOM);
  const resolved = room.resolveActor(seats, { user_sub: HOST }, HOST, null);
  assert.equal(resolved.actor.seatId, 'seat-host');
});

test('GET /sync reads only, even with a lapsed round clock', async () => {
  const pool = kernelPool({ mode: 'reader', principal: HOST, state: LAPSED, seats: [HOST_SEAT] });
  const out = await createRoomService({ pool }).sync(HOST, ROOM, 0, 0);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.rev, 3);
  assert.deepEqual(pool.store.statements.filter((sql) => MUTATION.test(sql)), []);
});

test('POST /sync resolves the lapsed clock under writer admission, then answers the poll', async () => {
  const pool = kernelPool({ mode: 'writer', principal: HOST, state: LAPSED, seats: [HOST_SEAT] });
  const out = await createRoomService({ pool }).advanceAndSync(HOST, ROOM, 3, 0);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.rev, 4, 'the tick saved the room');
  assert.equal(out.changed, true);
  assert.ok(!out.state.timer || Number(out.state.timer.endsAt) !== LAPSED.timer.endsAt, 'the lapsed window was resolved');
});

test('an AI podium is read from its seat_key: an NPC, never the caller\'s own seat', () => {
  const row = { seat_id: 's1', user_sub: HOST, seat_key: 'npc:wild:0f0e', role: 'player', display_name: 'Ziggy' };
  assert.equal(npc.isNpc(row), true);
  assert.equal(npc.seatKeyOf(row), 'npc:wild:0f0e');
  const dto = seatDto(row, HOST);
  assert.equal(dto.npc, 'wild');
  assert.equal(dto.me, false);
  assert.equal(seatDto({ ...HOST_SEAT }, HOST).me, true);
  assert.equal(npc.isNpc({ user_sub: 'npc:sharp:legacy', seat_key: null }), true, 'a row written before migration 002 still reads');
});

test('the surface polls with POST /sync, the route serves it, and migration 003 is declared', () => {
  const root = path.join(__dirname, '..');
  const core = fs.readFileSync(path.join(root, 'ui', 'gs-core.js'), 'utf8');
  assert.match(core, /GS\.api\.post\('\/sync', \{ roomId: GS\.roomId, rev: GS\.rev, seq: GS\.seq \}\)/);
  assert.doesNotMatch(core, /api\.get\('\/sync/);
  const routes = fs.readFileSync(path.join(root, 'routes', 'game-show-routes.js'), 'utf8');
  assert.match(routes, /'\/sync': \(body\) => env\.room\.advanceAndSync\(/);
  const migration = fs.readFileSync(path.join(root, 'migrations', '003-game-show-podiums.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gameshow_podiums \(/);
  assert.match(migration, /seat_key\s+text\s+NOT NULL/);
  assert.doesNotMatch(migration, /UNIQUE \(room_id, user_sub\)/, 'a host may add many podiums');
  assert.match(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'), /\n  - migrations\/003-game-show-podiums\.sql\n/);
});
