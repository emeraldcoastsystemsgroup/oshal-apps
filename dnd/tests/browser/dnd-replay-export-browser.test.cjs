/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Browser contract test for Timeline Playback cutaway previews, board-revision coverage, and read-only Markdown/HTML/JSON recap export at desktop and phone viewports with zero page errors and zero horizontal overflow.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { playwright, openPage } = require('./phone-fixture.cjs');

const UI = path.resolve(__dirname, '../../ui');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) {
  if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);
}
FILES['/api/dnd/art/map/coast-road'] = path.resolve(__dirname, '../../data/maps/coast-road.jpg');
FILES['/api/dnd/cutaway/c1/ambush.png'] = path.resolve(__dirname, '../../data/maps/coast-road.jpg');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 412, height: 915 },
];

const PLAYBACK_FEED = {
  ok: true,
  readOnly: true,
  ended: true,
  mode: 'complete',
  campaign: { campaign_id: 'c1', name: 'Coast Road Legend', adventure_id: 'goblin-ambush', status: 'archived', is_owner: true },
  coverage: { archiveEntries: 3, exactBoards: 3, archiveOnlyEntries: 1, boardRevisions: 2, cutaways: 1 },
  cutaways: [{ url: '/api/dnd/cutaway/c1/ambush.png', title: 'discovery cutaway', caption: 'Lantern light spills across the wrecked cart.', kind: 'cutaway', key: 'ambush', archiveSeq: 2 }],
  frames: [
    {
      id: 'archive-1', type: 'archive', seq: 1, archiveSeq: 1, kind: 'milestone',
      content: 'The party reaches the broken cart.', createdAt: '2026-11-25T10:00:00Z',
      fidelity: 'exact-board', fidelityNote: 'Exact board revision captured alongside this story beat.',
      board: { sceneId: 'coast-road', mode: 'combat', round: 1, tokens: [{ id: 'bram', kind: 'pc', name: 'Bram', x: 3, y: 4, hp: 12, maxHp: 12 }] },
    },
    {
      id: 'archive-2', type: 'archive', seq: 2, archiveSeq: 2, kind: 'cutaway',
      content: '/api/dnd/cutaway/c1/ambush.png', createdAt: '2026-11-25T10:01:00Z',
      fidelity: 'exact-board', fidelityNote: 'Exact board revision captured alongside this story beat.',
      cutaway: { url: '/api/dnd/cutaway/c1/ambush.png', title: 'discovery cutaway', caption: 'Lantern light spills across the wrecked cart.', kind: 'cutaway', key: 'ambush', archiveSeq: 2 },
      board: { sceneId: 'coast-road', mode: 'combat', round: 1, tokens: [{ id: 'bram', kind: 'pc', name: 'Bram', x: 5, y: 4, hp: 10, maxHp: 12 }] },
    },
    {
      id: 'snapshot-s1', type: 'snapshot', snapshotId: 's1', archiveSeq: 2, label: 'Before the boss',
      createdAt: '2026-11-25T10:02:00Z', fidelity: 'exact-board', fidelityNote: 'Exact saved board.',
      branch: 'current', restorable: true,
      board: { sceneId: 'coast-road', mode: 'complete', round: 2, tokens: [{ id: 'bram', kind: 'pc', name: 'Bram', x: 6, y: 4, hp: 9, maxHp: 12 }] },
    },
  ],
};

const READS = {
  '/api/dnd/campaigns': { campaigns: [PLAYBACK_FEED.campaign] },
  '/api/dnd/characters': { characters: [] },
  '/api/dnd/playback': PLAYBACK_FEED,
  '/api/dnd/replay-export': '# Coast Road Legend — Campaign Recap\n',
};

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const vp of VIEWPORTS) {
  test(`Timeline Playback shows cutaway art, coverage, and read-only Export Recap at ${vp.width}x${vp.height}`, async () => {
    const opened = await openPage(browser, vp, { url: '/api/dnd/table', files: FILES, reads: READS });
    const { page, context, writes } = opened;
    const pageErrors = [];
    const exportGets = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) => {
      if (req.url().includes('/api/dnd/replay-export')) exportGets.push({ method: req.method(), url: req.url() });
    });
    try {
      await page.waitForFunction(() => typeof showCampaignPlayback === 'function');
      await page.evaluate(() => showCampaignPlayback('c1', { table: true, backLabel: 'Return to Game' }));
      await page.locator('#playbackExportMd').waitFor();
      assert.match(await page.locator('#playbackCoverage').innerText(), /3 exact board frames · 1 cutaways/);
      assert.equal(await page.locator('#playbackExportHtml').isVisible(), true);
      assert.equal(await page.locator('#playbackExportJson').isVisible(), true);

      await page.click('[data-playback-index="1"]');
      await page.locator('.playback-cutaway img').waitFor();
      assert.match(await page.locator('.playback-cutaway figcaption').innerText(), /Lantern light spills/);

      await page.click('[data-playback-index="0"]');
      assert.equal(await page.locator('.playback-cutaway').count(), 0);

      await page.click('#playbackExportMd');
      await page.click('#playbackExportHtml');
      await page.click('#playbackExportJson');
      await page.waitForTimeout(150);

      assert.equal(exportGets.length, 3);
      assert.ok(exportGets.every((item) => item.method === 'GET'));
      assert.ok(exportGets.some((item) => item.url.includes('format=md')));
      assert.ok(exportGets.some((item) => item.url.includes('format=html')));
      assert.ok(exportGets.some((item) => item.url.includes('format=json')));

      const overflow = await page.evaluate(() => ({
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        cardOverflow: document.getElementById('overlayCard').scrollWidth - document.getElementById('overlayCard').clientWidth,
      }));
      assert.ok(overflow.docOverflow <= 1, `horizontal document overflow at ${vp.width}: ${JSON.stringify(overflow)}`);
      assert.ok(overflow.cardOverflow <= 2, `horizontal card overflow at ${vp.width}: ${JSON.stringify(overflow)}`);
      assert.deepEqual(writes, [], 'playback and recap export must never issue mutating requests');
      assert.deepEqual(pageErrors, [], 'zero page errors allowed');
    } finally {
      await context.close();
    }
  });
}
