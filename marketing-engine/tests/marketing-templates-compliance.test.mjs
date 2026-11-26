/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Unit, linter, route-table parity, approval,
 *     and publish-gate tests for marketing-engine 0.6.2 HTML email templates (announcement,
 *     newsletter, launch) and Compliance pane routes: XSS escaping, http(s)-only URLs,
 *     unremovable postal footer and unsubscribe link in HTML and plain-text parts, compliance
 *     settings validation, 422 refusal on incomplete compliance or non-compliant raw email,
 *     skipped_compliance ledger recording without calling Resend, multipart send after
 *     compliance is configured, and two-owner isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = require(join(pkgDir, 'routes', 'marketing-templates.js'));

const UUID_CAMP = '11111111-1111-4111-8111-111111111111';
const UUID_ITEM = '22222222-2222-4222-8222-222222222222';
const UUID_RAW = '33333333-3333-4333-8333-333333333333';

const VALID_COMPLIANCE = {
  senderName: 'Open Swarm Team',
  senderEmail: 'updates@example.com',
  replyToEmail: 'reply@example.com',
  postalAddress: '100 Harbor Way, Suite 200, Pensacola, FL 32502',
  unsubscribeBaseUrl: 'https://example.com/unsubscribe',
  smsQuietStartHour: 21,
  smsQuietEndHour: 8,
  smsDefaultTimezone: 'America/Chicago',
};

/** Minimal synthetic Express Router recording method + path + handler. */
function makeRouter() {
  const routes = [];
  const add = (method) => (routePath, ...handlers) => {
    routes.push({ method, path: routePath, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
}

/** Load a compiled marketing route module with minimal runtime stubs. */
function loadCompiledModule(relPath, extras = {}) {
  const full = join(pkgDir, relPath);
  const src = readFileSync(full, 'utf8');
  const mod = { exports: {} };
  const stubs = {
    express: { Router: () => makeRouter() },
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (b) => b?.confirm === true,
      confirmationRequiredPayload: (g, a) => ({ error: 'confirmation_required', guard: g, action: a }),
    },
    '@/app/connectors/runtime': {
      loadConnectorSpec: () => ({ actions: [{ name: 'send-email' }] }),
      resolveConnectorActionCreds: async () => ({ token: 'fake' }),
      runConnectorAction: async () => ({ status: 200, body: { ok: true, data: { id: 're_test_123' } } }),
    },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => 'fake' },
    '@/app/routes/connector-tenancy': { resolveConnectionRow: async () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ success: true, response: 'Subject: Launch Day\n\nOpen Swarm 2.0 is ready.' }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    ...extras,
  };
  const cache = new Map();
  const reqStub = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith('./')) {
      const target = join(dirname(full), id.endsWith('.js') ? id : `${id}.js`);
      if (!cache.has(target)) cache.set(target, loadCompiledModule(target.slice(pkgDir.length + 1), extras));
      return cache.get(target);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', src)(
    reqStub, mod, mod.exports, full, dirname(full),
  );
  return mod.exports;
}

/** Invoke a recorded route handler with a synthetic req/res pair. */
async function callRoute(router, method, routePath, { sub = 'owner-a', params = {}, query = {}, body = {}, headers = {} } = {}) {
  const entry = router.routes.find((r) => r.method === method && r.path === routePath);
  assert.ok(entry, `route registered: ${method} ${routePath}`);
  const req = { method, path: routePath, params, query, body, headers, oidc: sub ? { user: { sub } } : null };
  const res = {
    statusCode: 200,
    headersSent: false,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
    send(payload) { this.body = payload; this.headersSent = true; return this; },
  };
  await entry.handler(req, res);
  return res;
}

test('renderMarketingTemplate renders announcement, newsletter, and launch with escaped HTML, text alternative, and unremovable footer', () => {
  for (const templateId of ['announcement', 'newsletter', 'launch']) {
    const out = tpl.renderMarketingTemplate({
      templateId,
      subject: `Update <script>alert(1)</script> & "more"`,
      headline: `Big <b>Milestone</b> 'now'`,
      intro: 'Short intro with <img src=x onerror=alert(1)>',
      body: 'First highlight & detail\n\nSecond paragraph',
      ctaLabel: 'Read <now>',
      ctaUrl: 'https://example.com/release?a=1&b=2',
    }, VALID_COMPLIANCE);

    assert.equal(out.templateId, templateId);
    assert.equal(out.canApprove, true);
    assert.equal(out.compliance.ok, true);
    assert.deepEqual(out.compliance.errors, []);

    // Strict XSS escaping in HTML.
    assert.doesNotMatch(out.html, /<script>/i);
    assert.doesNotMatch(out.html, /<img\s+src=x/i);
    assert.ok(out.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(out.html.includes('&lt;b&gt;Milestone&lt;/b&gt; &#39;now&#39;'));

    // Mandatory footer in BOTH HTML and plain text.
    assert.ok(out.html.includes(VALID_COMPLIANCE.senderName));
    assert.ok(out.html.includes(VALID_COMPLIANCE.senderEmail));
    assert.ok(out.html.includes(VALID_COMPLIANCE.postalAddress));
    assert.ok(out.html.includes(VALID_COMPLIANCE.unsubscribeBaseUrl));
    assert.ok(out.text.includes(VALID_COMPLIANCE.senderName));
    assert.ok(out.text.includes(VALID_COMPLIANCE.postalAddress));
    assert.ok(out.text.includes(`Unsubscribe: ${VALID_COMPLIANCE.unsubscribeBaseUrl}`));
  }
});

test('renderMarketingTemplate refuses invalid template ids and disallowed URL schemes (javascript:, data:)', () => {
  assert.throws(
    () => tpl.renderMarketingTemplate({ templateId: 'custom-raw', subject: 'Hi', body: 'Hello' }, VALID_COMPLIANCE),
    (err) => err.code === 'invalid_template_id',
  );
  assert.throws(
    () => tpl.renderMarketingTemplate({ templateId: 'announcement', subject: 'Hi', body: 'Hello', ctaUrl: 'javascript:alert(1)' }, VALID_COMPLIANCE),
    (err) => err.code === 'invalid_cta_url',
  );
  assert.throws(
    () => tpl.renderMarketingTemplate({ templateId: 'launch', subject: 'Hi', body: 'Hello', ctaUrl: 'data:text/html,<h1>x</h1>' }, VALID_COMPLIANCE),
    (err) => err.code === 'invalid_cta_url',
  );
  assert.throws(
    () => tpl.renderMarketingTemplate({ templateId: 'newsletter', subject: 'Hi', body: 'Hello', unsubscribeUrl: 'javascript:void(0)' }, VALID_COMPLIANCE),
    (err) => err.code === 'invalid_unsubscribe_url',
  );
});

test('lintMarketingEmail refuses missing postal address, identity, text part, footer, or unsubscribe link', () => {
  const emptyCompliance = tpl.renderMarketingTemplate({ templateId: 'announcement', subject: 'Hi', body: 'Body' }, {});
  assert.equal(emptyCompliance.canApprove, false);
  const codes = new Set(emptyCompliance.compliance.errors.map((e) => e.code));
  assert.ok(codes.has('compliance_identity_required'));
  assert.ok(codes.has('compliance_postal_address_required'));
  assert.ok(codes.has('template_missing_html_unsubscribe'));
  assert.ok(codes.has('template_missing_text_unsubscribe'));

  const noText = tpl.lintMarketingEmail({
    html: `<p>${VALID_COMPLIANCE.postalAddress}</p><a href="${VALID_COMPLIANCE.unsubscribeBaseUrl}">Unsub</a>`,
    text: '',
    compliance: VALID_COMPLIANCE,
  });
  assert.equal(noText.ok, false);
  assert.ok(noText.errors.some((e) => e.code === 'template_missing_text_part'));

  const missingFooter = tpl.lintMarketingEmail({
    html: '<p>Just HTML without footer</p>',
    text: 'Just text without footer',
    compliance: VALID_COMPLIANCE,
  });
  assert.equal(missingFooter.ok, false);
  const mfCodes = new Set(missingFooter.errors.map((e) => e.code));
  assert.ok(mfCodes.has('template_missing_html_footer'));
  assert.ok(mfCodes.has('template_missing_html_unsubscribe'));
  assert.ok(mfCodes.has('template_missing_text_footer'));
  assert.ok(mfCodes.has('template_missing_text_unsubscribe'));
});

test('normalizeComplianceSettings validates emails, unsubscribe URL, quiet hours, and timezone', () => {
  const ok = tpl.normalizeComplianceSettings(VALID_COMPLIANCE);
  assert.equal(ok.ok, true);
  assert.equal(tpl.complianceReadiness(ok.settings).readyForEmailSend, true);

  assert.equal(tpl.normalizeComplianceSettings({ senderEmail: 'not-an-email' }).ok, false);
  assert.equal(tpl.normalizeComplianceSettings({ replyToEmail: 'bad' }).ok, false);
  assert.equal(tpl.normalizeComplianceSettings({ unsubscribeBaseUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(tpl.normalizeComplianceSettings({ smsQuietStartHour: 24 }).ok, false);
  assert.equal(tpl.normalizeComplianceSettings({ smsQuietEndHour: -1 }).ok, false);
  assert.equal(tpl.normalizeComplianceSettings({ smsDefaultTimezone: 'bad timezone with spaces' }).ok, false);
});

test('compliance routes, template render, approval gate, publish gate, ledger recording, and two-owner isolation', async () => {
  const complianceStore = new Map();
  const contentStore = new Map();
  const ledgerRows = [];
  const resendCalls = [];

  contentStore.set(UUID_RAW, {
    item_id: UUID_RAW,
    user_sub: 'owner-a',
    campaign_id: UUID_CAMP,
    channel: 'email',
    title: 'Raw un-templated email',
    body: 'Plain email without template or footer',
    status: 'draft',
    template_id: null,
    html_body: '<p>No footer here</p>',
    text_body: '',
  });

  const pool = {
    query: async (sql, params = []) => {
      if (sql.includes('FROM oshal_marketing_compliance_settings WHERE owner_sub = $1')) {
        const row = complianceStore.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_compliance_settings')) {
        const row = {
          owner_sub: params[0],
          sender_name: params[1],
          sender_email: params[2],
          reply_to_email: params[3],
          postal_address: params[4],
          unsubscribe_base_url: params[5],
          sms_quiet_start_hour: params[6],
          sms_quiet_end_hour: params[7],
          sms_default_timezone: params[8],
          updated_at: '2026-11-25T19:00:00.000Z',
        };
        complianceStore.set(params[0], row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_contacts') || sql.includes('FROM oshal_marketing_consents') || sql.includes('FROM oshal_marketing_suppressions')) {
        return { rows: [{ n: 0 }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_campaigns WHERE campaign_id = $1 AND user_sub = $2')) {
        if (params[0] === UUID_CAMP && params[1] === 'owner-a') {
          return { rows: [{ campaign_id: UUID_CAMP, user_sub: 'owner-a', slug: 'launch', name: 'Launch', product: 'Open Swarm', motion: 'adoption', stage: 1, icp: {}, message_map: {} }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_content')) {
        const row = {
          item_id: UUID_ITEM,
          user_sub: params[0],
          campaign_id: params[1],
          channel: params[2],
          title: params[3],
          body: params[4],
          status: 'draft',
          template_id: params[5] ?? null,
          html_body: params[6] ?? null,
          text_body: params[7] ?? null,
        };
        contentStore.set(row.item_id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_content WHERE item_id = $1 AND user_sub = $2')) {
        const row = contentStore.get(params[0]);
        return { rows: row && row.user_sub === params[1] ? [row] : [], rowCount: row && row.user_sub === params[1] ? 1 : 0 };
      }
      if (sql.includes('UPDATE oshal_marketing_content') && sql.includes("status = 'approved'")) {
        const row = contentStore.get(params[3]);
        if (!row || row.user_sub !== params[4]) return { rows: [], rowCount: 0 };
        Object.assign(row, { status: 'approved', template_id: params[0] ?? row.template_id, html_body: params[1], text_body: params[2] });
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('UPDATE oshal_marketing_content') && sql.includes("status = 'published'")) {
        const row = contentStore.get(params[1]);
        if (!row || row.user_sub !== params[2]) return { rows: [], rowCount: 0 };
        Object.assign(row, { status: 'published', published_ref: params[0] });
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_channel_authorizations WHERE user_sub = $1 AND channel = $2')) {
        return { rows: [{ user_sub: params[0], channel: params[1], enabled: true, daily_cap: 10, paused_reason: null }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_run_ledger')) {
        return { rows: [{ n: 0 }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_run_ledger')) {
        ledgerRows.push({ user_sub: params[0], channel: params[1], action: params[2], outcome: params[3], detail: JSON.parse(params[4]) });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const routesMod = loadCompiledModule('routes/marketing-routes.js', {
    '@/app/connectors/runtime': {
      loadConnectorSpec: (p) => ({ provider: p, actions: [{ name: 'send-email' }] }),
      resolveConnectorActionCreds: async () => ({ token: 'fake' }),
      runConnectorAction: async (opts) => {
        resendCalls.push(opts);
        return { status: 200, body: { ok: true, data: { id: 're_ok_42' } } };
      },
    },
  });
  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir });

  // Unauthenticated refused 401.
  assert.equal((await callRoute(router, 'GET', '/compliance', { sub: null })).statusCode, 401);
  assert.equal((await callRoute(router, 'GET', '/templates', { sub: null })).statusCode, 401);

  // GET /templates lists all 3 built-in templates.
  const tpls = await callRoute(router, 'GET', '/templates');
  assert.equal(tpls.statusCode, 200);
  assert.deepEqual(tpls.body.templates.map((t) => t.id), ['announcement', 'newsletter', 'launch']);

  // Initially compliance is not ready.
  const initialComp = await callRoute(router, 'GET', '/compliance');
  assert.equal(initialComp.statusCode, 200);
  assert.equal(initialComp.body.readiness.postalAddressReady, false);
  assert.equal(initialComp.body.readiness.readyForEmailSend, false);

  // Create an email draft using the launch template before compliance settings exist.
  const draftRes = await callRoute(router, 'POST', '/drafts', {
    body: { campaignId: UUID_CAMP, channel: 'email', templateId: 'launch', subject: 'Open Swarm Launch', body: 'Now live for teams.' },
  });
  assert.equal(draftRes.statusCode, 201);
  assert.equal(draftRes.body.item.template_id, 'launch');
  assert.equal(draftRes.body.canApprove, false);

  // Approving while postal address is empty is REFUSED 422 and stays draft.
  const approveBlocked = await callRoute(router, 'POST', '/content/:id/approve', { params: { id: UUID_ITEM } });
  assert.equal(approveBlocked.statusCode, 422);
  assert.equal(approveBlocked.body.error, 'compliance_incomplete');
  assert.equal(contentStore.get(UUID_ITEM).status, 'draft');

  // Publishing while postal address is empty is REFUSED 422, writes skipped_compliance, and NEVER calls Resend.
  const pubBlocked = await callRoute(router, 'POST', '/content/:id/publish', {
    params: { id: UUID_ITEM },
    body: { confirm: true, to: 'reader@example.com' },
  });
  assert.equal(pubBlocked.statusCode, 422);
  assert.equal(pubBlocked.body.error, 'compliance_postal_address_required');
  assert.equal(resendCalls.length, 0, 'Resend must never be called when compliance fails');
  assert.equal(ledgerRows.at(-1).outcome, 'skipped_compliance');

  // Save compliance settings for owner-a.
  const putRes = await callRoute(router, 'PUT', '/compliance', { body: VALID_COMPLIANCE });
  assert.equal(putRes.statusCode, 200);
  assert.equal(putRes.body.readiness.readyForEmailSend, true);

  // Owner B still sees empty compliance settings and cannot approve Owner A's draft.
  const ownerBComp = await callRoute(router, 'GET', '/compliance', { sub: 'owner-b' });
  assert.equal(ownerBComp.body.readiness.readyForEmailSend, false);
  assert.equal((await callRoute(router, 'POST', '/content/:id/approve', { sub: 'owner-b', params: { id: UUID_ITEM } })).statusCode, 404);

  // Preview template renders cleanly with canApprove: true.
  const previewRes = await callRoute(router, 'POST', '/templates/render', {
    body: { templateId: 'newsletter', subject: 'Weekly Digest', headline: 'Digest', body: 'Item one\nItem two' },
  });
  assert.equal(previewRes.statusCode, 200);
  assert.equal(previewRes.body.canApprove, true);
  assert.ok(previewRes.body.html.includes(VALID_COMPLIANCE.postalAddress));
  assert.ok(previewRes.body.text.includes(VALID_COMPLIANCE.unsubscribeBaseUrl));

  // Raw un-templated email lacking text part / footer is STILL refused 422 on approve!
  const rawApprove = await callRoute(router, 'POST', '/content/:id/approve', { params: { id: UUID_RAW } });
  assert.equal(rawApprove.statusCode, 422);
  assert.equal(rawApprove.body.error, 'template_compliance_failed');

  // Templated email draft now approves cleanly (200) and publishes cleanly with BOTH html and text parts!
  const approveOk = await callRoute(router, 'POST', '/content/:id/approve', { params: { id: UUID_ITEM } });
  assert.equal(approveOk.statusCode, 200);
  assert.equal(approveOk.body.item.status, 'approved');
  assert.ok(approveOk.body.item.html_body.includes(VALID_COMPLIANCE.postalAddress));
  assert.ok(approveOk.body.item.text_body.includes(VALID_COMPLIANCE.unsubscribeBaseUrl));

  const pubOk = await callRoute(router, 'POST', '/content/:id/publish', {
    params: { id: UUID_ITEM },
    body: { confirm: true, to: 'reader@example.com' },
  });
  assert.equal(pubOk.statusCode, 200);
  assert.equal(pubOk.body.ref, 're_ok_42');
  assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].actionName, 'send-email');
  assert.ok(resendCalls[0].params.html.includes(VALID_COMPLIANCE.postalAddress));
  assert.ok(resendCalls[0].params.text.includes(VALID_COMPLIANCE.unsubscribeBaseUrl));
  assert.equal(ledgerRows.at(-1).outcome, 'published');
});
