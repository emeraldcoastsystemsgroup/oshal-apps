/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.0 (Lane FINH2): a stand-in Gmail API on loopback for the mail suites (tests/mail-bills.test.cjs, tests/browser/mail-bills.browser.test.cjs). It lists the messages it holds and answers each by id in the shapes Gmail's users.messages.list and users.messages.get (format=full) give, records every request (method, path, query, and any Authorization header), and can refuse every request with a status. Its fetch stands in for the kernel's egress: Finance's request goes to the stand-in unchanged, and only the declared mail host is allowed. Every sender, payee and figure is invented; no real mailbox is read.
 * -----------------------------------------------------------------------------
 */
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');

const b64 = (s) => Buffer.from(s).toString('base64url');
const dayOffset = (n) => new Date(Date.now() + n * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const words = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** A Gmail message (format=full) a stand-in mailbox holds. */
function mail(id, from, subject, body, daysAgo) {
  return { id, threadId: id, internalDate: String(dayOffset(-daysAgo).getTime()), snippet: subject,
    payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64(body) } }] } };
}
const WATER = () => mail('m-water', '"Pinecrest Water Co Billing" <billing@pinecrest-water.example>', 'Your water bill', `Amount due: $48.20. Payment due date: ${words(dayOffset(10))}. Pay online at the stand-in site.`, 3);
const CARD = () => mail('m-card', 'Harbor Card <statements@harborcard.example>', 'Your statement is ready', `Minimum payment due $35.00. Statement balance: $642.17. Payment due date ${words(dayOffset(18))}.`, 2);
const RECEIPT = () => mail('m-receipt', 'Lantern Ridge <alerts@lanternridge.example>', 'Payment received', 'Thank you for your payment of $48.20.', 1);
const NEWS = () => mail('m-news', 'Stand-in News <news@example.test>', 'This week', 'A statement about the weather.', 1);

/** A stand-in Gmail API on loopback: lists the messages it holds, answers each by id, records every request. */
async function standIn(messages, options = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization || null });
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (options.status) return send(options.status, { error: { code: options.status, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } });
    if (url.pathname === '/gmail/v1/users/me/messages') {
      const start = Number(url.searchParams.get('pageToken') || 0), size = Number(url.searchParams.get('maxResults') || 25), list = messages();
      const page = list.slice(start, start + size).map((m) => ({ id: m.id, threadId: m.threadId }));
      return send(200, { messages: page, ...(start + size < list.length ? { nextPageToken: String(start + size) } : {}), resultSizeEstimate: list.length });
    }
    const one = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(url.pathname);
    const found = one && messages().find((m) => m.id === decodeURIComponent(one[1]));
    return found ? send(200, found) : send(404, { error: { code: 404 } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  /** The kernel's egress, stood in: the request goes to the stand-in exactly as Finance wrote it. */
  const fetcher = (url, init) => {
    assert.ok(url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/'), `Finance asks only the declared mail host: ${url}`);
    return fetch(url.replace('https://gmail.googleapis.com', base), init);
  };
  return { requests, fetcher, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { b64, dayOffset, iso, words, mail, WATER, CARD, RECEIPT, NEWS, standIn };
