/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard continuous board-revision capture, cutaway correlation in playback, sanitized Markdown/HTML/JSON recap export, authorization, and zero-write export behavior.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes.js');
const { captureBoardRevision } = require('../lib/dnd-checkpoint-store.js');
const {
  buildReplayRecap, exportReplayDocument, renderReplayHtml, renderReplayJson, renderReplayMarkdown,
} = require('../lib/dnd-replay-export.js');

const ROOT = path.join(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => ({ rowCount: value.length, rows: value });

/** @description Build a rich playback payload with XSS strings, hidden tokens, rolls, and cutaways. */
function samplePlaybackData() {
  const board = {
    sceneId: 'coast-road', mode: 'combat', round: 2,
    tokens: [
      { id: 'bram', kind: 'pc', name: 'Bram <script>alert(1)</script>', x: 3, y: 4, hp: 10, maxHp: 12, ac: 16, _easeX: 1 },
      { id: 'g1', kind: 'monster', name: 'Secret Assassin', x: 9, y: 2, hp: 7, maxHp: 7, ac: 14, hidden: true },
    ],
  };
  return {
    ok: true, readOnly: true, ended: true, mode: 'complete', rev: 9,
    campaign: { campaign_id: 'camp-9', name: 'Coast <Road> & "Ambush"', adventure_id: 'goblin-ambush', status: 'archived', is_owner: true, join_code: 'SECRET' },
    frames: [
      {
        id: 'archive-1', type: 'archive', seq: 1, archiveSeq: 1, kind: 'milestone',
        content: 'Bram enters <b>the road</b>.', createdAt: '2026-11-25T10:00:00Z',
        fidelity: 'exact-board', fidelityNote: 'Exact board revision captured alongside this story beat.', board,
      },
      {
        id: 'archive-2', type: 'archive', seq: 2, archiveSeq: 2, kind: 'combat',
        content: 'Critical strike on the ambush leader.', createdAt: '2026-11-25T10:01:00Z',
        fidelity: 'archive-only', fidelityNote: 'No exact board revision was captured; token positions are not reconstructed.', board: null,
        payload: { v: 1, eventId: 'r-2', rolls: [{ kind: 'attack', actorName: 'Bram', actionName: 'Longsword', targetName: 'Goblin', dice: '1d20', faces: [20], bonus: 5, total: 25, outcome: 'critical' }] },
      },
      {
        id: 'archive-3', type: 'archive', seq: 3, archiveSeq: 3, kind: 'cutaway',
        content: '/api/dnd/cutaway/camp-9/scene-1.png', createdAt: '2026-11-25T10:02:00Z',
        fidelity: 'exact-board', fidelityNote: 'Exact board revision captured alongside this story beat.', board,
        cutaway: { url: '/api/dnd/cutaway/camp-9/scene-1.png', title: 'combat cutaway', caption: 'Torchlit ambush <img src=x onerror=alert(1)>', kind: 'cutaway', key: 'scene-1', archiveSeq: 3 },
      },
      {
        id: 'archive-4', type: 'archive', seq: 4, archiveSeq: 4, kind: 'cutaway',
        content: 'javascript:alert(1)', createdAt: '2026-11-25T10:03:00Z',
        fidelity: 'archive-only', fidelityNote: 'Log only.', board: null,
        cutaway: { url: 'javascript:alert(1)', title: 'bad', caption: 'unsafe scheme', kind: 'cutaway', key: 'bad', archiveSeq: 4 },
      },
    ],
  };
}

/** @description Invoke one authenticated GET request against the real D&D router. */
async function getRoute(pool, sub, url) {
  const router = createDndRoutes({ pool, appPackageDir: ROOT });
  const headers = {};
  let body = '';
  const req = { method: 'GET', url, oidc: { user: { sub, name: sub } } };
  const res = {
    statusCode: 0,
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(value) { body = String(value || ''); },
  };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, headers, body };
}

/** @description Read-only pool double holding exact revisions, legacy beats, cutaways, and manual saves. */
class ReplayExportPool {
  constructor() {
    this.queries = [];
    this.board1 = {
      sceneId: 'coast-road', mode: 'combat', round: 1,
      tokens: [
        { id: 'bram', kind: 'pc', name: 'Bram', x: 2, y: 3, hp: 12, maxHp: 12, ac: 16, _easeX: 4 },
        { id: 'g1', kind: 'monster', name: 'Hidden Scout', x: 10, y: 4, hp: 7, maxHp: 7, ac: 13, hidden: true },
      ],
    };
    this.board2 = { ...clone(this.board1), round: 2, tokens: [{ ...this.board1.tokens[0], x: 4, hp: 9 }, this.board1.tokens[1]] };
    this.archive = [
      { seq: 1, kind: 'milestone', content: 'A new campaign begins: Coast Road.', payload: null, created_at: '2026-11-25T10:00:00Z' },
      { seq: 2, kind: 'combat', content: 'Legacy uncaptured skirmish beat.', payload: null, created_at: '2026-11-25T10:01:00Z' },
      { seq: 3, kind: 'cutaway', content: '/api/dnd/cutaway/camp-1/hero-1.png', payload: null, created_at: '2026-11-25T10:02:00Z' },
    ];
    this.snapshots = [
      { snapshot_id: 'rev-1', label: 'rev:start:coast-road:r1', state: clone(this.board1), auto: true, archive_seq: 1, created_at: '2026-11-25T10:00:01Z' },
      { snapshot_id: 'rev-prior', label: 'rev:state:coast-road:r9', state: clone(this.board2), auto: true, archive_seq: 2, created_at: '2026-11-25T10:00:30Z' },
      { snapshot_id: 'rev-3', label: 'rev:beat:coast-road:r2', state: clone(this.board2), auto: true, archive_seq: 3, created_at: '2026-11-25T10:02:01Z' },
      { snapshot_id: 'snap-manual', label: 'Before the bridge', state: clone(this.board2), auto: false, archive_seq: 3, created_at: '2026-11-25T10:02:30Z' },
    ];
    this.sheets = [{ slug: 'bram', sheet: { id: 'bram', name: 'Bram', race: 'Human', class: 'Fighter', level: 1, maxHp: 12, ac: 16 } }];
  }

  async query(sql, params) {
    this.queries.push({ sql, params });
    if (/SELECT c\.\*,/.test(sql)) {
      if (!['host', 'guest'].includes(params[1])) return rows([]);
      return rows([{ campaign_id: 'camp-1', user_sub: 'host', name: 'Coast Road Legend', adventure_id: 'goblin-ambush', status: 'archived', join_code: 'ABC123', created_at: '2026-11-25T09:59:00Z', updated_at: '2026-11-25T10:03:00Z', is_owner: params[1] === 'host' }]);
    }
    if (/SELECT state, rev, updated_at FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.board2), rev: 7, updated_at: '2026-11-25T10:03:00Z' }]);
    if (/SELECT snapshot_id, label, auto, archive_seq, created_at FROM dnd_snapshots/.test(sql)) {
      const visible = /NOT LIKE 'rev:%'/.test(sql) ? this.snapshots.filter((s) => !s.label.startsWith('rev:')) : this.snapshots;
      return rows(visible.map(clone));
    }
    if (/SELECT snapshot_id, label, state, auto, archive_seq, created_at FROM dnd_snapshots/.test(sql)) return rows(this.snapshots.map(clone));
    if (/SELECT seq, kind, content, payload, created_at FROM dnd_archive/.test(sql)) return rows(this.archive.map(clone));
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) return rows(this.sheets.map(clone));
    throw new Error('Unexpected replay-export SQL: ' + sql);
  }
}

test('buildReplayRecap and renderers sanitize HTML, reject unsafe URLs, and strip hidden tokens', () => {
  const recap = buildReplayRecap(samplePlaybackData(), {
    adventure: { id: 'goblin-ambush', title: 'Ambush on the Coast Road', scenes: [{ id: 'coast-road', title: 'The Coast Road' }] },
    sheets: { bram: { name: 'Bram <script>alert(1)</script>', race: 'Human', class: 'Fighter', level: 2, maxHp: 20, ac: 16 } },
    exportedAt: '2026-11-25T12:00:00.000Z',
  });
  assert.equal(recap.schemaVersion, 1);
  assert.equal(recap.readOnly, true);
  assert.equal('join_code' in recap.campaign, false);
  assert.equal(recap.stats.exactBoardFrames, 2);
  assert.equal(recap.stats.archiveOnlyFrames, 2);
  assert.equal(recap.stats.cutawayCount, 1);
  assert.equal(recap.stats.rollCount, 1);
  assert.equal(recap.cutaways[0].url, '/api/dnd/cutaway/camp-9/scene-1.png');
  assert.equal(recap.finalBoard.tokens.some((t) => /Secret Assassin/.test(t.name)), false);

  const md = renderReplayMarkdown(recap);
  assert.match(md, /# Coast <Road> & "Ambush" — Campaign Recap/);
  assert.match(md, /## Party/);
  assert.match(md, /\/api\/dnd\/cutaway\/camp-9\/scene-1\.png/);
  assert.doesNotMatch(md, /javascript:alert/);

  const html = renderReplayHtml(recap);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /javascript:alert/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\/api\/dnd\/cutaway\/camp-9\/scene-1\.png/);

  const parsed = JSON.parse(renderReplayJson(recap));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.readOnly, true);
  assert.equal(exportReplayDocument(samplePlaybackData(), 'xml').code, 'INVALID_FORMAT');
});

test('captureBoardRevision deduplicates identical consecutive states and tracks archive_seq', async () => {
  const inserted = [];
  const db = {
    async query(sql, params) {
      if (/SELECT COALESCE\(MAX\(seq\),0\) AS seq/.test(sql)) return rows([{ seq: 4 }]);
      if (/SELECT snapshot_id, label, state, archive_seq, created_at FROM dnd_snapshots/.test(sql)) {
        return rows(inserted.length ? [inserted[inserted.length - 1]] : []);
      }
      if (/INSERT INTO dnd_snapshots/.test(sql)) {
        const row = { snapshot_id: `rev-${inserted.length + 1}`, label: params[2], state: JSON.parse(params[3]), auto: params[5], archive_seq: params[6], created_at: 'now' };
        inserted.push(row);
        return rows([row]);
      }
      throw new Error('Unexpected revision SQL: ' + sql);
    },
  };
  const stateA = { sceneId: 'coast-road', mode: 'combat', round: 1, cutaway: { url: 'drop-me' }, tokens: [{ id: 'bram', x: 2, y: 2 }] };
  const first = await captureBoardRevision(db, 'host', 'camp-1', stateA, 'state');
  const dup = await captureBoardRevision(db, 'host', 'camp-1', stateA, 'state');
  const nextBeat = await captureBoardRevision(db, 'host', 'camp-1', stateA, 'beat', 5);
  const moved = await captureBoardRevision(db, 'host', 'camp-1', { ...stateA, tokens: [{ id: 'bram', x: 4, y: 2 }] }, 'state', 5);
  assert.equal(first.deduped, undefined);
  assert.equal(dup.deduped, true);
  assert.equal(nextBeat.deduped, undefined);
  assert.equal(moved.deduped, undefined);
  assert.equal(inserted.length, 3);
  assert.equal('cutaway' in inserted[0].state, false);
  assert.ok(inserted.every((row) => row.label.startsWith('rev:')));
});

test('playback attaches current board revisions and cutaway links while preserving honest legacy gaps and clean save listings', async () => {
  const pool = new ReplayExportPool();
  const pb = await getRoute(pool, 'host', '/playback?campaignId=camp-1');
  assert.equal(pb.status, 200);
  const data = JSON.parse(pb.body);
  const seq1 = data.frames.find((frame) => frame.id === 'archive-1');
  const seq2 = data.frames.find((frame) => frame.id === 'archive-2');
  const seq3 = data.frames.find((frame) => frame.id === 'archive-3');
  assert.equal(seq1.fidelity, 'exact-board');
  assert.equal(seq1.boardRevisionId, 'rev-1');
  assert.equal(seq2.fidelity, 'archive-only', 'prior-branch rev must never attach to current archive beat');
  assert.equal(seq2.board, null);
  assert.equal(seq3.fidelity, 'exact-board');
  assert.equal(seq3.cutaway.url, '/api/dnd/cutaway/camp-1/hero-1.png');
  assert.equal(data.cutaways.length, 1);
  assert.equal(data.coverage.cutaways, 1);
  assert.equal(data.coverage.archiveOnlyEntries, 1);

  const snaps = await getRoute(pool, 'host', '/snapshots?campaignId=camp-1');
  assert.equal(snaps.status, 200);
  const snapList = JSON.parse(snaps.body).snapshots;
  assert.deepEqual(snapList.map((s) => s.snapshot_id), ['snap-manual']);
});

test('GET /replay-export serves md/html/json read-only, strips hidden tokens for non-owners, and rejects bad formats or outsiders', async () => {
  const pool = new ReplayExportPool();
  const md = await getRoute(pool, 'host', '/replay-export?campaignId=camp-1&format=md');
  assert.equal(md.status, 200);
  assert.equal(md.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.match(md.headers['content-disposition'], /attachment; filename="coast-road-legend-recap\.md"/);
  assert.equal(md.headers['cache-control'], 'private, no-store');
  assert.match(md.body, /Coast Road Legend — Campaign Recap/);

  const html = await getRoute(pool, 'host', '/replay-export?campaignId=camp-1&format=html');
  assert.equal(html.status, 200);
  assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
  assert.doesNotMatch(html.body, /<script/i);
  assert.match(html.body, /\/api\/dnd\/cutaway\/camp-1\/hero-1\.png/);

  const guestJson = await getRoute(pool, 'guest', '/replay-export?campaignId=camp-1&format=json');
  assert.equal(guestJson.status, 200);
  assert.equal(guestJson.headers['content-type'], 'application/json; charset=utf-8');
  assert.doesNotMatch(guestJson.body, /Hidden Scout|_easeX|ABC123/);

  const badFmt = await getRoute(pool, 'host', '/replay-export?campaignId=camp-1&format=pdf');
  assert.equal(badFmt.status, 400);
  assert.equal(JSON.parse(badFmt.body).code, 'INVALID_FORMAT');

  const outsider = await getRoute(pool, 'outsider', '/replay-export?campaignId=camp-1&format=md');
  assert.equal(outsider.status, 403);
  assert.equal(JSON.parse(outsider.body).code, 'NO_ACCESS');
  assert.equal(pool.queries.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)), false);
});
