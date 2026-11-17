/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.5.10 (lane mobilesweep1, the phone first-screen sweep of 2026-11-16: the campaign list started 362 px down a 915 px phone, 40%, under the title, a two-line tagline, the New campaign / Import row with its note, a chip row and a search row). The real page in a stand-in for Today (tests/browser/today-phone-fixture.cjs) with three synthetic campaigns and every write refused: at 412x915, 390x844 and 360x780 with touch the first campaign starts within the top quarter of the screen under two rows of controls (search, Import and + New; the four status chips, all on screen), the title and tagline are not drawn, nothing scrolls the page sideways and nothing to tap sits under the floating Jarvis button at the end; at 1440x900 the desktop keeps its title, tagline and the note beside Import. Red on 0.5.9.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { SIZES, playwright, openInToday, screenTop, rowLines, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const PAGE = join(here, '..', 'tools', 'marketing-engine.html');
const NOW = '2026-11-16T12:00:00Z';
const campaign = (n, status) => ({ campaign_id: `fixture-${n}`, name: `Fixture campaign ${n}`, slug: `fixture-${n}`, product: 'Open Swarm', motion: 'plg',
  status, stage: 2, budget_monthly_usd: 0, channels: ['linkedin'], updated_at: NOW });
const READS = {
  '/api/marketing/overview': { campaigns: [campaign(1, 'active'), campaign(2, 'active'), campaign(3, 'active')], channels: [], scorecard: [], pendingProposals: [], experiments: [], recentRuns: [] },
  '/api/marketing/content': { items: [] },
  '/api/marketing/scorecard': { weeks: [] },
  '/api/marketing/experiments': { experiments: [] },
  '/api/marketing/proposals': { proposals: [] },
};

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Open the Board inside the stand-in Today and wait for the three campaigns. */
async function openBoard(size) {
  return openInToday(browser, size, { url: '/api/marketing', files: { '/api/marketing': PAGE }, reads: READS,
    // The kernel's connected-actions module, which the Board mounts at its end.
    scripts: { '/cockpit/js/app-workflows.js': 'export function mountConnectedActions() { return Promise.resolve(); }',
      '/cockpit/js/app-handoff.js': 'export function receiveHandoff() { return Promise.resolve(null); }' },
    ready: (frame) => frame.waitForFunction(() => document.querySelectorAll('#campList tbody.card').length === 3, null, { timeout: 15000 }) });
}

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length); }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the campaign list starts right under the Board's controls`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openBoard(size);
    try {
      const first = await screenTop(page, frame, '#campList tbody.card');
      const chips = await rowLines(frame, '#campStatusChips');
      t.diagnostic(`first campaign ${first}px (${Math.round((first / size.height) * 100)}%), chip rows ${chips.join('/')}`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.scrollWidth} > ${fit.clientWidth})`);
      assert.deepEqual(chips, [1], 'the status chips are one row');
      if (phone) {
        assert.ok(first <= size.height * 0.25, `the first campaign starts within the top quarter: ${first}px of ${size.height}`);
        assert.equal(await drawn(frame, '.head'), false, 'Today\'s bar names the page; its title and tagline are not drawn again');
        const search = await frame.locator('#campSearch').boundingBox(), add = await frame.locator('#newCampBtn').boundingBox();
        assert.ok(Math.abs(search.y - add.y) < 8, 'search and + New campaign share the first row');
        assert.equal(await frame.getByRole('button', { name: 'Import', exact: true }).isVisible(), true, 'Import keeps its name');
        assert.equal(await frame.getByRole('button', { name: 'New campaign' }).isVisible(), true, '+ New keeps its name, New campaign');
        const chipsIn = await frame.evaluate(() => [...document.querySelectorAll('#campStatusChips .chip')].every((c) => c.getBoundingClientRect().right <= document.documentElement.clientWidth));
        assert.equal(chipsIn, true, 'the four status chips are all on screen');
        assert.ok(search.width >= 160, `the search field is wide enough to type in (${Math.round(search.width)}px)`);
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap under the floating Jarvis button at the end');
      } else {
        assert.equal(await drawn(frame, '.head'), true, 'the desktop keeps its title and tagline');
        assert.ok(first <= size.height * 0.5, `the desktop list: ${first}px`);
      }
      assert.deepEqual(writes, [], 'opening the Board writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
