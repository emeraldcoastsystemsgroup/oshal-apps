/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.9 P5 Campaign Attribution & Engagement Funnel on #pane-scorecard
 *     at desktop (1440x900) and phone (412x915): verifies real attributed visits, sign-ups,
 *     purchases, revenue ($49.00), delivery engagement counts, explicit NO DATA badges for
 *     quiet campaigns, opens-omitted note, inline Record conversion submission, zero browser
 *     dialogs, zero page errors, and zero horizontal overflow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const { ORIGIN, playwright, sideways } = require('./browser/today-phone-fixture.cjs');
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');

const CAMP_ALPHA_ID = '11111111-1111-4111-8111-111111111111';
const CAMP_BETA_ID = '22222222-2222-4222-8222-222222222222';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Open tools/marketing-engine.html with stateful attribution funnel mock API. */
async function openAttributionHarness(viewport) {
  const phone = viewport.width <= 640;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const campaigns = [
    { campaign_id: CAMP_ALPHA_ID, name: 'Launch Alpha', slug: 'launch-alpha', product: 'Open Swarm', motion: 'revenue', status: 'active', stage: 2, budget_monthly_usd: 500, channels: ['email'], updated_at: '2026-11-26T00:00:00Z' },
    { campaign_id: CAMP_BETA_ID, name: 'Quiet Beta', slug: 'quiet-beta', product: 'Open Swarm', motion: 'adoption', status: 'active', stage: 1, budget_monthly_usd: 0, channels: [], updated_at: '2026-11-26T00:00:00Z' },
  ];
  const funnel = {
    opensNote: 'Opens are omitted as unreliable',
    totals: {
      attributedVisits: 84, unattributedVisits: 0,
      signups: 1, purchases: 1, activations: 0, revenueCents: 4900,
      delivered: 12, clicked: 4, unsubscribed: 1, bounced: 1, complained: 0,
    },
    campaigns: [
      {
        campaignId: CAMP_ALPHA_ID, campaignSlug: 'launch-alpha', campaignName: 'Launch Alpha', campaignStatus: 'active',
        traffic: { status: 'ok', visits: 84, impressions: 500, events: 2, byMedium: { email: 84 }, bySource: { gsc: 84 } },
        conversions: { status: 'ok', total: 2, signups: 1, purchases: 1, activations: 0, revenueCents: 4900 },
        engagement: { status: 'ok', delivered: 12, clicked: 4, unsubscribed: 1, bounced: 1, complained: 0, opensNote: 'Opens are omitted as unreliable' },
      },
      {
        campaignId: CAMP_BETA_ID, campaignSlug: 'quiet-beta', campaignName: 'Quiet Beta', campaignStatus: 'active',
        traffic: { status: 'NO DATA', visits: 0, impressions: 0, events: 0, byMedium: {}, bySource: {} },
        conversions: { status: 'NO DATA', total: 0, signups: 0, purchases: 0, activations: 0, revenueCents: 0 },
        engagement: { status: 'NO DATA', delivered: 0, clicked: 0, unsubscribed: 0, bounced: 0, complained: 0, opensNote: 'Opens are omitted as unreliable' },
      },
    ],
    unattributed: {
      traffic: { status: 'NO DATA', visits: 0, impressions: 0, events: 0, byMedium: {}, bySource: {} },
      conversions: { status: 'NO DATA', total: 0, signups: 0, purchases: 0, activations: 0, revenueCents: 0 },
      engagement: { status: 'NO DATA', delivered: 0, clicked: 0, unsubscribed: 0, bounced: 0, complained: 0, opensNote: 'Opens are omitted as unreliable' },
    },
  };
  const errors = [];

  await context.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/marketing') return route.fulfill({ status: 200, path: PAGE, contentType: 'text/html; charset=utf-8' });
    if (url.pathname === '/cockpit/js/app-workflows.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function mountConnectedActions(){return Promise.resolve();}' });
    if (url.pathname === '/cockpit/js/app-handoff.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function receiveHandoff(){return Promise.resolve(null);}' });
    if (/\.css$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/\.m?js$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });

    if (url.pathname === '/api/marketing/overview') {
      return json(200, { campaigns, channels: [], scorecard: [], pendingProposals: [], experiments: [], recentRuns: [] });
    }
    if (url.pathname === '/api/marketing/content') return json(200, { items: [] });
    if (url.pathname === '/api/marketing/scorecard') return json(200, { weeks: [] });
    if (url.pathname === '/api/marketing/attribution/funnel' && req.method() === 'GET') {
      return json(200, funnel);
    }
    if (url.pathname === '/api/marketing/attribution/conversions' && req.method() === 'POST') {
      const body = req.postDataJSON();
      const target = funnel.campaigns.find((c) => c.campaignSlug === body.campaignSlug) || funnel.campaigns[0];
      target.conversions.status = 'ok';
      target.conversions.total += 1;
      if (body.kind === 'purchase') {
        target.conversions.purchases += 1;
        funnel.totals.purchases += 1;
      } else if (body.kind === 'signup') {
        target.conversions.signups += 1;
        funnel.totals.signups += 1;
      }
      target.conversions.revenueCents += Number(body.amountCents || 0);
      funnel.totals.revenueCents += Number(body.amountCents || 0);
      return json(201, { conversion: { conversion_id: 'conv-new', ...body }, firstTouchApplied: false });
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#campList tbody.card').length === 2);
  return { context, page, errors };
}

for (const vp of [{ width: 1440, height: 900, label: 'desktop' }, { width: 412, height: 915, label: 'phone' }]) {
  test(`${vp.width}x${vp.height} (${vp.label}): Scorecard Attribution & Engagement Funnel shows real metrics, NO DATA badges, and records conversions with zero overflow`, { timeout: 60000 }, async () => {
    const { context, page, errors } = await openAttributionHarness({ width: vp.width, height: vp.height });
    try {
      await page.click('#tab-scorecard');
      await page.waitForSelector('#pane-scorecard.on #attrFunnelTable');

      const alphaRow = await page.textContent('[data-funnel-campaign="launch-alpha"]');
      const betaRow = await page.textContent('[data-funnel-campaign="quiet-beta"]');
      const opensNote = await page.textContent('#attrOpensNote');

      assert.match(alphaRow, /Launch Alpha/);
      assert.match(alphaRow, /84/);
      assert.match(alphaRow, /\$49\.00/);
      assert.match(alphaRow, /12/);
      assert.match(betaRow, /Quiet Beta/);
      assert.match(betaRow, /NO DATA/);
      assert.match(opensNote, /Opens are omitted as unreliable/);

      // Submit inline Record conversion form ($25.00 purchase on launch-alpha -> $74.00 total).
      await page.selectOption('#attrConvKind', 'purchase');
      await page.selectOption('#attrConvCampaign', 'launch-alpha');
      await page.fill('#attrConvAmount', '25');
      await page.fill('#attrConvRef', 'order-25');
      await page.click('#attrConvSubmitBtn');
      await page.waitForFunction(() => document.querySelector('[data-funnel-campaign="launch-alpha"]')?.textContent?.includes('$74.00'));

      const fit = await sideways(page.mainFrame());
      assert.ok(fit.scrollWidth <= fit.clientWidth, `${vp.label} overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
