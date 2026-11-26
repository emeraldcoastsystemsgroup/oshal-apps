/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.8 P2 campaign-to-finance-project link and channel_allocation
 *     proposals at desktop (1440x900) and phone (412x915): verifies expanding a campaign,
 *     clicking Create budget in Finance (POST /api/finance/projects + POST /api/marketing/campaigns/:id/finance-project),
 *     displaying identical Budget/Committed/Actual/Variance figures from Finance summary,
 *     approving a channel_allocation proposal via the in-page confirm modal, honest fallback
 *     when Finance returns 404, zero browser dialogs, zero page errors, and zero horizontal overflow.
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

const CAMP_ID = '11111111-1111-4111-8111-111111111111';
const FIN_PROJ_ID = '22222222-2222-4222-8222-222222222222';
const PROP_ID = '33333333-3333-4333-8333-333333333333';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Open tools/marketing-engine.html with stateful Marketing + Finance mock API routes. */
async function openBudgetHarness(viewport, { financeUnavailable = false } = {}) {
  const phone = viewport.width <= 640;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const campaigns = [{
    campaign_id: CAMP_ID, name: 'Q4 Finance Linked Campaign', slug: 'q4-finance-linked',
    product: 'Open Swarm', motion: 'revenue', status: 'active', stage: 2,
    budget_monthly_usd: 1000, channels: ['email', 'linkedin'],
    channel_allocations: { email: 40000, linkedin: 60000 },
    finance_project_id: null, updated_at: '2026-11-26T00:00:00Z',
  }];
  const proposals = [{
    entry_id: PROP_ID, campaign_id: CAMP_ID, channel: 'linkedin->email',
    field: 'channel_allocation',
    old_value: JSON.stringify({ email: 40000, linkedin: 60000 }),
    new_value: JSON.stringify({ fromChannel: 'linkedin', toChannel: 'email', deltaCents: 12000, allocations: { email: 52000, linkedin: 48000 }, rationale: 'Move $120 to email' }),
    status: 'proposed', proposed_by: 'weekly-review', created_at: '2026-11-26T00:00:00Z',
  }];
  let financeSummary = null;
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
      return json(200, { campaigns, channels: [], scorecard: [], pendingProposals: proposals.filter((p) => p.status === 'proposed'), experiments: [], recentRuns: [] });
    }
    if (url.pathname === '/api/marketing/content') return json(200, { items: [] });
    if (url.pathname === '/api/marketing/budget/proposals') return json(200, { proposals });

    if (url.pathname === '/api/finance/projects' && req.method() === 'POST') {
      if (financeUnavailable) return json(404, { error: 'not_found' });
      const body = req.postDataJSON();
      const lines = (body.lines || []).map((l, i) => ({
        lineId: `44444444-4444-4444-8444-44444444444${i + 1}`,
        name: l.name, channel: l.channel, budgetCents: l.budgetCents,
        committedCents: 0, actualCents: i === 0 ? 15000 : 25000,
        varianceCents: l.budgetCents - (i === 0 ? 15000 : 25000),
      }));
      const totalBudgetCents = lines.reduce((s, l) => s + l.budgetCents, 0) || body.budgetCents;
      const totalActualCents = lines.reduce((s, l) => s + l.actualCents, 0);
      financeSummary = {
        project: { projectId: FIN_PROJ_ID, name: body.name, currency: 'USD', status: 'active', budgetCents: totalBudgetCents, externalRef: body.externalRef },
        totalBudgetCents, totalCommittedCents: 0, totalActualCents,
        totalVarianceCents: totalBudgetCents - totalActualCents,
        overBudget: totalActualCents > totalBudgetCents,
        lines, actuals: [],
      };
      return json(201, financeSummary);
    }
    if (url.pathname === `/api/finance/projects/${FIN_PROJ_ID}/summary` && req.method() === 'GET') {
      if (!financeSummary) return json(404, { error: 'project_not_found' });
      return json(200, financeSummary);
    }
    if (url.pathname === `/api/marketing/campaigns/${CAMP_ID}/finance-project` && req.method() === 'POST') {
      const body = req.postDataJSON();
      campaigns[0].finance_project_id = body.financeProjectId;
      return json(200, { campaign: campaigns[0], financeProjectId: body.financeProjectId });
    }
    if (url.pathname === `/api/marketing/budget/proposals/${PROP_ID}/decide` && req.method() === 'POST') {
      const body = req.postDataJSON();
      if (body.decision === 'approve' && body.confirm !== true) return json(428, { error: 'confirmation_required' });
      proposals[0].status = body.decision === 'approve' ? 'applied' : 'rejected';
      proposals[0].decided_by = 'owner-a';
      if (body.decision === 'approve') {
        campaigns[0].channel_allocations = { email: 52000, linkedin: 48000 };
        if (financeSummary) {
          financeSummary.lines[0].budgetCents = 52000;
          financeSummary.lines[1].budgetCents = 48000;
        }
      }
      return json(200, { proposal: proposals[0], campaign: campaigns[0], financeSynced: true });
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#campList tbody.card').length === 1);
  return { context, page, errors, getFinanceSummary: () => financeSummary };
}

test('1440x900 desktop: Create budget in Finance links project, displays identical summary numbers, and approves channel_allocation proposal', { timeout: 60000 }, async () => {
  const { context, page, errors, getFinanceSummary } = await openBudgetHarness({ width: 1440, height: 900 });
  try {
    await page.click('#campList tbody.card [data-toggle]');
    await page.waitForSelector(`[data-create-budget="${CAMP_ID}"]`);
    await page.click(`[data-create-budget="${CAMP_ID}"]`);

    await page.waitForSelector(`[data-finance-totals="${CAMP_ID}"]`);
    const totalsText = await page.textContent(`[data-finance-totals="${CAMP_ID}"]`);
    const fin = getFinanceSummary();
    assert.ok(fin && fin.project.externalRef === `marketing:campaign:${CAMP_ID}`);
    assert.match(totalsText, /Budget\s+\$1,000\.00/);
    assert.match(totalsText, /Actual\s+\$400\.00/);
    assert.match(totalsText, /Variance\s+\$600\.00/);

    // Switch to Approvals tab and approve channel_allocation proposal via in-page confirm modal.
    await page.click('#tab-approvals');
    await page.waitForSelector(`[data-prop="${PROP_ID}"]`);
    const propText = await page.textContent(`[data-prop="${PROP_ID}"]`);
    assert.match(propText, /Shift \$120\.00 from linkedin/);
    await page.click(`[data-prop="${PROP_ID}"] [data-approve]`);
    await page.waitForSelector('#cfScrim.show');
    await page.click('#cfGo');
    await page.waitForFunction((id) => document.querySelector(`[data-prop="${id}"]`)?.textContent?.includes('applied'), PROP_ID);

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `desktop overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('412x915 phone: Create budget in Finance and honest 404 fallback work with zero overflow and zero page errors', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openBudgetHarness({ width: 412, height: 915 });
  try {
    await page.click('#campList tbody.card [data-toggle]');
    await page.waitForSelector(`[data-create-budget="${CAMP_ID}"]`);
    await page.click(`[data-create-budget="${CAMP_ID}"]`);
    await page.waitForSelector(`[data-finance-totals="${CAMP_ID}"]`);
    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `phone overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  // Verify honest fallback when Finance is absent (404).
  const absent = await openBudgetHarness({ width: 412, height: 915 }, { financeUnavailable: true });
  try {
    await absent.page.click('#campList tbody.card [data-toggle]');
    await absent.page.waitForSelector(`[data-create-budget="${CAMP_ID}"]`);
    await absent.page.click(`[data-create-budget="${CAMP_ID}"]`);
    await absent.page.waitForFunction((id) => document.querySelector(`[data-budget-err="${id}"]`)?.classList?.contains('show'), CAMP_ID);
    const errMsg = await absent.page.textContent(`[data-budget-err="${CAMP_ID}"]`);
    assert.match(errMsg, /Finance is not installed or unavailable/i);
    assert.deepEqual(absent.errors, []);
  } finally {
    await absent.context.close();
  }
});
