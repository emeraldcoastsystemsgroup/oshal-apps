/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-09 12:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the Streams editorial model (contract v1 2026-08-09): the FULL legal transition matrix and a representative illegal set (approve-from-draft class, archived-is-terminal, schedule/publish are NOT transition actions), edit gating, x/twitter alias folding, fail-closed create/patch/schedule validation (an unknown platform rejects the WHOLE payload — no silent drop), fail-closed publish planning (over-limit or empty publishable body → error and NOTHING runnable; instagram/threads honestly skipped 'no_binding', never fake-published), exactly-once independent channel execution, and honest publish summaries (skipped never counts as ok).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install) over the
 * COMPILED pure module — the same bytes the running framework requires.
 *
 * Why these are the tests that matter: an editorial pipeline that lets a draft skip review,
 * silently drops one requested network, half-runs a publish after a validation failure, or
 * reports a skipped channel as posted misrepresents what went out under the user's name.
 * Every rejection here is fail-closed and every success is exactly-once.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const model = require(path.join(PKG, 'routes', 'switchboard-streams-model.js'));
const {
  STATES, TRANSITIONS, VARIANT_PLATFORMS, PUBLISHABLE_PLATFORMS, LIMITS,
  MAX_TITLE, MAX_BODY, MAX_TAGS,
  canonicalPlatform, applyTransition, canEdit,
  validateNewPost, validatePatch, validateScheduleAt,
  buildPublishPlan, runPublishPlan, summarizePublish,
} = model;

const ALL_STATES = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected', 'failed', 'archived'];
const ALL_ACTIONS = ['submit', 'approve', 'request_changes', 'reject', 'reopen', 'unschedule', 'retry', 'archive'];

/** Array-or-Set export → plain array (the contract fixes members, not the container). */
function toArr(v) { return Array.isArray(v) ? v.slice() : Array.from(v); }

// ── contract constants ────────────────────────────────────────────────────────

test('the compiled module pins the contract constants', () => {
  assert.deepEqual(toArr(STATES).sort(), ALL_STATES.slice().sort());
  assert.ok(TRANSITIONS, 'the transition matrix is exported');
  assert.deepEqual(toArr(VARIANT_PLATFORMS).sort(), ['facebook', 'instagram', 'linkedin', 'threads', 'x']);
  assert.deepEqual(toArr(PUBLISHABLE_PLATFORMS).sort(), ['facebook', 'linkedin', 'x']);
  assert.equal(LIMITS.x, 280);
  assert.equal(LIMITS.linkedin, 3000);
  assert.equal(LIMITS.facebook, 63206);
  assert.equal(LIMITS.instagram, 2200);
  assert.equal(LIMITS.threads, 500);
  assert.equal(MAX_TITLE, 140);
  assert.equal(MAX_BODY, 20000);
  assert.equal(MAX_TAGS, 12);
});

// ── applyTransition — the editorial state machine ─────────────────────────────

test('every LEGAL transition in the contract matrix yields exactly the contracted next state', () => {
  const LEGAL = [
    ['draft', 'submit', 'in_review'],
    ['in_review', 'approve', 'approved'],
    ['in_review', 'request_changes', 'draft'],
    ['in_review', 'reject', 'rejected'],
    ['approved', 'reopen', 'draft'],
    ['rejected', 'reopen', 'draft'],
    ['failed', 'reopen', 'draft'],
    ['scheduled', 'unschedule', 'approved'],
    ['failed', 'retry', 'approved'],
    ['draft', 'archive', 'archived'],
    ['published', 'archive', 'archived'],
    ['rejected', 'archive', 'archived'],
    ['failed', 'archive', 'archived'],
  ];
  for (const [state, action, next] of LEGAL) {
    const r = applyTransition(state, action);
    assert.equal(r.error, undefined, `${action} from ${state} must be legal`);
    assert.equal(r.next, next, `${action} from ${state} must land on ${next}`);
  }
});

test('illegal transitions return {error} and NEVER a next state', () => {
  const ILLEGAL = [
    ['approved', 'submit'],          // can't re-submit an approved post
    ['draft', 'approve'],            // approval only out of review — no self-approve shortcut
    ['published', 'retry'],          // retry is for failed publishes only
    ['in_review', 'archive'],        // archive never bypasses an open review
    ['scheduled', 'archive'],        // a scheduled post must be unscheduled first
    ['draft', 'request_changes'],
    ['approved', 'reject'],
    ['draft', 'unschedule'],
  ];
  for (const action of ALL_ACTIONS) ILLEGAL.push(['archived', action]); // archived is terminal
  ILLEGAL.push(['approved', 'schedule'], ['approved', 'publish']);      // own endpoints, NOT transition actions
  ILLEGAL.push(['draft', 'launch'], ['draft', ''], ['limbo', 'submit']); // unknown action / unknown state
  for (const [state, action] of ILLEGAL) {
    const r = applyTransition(state, action);
    assert.ok(r.error, `${action || '(empty)'} from ${state} must be rejected`);
    assert.equal(r.next, undefined, `${action || '(empty)'} from ${state} must never yield a next state`);
  }
});

// ── canEdit — PATCH is a drafting-time privilege ──────────────────────────────

test('canEdit is true for exactly draft and in_review — every other state must reopen first', () => {
  for (const state of ALL_STATES) {
    const expected = state === 'draft' || state === 'in_review';
    assert.equal(canEdit(state), expected, `canEdit(${state})`);
  }
});

// ── canonicalPlatform ─────────────────────────────────────────────────────────

test('canonicalPlatform folds every Twitter spelling onto x and case-folds the rest', () => {
  assert.equal(canonicalPlatform('Twitter'), 'x');
  assert.equal(canonicalPlatform('twitter'), 'x');
  assert.equal(canonicalPlatform('X'), 'x');
  assert.equal(canonicalPlatform('x'), 'x');
  assert.equal(canonicalPlatform('LinkedIn'), 'linkedin');
  assert.equal(canonicalPlatform('FACEBOOK'), 'facebook');
  assert.equal(canonicalPlatform('Instagram'), 'instagram');
  assert.equal(canonicalPlatform('Threads'), 'threads');
});

// ── validateNewPost — fail-closed create ──────────────────────────────────────

test('a valid new post normalizes title/body/platforms/tags and keeps the workspace', () => {
  const r = validateNewPost({
    title: 'Launch note',
    body: 'Hello from the Streams pane',
    platforms: ['X', 'LinkedIn', 'facebook'],
    tags: ['launch', 'ai'],
    workspaceId: '11111111-2222-3333-4444-555555555555',
  });
  assert.equal(r.error, undefined);
  assert.equal(r.title, 'Launch note');
  assert.equal(r.body, 'Hello from the Streams pane');
  assert.deepEqual(r.platforms, ['x', 'linkedin', 'facebook']);
  assert.deepEqual(r.tags, ['launch', 'ai']);
  assert.equal(r.workspaceId, '11111111-2222-3333-4444-555555555555');
  // body alone is a legal minimal create (title/platforms/tags/workspace are optional)
  assert.equal(validateNewPost({ body: 'just a body' }).error, undefined);
});

test('body is required — a post with nothing to say is rejected', () => {
  assert.ok(validateNewPost({}).error);
  assert.ok(validateNewPost({ title: 'title only' }).error);
  assert.ok(validateNewPost({ body: '' }).error);
});

test('a title over MAX_TITLE is rejected; exactly MAX_TITLE passes', () => {
  assert.ok(validateNewPost({ title: 't'.repeat(141), body: 'ok' }).error, '141 chars must reject');
  assert.equal(validateNewPost({ title: 't'.repeat(140), body: 'ok' }).error, undefined, '140 chars is the max, not over it');
});

test('a master body over MAX_BODY is rejected; exactly MAX_BODY passes', () => {
  assert.ok(validateNewPost({ body: 'b'.repeat(20001) }).error, '20001 chars must reject');
  assert.equal(validateNewPost({ body: 'b'.repeat(20000) }).error, undefined, '20000 chars is the max, not over it');
});

test('more than MAX_TAGS tags, or any tag over 40 chars, rejects the post', () => {
  const thirteen = Array.from({ length: 13 }, (_, i) => `tag${i}`);
  assert.ok(validateNewPost({ body: 'ok', tags: thirteen }).error, '13 tags must reject');
  assert.ok(validateNewPost({ body: 'ok', tags: ['fine', 'g'.repeat(41)] }).error, 'a 41-char tag must reject');
  const twelveAtMax = Array.from({ length: 12 }, (_, i) => `t${i}`.padEnd(40, 'x'));
  assert.equal(validateNewPost({ body: 'ok', tags: twelveAtMax }).error, undefined, '12 tags of 40 chars are within bounds');
});

test('duplicate/alias platforms fold to ONE channel — x and twitter can never double-post', () => {
  const r = validateNewPost({ body: 'ok', platforms: ['x', 'twitter'] });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.platforms, ['x']);
  const r2 = validateNewPost({ body: 'ok', platforms: ['Twitter', 'X', 'linkedin'] });
  assert.equal(r2.error, undefined);
  assert.deepEqual(r2.platforms, ['x', 'linkedin']);
});

test('an unknown platform rejects the WHOLE payload — no silent channel drop', () => {
  const r = validateNewPost({ body: 'ok', platforms: ['x', 'myspace'] });
  assert.ok(r.error, 'myspace must reject the payload');
  assert.equal(r.platforms, undefined, 'a rejected payload never carries a partial platform list');
});

// ── validatePatch — fail-closed edit ──────────────────────────────────────────

test('patch variants are canonicalized and deduped (Twitter/X spellings fold to one x row)', () => {
  const r = validatePatch({
    variants: [
      { platform: 'Twitter', body: 'tweet copy' },
      { platform: 'X', body: 'tweet copy again' },
      { platform: 'LinkedIn', body: 'longer professional copy' },
    ],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.variants.length, 2, 'x/twitter is ONE channel after folding');
  assert.deepEqual(r.variants.map((v) => v.platform).sort(), ['linkedin', 'x']);
});

test('an unknown variant platform rejects the whole patch', () => {
  const r = validatePatch({ variants: [{ platform: 'myspace', body: 'x' }, { platform: 'x', body: 'ok' }] });
  assert.ok(r.error);
  assert.equal(r.variants, undefined, 'a rejected patch never carries a partial variant list');
});

test('an empty patch is an error — a PATCH must change something', () => {
  assert.ok(validatePatch({}).error);
  // a patch with any recognized field is NOT empty
  assert.equal(validatePatch({ title: 'New title' }).error, undefined);
});

// ── validateScheduleAt ────────────────────────────────────────────────────────

const NOW_MS = Date.parse('2026-08-09T12:00:00.000Z');

test('a valid future ISO timestamp schedules (returned iso preserves the instant)', () => {
  const r = validateScheduleAt('2026-08-10T09:30:00.000Z', NOW_MS);
  assert.equal(r.error, undefined);
  assert.equal(typeof r.iso, 'string');
  assert.equal(Date.parse(r.iso), Date.parse('2026-08-10T09:30:00.000Z'));
});

test('a past timestamp and unparseable garbage are both rejected', () => {
  assert.ok(validateScheduleAt('2026-08-09T11:59:00.000Z', NOW_MS).error, 'one minute ago is not the future');
  assert.ok(validateScheduleAt('2020-01-01T00:00:00.000Z', NOW_MS).error, 'the deep past is not the future');
  assert.ok(validateScheduleAt('next tuesday', NOW_MS).error);
  assert.ok(validateScheduleAt('', NOW_MS).error);
  assert.ok(validateScheduleAt('banana', NOW_MS).error);
});

// ── buildPublishPlan — fail-closed pre-send validation ────────────────────────

test('one publishable variant over its LIMIT fails the WHOLE plan — nothing runnable', () => {
  const r = buildPublishPlan([
    { platform: 'x', body: 'a'.repeat(281) },       // one over x's 280
    { platform: 'linkedin', body: 'perfectly fine' }, // valid — must NOT run anyway
  ]);
  assert.ok(r.error, 'an over-limit publishable variant must fail the plan');
  assert.ok(!r.plan || r.plan.length === 0, 'a failed plan must leave NOTHING runnable');
});

test('an empty publishable variant body fails the WHOLE plan — nothing runnable', () => {
  const r = buildPublishPlan([
    { platform: 'linkedin', body: '' },
    { platform: 'x', body: 'fine' },
  ]);
  assert.ok(r.error, 'an empty publishable body must fail the plan');
  assert.ok(!r.plan || r.plan.length === 0, 'a failed plan must leave NOTHING runnable');
});

test('instagram/threads variants land in skipped with reason no_binding and NEVER in the plan', () => {
  const r = buildPublishPlan([
    { platform: 'x', body: 'hello' },
    { platform: 'instagram', body: 'photo caption' },
    { platform: 'threads', body: 'threads note' },
  ]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.plan.map((p) => p.platform), ['x'], 'only the bound channel is runnable');
  assert.deepEqual(r.skipped.map((s) => s.platform).sort(), ['instagram', 'threads']);
  assert.ok(r.skipped.every((s) => s.reason === 'no_binding'), 'the skip is honest: no_binding, not a fake success');
});

test('a valid mixed set plans exactly x/linkedin/facebook with their variant bodies', () => {
  const xBody = 'x'.repeat(280); // exactly at the limit — "over its LIMIT" means over, not at
  const r = buildPublishPlan([
    { platform: 'x', body: xBody },
    { platform: 'linkedin', body: 'professional copy' },
    { platform: 'facebook', body: 'page copy' },
    { platform: 'instagram', body: 'caption' },
    { platform: 'threads', body: 'note' },
  ]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.plan.map((p) => p.platform).sort(), ['facebook', 'linkedin', 'x']);
  assert.equal(r.plan.find((p) => p.platform === 'x').body, xBody, 'the plan carries the exact approved variant body');
  assert.deepEqual(r.skipped.map((s) => s.platform).sort(), ['instagram', 'threads']);
});

// ── runPublishPlan — exactly once per channel, independent failures ───────────

/**
 * The contract fixes runPublishPlan(plan, publishFn) but not publishFn's exact
 * argument shape — accept (platform, body, …) or ({platform, body}).
 */
function platformOfCall(args) {
  const a = args[0];
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') return a.platform;
  return undefined;
}

test('one plan → exactly one publishFn call per entry, in plan order', async () => {
  const calls = [];
  const publishFn = async (...args) => { calls.push(args); return { ok: true }; };
  const results = await runPublishPlan(
    [{ platform: 'x', body: 'tweet' }, { platform: 'linkedin', body: 'post' }, { platform: 'facebook', body: 'page' }],
    publishFn,
  );
  assert.equal(calls.length, 3, 'exactly once per channel');
  assert.deepEqual(calls.map(platformOfCall), ['x', 'linkedin', 'facebook'], 'in plan order');
  assert.deepEqual(results.map((r) => r.platform), ['x', 'linkedin', 'facebook']);
  assert.ok(results.every((r) => r.ok === true));
});

test('a THROWN error on one channel never blocks the later channels', async () => {
  const calls = [];
  const publishFn = async (...args) => {
    const platform = platformOfCall(args);
    calls.push(platform);
    if (platform === 'linkedin') throw new Error('linkedin API down');
    return { ok: true };
  };
  const results = await runPublishPlan(
    [{ platform: 'x', body: 'a' }, { platform: 'linkedin', body: 'b' }, { platform: 'facebook', body: 'c' }],
    publishFn,
  );
  assert.deepEqual(calls, ['x', 'linkedin', 'facebook'], 'the channel AFTER the failure must still submit');
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(String(results[1].error), /linkedin API down/, 'the per-channel outcome carries the failure');
  assert.equal(results[2].ok, true);
});

test('a channel returning {ok:false} counts failed and the rest still send', async () => {
  const calls = [];
  const publishFn = async (...args) => {
    const platform = platformOfCall(args);
    calls.push(platform);
    return platform === 'facebook' ? { ok: false, error: 'no_facebook_connection' } : { ok: true };
  };
  const results = await runPublishPlan(
    [{ platform: 'facebook', body: 'a' }, { platform: 'x', body: 'b' }],
    publishFn,
  );
  assert.equal(calls.length, 2, 'a rejected channel never blocks the rest');
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, 'no_facebook_connection');
  assert.equal(results[1].ok, true);
});

// ── summarizePublish — honest outcomes ────────────────────────────────────────

test('all channels ok → state published, allOk true, no error', () => {
  const s = summarizePublish([{ platform: 'x', ok: true }, { platform: 'linkedin', ok: true }], []);
  assert.equal(s.anyOk, true);
  assert.equal(s.allOk, true);
  assert.equal(s.state, 'published');
  assert.ok(!s.error);
});

test('a partial success is published with anyOk true and allOk false', () => {
  const s = summarizePublish(
    [{ platform: 'x', ok: true }, { platform: 'linkedin', ok: false, error: 'boom' }],
    [],
  );
  assert.equal(s.anyOk, true);
  assert.equal(s.allOk, false);
  assert.equal(s.state, 'published', 'one real send means the post IS out');
});

test('all channels failed → state failed with an error', () => {
  const s = summarizePublish(
    [{ platform: 'x', ok: false, error: 'down' }, { platform: 'linkedin', ok: false, error: 'down' }],
    [],
  );
  assert.equal(s.anyOk, false);
  assert.equal(s.allOk, false);
  assert.equal(s.state, 'failed');
  assert.ok(s.error, 'an all-fail summary must say why');
});

test('skipped-only never counts as ok — no_binding is not a publish', () => {
  const s = summarizePublish([], [{ platform: 'instagram', reason: 'no_binding' }, { platform: 'threads', reason: 'no_binding' }]);
  assert.equal(s.anyOk, false, 'a skipped channel posted nothing');
  assert.notEqual(s.state, 'published', 'a post that reached no network is never published');
});
