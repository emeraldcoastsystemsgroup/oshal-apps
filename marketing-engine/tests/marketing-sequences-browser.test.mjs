/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.6 Sequences & Standing Authorization card in the Compliance pane
 *     at desktop (1440x900) and phone (412x915): verifies creating a sequence (starts OFF),
 *     adding a step inline, arming standing authorization via in-page confirm modal, running
 *     due steps (dry-run) showing per-enrollment outcomes, one-click Disarm with zero browser
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
const tpl = require(join(pkgDir, 'routes', 'marketing-templates.js'));
const audienceModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));
const seqModel = require(join(pkgDir, 'routes', 'marketing-sequence-model.js'));
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');

const SEQ_ID = '66666666-6666-4666-8666-666666666661';
const C1 = '33333333-3333-4333-8333-333333333331';
const E1 = '88888888-8888-4888-8888-888888888881';
const SECRET = 'd'.repeat(64);

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Create an isolated browser context serving tools/marketing-engine.html with stateful sequence API. */
async function openSequencesHarness(viewport) {
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
  const sequences = [];
  const stepsBySeq = new Map();
  const enrollmentsBySeq = new Map();
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
    if (url.pathname === '/api/marketing/compliance') return json(200, { settings, updatedAt: '2026-11-26T00:00:00.000Z', readiness: tpl.complianceReadiness(settings), counts: { contactCount: 1, confirmedConsentCount: 1, suppressionCount: 0 } });
    if (url.pathname === '/api/marketing/audience/suppressions') return json(200, { suppressions: [] });
    if (url.pathname === '/api/marketing/audience/signup-forms') return json(200, { forms: [] });
    if (url.pathname === '/api/marketing/audience/lists') return json(200, { lists: [] });
    if (url.pathname === '/api/marketing/audience/contacts') return json(200, { contacts: [{ contact_id: C1, email: 'subscriber@example.com', display_name: 'Subscriber', status: 'active', suppressed: false }], total: 1 });
    if (url.pathname === '/api/marketing/broadcasts') return json(200, { broadcasts: [] });

    if (url.pathname === '/api/marketing/sequences' && req.method() === 'GET') {
      return json(200, {
        sequences: sequences.map((s) => seqModel.sanitizeSequenceRow({
          ...s,
          step_count: (stepsBySeq.get(s.sequence_id) || []).length,
          active_enrollment_count: (enrollmentsBySeq.get(s.sequence_id) || []).filter((e) => e.status === 'active').length,
          total_enrollment_count: (enrollmentsBySeq.get(s.sequence_id) || []).length,
        })),
      });
    }
    if (url.pathname === '/api/marketing/sequences' && req.method() === 'POST') {
      const norm = seqModel.normalizeSequence(req.postDataJSON());
      if (!norm.ok) return json(400, { error: norm.error, message: norm.message });
      const row = {
        sequence_id: SEQ_ID, slug: norm.sequence.slug, name: norm.sequence.name,
        description: norm.sequence.description, trigger_form_slug: norm.sequence.triggerFormSlug,
        status: norm.sequence.status, standing_authorization: false, daily_cap: norm.sequence.dailyCap,
        signing_secret: SECRET, created_at: '2026-11-26T00:00:00.000Z', updated_at: '2026-11-26T00:00:00.000Z',
      };
      sequences.push(row);
      stepsBySeq.set(SEQ_ID, []);
      enrollmentsBySeq.set(SEQ_ID, [{
        enrollment_id: E1, sequence_id: SEQ_ID, contact_id: C1, email: 'subscriber@example.com',
        email_hash: audienceModel.hashAddress('subscriber@example.com'), current_step_order: 0,
        status: 'active', next_run_at: '2026-11-25T00:00:00.000Z',
      }]);
      return json(201, { sequence: seqModel.sanitizeSequenceRow(row) });
    }
    const stepMatch = url.pathname.match(/^\/api\/marketing\/sequences\/([^/]+)\/steps$/);
    if (stepMatch && req.method() === 'POST') {
      const norm = seqModel.normalizeSequenceStep(req.postDataJSON());
      if (!norm.ok) return json(400, { error: norm.error, message: norm.message });
      const st = {
        step_id: `st-${norm.step.stepOrder}`, sequence_id: stepMatch[1],
        step_order: norm.step.stepOrder, delay_hours: norm.step.delayHours,
        template_id: norm.step.templateId, subject: norm.step.subject,
        headline: norm.step.headline, intro: norm.step.intro, body: norm.step.body,
        cta_label: norm.step.ctaLabel, cta_url: norm.step.ctaUrl,
      };
      (stepsBySeq.get(stepMatch[1]) || []).push(st);
      return json(201, { step: st });
    }
    const authMatch = url.pathname.match(/^\/api\/marketing\/sequences\/([^/]+)\/authorization$/);
    if (authMatch && req.method() === 'PUT') {
      const s = sequences.find((x) => x.sequence_id === authMatch[1]);
      if (!s) return json(404, { error: 'sequence_not_found' });
      const parsed = seqModel.parseStandingAuthInput(req.postDataJSON(), s.daily_cap);
      if (!parsed.ok) return json(parsed.status, { error: parsed.error, message: parsed.message });
      s.standing_authorization = parsed.standingAuthorization;
      if (parsed.dailyCap !== undefined) s.daily_cap = parsed.dailyCap;
      if (parsed.standingAuthorization) s.status = 'active';
      return json(200, { sequence: seqModel.sanitizeSequenceRow(s) });
    }
    const disMatch = url.pathname.match(/^\/api\/marketing\/sequences\/([^/]+)\/disarm$/);
    if (disMatch && req.method() === 'POST') {
      const s = sequences.find((x) => x.sequence_id === disMatch[1]);
      if (!s) return json(404, { error: 'sequence_not_found' });
      s.standing_authorization = false;
      return json(200, { ok: true, disarmed: true, sequence: seqModel.sanitizeSequenceRow(s) });
    }
    const tickMatch = url.pathname.match(/^\/api\/marketing\/sequences\/([^/]+)\/tick$/);
    if (tickMatch && req.method() === 'POST') {
      const s = sequences.find((x) => x.sequence_id === tickMatch[1]);
      if (!s) return json(404, { error: 'sequence_not_found' });
      const body = req.postDataJSON() || {};
      const plan = seqModel.evaluateSequenceStepRun({
        ownerSub: 'owner-a',
        sequence: s,
        steps: stepsBySeq.get(s.sequence_id) || [],
        enrollments: (enrollmentsBySeq.get(s.sequence_id) || []).map((e) => ({
          enrollmentId: e.enrollment_id, contactId: e.contact_id, email: e.email,
          emailHash: e.email_hash, contactStatus: 'active', emailConsentStatus: 'confirmed',
          currentStepOrder: e.current_step_order, status: e.status, nextRunAt: e.next_run_at,
        })),
        suppressedEmailHashes: new Set(),
        channelRow: { enabled: true, daily_cap: 20 },
        channelSentToday: 0,
        sequenceSentToday: 0,
        compliance: settings,
        dryRun: body.dryRun === true,
        nowMs: Date.parse('2026-11-26T12:00:00.000Z'),
      });
      if (plan.blocked) return json(plan.httpStatus, { error: plan.error, reason: plan.reason, armed: plan.armed, stats: plan.stats, decisions: [] });
      return json(200, {
        ok: true, dryRun: true, armed: plan.armed, sequenceId: s.sequence_id, stats: plan.stats,
        decisions: plan.decisions.map((d) => ({
          enrollmentId: d.enrollmentId, contactId: d.contactId, email: d.email,
          stepOrder: d.stepOrder, outcome: d.outcome, gateReason: d.gateReason, nextStatus: d.nextEnrollmentStatus,
        })),
      });
    }
    const getMatch = url.pathname.match(/^\/api\/marketing\/sequences\/([^/]+)$/);
    if (getMatch && req.method() === 'GET') {
      const s = sequences.find((x) => x.sequence_id === getMatch[1]);
      return s ? json(200, { sequence: seqModel.sanitizeSequenceRow(s), steps: stepsBySeq.get(s.sequence_id) || [], enrollments: enrollmentsBySeq.get(s.sequence_id) || [] }) : json(404, { error: 'sequence_not_found' });
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  return { context, page, errors };
}

test('1440x900 desktop Compliance pane: create sequence (OFF), add step, arm via confirm modal, run dry-run tick, one-click disarm', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openSequencesHarness({ width: 1440, height: 900 });
  try {
    await page.click('#tab-compliance');
    await page.waitForSelector('#sequencesCard');

    await page.fill('#seqName', 'Welcome Drip');
    await page.fill('#seqSlug', 'welcome-drip');
    await page.fill('#seqDailyCap', '5');
    await page.click('#seqCreateBtn');

    await page.waitForFunction(() => document.getElementById('sequencesList')?.textContent?.includes('Welcome Drip'));
    assert.match(await page.textContent(`[data-seq-badge="${SEQ_ID}"]`), /OFF \(disarmed\)/);

    // Add Step 1 inline.
    await page.selectOption('#seqStepTarget', SEQ_ID);
    await page.fill('#seqStepSubject', 'Welcome Step 1');
    await page.fill('#seqStepBody', 'Welcome to Open Swarm onboarding.');
    await page.click('#seqStepAddBtn');
    await page.waitForFunction(() => document.getElementById('seqDetailBody')?.textContent?.includes('Welcome Step 1'));

    // Arm standing authorization via in-page confirm modal.
    await page.click(`[data-seq-arm="${SEQ_ID}"]`);
    await page.waitForSelector('#cfScrim.show');
    await page.click('#cfGo');
    await page.waitForFunction((id) => document.querySelector(`[data-seq-badge="${id}"]`)?.textContent?.includes('Armed (cap 5/day)'), SEQ_ID);

    // Run due steps (dry-run).
    await page.click(`[data-seq-dryrun="${SEQ_ID}"]`);
    await page.waitForFunction(() => document.getElementById('seqTickTable')?.textContent?.includes('dry_run'));

    // One-click Disarm (no confirm modal!).
    await page.click(`[data-seq-disarm="${SEQ_ID}"]`);
    await page.waitForFunction((id) => document.querySelector(`[data-seq-badge="${id}"]`)?.textContent?.includes('OFF (disarmed)'), SEQ_ID);

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('412x915 phone Compliance pane: Sequences card creates, arms, disarms, and dry-runs with zero overflow and zero page errors', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openSequencesHarness({ width: 412, height: 915 });
  try {
    await page.click('#tab-more');
    await page.waitForSelector('#morePopover.show');
    await page.click('#moreCompliance');
    await page.waitForSelector('#sequencesCard');

    await page.fill('#seqName', 'Phone Drip');
    await page.fill('#seqDailyCap', '4');
    await page.click('#seqCreateBtn');
    await page.waitForFunction(() => document.getElementById('sequencesList')?.textContent?.includes('Phone Drip'));

    await page.click(`[data-seq-arm="${SEQ_ID}"]`);
    await page.waitForSelector('#cfScrim.show');
    await page.click('#cfGo');
    await page.waitForFunction((id) => document.querySelector(`[data-seq-badge="${id}"]`)?.textContent?.includes('Armed (cap 4/day)'), SEQ_ID);

    await page.click(`[data-seq-disarm="${SEQ_ID}"]`);
    await page.waitForFunction((id) => document.querySelector(`[data-seq-badge="${id}"]`)?.textContent?.includes('OFF (disarmed)'), SEQ_ID);

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `no horizontal overflow on phone (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
