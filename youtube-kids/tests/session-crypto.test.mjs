/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Kid Lens Takeout encryption behavior and compiled-route wiring without external services.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the manifest-contributed whole-archive handler contract and compiled export.
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

test('Kid Lens encryption and decryption fail closed without SESSION_SECRET', () => {
  delete process.env.SESSION_SECRET;
  assert.throws(() => crypto.encryptSessionValue('takeout-json'), { code: 'SESSION_SECRET_REQUIRED' });
  assert.throws(() => crypto.decryptSessionValue('iv:tag:ciphertext'), { code: 'SESSION_SECRET_REQUIRED' });
});

test('Kid Lens exports round-trip with authenticated randomized envelopes', () => {
  process.env.SESSION_SECRET = 'kid-lens-session-secret-for-round-trip';
  const first = crypto.encryptSessionValue('{"watched":1}');
  const second = crypto.encryptSessionValue('{"watched":1}');
  assert.equal(first.split(':').length, 3);
  assert.notEqual(first, second);
  assert.equal(crypto.decryptSessionValue(first), '{"watched":1}');
});

test('compiled Kid Lens routes use the fail-closed helper for raw Takeout storage', () => {
  const runtime = readFileSync(new URL('../routes/youtube-kids-routes.js', import.meta.url), 'utf8');
  assert.match(runtime, /require\("\.\/session-crypto"\)/);
  assert.match(runtime, /encryptSessionValue/);
});

test('Kid Lens manifest contribution resolves to the compiled owner-scoped handler', () => {
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../routes/youtube-kids-routes.js', import.meta.url), 'utf8');
  assert.match(manifest, /takeout:\s*[\s\S]*kind: youtube-watch-history/);
  assert.match(manifest, /pathSuffix: Takeout\/YouTube and YouTube Music\/history\/watch-history\.json/);
  assert.match(manifest, /module: routes\/youtube-kids-routes\.js\s+handler: ingestTakeoutWatchHistory/);
  assert.match(runtime, /exports\.ingestTakeoutWatchHistory = ingestTakeoutWatchHistory/);
  assert.match(runtime, /ingestWatchHistory\(ctx\.pool, input\.userSub, input\.content\)/);
});
