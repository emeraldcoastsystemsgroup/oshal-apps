/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:04:38 | roger.murphy@emeraldcoastsystemsgroup.com   | Guard host-only snapshot rewind, exact archive cursor restoration, and future-story branch pruning.
 * 2026-07-21 20:14:56 | roger.murphy@emeraldcoastsystemsgroup.com   | Prove rewind restores deleted snapshot heroes, removes later roster additions, and releases claims to abandoned characters.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove rewind replaces snapshotted presentation metadata with a fresh host-leased pending gate in the restore transaction.
 * 2026-07-21 22:48:44 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the timeline SQL test double below the enforced function limit while covering the rewind branch contract.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes.js');

const root = path.join(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => ({ rowCount: value.length, rows: value });

async function request(pool, method, url, body) {
  const router = createDndRoutes({ pool, appPackageDir: root });
  let payload = '';
  const req = { method, url, body, oidc: { user: { sub: 'host', name: 'Host' } } };
  const res = { statusCode: 0, setHeader() {}, end(value) { payload = String(value || ''); } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

class TimelinePool {
  constructor() {
    this.state = { sceneId: 'coast-road', mode: 'exploration', round: 0, turnSerial: 0, tokens: [{ id: 'bram', slug: 'bram', kind: 'pc', hp: 12, maxHp: 12 }] };
    this.state.presentationGate = { id: 'old-opening', kind: 'opening', sceneId: 'coast-road', turnSerial: 0,
      message: 'Old opening.', createdAt: 10, complete: true, lease: 'old-tab', leaseAt: 10, completedAt: 20 };
    this.rev = 5;
    this.characters = [{ slug: 'bram', sheet: { id: 'bram', name: 'Bram', level: 1, maxHp: 12 }, xp: 0, level: 1 }];
    this.players = [{ user_sub: 'guest', character_slug: 'bram' }];
    this.archive = [
      { seq: 1, kind: 'milestone', content: 'The quest begins.' },
      { seq: 2, kind: 'narration', content: 'The party reaches the fork.' },
      { seq: 3, kind: 'narration', content: 'Bram chooses the ravine.' },
    ];
    this.snapshots = [];
    this.deletedFuture = false;
  }
  async connect() { return new TimelineClient(this); }
  async query(sql, params) {
    if (/SELECT c\.\*,/.test(sql)) return rows([{ campaign_id: 'camp-1', user_sub: 'host', is_owner: true }]);
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) return rows(this.characters.map((row) => ({ slug: row.slug, sheet: clone(row.sheet) })));
    throw new Error('Unexpected timeline pool SQL: ' + sql);
  }
}

class TimelineClient {
  constructor(pool) { this.pool = pool; }
  insertSnapshot(params) {
    const snapshot = {
      snapshot_id: 'snap-1', campaign_id: params[0], user_sub: params[1], label: params[2],
      state: JSON.parse(params[3]), sheets: JSON.parse(params[4]), auto: params[5], archive_seq: params[6], created_at: 'now',
    };
    this.pool.snapshots.push(snapshot);
    return rows([{ snapshot_id: snapshot.snapshot_id, label: snapshot.label, auto: snapshot.auto,
      archive_seq: snapshot.archive_seq, created_at: snapshot.created_at }]);
  }
  restoreCharacter(params) {
    const [sheet, xp, level, _campaignId, slug, savedSlugs] = params;
    this.pool.characters = this.pool.characters.filter((candidate) => savedSlugs.includes(candidate.slug));
    let row = this.pool.characters.find((candidate) => candidate.slug === slug);
    if (!row) { row = { slug }; this.pool.characters.push(row); }
    row.sheet = JSON.parse(sheet); row.xp = xp; row.level = level;
    this.pool.players.forEach((player) => {
      if (player.character_slug && !savedSlugs.includes(player.character_slug)) player.character_slug = null;
    });
    return rows([{}]);
  }
  async query(sql, params) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return rows([]);
    if (/pg_advisory_xact_lock/.test(sql)) return rows([{}]);
    if (/SELECT state FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.pool.state) }]);
    if (/SELECT slug, sheet, xp, level FROM dnd_characters/.test(sql)) return rows(this.pool.characters.map(clone));
    if (/SELECT COALESCE\(MAX\(seq\),0\) AS seq FROM dnd_archive/.test(sql)) {
      return rows([{ seq: this.pool.archive.reduce((max, entry) => Math.max(max, entry.seq), 0) }]);
    }
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1 AS n FROM dnd_archive/.test(sql)) {
      return rows([{ n: this.pool.archive.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1 }]);
    }
    if (/INSERT INTO dnd_snapshots/.test(sql)) return this.insertSnapshot(params);
    if (/DELETE FROM dnd_snapshots/.test(sql)) return rows([]);
    if (/SELECT label, state, sheets, archive_seq FROM dnd_snapshots/.test(sql)) {
      const snapshot = this.pool.snapshots.find((row) => row.snapshot_id === params[0] && row.campaign_id === params[1]);
      return rows(snapshot ? [clone(snapshot)] : []);
    }
    if (/UPDATE dnd_encounters SET state=/.test(sql)) {
      this.pool.state = JSON.parse(params[0]); this.pool.rev++;
      return rows([{ rev: this.pool.rev }]);
    }
    if (/UPDATE dnd_characters SET sheet=/.test(sql)) return this.restoreCharacter(params);
    if (/DELETE FROM dnd_archive WHERE campaign_id=\$1 AND seq > \$2/.test(sql)) {
      this.pool.archive = this.pool.archive.filter((entry) => entry.seq <= Number(params[1]));
      this.pool.deletedFuture = true;
      return rows([]);
    }
    if (/INSERT INTO dnd_archive/.test(sql)) {
      this.pool.archive.push({ seq: Number(params[2]), kind: params[3], content: params[4] }); return rows([]);
    }
    if (/UPDATE dnd_campaigns SET updated_at/.test(sql)) return rows([]);
    throw new Error('Unexpected timeline client SQL: ' + sql);
  }
  release() {}
}

test('snapshot rewind restores its board and removes abandoned-future story beats', async () => {
  const pool = new TimelinePool();
  const saved = await request(pool, 'POST', '/snapshot', { campaignId: 'camp-1', label: 'At the fork', auto: false });
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.snapshot.archive_seq, 3);

  pool.state = { ...pool.state, sceneId: 'the-ravine', round: 4 };
  pool.characters = [{ slug: 'late-hero', sheet: { id: 'late-hero', name: 'Late Hero' }, xp: 99, level: 2 }];
  pool.players[0].character_slug = 'late-hero';
  pool.archive.push(
    { seq: 4, kind: 'narration', content: 'A goblin reveals the hidden shrine.' },
    { seq: 5, kind: 'milestone', content: 'The party claims the shrine treasure.' }
  );

  const restored = await request(pool, 'POST', '/restore', { campaignId: 'camp-1', snapshotId: 'snap-1', presenterId: 'presenter-a' });
  assert.equal(restored.body.ok, true);
  assert.equal(restored.body.archiveRewound, true);
  assert.equal(restored.body.archiveSeq, 4);
  assert.equal(restored.body.state.sceneId, 'coast-road');
  assert.equal(restored.body.state.presentationGate.kind, 'rewind');
  assert.equal(restored.body.state.presentationGate.complete, false);
  assert.equal(restored.body.state.presentationGate.lease, 'presenter-a');
  assert.match(restored.body.state.presentationGate.message, /rewind to: At the fork/);
  assert.notEqual(restored.body.state.presentationGate.id, 'old-opening');
  assert.deepEqual(pool.state.presentationGate, restored.body.state.presentationGate);
  assert.equal(pool.deletedFuture, true);
  assert.equal(pool.archive.some((entry) => /hidden shrine|shrine treasure/.test(entry.content)), false);
  assert.deepEqual(pool.archive.map((entry) => entry.seq), [1, 2, 3, 4]);
  assert.match(pool.archive[3].content, /rewind to: At the fork/);
  assert.deepEqual(pool.characters.map((character) => character.slug), ['bram']);
  assert.equal(pool.characters[0].sheet.name, 'Bram');
  assert.equal(pool.players[0].character_slug, null);
});
