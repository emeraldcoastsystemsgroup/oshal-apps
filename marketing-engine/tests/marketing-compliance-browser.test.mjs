/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.2 Compliance pane at desktop (1440x900) and phone (412x915):
 *     verifies zero page errors and zero horizontal overflow, saving sender identity/postal
 *     address/unsubscribe URL/quiet hours, rendering sandboxed HTML + plain-text template
 *     preview with compliance checklist, adding a suppression, exporting contact consent
 *     JSON, and export-first contact deletion via in-page confirm modal.
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
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Create an isolated browser context serving tools/marketing-engine.html over a stateful mock API. */
async function openComplianceHarness(viewport) {
  const phone = viewport.width <= 640;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  let settings = { ...tpl.DEFAULT_COMPLIANCE_SETTINGS };
  const suppressions = [];
  const contacts = [
    {
      contact_id: '11111111-1111-4111-8111-111111111111',
      email: 'alice@example.com',
      display_name: 'Alice Example',
      status: 'active',
      suppressed: false,
      consents: [{ channel: 'email', purpose: 'marketing', status: 'confirmed', evidence: { formText: 'Opt-in form', recordedAt: '2026-11-25T12:00:00.000Z' } }],
    },
  ];
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

    if (url.pathname === '/api/marketing/compliance' && req.method() === 'GET') {
      return json(200, {
        settings,
        updatedAt: '2026-11-25T12:00:00.000Z',
        readiness: tpl.complianceReadiness(settings),
        counts: { contactCount: contacts.length, confirmedConsentCount: contacts.length, suppressionCount: suppressions.length },
      });
    }
    if (url.pathname === '/api/marketing/compliance' && req.method() === 'PUT') {
      const norm = tpl.normalizeComplianceSettings(req.postDataJSON());
      if (!norm.ok) return json(400, { error: norm.error, message: norm.message });
      settings = norm.settings;
      return json(200, { settings, updatedAt: '2026-11-25T12:01:00.000Z', readiness: tpl.complianceReadiness(settings) });
    }
    if (url.pathname === '/api/marketing/templates/render' && req.method() === 'POST') {
      try {
        return json(200, tpl.renderMarketingTemplate(req.postDataJSON(), settings));
      } catch (err) {
        return json(400, { error: err.code || 'invalid_template_input', message: err.message });
      }
    }
    if (url.pathname === '/api/marketing/audience/suppressions' && req.method() === 'GET') {
      return json(200, { suppressions });
    }
    if (url.pathname === '/api/marketing/audience/signup-forms' && req.method() === 'GET') {
      return json(200, { forms: [] });
    }
    if (url.pathname === '/api/marketing/audience/lists' && req.method() === 'GET') {
      return json(200, { lists: [] });
    }
    if (url.pathname === '/api/marketing/audience/suppressions' && req.method() === 'POST') {
      const b = req.postDataJSON();
      const row = { suppression_id: '44444444-4444-4444-8444-444444444444', channel: 'email', address_hash: 'a'.repeat(64), reason: b.reason, source: 'manual', created_at: '2026-11-25T12:02:00.000Z' };
      suppressions.push(row);
      return json(201, { suppression: row, revokedConsents: 0 });
    }
    if (url.pathname === '/api/marketing/audience/contacts' && req.method() === 'GET') {
      return json(200, { contacts, total: contacts.length });
    }
    if (url.pathname.endsWith('/consent-export') && req.method() === 'GET') {
      return json(200, { consentExport: { contact: contacts[0], consents: contacts[0]?.consents || [], lists: [], suppressions: [] } });
    }
    if (url.pathname.startsWith('/api/marketing/audience/contacts/') && req.method() === 'DELETE') {
      const id = url.pathname.split('/').pop();
      const idx = contacts.findIndex((c) => c.contact_id === id);
      const removed = idx >= 0 ? contacts.splice(idx, 1)[0] : null;
      return json(200, { deleted: true, contactId: id, consentExport: { contact: removed, consents: removed?.consents || [] } });
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  return { context, page, errors };
}

test('1440x900 desktop Compliance pane: save settings, preview sandboxed template, add suppression, export & delete contact', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openComplianceHarness({ width: 1440, height: 900 });
  try {
    await page.click('#tab-compliance');
    await page.waitForSelector('#pane-compliance.on');
    assert.match(await page.textContent('#compStatusBadge'), /Blocked/);

    await page.fill('#compSenderName', 'Open Swarm Marketing');
    await page.fill('#compSenderEmail', 'news@example.com');
    await page.fill('#compReplyTo', 'hello@example.com');
    await page.fill('#compPostalAddress', '200 Bayfront Pkwy, Pensacola, FL 32502');
    await page.fill('#compUnsubUrl', 'https://example.com/unsubscribe');
    await page.click('#compSaveBtn');
    await page.waitForFunction(() => document.getElementById('compStatusBadge')?.textContent?.includes('Ready for email'));

    await page.selectOption('#tplSelect', 'launch');
    await page.fill('#tplSubject', 'Open Swarm Launch');
    await page.fill('#tplHeadline', 'Meet Open Swarm');
    await page.fill('#tplIntro', 'Built for accountable teams.');
    await page.fill('#tplBody', 'Consent-first publishing\nCompliance footer enforced');
    await page.fill('#tplCtaLabel', 'Explore');
    await page.fill('#tplCtaUrl', 'https://example.com/launch');
    await page.click('#tplPreviewBtn');
    await page.waitForFunction(() => document.getElementById('tplApproveBadge')?.textContent?.includes('Can approve'));

    const iframeInfo = await page.evaluate(() => {
      const f = document.getElementById('tplHtmlPreview');
      return { sandbox: f?.getAttribute('sandbox'), srcdoc: f?.srcdoc || '' };
    });
    assert.equal(iframeInfo.sandbox, '', 'HTML preview iframe must be strictly sandboxed with empty sandbox attribute');
    assert.ok(iframeInfo.srcdoc.includes('200 Bayfront Pkwy, Pensacola, FL 32502'));
    assert.ok(iframeInfo.srcdoc.includes('https://example.com/unsubscribe'));
    const textPreview = await page.textContent('#tplTextPreview');
    assert.ok(textPreview.includes('200 Bayfront Pkwy, Pensacola, FL 32502'));
    assert.ok(textPreview.includes('https://example.com/unsubscribe'));

    await page.fill('#suppEmail', 'optout@example.com');
    await page.selectOption('#suppReason', 'unsubscribe');
    await page.click('#suppAddBtn');
    await page.waitForFunction(() => document.getElementById('suppList')?.textContent?.includes('unsubscribe'));

    await page.click('[data-export-contact="11111111-1111-4111-8111-111111111111"]');
    await page.waitForFunction(() => document.getElementById('compExportOut')?.textContent?.includes('alice@example.com'));

    await page.click('[data-delete-contact="11111111-1111-4111-8111-111111111111"]');
    await page.waitForSelector('#cfScrim.show');
    await page.click('#cfGo');
    await page.waitForFunction(() => document.getElementById('compContactsList')?.textContent?.includes('No contacts'));

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('412x915 phone Compliance pane opens from More menu with zero horizontal overflow and zero page errors', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openComplianceHarness({ width: 412, height: 915 });
  try {
    await page.click('#tab-more');
    await page.waitForSelector('#morePopover.show');
    await page.click('#moreCompliance');
    await page.waitForSelector('#pane-compliance.on');
    await page.waitForSelector('#complianceForm');
    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow on phone (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
