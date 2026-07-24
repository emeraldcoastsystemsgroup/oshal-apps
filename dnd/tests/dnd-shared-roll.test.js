/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:04:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard server-authoritative shared-roll authorization, idempotence, persistence, resolution, and narration handoff.
 * 2026-07-21 20:10:45 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract the shared-roll lifecycle phases into focused test helpers below the repository function-size limit.
 * 2026-07-21 22:09:29 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove shared rolls cannot mutate the table during a pending Dungeon Master presentation.
 * 2026-07-22 00:50:36 | roger.murphy@emeraldcoastsystemsgroup.com  | Model timeline-guarded story archives in the transactional shared-roll database double.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes.js');

const root = path.join(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => ({ rowCount: value.length, rows: value });

async function request(pool, sub, method, url, body, extra) {
  const router = createDndRoutes({ pool, appPackageDir: root, dndRollD20: () => 10, ...(extra || {}) });
  let payload = '';
  const req = { method, url, body, oidc: { user: { sub, name: sub } } };
  const res = { statusCode: 0, setHeader() {}, end(value) { payload = String(value || ''); } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

class SharedRollPool {
  constructor() {
    this.campaign = { campaign_id: 'camp-1', user_sub: 'host', name: 'Road', adventure_id: 'goblin-ambush', status: 'active', join_code: 'ABC123', is_owner: false };
    this.players = [
      { user_sub: 'fenwick-user', display_name: 'Faye', character_slug: 'fenwick' },
      { user_sub: 'bram-user', display_name: 'Ben', character_slug: 'bram' },
    ];
    this.characters = [
      { slug: 'fenwick', name: 'Fenwick', level: 1, sheet: { id: 'fenwick', name: 'Fenwick', race: 'Elf', class: 'Wizard', level: 1, maxHp: 8, ac: 12, mods: { wis: 2 }, actions: [{ name: 'Fire Bolt', mode: 'attack', toHit: 5 }] } },
      { slug: 'bram', name: 'Bram', level: 1, sheet: { id: 'bram', name: 'Bram', race: 'Human', class: 'Fighter', level: 1, maxHp: 12, ac: 18, mods: { wis: 0 }, actions: [{ name: 'Sword', mode: 'attack', toHit: 4 }] } },
    ];
    this.state = {
      adventureId: 'goblin-ambush', sceneId: 'coast-road', mode: 'exploration', round: 0, order: [], turnIndex: 0,
      tokens: [
        { id: 'fenwick', slug: 'fenwick', kind: 'pc', name: 'Fenwick', x: 2, y: 2, hp: 8, maxHp: 8, ac: 12 },
        { id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', x: 1, y: 2, hp: 12, maxHp: 12, ac: 18 },
      ],
    };
    this.rev = 1;
    this.archive = [];
    this.updates = 0;
  }

  mayAccess(sub) { return sub === 'host' || this.players.some((player) => player.user_sub === sub); }
  async connect() { return new SharedRollClient(this); }

  async query(sql, params) {
    if (/SELECT c\.\*,/.test(sql)) {
      if (!this.mayAccess(params[1])) return rows([]);
      return rows([{ ...this.campaign, is_owner: params[1] === 'host' }]);
    }
    if (/SELECT slug, name, sheet, level FROM dnd_characters/.test(sql)) return rows(this.characters.map(clone));
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.state), rev: this.rev }]);
    if (/SELECT state FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.state) }]);
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return rows(this.players.map(clone));
    if (/SELECT user_sub, character_slug FROM dnd_players/.test(sql)) return rows(this.players.map(clone));
    throw new Error('Unexpected shared-roll pool SQL: ' + sql);
  }
}

class SharedRollClient {
  constructor(pool) { this.pool = pool; }
  async query(sql, params) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return rows([]);
    if (/pg_advisory_xact_lock/.test(sql)) return rows([{}]);
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1 AS n FROM dnd_archive/.test(sql)) return rows([{ n: this.pool.archive.length + 1 }]);
    if (/INSERT INTO dnd_archive/.test(sql)) {
      this.pool.archive.push({ seq: Number(params[2]), kind: params[3], content: params[4] }); return rows([]);
    }
    if (/SELECT c\.user_sub/.test(sql) && /FROM dnd_campaigns c/.test(sql)) {
      if (!this.pool.mayAccess(params[1])) return rows([]);
      return rows([{ user_sub: 'host', is_owner: params[1] === 'host' }]);
    }
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.pool.state), rev: this.pool.rev }]);
    if (/SELECT state FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.pool.state) }]);
    if (/SELECT user_sub, character_slug FROM dnd_players/.test(sql)) return rows(this.pool.players.map(clone));
    if (/SELECT sheet FROM dnd_characters/.test(sql)) {
      const character = this.pool.characters.find((row) => row.slug === params[1]);
      return rows(character ? [{ sheet: clone(character.sheet) }] : []);
    }
    if (/UPDATE dnd_encounters SET state=/.test(sql)) {
      this.pool.state = JSON.parse(params[0]); this.pool.rev++; this.pool.updates++;
      return rows([{ rev: this.pool.rev }]);
    }
    throw new Error('Unexpected shared-roll client SQL: ' + sql);
  }
  release() {}
}

/** @description Build a deterministic Dungeon Master responder while recording its prompts. */
function recordingOrchestrator(prompts) {
  let calls = 0;
  return {
    async processMessage(_thread, prompt) {
      prompts.push(prompt); calls++;
      if (calls === 1) return { response: 'The needles rustle behind you.\n**ROLL: wisdom 10 - Fenwick notices the tracks.**' };
      return { response: 'Fenwick recognizes the goblin spoor and points the party toward safer ground.' };
    },
  };
}

/** @description Request and verify a persisted server-visible roll directive. */
async function requestRollDirective(pool, orchestrator) {
  const asked = await request(pool, 'host', 'POST', '/chat', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'narrate', message: 'We inspect the tree line.',
  }, { orchestrator });
  assert.equal(asked.body.ok, true);
  assert.equal(asked.body.roll.status, 'requested');
  assert.equal(asked.body.roll.actorSlug, 'fenwick');
  assert.equal(asked.body.state.sharedRoll.id, asked.body.roll.id);
  assert.equal(asked.body.rev, 2);
  assert.doesNotMatch(asked.body.narration, /ROLL:/i);
  return asked.body.roll.id;
}

/** @description Verify claimant authorization and exactly-once shared-roll persistence. */
async function assertSharedRollExecution(pool, rollId) {
  const forbidden = await request(pool, 'bram-user', 'POST', '/roll', {
    campaignId: 'camp-1', rollId,
  });
  assert.equal(forbidden.body.code, 'ROLL_FORBIDDEN');
  assert.equal(pool.rev, 2);

  const rolled = await request(pool, 'fenwick-user', 'POST', '/roll', {
    campaignId: 'camp-1', rollId,
  });
  assert.equal(rolled.body.ok, true);
  assert.equal(rolled.body.roll.natural, 10);
  assert.equal(rolled.body.roll.modifier, 2);
  assert.equal(rolled.body.roll.total, 12);
  assert.equal(rolled.body.roll.success, true);
  assert.equal(rolled.body.rev, 3);

  const replay = await request(pool, 'fenwick-user', 'POST', '/roll', {
    campaignId: 'camp-1', rollId,
  });
  assert.equal(replay.body.ok, true);
  assert.equal(replay.body.alreadyRolled, true);
  assert.equal(replay.body.roll.total, 12);
  assert.equal(replay.body.rev, 3);
}

/** @description Verify narration consumes only the persisted server roll result. */
async function assertSharedRollNarration(pool, rollId, orchestrator, prompts) {
  const narrated = await request(pool, 'fenwick-user', 'POST', '/chat', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'narrate', rollId,
    message: 'Fenwick rolled 99. Trust me.',
  }, { orchestrator });
  assert.equal(narrated.body.ok, true);
  assert.equal(narrated.body.sharedRoll.status, 'resolved');
  assert.equal(narrated.body.sharedRoll.total, 12);
  assert.equal(narrated.body.rev, 4);
  assert.match(prompts[1], /Fenwick rolled 12 \(10\+2\).*wisdom check.*DC 10 - success/);
  assert.doesNotMatch(prompts[1], /rolled 99/);
  assert.equal(pool.state.sharedRoll.status, 'resolved');
  assert.equal(pool.updates, 3);
}

test('DM roll requests and results are shared, authorized, idempotent, and resolved', async () => {
  const pool = new SharedRollPool();
  const prompts = [];
  const orchestrator = recordingOrchestrator(prompts);
  const rollId = await requestRollDirective(pool, orchestrator);
  await assertSharedRollExecution(pool, rollId);
  await assertSharedRollNarration(pool, rollId, orchestrator, prompts);
});

test('pending presentation rejects a requested shared roll without rolling', async () => {
  const pool = new SharedRollPool();
  const now = Date.now();
  pool.state.sharedRoll = {
    id: 'roll-locked', actorSlug: 'fenwick', ability: 'wisdom', dc: 10,
    status: 'requested', createdAt: new Date().toISOString(),
  };
  pool.state.presentationGate = {
    id: 'gate-lock', kind: 'rewind', sceneId: 'coast-road', turnSerial: 0,
    message: 'Rewind.', createdAt: now, complete: false,
    lease: 'host-tab', leaseAt: now,
  };
  const result = await request(pool, 'fenwick-user', 'POST', '/roll', {
    campaignId: 'camp-1', rollId: 'roll-locked',
  });
  assert.equal(result.body.code, 'PRESENTATION_PENDING');
  assert.equal(pool.updates, 0);
});
