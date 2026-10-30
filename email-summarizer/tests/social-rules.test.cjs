/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Social desk's rules and publish paths without a database or network: the posting plan's next free slot in the person's zone (skips taken slots and off days), post normalization (no channel, empty, over a channel's cap, a past time, variants kept only where they differ), and under OSHAL_EGRESS=kernel every publish reaches its provider with no Authorization header (X /2/tweets, LinkedIn userinfo then ugcPosts, Slack chat.postMessage in the chosen channel, a Facebook Page through /me/accounts, Mastodon statuses); a kernel "not connected" refusal is the channel's 409; Slack without a chosen channel is a 400; a post to two channels where one refuses ends partial with the refusal recorded; the due pass sends what is due and stops at its budget; Engage maps Slack DMs/mentions and X mentions and a reply goes to the thread or the tweet.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.OSHAL_EGRESS = 'kernel';
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const store = require('../routes/social-store.js');
const channels = require('../routes/social-channels.js');
const desk = require('../routes/social-desk.js');
test.after(() => { Module._load = original; });

/** A recording fetch that answers by URL and method; every request's headers are kept for inspection. */
function fakeFetch(answers) {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body ? JSON.parse(init.body) : null });
    for (const [match, answer] of answers) {
      if (u.includes(match)) {
        const a = typeof answer === 'function' ? answer(u, init) : answer;
        if (a instanceof Error) throw a;
        return new Response(JSON.stringify(a.body ?? a), { status: a.status || 200, headers: { 'content-type': 'application/json', ...(a.headers || {}) } });
      }
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

/** An in-memory stand-in for the admitted pool, enough for the desk's statements. */
function memoryDb() {
  const posts = new Map();
  let settings = null;
  return {
    posts,
    setSettings(s) { settings = s; },
    async query(sql, params) {
      if (/^INSERT INTO oshal_email_social_posts/.test(sql)) { posts.set(params[0], { post_id: params[0], user_sub: params[1], status: params[2], body: params[3], variants: params[4], channels: params[5], media_url: params[6], event_id: params[7], scheduled_at: params[8], sent_at: null, outcomes: '{}', created_at: new Date(), updated_at: new Date() }); return { rowCount: 1 }; }
      if (/^UPDATE oshal_email_social_posts/.test(sql)) {
        const row = posts.get(params[0]); if (!row) return { rowCount: 0 };
        const cols = [...sql.matchAll(/(\w+) = \$(\d+)/g)];
        for (const [, col, n] of cols) row[col] = params[Number(n) - 1];
        return { rowCount: 1 };
      }
      if (/FROM oshal_email_social_posts WHERE user_sub = \$1 AND status = 'scheduled' AND scheduled_at <= \$2/.test(sql)) return { rows: [...posts.values()].filter((r) => r.user_sub === params[0] && r.status === 'scheduled' && r.scheduled_at <= params[1]) };
      if (/FROM oshal_email_social_posts WHERE post_id = \$1/.test(sql)) { const r = posts.get(params[0]); return { rows: r && r.user_sub === params[1] ? [r] : [] }; }
      if (/FROM oshal_email_social_posts WHERE user_sub = \$1/.test(sql)) return { rows: [...posts.values()].filter((r) => r.user_sub === params[0] && (!/status = \$3/.test(sql) || r.status === params[2])) };
      if (/FROM oshal_email_social_settings/.test(sql)) return { rows: settings ? [settings] : [] };
      throw new Error(`unexpected sql ${sql}`);
    },
  };
}

const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body, extra = {}) => ({ oidc: { user: { sub: 'alice' } }, body, params: {}, query: {}, ...extra });

test('the queue slot is the next plan time in the zone, skipping off days and taken slots', () => {
  const plan = { days: [1, 2, 3, 4, 5], times: ['09:00', '12:30', '17:00'] };
  const friday17 = Date.UTC(2026, 9, 30, 22, 30); // Fri 2026-10-30 17:30 in Chicago (UTC-5)
  assert.equal(store.nextSlot(plan, friday17, [], 'America/Chicago'), '2026-11-02T15:00:00.000Z', 'Friday evening rolls to Monday 09:00 CST (UTC-6 after the DST change)');
  const monday8 = Date.UTC(2026, 10, 2, 14, 0);
  assert.equal(store.nextSlot(plan, monday8, ['2026-11-02T15:00:00.000Z'], 'America/Chicago'), '2026-11-02T18:30:00.000Z', 'a taken 09:00 gives 12:30');
  assert.equal(store.nextSlot({ days: [], times: [] }, monday8, [], 'UTC'), '2026-11-02T17:00:00.000Z', 'an empty plan falls back to the default: after 14:00 UTC the next default slot is 17:00');
  assert.equal(store.nextSlot({ days: [0], times: ['03:00'] }, monday8, ['2026-11-08T09:00:00.000Z'], 'America/Chicago'), '2026-11-15T09:00:00.000Z', 'Sunday 03:00 CST, the first one taken');
  assert.deepEqual(store.normalizePlan({ days: [5, 1, 9, 1], times: ['17:00', '9:00', '09:00', 'x'] }), { days: [1, 5], times: ['09:00', '17:00'] });
});

test('a post is normalized: channels known, variants kept where they differ, caps and times enforced', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0);
  const ok = desk.normalizePostInput({ text: 'Hello world', channels: ['x', 'slack', 'nope', 'x'], variants: { x: 'Hello world', slack: 'Hello <#team>' }, mediaUrl: 'https://img.example/a.png', when: 'queue' }, now);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.post.channels, ['x', 'slack']);
  assert.deepEqual(ok.post.variants, { slack: 'Hello <#team>' }, 'a variant equal to the shared text is not kept');
  assert.equal(ok.post.mediaUrl, 'https://img.example/a.png');
  assert.equal(ok.post.status, 'scheduled');
  assert.equal(desk.normalizePostInput({ text: 'x', channels: [], when: 'now' }, now).error, 'no_channels');
  assert.equal(desk.normalizePostInput({ text: '', channels: ['x'], when: 'now' }, now).error, 'empty');
  const long = desk.normalizePostInput({ text: 'a'.repeat(281), channels: ['x', 'linkedin'], when: 'now' }, now);
  assert.equal(long.error, 'too_long'); assert.equal(long.channel, 'x');
  assert.equal(desk.normalizePostInput({ text: 'a'.repeat(281), channels: ['linkedin'], when: 'now' }, now).ok, true, 'LinkedIn allows it');
  assert.equal(desk.normalizePostInput({ text: 'x', channels: ['x'], when: '2026-10-30T10:00:00Z' }, now).error, 'past');
  assert.equal(desk.normalizePostInput({ text: 'x', channels: ['x'], when: '2026-10-30T13:00:00Z' }, now).post.scheduledAt, '2026-10-30T13:00:00.000Z');
  assert.equal(desk.normalizePostInput({ text: 'x', channels: ['x'], mediaUrl: 'http://plain.example/a.png', when: 'draft' }, now).post.mediaUrl, '', 'only https media');
  assert.equal(desk.normalizePostInput({ when: 'draft' }, now).ok, true, 'a draft may be empty');
});

test('every publish reaches its provider with no credential; the kernel applies the connection', async () => {
  const calls = fakeFetch([
    ['api.twitter.com/2/tweets', { data: { id: '77' } }],
    ['api.linkedin.com/v2/userinfo', { sub: 'abc', name: 'Alice' }],
    ['api.linkedin.com/v2/ugcPosts', { status: 201, body: { id: 'urn:li:share:9' }, headers: { 'x-restli-id': 'urn:li:share:9' } }],
    ['slack.com/api/chat.postMessage', { ok: true, ts: '1.2', channel: 'C1' }],
    ['slack.com/api/chat.getPermalink', { ok: true, permalink: 'https://w.slack.com/archives/C1/p12' }],
    ['graph.facebook.com/v21.0/me/accounts', { data: [{ id: 'P1', name: 'My Page', access_token: 'page-token' }] }],
    ['graph.facebook.com/v21.0/P1/feed', { id: 'P1_55' }],
    ['mastodon.social/api/v1/statuses', { id: '5', url: 'https://mastodon.social/@a/5' }],
  ]);
  assert.deepEqual(await channels.publish('x', 'hi'), { ok: true, id: '77', url: 'https://x.com/i/web/status/77' });
  assert.equal((await channels.publish('linkedin', 'hi')).url, 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A9/');
  assert.equal((await channels.publish('slack', 'hi', { slackChannel: 'C1' })).url, 'https://w.slack.com/archives/C1/p12');
  assert.equal((await channels.publish('facebook', 'hi')).id, 'P1_55');
  assert.equal((await channels.publish('mastodon', 'hi')).url, 'https://mastodon.social/@a/5');
  assert.ok(calls.length >= 8);
  for (const c of calls) assert.equal(c.headers.authorization, undefined, `${c.url} carries no Authorization`);
  const tweet = calls.find((c) => c.url.endsWith('/2/tweets')); assert.deepEqual(tweet.body, { text: 'hi' });
  const slack = calls.find((c) => c.url.endsWith('chat.postMessage')); assert.deepEqual(slack.body, { channel: 'C1', text: 'hi' });
  const li = calls.find((c) => c.url.endsWith('ugcPosts')); assert.equal(li.body.author, 'urn:li:person:abc');
  const fb = calls.find((c) => c.url.includes('/P1/feed')); assert.equal(fb.body.access_token, 'page-token', 'the Page token travels in the body, as Graph expects');
});

test('refusals keep their shape: not connected is 409, no Slack channel 400, over the cap 400, a provider error 502', async () => {
  fakeFetch([
    ['api.twitter.com', new Error('twitter is not connected for this caller')],
    ['api.linkedin.com/v2/userinfo', { status: 401, body: {} }],
    ['graph.facebook.com/v21.0/me/accounts', { data: [] }],
    ['mastodon.social', { status: 422, body: { error: 'Validation failed: Text is too long' } }],
  ]);
  assert.equal((await channels.publish('x', 'hi')).code, 409);
  assert.equal((await channels.publish('x', 'hi')).error, 'no_x_connection');
  assert.equal((await channels.publish('slack', 'hi')).error, 'no_slack_channel');
  assert.equal((await channels.publish('x', 'a'.repeat(281))).error, 'too_long');
  assert.equal((await channels.publish('linkedin', 'hi')).code, 409, 'a 401 means the grant lapsed: reconnect');
  assert.equal((await channels.publish('facebook', 'hi')).error, 'no_facebook_pages');
  const m = await channels.publish('mastodon', 'hi');
  assert.equal(m.code, 502); assert.match(m.message, /Mastodon answered 422: Validation failed/);
});

test('posting now to two channels where one refuses ends partial, with the refusal recorded; a retry sends only the rest', async () => {
  const db = memoryDb();
  db.setSettings({ plan: '{}', slack_channel: 'C9', slack_label: '#general', timezone: 'UTC' });
  const calls = fakeFetch([
    ['api.twitter.com/2/tweets', { status: 403, body: { detail: 'You are not permitted' } }],
    ['slack.com/api/chat.postMessage', { ok: true, ts: '9.9', channel: 'C9' }],
    ['slack.com/api/chat.getPermalink', { ok: true, permalink: 'https://w/p99' }],
  ]);
  const ctx = { pool: db, appPackageDir: null, intent: async () => ({ connections: [{ provider: 'twitter' }, { provider: 'slack' }] }) };
  const router = desk.createSocialDeskRoutes(ctx);
  const r = res();
  await router.routes['POST /posts'](req({ text: 'Launch day', channels: ['x', 'slack'], when: 'now' }), r);
  assert.equal(r.code, 207);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.post.status, 'partial');
  assert.equal(r.body.post.outcomes.slack.ok, true);
  assert.equal(r.body.post.outcomes.x.ok, false);
  assert.match(r.body.post.outcomes.x.message, /X answered 403: You are not permitted/);
  const before = calls.length;
  fakeFetch([['api.twitter.com/2/tweets', { data: { id: '1' } }]]);
  const retry = res();
  await router.routes['POST /posts/:id/publish'](req({}, { params: { id: r.body.post.id } }), retry);
  assert.equal(retry.body.post.status, 'sent');
  assert.equal(retry.body.post.outcomes.slack.id, '9.9', 'the Slack outcome is kept; only X was sent again');
  assert.equal(global.fetch && before >= 3, true);
});

test('add to queue takes the next slot; the due pass sends what is due, inside its budget, and leaves the rest', async () => {
  const db = memoryDb();
  db.setSettings({ plan: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], times: ['00:00', '12:00'] }), slack_channel: '', slack_label: '', timezone: 'UTC' });
  fakeFetch([['api.twitter.com/2/tweets', { data: { id: '2' } }]]);
  const ctx = { pool: db, intent: async () => ({ connections: [{ provider: 'twitter' }] }) };
  const router = desk.createSocialDeskRoutes(ctx);
  const r = res();
  await router.routes['POST /posts'](req({ text: 'Queued', channels: ['x'], when: 'queue' }), r);
  assert.equal(r.code, 201);
  assert.equal(r.body.post.status, 'scheduled');
  assert.match(r.body.post.scheduledAt, /T(00|12):00:00\.000Z$/);
  const row = db.posts.get(r.body.post.id); row.scheduled_at = new Date(Date.now() - 1000).toISOString();
  db.posts.set('late', { post_id: 'late', user_sub: 'alice', status: 'scheduled', body: 'Later', variants: '{}', channels: '["x"]', media_url: '', event_id: '', scheduled_at: new Date(Date.now() + 3600000).toISOString(), outcomes: '{}' });
  const due = res();
  await router.routes['POST /run-due'](req({}), due);
  assert.deepEqual({ sent: due.body.sent, remaining: due.body.remaining }, { sent: 1, remaining: 0 });
  assert.equal(db.posts.get(r.body.post.id).status, 'sent');
  assert.equal(db.posts.get('late').status, 'scheduled', 'not due yet');
  desk.RUN_BUDGET_MS = -1;
  db.posts.get('late').scheduled_at = new Date(Date.now() - 1000).toISOString();
  const tight = res();
  await router.routes['POST /run-due'](req({}), tight);
  assert.equal(tight.body.remaining, 1, 'a pass past its budget leaves the post for the next one');
  desk.RUN_BUDGET_MS = 45000;
});

test('Engage maps Slack DMs and mentions and X mentions, and a reply goes to the thread or the tweet', async () => {
  const calls = fakeFetch([
    ['slack.com/api/auth.test', { ok: true, user_id: 'U1', user: 'alice', team: 'Acme' }],
    ['slack.com/api/users.conversations', { ok: true, channels: [{ id: 'D1', is_im: true, user: 'U2' }, { id: 'C1', name: 'general' }] }],
    ['conversations.history?channel=D1', { ok: true, messages: [{ user: 'U2', text: 'hey', ts: '1700000000.1' }, { user: 'U1', text: 'mine', ts: '1700000001.1' }] }],
    ['conversations.history?channel=C1', { ok: true, messages: [{ user: 'U3', text: 'ping <@U1> look', ts: '1700000002.1' }, { user: 'U3', text: 'unrelated', ts: '1700000003.1' }] }],
    ['users.info?user=U2', { ok: true, user: { real_name: 'Bob' } }],
    ['users.info?user=U3', { ok: true, user: { profile: { display_name: 'Cy' } } }],
    ['api.twitter.com/2/users/me', { data: { id: '42' } }],
    ['/2/users/42/mentions', { data: [{ id: '9', text: '@alice nice', author_id: '7', created_at: '2026-10-30T01:00:00Z' }], includes: { users: [{ id: '7', username: 'dan', name: 'Dan' }] } }],
    ['api.twitter.com/2/tweets', { data: { id: '10' } }],
    ['chat.postMessage', { ok: true, ts: '5', channel: 'C1' }],
    ['chat.getPermalink', { ok: true, permalink: 'https://w/p5' }],
  ]);
  const router = desk.createSocialDeskRoutes({ pool: memoryDb(), intent: async () => ({ connections: [{ provider: 'slack' }, { provider: 'twitter' }] }) });
  const r = res();
  await router.routes['GET /engage'](req({}), r);
  assert.deepEqual(r.body.items.map((i) => [i.channel, i.kind, i.from, i.text]), [['x', 'mention', 'Dan (@dan)', '@alice nice'], ['slack', 'mention', 'Cy', 'ping @you look'], ['slack', 'dm', 'Bob', 'hey']]);
  const rep = res();
  await router.routes['POST /engage/reply'](req({ channel: 'slack', replyTo: { channelId: 'C1', ts: '1700000002.1' }, text: 'on it' }), rep);
  assert.equal(rep.body.ok, true);
  assert.deepEqual(calls.find((c) => c.url.endsWith('chat.postMessage')).body, { channel: 'C1', text: 'on it', thread_ts: '1700000002.1' });
  const tw = res();
  await router.routes['POST /engage/reply'](req({ channel: 'x', replyTo: { tweetId: '9' }, text: 'thanks' }), tw);
  assert.deepEqual(calls.find((c) => c.url.endsWith('/2/tweets')).body, { text: 'thanks', reply: { in_reply_to_tweet_id: '9' } });
});

test('the channel rail reports each state from the connection metadata and who the account is', async () => {
  fakeFetch([
    ['api.twitter.com/2/users/me', { data: { id: '42', name: 'Alice', username: 'alice', profile_image_url: 'https://p/a_normal.jpg' } }],
    ['slack.com/api/auth.test', { ok: true, user_id: 'U1', user: 'alice', team: 'Acme' }],
    ['users.info', { ok: true, user: { profile: { image_72: 'https://p/s.png' } } }],
  ]);
  const router = desk.createSocialDeskRoutes({ pool: memoryDb(), intent: async () => ({ connections: [{ provider: 'twitter' }, { provider: 'slack' }, { provider: 'linkedin', revoked: true }] }) });
  const r = res();
  await router.routes['GET /channels'](req({}, { query: { identity: '1' } }), r);
  const by = Object.fromEntries(r.body.channels.map((c) => [c.id, c]));
  assert.deepEqual(by.x.account, { name: 'Alice', handle: '@alice', avatar: 'https://p/a_bigger.jpg', accountId: '42' });
  assert.equal(by.slack.account.handle, 'Acme workspace');
  assert.equal(by.linkedin.state, 'reconnect');
  assert.equal(by.facebook.state, 'none');
  assert.equal(by.x.limit, 280);
  assert.equal(r.body.native, true);
  assert.ok(r.body.destinations.some((d) => d.id === 'youtube'));
});
