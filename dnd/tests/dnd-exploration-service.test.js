/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 13:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove authored clues are shared, prerequisite-gated, and host-completed only after enough evidence.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createExplorationService } = require('../lib/dnd-exploration-service');

const scene = {
  id: 'mystery-square',
  title: 'Mystery Square',
  afterword: 'The party follows the evidence.',
  exploration: {
    required: 2,
    leads: [
      { id: 'cup', name: 'Silver Cup', reveal: 'The rim carries poison.' },
      { id: 'ledger', name: 'Hidden Ledger', requires: ['cup'], reveal: 'The payment names an accomplice.' },
    ],
  },
};

/** @description Create a deterministic exploration database double. */
function makePool(state, rev = 4) {
  return {
    state: JSON.parse(JSON.stringify(state)),
    rev,
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/SELECT state, rev FROM dnd_encounters/.test(sql)) {
        return { rowCount: 1, rows: [{ state: this.state, rev: this.rev }] };
      }
      if (/UPDATE dnd_encounters SET state=/.test(sql)) {
        this.state = JSON.parse(params[0]); this.rev += 1;
        return { rowCount: 1, rows: [{ rev: this.rev }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

/** @description Assemble the service around one campaign and archive recorder. */
function makeService(pool, owner = true) {
  const archive = [];
  const campaign = {
    access: async () => ({ campaign_id: 'camp-1', user_sub: 'host', is_owner: owner }),
    appendArchive: async (_db, _sub, _id, kind, content) => {
      const entry = { seq: archive.length + 1, kind, content }; archive.push(entry); return entry;
    },
  };
  return { archive, service: createExplorationService({ pool, campaign, sceneById: () => scene }) };
}

test('discoveries enforce prerequisites and persist one shared authored reveal', async () => {
  const pool = makePool({ mode: 'exploration', sceneId: scene.id, exploration: { discovered: [] } });
  const { archive, service } = makeService(pool);
  const locked = await service.act('guest', { campaignId: 'camp-1', leadId: 'ledger' });
  assert.equal(locked.code, 'LEAD_LOCKED');
  assert.equal(pool.rev, 4);

  const found = await service.act('guest', { campaignId: 'camp-1', leadId: 'cup' });
  assert.equal(found.ok, true);
  assert.deepEqual(found.state.exploration.discovered, ['cup']);
  assert.equal(found.narration, 'The rim carries poison.');
  assert.deepEqual(archive.map((entry) => entry.kind), ['discovery']);
});

test('only the host can complete an investigation after the evidence threshold', async () => {
  const state = {
    mode: 'exploration', sceneId: scene.id,
    exploration: { discovered: ['cup', 'forged-answer', 'another-forgery'] },
  };
  const guestPool = makePool(state), guest = makeService(guestPool, false).service;
  assert.equal((await guest.act('guest', { campaignId: 'camp-1', action: 'complete' })).code, 'OWNER_REQUIRED');

  const hostPool = makePool(state), hostBundle = makeService(hostPool);
  assert.equal((await hostBundle.service.act('host', { campaignId: 'camp-1', action: 'complete' })).code, 'MORE_CLUES_REQUIRED');
  hostPool.state.exploration.discovered.push('ledger');
  const completed = await hostBundle.service.act('host', { campaignId: 'camp-1', action: 'complete' });
  assert.equal(completed.complete, true);
  assert.equal(completed.state.mode, 'resolved');
  assert.deepEqual(completed.state.exploration.discovered, ['cup', 'ledger']);
  assert.deepEqual(hostBundle.archive.map((entry) => entry.kind), ['milestone']);
});
