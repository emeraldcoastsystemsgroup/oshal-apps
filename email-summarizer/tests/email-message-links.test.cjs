/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard safe HTML link and attachment metadata extraction on GET /api/email/message/:id (Gmail multipart, HTML-only, security/hygiene bounds, MIME attachments, Outlook Graph HTML body, and communications-bot manifest/persona contract).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));

const STUBS = {
  express: {
    Router: () => {
      const routes = {};
      const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
      return { routes, get: add('GET'), post: add('POST') };
    },
  },
  '@/features/personal-data': { isEncrypted: () => true, encryptField: async (_o, v) => v, decryptField: async (_o, v) => v },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/skill-profiles': { resolveSkillProfileByApp: () => null, composeSkillProfilePrompt: (p) => p },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: 'summary' }) },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}), summarizeGmailMetadata: () => ({}) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => Boolean(b && b.confirm === true),
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm` }),
  },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return originalLoad.call(this, request, ...rest);
};
const { createEmailRoutes } = require('../routes/email-app-routes.js');
const outlook = require('../routes/outlook-mailbox.js');
test.after(() => { Module._load = originalLoad; });

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const GOOGLE = { connections: [{ provider: 'google', revoked: false, expires_at_ms: null, renewable: true }] };
const OUTLOOK = { connections: [{ provider: 'outlook', revoked: false, expires_at_ms: null, renewable: false }] };

async function callMessageRoute(id, { meta = GOOGLE, query = {}, payloadResponse }) {
  const savedFetch = globalThis.fetch;
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async () => json(payloadResponse);
  const ctx = {
    pool: { query: async () => ({ rows: [] }) },
    intent: async (name) => {
      assert.equal(name, 'connectors.metadata');
      return meta;
    },
  };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; } };
  try {
    await createEmailRoutes(ctx).routes['GET /message/:id'](
      { oidc: { user: { sub: 'alice' } }, query, params: { id } },
      res,
    );
  } finally {
    globalThis.fetch = savedFetch;
    delete process.env.OSHAL_EGRESS;
  }
  return res;
}

test('multipart Gmail message returns text/plain body AND extracted HTML links', async () => {
  const gmailMessage = {
    id: 'inv-1',
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: '1794585600000',
    snippet: 'Murphy 11/13/2026 Invoice - $80.00 due. Click here to pay online.',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'TC Music Studio <billing@tcmusic.test>' },
        { name: 'To', value: 'parent@family.test' },
        { name: 'Subject', value: 'Murphy 11/13/2026 Invoice' },
        { name: 'Date', value: 'Fri, 13 Nov 2026 12:00:00 -0600' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: b64('Invoice total: $80.00.\nClick here to pay online.') },
        },
        {
          mimeType: 'text/html',
          body: {
            data: b64(
              '<html><body><p>Invoice total: $80.00.</p>'
              + '<p><a href="https://app.mymusicstaff.com/pay?id=123&amp;sig=abc">Click here to pay online</a></p></body></html>',
            ),
          },
        },
      ],
    },
  };

  const res = await callMessageRoute('inv-1', { payloadResponse: gmailMessage });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.body, 'Invoice total: $80.00.\nClick here to pay online.');
  assert.deepEqual(res.body.links, [
    { label: 'Click here to pay online', url: 'https://app.mymusicstaff.com/pay?id=123&sig=abc' },
  ]);
  assert.deepEqual(res.body.attachments, []);
});

test('HTML-only Gmail message returns readable plain body AND extracted links', async () => {
  const gmailMessage = {
    id: 'html-only-1',
    labelIds: ['INBOX'],
    internalDate: '1794585600000',
    payload: {
      mimeType: 'text/html',
      headers: [
        { name: 'From', value: 'Billing <billing@studio.test>' },
        { name: 'To', value: 'me@family.test' },
        { name: 'Subject', value: 'Payment Link' },
      ],
      body: {
        data: b64(
          '<style>.btn{color:blue}</style><p>Amount due: $80.00</p>'
          + '<a href="https://portal.studio.test/invoices/42?mode=card&#38;lang=en">Pay&nbsp;Invoice &amp; Receipt</a>'
          + '<script>location.href="https://evil.test/script"</script>',
        ),
      },
    },
  };

  const res = await callMessageRoute('html-only-1', { payloadResponse: gmailMessage });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.body, 'Amount due: $80.00 Pay Invoice & Receipt');
  assert.deepEqual(res.body.links, [
    { label: 'Pay Invoice & Receipt', url: 'https://portal.studio.test/invoices/42?mode=card&lang=en' },
  ]);
});

test('link extraction enforces http/https allowlist, entity decoding, dedupe, bounds, and tracking-pixel filtering', async () => {
  const manyLinks = Array.from({ length: 40 }, (_, i) => (
    `<a href="https://links.studio.test/item/${i + 1}">Action ${i + 1}</a>`
  )).join(' ');
  const longLabel = 'L'.repeat(350);
  const longUrl = `https://links.studio.test/overflow?pad=${'a'.repeat(2100)}`;

  const html = [
    '<a href="javascript:alert(1)">Bad JS</a>',
    '<a href="data:text/html,<script>alert(1)</script>">Bad Data</a>',
    '<a href="vbscript:msgbox(1)">Bad VBS</a>',
    '<a href="mailto:billing@studio.test">Email Us</a>',
    '<a href="/relative/pay">Relative Path</a>',
    '<a href="//protocol-relative.test/pay">Protocol Relative</a>',
    '<!-- <a href="https://commented.studio.test/hidden">Hidden Comment</a> -->',
    '<a href="https://track.studio.test/open"><img width="1" height="1" src="https://track.studio.test/p.gif"></a>',
    '<a href="https://track.studio.test/spacer">   &nbsp;  </a>',
    '<a href="https://app.mymusicstaff.com/pay?a=1&amp;b=2&#38;c=3">Pay Now</a>',
    '<a href="https://app.mymusicstaff.com/pay?a=1&amp;b=2&amp;c=3">Duplicate Pay</a>',
    '<a href="http://legacy.studio.test/receipt?id=9"><img src="btn.png" alt="Download Receipt"></a>',
    '<a href="https://app.mymusicstaff.com/invoice/77"><img src="btn.png" width="180" height="44"></a>',
    `<a href="https://links.studio.test/long-label">${longLabel}</a>`,
    `<a href="${longUrl}">Overlong URL</a>`,
    manyLinks,
  ].join('\n');

  const gmailMessage = {
    id: 'sec-1',
    payload: {
      mimeType: 'text/html',
      headers: [{ name: 'From', value: 'a@b.test' }, { name: 'Subject', value: 'Security' }],
      body: { data: b64(html) },
    },
  };

  const res = await callMessageRoute('sec-1', { payloadResponse: gmailMessage });
  assert.equal(res.statusCode, 200);
  const links = res.body.links;
  assert.ok(Array.isArray(links), 'links must be an array');
  assert.equal(links.length, 30, 'links must be capped at 30');

  for (const item of links) {
    assert.match(item.url, /^https?:\/\//i, `non-http(s) url leaked: ${item.url}`);
    assert.ok(item.url.length <= 2048, `url exceeded 2048 chars: ${item.url.length}`);
    assert.ok(item.label.length > 0 && item.label.length <= 200, `label length invalid: ${item.label.length}`);
  }

  const urls = links.map((l) => l.url);
  assert.equal(new Set(urls).size, urls.length, 'urls must be deduplicated');
  assert.ok(!urls.some((u) => /commented\.studio\.test|track\.studio\.test|overflow/.test(u)));
  assert.deepEqual(links[0], { label: 'Pay Now', url: 'https://app.mymusicstaff.com/pay?a=1&b=2&c=3' });
  assert.deepEqual(links[1], { label: 'Download Receipt', url: 'http://legacy.studio.test/receipt?id=9' });
  assert.equal(links[2].url, 'https://app.mymusicstaff.com/invoice/77');
  assert.ok(links[2].label.length > 0, 'actionable image-only invoice link keeps a fallback label');
  assert.equal(links[3].url, 'https://links.studio.test/long-label');
  assert.equal(links[3].label.length, 200);
});

test('nested Gmail MIME attachments are extracted as { filename, mimeType, size } without hijacking body', async () => {
  const gmailMessage = {
    id: 'att-1',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'TC Music Studio <billing@tcmusic.test>' },
        { name: 'To', value: 'parent@family.test' },
        { name: 'Subject', value: 'Murphy 11/13/2026 Invoice' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('Please see your invoice attached or pay online.') } },
            {
              mimeType: 'text/html',
              body: { data: b64('<p>Please see your invoice attached or <a href="https://app.mymusicstaff.com/pay/88">pay online</a>.</p>') },
            },
          ],
        },
        {
          filename: 'Murphy-Invoice-2026-11-13.pdf',
          mimeType: 'application/pdf',
          body: { attachmentId: 'ANGjdJ-pdf-1', size: 48120 },
        },
        {
          filename: 'notes.txt',
          mimeType: 'text/plain',
          body: { data: b64('attachment text should not override body'), size: 39 },
        },
      ],
    },
  };

  const res = await callMessageRoute('att-1', { payloadResponse: gmailMessage });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.body, 'Please see your invoice attached or pay online.');
  assert.deepEqual(res.body.links, [
    { label: 'pay online', url: 'https://app.mymusicstaff.com/pay/88' },
  ]);
  assert.deepEqual(res.body.attachments, [
    { filename: 'Murphy-Invoice-2026-11-13.pdf', mimeType: 'application/pdf', size: 48120 },
    { filename: 'notes.txt', mimeType: 'text/plain', size: 39 },
  ]);
});

test('Outlook / Graph HTML body extracts plain body and safe links', async () => {
  const graphMsg = {
    id: 'AAMk-inv-1',
    subject: 'Murphy 11/13/2026 Invoice',
    from: { emailAddress: { name: 'TC Music', address: 'billing@tcmusic.test' } },
    toRecipients: [{ emailAddress: { name: 'Parent', address: 'parent@family.test' } }],
    receivedDateTime: '2026-11-13T18:00:00Z',
    body: {
      contentType: 'html',
      content: '<p>Amount due: $80.00</p><p><a href="https://app.mymusicstaff.com/pay?id=99&amp;sig=xyz">Click here to pay online</a></p><a href="javascript:void(0)">Ignore</a>',
    },
  };

  const detail = await outlook.getOutlookMessage('tok', 'AAMk-inv-1', async () => ({
    ok: true,
    status: 200,
    json: async () => graphMsg,
    text: async () => JSON.stringify(graphMsg),
  }));
  assert.equal(detail.body, 'Amount due: $80.00 Click here to pay online Ignore');
  assert.deepEqual(detail.links, [
    { label: 'Click here to pay online', url: 'https://app.mymusicstaff.com/pay?id=99&sig=xyz' },
  ]);
  assert.deepEqual(detail.attachments, []);

  const routeRes = await callMessageRoute('AAMk-inv-1', { meta: OUTLOOK, query: { provider: 'outlook' }, payloadResponse: graphMsg });
  assert.equal(routeRes.statusCode, 200);
  assert.deepEqual(routeRes.body.links, [
    { label: 'Click here to pay online', url: 'https://app.mymusicstaff.com/pay?id=99&sig=xyz' },
  ]);
});

test('manifest and communications-bot persona document email-message links and attachments', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'email-summarizer.yaml'), 'utf8'));
  assert.equal(manifest.version, '1.8.2');
  const tool = manifest.tools.find((t) => t.name === 'email-message');
  assert.ok(tool);
  assert.match(`${tool.description} ${tool.usageInstructions}`, /\blinks\b/i);
  assert.match(`${tool.description} ${tool.usageInstructions}`, /\battachments\b/i);
  assert.match(persona.perspective, /email-message:[\s\S]*\blinks\b[\s\S]*\battachments\b/i);
  assert.match(persona.perspective, /verbatim/i);
});
