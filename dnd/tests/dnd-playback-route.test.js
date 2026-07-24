/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 01:17:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard authenticated GET-only playback, exact snapshot fidelity, honest archive gaps, branch classification, hidden-token filtering, and zero state mutation.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes.js');

const root = path.join(__dirname, '..');
const rows = (value) => ({ rowCount: value.length, rows: value });
const clone = (value) => JSON.parse(JSON.stringify(value));

/** @description Invoke one authenticated playback request against a focused pool. */
async function request(pool, sub, url) {
  const router = createDndRoutes({ pool, appPackageDir: root });
  let payload = '';
  const req = { method: 'GET', url, oidc: { user: { sub, name: sub } } };
  const res = { statusCode: 0, setHeader() {}, end(value) { payload = String(value || ''); } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

/** @description Supply authorized persisted frames without accepting writes. */
class PlaybackPool {
  constructor() {
    this.queries = [];
    this.board = { sceneId: 'coast-road', mode: 'complete', round: 4, tokens: [
      { id: 'bram', kind: 'pc', name: 'Bram', x: 3, y: 4, hp: 8, maxHp: 12, _easeX: 2 },
      { id: 'g1', kind: 'monster', name: 'Hidden Goblin', x: 9, y: 2, hp: 7, maxHp: 7, hidden: true },
    ] };
    this.archive = [
      { seq: 1, kind: 'milestone', content: 'The party enters the road.', payload: null, created_at: '2026-07-22T00:01:00Z' },
      { seq: 2, kind: 'combat', content: 'Bram strikes the goblin.', payload: { v: 1, eventId: 'roll-2', rolls: [] }, created_at: '2026-07-22T00:02:00Z' },
    ];
    this.snapshots = [
      { snapshot_id: 'snap-current', label: 'At the cart', state: clone(this.board), auto: true, archive_seq: 1, created_at: '2026-07-22T00:01:30Z' },
      { snapshot_id: 'snap-prior', label: 'Abandoned fork', state: clone(this.board), auto: false, archive_seq: 2, created_at: '2026-07-22T00:01:45Z' },
      { snapshot_id: 'snap-legacy', label: 'Old save', state: clone(this.board), auto: false, archive_seq: null, created_at: '2026-07-22T00:02:30Z' },
    ];
  }

  /** @description Match only the four reads used by campaign access and playback. */
  async query(sql, params) {
    this.queries.push({ sql, params });
    if (/SELECT c\.\*,/.test(sql)) {
      if (!['host', 'guest'].includes(params[1])) return rows([]);
      return rows([{ campaign_id: 'camp-1', user_sub: 'host', name: 'Finished Road', adventure_id: 'goblin-ambush', status: 'archived', join_code: 'ABC123', created_at: 'created', updated_at: 'updated', is_owner: params[1] === 'host' }]);
    }
    if (/SELECT state, rev, updated_at FROM dnd_encounters/.test(sql)) {
      return rows([{ state: clone(this.board), rev: 12, updated_at: '2026-07-22T00:03:00Z' }]);
    }
    if (/SELECT snapshot_id, label, state, auto, archive_seq, created_at FROM dnd_snapshots/.test(sql)) return rows(this.snapshots.map(clone));
    if (/SELECT seq, kind, content, payload, created_at FROM dnd_archive/.test(sql)) return rows(this.archive.map(clone));
    throw new Error('Unexpected playback SQL: ' + sql);
  }
}

test('owner playback preserves exact saved boards and labels every archive beat boardless', async () => {
  const pool = new PlaybackPool();
  const result = await request(pool, 'host', '/playback?campaignId=camp-1');
  assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  assert.equal(result.body.readOnly, true); assert.equal(result.body.ended, true);
  const archive = result.body.frames.filter((frame) => frame.type === 'archive');
  assert.equal(archive.length, 2); assert.ok(archive.every((frame) => frame.board === null && frame.fidelity === 'archive-only'));
  assert.ok(archive.every((frame) => /not reconstructed/.test(frame.fidelityNote)));
  const current = result.body.frames.find((frame) => frame.snapshotId === 'snap-current');
  const prior = result.body.frames.find((frame) => frame.snapshotId === 'snap-prior');
  const legacy = result.body.frames.find((frame) => frame.snapshotId === 'snap-legacy');
  assert.equal(current.branch, 'current'); assert.equal(current.restorable, true);
  assert.equal('_easeX' in current.board.tokens[0], false);
  assert.equal(prior.branch, 'prior'); assert.equal(prior.restorable, false);
  assert.equal(legacy.branch, 'legacy'); assert.equal(legacy.restorable, true);
  assert.equal(result.body.coverage.archiveOnlyEntries, 2);
  assert.equal(pool.queries.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)), false);
});

test('member playback stays authorized but hides unrevealed tokens and restore controls', async () => {
  const result = await request(new PlaybackPool(), 'guest', '/playback?campaignId=camp-1');
  assert.equal(result.status, 200);
  const exact = result.body.frames.filter((frame) => frame.board);
  assert.ok(exact.length > 0); assert.ok(exact.every((frame) => frame.board.tokens.every((token) => !token.hidden)));
  assert.ok(result.body.frames.every((frame) => frame.restorable !== true));
});

test('playback rejects outsiders before reading board, snapshots, or archive', async () => {
  const pool = new PlaybackPool();
  const result = await request(pool, 'outsider', '/playback?campaignId=camp-1');
  assert.equal(result.status, 403); assert.equal(result.body.code, 'NO_ACCESS');
  assert.equal(pool.queries.length, 1); assert.match(pool.queries[0].sql, /SELECT c\.\*,/);
});

test('playback requires an explicit campaign id without querying account state', async () => {
  const pool = new PlaybackPool();
  const result = await request(pool, 'host', '/playback');
  assert.equal(result.status, 400); assert.equal(result.body.code, 'CAMPAIGN_REQUIRED');
  assert.equal(pool.queries.length, 0);
});
