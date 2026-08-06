/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the packaged Career Hunter CLI crypto seam: missing key fails closed, valid keys round-trip, and the CLI uses the helper instead of passing ciphertext through.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Mutation-prove current v2 rejection, structural legacy/plaintext classification, DB-only fallback, and propagation of every crypto failure.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';

const require = createRequire(import.meta.url);
const crypto = require('../lib/session-crypto.js');
const cli = require('../bin/oshal-jobhunter.js');
const savedSecret = process.env.SESSION_SECRET;
const TEST_PROVIDER = 'session_crypto_test';
const TEST_PROVIDER_ENV = 'OSHAL_CRED_SESSION_CRYPTO_TEST';
const savedProviderCredential = process.env[TEST_PROVIDER_ENV];

afterEach(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
  if (savedProviderCredential === undefined) delete process.env[TEST_PROVIDER_ENV];
  else process.env[TEST_PROVIDER_ENV] = savedProviderCredential;
});

test('Career Hunter encryption and decryption fail closed without SESSION_SECRET', () => {
  delete process.env.SESSION_SECRET;
  for (const operation of [
    () => crypto.encryptSessionValue('credential'),
    () => crypto.decryptSessionValue('AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:YQ=='),
  ]) {
    assert.throws(operation, (err) => err?.code === 'SESSION_SECRET_REQUIRED' && /SESSION_SECRET/.test(err.message));
  }
});

test('Career Hunter helper preserves the authenticated legacy envelope with a valid secret', () => {
  process.env.SESSION_SECRET = 'career-session-secret-for-round-trip';
  const first = crypto.encryptSessionValue('credential-value');
  const second = crypto.encryptSessionValue('credential-value');
  assert.equal(first.split(':').length, 3);
  assert.notEqual(first, second, 'random IVs must produce distinct envelopes');
  assert.equal(crypto.decryptSessionValue(first), 'credential-value');
});

test('Career Hunter structurally distinguishes legacy envelopes from colon-containing plaintext', async () => {
  process.env.SESSION_SECRET = 'career-session-secret-for-classification';
  const encrypted = crypto.encryptSessionValue('credential-value');
  assert.equal(crypto.isSessionEncryptedValue(encrypted), true);
  assert.equal(crypto.isSessionEncryptedValue('scheme:tenant:token'), false);
  assert.equal(crypto.isSessionEncryptedValue('iv:tag:ciphertext'), false);
  assert.equal(
    crypto.isSessionEncryptedValue(`${Buffer.alloc(12).toString('base64')}:${Buffer.alloc(16).toString('base64')}:`),
    false,
  );
  delete process.env[TEST_PROVIDER_ENV];
  assert.equal(
    await cli.resolveSecret(TEST_PROVIDER, 'user-a', async () => 'scheme:tenant:token'),
    'scheme:tenant:token',
  );
});

test('Career Hunter recognizes kernel v2 ciphertext and rejects it as a typed unsupported format', async () => {
  delete process.env.SESSION_SECRET;
  delete process.env[TEST_PROVIDER_ENV];
  const v2 = 'v2:YWJjZA==:ZWZnaA==:aWprbA==';
  assert.equal(crypto.isSessionEncryptedValue(v2), true);
  assert.throws(() => crypto.decryptSessionValue(v2), { code: 'SESSION_SECRET_UNSUPPORTED_ENVELOPE' });
  await assert.rejects(
    cli.resolveSecret(TEST_PROVIDER, 'user-a', async () => v2),
    { code: 'SESSION_SECRET_UNSUPPORTED_ENVELOPE' },
  );
  process.env[TEST_PROVIDER_ENV] = v2;
  await assert.rejects(
    cli.resolveSecret(TEST_PROVIDER, 'user-a', async () => { throw new Error('DB must not run'); }),
    { code: 'SESSION_SECRET_UNSUPPORTED_ENVELOPE' },
  );
});

test('Career Hunter DB unavailability falls back while crypto authentication failures propagate', async () => {
  delete process.env[TEST_PROVIDER_ENV];
  assert.equal(await cli.readStoredSecret(TEST_PROVIDER, 'user-a', () => { throw new Error('db down'); }), undefined);
  let poolEnded = false;
  const unavailable = await cli.readStoredSecret(TEST_PROVIDER, 'user-a', () => ({
    query: async () => { throw new Error('query down'); },
    end: async () => { poolEnded = true; },
  }));
  assert.equal(unavailable, undefined);
  assert.equal(poolEnded, true);
  assert.equal(await cli.resolveSecret(TEST_PROVIDER, 'user-a', async () => undefined), undefined);

  process.env.SESSION_SECRET = 'career-session-secret-correct';
  const encrypted = crypto.encryptSessionValue('credential-value');
  process.env.SESSION_SECRET = 'career-session-secret-wrong';
  await assert.rejects(cli.resolveSecret(TEST_PROVIDER, 'user-a', async () => encrypted), /authenticate/i);
});

test('Career Hunter CLI keeps crypto outside the optional DB catch', () => {
  const source = readFileSync(new URL('../bin/oshal-jobhunter.js', import.meta.url), 'utf8');
  assert.match(source, /require\('\.\.\/lib\/session-crypto'\)/);
  assert.match(source, /const value = await readStored\(provider, userSub\);/);
  assert.match(source, /isSessionEncryptedValue\(stored\) \? decryptSessionValue\(stored\) : stored/);
});
