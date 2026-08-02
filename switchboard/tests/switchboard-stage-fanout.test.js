/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the Stage fan-out core: one compose → one submission per channel in plan order; a rejection or thrown error on one channel never blocks the rest; alias folding (twitter→x) makes double-posting one network impossible; validation is fail-closed (unsupported/duplicate/over-limit/empty rejects the WHOLE broadcast).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install) over the
 * COMPILED pure module — the same bytes the running framework requires.
 *
 * Why these are the tests that matter: the fan-out's only job is "N channels, exactly once
 * each, independently". The regressions that hurt are (a) a validator that silently drops a
 * channel so the user believes four networks got the post, (b) one dead connector aborting
 * the loop so later channels never send, and (c) x/twitter counted as two channels.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const fanout = require(path.join(PKG, 'routes', 'switchboard-stage-fanout.js'));
const { MAX_BROADCAST_CHANNELS, canonicalChannel, normalizeBroadcast, runFanout } = fanout;

const PUBLISHABLE = new Set(['x', 'twitter', 'linkedin', 'facebook']);
const LIMITS = { x: 280, twitter: 280, linkedin: 3000, facebook: 63206 };

// ── normalizeBroadcast — fail-closed validation ───────────────────────────────

test('a valid broadcast normalizes in request order with canonical platforms', () => {
  const plan = normalizeBroadcast(
    { posts: [{ platform: 'LinkedIn', text: '  hello  ' }, { platform: 'Twitter', text: 'hi' }] },
    PUBLISHABLE, LIMITS,
  );
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.posts, [{ platform: 'linkedin', text: 'hello' }, { platform: 'x', text: 'hi' }]);
});

test('missing/empty posts reject the broadcast', () => {
  assert.ok(normalizeBroadcast({}, PUBLISHABLE, LIMITS).error);
  assert.ok(normalizeBroadcast({ posts: [] }, PUBLISHABLE, LIMITS).error);
  assert.ok(normalizeBroadcast(null, PUBLISHABLE, LIMITS).error);
});

test('an unsupported platform rejects the WHOLE broadcast — no silent channel drop', () => {
  const plan = normalizeBroadcast(
    { posts: [{ platform: 'linkedin', text: 'ok' }, { platform: 'myspace', text: 'ok' }] },
    PUBLISHABLE, LIMITS,
  );
  assert.match(plan.error, /unsupported platform: myspace/);
  assert.equal(plan.posts.length, 0);
});

test('x and twitter fold onto ONE channel — a broadcast can never double-post a network', () => {
  assert.equal(canonicalChannel('Twitter'), 'x');
  assert.equal(canonicalChannel('x'), 'x');
  const plan = normalizeBroadcast(
    { posts: [{ platform: 'x', text: 'a' }, { platform: 'twitter', text: 'b' }] },
    PUBLISHABLE, LIMITS,
  );
  assert.match(plan.error, /duplicate channel: x/);
});

test('over-limit text and empty text reject the broadcast', () => {
  const long = 'y'.repeat(281);
  assert.match(normalizeBroadcast({ posts: [{ platform: 'x', text: long }] }, PUBLISHABLE, LIMITS).error, /280/);
  assert.match(normalizeBroadcast({ posts: [{ platform: 'x', text: '   ' }] }, PUBLISHABLE, LIMITS).error, /empty text/);
});

test('the channel cap is enforced', () => {
  const posts = Array.from({ length: MAX_BROADCAST_CHANNELS + 1 }, (_, i) => ({ platform: 'x', text: `p${i}` }));
  assert.match(normalizeBroadcast({ posts }, PUBLISHABLE, LIMITS).error, /too many channels/);
});

// ── runFanout — one submission per channel, isolated ──────────────────────────

test('one compose → one submission per channel, in plan order', async () => {
  const calls = [];
  const publish = async (platform, text) => { calls.push([platform, text]); return { ok: true, target: platform }; };
  const { results, summary } = await runFanout(
    [{ platform: 'x', text: 'tweet' }, { platform: 'linkedin', text: 'post' }, { platform: 'facebook', text: 'page' }],
    publish,
  );
  assert.deepEqual(calls, [['x', 'tweet'], ['linkedin', 'post'], ['facebook', 'page']]);
  assert.deepEqual(results.map((r) => r.platform), ['x', 'linkedin', 'facebook']);
  assert.ok(results.every((r) => r.ok === true));
  assert.deepEqual(summary, { total: 3, sent: 3, failed: 0 });
});

test('a THROWN error on one channel never blocks the rest', async () => {
  const calls = [];
  const publish = async (platform) => {
    calls.push(platform);
    if (platform === 'x') throw new Error('twitter API down');
    return { ok: true, target: platform };
  };
  const { results, summary } = await runFanout(
    [{ platform: 'x', text: 'a' }, { platform: 'linkedin', text: 'b' }, { platform: 'facebook', text: 'c' }],
    publish,
  );
  assert.deepEqual(calls, ['x', 'linkedin', 'facebook'], 'later channels must still submit');
  assert.equal(results[0].ok, false);
  assert.match(String(results[0].error), /twitter API down/);
  assert.equal(results[1].ok, true);
  assert.equal(results[2].ok, true);
  assert.deepEqual(summary, { total: 3, sent: 2, failed: 1 });
});

test('a REJECTED publish ({ok:false}) counts failed and the rest still send', async () => {
  const calls = [];
  const publish = async (platform) => {
    calls.push(platform);
    return platform === 'linkedin' ? { ok: false, error: 'no_linkedin_connection' } : { ok: true };
  };
  const { results, summary } = await runFanout(
    [{ platform: 'linkedin', text: 'a' }, { platform: 'x', text: 'b' }],
    publish,
  );
  assert.equal(calls.length, 2);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, 'no_linkedin_connection');
  assert.equal(results[1].ok, true);
  assert.deepEqual(summary, { total: 2, sent: 1, failed: 1 });
});

test('a publisher result without ok:true is never counted as sent', async () => {
  const publish = async () => ({ target: 'x' }); // no ok field at all
  const { results, summary } = await runFanout([{ platform: 'x', text: 'a' }], publish);
  assert.equal(results[0].ok, false);
  assert.deepEqual(summary, { total: 1, sent: 0, failed: 1 });
});
