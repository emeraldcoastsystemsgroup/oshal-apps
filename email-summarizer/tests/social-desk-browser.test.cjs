/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Social desk in Chromium over a loopback fixture of its routes, the schedules API and the connector list - no network, accounts or credentials: the rail shows the connected X and Slack accounts by name and LinkedIn as not connected; New post opens the composer with both connected channels on, the counter names the tightest channel, a channel tab customizes its text, and Add to queue sends one POST /posts with the shared text, the variant and when=queue; the queue then lists the post under its day with the Turn on banner, and Turn on activates the social-publish job as a person; Go Live's Plan a stream sends the event with three announcements on the chosen channels; the Channels view offers Connect LinkedIn and the Slack channel picker saves the choice; at 412 px nothing scrolls sideways.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Engage and Go Live): opened on their own (?view=engage / ?view=live) the desk draws no inner strip at 412 px and the view's one primary is its own; Engage states "Slack and X" once, says "Connect Slack or X to see mentions" with one Connect a channel primary when neither is connected (its Channels view has a back control and Back returns), says "Nothing waiting for you" only with a channel connected, and has a 44px Refresh with the checked time; Go Live reads "Save stream" with no announce channel, says "Connect a channel to announce", toasts what a save queued, names the announcing channels or "Not announced" on each card, and keeps Delete in the card's ⋯ menu behind an in-page confirm after a greyed Edit placeholder (RP-COM-01) that does nothing when pressed.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const CHANNELS = [
  { id: 'x', label: 'X', limit: 280, kind: 'social', color: '#000', connect: 'twitter', state: 'connected', account: { name: 'Alice Rivers', handle: '@alice', avatar: '', accountId: '42' } },
  { id: 'linkedin', label: 'LinkedIn', limit: 3000, kind: 'social', color: '#0a66c2', connect: 'linkedin', state: 'none' },
  { id: 'facebook', label: 'Facebook Page', limit: 63206, kind: 'social', color: '#1877f2', connect: 'facebook', state: 'none' },
  { id: 'slack', label: 'Slack', limit: 4000, kind: 'chat', color: '#4a154b', connect: 'slack', state: 'connected', account: { name: 'alice', handle: 'Acme workspace', avatar: '', accountId: 'U1' }, slackChannel: '', slackLabel: '' },
  { id: 'mastodon', label: 'Mastodon', limit: 500, kind: 'social', color: '#6364ff', connect: 'mastodon', state: 'none' },
];
const DESTINATIONS = [{ id: 'youtube', label: 'YouTube', console: 'https://studio.youtube.com/' }, { id: 'twitch', label: 'Twitch', console: 'https://dashboard.twitch.tv/' }];

/** The routes the page calls, with a recorded request log. */
function fixture(opts = {}) {
  const channels = opts.channels || CHANNELS;
  const state = { job: 'inactive', posts: [], events: [], engage: opts.engage || { items: [], sources: { slack: { state: 'connected' }, x: { state: 'connected' } } }, settings: { plan: { days: [1, 2, 3, 4, 5], times: ['09:00', '12:30', '17:00'] }, slackChannel: '', slackLabel: '', timezone: 'UTC', saved: true }, requests: [] };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    state.requests.push({ method: req.method, path: url.pathname, search: url.search, body });
    const p = url.pathname;
    if (p === '/api/email-social/' || p === '/api/email-social') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(PKG, 'tools', 'email-social.html'))); }
    if (p.startsWith('/shared/ui/')) { res.writeHead(200, { 'content-type': p.endsWith('.css') ? 'text/css' : 'text/javascript' }); return res.end(''); }
    if (p === '/api/email-social/channels') return send(res, 200, { native: true, channels, destinations: DESTINATIONS });
    if (p === '/api/email-social/engage') return send(res, 200, state.engage);
    if (p.startsWith('/api/email-social/events/') && req.method === 'DELETE') { state.events = state.events.filter((e) => e.id !== p.split('/').pop()); return send(res, 200, { ok: true }); }
    if (p === '/api/email-social/settings') { if (req.method === 'PUT') Object.assign(state.settings, body); return send(res, 200, state.settings); }
    if (p === '/api/email-social/slack/channels') return send(res, 200, { ok: true, channels: [{ id: 'C1', name: 'general', isPrivate: false }, { id: 'C2', name: 'launch', isPrivate: true }] });
    if (p === '/api/email-social/posts' && req.method === 'GET') return send(res, 200, { posts: state.posts });
    if (p === '/api/email-social/posts' && req.method === 'POST') {
      const post = { id: 'post_' + (state.posts.length + 1), status: body.when === 'draft' ? 'draft' : 'scheduled', text: body.text, variants: body.variants || {}, channels: body.channels, mediaUrl: body.mediaUrl || '', scheduledAt: new Date(Date.now() + 3600000).toISOString(), outcomes: {}, createdAt: new Date().toISOString() };
      state.posts.push(post); return send(res, 201, { post });
    }
    if (p === '/api/email-social/events' && req.method === 'GET') return send(res, 200, { events: state.events, destinations: DESTINATIONS });
    if (p === '/api/email-social/events' && req.method === 'POST') {
      // As the route does: an announcement with no channel is not a post; "Announce it now" goes out at once.
      const posts = (body.announcements || []).filter((a) => a.channels && a.channels.length).map((a, i) => ({ id: 'ann_' + i, eventId: 'live_1', channels: a.channels, status: a.key === 'announce' ? 'sent' : 'scheduled', scheduledAt: a.at, sentAt: a.key === 'announce' ? new Date().toISOString() : null }));
      const ev = { id: 'live_1', ...body, status: 'planned', posts }; state.events.push(ev); return send(res, 201, { event: ev, posts });
    }
    if (p === '/api/connect/list') return send(res, 200, { providers: [{ id: 'twitter', configured: true }, { id: 'linkedin', configured: true }, { id: 'facebook', configured: true }, { id: 'slack', configured: true }, { id: 'mastodon', configured: false }] });
    if (p === '/api/v1/agent/schedules') return send(res, 200, { schedules: [{ id: 'job-s', app: 'email-summarizer', name: 'social-publish', status: state.job }] });
    if (p === '/api/v1/agent/schedules/job-s/activate') { state.job = 'active'; return send(res, 200, { status: 'active' }); }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, origin: `http://127.0.0.1:${server.address().port}` })));
}

async function page(t, viewport, query = '', opts = {}) {
  const fx = await fixture(opts);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => fx.server.close(r)); });
  const p = await browser.newPage({ viewport });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(fx.origin + '/api/email-social/' + query);
  await p.waitForSelector('.chrow', { state: 'attached' });
  return { p, fx, errors };
}

test('the rail names the connected accounts and the composer writes once, customizes per channel and adds to the queue', async (t) => {
  const { p, fx, errors } = await page(t, { width: 1280, height: 860 });
  const rail = await p.locator('.chrow').allInnerTexts();
  assert.match(rail.join('\n'), /Alice Rivers[\s\S]*@alice/);
  assert.match(rail.join('\n'), /LinkedIn[\s\S]*Not connected/);
  assert.match(await p.locator('#body').innerText(), /Your queue is empty/);
  await p.click('#newPost');
  await p.waitForSelector('.scrim.open');
  assert.equal(await p.locator('.avtog.on').count(), 2, 'X and Slack start selected');
  await p.fill('#cText', 'Launch day: the desk is live.');
  assert.match(await p.locator('#cCount').innerText(), /29 \/ 280 \(X is the tightest\)/);
  assert.match(await p.locator('#pCard').innerText(), /Alice Rivers[\s\S]*Launch day/);
  await p.click('#cTabs button:has-text("Slack")');
  await p.fill('#cText', 'Launch day: the desk is live. <!channel>');
  assert.match(await p.locator('#cHint').innerText(), /Custom text for Slack/);
  await p.click('#cTabs button:has-text("All channels")');
  assert.equal(await p.inputValue('#cText'), 'Launch day: the desk is live.', 'the shared text is kept');
  await p.click('#cQueue');
  await p.waitForSelector('.post');
  const created = fx.state.requests.find((r) => r.method === 'POST' && r.path === '/api/email-social/posts');
  assert.deepEqual(created.body, { text: 'Launch day: the desk is live.', channels: ['x', 'slack'], variants: { slack: 'Launch day: the desk is live. <!channel>' }, mediaUrl: '', when: 'queue' });
  assert.match(await p.locator('#body').innerText(), /Scheduled posts go out when your publishing job is on/);
  await p.click('#turnOn');
  await p.waitForSelector('.banner.ok');
  assert.ok(fx.state.requests.some((r) => r.path === '/api/v1/agent/schedules/job-s/activate' && r.body.class === 'person'));
  assert.deepEqual(errors, []);
});

test('Go Live plans a stream with three announcements; Channels offers Connect and saves the Slack channel; 412 px does not scroll sideways', async (t) => {
  const { p, fx, errors } = await page(t, { width: 412, height: 915 }, '?view=live');
  assert.match(await p.locator('#body').innerText(), /No streams planned/);
  await p.click('#headActions button');
  await p.fill('#lvTitle', 'Friday build night');
  await p.click('#lvDest button:has-text("YouTube")');
  assert.match(await p.locator('#lvAnn').innerText(), /Announce it now[\s\S]*15 minutes before[\s\S]*When it starts/);
  assert.match(await p.inputValue('#lvAnn textarea'), /Friday build night — on YouTube/);
  await p.click('#lvSave');
  await p.waitForFunction(() => document.body.innerText.includes('Friday build night') && !document.querySelector('#liveForm:not([hidden])'));
  const ev = fx.state.requests.find((r) => r.method === 'POST' && r.path === '/api/email-social/events').body;
  assert.equal(ev.title, 'Friday build night');
  assert.deepEqual(ev.destinations, ['youtube']);
  assert.deepEqual(ev.announcements.map((a) => [a.key, a.channels]), [['announce', ['x', 'slack']], ['soon', ['x', 'slack']], ['live', ['x', 'slack']]]);
  await p.locator('#toast').getByText('Saved · 1 announcement sent, 2 announcements queued').waitFor();
  assert.match(await p.locator('.announcers').innerText(), /Announced on X, Slack/);
  await p.goto(fx.origin + '/api/email-social/');
  await p.waitForSelector('.chrow', { state: 'attached' });
  await p.click('.nav button[data-view="channels"]');
  await p.waitForSelector('.ccard');
  assert.ok(await p.locator('.ccard button:has-text("Connect LinkedIn")').count());
  await p.selectOption('.ccard select', 'C2');
  await p.waitForFunction(() => fetch('/api/email-social/settings').then((r) => r.json()).then((s) => s.slackChannel === 'C2'));
  assert.equal(fx.state.settings.slackLabel, '🔒 launch');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0, 'no sideways scroll at 412 px');
  await p.click('.nav button[data-view="calendar"]');
  await p.waitForSelector('.cal');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'the week calendar scrolls inside its own box, never the page');
  assert.deepEqual(errors, []);
});

const NOTHING = CHANNELS.map((c) => ({ ...c, state: 'none', account: undefined }));

test('Go Live with no announce channel: Save stream, "Connect a channel to announce", and the toast says nothing was announced', async (t) => {
  const { p, fx, errors } = await page(t, { width: 412, height: 915 }, '?view=live', { channels: NOTHING });
  assert.equal(await p.locator('.rail').isVisible(), false, 'no inner strip on the phone: the app bar reaches Go Live');
  assert.equal(await p.locator('#newPost').isVisible(), false, 'New post is not repeated on this view');
  await p.getByRole('button', { name: 'Plan a stream' }).click();
  assert.equal(await p.locator('#headActions button').isVisible(), false, 'one primary while the form is open');
  assert.match(await p.locator('#lvCh').innerText(), /Connect a channel to announce/);
  assert.equal(await p.locator('#lvSave').innerText(), 'Save stream');
  await p.fill('#lvTitle', 'Quiet stream');
  await p.click('#lvSave');
  await p.locator('#toast').getByText('Saved · not announced').waitFor();
  const ev = fx.state.requests.find((r) => r.method === 'POST' && r.path === '/api/email-social/events').body;
  assert.deepEqual(ev.announcements, [], 'nothing is sent as an announcement without a channel');
  await p.locator('.announcers').getByText('Not announced').waitFor();
  await p.getByRole('button', { name: 'Plan a stream' }).click();
  await p.locator('#lvToCh').click();
  await p.locator('#title').getByText('Channels').waitFor();
  await p.getByRole('button', { name: 'Back' }).click();
  await p.locator('#title').getByText('Go Live').waitFor();
  assert.deepEqual(errors, []);
});

test("Go Live's card menu: Edit is a greyed planned control that does nothing; Delete asks in the page first", async (t) => {
  const { p, fx, errors } = await page(t, { width: 1280, height: 860 }, '?view=live');
  assert.ok(await p.locator('#newPost.quiet').count(), 'on desktop New post is not a second primary on Go Live');
  await p.getByRole('button', { name: 'Plan a stream' }).click();
  await p.fill('#lvTitle', 'Friday build night');
  await p.click('#lvSave');
  await p.locator('.post').getByText('Friday build night').waitFor();
  assert.equal(await p.locator('.post').getByRole('button', { name: 'Delete', exact: true }).count(), 0, 'Delete is not beside the card');
  await p.getByRole('button', { name: 'More for Friday build night' }).click();
  const edit = p.locator('#rowMenu [data-ds-not-yet]');
  await edit.waitFor();
  assert.equal(await edit.getAttribute('aria-disabled'), 'true');
  assert.equal(await edit.getAttribute('data-ds-backlog'), 'RP-COM-01');
  assert.match(await edit.getAttribute('title'), /Not available yet/);
  const before = { html: await p.locator('body').innerHTML(), requests: fx.state.requests.length, url: p.url() };
  const at = await edit.boundingBox();
  await p.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  await p.waitForTimeout(1000);
  assert.equal(await p.locator('body').innerHTML(), before.html, 'a press changes nothing on the page');
  assert.equal(fx.state.requests.length, before.requests, 'no request');
  assert.equal(p.url(), before.url);
  await p.locator('#rowMenu').getByRole('menuitem', { name: 'Delete…' }).click();
  const ask = p.locator('.confirm');
  await ask.getByText('Delete this stream and its unsent announcements?').waitFor();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await p.locator('.confirm').count(), 0);
  assert.ok(!fx.state.requests.some((r) => r.method === 'DELETE'), 'Cancel keeps the stream');
  await p.getByRole('button', { name: 'More for Friday build night' }).click();
  await p.locator('#rowMenu').getByRole('menuitem', { name: 'Delete…' }).click();
  await p.locator('.confirm').getByRole('button', { name: 'Delete', exact: true }).click();
  await p.locator('#body').getByText('No streams planned').waitFor();
  assert.ok(fx.state.requests.some((r) => r.method === 'DELETE' && r.path === '/api/email-social/events/live_1'));
  assert.deepEqual(errors, []);
});

test('Engage with neither Slack nor X connected says so with one Connect a channel; the scope is stated once', async (t) => {
  const engage = { items: [], sources: { slack: { state: 'none', items: [] }, x: { state: 'none', items: [] } } };
  const { p, errors } = await page(t, { width: 412, height: 915 }, '?view=engage', { channels: NOTHING, engage });
  await p.locator('#body').getByText('Connect Slack or X to see mentions').waitFor();
  assert.equal(await p.locator('#body').getByText('Nothing waiting for you').count(), 0, 'no false reassurance');
  assert.match(await p.locator('#subtitle').innerText(), /^Slack and X: /);
  assert.equal(await p.locator('.rail').isVisible(), false, 'no clipped inner strip on the phone');
  assert.equal(await p.locator('.btn.primary:visible').count(), 1, 'one primary');
  const refresh = await p.getByRole('button', { name: 'Refresh' }).boundingBox();
  assert.deepEqual([Math.round(refresh.width), Math.round(refresh.height)], [44, 44]);
  await p.locator('#checkedAt').getByText(/^Checked /).waitFor();
  await p.getByRole('button', { name: 'Connect a channel' }).click();
  await p.locator('#title').getByText('Channels').waitFor();
  await p.goBack();
  await p.locator('#title').getByText('Engage').waitFor();
  assert.deepEqual(errors, []);
});

test('Engage with a channel connected and nothing new says "Nothing waiting for you"', async (t) => {
  const engage = { items: [], sources: { slack: { state: 'connected' }, x: { state: 'none' } } };
  const { p, errors } = await page(t, { width: 1280, height: 860 }, '?view=engage', { engage });
  await p.locator('#body').getByText('Nothing waiting for you').waitFor();
  assert.equal(await p.locator('#body').getByText('Connect Slack or X to see mentions').count(), 0);
  assert.ok(await p.locator('#newPost.quiet').count(), 'on desktop New post is not a second primary on Engage');
  assert.deepEqual(errors, []);
});
