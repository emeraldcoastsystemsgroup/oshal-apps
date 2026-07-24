/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 18:42:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Force concurrent archive and quest-advance requests through transaction-aware locks, proving unique story sequence numbers and exactly-once scene XP.
 * 2026-07-22 01:16:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove final advancement archives the retained campaign exactly with its terminal board.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes.js');

const clone = (value) => JSON.parse(JSON.stringify(value));

/** A tiny fair async mutex used to emulate PostgreSQL row/advisory locks. */
class SerialLock {
  constructor() { this.tail = Promise.resolve(); }
  async acquire() {
    const previous = this.tail;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    this.tail = previous.then(() => held);
    await previous;
    return release;
  }
}

/** Transaction-aware pg.Pool double for the two durability contracts. */
class DurablePool {
  constructor(sceneId) {
    this.state = {
      adventureId: 'goblin-ambush', sceneId: sceneId || 'the-ravine', mode: 'resolved',
      round: 4, turnIndex: 0, turnSerial: 12, order: [], tokens: [],
    };
    this.rev = 7;
    this.status = 'active';
    this.characters = [{
      character_id: 'char-bram', user_sub: 'host', campaign_id: 'camp-1', slug: 'bram', name: 'Bram',
      xp: 0, level: 1, sheet: { id: 'bram', name: 'Bram', race: 'Human', class: 'Fighter', level: 1, maxHp: 12, ac: 18, speed: 30, actions: [] },
    }];
    this.archiveRows = [];
    this.characterUpdates = 0;
    this.encounterUpdates = 0;
    this.queries = [];
    this.encounterLock = new SerialLock();
    this.archiveLock = new SerialLock();
  }

  rows(rows) { return { rowCount: rows.length, rows }; }

  /** Pool-level reads happen outside the explicit transactions. */
  async query(sql, params) {
    this.queries.push({ source: 'pool', sql, params });
    if (/SELECT c\.\*,/.test(sql)) {
      return this.rows([{ campaign_id: 'camp-1', user_sub: 'host', is_owner: true }]);
    }
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) {
      return this.rows(this.characters.map((row) => ({ slug: row.slug, sheet: clone(row.sheet) })));
    }
    throw new Error('Unexpected pool SQL in durability test: ' + sql);
  }

  async connect() { return new DurableClient(this); }
}

class DurableClient {
  constructor(pool) {
    this.pool = pool;
    this.inTransaction = false;
    this.releaseEncounter = null;
    this.releaseArchive = null;
  }

  rows(rows) { return this.pool.rows(rows); }

  async query(sql, params) {
    this.pool.queries.push({ source: 'client', sql, params });
    if (sql === 'BEGIN') { this.inTransaction = true; return this.rows([]); }
    if (sql === 'COMMIT') { this.finish(); return this.rows([]); }
    if (sql === 'ROLLBACK') { this.finish(); return this.rows([]); }
    if (/pg_advisory_xact_lock/.test(sql)) {
      if (!this.releaseArchive) this.releaseArchive = await this.pool.archiveLock.acquire();
      return this.rows([{ pg_advisory_xact_lock: null }]);
    }
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) {
      if (/FOR UPDATE/.test(sql) && !this.releaseEncounter) this.releaseEncounter = await this.pool.encounterLock.acquire();
      return this.rows([{ state: clone(this.pool.state), rev: this.pool.rev }]);
    }
    if (/SELECT \* FROM dnd_characters/.test(sql)) {
      return this.rows(this.pool.characters.map(clone));
    }
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1 AS n FROM dnd_archive/.test(sql)) {
      // Yield once so an implementation missing the advisory lock deterministically races.
      await new Promise((resolve) => setImmediate(resolve));
      const max = this.pool.archiveRows.reduce((n, row) => Math.max(n, row.seq), 0);
      return this.rows([{ n: max + 1 }]);
    }
    if (/INSERT INTO dnd_archive/.test(sql)) {
      this.pool.archiveRows.push({ seq: Number(params[2]), kind: params[3], content: params[4] });
      return this.rows([]);
    }
    if (/UPDATE dnd_characters SET xp=/.test(sql)) {
      const row = this.pool.characters.find((candidate) => candidate.character_id === params[3]);
      row.xp = Number(params[0]); row.level = Number(params[1]); row.sheet = JSON.parse(params[2]);
      this.pool.characterUpdates++;
      return this.rows([]);
    }
    if (/UPDATE dnd_encounters SET state=/.test(sql)) {
      this.pool.state = JSON.parse(params[0]); this.pool.rev++; this.pool.encounterUpdates++;
      return this.rows([{ rev: this.pool.rev }]);
    }
    if (/UPDATE dnd_campaigns SET updated_at=now\(\), status='archived'/.test(sql)) {
      this.pool.status = 'archived'; return this.rows([]);
    }
    throw new Error('Unexpected client SQL in durability test: ' + sql);
  }

  finish() {
    if (this.releaseArchive) { this.releaseArchive(); this.releaseArchive = null; }
    if (this.releaseEncounter) { this.releaseEncounter(); this.releaseEncounter = null; }
    this.inTransaction = false;
  }

  release() { this.finish(); }
}

/** Invoke the package route without starting an HTTP server. */
async function request(pool, method, url, body) {
  const router = createDndRoutes({ pool, appPackageDir: path.join(__dirname, '..') });
  let payload = null;
  const req = { method, url, body, oidc: { user: { sub: 'host', name: 'Host' } } };
  const res = { statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { payload = value; } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

test('concurrent story posts allocate distinct per-campaign archive sequences', async () => {
  const pool = new DurablePool();
  const [opening, initiative] = await Promise.all([
    request(pool, 'POST', '/archive', { campaignId: 'camp-1', kind: 'narration', content: 'The road bends through old pines.' }),
    request(pool, 'POST', '/archive', { campaignId: 'camp-1', kind: 'milestone', content: 'Initiative!' }),
  ]);
  assert.equal(opening.body.ok, true);
  assert.equal(initiative.body.ok, true);
  assert.deepEqual(pool.archiveRows.map((row) => row.seq), [1, 2]);
  assert.deepEqual(new Set([opening.body.entry.seq, initiative.body.entry.seq]).size, 2);
  assert.equal(pool.queries.filter((query) => /pg_advisory_xact_lock/.test(query.sql)).length, 2);
  assert.equal(pool.queries.filter((query) => query.sql === 'COMMIT').length, 2);
});

test('concurrent final-scene advances award XP once and reload as an idempotent completion', async () => {
  const pool = new DurablePool('the-ravine');
  const [first, second] = await Promise.all([
    request(pool, 'POST', '/advance', { campaignId: 'camp-1' }),
    request(pool, 'POST', '/advance', { campaignId: 'camp-1' }),
  ]);
  assert.equal(first.body.ok, true);
  assert.equal(second.body.ok, true);
  assert.equal(first.body.done, true);
  assert.equal(second.body.done, true);
  assert.deepEqual([first.body.alreadyAdvanced, second.body.alreadyAdvanced].sort(), [false, true]);
  assert.equal(pool.characters[0].xp, 550);
  assert.equal(pool.characterUpdates, 1);
  assert.equal(pool.encounterUpdates, 1);
  assert.equal(pool.archiveRows.filter((row) => row.kind === 'level-up').length, 1);
  assert.equal(pool.state.mode, 'complete');
  assert.equal(pool.status, 'archived');
  assert.deepEqual(pool.state.progression.awardedScenes, ['the-ravine']);
  assert.equal(pool.state.progression.lastAdvance.done, true);

  const reload = await request(pool, 'POST', '/advance', { campaignId: 'camp-1' });
  assert.equal(reload.body.ok, true);
  assert.equal(reload.body.done, true);
  assert.equal(reload.body.alreadyAdvanced, true);
  assert.equal(pool.characters[0].xp, 550);
  assert.equal(pool.characterUpdates, 1);
  assert.equal(pool.archiveRows.length, 1);
});

test('non-final advance replay returns the next scene without a second award', async () => {
  const pool = new DurablePool('coast-road');
  const first = await request(pool, 'POST', '/advance', { campaignId: 'camp-1' });
  const replay = await request(pool, 'POST', '/advance', { campaignId: 'camp-1' });
  assert.equal(first.body.ok, true);
  assert.equal(first.body.done, false);
  assert.equal(first.body.sceneId, 'the-ravine');
  assert.equal(replay.body.ok, true);
  assert.equal(replay.body.alreadyAdvanced, true);
  assert.equal(replay.body.sceneId, 'the-ravine');
  assert.equal(pool.characters[0].xp, 1200);
  assert.equal(pool.characterUpdates, 1);
  assert.equal(pool.encounterUpdates, 1);
  assert.deepEqual(pool.archiveRows.map((row) => row.seq), [1, 2]);
  assert.deepEqual(pool.archiveRows.map((row) => row.kind), ['level-up', 'milestone']);
  assert.deepEqual(pool.state.progression.awardedScenes, ['coast-road']);
});
