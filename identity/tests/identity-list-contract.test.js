/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-12 20:40:00 | maintainer@emeraldcoastsystemsgroup.com   | Initial BUG-13 guard, consuming half: every per-connection key the Identity Hub surface reads off /api/connect/list is in the response contract core promises, and the access-review inventory derives `expired` from core's shared isConnectionExpired rather than re-deriving `expiry < now`.
 *
 * The producing half lives in core (tests/unit/connector-list-expiry.spec.ts), which asserts the
 * response carries exactly these keys. Neither repo can import the other's tests, so the contract
 * is written down in both places and CONNECTION_KEYS below must be kept identical to core's list.
 *
 * Why this guard exists: the surface read `c.expired` in four places and the response never
 * carried the key. Reading a missing key is not an error in JavaScript — it is `undefined`, which
 * is falsy — so "Need attention" rendered a confident 0, the red Reconnect pill never appeared,
 * and the one screen built to show a stale login showed nothing. A missing key must fail here.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SURFACE = path.resolve(__dirname, '..', 'tools', 'identity.html');
const ROUTES_TS = path.resolve(__dirname, '..', 'src-routes', 'identity-routes.ts');
const ROUTES_JS = path.resolve(__dirname, '..', 'routes', 'identity-routes.js');

/** The per-connection keys /api/connect/list promises. Mirror of core's CONNECTION_KEYS. */
const CONNECTION_KEYS = ['connectionId', 'label', 'account', 'tenantId', 'isDefault', 'expired'];

const html = fs.readFileSync(SURFACE, 'utf8');

test('the surface reads only per-connection keys the list response promises', () => {
  // The surface names its connection objects `c` inside `(p.connections || []).some((c) => …)`
  // and the account-row map. Collect every property read off one and hold it to the contract.
  const reads = new Set();
  for (const m of html.matchAll(/\bc\.([A-Za-z_$][\w$]*)/g)) reads.add(m[1]);
  assert.ok(reads.size > 0, 'found no c.<key> reads — the scrape broke, not the surface');

  const unknown = [...reads].filter((k) => !CONNECTION_KEYS.includes(k));
  assert.deepEqual(
    unknown, [],
    `the surface reads ${unknown.join(', ')} off a connection, which /api/connect/list does not `
    + 'promise. Either add it to the response contract (both repos) or stop reading it — an '
    + 'unpromised key renders as undefined and silently reads as "nothing to report".',
  );
});

test('the surface actually consumes the expired flag — the signal this package exists for', () => {
  const uses = [...html.matchAll(/\bc\.expired\b/g)].length;
  assert.ok(uses >= 4, `expected the Need-attention tile, the filter, the Reconnect pill and the `
    + `account marker to read c.expired; found ${uses} reads`);
});

for (const [name, file] of [['source', ROUTES_TS], ['compiled', ROUTES_JS]]) {
  test(`the ${name} access-review inventory uses core's shared expiry rule`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(
      /isConnectionExpired/.test(src),
      'the inventory must derive expired from core isConnectionExpired, so the advisor bot and '
      + 'the hub cannot disagree about which logins are broken',
    );
    // The naive rule is the specific regression: it reports every refreshable connection whose
    // short-lived access token has lapsed (most healthy OAuth connections, most of the time).
    assert.ok(
      !/expiry\)\.getTime\(\)\s*<\s*now/.test(src),
      'found the naive `expiry < now` rule — that flags healthy self-renewing connections',
    );
    assert.ok(
      /refreshable/.test(src),
      'the inventory must tell the advisor whether an authorization can renew itself, or the bot '
      + 'will read a past expiry as a broken login',
    );
  });
}
