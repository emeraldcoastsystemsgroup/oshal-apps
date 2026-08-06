/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-05 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Guard the package-owned exact-user
 *   settings bridge: absent/false deny, true allows, failures stay unavailable, and SQL receives the
 *   subject byte-for-byte without a kernel-side table dependency.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readAutoSubmitAuthorization } from './apply-authorization.js';

function poolWith(row) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: row === undefined ? [] : [row] };
    },
  };
}

test('absent and explicit false settings deny auto-submit', async () => {
  assert.deepEqual(await readAutoSubmitAuthorization(poolWith(undefined), 'user-a'), {
    authorized: false, reason: 'disabled',
  });
  assert.deepEqual(await readAutoSubmitAuthorization(poolWith({ auto_submit: false }), 'user-a'), {
    authorized: false, reason: 'disabled',
  });
});

test('only the app gate\'s explicit true setting authorizes auto-submit', async () => {
  assert.deepEqual(await readAutoSubmitAuthorization(poolWith({ auto_submit: true }), 'user-a'), {
    authorized: true, reason: 'enabled',
  });
  assert.deepEqual(await readAutoSubmitAuthorization(poolWith({ auto_submit: 'yes' }), 'user-a'), {
    authorized: false, reason: 'disabled',
  });
});

test('query/dependency failures are unavailable and never throw open', async () => {
  assert.deepEqual(await readAutoSubmitAuthorization(null, 'user-a'), {
    authorized: false, reason: 'unavailable',
  });
  const pool = { query: async () => { throw new Error('database offline'); } };
  assert.deepEqual(await readAutoSubmitAuthorization(pool, 'user-a'), {
    authorized: false, reason: 'unavailable',
  });
});

test('uses the exact subject unchanged as the sole SQL parameter', async () => {
  const exact = ' Tenant|Case Sensitive Subject ';
  const pool = poolWith({ auto_submit: true });
  await readAutoSubmitAuthorization(pool, exact);
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, [exact]);
  assert.match(pool.calls[0].sql, /WHERE user_sub=\$1 LIMIT 1/);
});
