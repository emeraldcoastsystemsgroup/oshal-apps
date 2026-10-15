/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Live 2026-10-11: the host desk's End game (POST /action {type:endGame}) reached the outro but left the room 'live', so it stayed under "Your open games" and never reached the hall of fame. The real route handler and room service run against an in-memory room; End game must save the outro and set the room's status to 'ended', and a clock override must not.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomService } = require('../lib/room-service');
const { handleOverride } = require('../routes/game-show-routes');
const registry = require('../lib/shows/show-registry');

const ROOM = '22222222-2222-2222-2222-222222222222';
const HOST = 'host-sub';

function roomPool(state) {
  const store = { status: 'live', state: JSON.parse(JSON.stringify(state)), rev: 1, statements: [] };
  const query = async (text, params = []) => {
    const sql = String(text);
    store.statements.push(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/UPDATE gameshow_rooms SET status=\$1/.test(sql)) { store.status = params[0]; return { rows: [], rowCount: 1 }; }
    if (/FROM gameshow_rooms/.test(sql)) {
      return { rows: [{ room_id: ROOM, user_sub: HOST, show_id: 'family-feud', status: store.status }], rowCount: 1 };
    }
    if (/SELECT state, rev FROM gameshow_state/.test(sql)) return { rows: [{ state: store.state, rev: store.rev }], rowCount: 1 };
    if (/UPDATE gameshow_state SET state=\$1/.test(sql)) { store.state = JSON.parse(params[0]); store.rev += 1; return { rows: [{ rev: store.rev }], rowCount: 1 }; }
    if (/COALESCE\(MAX\(seq\)/.test(sql)) return { rows: [{ n: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { store, query, connect: async () => ({ query, release() {} }) };
}

const inPlay = () => ({
  ...registry.get('family-feud').initialState({ room_id: ROOM, user_sub: HOST }, [], Date.now()),
  phase: 'faceoff', round: 1,
});

test('the host desk End game finishes the show and ends the room', async () => {
  const pool = roomPool(inPlay());
  const env = { room: createRoomService({ pool }) };
  const out = await handleOverride(env, HOST, { roomId: ROOM, action: { type: 'endGame' } });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(pool.store.state.phase, 'outro', 'the show reached its own finish');
  assert.equal(pool.store.status, 'ended', 'the room is no longer live');
  assert.equal(out.roomStatus, 'ended');
});

test('a clock override leaves the room live', async () => {
  const pool = roomPool({ ...inPlay(), timer: { key: 'x', endsAt: Date.now() + 60000, ms: 60000 } });
  const env = { room: createRoomService({ pool }) };
  const out = await handleOverride(env, HOST, { roomId: ROOM, action: { type: 'pauseTimer' } });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(pool.store.status, 'live');
  assert.equal(out.roomStatus, undefined);
});

test('only the host can end the game', async () => {
  const pool = roomPool(inPlay());
  const env = { room: createRoomService({ pool }) };
  const out = await handleOverride(env, 'someone-else', { roomId: ROOM, action: { type: 'endGame' } });
  assert.equal(out.ok, false);
  assert.equal(pool.store.status, 'live');
});
