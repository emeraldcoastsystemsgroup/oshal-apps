/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the Threads aggregation: identity grouping (email-first — two names on one address are ONE person, one name on two addresses is two), chronological ordering (items oldest→newest, threads newest-first), bulk-sender exclusion, social rows as platform mentions, and honest counts under per-thread caps.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install) over the
 * COMPILED pure module — the same bytes the running framework requires.
 *
 * Why these are the tests that matter: a timeline that mis-groups (splitting one person in
 * two, or merging two people into one) or mis-orders (a conversation that reads backwards)
 * is worse than no timeline — it misrepresents who said what, when.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const model = require(path.join(PKG, 'routes', 'switchboard-threads-model.js'));
const { buildThreads, counterpartKey, displayName, emailAddressOf } = model;

/** A store row with sane defaults. */
function row(over) {
  return Object.assign({
    msg_id: `m-${Math.random().toString(36).slice(2, 8)}`,
    from_addr: 'Sam Rivera <sam@acme.com>',
    subject: 'Project sync',
    snippet: 'Quick question about the rollout…',
    category: 'primary',
    received_at: '2026-07-30T12:00:00.000Z',
  }, over || {});
}

// ── identity ──────────────────────────────────────────────────────────────────

test('identity is the email address: two display names on one address are ONE person', () => {
  const threads = buildThreads([
    row({ msg_id: 'a', from_addr: 'Sam Rivera <sam@acme.com>', received_at: '2026-07-29T10:00:00Z' }),
    row({ msg_id: 'b', from_addr: 'sam@acme.com', received_at: '2026-07-30T10:00:00Z' }),
    row({ msg_id: 'c', from_addr: '"Samuel R." <SAM@ACME.COM>', received_at: '2026-07-31T10:00:00Z' }),
  ]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].count, 3);
  assert.equal(threads[0].address, 'sam@acme.com');
  assert.equal(threads[0].person, 'Samuel R.', 'the thread is named from the MOST RECENT row');
});

test('one display name on two addresses stays two counterparts (an address is identity, a name is a label)', () => {
  const threads = buildThreads([
    row({ from_addr: 'Ana <ana@alpha.com>' }),
    row({ from_addr: 'Ana <ana@beta.com>' }),
  ]);
  assert.equal(threads.length, 2);
});

test('a From value without an email falls back to the normalized display name', () => {
  assert.equal(emailAddressOf('Jordan Fleet'), null);
  assert.equal(counterpartKey('Jordan Fleet'), 'name:jordan fleet');
  const threads = buildThreads([
    row({ from_addr: 'Jordan Fleet', category: 'social' }),
    row({ from_addr: 'jordan fleet', category: 'social', received_at: '2026-07-31T09:00:00Z' }),
  ]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].count, 2);
});

test('displayName mirrors the package helper (name from RFC header, address fallback)', () => {
  assert.equal(displayName('"Sam Rivera" <sam@acme.com>'), 'Sam Rivera');
  assert.equal(displayName('sam@acme.com'), 'sam');
});

// ── ordering ──────────────────────────────────────────────────────────────────

test('items inside a thread read oldest→newest; threads list newest-first', () => {
  const threads = buildThreads([
    row({ msg_id: 'old-a', from_addr: 'a@x.com', received_at: '2026-07-28T08:00:00Z' }),
    row({ msg_id: 'new-a', from_addr: 'a@x.com', received_at: '2026-07-31T08:00:00Z' }),
    row({ msg_id: 'mid-a', from_addr: 'a@x.com', received_at: '2026-07-30T08:00:00Z' }),
    row({ msg_id: 'only-b', from_addr: 'b@x.com', received_at: '2026-07-30T20:00:00Z' }),
  ]);
  assert.deepEqual(threads.map((t) => t.address), ['a@x.com', 'b@x.com'], 'most recent counterpart first');
  assert.deepEqual(threads[0].items.map((i) => i.id), ['old-a', 'mid-a', 'new-a'], 'a conversation reads downward');
  assert.equal(threads[0].lastTs, '2026-07-31T08:00:00Z');
});

// ── content rules ─────────────────────────────────────────────────────────────

test('bulk/no-reply senders never form a thread (they are not people)', () => {
  const threads = buildThreads([
    row({ from_addr: 'no-reply@service.com' }),
    row({ from_addr: 'Deals <promo@shop.com>', subject: 'Unsubscribe anytime' }),
    row({ from_addr: 'Real Person <rp@x.com>' }),
  ]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].address, 'rp@x.com');
});

test('social rows become platform mentions; mail rows stay gmail mail', () => {
  const threads = buildThreads([
    row({ msg_id: 's1', from_addr: 'Jordan <jordan@x.com>', category: 'social', received_at: '2026-07-30T09:00:00Z' }),
    row({ msg_id: 'm1', from_addr: 'Jordan <jordan@x.com>', category: 'primary', received_at: '2026-07-30T11:00:00Z' }),
  ]);
  assert.equal(threads.length, 1, 'same address = same person across channels');
  const byId = Object.fromEntries(threads[0].items.map((i) => [i.id, i]));
  assert.equal(byId.s1.kind, 'mention');
  assert.equal(byId.s1.source, 'x');
  assert.equal(byId.m1.kind, 'mail');
  assert.equal(byId.m1.source, 'gmail');
  assert.deepEqual(threads[0].channels.sort(), ['gmail', 'x']);
});

// ── caps ──────────────────────────────────────────────────────────────────────

test('the per-thread cap trims the OLDEST items and count keeps the true total', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row({
    msg_id: `m${i}`, from_addr: 'busy@x.com',
    received_at: `2026-07-${String(20 + i).padStart(2, '0')}T10:00:00Z`,
  }));
  const [t] = buildThreads(rows, { maxItemsPerThread: 3 });
  assert.equal(t.count, 8, 'the board never claims fewer exchanges than happened');
  assert.deepEqual(t.items.map((i) => i.id), ['m5', 'm6', 'm7'], 'most recent kept, still chronological');
});

test('the thread cap keeps the most recent counterparts', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({
    msg_id: `p${i}`, from_addr: `person${i}@x.com`,
    received_at: `2026-07-${String(20 + i).padStart(2, '0')}T10:00:00Z`,
  }));
  const threads = buildThreads(rows, { maxThreads: 2 });
  assert.deepEqual(threads.map((t) => t.address), ['person4@x.com', 'person3@x.com']);
});
