/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Kid Lens Takeout encryption behavior and compiled-route wiring without external services.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the manifest-contributed whole-archive handler contract and compiled export.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Take over the BEHAVIOURAL Takeout-handler proof from the core repo. Entries 1-2 read the compiled file as text, which shows the wiring exists and nothing about what it does; the only case that actually CALLED the handler lived in core's takeout-package-registration.spec.ts and reached this package over a relative path into a sibling checkout. That is a Rule 0c violation, and it also made the core spec permanently red in the core nightly, whose gate runs from a git-archive export with no sibling store repo beside it. Moved here and widened: per-owner keying, the encrypted-at-rest envelope, a randomized envelope per write, and a refusal that never reaches the database.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The raw export is sealed through `@/features/personal-data` encryptField (the kernel-held key, PDATA-01) instead of the retired SESSION_SECRET helper. The module double is ASYNCHRONOUS like the native kernel's, owner-bound and randomized, so a missed await (a Promise stored as raw_blob) and an owner mix-up both fail here; a refused seal never reaches the database.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

test('compiled Kid Lens routes seal the raw Takeout export through @/features/personal-data', () => {
  const runtime = readFileSync(new URL('../routes/youtube-kids-routes.js', import.meta.url), 'utf8');
  assert.match(runtime, /require\("@\/features\/personal-data"\)/);
  assert.match(runtime, /await \(0, personal_data_1\.encryptField\)\(sub, rawJson\)/);
  assert.doesNotMatch(runtime, /require\("\.\/session-crypto"\)|encryptSessionValue/);
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  assert.match(manifest, /^ {2}- memory\b/m, 'the personal-data kernel skill is declared');
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
// This block calls the exported handler against a recording pool double and checks the two
// properties an ingest can silently lose: that every write is keyed to the owner the spine
// authenticated, and that the raw archive is stored sealed rather than as the bytes that arrived.
// Module._load stubs the kernel aliases and express (store CI runs plain `node --test`, no
// install); ./youtube-takeout stays REAL, so the parsing under test is the shipped one.
const ROUTES_PATH = fileURLToPath(new URL('../routes/youtube-kids-routes.js', import.meta.url));

/** An asynchronous, owner-bound, randomized double of the kernel-backed personal-data module. */
function personalData(seals, refuse = false) {
  return {
    isEncrypted: (value) => typeof value === 'string' && value.startsWith('opd1:'),
    encryptField: async (owner, value) => {
      if (refuse) throw new Error('package data encryption needs the installation vault key');
      seals.push(owner);
      return `opd1:k1:${Buffer.from(`${owner}|${randomBytes(8).toString('hex')}|${value.length}`).toString('base64')}`;
    },
    decryptField: async () => { throw new Error('the raw export is never read back'); },
  };
}

/** Load the compiled route module with only its uninstallable dependencies stubbed. */
function loadRoutesModule(pd) {
  const originalLoad = Module._load;
  Module._load = function loadWithKidLensStubs(request, ...rest) {
    if (request === 'express') return { Router: () => ({ get() {}, post() {}, use() {} }), raw: () => (_q, _s, next) => next() };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === '@/shared/services/database') {
      return { runRuntimeSchemaBootstrap: async () => undefined, buildOwnerRlsPolicyStatements: () => [] };
    }
    if (request === '@/features/personal-data') return pd;
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

test('Kid Lens Takeout handler keys every write to the supplied owner and stores the archive sealed', async () => {
  const seals = [];
  const routes = loadRoutesModule(personalData(seals));
  const writes = [];
  const pool = recordingPool(writes);

  const ownerA = await routes.ingestTakeoutWatchHistory({ pool }, { userSub: 'parent-a', content: TAKEOUT_CONTENT, fileName: 'Takeout/Product/history.json' });
  const ownerB = await routes.ingestTakeoutWatchHistory({ pool }, { userSub: 'parent-b', content: TAKEOUT_CONTENT, fileName: 'Takeout/Product/history.json' });

  assert.match(ownerA.summary, /1 watch entries across 1 channels/);
  assert.match(ownerB.summary, /1 watch entries across 1 channels/);
  // Identical content from two parents must never collapse onto one owner, in the row or the seal.
  assert.deepEqual(writes.map((write) => write.params[0]), ['parent-a', 'parent-b']);
  assert.deepEqual(seals, ['parent-a', 'parent-b']);
  // raw_blob is $3: an awaited envelope string, never the bytes that arrived and never a Promise.
  for (const write of writes) {
    assert.equal(typeof write.params[2], 'string');
    assert.match(write.params[2], /^opd1:k1:/);
    assert.notEqual(write.params[2], TAKEOUT_CONTENT);
  }
  assert.notEqual(writes[0].params[2], writes[1].params[2]);
});

test('a refused seal fails the ingest before the activity row is written', async () => {
  const routes = loadRoutesModule(personalData([], true));
  const writes = [];
  await assert.rejects(
    () => routes.ingestTakeoutWatchHistory({ pool: recordingPool(writes) }, { userSub: 'parent-a', content: TAKEOUT_CONTENT, fileName: 'x.json' }),
    /vault key/,
  );
  assert.equal(writes.length, 0, 'nothing is stored unsealed');
});

test('Kid Lens Takeout handler refuses an unauthenticated owner before it touches the pool', async () => {
  const routes = loadRoutesModule(personalData([]));
  let queried = false;
  const pool = { query: async () => { queried = true; return { rows: [], rowCount: 0 }; } };
  await assert.rejects(
    () => routes.ingestTakeoutWatchHistory({ pool }, { userSub: '   ', content: TAKEOUT_CONTENT, fileName: 'x.json' }),
    (error) => error.code === 'not_authenticated',
  );
  assert.equal(queried, false, 'a refused ingest must not reach the database at all');
});
