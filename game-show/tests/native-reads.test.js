/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | GET /rooms ran the ended-room retention DELETE on every lobby load, which the native kernel refuses on a read ("SQL mutation requires original writer admission"). The lobby reads (listRooms, leaderboard, and loadState of a room the caller is not in) are driven against a recording pool and must issue only SELECTs; the hall of fame is bounded to the seven-day retention window in the query itself; creating a room still runs the sweep.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomService } = require('../lib/room-service');

/** @description A pool that records every statement and answers with no rows. */
function recordingPool() {
  const statements = [];
  const pool = {
    statements,
    query: async (sql) => { statements.push(String(sql)); return { rows: [], rowCount: 0 }; },
    connect: async () => ({ query: pool.query, release() {} }),
  };
  return pool;
}

const MUTATION = /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i;

test('the lobby reads issue only SELECTs', async () => {
  const pool = recordingPool();
  const room = createRoomService({ pool });
  assert.deepEqual(await room.listRooms('lobby-sub'), { ok: true, rooms: [] });
  assert.deepEqual(await room.leaderboard('lobby-sub'), { ok: true, entries: [] });
  assert.equal((await room.loadState('lobby-sub', '00000000-0000-0000-0000-000000000000')).status, 404);
  assert.ok(pool.statements.length >= 3);
  assert.deepEqual(pool.statements.filter((sql) => MUTATION.test(sql)), []);
});

test('the hall of fame reads only games that ended inside the retention window', async () => {
  const pool = recordingPool();
  await createRoomService({ pool }).leaderboard('lobby-sub');
  assert.match(pool.statements[0], /r\.updated_at >= now\(\) - interval '7 days'/);
});

test('creating a room still runs the retention sweep', async () => {
  const pool = recordingPool();
  await createRoomService({ pool }).createRoom('host-sub', 'Host', { showId: 'family-feud' }).catch(() => {});
  assert.ok(pool.statements.some((sql) => /^DELETE FROM gameshow_rooms WHERE status='ended'/.test(sql)));
});
