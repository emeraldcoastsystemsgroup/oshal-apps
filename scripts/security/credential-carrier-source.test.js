/**
 * Application credential-carrier source guards.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE       | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com     | Guard the ten migrated source
 *            | routes against generic model credential carriers and require tool-disabled
 *            | reasoning.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com     | Guard the final four deterministic
 *            | provider routes against child-process/env credential transport and require the
 *            | typed request-scoped core operation bridge.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com     | Keep Little Monsters text tutoring
 *            | on the caller-scoped bot boundary and fence classroom/model input as untrusted data.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com     | Prove the Aero numerical worker
 *            | receives an explicit non-secret runtime environment instead of the controller env.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com     | Keep controller-host Claude OAuth
 *            | out of Career users' caller-owned connection state.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com     | Keep Career digest Twilio delivery
 *            | in-process and caller-scoped instead of copying the controller environment.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const ROUTE_FILES = [
  'home/src-routes/home-routes.ts',
  'social/src-routes/social-routes.ts',
  'email-summarizer/src-routes/email-app-routes.ts',
  'switchboard/src-routes/switchboard-compose-routes.ts',
  'movies/src-routes/movies-routes.ts',
  'spotify/src-routes/spotify-routes.ts',
  'purchasing/src-routes/purchasing-routes.ts',
  'rides/src-routes/rides-routes.ts',
  'eats/src-routes/eats-routes.ts',
  'travel/src-routes/travel-routes.ts',
  'little-monsters/src-routes/education-tutor-routes.ts',
  'little-monsters/src-routes/education-lecture-transcript-routes.ts',
  'little-monsters/src-routes/education-study-model.ts',
];

const DIRECT_PROVIDER_ROUTES = new Map([
  ['purchasing/src-routes/purchasing-routes.ts', {
    runner: 'runWalmartProviderOperation',
    credential: 'OSHAL_CRED_WALMART',
  }],
  ['rides/src-routes/rides-routes.ts', {
    runner: 'runUberRidesProviderOperation',
    credential: 'OSHAL_CRED_UBER_RIDES',
  }],
  ['eats/src-routes/eats-routes.ts', {
    runner: 'runUberEatsProviderOperation',
    credential: 'OSHAL_CRED_UBER',
  }],
  ['travel/src-routes/travel-routes.ts', {
    runner: 'runDuffelProviderOperation',
    credential: 'OSHAL_CRED_DUFFEL',
  }],
]);

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Return every syntactically balanced call beginning with `callee(` in source text. */
function callSlices(text, callee) {
  const slices = [];
  const needle = `${callee}(`;
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(needle, cursor);
    if (start < 0) break;
    let depth = 0;
    let state = 'code';
    let escaped = false;
    let end = -1;
    for (let index = start + callee.length; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (state === 'line-comment') {
        if (char === '\n') state = 'code';
        continue;
      }
      if (state === 'block-comment') {
        if (char === '*' && next === '/') { state = 'code'; index += 1; }
        continue;
      }
      if (state !== 'code') {
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if ((state === 'single' && char === "'")
          || (state === 'double' && char === '"')
          || (state === 'template' && char === '`')) state = 'code';
        continue;
      }
      if (char === '/' && next === '/') { state = 'line-comment'; index += 1; continue; }
      if (char === '/' && next === '*') { state = 'block-comment'; index += 1; continue; }
      if (char === "'") { state = 'single'; continue; }
      if (char === '"') { state = 'double'; continue; }
      if (char === '`') { state = 'template'; continue; }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) { end = index + 1; break; }
      }
    }
    assert.notEqual(end, -1, `${callee} call at offset ${start} is balanced`);
    slices.push(text.slice(start, end));
    cursor = end;
  }
  return slices;
}

test('migrated application sources do not import the retired generic credential broker', () => {
  for (const relativePath of ROUTE_FILES) {
    const text = source(relativePath);
    assert.doesNotMatch(
      text,
      /import\s*\{[^}]*\bresolveBotCreds\b[^}]*\}\s*from\s*['"]@\/app\/routes\/connector-token-broker['"]/s,
      relativePath,
    );
  }
});

test('generic model dispatch is credential-free and tool-disabled', () => {
  let dispatchCount = 0;
  for (const relativePath of ROUTE_FILES) {
    const calls = [
      ...callSlices(source(relativePath), 'executeBotOrInline'),
      ...callSlices(source(relativePath), 'processMessage'),
    ];
    assert.ok(calls.length > 0, `${relativePath} has a guarded model dispatch`);
    for (const call of calls) {
      dispatchCount += 1;
      assert.doesNotMatch(call, /(?:^|[,{])\s*(?:creds|credentials|connectorTokens|tokens)\s*(?:[:,}])/s, relativePath);
      assert.doesNotMatch(call, /OSHAL_CRED_[A-Z0-9_]+/, relativePath);
      assert.match(call, /agenticMode\s*:\s*false/, `${relativePath} keeps provider tools outside model reasoning`);
    }
  }
  assert.equal(dispatchCount, 13, 'all thirteen migrated model-dispatch sites stay under the guard');
});

test('deterministic provider routes pass one explicit credential to the typed in-process bridge', () => {
  for (const relativePath of ROUTE_FILES) {
    const text = source(relativePath);
    const expected = DIRECT_PROVIDER_ROUTES.get(relativePath);
    if (!expected) {
      assert.doesNotMatch(text, /\bresolveServerOperationCreds\s*\(/, relativePath);
      continue;
    }

    const resolverCalls = callSlices(text, 'resolveServerOperationCreds');
    assert.equal(resolverCalls.length, 1, `${relativePath} resolves once at its bounded helper`);
    assert.match(resolverCalls[0], /['"]fixed-server-operation['"]/, relativePath);
    assert.doesNotMatch(resolverCalls[0], /['"]trusted-provider-intent['"]/, relativePath);

    assert.match(text, /from\s*['"]@\/app\/routes\/provider-operation-clients['"]/, relativePath);
    const providerCalls = callSlices(text, expected.runner);
    assert.equal(providerCalls.length, 1, `${relativePath} calls one typed provider bridge`);
    assert.match(providerCalls[0], new RegExp(`creds\\.${expected.credential}\\s*,\\s*args`), relativePath);

    assert.doesNotMatch(text, /(?:from\s*['"](?:node:)?child_process['"]|\bexecFile\s*\()/, relativePath);
    assert.doesNotMatch(text, /\bNodeJS\.ProcessEnv\b|\benv\s*:\s*NodeJS\.ProcessEnv|\bOSHAL_USER_SUB\s*:/, relativePath);
    assert.doesNotMatch(text, /const\s+[A-Z_]+_CLI\s*=/, relativePath);
  }
});

test('Little Monsters model paths have no raw OAuth or subprocess credential path', () => {
  const expectedWrapCounts = new Map([
    ['little-monsters/src-routes/education-tutor-routes.ts', 3],
    ['little-monsters/src-routes/education-lecture-transcript-routes.ts', 2],
    ['little-monsters/src-routes/education-study-model.ts', 2],
  ]);
  for (const [relativePath, expectedWrapCount] of expectedWrapCounts) {
    const text = source(relativePath);
    assert.doesNotMatch(text, /(?:node:)?child_process|\bspawn\s*\(|\.claude[\\/].*credentials\.json|claudeOauthExists|modelCredential/);
    assert.match(text, /executeBotOrInline/);
    assert.match(text, /agenticMode\s*:\s*false/);
    assert.match(text, /autoApprove\s*:\s*false/);
    const wrapped = callSlices(text, 'wrapUntrustedPromptContent');
    assert.equal(wrapped.length, expectedWrapCount, `${relativePath} fences every external content class`);
  }
});

test('Aero numerical worker receives only an explicit non-secret environment', () => {
  const relativePath = 'aero-lab/src-routes/engine-adapter.ts';
  const text = source(relativePath);
  assert.doesNotMatch(text, /env\s*:\s*\{\s*\.\.\.process\.env/);
  assert.match(text, /env\s*:\s*buildAeroWorkerEnv\(this\.engineDir\)/);
  assert.match(text, /WORKER_ENV_ALLOWLIST/);
  assert.match(text, /PYTHONNOUSERSITE:\s*['"]1['"]/);
  assert.doesNotMatch(text, /WORKER_ENV_ALLOWLIST\s*=\s*\[[^\]]*(?:TOKEN|SECRET|KEY|PASSWORD|DATABASE|SESSION)/s);
});

test('Career settings never treat controller-host Claude OAuth as a user connection', () => {
  const relativePath = 'career-hunter/src-routes/career-settings-routes.ts';
  const text = source(relativePath);
  assert.doesNotMatch(text, /\.claude|credentials\.json|\bHOME\b|\bUSERPROFILE\b|hasHostClaude/);
  assert.match(text, /anthropicConnected:\s*result\.rows\.some/);
});

test('Career digest uses the exact in-process Twilio operation', () => {
  const relativePath = 'career-hunter/src-routes/career-digest.ts';
  const text = source(relativePath);
  assert.match(text, /from\s*['"]@\/app\/routes\/twilio-sms-operation['"]/);
  assert.match(text, /sendUserTwilioSms\(pool,\s*userSub,\s*phone,\s*body\)/);
  assert.doesNotMatch(text, /(?:node:)?child_process|\bspawn\s*\(|oshal-twilio\.js|\.\.\.process\.env/);
});
