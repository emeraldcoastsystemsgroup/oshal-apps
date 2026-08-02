/**
 * Saved-responses playlist contract (operator request 2026-07-24: "save his responses" + an
 * "easy to click response play list"). Runs on plain Node against the COMPILED routes/ artifact
 * (the runtime loads routes/, never src-routes/), with the kernel @/ aliases shimmed and a
 * scripted in-memory pool, so the carved app repo can validate save→list→replay, the dedupe
 * rule, and the unpinned cap without the OSHAL kernel test runner.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

// ── Shim the kernel @/ aliases the compiled engine requires ─────────────────
const origLoad = Module._load;
Module._load = function shimmedLoad(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/shared/services/database') {
    return { buildOwnerRlsPolicyStatements: (table) => [`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`] };
  }
  return origLoad.call(this, request, ...rest);
};

const storePath = path.resolve(__dirname, '..', 'routes', 'pumpkin-engine-response-store.js');
const {
  PumpkinResponseService,
  normalizeSavedResponse,
  responseDedupeKey,
  MAX_SAVED_SAY,
  MAX_UNPINNED_RESPONSES,
} = require(storePath);

// ── Scripted in-memory pool implementing exactly the store's SQL shapes ─────
function fakePool() {
  const rows = [];
  let seq = 0;
  const now = () => new Date(Date.now() + ++seq).toISOString(); // strictly monotonic recency
  return {
    rows,
    async query(sql, params = []) {
      const s = String(sql);
      if (/CREATE TABLE|CREATE UNIQUE INDEX|ALTER TABLE|DO \$\$/i.test(s)) return { rows: [] };
      if (/^INSERT INTO pumpkin_responses/i.test(s.trim())) {
        const [userSub, say, expression, intensity, source] = params;
        const key = responseDedupeKey(say);
        const existing = rows.find((r) => r.user_sub === userSub && responseDedupeKey(r.say) === key);
        if (existing) {
          Object.assign(existing, { expression, intensity, source, updated_at: now() });
          return { rows: [existing] };
        }
        const row = {
          id: `id-${rows.length + 1}`, user_sub: userSub, say, expression, intensity, source,
          pinned: false, play_count: 0, last_played_at: null, created_at: now(), updated_at: now(),
        };
        row.updated_at = row.created_at;
        rows.push(row);
        return { rows: [row] };
      }
      if (/DELETE FROM pumpkin_responses WHERE id IN/i.test(s)) {
        const [userSub, keep] = params;
        const unpinned = rows
          .filter((r) => r.user_sub === userSub && !r.pinned)
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
        const doomed = new Set(unpinned.slice(Number(keep)).map((r) => r.id));
        for (let i = rows.length - 1; i >= 0; i--) if (doomed.has(rows[i].id)) rows.splice(i, 1);
        return { rowCount: doomed.size, rows: [] };
      }
      if (/SELECT \* FROM pumpkin_responses WHERE user_sub = \$1 AND id = \$2/i.test(s)) {
        const [userSub, id] = params;
        return { rows: rows.filter((r) => r.user_sub === userSub && r.id === id) };
      }
      if (/SELECT \* FROM pumpkin_responses WHERE user_sub = \$1/i.test(s)) {
        const [userSub] = params;
        const out = rows
          .filter((r) => r.user_sub === userSub)
          .sort((a, b) => (a.pinned === b.pinned ? (a.updated_at < b.updated_at ? 1 : -1) : a.pinned ? -1 : 1))
          .slice(0, 100);
        return { rows: out };
      }
      if (/UPDATE pumpkin_responses SET pinned/i.test(s)) {
        const [userSub, id, pinned] = params;
        const row = rows.find((r) => r.user_sub === userSub && r.id === id);
        if (!row) return { rows: [] };
        Object.assign(row, { pinned, updated_at: now() });
        return { rows: [row] };
      }
      if (/UPDATE pumpkin_responses SET play_count/i.test(s)) {
        const [userSub, id] = params;
        const row = rows.find((r) => r.user_sub === userSub && r.id === id);
        if (row) { row.play_count += 1; row.last_played_at = now(); }
        return { rows: [] };
      }
      if (/DELETE FROM pumpkin_responses WHERE user_sub = \$1 AND id = \$2/i.test(s)) {
        const [userSub, id] = params;
        const i = rows.findIndex((r) => r.user_sub === userSub && r.id === id);
        if (i < 0) return { rowCount: 0, rows: [] };
        rows.splice(i, 1);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`fakePool: unrecognized SQL — ${s.slice(0, 120)}`);
    },
  };
}

test('normalizeSavedResponse clamps, allowlists, and caps', () => {
  assert.equal(normalizeSavedResponse({}), null);
  assert.equal(normalizeSavedResponse({ say: '   ' }), null);
  const n = normalizeSavedResponse({ say: '  Boo!\n\nDid  I get you? ', expression: 'evil-grin', intensity: 7, source: 'hacker' });
  assert.equal(n.say, 'Boo! Did I get you?');
  assert.equal(n.expression, 'neutral'); // off-allowlist falls back
  assert.equal(n.intensity, 1); // clamped
  assert.equal(n.source, 'manual'); // off-allowlist falls back
  const long = normalizeSavedResponse({ say: 'x'.repeat(1000), source: 'mimic' });
  assert.ok(long.say.length <= MAX_SAVED_SAY);
  assert.equal(long.source, 'mimic');
});

test('save → list → replay round-trip, owner-scoped', async () => {
  const pool = fakePool();
  const svc = new PumpkinResponseService(pool);
  await svc.ensureSchema();
  const a = await svc.record('sub-a', { say: 'Happy Halloween, little goblin!', expression: 'happy', intensity: 0.7, source: 'mimic' });
  await svc.record('sub-a', { say: 'Boo! The candle flickers.', expression: 'spooky', intensity: 0.9, source: 'autonomous' });
  await svc.record('sub-b', { say: 'Another porch, another pumpkin.', source: 'mimic' });

  const listA = await svc.list('sub-a');
  assert.equal(listA.length, 2);
  assert.equal(listA[0].say, 'Boo! The candle flickers.'); // most recent first
  assert.equal((await svc.list('sub-b')).length, 1); // never sees sub-a's lines

  // Replay path: get by id, then mark played.
  const fetched = await svc.get('sub-a', a.id);
  assert.equal(fetched.say, 'Happy Halloween, little goblin!');
  await svc.markPlayed('sub-a', a.id);
  const replayed = await svc.get('sub-a', a.id);
  assert.equal(replayed.playCount, 1);
  assert.ok(replayed.lastPlayedAt);
  assert.equal(await svc.get('sub-b', a.id), null); // cross-user id is invisible
});

test('dedupe: same line (case-insensitive) refreshes the row instead of duplicating', async () => {
  const pool = fakePool();
  const svc = new PumpkinResponseService(pool);
  await svc.record('sub-a', { say: 'Trick or treat!', expression: 'happy', intensity: 0.5, source: 'mimic' });
  await svc.record('sub-a', { say: 'TRICK OR TREAT!', expression: 'mischief', intensity: 0.8, source: 'autonomous' });
  const list = await svc.list('sub-a');
  assert.equal(list.length, 1);
  assert.equal(list[0].expression, 'mischief'); // refreshed, not duplicated
});

test('cap: unpinned lines roll off beyond the max; pinned lines survive', async () => {
  const pool = fakePool();
  const svc = new PumpkinResponseService(pool);
  const keeper = await svc.record('sub-a', { say: 'KEEPER line', source: 'mimic' });
  assert.ok(await svc.setPinned('sub-a', keeper.id, true));
  for (let i = 0; i < MAX_UNPINNED_RESPONSES + 5; i++) {
    await svc.record('sub-a', { say: `filler line number ${i}`, source: 'mimic' });
  }
  const list = await svc.list('sub-a');
  const unpinned = list.filter((r) => !r.pinned);
  assert.equal(unpinned.length, MAX_UNPINNED_RESPONSES);
  assert.ok(list.some((r) => r.say === 'KEEPER line' && r.pinned)); // pinned survived the cap
  assert.equal(list[0].say, 'KEEPER line'); // pinned sorts first in the playlist
});

test('pin toggle + delete', async () => {
  const pool = fakePool();
  const svc = new PumpkinResponseService(pool);
  const r = await svc.record('sub-a', { say: 'Fleeting whisper', source: 'autonomous' });
  const pinned = await svc.setPinned('sub-a', r.id, true);
  assert.equal(pinned.pinned, true);
  assert.equal(await svc.setPinned('sub-b', r.id, true), null); // not the owner
  assert.equal(await svc.remove('sub-b', r.id), false);
  assert.equal(await svc.remove('sub-a', r.id), true);
  assert.equal((await svc.list('sub-a')).length, 0);
});
