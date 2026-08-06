/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Email Summarizer digest crypto behavior and compiled-route wiring without framework dependencies or credentials.
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

test('Email Summarizer encryption and decryption fail closed without SESSION_SECRET', () => {
  delete process.env.SESSION_SECRET;
  assert.throws(() => crypto.encryptSessionValue('digest'), { code: 'SESSION_SECRET_REQUIRED' });
  assert.throws(() => crypto.decryptSessionValue('iv:tag:ciphertext'), { code: 'SESSION_SECRET_REQUIRED' });
});

test('Email Summarizer digest values round-trip with authenticated randomized envelopes', () => {
  process.env.SESSION_SECRET = 'email-session-secret-for-round-trip';
  const first = crypto.encryptSessionValue('digest body');
  const second = crypto.encryptSessionValue('digest body');
  assert.equal(first.split(':').length, 3);
  assert.notEqual(first, second);
  assert.equal(crypto.decryptSessionValue(first), 'digest body');
});

test('compiled email routes use the fail-closed helper for both writes and reads', () => {
  const runtime = readFileSync(new URL('../routes/email-app-routes.js', import.meta.url), 'utf8');
  assert.match(runtime, /require\("\.\/session-crypto"\)/);
  assert.match(runtime, /encryptSessionValue/);
  assert.match(runtime, /decryptSessionValue/);
  assert.match(
    runtime,
    /if \(\(0, session_crypto_1\.isSessionSecretRequiredError\)\(err\)\)\s*throw err;/,
    'a missing SESSION_SECRET must escape the optional-cache catch instead of becoming a cache miss',
  );
});
