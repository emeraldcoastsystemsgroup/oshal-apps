/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.3 Sign-up forms & double opt-in card in the Compliance pane at
 *     desktop (1440x900) and phone (412x915): verifies creating a sign-up form, rendering the
 *     HTML-escaped embeddable snippet, running the in-page double opt-in test submit (pending)
 *     and confirm link (confirmed), deleting via the in-page confirm modal, zero page errors,
 *     and zero horizontal overflow.
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
const optinModel = require(join(pkgDir, 'routes', 'marketing-optin-model.js'));
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Create an isolated browser context serving tools/marketing-engine.html with stateful opt-in API. */
async function openOptInHarness(viewport) {
  const phone = viewport.width <= 640;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const forms = [];
  const contacts = [];
  const tokens = new Map();
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
    if (url.pathname === '/api/marketing/compliance') return json(200, { settings: tpl.DEFAULT_COMPLIANCE_SETTINGS, updatedAt: null, readiness: tpl.complianceReadiness(tpl.DEFAULT_COMPLIANCE_SETTINGS), counts: { contactCount: contacts.length, confirmedConsentCount: contacts.filter((c) => c.confirmed).length, suppressionCount: 0 } });
    if (url.pathname === '/api/marketing/audience/suppressions') return json(200, { suppressions: [] });
    if (url.pathname === '/api/marketing/audience/lists') return json(200, { lists: [{ list_id: '11111111-1111-4111-8111-111111111111', slug: 'launch', name: 'Launch List' }] });
    if (url.pathname === '/api/marketing/audience/contacts') return json(200, { contacts, total: contacts.length });

    if (url.pathname === '/api/marketing/audience/signup-forms' && req.method() === 'GET') {
      return json(200, { forms });
    }
    if (url.pathname === '/api/marketing/audience/signup-forms' && req.method() === 'POST') {
      const norm = optinModel.normalizeSignupForm(req.postDataJSON());
      if (!norm.ok) return json(400, { error: norm.error, message: norm.message });
      const row = optinModel.sanitizeSignupFormRow({
        form_id: '22222222-2222-4222-8222-222222222222',
        slug: norm.form.slug,
        name: norm.form.name,
        consent_text: norm.form.consentText,
        list_id: norm.form.listId,
        honeypot_field: norm.form.honeypotField,
        rate_limit_per_ip_hour: norm.form.rateLimitPerIpPerHour,
        rate_limit_per_form_hour: norm.form.rateLimitPerFormPerHour,
        token_ttl_minutes: norm.form.tokenTtlMinutes,
        confirmation_base_url: norm.form.confirmationBaseUrl,
        enabled: true,
        pending_count: 0,
        confirmed_count: 0,
      });
      forms.push(row);
      return json(201, { form: row, snippet: optinModel.buildEmbedSnippet(norm.form) });
    }
    const snipMatch = url.pathname.match(/^\/api\/marketing\/audience\/signup-forms\/([^/]+)\/snippet$/);
    if (snipMatch && req.method() === 'GET') {
      const f = forms.find((x) => x.slug === decodeURIComponent(snipMatch[1]));
      return f ? json(200, optinModel.buildEmbedSnippet(f)) : json(404, { error: 'form_not_found' });
    }
    const subMatch = url.pathname.match(/^\/api\/marketing\/audience\/signup-forms\/([^/]+)\/submit$/);
    if (subMatch && req.method() === 'POST') {
      const f = forms.find((x) => x.slug === decodeURIComponent(subMatch[1]));
      if (!f) return json(404, { error: 'form_not_found' });
      const b = req.postDataJSON();
      const tok = `tok-${forms.length}-${contacts.length + 1}`;
      tokens.set(tok, { form: f, email: b.email, used: false });
      f.pending_count += 1;
      contacts.push({ contact_id: `33333333-3333-4333-8333-00000000000${contacts.length + 1}`, email: b.email, display_name: '', status: 'active', suppressed: false, confirmed: false });
      return json(200, { ...optinModel.buildGenericAckResponse(), preview: { token: tok, confirmationUrl: `/api/marketing/audience/opt-in/confirm?token=${tok}`, expiresAt: '2026-11-26T18:00:00.000Z' } });
    }
    if (url.pathname === '/api/marketing/audience/opt-in/confirm' && req.method() === 'POST') {
      const b = req.postDataJSON();
      const entry = tokens.get(b.token);
      if (!entry) return json(400, { error: 'token_forged' });
      if (entry.used) return json(409, { error: 'token_already_used' });
      entry.used = true;
      entry.form.pending_count = Math.max(0, entry.form.pending_count - 1);
      entry.form.confirmed_count += 1;
      const c = contacts.find((x) => x.email === entry.email);
      if (c) c.confirmed = true;
      return json(200, { ok: true, confirmed: true, status: 'confirmed', confirmedAt: '2026-11-25T18:05:00.000Z' });
    }
    const delMatch = url.pathname.match(/^\/api\/marketing\/audience\/signup-forms\/([^/]+)$/);
    if (delMatch && req.method() === 'DELETE') {
      const idx = forms.findIndex((x) => x.slug === decodeURIComponent(delMatch[1]));
      if (idx < 0) return json(404, { error: 'form_not_found' });
      forms.splice(idx, 1);
      return json(200, { deleted: true, slug: decodeURIComponent(delMatch[1]) });
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  return { context, page, errors };
}

test('1440x900 desktop Compliance pane: create sign-up form, inspect embed snippet, run pending -> confirmed flow, and delete', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openOptInHarness({ width: 1440, height: 900 });
  try {
    await page.click('#tab-compliance');
    await page.waitForSelector('#signupFormsCard');

    await page.fill('#optinName', 'Early Access Waitlist');
    await page.fill('#optinSlug', 'early-access');
    await page.fill('#optinConsentText', 'Yes, send me Open Swarm launch emails.');
    await page.click('#optinCreateBtn');

    await page.waitForFunction(() => document.getElementById('optinFormsList')?.textContent?.includes('early-access'));
    const snippetVal = await page.inputValue('#optinSnippetOut');
    assert.ok(snippetVal.includes('company_website'));
    assert.ok(snippetVal.includes('/audience/signup-forms/early-access/submit'));

    await page.click('[data-optin-test="early-access"]');
    await page.waitForSelector('#optinTestWrap');
    await page.fill('#optinTestEmail', 'reader@example.com');
    await page.fill('#optinTestCampaign', 'browser-check');
    await page.click('#optinTestSubmitBtn');
    await page.waitForFunction(() => document.getElementById('optinTestState')?.textContent?.includes('pending'));

    await page.click('#optinTestConfirmBtn');
    await page.waitForFunction(() => document.getElementById('optinTestState')?.textContent?.includes('confirmed'));
    await page.waitForFunction(() => document.getElementById('optinFormsList')?.textContent?.includes('1 confirmed'));

    await page.click('[data-optin-delete="early-access"]');
    await page.waitForSelector('#cfScrim.show');
    await page.click('#cfGo');
    await page.waitForFunction(() => document.getElementById('optinFormsList')?.textContent?.includes('No sign-up forms'));

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('412x915 phone Compliance pane: Sign-up forms card renders cleanly with zero overflow and zero page errors', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openOptInHarness({ width: 412, height: 915 });
  try {
    await page.click('#tab-more');
    await page.waitForSelector('#morePopover.show');
    await page.click('#moreCompliance');
    await page.waitForSelector('#signupFormsCard');
    await page.fill('#optinName', 'Mobile Waitlist');
    await page.fill('#optinSlug', 'mobile-waitlist');
    await page.fill('#optinConsentText', 'Email me mobile release notes.');
    await page.click('#optinCreateBtn');
    await page.waitForFunction(() => document.getElementById('optinFormsList')?.textContent?.includes('mobile-waitlist'));

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow on phone (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
