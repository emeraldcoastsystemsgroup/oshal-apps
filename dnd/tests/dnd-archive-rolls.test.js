/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove structured dice are validated, persisted, synchronized, and idempotent by stable event ID alongside legacy archive rows.
 * 2026-07-21 23:12:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove a delayed pre-rewind archive post cannot write into the restored timeline branch.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes');

const root = path.join(__dirname, '..');
const rows = (value) => ({ rowCount: value.length, rows: value });

/** @description Build one exact attack event accepted by the v1 contract. */
function rollPayload(eventId) {
  return { v: 1, eventId, rolls: [{
    kind: 'attack', actorId: 'bram', actorName: 'Bram',
    targetId: 'goblin-1', targetName: 'Goblin', actionName: 'Longsword',
    dice: '1d20', faces: [17], bonus: 5, total: 22,
    targetKind: 'ac', target: 13, outcome: 'hit', ordinal: 1, count: 1,
  }] };
}

/** @description Minimal transaction-capable archive database double. */
class ArchivePool {
  constructor() {
    this.archive = [{ seq: 1, kind: 'milestone', content: 'Legacy beginning.', created_at: 'before' }];
    this.timelineId = 'opening-gate-1';
  }
  async connect() { return this; }
  release() {}
  async query(sql, params) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || /pg_advisory_xact_lock/.test(sql)) return rows([]);
    if (/SELECT c\.\*,/.test(sql)) return rows([{ campaign_id: 'camp-1', user_sub: 'alice', is_owner: true }]);
    if (/SELECT state FROM dnd_encounters/.test(sql)) return rows([{ state: { mode: 'combat', presentationGate: { id: this.timelineId } } }]);
    if (/payload->>'eventId'/.test(sql) && /SELECT seq/.test(sql)) return this.existingEvent(params[1]);
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1/.test(sql)) return rows([{ n: this.archive.length + 1 }]);
    if (/INSERT INTO dnd_archive/.test(sql)) return this.insertArchive(params);
    if (/SELECT seq, kind, content, payload, created_at FROM dnd_archive/.test(sql)) return rows(this.archive.slice());
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: { mode: 'combat' }, rev: 3 }]);
    if (/SELECT seq, kind, content, payload FROM dnd_archive/.test(sql)) return rows(this.archive.filter((row) => row.seq > Number(params[1])));
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return rows([]);
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) return rows([]);
    throw new Error(`Unexpected archive SQL: ${sql}`);
  }
  existingEvent(eventId) {
    const row = this.archive.find((entry) => entry.payload && entry.payload.eventId === eventId);
    return rows(row ? [row] : []);
  }
  insertArchive(params) {
    const payload = params[5] ? JSON.parse(params[5]) : undefined;
    this.archive.push({ seq: Number(params[2]), kind: params[3], content: params[4], payload, created_at: 'now' });
    return rows([]);
  }
}

/** @description Exercise one authenticated D&D route without an HTTP server. */
async function request(pool, method, url, body) {
  const router = createDndRoutes({ pool, appPackageDir: root });
  let output = '';
  const req = { method, url, body, oidc: { user: { sub: 'alice', name: 'Alice' } } };
  const res = {
    statusCode: 0, setHeader() {},
    end(value) { output = String(value || ''); },
  };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(output) };
}

test('archive retries reuse the persisted event and reads preserve legacy rows', async () => {
  const pool = new ArchivePool(), payload = rollPayload('turn:camp-1:7:bram:action');
  const first = await request(pool, 'POST', '/archive', {
    campaignId: 'camp-1', kind: 'combat', content: 'Bram hits.', payload,
  });
  const retried = await request(pool, 'POST', '/archive', {
    campaignId: 'camp-1', kind: 'combat', content: 'A retry must not overwrite.', payload,
  });
  assert.deepEqual(first.body.entry.payload, payload);
  assert.deepEqual(retried.body.entry, first.body.entry);
  assert.equal(pool.archive.length, 2);
  const history = await request(pool, 'GET', '/archive?campaignId=camp-1');
  assert.equal('payload' in history.body.archive[0], false);
  assert.deepEqual(history.body.archive[1].payload, payload);
  const sync = await request(pool, 'GET', '/sync?campaignId=camp-1&rev=3&seq=1&sheetsRev=none');
  assert.deepEqual(sync.body.archiveTail[0].payload, payload);
});

test('malformed dice are rejected before an archive insert', async () => {
  const pool = new ArchivePool(), payload = rollPayload('turn:camp-1:8:bram:action');
  payload.rolls[0].total = 99;
  const result = await request(pool, 'POST', '/archive', {
    campaignId: 'camp-1', kind: 'combat', content: 'Impossible total.', payload,
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_ROLL_PAYLOAD');
  assert.equal(result.body.field, 'payload');
  assert.equal(pool.archive.length, 1);
});

test('a delayed archive request cannot repopulate an abandoned rewind branch', async () => {
  const pool = new ArchivePool();
  const accepted = await request(pool, 'POST', '/archive', {
    campaignId: 'camp-1', timelineId: 'opening-gate-1', kind: 'combat',
    content: 'Bram attacks before the rewind.', payload: rollPayload('old-branch-roll'),
  });
  assert.equal(accepted.body.ok, true); assert.equal(pool.archive.length, 2);
  pool.timelineId = 'rewind-gate-2';
  const stale = await request(pool, 'POST', '/archive', {
    campaignId: 'camp-1', timelineId: 'opening-gate-1', kind: 'combat',
    content: 'This response arrived after rewind.', payload: rollPayload('late-old-branch-roll'),
  });
  assert.equal(stale.body.ok, false); assert.equal(stale.body.code, 'STALE_TIMELINE');
  assert.equal(pool.archive.length, 2);
});

test('the package installs the idempotent bounded roll-event migration', () => {
  const manifest = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'migrations', '005-roll-events.sql'), 'utf8');
  assert.match(manifest, /migrations\/005-roll-events\.sql/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS payload jsonb/);
  assert.match(migration, /jsonb_array_length\(payload->'rolls'\) BETWEEN 1 AND 64/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_dnd_archive_roll_event/);
});
