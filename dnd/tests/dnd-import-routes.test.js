/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:04:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard character preview, file import, and campaign seating through the public authenticated route surface.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { createDndRoutes, _test } = require('../routes/dnd-routes.js');

const root = path.join(__dirname, '..');
const bundled = require('../data/party.json').party.concat(require('../data/srd-roster.json').roster);

function responseCapture() {
  let raw = '';
  return {
    res: {
      statusCode: 0,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      end(value) { raw = String(value || ''); },
    },
    body() { return JSON.parse(raw); },
  };
}

async function request(ctx, method, url, body, chunks) {
  const capture = responseCapture();
  const req = chunks ? Readable.from(chunks) : new Readable({ read() { this.push(null); } });
  Object.assign(req, { method, url, body, oidc: { user: { sub: 'player-1', name: 'Alice' } } });
  await createDndRoutes({ appPackageDir: root, ...ctx })(req, capture.res, () => {
    throw new Error('route unexpectedly fell through');
  });
  return { status: capture.res.statusCode, body: capture.body() };
}

function manualHero(name, id) {
  return {
    id,
    name,
    race: 'Human',
    class: 'Fighter',
    level: 1,
    ac: 15,
    maxHp: 11,
    speed: 30,
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 10 },
    actions: [{ name: 'Longsword', type: 'weapon', mode: 'attack', delivery: 'melee' }],
  };
}

test('campaign parties require four distinct available heroes and accept validated imports', () => {
  const custom = manualHero('Aria Nightwind', 'aria-nightwind');
  const chosen = _test.campaignParty(
    { party: ['bram', 'della', 'pip', 'aria-nightwind'], customCharacters: [custom] },
    bundled,
    ['bram', 'della', 'pip', 'mira']
  );
  assert.deepEqual(chosen.map((hero) => hero.id), ['bram', 'della', 'pip', 'aria-nightwind']);
  assert.equal(chosen[3].inventory.items[0].actionId, chosen[3].actions[0].id);
  assert.throws(
    () => _test.campaignParty({ party: ['bram', 'bram', 'pip', 'mira'] }, bundled, []),
    (err) => err && err.code === 'INVALID_PARTY'
  );
  assert.throws(
    () => _test.campaignParty({ party: ['bram', 'della', 'pip'] }, bundled, []),
    (err) => err && err.code === 'INVALID_PARTY'
  );
});

test('manual preview returns a playable normalized character', async () => {
  const result = await request({ pool: {} }, 'POST', '/character/import', { character: {
    name: 'No Weapon Yet',
    abilities: { str: 12, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.sheet.actions[0].name, 'Unarmed Strike');
  assert.deepEqual(Object.keys(result.body.sheet.inventory.coins), ['cp', 'sp', 'ep', 'gp', 'pp']);
});

test('raw JSON upload can exceed the global JSON-parser limit without base64', async () => {
  const json = JSON.stringify({ ...manualHero('Large Local Export', 'large-local'), notes: 'x'.repeat(120 * 1024) });
  const result = await request(
    { pool: {} },
    'POST',
    '/character/import-file?filename=hero.json',
    undefined,
    [Buffer.from(json)]
  );
  assert.equal(Buffer.byteLength(json) > 100 * 1024, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.sheet.name, 'Large Local Export');
});

class LobbyPool {
  constructor() {
    this.state = {
      mode: 'setup', sceneId: 'coast-road', order: [], turnIndex: 0, round: 0,
      tokens: ['bram', 'della', 'pip', 'mira'].map((slug, i) => ({
        id: slug, slug, kind: 'pc', name: slug, x: i + 1, y: 1,
        hp: 10, maxHp: 10, ac: 12, speed: 30, color: '#ffffff', glyph: '@', slots: {}, initiative: 0,
      })),
    };
    this.rev = 1;
    this.players = [{ user_sub: 'player-1', display_name: 'Alice', character_slug: null }];
    this.sheets = Object.fromEntries(['bram', 'della', 'pip', 'mira'].map((slug) => [slug, { id: slug, name: slug }]));
    this.client = {
      query: (sql, params) => this.clientQuery(sql, params),
      release() {},
    };
  }

  rows(rows) { return { rowCount: rows.length, rows }; }

  async connect() { return this.client; }

  async query(sql, params) {
    if (/SELECT c\.\*,/.test(sql)) return this.rows([{ campaign_id: 'camp-1', user_sub: 'host', is_owner: false }]);
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) {
      return this.rows(Object.entries(this.sheets).map(([slug, sheet]) => ({ slug, sheet })));
    }
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) return this.rows(this.players);
    throw new Error('Unexpected pool SQL: ' + sql);
  }

  async clientQuery(sql, params) {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return this.rows([]);
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return this.rows([{ state: this.state, rev: this.rev }]);
    if (/SELECT user_sub, character_slug FROM dnd_players/.test(sql)) return this.rows(this.players);
    if (/UPDATE dnd_characters/.test(sql)) {
      const [nextSlug, name, sheetJson, _level, _campaignId, oldSlug] = params;
      delete this.sheets[oldSlug];
      this.sheets[nextSlug] = JSON.parse(sheetJson);
      this.sheets[nextSlug].name = name;
      return this.rows([{}]);
    }
    if (/INSERT INTO dnd_players/.test(sql)) {
      this.players[0].display_name = params[2];
      this.players[0].character_slug = params[3];
      return this.rows([]);
    }
    if (/UPDATE dnd_encounters SET state=/.test(sql)) {
      this.state = JSON.parse(params[0]);
      this.rev++;
      return this.rows([{ rev: this.rev }]);
    }
    throw new Error('Unexpected client SQL: ' + sql);
  }
}

test('a joined player can replace an open setup seat with their imported hero and is auto-claimed', async () => {
  const pool = new LobbyPool();
  const result = await request(
    { pool },
    'POST',
    '/character/seat',
    { campaignId: 'camp-1', character: manualHero('Aria Nightwind', 'aria-nightwind') }
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.rev, 2);
  assert.equal(result.body.players[0].slug, 'aria-nightwind');
  assert.equal(result.body.state.tokens.filter((token) => token.kind === 'pc').length, 4);
  assert.equal(result.body.state.tokens.some((token) => token.slug === 'aria-nightwind'), true);
  assert.equal(result.body.sheets['aria-nightwind'].name, 'Aria Nightwind');
});
