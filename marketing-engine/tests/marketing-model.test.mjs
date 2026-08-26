/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure-model guards for the marketing engine (binding interface spec 2026-08-23): buildUtmUrl tags only absolute http(s) URLs, merges the existing query, and percent-encodes every param (a rejected URL never comes back as a usable string); reallocationProposals never shifts more than 20% of the envelope in a week and never proposes funding a channel below its floor (exit-to-zero is the one legal alternative, spec §9); scorecardRollup marks a metrics source with no events {status:'no_data'} instead of rendering a number; weekStartOf pins ISO weeks to Monday so scorecard_weeks keys are stable.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Reallocation tests rewritten against the SHIPPED signature ({channels:[{channel,spendUsd,conversions,allocationUsd}],maxShiftPct?,floorUsd?}) after review proved the interface-shaped inputs were filtered out and the suite passed vacuously on an empty proposal set. Every case now asserts a NON-EMPTY proposal set where one is due, the donor cap (20% of the donor allocation — strictly inside the spec's 20%-of-envelope bound), conservation, floor semantics, and degenerate refusals.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no
 * install) over the COMPILED pure model — routes/marketing-model.js, the same
 * bytes the running framework requires. No DB, no express, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../routes/marketing-model.js');
const { buildUtmUrl, reallocationProposals, scorecardRollup, weekStartOf } = model;

// ── contract surface ──────────────────────────────────────────────────────────

test('the compiled model exports the pure-logic contract surface', () => {
  assert.equal(typeof buildUtmUrl, 'function', 'buildUtmUrl is exported');
  assert.equal(typeof reallocationProposals, 'function', 'reallocationProposals is exported');
  assert.equal(typeof scorecardRollup, 'function', 'scorecardRollup is exported');
  assert.equal(typeof weekStartOf, 'function', 'weekStartOf is exported');
});

// ── buildUtmUrl — tagging, merge, encoding ────────────────────────────────────

test('buildUtmUrl tags an absolute https URL, merges the existing query, and encodes every param', () => {
  const out = buildUtmUrl({
    url: 'https://oswarm.ai/product/apps/identity/?ref=abc',
    source: 'linkedin',
    medium: 'social',
    campaign: 'launch week & más',
    content: 'v1 draft',
  });
  assert.equal(typeof out, 'string');
  assert.ok(/^https:\/\/oswarm\.ai\//.test(out), 'origin and path survive');
  assert.equal(/\s/.test(out), false, 'no raw whitespace — every value is encoded');
  const u = new URL(out);
  assert.equal(u.searchParams.get('ref'), 'abc', 'the pre-existing query survives the merge');
  assert.equal(u.searchParams.get('utm_source'), 'linkedin');
  assert.equal(u.searchParams.get('utm_medium'), 'social');
  assert.equal(u.searchParams.get('utm_campaign'), 'launch week & más',
    'spaces, & and non-ASCII round-trip — proof they were encoded, not mangled');
  assert.equal(u.searchParams.get('utm_content'), 'v1 draft');
});

test('buildUtmUrl leaves utm_content off when content is not given', () => {
  const out = buildUtmUrl({ url: 'https://oswarm.ai/lab/', source: 'gsc', medium: 'organic', campaign: 'evergreen' });
  const u = new URL(out);
  assert.equal(u.searchParams.get('utm_campaign'), 'evergreen');
  assert.equal(u.searchParams.has('utm_content'), false, 'no phantom utm_content param');
});

test('buildUtmUrl accepts plain http (local surfaces are http)', () => {
  const out = buildUtmUrl({ url: 'http://localhost:35457/cockpit/', source: 'email', medium: 'email', campaign: 'weekly' });
  assert.equal(new URL(out).searchParams.get('utm_source'), 'email');
});

/**
 * A rejected URL must never come back as a usable string: the model may throw,
 * or return null/undefined/'' or an error-shaped object — but any non-empty
 * string return (even the original untouched URL) fails this guard.
 */
function rejectsUrl(url) {
  let out;
  try {
    out = buildUtmUrl({ url, source: 'linkedin', medium: 'social', campaign: 'x' });
  } catch {
    return true;
  }
  return !(typeof out === 'string' && out.length > 0);
}

test('buildUtmUrl rejects everything that is not an absolute http(s) URL', () => {
  const bad = [
    'ftp://example.com/file',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    '//evil.example.com/path',
    '/relative/path',
    'oswarm.ai/no-scheme',
    'not a url at all',
    '',
  ];
  for (const url of bad) {
    assert.equal(rejectsUrl(url), true, `${JSON.stringify(url)} must never come back UTM-tagged`);
  }
});

// ── reallocationProposals — donor-capped shifts + floors (≤ the spec's 20%-of-envelope bound) ─

/**
 * Exact-shape helper for the shipped reallocationProposals contract:
 * input  { channels: [{ channel, spendUsd, conversions, allocationUsd }], maxShiftPct?, floorUsd? }
 * output [{ channel, field: 'channel_allocation', oldValue, newValue, trailingCpaUsd, rationale }]
 */
function perf(channel, spendUsd, conversions, allocationUsd) {
  return { channel, spendUsd, conversions, allocationUsd };
}

const EPS = 1e-6;

test('reallocationProposals moves real money and never more than 20% of the donor allocation', () => {
  const channels = [perf('linkedin', 400, 1, 400), perf('email', 400, 40, 400)];
  const rows = reallocationProposals({ channels, floorUsd: 100 });
  assert.equal(rows.length, 2, 'a clear CPA spread MUST yield a donor and a recipient — an empty result would let this suite pass vacuously');
  const donor = rows.find((r) => r.channel === 'linkedin');
  const recipient = rows.find((r) => r.channel === 'email');
  assert.ok(donor && recipient, 'worst CPA donates, best CPA receives');
  const shifted = donor.oldValue - donor.newValue;
  assert.ok(shifted > EPS, 'the donor actually gives something up');
  assert.ok(shifted <= 0.2 * donor.oldValue + EPS, `moved $${shifted} — over 20% of the donor allocation`);
  assert.ok(shifted <= 0.2 * (400 + 400) + EPS, 'the donor-allocation cap sits inside the 20%-of-envelope bound (spec §9)');
  assert.ok(Math.abs((recipient.newValue - recipient.oldValue) - shifted) <= EPS, 'money in equals money out — proposals cannot mint budget');
  assert.equal(donor.field, 'channel_allocation');
  assert.ok(donor.newValue >= 0 && recipient.newValue >= 0, 'a proposed allocation is never negative');
});

test('reallocationProposals clamps a garbage shift percentage back to the 20% default', () => {
  const channels = [perf('linkedin', 400, 1, 400), perf('email', 400, 40, 400)];
  const wild = reallocationProposals({ channels, floorUsd: 100, maxShiftPct: 500 });
  assert.equal(wild.length, 2, 'the clamped run still proposes');
  const donor = wild.find((r) => r.channel === 'linkedin');
  assert.ok(donor.oldValue - donor.newValue <= 0.2 * donor.oldValue + EPS, 'maxShiftPct=500 must clamp to the 20% default, not move half the budget');
});

test('reallocationProposals respects the floor — shave down to it, never below, refuse at it', () => {
  const atFloorAfter = reallocationProposals({ channels: [perf('reddit', 360, 1, 120), perf('email', 680, 68, 680)], floorUsd: 100 });
  assert.equal(atFloorAfter.length, 2, 'a donor above its floor still donates');
  const donor = atFloorAfter.find((r) => r.channel === 'reddit');
  assert.ok(donor.newValue >= 100 - EPS, `donor landed at $${donor.newValue} — below the $100 floor`);
  assert.ok(donor.oldValue - donor.newValue <= 20 + EPS, 'the floor bound, not the 20% bound, was the binding constraint here');

  const alreadyAtFloor = reallocationProposals({ channels: [perf('reddit', 360, 1, 100), perf('email', 700, 70, 700)], floorUsd: 100 });
  assert.deepEqual(alreadyAtFloor, [], 'a donor sitting on its floor proposes nothing — never a below-floor shave');
});

test('reallocationProposals refuses degenerate inputs instead of guessing', () => {
  assert.deepEqual(reallocationProposals({ channels: [perf('email', 100, 10, 400)] }), [], 'one channel has nowhere to shift');
  assert.deepEqual(reallocationProposals({ channels: [] }), []);
  assert.deepEqual(reallocationProposals({ channels: [{ channel: 'x', budget: 1, floor: 1, spend: 1 }] }), [], 'malformed rows are filtered out, not coerced');
});

// ── scorecardRollup — honest no_data marking ──────────────────────────────────

const WEEK = '2026-08-17'; // a Monday

test('scorecardRollup marks a source with events ok and every missing source no_data', () => {
  const events = [
    { ts: '2026-08-18T10:00:00Z', source: 'gsc', event: 'clicks', medium: 'organic', value: 5, campaign_slug: null, meta: { date: '2026-08-18' } },
    { ts: '2026-08-19T10:00:00Z', source: 'gsc', event: 'impressions', medium: 'organic', value: 120, campaign_slug: null, meta: { date: '2026-08-19' } },
  ];
  const out = scorecardRollup(events, WEEK);
  assert.ok(out && typeof out === 'object');
  assert.ok(out.data && typeof out.data === 'object', 'rollup carries data');
  assert.ok(out.sources && typeof out.sources === 'object', 'rollup carries per-source status');
  assert.equal(out.sources.gsc.status, 'ok', 'a source that reported events is ok');
  assert.equal(out.sources.posthog.status, 'no_data', 'a silent source is no_data, never a number');
  assert.equal(out.sources.github.status, 'no_data', 'a silent source is no_data, never a number');
});

test('scorecardRollup over no events marks every source no_data', () => {
  const out = scorecardRollup([], WEEK);
  for (const name of ['gsc', 'posthog', 'github']) {
    assert.ok(out.sources[name], `the ${name} source is always reported`);
    assert.equal(out.sources[name].status, 'no_data', `${name} with no events is no_data`);
  }
});

// ── weekStartOf — ISO weeks start on Monday ───────────────────────────────────

/** Normalize a Date-or-string week start to its ISO date string. */
function isoDay(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

test('weekStartOf pins any day of the week to its ISO Monday', () => {
  assert.equal(isoDay(weekStartOf('2026-08-19')), '2026-08-17', 'Wednesday maps to its Monday');
  assert.equal(isoDay(weekStartOf('2026-08-23')), '2026-08-17', 'Sunday belongs to the week that STARTED the prior Monday');
  assert.equal(isoDay(weekStartOf('2026-08-17')), '2026-08-17', 'Monday is its own week start');
});
