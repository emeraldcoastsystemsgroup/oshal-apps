/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 23:15:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #11 guard: the hall-of-fame read is CALLER-SCOPED (the sub is bound into the query — owner or seated member only, never a global read), reads only ENDED games' non-host seats with a real score, orders best-first, and maps rows into the shape the lobby renders. The scoping assertions inspect the one parameterized query the service issues — the security property is that $1 is the caller and appears in both the owner and the member arm.
 */

'use strict';

const { createRoomService } = require('../lib/room-service');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

async function main() {
  const calls = [];
  const rows = [
    { display_name: '🤖 Nova', team: null, score: 4200, show_id: 'whammy', updated_at: '2026-07-30T01:00:00Z' },
    { display_name: 'Ana', team: 'A', score: 180, show_id: 'family-feud', updated_at: '2026-07-29T01:00:00Z' },
  ];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: rows.length, rows }; } };
  const room = createRoomService({ pool });

  const result = await room.leaderboard('me-sub');
  check(result.ok === true, 'the read succeeds');
  check(calls.length === 1, 'exactly one query is issued');

  const sql = calls[0].sql;
  // Caller scoping is the security property: the ONLY parameter is the caller,
  // and it gates BOTH arms (rooms I own, rooms I sat in). A query that drops
  // either arm or binds anything else would leak other tables' games.
  check(calls[0].params.length === 1 && calls[0].params[0] === 'me-sub', 'the caller sub is the only bound parameter');
  check(/r\.user_sub\s*=\s*\$1/.test(sql), 'the owner arm is bound to the caller');
  check(/m\.user_sub\s*=\s*\$1/.test(sql), 'the member arm is bound to the caller');
  check(/status\s*=\s*'ended'/.test(sql), 'only ENDED games are read (live scores stay in state jsonb)');
  check(/role\s*<>\s*'host'/.test(sql), 'host seats never chart');
  check(/score\s*>\s*0/.test(sql), 'zero scores are noise, not fame');
  check(/ORDER BY s\.score DESC/.test(sql), 'best first');
  check(/LIMIT 10/.test(sql), 'the panel is a top list, not a dump');

  // Row mapping: the lobby renders exactly this shape.
  check(result.entries.length === 2, 'every row maps to an entry');
  check(result.entries[0].name === '🤖 Nova' && result.entries[0].score === 4200 && result.entries[0].showId === 'whammy',
    'an NPC champion maps with name/score/show intact');
  check(result.entries[1].team === 'A' && result.entries[1].endedAt === '2026-07-29T01:00:00Z',
    'team and end date travel to the panel');

  if (failures) { console.error(`\n✗ ${failures}/${checks} leaderboard checks failed`); process.exit(1); }
  console.log(`✓ Hall of fame holds — ${checks} checks green (caller-scoped read, ended games only, lobby shape)`);
}

main().catch((error) => { console.error('✗ leaderboard suite crashed:', error); process.exit(1); });
