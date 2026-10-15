/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com     | Live 2026-10-11: My Games listed a host's test campaigns with only Resume; nothing could remove them. The campaign service runs against an in-memory table set with no foreign-key cascade (as the native kernel stores package rows): the host's confirmed delete removes the campaign and every child row while saved library characters stay; a player, an unconfirmed request and a missing campaign remove nothing. The route and the My Games button are wired.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCampaignService } = require('../lib/dnd-campaign-service');

const CAMPAIGN = '33333333-3333-3333-3333-333333333333';
const HOST = 'host-sub';
const PLAYER = 'player-sub';

function tables() {
  return {
    dnd_campaigns: [{ campaign_id: CAMPAIGN, user_sub: HOST }],
    dnd_encounters: [{ campaign_id: CAMPAIGN }],
    dnd_players: [{ campaign_id: CAMPAIGN, user_sub: PLAYER }],
    dnd_archive: [{ campaign_id: CAMPAIGN }, { campaign_id: CAMPAIGN }],
    dnd_snapshots: [{ campaign_id: CAMPAIGN }],
    dnd_characters: [{ campaign_id: CAMPAIGN, user_sub: HOST }, { campaign_id: null, user_sub: HOST }],
  };
}

/** A pool over plain rows: SELECT by campaign id and DELETE by campaign id (and owner), no cascades. */
function rowsPool(store) {
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
    const select = /^SELECT campaign_id, user_sub FROM dnd_campaigns WHERE campaign_id = \$1/.exec(sql);
    if (select) {
      const rows = store.dnd_campaigns.filter((r) => r.campaign_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    const del = /^DELETE FROM (\w+) WHERE campaign_id = \$1( AND user_sub = \$2)?$/.exec(sql);
    if (del) {
      const before = store[del[1]].length;
      store[del[1]] = store[del[1]].filter((r) => !(r.campaign_id === params[0] && (!del[2] || r.user_sub === params[1])));
      return { rows: [], rowCount: before - store[del[1]].length };
    }
    throw new Error(`unexpected statement: ${sql}`);
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

test('the host deletes a campaign and every row that belongs to it, keeping library characters', async () => {
  const store = tables();
  const service = createCampaignService({ pool: rowsPool(store) });
  const out = await service.deleteCampaign(HOST, { campaignId: CAMPAIGN, confirm: true });
  assert.deepEqual(out, { ok: true, campaignId: CAMPAIGN, deleted: true });
  for (const table of ['dnd_campaigns', 'dnd_encounters', 'dnd_players', 'dnd_archive', 'dnd_snapshots']) {
    assert.equal(store[table].length, 0, `${table} emptied`);
  }
  assert.deepEqual(store.dnd_characters, [{ campaign_id: null, user_sub: HOST }], 'the saved library character stays');
});

test('a player, an unconfirmed request and a missing campaign delete nothing', async () => {
  const store = tables();
  const service = createCampaignService({ pool: rowsPool(store) });
  assert.equal((await service.deleteCampaign(PLAYER, { campaignId: CAMPAIGN, confirm: true })).code, 'HOST_REQUIRED');
  assert.equal((await service.deleteCampaign(HOST, { campaignId: CAMPAIGN })).code, 'CONFIRM_REQUIRED');
  const missing = await service.deleteCampaign(HOST, { campaignId: '44444444-4444-4444-4444-444444444444', confirm: true });
  assert.equal(missing.code, 'CAMPAIGN_NOT_FOUND');
  assert.deepEqual(store, tables());
});

test('the route and the My Games host button are wired', () => {
  const root = path.join(__dirname, '..');
  const routes = fs.readFileSync(path.join(root, 'routes', 'dnd-routes.js'), 'utf8');
  assert.match(routes, /'\/campaign\/delete': \(body\) => env\.campaign\.deleteCampaign\(sub, body\)/);
  const screens = fs.readFileSync(path.join(root, 'ui', 'table-screens.js'), 'utf8');
  assert.match(screens, /row\.is_owner \? `<button class="leave" data-delete-campaign=/);
  assert.match(screens, /api\('\/campaign\/delete', \{ method: 'POST', body: JSON\.stringify\(\{ campaignId, confirm: true \}\) \}\)/);
});
