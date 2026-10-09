/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the compiled Outlook Graph adapter and the provider switch with a recording fetch: MailSummary normalization, the list cap and page limit, Graph-origin-only pagination, id encoding, the text-body preference, today's calendar window, and google|outlook selection with no cross-provider fallback. No network, credentials or framework checkout.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The switch accepts yahoo, but Yahoo is never a brokered-token provider (its app password stays in core), and MailboxRefusal carries the refusal status and body.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const outlook = require('../routes/outlook-mailbox.js');
const providers = require('../routes/mail-provider.js');

const TOKEN = 'fixture-graph-token';
const NOW = new Date('2026-09-27T15:00:00.000Z');

/** A recording fetch that answers from a list of JSON bodies (or a status) in order. */
function recordingFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    const next = answers.shift() ?? { value: [] };
    const status = next.__status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next,
      text: async () => JSON.stringify(next),
    };
  };
  return { calls, fetchImpl };
}

/** A Graph message resource with sensible defaults. */
function graphMessage(n, extra = {}) {
  return {
    id: `AAMk-${n}`,
    subject: `Subject ${n}`,
    from: { emailAddress: { name: `Sender ${n}`, address: `sender${n}@oshal.example.com` } },
    receivedDateTime: new Date(NOW.getTime() - n * 60_000).toISOString(),
    bodyPreview: `Preview ${n}`,
    isRead: true,
    importance: 'normal',
    flag: { flagStatus: 'notFlagged' },
    ...extra,
  };
}

test('a Graph message normalizes onto the MailSummary shape with the three provider flags', () => {
  const summary = outlook.normalizeGraphMessage({
    id: 'AAMk=1/2',
    subject: 'Quarterly review',
    from: { emailAddress: { name: 'Pat "Lead" <Ops>\r\nBcc: x', address: 'pat@oshal.example.com' } },
    receivedDateTime: '2026-09-27T14:05:00Z',
    bodyPreview: `  line one\n\nline two ${'x'.repeat(400)}`,
    isRead: false,
    importance: 'high',
    flag: { flagStatus: 'flagged' },
  });
  assert.equal(summary.id, 'AAMk=1/2');
  assert.equal(summary.from, 'Pat Lead Ops Bcc: x <pat@oshal.example.com>');
  assert.doesNotMatch(summary.from, /[\r\n]/);
  assert.equal(summary.subject, 'Quarterly review');
  assert.equal(summary.receivedAt, '2026-09-27T14:05:00.000Z');
  assert.equal(summary.date, summary.receivedAt);
  assert.equal(summary.internalDate, String(Date.parse('2026-09-27T14:05:00Z')));
  assert.equal(summary.snippet.startsWith('line one line two'), true);
  assert.equal(summary.snippet.length, 300);
  assert.deepEqual(
    [summary.unread, summary.important, summary.starred, summary.providerFlags],
    [true, true, true, { unread: true, important: true, starred: true }],
  );
  const quiet = outlook.normalizeGraphMessage({ id: 'q', isRead: true, importance: 'low', flag: { flagStatus: 'complete' } });
  assert.deepEqual(quiet.providerFlags, { unread: false, important: false, starred: false });
  assert.equal(quiet.subject, '(no subject)');
  assert.equal(quiet.receivedAt, '');
  assert.equal(quiet.internalDate, '');
});

test('the inbox list is one fixed Graph request with a receivedDateTime window and a clamped $top', async () => {
  const { calls, fetchImpl } = recordingFetch([{ value: [graphMessage(2), graphMessage(1)] }]);
  const rows = await outlook.listOutlookInbox(TOKEN, { days: 7, max: 5000 }, fetchImpl, NOW);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages');
  assert.equal(url.searchParams.get('$top'), String(outlook.OUTLOOK_MAX_LIST));
  assert.equal(url.searchParams.get('$filter'), `receivedDateTime ge ${new Date(NOW.getTime() - 7 * 86_400_000).toISOString()}`);
  assert.equal(url.searchParams.get('$orderby'), 'receivedDateTime desc');
  assert.match(url.searchParams.get('$select'), /isRead/);
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(rows.map((r) => r.id), ['AAMk-1', 'AAMk-2'], 'newest first');
  assert.equal(outlook.clampListSize(0), 25);
  assert.equal(outlook.clampListSize(-3), 25);
  assert.equal(outlook.clampDays(365), 30);
  assert.equal(outlook.clampDays('x'), 7);
});

test('pagination follows Graph nextLinks only up to the cap and never past the page limit', async () => {
  const page = (from, link) => ({
    value: [graphMessage(from), graphMessage(from + 1)],
    '@odata.nextLink': link,
  });
  const next = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=2';
  const capped = recordingFetch([page(1, next), page(3, next), page(5, next)]);
  const rows = await outlook.listOutlookInbox(TOKEN, { max: 3 }, capped.fetchImpl, NOW);
  assert.equal(rows.length, 3);
  assert.equal(capped.calls.length, 2, 'the third page is never fetched once the cap is reached');

  const endless = recordingFetch(Array.from({ length: 10 }, (_, i) => page(i * 2 + 1, next)));
  const bounded = await outlook.listOutlookInbox(TOKEN, { max: 50 }, endless.fetchImpl, NOW);
  assert.equal(endless.calls.length, outlook.OUTLOOK_MAX_PAGES);
  assert.equal(bounded.length, outlook.OUTLOOK_MAX_PAGES * 2);
});

test('a nextLink off graph.microsoft.com or outside /me is never followed, so the token cannot leave', async () => {
  for (const foreign of [
    'https://attacker.example.com/v1.0/me/messages?$skip=2',
    'http://graph.microsoft.com/v1.0/me/messages?$skip=2',
    'https://graph.microsoft.com/v1.0/users/other@oshal.example.com/messages',
    'not a url',
  ]) {
    const { calls, fetchImpl } = recordingFetch([{ value: [graphMessage(1)], '@odata.nextLink': foreign }]);
    const rows = await outlook.listOutlookInbox(TOKEN, { max: 10 }, fetchImpl, NOW);
    assert.equal(rows.length, 1);
    assert.equal(calls.length, 1, `followed ${foreign}`);
    assert.equal(outlook.safeNextLink(foreign), null);
  }
});

test('one message is read by URL-encoded id with a text-body preference, and an HTML body is flattened', async () => {
  const { calls, fetchImpl } = recordingFetch([{
    ...graphMessage(1, { id: 'AAMkAGI2/Tm9=' }),
    toRecipients: [{ emailAddress: { name: 'Me', address: 'me@oshal.example.com' } }, { emailAddress: { address: 'team@oshal.example.com' } }],
    body: { contentType: 'html', content: '<style>p{}</style><p>Hello&nbsp;there &amp; welcome</p><script>x()</script>' },
  }]);
  const detail = await outlook.getOutlookMessage(TOKEN, 'AAMkAGI2/Tm9=', fetchImpl);
  assert.ok(calls[0].url.startsWith('https://graph.microsoft.com/v1.0/me/messages/AAMkAGI2%2FTm9%3D?'));
  assert.equal(calls[0].headers.Prefer, 'outlook.body-content-type="text"');
  assert.equal(detail.body, 'Hello there & welcome');
  assert.equal(detail.to, 'Me <me@oshal.example.com>, team@oshal.example.com');
  assert.equal(detail.id, 'AAMkAGI2/Tm9=');
  assert.equal(outlook.validMessageId(''), null);
  assert.equal(outlook.validMessageId('has space'), null);
  assert.equal(outlook.validMessageId('a\nb'), null);
  assert.equal(outlook.validMessageId('x'.repeat(513)), null);
  assert.equal(outlook.validMessageId('AAMk=/+'), 'AAMk=/+');
});

test('a Graph refusal surfaces as a GraphRequestError carrying the status', async () => {
  const { fetchImpl } = recordingFetch([{ __status: 401, error: { code: 'InvalidAuthenticationToken' } }]);
  await assert.rejects(outlook.listOutlookInbox(TOKEN, {}, fetchImpl, NOW), (err) => {
    assert.equal(err.name, 'GraphRequestError');
    assert.equal(err.status, 401);
    assert.match(err.message, /^graph 401: /);
    return true;
  });
});

test("today's calendar reads calendarView midnight to midnight and yields parseable starts", async () => {
  const { calls, fetchImpl } = recordingFetch([{ value: [
    { subject: 'Standup', start: { dateTime: '2026-09-27T14:00:00.0000000', timeZone: 'UTC' }, location: { displayName: 'Room 1' } },
    { subject: '', start: { dateTime: '2026-09-27T00:00:00.0000000', timeZone: 'UTC' }, isAllDay: true },
  ] }]);
  const events = await outlook.outlookEventsToday(TOKEN, fetchImpl, NOW);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v1.0/me/calendarView');
  assert.equal(url.searchParams.get('startDateTime'), new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).toISOString());
  assert.equal(url.searchParams.get('endDateTime'), new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1).toISOString());
  assert.deepEqual(events, [
    { summary: 'Standup', start: '2026-09-27T14:00:00Z', location: 'Room 1' },
    { summary: '(busy)', start: '2026-09-27', location: '' },
  ]);
  assert.equal(Date.parse(events[0].start), Date.parse('2026-09-27T14:00:00Z'));
});

test("the caller's own address prefers mail and falls back to the principal name", async () => {
  assert.equal(await outlook.outlookOwnAddress(TOKEN, recordingFetch([{ mail: 'me@oshal.example.com', userPrincipalName: 'upn@oshal.example.com' }]).fetchImpl), 'me@oshal.example.com');
  assert.equal(await outlook.outlookOwnAddress(TOKEN, recordingFetch([{ mail: null, userPrincipalName: 'upn@oshal.example.com' }]).fetchImpl), 'upn@oshal.example.com');
});

test('the provider switch accepts google|outlook|yahoo only and treats absence as the default', () => {
  assert.deepEqual(providers.parseMailProvider(undefined), { ok: true, provider: null });
  assert.deepEqual(providers.parseMailProvider(''), { ok: true, provider: null });
  assert.deepEqual(providers.parseMailProvider('Outlook'), { ok: true, provider: 'outlook' });
  assert.deepEqual(providers.parseMailProvider('google'), { ok: true, provider: 'google' });
  assert.deepEqual(providers.parseMailProvider('yahoo'), { ok: true, provider: 'yahoo' });
  for (const bad of ['aol', 'imap', 'gmail', ['outlook'], 7]) assert.deepEqual(providers.parseMailProvider(bad), { ok: false });
});

test('Yahoo is never a brokered-token provider, so its app password cannot be resolved here', async () => {
  assert.deepEqual([...providers.TOKEN_PROVIDERS], ['google', 'outlook']);
  const asked = [];
  await providers.selectMailConnection(null, async (p) => { asked.push(p); return null; }, () => assert.fail('no error'));
  assert.deepEqual(asked, ['google', 'outlook']);
  assert.equal(providers.missingConnectionBody('yahoo').error, 'no_yahoo_connection');
  assert.match(providers.missingConnectionBody(null).message, /Yahoo Mail/);
  const refusal = new providers.MailboxRefusal(409, 'yahoo', providers.missingConnectionBody('yahoo'));
  assert.deepEqual([refusal.status, refusal.provider, refusal.body.error, refusal instanceof Error], [409, 'yahoo', 'no_yahoo_connection', true]);
});

test('a named provider resolves alone, with no fallback to another provider', async () => {
  const asked = [];
  const tokenFor = async (p) => { asked.push(p); return p === 'google' ? 'google-token' : null; };
  const onError = () => assert.fail('no broker error expected');
  assert.deepEqual(await providers.selectMailConnection('outlook', tokenFor, onError), { provider: 'outlook', token: null, reconnect: false });
  assert.deepEqual(asked, ['outlook']);
  assert.deepEqual(await providers.selectMailConnection(null, tokenFor, onError), { provider: 'google', token: 'google-token' });
  const outlookOnly = async (p) => (p === 'outlook' ? 'outlook-token' : null);
  assert.deepEqual(await providers.selectMailConnection(null, outlookOnly, onError), { provider: 'outlook', token: 'outlook-token' });
  assert.deepEqual(await providers.selectMailConnection(null, async () => null, onError), { provider: null, token: null, reconnect: false });
});

test('a refused refresh is reported as reconnect for that provider and logged, not thrown', async () => {
  const errors = [];
  const tokenFor = async (p) => { if (p === 'outlook') throw new Error('refresh 400'); return null; };
  const result = await providers.selectMailConnection('outlook', tokenFor, (p, err) => errors.push([p, err.message]));
  assert.deepEqual(result, { provider: 'outlook', token: null, reconnect: true });
  assert.deepEqual(errors, [['outlook', 'refresh 400']]);
  assert.deepEqual(providers.missingConnectionBody('outlook', true).error, 'reconnect_required');
  assert.deepEqual(providers.missingConnectionBody('outlook').error, 'no_outlook_connection');
  assert.deepEqual(providers.missingConnectionBody('google').error, 'no_google_connection');
  assert.deepEqual(providers.missingConnectionBody(null).error, 'no_mail_connection');
});
