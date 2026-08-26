/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Consent + spend gates for the marketing model (binding interface spec 2026-08-23): a channel authorization row that is absent or carries anything but strict true/'t'/'true' is OFF for BOTH enabled and standing_authorization; publishDecision cap semantics (cap 0 = never, count at/over cap = skipped_cap, paused_reason set = denied, reason always populated); sanitizeCampaignImport strips enabled/standing_authorization/daily_cap/budget_monthly_usd/stage/target_cpa_usd so a campaign import can NEVER arm consent or spend (the series-pump import rule).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Align the standing_authorization tests with the ADR-131 gate split: publishDecision is the MANUAL gate (human-confirmed) and deliberately ignores standing_authorization; the strict reader explicitTrue is where garbage must never read as a standing opt-in. Added the ignores-standing-by-design assertion so the semantic is pinned both ways.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no
 * install) over the COMPILED pure model — routes/marketing-model.js, the same
 * bytes the running framework requires. No DB, no express, no network.
 *
 * Why these are the tests that matter: this app's only dangerous powers are
 * posting under someone's name and moving their budget. Every gate here is a
 * refusal — if any of them fails open, an import or a garbage row arms spend
 * that no human ever authorized.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../routes/marketing-model.js');
const { isChannelEnabled, publishDecision, sanitizeCampaignImport, explicitTrue } = model;

/** Values that must NEVER opt a consent flag in — only strict true/'t'/'true' does. */
const GARBAGE = [1, 0, -1, 'TRUE', 'True', ' true', 'true ', 'yes', 'on', 'enabled', 'y', '1', 'f', 'false', '', null, undefined, {}, [], NaN];

/** The only values that opt a consent flag in. */
const STRICT_ON = [true, 't', 'true'];

/** A fully-armed channel authorization row, overridable per case. */
function armedRow(overrides = {}) {
  return {
    channel: 'linkedin',
    enabled: true,
    standing_authorization: true,
    daily_cap: 5,
    paused_reason: null,
    ...overrides,
  };
}

// ── contract surface ──────────────────────────────────────────────────────────

test('the compiled model exports the consent-gate contract surface', () => {
  assert.equal(typeof isChannelEnabled, 'function', 'isChannelEnabled is exported');
  assert.equal(typeof publishDecision, 'function', 'publishDecision is exported');
  assert.equal(typeof sanitizeCampaignImport, 'function', 'sanitizeCampaignImport is exported');
});

// ── isChannelEnabled — absent row = OFF, garbage = OFF, strict opt-in only ────

test('an absent channel authorization row is OFF', () => {
  assert.equal(isChannelEnabled(null), false, 'null row is OFF');
  assert.equal(isChannelEnabled(undefined), false, 'undefined row is OFF');
});

test('a garbage enabled value is OFF — only strict true/\'t\'/\'true\' opts in', () => {
  for (const v of GARBAGE) {
    assert.equal(isChannelEnabled(armedRow({ enabled: v })), false,
      `enabled=${JSON.stringify(v)} must read as OFF`);
  }
  for (const v of STRICT_ON) {
    assert.equal(isChannelEnabled(armedRow({ enabled: v })), true,
      `enabled=${JSON.stringify(v)} is the strict opt-in and must read as ON`);
  }
});

// ── publishDecision — absent/garbage rows never allow ─────────────────────────

test('publishDecision denies when the authorization row is absent', () => {
  for (const row of [null, undefined]) {
    const d = publishDecision(row, 0);
    assert.equal(d.allowed, false, 'no row means no publish');
    assert.equal(typeof d.reason, 'string');
    assert.ok(d.reason.length > 0, 'the denial carries a reason');
  }
});

test('publishDecision denies on every garbage enabled value', () => {
  for (const v of GARBAGE) {
    const d = publishDecision(armedRow({ enabled: v }), 0);
    assert.equal(d.allowed, false, `enabled=${JSON.stringify(v)} must deny`);
  }
});

test('garbage standing_authorization values never read as a standing opt-in', () => {
  // publishDecision is the MANUAL gate (a human explicitly confirmed this publish), so
  // standing_authorization is deliberately not consulted there — it authorizes future
  // AUTONOMOUS posting only. The guard that matters: no garbage value may ever read as
  // standing opt-in through the strict reader every consumer must use (ADR-131).
  for (const v of GARBAGE) {
    assert.equal(explicitTrue(v), false, `standing_authorization=${JSON.stringify(v)} must not read as opted-in`);
  }
});

test('manual publishDecision ignores standing_authorization by design', () => {
  for (const v of [...GARBAGE, ...STRICT_ON]) {
    const d = publishDecision(armedRow({ standing_authorization: v }), 0);
    assert.equal(d.allowed, true, 'an enabled, unpaused, under-cap channel publishes manually regardless of standing_authorization');
  }
});

test('strict standing_authorization opt-in values read as opted-in', () => {
  for (const v of STRICT_ON) {
    assert.equal(explicitTrue(v), true, `standing_authorization=${JSON.stringify(v)} must read as opted-in`);
  }
});

// ── publishDecision — cap semantics ───────────────────────────────────────────

test('a daily cap of 0 means never — even the first publish of the day is skipped_cap', () => {
  const d = publishDecision(armedRow({ daily_cap: 0 }), 0);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'skipped_cap');
});

test('a count at the cap is skipped_cap — the cap is a ceiling, not a target', () => {
  const d = publishDecision(armedRow({ daily_cap: 5 }), 5);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'skipped_cap');
});

test('a count over the cap is skipped_cap', () => {
  const d = publishDecision(armedRow({ daily_cap: 5 }), 6);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'skipped_cap');
});

test('a count under the cap allows', () => {
  assert.equal(publishDecision(armedRow({ daily_cap: 5 }), 4).allowed, true);
  assert.equal(publishDecision(armedRow({ daily_cap: 1 }), 0).allowed, true);
});

// ── publishDecision — paused channel + reason hygiene ─────────────────────────

test('a set paused_reason denies regardless of consent and cap headroom', () => {
  const d = publishDecision(armedRow({ paused_reason: 'operator paused after CPA guard fired' }), 0);
  assert.equal(d.allowed, false);
  assert.equal(typeof d.reason, 'string');
  assert.ok(d.reason.length > 0);
});

test('the reason is always populated — allow and deny alike (the series-pump mirror)', () => {
  const cases = [
    publishDecision(armedRow(), 0),
    publishDecision(armedRow({ daily_cap: 0 }), 0),
    publishDecision(armedRow({ enabled: false }), 0),
    publishDecision(null, 0),
  ];
  for (const d of cases) {
    assert.equal(typeof d.reason, 'string', 'reason is a string');
    assert.ok(d.reason.length > 0, 'reason is never empty');
  }
});

// ── sanitizeCampaignImport — import NEVER arms spend ──────────────────────────

/** The fields an import must never carry through (consent, spend, and stage). */
const FORBIDDEN = ['enabled', 'standing_authorization', 'daily_cap', 'budget_monthly_usd', 'stage', 'target_cpa_usd'];

/** camelCase twins of the forbidden fields — a whitelist strips these too. */
const FORBIDDEN_CAMEL = ['standingAuthorization', 'dailyCap', 'budgetMonthlyUsd', 'targetCpaUsd'];

test('sanitizeCampaignImport strips every consent/spend/stage field (the import-never-arms-spend guard)', () => {
  const dirty = {
    name: 'oshal launch wave',
    product: 'oshal',
    motion: 'adoption',
    channels: ['linkedin', 'email'],
    icp: { segment: 'dev-tools founders', size: '1-50' },
    message_map: { pain: 'agent sprawl', promise: 'one accountable swarm' },
    enabled: true,
    standing_authorization: true,
    daily_cap: 50,
    budget_monthly_usd: 5000,
    stage: 3,
    target_cpa_usd: 1,
    standingAuthorization: true,
    dailyCap: 50,
    budgetMonthlyUsd: 5000,
    targetCpaUsd: 1,
    evil_extra: 'not a campaign field',
  };
  const clean = sanitizeCampaignImport(dirty);
  assert.ok(clean && typeof clean === 'object', 'sanitize returns an object');
  for (const k of [...FORBIDDEN, ...FORBIDDEN_CAMEL]) {
    assert.equal(Object.prototype.hasOwnProperty.call(clean, k), false,
      `imported campaign must not carry ${k}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(clean, 'evil_extra'), false,
    'unknown keys do not pass — sanitize is a whitelist, not a blacklist');
});

test('sanitizeCampaignImport keeps the content fields a campaign import is FOR', () => {
  const clean = sanitizeCampaignImport({
    name: 'oshal launch wave',
    product: 'oshal',
    motion: 'adoption',
    channels: ['linkedin', 'email'],
    icp: { segment: 'dev-tools founders' },
    message_map: { pain: 'agent sprawl' },
    daily_cap: 50,
  });
  assert.equal(clean.name, 'oshal launch wave');
  assert.equal(clean.product, 'oshal');
  assert.equal(clean.motion, 'adoption');
  assert.deepEqual(clean.channels, ['linkedin', 'email']);
  assert.deepEqual(clean.icp, { segment: 'dev-tools founders' });
  const messageMap = clean.message_map ?? clean.messageMap;
  assert.deepEqual(messageMap, { pain: 'agent sprawl' }, 'the message map survives the import');
});
