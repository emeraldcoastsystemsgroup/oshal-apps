/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: 'Connect Google or Outlook' on My Day and Inbox opened the generic
 *   Connections page (1149 connector declarations, unfiltered). The shipped connect notice (cut out of both pages and run)
 *   offers one button per mailbox provider that starts that provider's sign-in through the kernel's
 *   GET /connectors/<id>/authorize at the top level, keeps an All connections link, and says so when sign-in is refused.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGES = ['email-my-day.html', 'email-inbox.html'];

/** The page's notice helpers, run with a recording fetch. */
function load(page, answer) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', page), 'utf8');
  const notice = /const NOTICE = \{[\s\S]*?\n\};/.exec(html);
  const a = html.indexOf('/* mailbox-connect:start */');
  const b = html.indexOf('/* mailbox-connect:end */');
  assert.ok(notice && a > 0 && b > a, `${page} marks its connect notice`);
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return answer; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = new Function('fetch', 'esc', 'URL', notice[0] + html.slice(a, b) + '\nreturn { connectNotice, startMailboxConnect };')(fetch, esc, URL);
  return { api, calls, html };
}

const ok = { ok: true, json: async () => ({ authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x' }) };

for (const page of PAGES) {
  test(`${page}: no mailbox offers Google and Outlook sign-in buttons and an All connections link`, () => {
    const { api } = load(page, ok);
    const html = api.connectNotice({ connected: false, error: 'no_mail_connection' });
    assert.match(html, /data-connect="gmail">Connect Google \(Gmail\)</);
    assert.match(html, /data-connect="outlook">Connect Outlook \/ Microsoft 365</);
    assert.match(html, /<a href="\/utilities" target="_top">All connections<\/a>/);
    assert.doesNotMatch(html, /Connect Google or Outlook/);
    assert.deepEqual([...api.connectNotice({ error: 'no_outlook_connection' }).matchAll(/data-connect="(\w+)"/g)].map((m) => m[1]), ['outlook']);
  });

  test(`${page}: a button starts that provider's sign-in at the top level`, async () => {
    const { api, calls } = load(page, ok);
    const went = [];
    assert.equal(await api.startMailboxConnect('gmail', { textContent: '' }, (href) => went.push(href)), true);
    assert.equal(calls[0].url, '/connectors/gmail/authorize');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.deepEqual(went, ['https://accounts.google.com/o/oauth2/v2/auth?client_id=x']);
  });

  test(`${page}: a refused or insecure sign-in is said, and nothing navigates`, async () => {
    const note = { textContent: '' };
    const refused = load(page, { ok: false, json: async () => ({ detail: 'connector is not configured', refused: 'not_configured' }) });
    const went = [];
    assert.equal(await refused.api.startMailboxConnect('outlook', note, (h) => went.push(h)), false);
    assert.match(note.textContent, /^connector is not configured You can connect it from All connections\.$/);
    const insecure = load(page, { ok: true, json: async () => ({ authorize_url: 'http://example.test/auth' }) });
    assert.equal(await insecure.api.startMailboxConnect('gmail', note, (h) => went.push(h)), false);
    assert.deepEqual(went, []);
  });

  test(`${page}: the rendered notice's buttons are wired to startMailboxConnect`, () => {
    const { html } = load(page, ok);
    assert.match(html, /innerHTML = connectNotice\(\w+\); bindConnectButtons\(\w+\); return; \}/);
    assert.match(html, /b\.onclick = function \(\) \{ startMailboxConnect\(b\.getAttribute\('data-connect'\)/);
  });
}
