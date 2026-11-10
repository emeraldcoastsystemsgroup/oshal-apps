/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard (0.7.0): publishing with an attached image works (and the Composer's Attach to posts sends it). Drives the COMPILED POST /compose/publish handler, the Streams publish plan and the Stage fan-out against a local fake of X's v2 API (chunked media upload on api.twitter.com, then POST /2/tweets): an attached PNG is uploaded (initialize, 512 KiB appends each under the kernel egress's 1 MiB body limit, finalize, a STATUS poll while X says pending) and the post names its media id; under the native kernel no request carries a credential; X's 403 on the upload answers "reconnect X … nothing was posted" with no POST /2/tweets; an unreadable reference and an image over 5 MB are refused before any call; LinkedIn/Facebook (broker path) refuse an image in words. Red on 0.6.7: /publish answered 501 media_attach_unsupported and Streams/Stage dropped mediaRef.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const handlers = new Map();
const fakeRouter = () => {
  const router = { get(p, ...h) { handlers.set(`GET ${p}`, h[h.length - 1]); return router; }, post(p, ...h) { handlers.set(`POST ${p}`, h[h.length - 1]); return router; },
    put() { return router; }, patch() { return router; }, delete() { return router; }, use() { return router; } };
  return router;
};
const STUBS = {
  express: { Router: fakeRouter },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => 'legacy-token' },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: 'draft' }) },
  '@/features/video-generation': { resolveStoryboardImageProvider: async () => ({}), recordStoryboardImageCost: async () => {} },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => Boolean(b && b.confirm === true),
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm` }),
  },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createComposeRoutes, publishTo } = require('../routes/switchboard-compose-routes.js');
const { buildPublishPlan, runPublishPlan } = require('../routes/switchboard-streams-model.js');
const { normalizeBroadcast, runFanout } = require('../routes/switchboard-stage-fanout.js');
test.after(() => { Module._load = original; });

const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
createComposeRoutes({ appPackageDir: PKG, pool });
const publish = handlers.get('POST /publish');

/** A PNG data URL of `size` bytes (a real PNG signature, then filler). */
function png(size) {
  const bytes = Buffer.alloc(size, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * @description A local fake of X: answers the media upload and the post, records every call.
 * @param {object} [opts] { refuse: status for initialize, pending: STATUS polls before success }.
 * @returns {{calls: object[], fetch: Function}} The recorder and the fetch.
 */
function fakeX({ refuse = 0, pending = 0 } = {}) {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ host: u.host, path: u.pathname, query: u.search, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (u.pathname === '/2/media/upload/initialize') return refuse ? json({ title: 'Forbidden', detail: 'Forbidden', status: refuse }, refuse) : json({ data: { id: '1880000000000000001', expires_after_secs: 86400 } });
    if (/\/2\/media\/upload\/\d+\/append$/.test(u.pathname)) return json({ data: { expires_at: 1 } });
    if (/\/2\/media\/upload\/\d+\/finalize$/.test(u.pathname)) return json({ data: { id: '1880000000000000001', ...(pending ? { processing_info: { state: 'pending', check_after_secs: 1 } } : {}) } });
    if (u.pathname === '/2/media/upload' && u.searchParams.get('command') === 'STATUS') {
      polls += 1;
      return json({ data: { id: '1880000000000000001', processing_info: { state: polls >= pending ? 'succeeded' : 'in_progress', check_after_secs: 1 } } });
    }
    if (u.pathname === '/2/tweets') return json({ data: { id: '1990000000000000002', text: JSON.parse(init.body).text } }, 201);
    return json({ title: 'Not Found' }, 404);
  };
  return { calls, fetch };
}

/**
 * @description Call the compiled POST /publish as alice with a fake X.
 * @param {object} body Request body. @param {object} x fakeX(). @param {boolean} [kernel] Native kernel egress.
 * @returns {Promise<{status:number, body:object}>} The answer.
 */
async function callPublish(body, x, kernel = true) {
  const saved = globalThis.fetch;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  globalThis.fetch = x.fetch;
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } };
  try { await publish({ oidc: { user: { sub: 'alice' } }, body }, res); } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; }
  return { status: res.statusCode, body: res.body };
}

test('Compose publishes an attached image to X: chunked upload, then the post names the media id (native kernel)', async () => {
  const x = fakeX();
  const image = png(1_200_000);
  const r = await callPublish({ platform: 'x', text: 'New board is live.', mediaRef: image, confirm: true }, x);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.ok, r.body.tweetId, r.body.mediaId], [true, '1990000000000000002', '1880000000000000001']);
  const paths = x.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(paths, ['POST /2/media/upload/initialize', 'POST /2/media/upload/1880000000000000001/append', 'POST /2/media/upload/1880000000000000001/append',
    'POST /2/media/upload/1880000000000000001/append', 'POST /2/media/upload/1880000000000000001/finalize', 'POST /2/tweets']);
  for (const call of x.calls) {
    assert.equal(call.host, 'api.twitter.com', 'the X connection is placed only on its API host');
    assert.ok(!Object.keys(call.headers).some((h) => h.toLowerCase() === 'authorization'), 'under the kernel the egress adds the credential');
    assert.ok(!call.body || Buffer.byteLength(call.body) < 1024 * 1024, 'every body fits the kernel egress 1 MiB limit');
  }
  const init = JSON.parse(x.calls[0].body);
  assert.deepEqual(init, { media_type: 'image/png', total_bytes: 1_200_000, media_category: 'tweet_image' });
  const appended = x.calls.filter((c) => c.path.endsWith('/append')).map((c) => JSON.parse(c.body));
  assert.deepEqual(appended.map((a) => a.segment_index), [0, 1, 2]);
  assert.ok(Buffer.concat(appended.map((a) => Buffer.from(a.media, 'base64'))).equals(Buffer.from(image.split(',')[1], 'base64')), 'the uploaded bytes are the attached image');
  assert.deepEqual(JSON.parse(x.calls.at(-1).body), { text: 'New board is live.', media: { media_ids: ['1880000000000000001'] } });
});

test('X still processing: STATUS is polled until it succeeds, then the post goes out', async () => {
  const x = fakeX({ pending: 2 });
  const sleeps = [];
  const realTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => { sleeps.push(ms); return realTimeout(fn, 0); };
  try {
    const r = await callPublish({ platform: 'x', text: 'gif day', mediaRef: png(1000), confirm: true }, x);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally { global.setTimeout = realTimeout; }
  assert.equal(x.calls.filter((c) => c.query.includes('command=STATUS')).length, 2);
  assert.equal(x.calls.at(-1).path, '/2/tweets');
});

test('X refuses the upload (403, no media.write): words to reconnect X, and nothing is posted', async () => {
  const x = fakeX({ refuse: 403 });
  const r = await callPublish({ platform: 'x', text: 'Hello', mediaRef: png(2000), confirm: true }, x);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'x_media_not_allowed');
  assert.match(r.body.message, /Reconnect X in Connections/);
  assert.match(r.body.message, /Nothing was posted/);
  assert.ok(!x.calls.some((c) => c.path === '/2/tweets'), 'no post without the image');
});

test('an unreadable reference or an image over 5 MB is refused before any request to X', async () => {
  for (const [mediaRef, error] of [['art_abc123456', 'media_unreadable'], ['data:text/plain;base64,aGk=', 'media_unreadable'], [png(5 * 1024 * 1024 + 1), 'media_too_large'], ['data:image/bmp;base64,Qk0=', 'media_type_unsupported']]) {
    const x = fakeX();
    const r = await callPublish({ platform: 'x', text: 'Hello', mediaRef, confirm: true }, x);
    assert.equal(r.body.error, error, mediaRef.slice(0, 30));
    assert.match(r.body.message, /Nothing was posted/);
    assert.equal(x.calls.length, 0);
  }
});

test('outside the kernel the Bearer token rides every upload step; LinkedIn and Facebook refuse an image in words', async () => {
  const x = fakeX();
  const r = await callPublish({ platform: 'x', text: 'Hi', mediaRef: png(3000), confirm: true }, x, false);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const call of x.calls) assert.equal(call.headers.Authorization, 'Bearer legacy-token');
  for (const platform of ['linkedin', 'facebook']) {
    const other = fakeX();
    const refused = await callPublish({ platform, text: 'Hi', mediaRef: png(3000), confirm: true }, other, false);
    assert.equal(refused.status, 501);
    assert.equal(refused.body.error, 'media_unsupported');
    assert.match(refused.body.message, /carry text only/);
    assert.equal(other.calls.length, 0);
  }
});

test('the Composer attaches the generated image and sends it with Publish, Schedule and Send to all', () => {
  const html = require('node:fs').readFileSync(path.join(PKG, 'tools', 'switchboard-compose.html'), 'utf8');
  for (const id of ['imgAttach', 'attachBar', 'attachThumb', 'attachRemove']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /mediaRef:media, confirm:true/, 'Publish sends the attached image');
  assert.match(html, /mediaRef:mediaFor\(platform\)/, 'Schedule stores the attached image on the calendar post');
  assert.match(html, /if\(m\) p\.mediaRef=m;/, 'Send to all carries the image');
  assert.doesNotMatch(html, /not yet supported/);
});

test('Streams and Stage hand a post\'s image to the publisher instead of dropping it', async () => {
  const image = png(4000);
  const planned = buildPublishPlan([{ platform: 'x', body: 'With art', mediaRef: image }, { platform: 'linkedin', body: 'Text only' }]);
  assert.equal(planned.error, undefined);
  const seen = [];
  const tag = (mediaRef) => (mediaRef === image ? 'the image' : mediaRef ?? null);
  await runPublishPlan(planned.plan, async (platform, body, mediaRef) => { seen.push([platform, tag(mediaRef)]); return { ok: true }; });
  assert.deepEqual(seen, [['x', 'the image'], ['linkedin', null]]);
  const broadcast = normalizeBroadcast({ posts: [{ platform: 'twitter', text: 'Hi', mediaRef: image }] }, ['x', 'linkedin'], { x: 280 });
  const fanned = [];
  await runFanout(broadcast.posts, async (platform, text, mediaRef) => { fanned.push([platform, tag(mediaRef)]); return { ok: true }; });
  assert.deepEqual(fanned, [['x', 'the image']]);
  const x = fakeX();
  const saved = globalThis.fetch;
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = x.fetch;
  try {
    const r = await publishTo({ pool }, 'alice', 'x', 'Scheduled with art', image);
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(x.calls.at(-1).body).media, { media_ids: ['1880000000000000001'] });
  } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; }
});
