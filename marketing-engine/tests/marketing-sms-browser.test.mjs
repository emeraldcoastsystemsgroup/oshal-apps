/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.10 SMS Consent & Quiet Hours card inside #pane-compliance at
 *     desktop (1440x900) and phone (412x915): records TCPA/CTIA SMS opt-in with area-code
 *     inferred timezone badge and generated confirmation text, evaluates a 10 p.m. Pacific
 *     quiet-hours hold displaying Held until 08:00 (America/Los_Angeles), verifies zero page
 *     errors and zero horizontal overflow without browser alert/confirm dialogs.
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
const smsModel = require(join(pkgDir, 'routes', 'marketing-sms-model.js'));
const audModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function openSmsHarness(viewport) {
  const phone = viewport.width <= 640;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const contacts = [];
  const queue = [];
  const errors = [];
  let idSeq = 1;

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
    if (url.pathname === '/api/marketing/compliance') {
      return json(200, {
        settings: tpl.DEFAULT_COMPLIANCE_SETTINGS,
        updatedAt: null,
        readiness: tpl.complianceReadiness(tpl.DEFAULT_COMPLIANCE_SETTINGS),
        counts: { contactCount: contacts.length, confirmedConsentCount: contacts.length, suppressionCount: 0 },
      });
    }
    if (url.pathname === '/api/marketing/audience/signup-forms') return json(200, { forms: [] });
    if (url.pathname === '/api/marketing/audience/lists') return json(200, { lists: [] });
    if (url.pathname === '/api/marketing/broadcasts') return json(200, { broadcasts: [] });
    if (url.pathname === '/api/marketing/sequences') return json(200, { sequences: [] });
    if (url.pathname === '/api/marketing/audience/suppressions') return json(200, { suppressions: [] });
    if (url.pathname === '/api/marketing/audience/contacts' && req.method() === 'GET') return json(200, { contacts, total: contacts.length });
    if (url.pathname === '/api/marketing/audience/sms/queue' && req.method() === 'GET') return json(200, { items: queue, total: queue.length });

    if (url.pathname === '/api/marketing/audience/sms-opt-in' && req.method() === 'POST') {
      const b = req.postDataJSON();
      const e164 = smsModel.normalizePhoneE164(b.phoneE164 || b.phone);
      const tz = smsModel.resolveRecipientTimezone({ explicitTimezone: b.timezone, phoneE164: e164 });
      const ev = smsModel.normalizeSmsConsentEvidence(b, { recordedAt: new Date().toISOString() });
      if (!e164 || !tz.ok || !ev.ok) return json(400, { error: 'sms_consent_incomplete', missingFields: ev.missingFields || [] });
      const contactId = `11111111-1111-4111-8111-${String(idSeq++).padStart(12, '0')}`;
      const contact = {
        contact_id: contactId, email: b.email, display_name: b.displayName || '',
        phone_e164: e164, phone_hash: audModel.hashAddress(e164),
        timezone: tz.timezone, timezone_inferred: tz.inferred, status: 'active', suppressed: false,
        consents: [{ channel: 'sms', purpose: 'marketing', status: 'confirmed', evidence: ev.evidence }],
      };
      contacts.push(contact);
      return json(201, {
        contact,
        consent: contact.consents[0],
        confirmationText: smsModel.buildSmsOptInConfirmationText(ev.evidence),
        timezone: tz.timezone,
        timezoneInferred: tz.inferred,
      });
    }
    if (url.pathname === '/api/marketing/audience/sms/schedule' && req.method() === 'POST') {
      const b = req.postDataJSON();
      const contact = contacts.find((c) => c.contact_id === b.contactId);
      if (!contact) return json(404, { error: 'contact_not_found' });
      const gate = smsModel.evaluateSmsSendGate({
        phoneE164: contact.phone_e164,
        consentRow: contact.consents[0],
        suppressed: false,
        timezone: contact.timezone,
        timezoneInferred: contact.timezone_inferred,
        nowIso: b.nowIso || '2026-11-26T06:00:00Z',
      });
      const status = gate.decision === 'allowed' ? 'ready' : 'held_quiet_hours';
      const item = {
        sms_id: `22222222-2222-4222-8222-${String(idSeq++).padStart(12, '0')}`,
        contact_id: contact.contact_id, email: contact.email, phone_e164: contact.phone_e164,
        body: b.body, recipient_timezone: gate.recipientTimezone, timezone_inferred: gate.timezoneInferred,
        status, gate_reason: gate.reason, release_at: gate.releaseAtIso,
      };
      queue.unshift(item);
      return json(status === 'held_quiet_hours' ? 202 : 200, {
        status, releaseAt: gate.releaseAtIso, recipientTimezone: gate.recipientTimezone,
        timezoneInferred: gate.timezoneInferred, queueItem: item,
      });
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  return { context, page, errors };
}

for (const vp of [{ width: 1440, height: 900, phone: false }, { width: 412, height: 915, phone: true }]) {
  test(`${vp.width}x${vp.height}: SMS Consent & Quiet Hours card records opt-in, shows inferred timezone, and renders quiet-hours hold`, { timeout: 60000 }, async () => {
    const { context, page, errors } = await openSmsHarness(vp);
    try {
      if (vp.phone) {
        await page.click('#tab-more');
        await page.waitForSelector('#morePopover.show');
        await page.click('#moreCompliance');
      } else {
        await page.click('#tab-compliance');
      }
      await page.waitForSelector('#smsConsentCard');

      await page.fill('#smsOptInEmail', 'alex-sms@example.com');
      await page.fill('#smsOptInName', 'Alex SMS');
      await page.fill('#smsOptInPhone', '+14155550199');
      await page.fill('#smsOptInDisclosure', 'I agree to receive recurring Open Swarm SMS alerts. Consent not required to purchase.');
      await page.click('#smsOptInBtn');
      await page.waitForFunction(() => document.getElementById('smsOptInTzBadge')?.textContent?.includes('America/Los_Angeles (inferred)'));
      assert.match(await page.textContent('#smsOptInConfirmText'), /Open Swarm Alerts/);
      assert.match(await page.textContent('#smsOptInConfirmText'), /STOP/);

      await page.fill('#smsScheduleNow', '2026-11-26T06:00:00Z');
      await page.fill('#smsScheduleBody', 'Quiet hours launch check');
      await page.click('#smsScheduleBtn');
      await page.waitForFunction(() => document.getElementById('smsQueueList')?.textContent?.includes('Held until 08:00 (America/Los_Angeles)'));
      assert.match(await page.textContent('#smsQueueList'), /2026-11-26T16:00:00\.000Z/);

      const fit = await sideways(page.mainFrame());
      assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
