/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.6.4 (NAV-02): headless Chromium browser test verifying Marketing Engine phone (412x915, 390x844, 360x780 — framed in Today and standalone with 2-digit counts) navigation and filter strips (.tabs, #campStatusChips, .stages) render strictly on 1 row with single-line nowrap >=44px/48px touch targets, horizontal overflow scrolling, More popover access to Experiments and Compliance, zero page-level overflow, and clean 1440x900 desktop rendering.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const { ORIGIN, playwright, openInToday, sideways } = require('./browser/today-phone-fixture.cjs');
const tpl = require(join(pkgDir, 'routes', 'marketing-templates.js'));
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');
const NOW = '2026-11-25T12:00:00Z';

const PHONE_SIZES = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
];

const STUB_SCRIPTS = {
  '/cockpit/js/app-workflows.js': 'export function mountConnectedActions(){return Promise.resolve();}',
  '/cockpit/js/app-handoff.js': 'export function receiveHandoff(){return Promise.resolve(null);}',
};

function makeReads(campaignCount, proposalCount) {
  const campaigns = Array.from({ length: campaignCount }, (_, i) => ({
    campaign_id: `camp-${i + 1}`,
    name: `Campaign ${i + 1}`,
    slug: `campaign-${i + 1}`,
    product: 'Open Swarm',
    motion: 'adoption',
    status: 'active',
    stage: 1,
    budget_monthly_usd: 0,
    channels: ['linkedin', 'email'],
    updated_at: NOW,
  }));
  const pendingProposals = Array.from({ length: proposalCount }, (_, i) => ({
    entry_id: `prop-${i + 1}`,
    campaign_id: 'camp-1',
    channel: 'linkedin',
    field: 'daily_cap',
    old_value: 0,
    new_value: 2,
    status: 'proposed',
    created_at: NOW,
  }));
  return {
    '/api/marketing/overview': {
      campaigns,
      channels: [{ channel: 'linkedin', enabled: false, daily_cap: 0 }],
      scorecard: [],
      pendingProposals,
      experiments: [{ experiment_id: 'exp-1', hypothesis: 'Shorter headline', variable: 'headline', ice_impact: 5, ice_confidence: 5, ice_ease: 5, status: 'running', created_at: NOW }],
      recentRuns: [],
    },
    '/api/marketing/content': { items: [] },
    '/api/marketing/scorecard': { weeks: [] },
    '/api/marketing/experiments': { experiments: [] },
    '/api/marketing/budget/proposals': { proposals: pendingProposals },
    '/api/marketing/compliance': {
      settings: tpl.DEFAULT_COMPLIANCE_SETTINGS,
      updatedAt: null,
      readiness: tpl.complianceReadiness(tpl.DEFAULT_COMPLIANCE_SETTINGS),
      counts: { contactCount: 0, confirmedConsentCount: 0, suppressionCount: 0 },
    },
    '/api/marketing/audience/suppressions': { suppressions: [] },
    '/api/marketing/audience/signup-forms': { forms: [] },
    '/api/marketing/audience/lists': { lists: [] },
    '/api/marketing/audience/contacts': { contacts: [], total: 0 },
  };
}

async function measureStrip(target, selector) {
  return target.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const kids = [...el.children].filter((k) => k.getClientRects().length > 0 && getComputedStyle(k).display !== 'none');
    const tops = [];
    for (const k of kids) {
      const top = Math.round(k.getBoundingClientRect().top);
      if (!tops.some((t) => Math.abs(t - top) <= 3)) tops.push(top);
    }
    const items = kids.map((k) => {
      const btn = k.matches('button') ? k : (k.querySelector('button') || k);
      const br = btn.getBoundingClientRect();
      const bcs = getComputedStyle(btn);
      const range = document.createRange();
      range.selectNodeContents(btn);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      const mids = [];
      for (const r of rects) {
        const mid = r.top + r.height / 2;
        if (!mids.some((y) => Math.abs(y - mid) <= 4)) mids.push(mid);
      }
      return {
        id: btn.id || '',
        text: (btn.textContent || '').trim().replace(/\s+/g, ' '),
        height: Math.round(br.height),
        whiteSpace: bcs.whiteSpace,
        flexShrink: bcs.flexShrink,
        lineCount: mids.length,
      };
    });
    return {
      distinctTopRows: tops.length,
      flexWrap: cs.flexWrap,
      overflowX: cs.overflowX,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      items,
    };
  }, selector);
}

function assertSingleRow(strip, label, opts) {
  assert.ok(strip && strip.items.length > 0, `${label}: expected visible items`);
  assert.equal(strip.distinctTopRows, 1, `${label}: expected 1 row, got ${strip.distinctTopRows}`);
  if (opts.expectNowrapStrip) {
    assert.equal(strip.flexWrap, 'nowrap', `${label}: expected flex-wrap nowrap`);
    assert.ok(['auto', 'scroll'].includes(strip.overflowX), `${label}: expected overflow-x auto/scroll, got ${strip.overflowX}`);
  }
  for (const item of strip.items) {
    assert.equal(item.lineCount, 1, `${label} "${item.text}": wrapped onto ${item.lineCount} lines`);
    assert.equal(item.whiteSpace, 'nowrap', `${label} "${item.text}": expected white-space nowrap`);
    if (opts.expectNoShrink) assert.equal(item.flexShrink, '0', `${label} "${item.text}": expected flex-shrink 0`);
    if (opts.minHeight) assert.ok(item.height >= opts.minHeight, `${label} "${item.text}": height ${item.height} < ${opts.minHeight}`);
  }
}

async function openStandalone(browser, size, reads) {
  const phone = size.width <= 640;
  const context = await browser.newContext({ viewport: size, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const errors = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/api/marketing') return route.fulfill({ status: 200, path: PAGE, contentType: 'text/html; charset=utf-8' });
    if (STUB_SCRIPTS[url.pathname]) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SCRIPTS[url.pathname] });
    if (Object.prototype.hasOwnProperty.call(reads, url.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads[url.pathname]) });
    }
    if (/\.css$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/\.m?js$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#campList tbody.card').length > 0, null, { timeout: 15000 });
  return { context, page, errors };
}

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

for (const size of PHONE_SIZES) {
  test(`Framed phone ${size.width}x${size.height}: .tabs, #campStatusChips, .stages stay single-row and More reaches Experiments + Compliance`, { timeout: 60000 }, async () => {
    const reads = makeReads(3, 1);
    const { frame, context, writes, errors } = await openInToday(browser, size, {
      url: '/api/marketing',
      files: { '/api/marketing': PAGE },
      reads,
      scripts: STUB_SCRIPTS,
      ready: (f) => f.waitForFunction(() => document.querySelectorAll('#campList tbody.card').length === 3, null, { timeout: 15000 }),
    });
    try {
      const tabs = await measureStrip(frame, '.tabs');
      assertSingleRow(tabs, `${size.width}x${size.height} .tabs`, { expectNowrapStrip: true, expectNoShrink: true, minHeight: 48 });
      assert.equal(tabs.items.length, 5, 'phone bottom bar exposes 5 tab slots');

      const chips = await measureStrip(frame, '#campStatusChips');
      assertSingleRow(chips, `${size.width}x${size.height} #campStatusChips`, { expectNowrapStrip: true, expectNoShrink: true, minHeight: 44 });

      await frame.click('#campList tbody.card [data-toggle]');
      await frame.waitForSelector('#campList tr.detail-row.show');
      const stages = await measureStrip(frame, '.stages');
      assertSingleRow(stages, `${size.width}x${size.height} .stages`, { expectNowrapStrip: true, expectNoShrink: true, minHeight: 44 });

      const boardFit = await sideways(frame);
      assert.ok(boardFit.scrollWidth <= size.width, `Board scrollWidth ${boardFit.scrollWidth} > ${size.width}`);

      await frame.click('#tab-more');
      await frame.waitForSelector('#morePopover.show');
      await frame.click('#moreExperiments');
      await frame.waitForSelector('#pane-experiments.on');
      const expFit = await sideways(frame);
      assert.ok(expFit.scrollWidth <= size.width, `Experiments scrollWidth ${expFit.scrollWidth} > ${size.width}`);

      await frame.click('#tab-more');
      await frame.waitForSelector('#morePopover.show');
      await frame.click('#moreCompliance');
      await frame.waitForSelector('#pane-compliance.on');
      const compFit = await sideways(frame);
      assert.ok(compFit.scrollWidth <= size.width, `Compliance scrollWidth ${compFit.scrollWidth} > ${size.width}`);

      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

test('Standalone phone 360x780 & 412x915 with 2-digit counts keep .tabs single-row scrollable without clipping or wrapping', { timeout: 60000 }, async () => {
  const reads = makeReads(12, 12);
  for (const size of [{ width: 412, height: 915 }, { width: 360, height: 780 }]) {
    const { context, page, errors } = await openStandalone(browser, size, reads);
    try {
      const tabs = await measureStrip(page, '.tabs');
      assertSingleRow(tabs, `standalone ${size.width}x${size.height} .tabs`, { expectNowrapStrip: true, expectNoShrink: true, minHeight: 48 });
      const fit = await sideways(page.mainFrame());
      assert.ok(fit.scrollWidth <= size.width, `standalone scrollWidth ${fit.scrollWidth} > ${size.width}`);
      await page.click('#tab-more');
      await page.waitForSelector('#morePopover.show');
      await page.click('#moreCompliance');
      await page.waitForSelector('#pane-compliance.on');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test('Desktop 1440x900 renders all 6 tabs on 1 row with single-line labels, zero overflow, and zero page errors', { timeout: 60000 }, async () => {
  const reads = makeReads(3, 1);
  const { context, page, errors } = await openStandalone(browser, { width: 1440, height: 900 }, reads);
  try {
    const tabs = await measureStrip(page, '.tabs');
    assertSingleRow(tabs, 'desktop .tabs', { expectNowrapStrip: false, expectNoShrink: true, minHeight: 40 });
    assert.equal(tabs.items.length, 6, 'desktop renders all 6 tabs directly');
    const chips = await measureStrip(page, '#campStatusChips');
    assertSingleRow(chips, 'desktop #campStatusChips', { expectNowrapStrip: false, expectNoShrink: true });
    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= 1440, `desktop scrollWidth ${fit.scrollWidth} > 1440`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
