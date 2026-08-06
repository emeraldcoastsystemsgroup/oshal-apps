/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Finance Plaid-token crypto behavior and compiled-route wiring without provider credentials.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';

const require = createRequire(import.meta.url);
const crypto = require('../routes/session-crypto.js');
const savedSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
});

test('Finance encryption and decryption fail closed without SESSION_SECRET', () => {
  delete process.env.SESSION_SECRET;
  assert.throws(() => crypto.encryptSessionValue('plaid-token'), { code: 'SESSION_SECRET_REQUIRED' });
  assert.throws(() => crypto.decryptSessionValue('iv:tag:ciphertext'), { code: 'SESSION_SECRET_REQUIRED' });
});

test('Finance tokens round-trip with authenticated randomized envelopes', () => {
  process.env.SESSION_SECRET = 'finance-session-secret-for-round-trip';
  const first = crypto.encryptSessionValue('plaid-token');
  const second = crypto.encryptSessionValue('plaid-token');
  assert.equal(first.split(':').length, 3);
  assert.notEqual(first, second);
  assert.equal(crypto.decryptSessionValue(first), 'plaid-token');
});

test('compiled finance routes use the fail-closed helper for token writes and reads', () => {
  const runtime = readFileSync(new URL('../routes/finance-routes.js', import.meta.url), 'utf8');
  assert.match(runtime, /require\("\.\/session-crypto"\)/);
  assert.match(runtime, /encryptSessionValue/);
  assert.match(runtime, /decryptSessionValue/);
});
