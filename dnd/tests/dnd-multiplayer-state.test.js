/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 17:04:19 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard optimistic board revisions, authoritative turn/claim permissions, campaign hero validation, always-on seat sync, and schema-free character-sheet fingerprints.
 * 2026-07-21 17:11:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Verify DM-granted weapons extend inventory while preserving its existing items, coins, and metadata.
 * 2026-07-21 17:37:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Cover structural turn validation, bounded movement, locked claims with legacy host bootstrap, owner-only mutations, and bundled inventory hydration.
 * 2026-07-21 20:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Cover exact durable AI Companion movement markers, narration leases, and fresh-round cleanup.
 * 2026-07-21 20:10:45 | roger.murphy@emeraldcoastsystemsgroup.com  | Split broad state-transition cases into focused scenarios so every test callback stays below the repository function-size limit.
 * 2026-07-21 22:02:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Follow additive structured roll payloads through the shared archive sync query.
 * 2026-07-21 22:08:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require the host's setup-to-combat transition to persist its blocking opening narration gate.
 * 2026-07-21 22:12:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Serve the lightweight live presentation-gate read used around Dungeon Master model calls.
 * 2026-07-21 22:14:13 | roger.murphy@emeraldcoastsystemsgroup.com  | Prevent a host from starting combat while a joined participant has no character claim.
 * 2026-07-21 22:36:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Lock ordinary claim changes to setup while preserving the one legacy owner-bootstrap recovery.
 * 2026-07-21 22:57:10 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove a fresh action and its effects cannot advance initiative before the proposed result narration completes.
 * 2026-07-21 23:05:03 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove host-driven monsters cannot combine a new or pending phase with initiative advancement while completed and no-op skips remain legal.
 * 2026-07-22 00:33:17 | roger.murphy@emeraldcoastsystemsgroup.com  | Exercise authoritative actor/serial ownership and the route-level position, target, rolled result, narration, explicit pass, and advance phases.
 * 2026-07-22 21:59:59 | roger.murphy@emeraldcoastsystemsgroup.com  | Reproduce the live completed-AI-turn stall after its persisted target was defeated.
 * 2026-07-23 13:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Cover the same unclaimed-seat lobby gate for authored investigation openings.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes, _test } = require('../routes/dnd-routes.js');

/** @description Build a compact authoritative board for multiplayer route tests. */
function board(activeId, mode) {
  const tokens = [
    { id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', x: 1, y: 1, hp: 12, maxHp: 12, ac: 16, speed: 30, slots: {}, turnSerial: 1, moveRemaining: 30, moved: false, acted: false },
    { id: 'pip', slug: 'pip', kind: 'pc', name: 'Pip', x: 4, y: 1, hp: 9, maxHp: 9, ac: 14, speed: 30, slots: {} },
    { id: 'goblin-1', ref: 'goblin', kind: 'monster', name: 'Goblin', x: 2, y: 1, hp: 7, maxHp: 7, ac: 13, speed: 30 },
  ];
  const order = ['bram', 'goblin-1', 'pip'];
  return { adventureId: 'goblin-ambush', sceneId: 'coast-road', mode: mode || 'combat', round: 1, turnIndex: Math.max(0, order.indexOf(activeId || 'bram')), turnSerial: 1, order, tokens };
}

/** @description Rules context used by direct structural-guard assertions. */
function rules(sheets) {
  return { scene: { grid: { w: 18, h: 12, unitFeet: 5 }, terrain: { blocking: [], difficult: [] } }, sheets: sheets || {}, monsters: {} };
}

/** @description Apply the exact movement fields emitted by the tabletop client. */
function moveBram(state, x, y, remaining) {
  const next = clone(state), bram = next.tokens.find((token) => token.id === 'bram');
  bram.x = x; bram.y = y; bram.moveRemaining = remaining; bram.moved = remaining < bram.speed;
  return next;
}

/** @description JSON clone test state without retaining references in the mock DB. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @description Build one exact engine-shaped attack or miss event. */
function attackRollEvent(actor, target, actionName, natural, bonus, damage) {
  const outcome = natural === 20 ? 'critical'
    : natural === 1 || natural + bonus < target.ac ? 'miss' : 'hit';
  const common = { actionName, ordinal: 1, count: 1 };
  const rolls = [{
    ...common, kind: 'attack', actorId: actor.id, actorName: actor.name,
    targetId: target.id, targetName: target.name, dice: '1d20', faces: [natural],
    bonus, total: natural + bonus, targetKind: 'ac', target: target.ac, outcome,
  }];
  if (outcome !== 'miss') rolls.push({
    ...common, kind: 'damage', actorId: actor.id, actorName: actor.name,
    targetId: target.id, targetName: target.name, dice: damage.dice,
    faces: damage.faces, bonus: damage.bonus, total: damage.total,
    targetKind: null, target: null, outcome: 'damage',
  });
  return { v: 1, eventId: `test:action:${actor.id}:1`, rolls };
}

/** @description Persist the automated Stay Here position phase for a token. */
function automatedPosition(state, actorId, complete) {
  const next = clone(state), actor = next.tokens.find((token) => token.id === actorId);
  actor.turnSerial = next.turnSerial; actor.moveRemaining = actor.speed;
  actor.moved = false; actor.positionSet = true; actor.acted = false;
  actor.movementResult = {
    serial: next.turnSerial, text: `${actor.name} stays here - position set.`,
    fromX: actor.x, fromY: actor.y, toX: actor.x, toY: actor.y, feet: 0,
    lease: 'host-tab', leaseAt: complete ? 2 : 1, complete: !!complete,
  };
  return next;
}

/** @description Persist the exact automated action and target phase. */
function targetAction(state, actorId, targetId, actionId, actionName) {
  const next = clone(state);
  next.telegraph = {
    actorId, targetId, turnSerial: next.turnSerial, actionId, actionName,
    lease: 'host-tab', leaseAt: 3,
  };
  return next;
}

/** @description Minimal pg-pool double for the package's multiplayer endpoints. */
class MockPool {
  constructor(options) {
    const opts = options || {};
    this.state = clone(opts.state || board('bram'));
    this.rev = opts.rev == null ? 7 : opts.rev;
    this.seats = clone(opts.seats || [{ user_sub: 'player-bram', display_name: 'Alice', character_slug: 'bram' }]);
    this.sheets = clone(opts.sheets || { bram: {
      name: 'Bram', speed: 30, maxHp: 12,
      actions: [{ id: 'longsword', name: 'Longsword', type: 'weapon', mode: 'attack', delivery: 'melee', reach: 5, damage: { dice: '1d8', bonus: 3 } }],
    } });
    this.raceOnUpdate = !!opts.raceOnUpdate;
    this.queries = [];
    this.insertedClaims = 0;
    this.archiveRows = [];
  }

  /** @description Emulate only the SQL statements exercised by these focused routes. */
  async query(sql, params) {
    this.queries.push({ sql, params });
    if (/SELECT c\.\*,/.test(sql)) return this.access(params[1]);
    if (/SELECT c\.slug, e\.state/.test(sql)) return this.validHero(params[1]);
    if (/SELECT slug FROM dnd_characters/.test(sql)) return this.validHero(params[1]);
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return this.rows([{ state: clone(this.state), rev: this.rev }]);
    if (/SELECT state FROM dnd_encounters/.test(sql)) return this.rows([{ state: clone(this.state) }]);
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return this.rows(clone(this.seats));
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) return this.sheetRows();
    if (/SELECT seq, kind, content, payload FROM dnd_archive/.test(sql)) return this.rows([]);
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1 AS n FROM dnd_archive/.test(sql)) return this.rows([{ n: this.archiveRows.length + 1 }]);
    if (/INSERT INTO dnd_archive/.test(sql)) {
      this.archiveRows.push({ seq: params[2], kind: params[3], content: params[4] });
      return this.rows([]);
    }
    if (/INSERT INTO dnd_players/.test(sql)) return this.insertClaim(params);
    if (/UPDATE dnd_encounters SET rev=rev\+1/.test(sql)) {
      this.rev++;
      return this.rows([{ rev: this.rev }]);
    }
    if (/UPDATE dnd_encounters SET state=/.test(sql)) return this.updateBoard(params);
    if (/UPDATE dnd_campaigns SET updated_at/.test(sql)) return this.rows([]);
    throw new Error('Unexpected SQL in multiplayer test: ' + sql);
  }

  /** @description Return an owner-or-member access row matching the caller. */
  access(sub) {
    const member = sub === 'host' || this.seats.some((seat) => seat.user_sub === sub);
    return member ? this.rows([{ campaign_id: 'camp-1', user_sub: 'host', is_owner: sub === 'host' }]) : this.rows([]);
  }

  /** @description Validate a claim against both the stored sheet and current board token. */
  validHero(slug) {
    const valid = this.sheets[slug] && this.state.tokens.some((token) => token.kind === 'pc' && token.slug === slug);
    return valid ? this.rows([{ slug, state: clone(this.state) }]) : this.rows([]);
  }

  /** @description Persist a valid claim in the mock seat list. */
  insertClaim(params) {
    this.insertedClaims++;
    const existing = this.seats.find((seat) => seat.user_sub === params[1]);
    if (existing) existing.character_slug = params[3] || null;
    else this.seats.push({ user_sub: params[1], display_name: params[2], character_slug: params[3] || null });
    return this.rows([]);
  }

  /** @description Apply an atomic rev-checked board update or simulate a race loss. */
  updateBoard(params) {
    if (this.raceOnUpdate) {
      this.raceOnUpdate = false;
      this.rev++;
      this.state.round = 99;
      return this.rows([]);
    }
    if (Number(params[3]) !== this.rev) return this.rows([]);
    this.state = JSON.parse(params[0]);
    this.rev++;
    return this.rows([{ rev: this.rev }]);
  }

  /** @description Convert the sheet map into deterministic database rows. */
  sheetRows() {
    return this.rows(Object.keys(this.sheets).sort().map((slug) => ({ slug, sheet: clone(this.sheets[slug]) })));
  }

  /** @description Shape a node-postgres result. */
  rows(rows) {
    return { rowCount: rows.length, rows };
  }
}

/** @description Invoke the Express-compatible package router without a server. */
async function request(pool, sub, method, url, bodyValue, extraContext) {
  const router = createDndRoutes({ pool, appPackageDir: path.join(__dirname, '..'), ...(extraContext || {}) });
  let payload = null;
  const req = { method, url, body: bodyValue, oidc: { user: { sub, name: sub } } };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { payload = body; } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

test('turn ownership matrix preserves claims, host NPC/setup control, and free-roam isolation', () => {
  const seats = [{ user_sub: 'alice', character_slug: 'bram' }];
  assert.equal(_test.stateWriteDecision({ is_owner: false }, seats, 'alice', board('bram'), board('bram'), rules()).ok, true);
  assert.equal(_test.stateWriteDecision({ is_owner: true }, seats, 'host', board('bram'), board('bram')).code, 'NOT_YOUR_TURN');
  assert.equal(_test.stateWriteDecision({ is_owner: true }, seats, 'host', board('pip'), board('pip')).ok, true);
  assert.equal(_test.stateWriteDecision({ is_owner: true }, seats, 'host', board('goblin-1'), board('goblin-1')).ok, true);
  assert.equal(_test.stateWriteDecision({ is_owner: false }, seats, 'alice', board('goblin-1'), board('goblin-1')).code, 'NOT_YOUR_TURN');
  const setup = board('bram', 'setup'), started = board('bram');
  started.presentationGate = {
    id: 'opening:camp-1:coast-road:1', kind: 'opening', sceneId: started.sceneId,
    turnSerial: started.turnSerial, message: 'The adventure begins.', createdAt: 100,
    complete: false, lease: 'presenter-a', leaseAt: 100,
  };
  assert.equal(_test.stateWriteDecision({ is_owner: true }, seats, 'host', setup, started).ok, true);
  assert.equal(_test.stateWriteDecision({ is_owner: false }, seats, 'alice', board('bram', 'setup'), board('bram')).code, 'NOT_YOUR_TURN');
  const investigation = clone(setup);
  investigation.mode = 'exploration'; investigation.round = 0;
  investigation.turnIndex = 0; investigation.order = ['bram', 'pip'];
  investigation.exploration = { discovered: [] };
  assert.equal(_test.stateWriteDecision({ is_owner: true }, seats, 'host', setup, investigation).ok, true);
  const seeded = clone(investigation); seeded.exploration.discovered.push('hidden-clue');
  assert.equal(_test.stateWriteDecision({ is_owner: true }, seats, 'host', setup, seeded).code, 'STATE_FORBIDDEN');

  const current = board('bram', 'resolved');
  const ownMove = clone(current); ownMove.tokens[0].y++;
  const foreignMove = clone(current); foreignMove.tokens[1].x++;
  assert.equal(_test.stateWriteDecision({ is_owner: false }, seats, 'alice', current, ownMove, rules()).ok, true);
  assert.equal(_test.stateWriteDecision({ is_owner: false }, seats, 'alice', current, foreignMove, rules()).code, 'STATE_FORBIDDEN');
});

test('POST /state keeps combat and investigation lobbies open while a joined player is choosing', async () => {
  const setup = board('bram', 'setup'), started = board('bram');
  started.presentationGate = {
    id: 'opening:camp-1:coast-road:1', kind: 'opening', sceneId: started.sceneId,
    turnSerial: started.turnSerial, message: 'The adventure begins.', createdAt: 100,
    complete: false, lease: 'presenter-a', leaseAt: 100,
  };
  const pool = new MockPool({ state: setup, seats: [
    { user_sub: 'host', display_name: 'Host', character_slug: 'bram' },
    { user_sub: 'bob', display_name: 'Bob', character_slug: null },
  ] });
  const result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: started });
  assert.equal(result.body.code, 'LOBBY_NOT_READY');
  assert.equal(result.body.conflict, true);
  assert.equal(pool.queries.some((query) => /UPDATE dnd_encounters SET state=/.test(query.sql)), false);

  const exploration = clone(setup); exploration.mode = 'exploration';
  const investigationPool = new MockPool({ state: setup, seats: pool.seats });
  const investigation = await request(investigationPool, 'host', 'POST', '/state', {
    campaignId: 'camp-1', expectedRev: 7, state: exploration,
  });
  assert.equal(investigation.body.code, 'LOBBY_NOT_READY');
  assert.equal(investigationPool.queries.some((query) => /UPDATE dnd_encounters SET state=/.test(query.sql)), false);
});

test('Stay Here is a durable claimed-player position choice', () => {
  const current = board('bram'), proposed = clone(current);
  proposed.tokens.find((token) => token.id === 'bram').positionSet = true;
  const seats = [{ user_sub: 'alice', character_slug: 'bram' }];
  const decision = _test.stateWriteDecision({ is_owner: false }, seats, 'alice', current, proposed, rules({ bram: {
    speed: 30,
    actions: [{ id: 'longsword', name: 'Longsword', type: 'weapon', mode: 'attack', delivery: 'melee', reach: 5, damage: { dice: '1d8', bonus: 3 } }],
  } }));
  assert.equal(decision.ok, true, decision.error);
});

test('sheet fingerprints are stable by key order and change with loot', () => {
  const a = { pip: { actions: [{ name: 'Shortbow' }] }, bram: { actions: [{ name: 'Longsword' }] } };
  const b = { bram: { actions: [{ name: 'Longsword' }] }, pip: { actions: [{ name: 'Shortbow' }] } };
  const c = clone(b); c.pip.actions.push({ name: 'Rusty Dagger', looted: true });
  assert.equal(_test.sheetsRevFor(a), _test.sheetsRevFor(b));
  assert.notEqual(_test.sheetsRevFor(b), _test.sheetsRevFor(c));
});

test('loot weapon inventory entries preserve existing items, coins, and metadata', () => {
  const original = {
    items: [{ id: 'rope', name: 'Rope', category: 'adventuring-gear', quantity: 1, equipped: false }],
    coins: { cp: 3, sp: 4, ep: 0, gp: 12, pp: 1 },
    carryingNote: 'Pack mule owes me a favor.',
  };
  const inventory = _test.inventoryWithLootWeapon(original, { id: 'loot-goblin-knife', name: 'Goblin Knife' });

  assert.deepEqual(inventory.items.at(-1), {
    id: 'loot-goblin-knife',
    name: 'Goblin Knife',
    category: 'weapon',
    quantity: 1,
    equipped: false,
    actionId: 'loot-goblin-knife',
  });
  assert.deepEqual(inventory.items.slice(0, -1), original.items);
  assert.deepEqual(inventory.coins, original.coins);
  assert.equal(inventory.carryingNote, original.carryingNote);
  assert.equal(original.items.length, 1);
});

test('POST /state accepts the claimant with expectedRev and atomically increments rev', async () => {
  const pool = new MockPool({});
  const next = moveBram(board('bram'), 1, 2, 25);
  const result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: next });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  assert.equal(pool.state.tokens[0].y, 2);
  assert.match(pool.queries.find((q) => /UPDATE dnd_encounters SET state=/.test(q.sql)).sql, /AND rev=\$4/);
});

test('POST /state tolerates and permanently strips legacy renderer-only token fields', async () => {
  const pool = new MockPool({});
  Object.assign(pool.state.tokens[0], { _lungeT0: 123, _ldx: 1, _ldy: -1 });
  const next = moveBram(pool.state, 1, 2, 25);
  next.tokens[0]._spoof = 'discard me';
  const result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: next });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  assert.equal(Object.keys(pool.state.tokens[0]).some((key) => key.startsWith('_')), false);
});

test('POST /state rejects stale, missing, and out-of-turn writes with authoritative state', async () => {
  const next = moveBram(board('bram'), 1, 2, 25);
  let pool = new MockPool({});
  let result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 6, state: next });
  assert.equal(result.body.code, 'REV_CONFLICT');
  assert.equal(result.body.conflict, true);
  assert.equal(result.body.rev, 7);
  assert.equal(result.body.state.tokens[0].x, 1);
  assert.equal(result.body.sheetsRev, _test.sheetsRevFor(result.body.sheets));

  pool = new MockPool({});
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', state: next });
  assert.equal(result.body.code, 'REV_REQUIRED');

  pool = new MockPool({});
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: next });
  assert.equal(result.body.code, 'NOT_YOUR_TURN');
  assert.equal(result.body.conflict, true);
  assert.equal(result.body.state.tokens[0].x, 1);
  assert.equal(pool.rev, 7);
});

test('POST /state binds the active hero and turn serial to the exact claimant', async () => {
  const seats = [
    { user_sub: 'alice', display_name: 'Alice', character_slug: 'bram' },
    { user_sub: 'bob', display_name: 'Bob', character_slug: 'pip' },
  ];
  let pool = new MockPool({ seats });
  const bramMove = moveBram(pool.state, 1, 2, 25);
  let result = await request(pool, 'bob', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: bramMove });
  assert.equal(result.body.code, 'NOT_YOUR_TURN');
  pool = new MockPool({ seats });
  const wrongSerial = clone(pool.state);
  wrongSerial.tokens[0].turnSerial = 2; wrongSerial.tokens[0].positionSet = true;
  result = await request(pool, 'alice', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: wrongSerial });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  pool = new MockPool({ seats });
  const otherHero = clone(pool.state); otherHero.tokens[1].positionSet = true;
  result = await request(pool, 'alice', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: otherHero });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  assert.equal(pool.rev, 7);
});

test('POST /state requires a claimed hero to persist Take No Action before advance', async () => {
  const positioned = board('bram'); positioned.tokens[0].positionSet = true;
  const pool = new MockPool({ state: positioned });
  const skipped = clone(positioned); skipped.turnIndex = 1; skipped.turnSerial = 2;
  let result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: skipped });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const passed = clone(positioned);
  passed.tokens[0].acted = true;
  passed.tokens[0].turnResult = { serial: 1, text: 'Bram takes no action.', lease: 'player-tab', leaseAt: 1, complete: false };
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: passed });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  const narrated = clone(passed); narrated.tokens[0].turnResult.complete = true; narrated.tokens[0].turnResult.leaseAt = 2;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: narrated });
  assert.deepEqual(result.body, { ok: true, rev: 9 });
  const advanced = clone(narrated); advanced.turnIndex = 1; advanced.turnSerial = 2;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 9, state: advanced });
  assert.deepEqual(result.body, { ok: true, rev: 10 });
});

test('POST /state loses an update race safely at the atomic WHERE rev guard', async () => {
  const pool = new MockPool({ raceOnUpdate: true });
  const result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: board('bram') });
  assert.equal(result.body.code, 'REV_CONFLICT');
  assert.equal(result.body.rev, 8);
  assert.equal(result.body.state.round, 99);
});

test('POST /state rejects forged round, turn, kill, and out-of-bounds free-roam changes', async () => {
  let pool = new MockPool({});
  const cheat = clone(board('bram'));
  cheat.round = 99; cheat.turnIndex = 2; cheat.turnSerial = 2;
  cheat.tokens[2].hp = 0; cheat.tokens[2].dead = true; cheat.tokens[0].acted = true;
  let result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: cheat });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  assert.equal(pool.rev, 7);
  assert.equal(pool.state.tokens[2].hp, 7);

  pool = new MockPool({ state: board('bram', 'resolved') });
  const outside = clone(pool.state); outside.tokens[0].x = -1;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: outside });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  assert.equal(pool.state.tokens[0].x, 1);
});

test('POST /state rejects foreign movement, stat edits, blocked movement, and unrelated targets', async () => {
  let pool = new MockPool({});
  let forged = clone(pool.state); forged.tokens[1].y = 2;
  let result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: forged });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');

  pool = new MockPool({});
  forged = clone(pool.state); forged.tokens[0].ac = 99;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: forged });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');

  pool = new MockPool({});
  forged = moveBram(pool.state, 2, 2, 25);
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: forged });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');

  const distant = board('bram'); distant.tokens[2].x = 10; distant.tokens[2].y = 10;
  pool = new MockPool({ state: distant });
  forged = clone(distant); forged.tokens[0].acted = true; forged.tokens[2].hp = 0; forged.tokens[2].dead = true;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: forged });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
});

test('POST /state accepts bounded action, narration completion, and exact end-turn', async () => {
  const positioned = board('bram'); positioned.tokens[0].positionSet = true;
  const pool = new MockPool({ state: positioned });
  const action = clone(positioned);
  action.tokens[0].acted = true; action.tokens[0].turnResult = {
    serial: 1, text: 'Bram hits the goblin.', lease: 'test-tab', leaseAt: 1,
    complete: false, rollEvent: attackRollEvent(action.tokens[0], action.tokens[2], 'Longsword', 14, 0,
      { dice: '1d8', faces: [1], bonus: 3, total: 4 }),
  };
  action.tokens[2].hp = 3;
  const coalescedAction = clone(action); coalescedAction.turnIndex = 1; coalescedAction.turnSerial = 2;
  let result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: coalescedAction });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  assert.equal(pool.rev, 7);
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: action });
  assert.deepEqual(result.body, { ok: true, rev: 8 });

  const prematureEnd = clone(action); prematureEnd.turnIndex = 1; prematureEnd.turnSerial = 2;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: prematureEnd });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');

  const narrated = clone(action); narrated.tokens[0].turnResult.complete = true; narrated.tokens[0].turnResult.leaseAt = 2;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: narrated });
  assert.deepEqual(result.body, { ok: true, rev: 9 });

  const ended = clone(narrated); ended.turnIndex = 1; ended.turnSerial = 2;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 9, state: ended });
  assert.deepEqual(result.body, { ok: true, rev: 10 });
});

test('POST /state accepts victory followed by a host-owned outcome marker', async () => {
  const positioned = board('bram'); positioned.tokens[0].positionSet = true;
  const pool = new MockPool({ state: positioned });
  const winningHit = clone(positioned);
  winningHit.tokens[0].acted = true; winningHit.tokens[0].turnResult = {
    serial: 1, text: 'Bram defeats the goblin.', lease: 'test-tab', leaseAt: 1,
    complete: false, rollEvent: attackRollEvent(winningHit.tokens[0], winningHit.tokens[2], 'Longsword', 14, 0,
      { dice: '1d8', faces: [4], bonus: 3, total: 7 }),
  };
  winningHit.tokens[2].hp = 0; winningHit.tokens[2].dead = true;
  let result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: winningHit });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  const wonNarration = clone(winningHit); wonNarration.tokens[0].turnResult.complete = true; wonNarration.tokens[0].turnResult.leaseAt = 2;
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: wonNarration });
  assert.deepEqual(result.body, { ok: true, rev: 9 });
  const coalescedOutcome = clone(wonNarration); coalescedOutcome.mode = 'resolved';
  coalescedOutcome.outcomeEffects = { sceneId: 'coast-road', kind: 'victory', claimedAt: 10 };
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 9, state: coalescedOutcome });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const victory = clone(wonNarration); victory.mode = 'resolved';
  result = await request(pool, 'player-bram', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 9, state: victory });
  assert.deepEqual(result.body, { ok: true, rev: 10 });
  const outcomeMarker = clone(victory);
  outcomeMarker.outcomeEffects = { sceneId: 'coast-road', kind: 'victory', claimedAt: 10 };
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 10, state: outcomeMarker });
  assert.deepEqual(result.body, { ok: true, rev: 11 });
});

test('POST /state accepts host companion movement and its narration completion', async () => {
  const pool = new MockPool({ state: board('pip') });
  const companion = clone(pool.state), pip = companion.tokens[1];
  pip.y = 2; pip.turnSerial = 1; pip.moveRemaining = 25; pip.moved = true; pip.positionSet = true; pip.acted = false;
  pip.movementResult = {
    serial: 1, text: 'Pip moves 5 ft south toward Goblin · position set.',
    fromX: 4, fromY: 1, toX: 4, toY: 2, feet: 5,
    lease: 'host-tab', leaseAt: 1, complete: false,
  };
  let result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: companion });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  const movementNarrated = clone(companion);
  movementNarrated.tokens[1].movementResult.complete = true;
  movementNarrated.tokens[1].movementResult.leaseAt = 2;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: movementNarrated });
  assert.deepEqual(result.body, { ok: true, rev: 9 });
});

test('POST /state rejects arbitrary NPC mutation and a healthy untouched advance', async () => {
  const pool = new MockPool({ state: board('goblin-1'), seats: [] });
  const skipped = clone(pool.state); skipped.turnIndex = 2; skipped.turnSerial = 2;
  let result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: skipped });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const forgedStat = clone(pool.state); forgedStat.tokens[2].ac = 99;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: forgedStat });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const forgedEffect = clone(pool.state); forgedEffect.tokens[0].hp = 1;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: forgedEffect });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const forgedMove = clone(pool.state); forgedMove.tokens[2].x = 3;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: forgedMove });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  assert.equal(pool.rev, 7);
  assert.equal(pool.state.tokens[0].hp, 12);
});

test('POST /state enforces NPC position, target, roll, result, and advance', async () => {
  const pool = new MockPool({ state: board('goblin-1'), seats: [] });
  const pendingPosition = automatedPosition(pool.state, 'goblin-1', false);
  let result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: pendingPosition });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  const earlyTarget = targetAction(pendingPosition, 'goblin-1', 'bram', 'scimitar', 'Scimitar');
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: earlyTarget });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const positioned = automatedPosition(pendingPosition, 'goblin-1', true);
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: positioned });
  assert.deepEqual(result.body, { ok: true, rev: 9 });
  const targeted = targetAction(positioned, 'goblin-1', 'bram', 'scimitar', 'Scimitar');
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 9, state: targeted });
  assert.deepEqual(result.body, { ok: true, rev: 10 });
  const resolved = clone(targeted), monster = resolved.tokens[2];
  monster.acted = true; monster.turnResult = {
    serial: 1, text: 'Goblin hits Bram.', lease: 'host-tab', leaseAt: 4, complete: false,
    downedTargetId: null, rollEvent: attackRollEvent(monster, resolved.tokens[0], 'Scimitar', 14, 4,
      { dice: '1d6', faces: [2], bonus: 2, total: 4 }),
  };
  resolved.tokens[0].hp = 8;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 10, state: resolved });
  assert.deepEqual(result.body, { ok: true, rev: 11 });
  const premature = clone(resolved); premature.turnIndex = 2; premature.turnSerial = 2; delete premature.telegraph;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 11, state: premature });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const narrated = clone(resolved); narrated.tokens[2].turnResult.complete = true; narrated.tokens[2].turnResult.leaseAt = 5;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 11, state: narrated });
  assert.deepEqual(result.body, { ok: true, rev: 12 });
  const advanced = clone(narrated); advanced.turnIndex = 2; advanced.turnSerial = 2; delete advanced.telegraph;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 12, state: advanced });
  assert.deepEqual(result.body, { ok: true, rev: 13 });
});

test('POST /state persists Take No Action before a healthy NPC can advance', async () => {
  const positioned = automatedPosition(board('goblin-1'), 'goblin-1', true);
  const pool = new MockPool({ state: positioned, seats: [] });
  const passed = clone(positioned), monster = passed.tokens[2];
  monster.acted = true;
  monster.turnResult = { serial: 1, text: 'Goblin takes no action.', lease: 'host-tab', leaseAt: 3, complete: false };
  let result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: passed });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  const skipped = clone(passed); skipped.turnIndex = 2; skipped.turnSerial = 2;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: skipped });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  const narrated = clone(passed); narrated.tokens[2].turnResult.complete = true; narrated.tokens[2].turnResult.leaseAt = 4;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: narrated });
  assert.deepEqual(result.body, { ok: true, rev: 9 });
  const advanced = clone(narrated); advanced.turnIndex = 2; advanced.turnSerial = 2;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 9, state: advanced });
  assert.deepEqual(result.body, { ok: true, rev: 10 });
});

test('POST /state binds an NPC result to its persisted target and exact rolls', async () => {
  const positioned = automatedPosition(board('goblin-1'), 'goblin-1', true);
  let pool = new MockPool({ state: positioned, seats: [] });
  let resultState = clone(positioned), monster = resultState.tokens[2];
  monster.acted = true; monster.turnResult = {
    serial: 1, text: 'Goblin misses Bram.', lease: 'host-tab', leaseAt: 4, complete: false,
    rollEvent: attackRollEvent(monster, resultState.tokens[0], 'Scimitar', 2, 4),
  };
  let result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: resultState });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');

  const targeted = targetAction(positioned, 'goblin-1', 'bram', 'scimitar', 'Scimitar');
  pool = new MockPool({ state: targeted, seats: [] });
  resultState = clone(targeted); monster = resultState.tokens[2];
  monster.acted = true; monster.turnResult = {
    serial: 1, text: 'Goblin claims a hit.', lease: 'host-tab', leaseAt: 4, complete: false,
    rollEvent: attackRollEvent(monster, resultState.tokens[0], 'Scimitar', 2, 4),
  };
  resultState.tokens[0].hp = 8;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: resultState });
  assert.equal(result.body.code, 'STATE_FORBIDDEN');
  assert.equal(pool.rev, 7);
});

test('POST /state allows only an edge-positioned routing goblin to become fled', async () => {
  const routed = board('goblin-1');
  routed.tokens[2].x = 17;
  routed.tokens.push({
    id: 'boss', ref: 'goblin-boss', kind: 'monster', name: 'Goblin Boss',
    x: 10, y: 2, hp: 0, maxHp: 21, ac: 17, speed: 30, dead: true,
  });
  const positioned = automatedPosition(routed, 'goblin-1', true);
  const fled = clone(positioned), monster = fled.tokens[2];
  monster.acted = true; monster.fled = true;
  monster.turnResult = { serial: 1, text: 'Goblin takes no action and flees the encounter.', lease: 'host-tab', leaseAt: 3, complete: false };
  const pool = new MockPool({ state: positioned, seats: [] });
  let result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 7, state: fled });
  assert.deepEqual(result.body, { ok: true, rev: 8 });
  const narrated = clone(fled); narrated.tokens[2].turnResult.complete = true; narrated.tokens[2].turnResult.leaseAt = 4;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 8, state: narrated });
  assert.deepEqual(result.body, { ok: true, rev: 9 });
  const advanced = clone(narrated); advanced.turnIndex = 2; advanced.turnSerial = 2;
  result = await request(pool, 'host', 'POST', '/state', { campaignId: 'camp-1', expectedRev: 9, state: advanced });
  assert.deepEqual(result.body, { ok: true, rev: 10 });
});

test('already dead or fled NPC entries may be skipped without mutation', () => {
  const campaign = { is_owner: true };
  for (const key of ['dead', 'fled']) {
    const current = board('goblin-1'), monster = current.tokens[2];
    monster[key] = true;
    if (key === 'dead') monster.hp = 0;
    const advanced = clone(current); advanced.turnIndex = 2; advanced.turnSerial = 2;
    assert.equal(_test.stateWriteDecision(campaign, [], 'host', current, advanced, rules()).ok, true);
  }
});

test('AI companion result leads are bound to the persisted target and roll', () => {
  const current = board('pip');
  current.tokens[2].x = 3;
  Object.assign(current.tokens[1], {
    turnSerial: 1, moveRemaining: 30, moved: false, positionSet: true, acted: false,
    movementResult: {
      serial: 1, text: 'Pip stays here · position set.',
      fromX: 4, fromY: 1, toX: 4, toY: 1, feet: 0,
      lease: 'host-tab', leaseAt: 1, complete: true,
    },
  });
  current.telegraph = {
    actorId: 'pip', targetId: 'goblin-1', turnSerial: 1,
    actionId: 'dagger', actionName: 'Dagger', lease: 'host-tab', leaseAt: 2,
  };
  const companion = clone(current), pip = companion.tokens[1];
  pip.acted = true;
  pip.turnResult = {
    serial: 1, text: 'Pip strikes the goblin for 4 damage.', lead: 'Pip chooses the nearby goblin.',
    lease: 'host-tab', leaseAt: 3, complete: false,
    rollEvent: attackRollEvent(pip, companion.tokens[2], 'Dagger', 14, 0,
      { dice: '1d4', faces: [2], bonus: 2, total: 4 }),
  };
  companion.tokens[2].hp = 3;
  const companionRules = rules({ pip: {
    name: 'Pip', speed: 30, maxHp: 9,
    actions: [{ id: 'dagger', name: 'Dagger', type: 'weapon', mode: 'attack', delivery: 'melee', reach: 5, damage: { dice: '1d4', bonus: 2 } }],
  } });
  assert.equal(_test.stateWriteDecision({ is_owner: true }, [{ user_sub: 'alice', character_slug: 'bram' }], 'host', current, companion, companionRules).ok, true);
});

test('completed AI companion can clear a target it defeated and advance', () => {
  const targeted = targetAction(automatedPosition(board('pip'), 'pip', true),
    'pip', 'goblin-1', 'dagger', 'Dagger');
  const pip = targeted.tokens[1], goblin = targeted.tokens[2];
  pip.acted = true;
  pip.turnResult = {
    serial: 1, text: 'Pip strikes the goblin for 9 damage.',
    lease: 'host-tab', leaseAt: 4, complete: true,
    rollEvent: attackRollEvent(pip, goblin, 'Dagger', 18, 5,
      { dice: '1d4', faces: [4], bonus: 5, total: 9 }),
  };
  goblin.hp = 0; goblin.dead = true;
  const advanced = clone(targeted);
  delete advanced.telegraph;
  advanced.turnIndex = 0; advanced.round = 2; advanced.turnSerial = 2;
  const companionRules = rules({ pip: {
    name: 'Pip', speed: 30, maxHp: 9,
    actions: [{ id: 'dagger', name: 'Dagger', type: 'weapon', mode: 'attack',
      delivery: 'melee', reach: 5, damage: { dice: '1d4', bonus: 5 } }],
  } });
  const decision = _test.stateWriteDecision(
    { is_owner: true }, [{ user_sub: 'alice', character_slug: 'bram' }],
    'host', targeted, advanced, companionRules,
  );
  assert.equal(decision.ok, true, decision.error);
});

test('fresh result cleanup and outcome ownership are guarded', () => {
  const stale = board('bram');
  stale.turnSerial = 2;
  Object.assign(stale.tokens[0], {
    turnSerial: 1, moveRemaining: 0, moved: true, positionSet: true, acted: true,
    turnResult: { serial: 1, text: 'The previous result finished.', lease: 'old-tab', leaseAt: 1, complete: true },
    movementResult: {
      serial: 1, text: 'Bram moved 30 ft east · position set.',
      fromX: 1, fromY: 1, toX: 7, toY: 1, feet: 30,
      lease: 'old-tab', leaseAt: 1, complete: true,
    },
  });
  const fresh = clone(stale), bram = fresh.tokens[0];
  bram.turnSerial = 2; bram.moveRemaining = 30; bram.moved = false; bram.positionSet = false; bram.acted = false;
  delete bram.turnResult; delete bram.movementResult;
  assert.equal(_test.stateWriteDecision({ is_owner: false }, [{ user_sub: 'alice', character_slug: 'bram' }], 'alice', stale, fresh, rules({
    bram: { name: 'Bram', speed: 30, maxHp: 12, actions: [] },
  })).ok, true);

  const falseDefeat = clone(board('bram')); falseDefeat.mode = 'defeat';
  assert.equal(_test.stateWriteDecision({ is_owner: false }, [{ user_sub: 'alice', character_slug: 'bram' }], 'alice', board('bram'), falseDefeat, rules()).code, 'STATE_FORBIDDEN');

  const resolved = board('bram', 'resolved'), unauthorizedMarker = clone(resolved);
  unauthorizedMarker.outcomeEffects = { sceneId: 'coast-road', kind: 'victory', claimedAt: 10 };
  assert.equal(_test.stateWriteDecision({ is_owner: false }, [{ user_sub: 'alice', character_slug: 'bram' }], 'alice', resolved, unauthorizedMarker, rules()).code, 'STATE_FORBIDDEN');
});

/** @description Build an isolated AI Companion movement-lease fixture. */
function companionMovementFixture() {
  const seats = [{ user_sub: 'alice', character_slug: 'bram' }];
  const companionRules = rules({ pip: {
    name: 'Pip', speed: 30, maxHp: 9,
    actions: [{ id: 'dagger', name: 'Dagger', type: 'weapon', mode: 'attack', delivery: 'melee', reach: 5, damage: { dice: '1d4', bonus: 2 } }],
  } });
  const current = board('pip');
  current.tokens[2].x = 3;
  const pending = clone(current), pip = pending.tokens[1];
  Object.assign(pip, {
    turnSerial: 1, moveRemaining: 30, moved: false, positionSet: true, acted: false,
    movementResult: {
      serial: 1, text: 'Pip stays here · position set.',
      fromX: 4, fromY: 1, toX: 4, toY: 1, feet: 0,
      lease: 'host-a', leaseAt: 10, complete: false,
    },
  });
  return { seats, companionRules, current, pending };
}

test('AI Companion movement narration markers are exact and fenced', () => {
  const { seats, companionRules, current, pending } = companionMovementFixture();
  let decision = _test.stateWriteDecision({ is_owner: true }, seats, 'host', current, pending, companionRules);
  assert.equal(decision.ok, true, decision.error);

  const wrongDistance = clone(pending);
  wrongDistance.tokens[1].movementResult.feet = 5;
  decision = _test.stateWriteDecision({ is_owner: true }, seats, 'host', current, wrongDistance, companionRules);
  assert.equal(decision.code, 'STATE_FORBIDDEN');

  const rewritten = clone(pending);
  rewritten.tokens[1].movementResult.text = 'Pip secretly teleports.';
  rewritten.tokens[1].movementResult.lease = 'host-b';
  rewritten.tokens[1].movementResult.leaseAt = 20;
  decision = _test.stateWriteDecision({ is_owner: true }, seats, 'host', pending, rewritten, companionRules);
  assert.equal(decision.code, 'STATE_FORBIDDEN');

  const claimed = board('bram'), forgedPlayerMarker = clone(claimed);
  forgedPlayerMarker.tokens[0].positionSet = true;
  forgedPlayerMarker.tokens[0].movementResult = {
    serial: 1, text: 'Bram stays here · position set.',
    fromX: 1, fromY: 1, toX: 1, toY: 1, feet: 0,
    lease: 'player-tab', leaseAt: 10, complete: false,
  };
  decision = _test.stateWriteDecision({ is_owner: false }, seats, 'alice', claimed, forgedPlayerMarker, rules({ bram: { speed: 30, actions: [] } }));
  assert.equal(decision.code, 'STATE_FORBIDDEN');
});

test('AI Companion movement narration must complete before an action', () => {
  const { seats, companionRules, pending } = companionMovementFixture();
  const attackedEarly = clone(pending);
  attackedEarly.tokens[1].acted = true;
  attackedEarly.tokens[1].turnResult = { serial: 1, text: 'Pip hits the goblin.', lead: 'Pip chooses Dagger.', lease: 'host-a', leaseAt: 11, complete: false };
  attackedEarly.tokens[2].hp = 3;
  let decision = _test.stateWriteDecision({ is_owner: true }, seats, 'host', pending, attackedEarly, companionRules);
  assert.equal(decision.code, 'STATE_FORBIDDEN');

  const narrated = clone(pending);
  narrated.tokens[1].movementResult.lease = 'host-b';
  narrated.tokens[1].movementResult.leaseAt = 20;
  narrated.tokens[1].movementResult.complete = true;
  decision = _test.stateWriteDecision({ is_owner: true }, seats, 'host', pending, narrated, companionRules);
  assert.equal(decision.ok, true, decision.error);

  const targeted = targetAction(narrated, 'pip', 'goblin-1', 'dagger', 'Dagger');
  decision = _test.stateWriteDecision({ is_owner: true }, seats, 'host', narrated, targeted, companionRules);
  assert.equal(decision.ok, true, decision.error);

  const attacked = clone(targeted);
  attacked.tokens[1].acted = true;
  attacked.tokens[1].turnResult = {
    serial: 1, text: 'Pip hits the goblin.', lead: 'Pip chooses Dagger.',
    lease: 'host-b', leaseAt: 21, complete: false,
    rollEvent: attackRollEvent(attacked.tokens[1], attacked.tokens[2], 'Dagger', 14, 0,
      { dice: '1d4', faces: [2], bonus: 2, total: 4 }),
  };
  attacked.tokens[2].hp = 3;
  decision = _test.stateWriteDecision({ is_owner: true }, seats, 'host', targeted, attacked, companionRules);
  assert.equal(decision.ok, true, decision.error);
});

test('POST /claim rejects slugs outside both the campaign sheet set and setup board', async () => {
  const pool = new MockPool({ state: board('bram', 'setup') });
  const bad = await request(pool, 'player-bram', 'POST', '/claim', { campaignId: 'camp-1', slug: 'dragon-queen' });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.error, /not part of this campaign/i);
  assert.equal(pool.insertedClaims, 0);

  const good = await request(pool, 'player-bram', 'POST', '/claim', { campaignId: 'camp-1', slug: 'bram' });
  assert.equal(good.body.ok, true);
  assert.equal(pool.insertedClaims, 1);
});

test('POST /claim locks after setup except for one owner bootstrap when nobody is claimed', async () => {
  let pool = new MockPool({});
  let result = await request(pool, 'player-bram', 'POST', '/claim', { campaignId: 'camp-1', slug: 'bram' });
  assert.equal(result.body.code, 'CLAIMS_CLOSED');
  assert.equal(pool.insertedClaims, 0);

  pool = new MockPool({ seats: [] });
  result = await request(pool, 'host', 'POST', '/claim', { campaignId: 'camp-1', slug: 'bram' });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.rev, 8);
  assert.equal(pool.insertedClaims, 1);
  result = await request(pool, 'host', 'POST', '/claim', { campaignId: 'camp-1', slug: 'bram' });
  assert.equal(result.body.code, 'CLAIMS_CLOSED');
  assert.equal(pool.insertedClaims, 1);
});

test('restore and advance require the campaign owner', async () => {
  const pool = new MockPool({});
  const restored = await request(pool, 'player-bram', 'POST', '/restore', { campaignId: 'camp-1', snapshotId: 'snap-1' });
  assert.equal(restored.body.code, 'OWNER_REQUIRED');
  const advanced = await request(pool, 'player-bram', 'POST', '/advance', { campaignId: 'camp-1' });
  assert.equal(advanced.body.code, 'OWNER_REQUIRED');
  assert.equal(pool.queries.some((query) => /UPDATE dnd_encounters/.test(query.sql)), false);
});

test('legacy inventory hydration adds bundled gear while preserving live sheet fields and loot', () => {
  const liveAction = { id: 'field-blade', name: 'Field Blade', looted: true };
  const sheet = {
    name: 'Bram', ac: 19, actions: [liveAction],
    inventory: { items: [{ id: 'field-blade', name: 'Field Blade' }], coins: { gp: 77 }, note: 'Keep dry.' },
  };
  const bundled = {
    ac: 16, actions: [{ id: 'longsword', name: 'Longsword' }],
    inventory: { items: [{ id: 'longsword', name: 'Longsword' }], coins: { cp: 2, gp: 10 } },
  };
  const merged = _test.mergeLegacyInventory(sheet, bundled);
  assert.equal(merged.ac, 19);
  assert.deepEqual(merged.actions, [liveAction]);
  assert.deepEqual(merged.inventory.items.map((item) => item.id), ['field-blade', 'longsword']);
  assert.deepEqual(merged.inventory.coins, { cp: 2, gp: 77 });
  assert.equal(merged.inventory.note, 'Keep dry.');
  assert.equal(sheet.inventory.items.length, 1);
});

test('POST /dm returns its archive entry so the calling client can advance its sequence', async () => {
  const pool = new MockPool({});
  const orchestrator = { processMessage: async () => ({ response: 'The torch gutters.\nCHOICES: Wait | Press on | Listen' }) };
  const result = await request(pool, 'player-bram', 'POST', '/dm', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'narrate', message: 'I inspect the door.',
  }, { orchestrator });
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.archiveEntry, {
    seq: 1, kind: 'table-talk', content: '> I inspect the door.\nThe torch gutters.',
  });
  assert.deepEqual(pool.archiveRows, [result.body.archiveEntry]);
});

test('pending presentation rejects DM work before model or archive activity', async () => {
  const pool = new MockPool({});
  const now = Date.now();
  pool.state.presentationGate = {
    id: 'pending-dm', kind: 'opening', sceneId: pool.state.sceneId,
    turnSerial: Number(pool.state.turnSerial) || 0, message: 'Opening.',
    createdAt: now, complete: false, lease: 'host-tab', leaseAt: now,
  };
  let calls = 0;
  const orchestrator = { processMessage: async () => { calls += 1; return { response: 'No.' }; } };
  const result = await request(pool, 'player-bram', 'POST', '/dm', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'narrate', message: 'Act now.',
  }, { orchestrator });
  assert.equal(result.body.code, 'PRESENTATION_PENDING');
  assert.equal(calls, 0);
  assert.equal(pool.archiveRows.length, 0);
});

test('GET /sync always returns seats and sends sheets only when sheetsRev changes', async () => {
  const pool = new MockPool({});
  const initial = await request(pool, 'player-bram', 'GET', '/sync?campaignId=camp-1&rev=7&seq=0&sheetsRev=old');
  const currentRev = initial.body.sheetsRev;
  const same = await request(pool, 'player-bram', 'GET', `/sync?campaignId=camp-1&rev=7&seq=0&sheetsRev=${currentRev}`);
  assert.equal(same.body.players.length, 1);
  assert.equal(same.body.sheetsRev, currentRev);
  assert.equal('sheets' in same.body, false);

  pool.sheets.bram.actions.push({ name: 'Goblin Knife', looted: true });
  const changed = await request(pool, 'player-bram', 'GET', `/sync?campaignId=camp-1&rev=7&seq=0&sheetsRev=${currentRev}`);
  assert.equal(changed.body.players.length, 1);
  assert.notEqual(changed.body.sheetsRev, currentRev);
  assert.equal(changed.body.sheets.bram.actions.at(-1).name, 'Goblin Knife');
});
