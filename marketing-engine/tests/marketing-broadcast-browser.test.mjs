/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.5 Broadcasts & One-Click Unsubscribe card in the Compliance pane
 *     at desktop (1440x900) and phone (412x915): verifies creating a broadcast draft, running
 *     Dry-run gates to render the per-recipient decision ledger (dry_run vs skipped_unconfirmed
 *     vs skipped_suppressed), triggering Test one-click unsubscribe in-page, confirming the
 *     follow-up dry-run flips that contact to skipped_suppressed, zero page errors, and zero
 *     horizontal overflow.
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
const tpl = require(join(pkgDir, 'routes', 'marketing-templates.js'));
const audienceModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));
const bcModel = require(join(pkgDir, 'routes', 'marketing-broadcast-model.js'));
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');

const LIST_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333331';
const C2 = '33333333-3333-4333-8333-333333333332';
const C3 = '33333333-3333-4333-8333-333333333333';
const SECRET = 'c'.repeat(64);

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Create an isolated browser context serving tools/marketing-engine.html with stateful broadcast API. */
async function openBroadcastHarness(viewport) {
  const phone = viewport.width <= 640;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const settings = {
    senderName: 'Open Swarm Marketing',
    senderEmail: 'news@example.com',
    replyToEmail: 'replies@example.com',
    postalAddress: '500 Coast Blvd, Suite 10, Pensacola, FL 32502',
    unsubscribeBaseUrl: 'https://example.com/unsubscribe',
    smsQuietStartHour: 21,
    smsQuietEndHour: 8,
    smsDefaultTimezone: 'America/New_York',
  };
  const suppressedHashes = new Set([audienceModel.hashAddress('suppressed@example.com')]);
  const recipients = [
    { contactId: C1, email: 'confirmed@example.com', emailHash: audienceModel.hashAddress('confirmed@example.com'), emailConsentStatus: 'confirmed', contactStatus: 'active' },
    { contactId: C2, email: 'pending@example.com', emailHash: audienceModel.hashAddress('pending@example.com'), emailConsentStatus: 'pending', contactStatus: 'active' },
    { contactId: C3, email: 'suppressed@example.com', emailHash: audienceModel.hashAddress('suppressed@example.com'), emailConsentStatus: 'confirmed', contactStatus: 'suppressed' },
  ];
  const broadcasts = [];
  const deliveriesByMsg = new Map();
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

    if (url.pathname === '/api/marketing/overview') return json(200, { campaigns: [], channels: [], scorecard: [], pendingProposals: [], experiments: [], recentRuns: [] });
    if (url.pathname === '/api/marketing/content') return json(200, { items: [] });
    if (url.pathname === '/api/marketing/compliance') return json(200, { settings, updatedAt: '2026-11-26T00:00:00.000Z', readiness: tpl.complianceReadiness(settings), counts: { contactCount: recipients.length, confirmedConsentCount: recipients.filter((r) => r.emailConsentStatus === 'confirmed' && !suppressedHashes.has(r.emailHash)).length, suppressionCount: suppressedHashes.size } });
    if (url.pathname === '/api/marketing/audience/suppressions') return json(200, { suppressions: [...suppressedHashes].map((h, i) => ({ suppression_id: `s-${i}`, channel: 'email', address_hash: h, reason: 'one_click_unsubscribe', source: 'rfc8058', created_at: '2026-11-26T00:00:00.000Z' })) });
    if (url.pathname === '/api/marketing/audience/signup-forms') return json(200, { forms: [] });
    if (url.pathname === '/api/marketing/audience/lists') return json(200, { lists: [{ list_id: LIST_ID, slug: 'launch', name: 'Launch List' }] });
    if (url.pathname === '/api/marketing/audience/contacts') return json(200, { contacts: recipients.map((r) => ({ contact_id: r.contactId, email: r.email, display_name: r.email, status: r.contactStatus, suppressed: suppressedHashes.has(r.emailHash) })), total: recipients.length });

    if (url.pathname === '/api/marketing/broadcasts' && req.method() === 'GET') {
      return json(200, { broadcasts });
    }
    if (url.pathname === '/api/marketing/broadcasts' && req.method() === 'POST') {
      const norm = bcModel.normalizeBroadcastDraft(req.postDataJSON());
      if (!norm.ok) return json(400, { error: norm.error, message: norm.message });
      const row = bcModel.sanitizeBroadcastRow({
        message_id: MSG_ID, list_id: norm.draft.listId, template_id: norm.draft.templateId,
        subject: norm.draft.subject, headline: norm.draft.headline, intro: norm.draft.intro,
        body: norm.draft.body, cta_label: norm.draft.ctaLabel, cta_url: norm.draft.ctaUrl,
        status: 'draft', stats: {}, created_at: '2026-11-26T00:00:00.000Z', updated_at: '2026-11-26T00:00:00.000Z',
      });
      broadcasts.push(row);
      return json(201, { broadcast: row });
    }
    const sendMatch = url.pathname.match(/^\/api\/marketing\/broadcasts\/([^/]+)\/send$/);
    if (sendMatch && req.method() === 'POST') {
      const b = broadcasts.find((x) => x.message_id === sendMatch[1]);
      if (!b) return json(404, { error: 'broadcast_not_found' });
      const body = req.postDataJSON() || {};
      const plan = bcModel.planBroadcastDeliveries({
        ownerSub: 'owner-a',
        message: { messageId: b.message_id, listId: b.list_id, templateId: b.template_id, subject: b.subject, headline: b.headline, body: b.body, signingSecret: SECRET },
        channelRow: { enabled: true, daily_cap: 5 },
        sentToday: 0,
        compliance: settings,
        recipients,
        suppressedEmailHashes: suppressedHashes,
        dryRun: body.dryRun === true,
        confirmed: body.confirm === true,
        includeUnsubscribePreviewTokens: body.includeUnsubscribePreviewTokens === true,
      });
      b.stats = plan.stats;
      const saved = plan.decisions.map((d, i) => ({
        delivery_id: `d-${i}`, message_id: b.message_id, contact_id: d.contactId,
        email_hash: d.emailHash, status: d.status === 'eligible' ? 'dry_run' : d.status, gate_reason: d.gateReason,
      }));
      deliveriesByMsg.set(b.message_id, saved);
      const previewTokens = plan.decisions.filter((d) => d.unsubscribeToken).map((d) => ({
        contactId: d.contactId, email: d.email, emailHash: d.emailHash, unsubscribeUrl: d.unsubscribeUrl, unsubscribeToken: d.unsubscribeToken, headers: d.headers,
      }));
      return json(200, { ok: true, dryRun: true, messageId: b.message_id, status: b.status, stats: plan.stats, deliveries: saved, previewTokens });
    }
    const getMatch = url.pathname.match(/^\/api\/marketing\/broadcasts\/([^/]+)$/);
    if (getMatch && req.method() === 'GET') {
      const b = broadcasts.find((x) => x.message_id === getMatch[1]);
      return b ? json(200, { broadcast: b, deliveries: deliveriesByMsg.get(b.message_id) || [] }) : json(404, { error: 'broadcast_not_found' });
    }
    if (url.pathname === '/api/marketing/audience/unsubscribe' && req.method() === 'POST') {
      const body = req.postDataJSON() || {};
      const verified = bcModel.verifyUnsubscribeToken(body.token, SECRET, 'owner-a');
      if (!verified.ok) return json(400, { error: verified.error });
      suppressedHashes.add(verified.payload.emailHash);
      const r = recipients.find((x) => x.contactId === verified.payload.contactId);
      if (r) { r.emailConsentStatus = 'revoked'; r.contactStatus = 'unsubscribed'; }
      return json(200, { ok: true, unsubscribed: true, suppressed: true, contactId: verified.payload.contactId, revokedConsents: 1 });
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  return { context, page, errors };
}

test('1440x900 desktop Compliance pane: create broadcast, dry-run gates, one-click unsubscribe flips recipient to skipped_suppressed', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openBroadcastHarness({ width: 1440, height: 900 });
  try {
    await page.click('#tab-compliance');
    await page.waitForSelector('#broadcastsCard');
    await page.waitForFunction(() => document.querySelectorAll('#bcList option').length >= 2);

    await page.selectOption('#bcList', LIST_ID);
    await page.selectOption('#bcTemplate', 'announcement');
    await page.fill('#bcSubject', 'Open Swarm Broadcast Test');
    await page.fill('#bcHeadline', 'Broadcast Gates Live');
    await page.fill('#bcBody', 'Verified broadcast content.');
    await page.click('#bcCreateBtn');

    await page.waitForFunction(() => document.getElementById('broadcastsList')?.textContent?.includes('Open Swarm Broadcast Test'));
    await page.click(`[data-bc-dryrun="${MSG_ID}"]`);
    await page.waitForFunction(() => document.getElementById('bcLedgerTable')?.textContent?.includes('dry_run'));
    const ledgerText1 = await page.textContent('#bcLedgerTable');
    assert.ok(ledgerText1.includes('dry_run'));
    assert.ok(ledgerText1.includes('skipped_unconfirmed'));
    assert.ok(ledgerText1.includes('skipped_suppressed'));

    await page.click(`[data-bc-unsub="${C1}"]`);
    await page.waitForFunction(() => document.getElementById('bcLedgerStats')?.textContent?.includes('2 skipped suppressed'));
    const ledgerText2 = await page.textContent('#bcLedgerTable');
    assert.ok(!ledgerText2.includes('dry_run'), 'confirmed contact must now be skipped_suppressed after one-click unsubscribe');

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('412x915 phone Compliance pane: Broadcasts card renders and runs dry-run with zero horizontal overflow and zero page errors', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openBroadcastHarness({ width: 412, height: 915 });
  try {
    await page.click('#tab-more');
    await page.waitForSelector('#morePopover.show');
    await page.click('#moreCompliance');
    await page.waitForSelector('#broadcastsCard');
    await page.waitForFunction(() => document.querySelectorAll('#bcList option').length >= 2);

    await page.selectOption('#bcList', LIST_ID);
    await page.fill('#bcSubject', 'Mobile Broadcast');
    await page.fill('#bcBody', 'Mobile broadcast body.');
    await page.click('#bcCreateBtn');
    await page.waitForFunction(() => document.getElementById('broadcastsList')?.textContent?.includes('Mobile Broadcast'));
    await page.click(`[data-bc-dryrun="${MSG_ID}"]`);
    await page.waitForFunction(() => document.getElementById('bcLedgerTable')?.textContent?.includes('skipped_unconfirmed'));

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow on phone (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
