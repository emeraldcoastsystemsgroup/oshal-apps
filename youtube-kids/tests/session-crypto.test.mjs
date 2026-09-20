/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Kid Lens Takeout encryption behavior and compiled-route wiring without external services.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the manifest-contributed whole-archive handler contract and compiled export.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Take over the BEHAVIOURAL Takeout-handler proof from the core repo. Entries 1-2 read the compiled file as text, which shows the wiring exists and nothing about what it does; the only case that actually CALLED the handler lived in core's takeout-package-registration.spec.ts and reached this package over a relative path into a sibling checkout. That is a Rule 0c violation, and it also made the core spec permanently red in the core nightly, whose gate runs from a git-archive export with no sibling store repo beside it. Moved here and widened: per-owner keying, the encrypted-at-rest envelope, a randomized envelope per write, and a refusal that never reaches the database. Module._load stubs only the kernel aliases and express (store CI runs plain node --test with no install); ./youtube-takeout and ./session-crypto stay real, so the parsing and the encryption under test are the shipped ones.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Module, { createRequire } from 'node:module';
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

// ── The BEHAVIOURAL half of the Takeout handler contract ──────────────────────────────────────
// The three assertions above read the compiled file as TEXT. That proves the wiring exists and
// nothing at all about what it does. This block calls the exported handler against a recording
// pool double and checks the two properties an ingest can silently lose: that every write is
// keyed to the owner the spine authenticated, and that the raw archive is stored encrypted
// rather than as the bytes that arrived.
//
// It lived in the CORE repo (tests/unit/takeout-package-registration.spec.ts), which imported
// this package over a relative path into a sibling checkout — a Rule 0c violation that also made
// that core spec PERMANENTLY red in the nightly, because the sanctioned gate runs from a
// `git archive` export with no sibling store repo beside it.
//
// Module._load is stubbed the way career-hunter's suites do it: the kernel aliases and express
// are not installed here (store CI runs plain `node --test`, no install), but ./youtube-takeout
// and ./session-crypto stay REAL, so the parsing and the encryption under test are the shipped
// ones rather than doubles.
const ROUTES_PATH = fileURLToPath(new URL('../routes/youtube-kids-routes.js', import.meta.url));

/** Load the compiled route module with only its uninstallable dependencies stubbed. */
function loadRoutesModule() {
  const originalLoad = Module._load;
  Module._load = function loadWithKidLensStubs(request, ...rest) {
    if (request === 'express') return { Router: () => ({ get() {}, post() {}, use() {} }), raw: () => (_q, _s, next) => next() };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === '@/shared/services/database') {
      return { runRuntimeSchemaBootstrap: async () => undefined, buildOwnerRlsPolicyStatements: () => [] };
    }
    if (request === '@/shared/artifact-exchange') return { redeemArtifactRef: async () => ({ content: '[]' }) };
    if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => undefined };
    if (request === '@/app/routes/inline-bot-execution') return { executeBotOrInline: async () => ({ response: '' }) };
    return originalLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[ROUTES_PATH];
    return require(ROUTES_PATH);
  } finally {
    Module._load = originalLoad;
  }
}

/** A pool that records only the activity INSERT and answers everything else emptily. */
function recordingPool(writes) {
  return {
    query: async (sql, params) => {
      if (String(sql).includes('INSERT INTO oshal_youtube_activity')) writes.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
}

const TAKEOUT_CONTENT = JSON.stringify([{
  title: 'Watched Build a glider',
  subtitles: [{ name: 'Science Channel' }],
  time: '2026-08-05T10:00:00.000Z',
}]);

test('Kid Lens Takeout handler keys every write to the supplied owner and stores the archive encrypted', async () => {
  process.env.SESSION_SECRET = 'kid-lens-takeout-owner-scoping-secret';
  const routes = loadRoutesModule();
  const writes = [];
  const pool = recordingPool(writes);

  const ownerA = await routes.ingestTakeoutWatchHistory({ pool }, { userSub: 'parent-a', content: TAKEOUT_CONTENT, fileName: 'Takeout/Product/history.json' });
  const ownerB = await routes.ingestTakeoutWatchHistory({ pool }, { userSub: 'parent-b', content: TAKEOUT_CONTENT, fileName: 'Takeout/Product/history.json' });

  assert.match(ownerA.summary, /1 watch entries across 1 channels/);
  assert.match(ownerB.summary, /1 watch entries across 1 channels/);
  // Identical content from two parents must never collapse onto one owner.
  assert.deepEqual(writes.map((write) => write.params[0]), ['parent-a', 'parent-b']);
  // raw_blob is $3: never the bytes that arrived, and shaped as the iv:tag:ciphertext envelope.
  assert.notEqual(writes[0].params[2], TAKEOUT_CONTENT);
  assert.equal(String(writes[0].params[2]).split(':').length, 3);
  // Randomized per write, so identical plaintext is not a cross-owner correlation handle.
  assert.notEqual(writes[0].params[2], writes[1].params[2]);
});

test('Kid Lens Takeout handler refuses an unauthenticated owner before it touches the pool', async () => {
  process.env.SESSION_SECRET = 'kid-lens-takeout-refusal-secret';
  const routes = loadRoutesModule();
  let queried = false;
  const pool = { query: async () => { queried = true; return { rows: [], rowCount: 0 }; } };
  await assert.rejects(
    () => routes.ingestTakeoutWatchHistory({ pool }, { userSub: '   ', content: TAKEOUT_CONTENT, fileName: 'x.json' }),
    (error) => error.code === 'not_authenticated',
  );
  assert.equal(queried, false, 'a refused ingest must not reach the database at all');
});
