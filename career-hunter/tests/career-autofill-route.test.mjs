/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the compiled caller-scoped no-store bookmarklet route against real bounded profile files and isolated users.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove hard-link and growth limits fail closed and expose the accurate direct-action/page-event response contract.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-autofill-route-'));
const originalLoad = Module._load;

Module._load = function loadAutofillRoute(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
  }
  if (request === './career-user-store') {
    return {
      callerSub: (req) => req.userSub || null,
      userPaths: (userSub) => ({ userDir: join(fixtureRoot, userSub) }),
    };
  }
  return originalLoad.call(this, request, ...rest);
};

const routes = require('../routes/career-autofill-routes.js');

after(() => {
  Module._load = originalLoad;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function captureHandler() {
  let handler;
  routes.registerCareerAutofillRoutes({
    get(path, callback) { if (path === '/autofill/bookmarklet') handler = callback; },
  });
  assert.equal(typeof handler, 'function');
  return handler;
}

function responseRecorder() {
  let complete;
  const done = new Promise((resolve) => { complete = resolve; });
  return {
    statusCode: 200, body: undefined, headers: {}, done,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; complete(); return this; },
  };
}

async function invoke(userSub) {
  const response = responseRecorder();
  captureHandler()({ userSub }, response);
  await response.done;
  return response;
}

test('returns one private no-store bookmarklet for the authenticated caller only', async () => {
  const userDir = join(fixtureRoot, 'alice');
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, 'career_db.json'), JSON.stringify({
    profile: { name: 'Alice Candidate', email: 'alice@example.test', location: 'Austin, TX' },
  }));
  writeFileSync(join(userDir, 'apply_profile.json'), JSON.stringify({ phone: '+15551234567' }));
  const response = await invoke('alice');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal(response.headers.pragma, 'no-cache');
  assert.equal(response.body.offline, true);
  assert.equal(response.body.directSubmit, false);
  assert.equal(response.body.directNetwork, false);
  assert.equal(response.body.emitsFieldEvents, true);
  assert.equal(response.body.pageMayReact, true);
  assert.match(response.body.warning, /page may react/i);
  assert.ok(response.body.bookmarklet.startsWith('javascript:'));
  assert.ok(!response.body.bookmarklet.includes('alice@example.test'));
  assert.deepEqual(response.body.populatedFields.slice(0, 3), ['fullName', 'firstName', 'lastName']);

  const other = await invoke('bob');
  assert.equal(other.statusCode, 409);
  assert.ok(!JSON.stringify(other.body).includes('Alice Candidate'));
});

test('rejects malformed, nonregular, and unauthenticated profile reads without a bookmarklet', async () => {
  const malformedDir = join(fixtureRoot, 'malformed');
  mkdirSync(malformedDir, { recursive: true });
  writeFileSync(join(malformedDir, 'career_db.json'), '{not-json');
  const malformed = await invoke('malformed');
  assert.equal(malformed.statusCode, 422);
  assert.equal(malformed.body.bookmarklet, undefined);

  const directoryDir = join(fixtureRoot, 'directory-profile');
  mkdirSync(join(directoryDir, 'career_db.json'), { recursive: true });
  const directory = await invoke('directory-profile');
  assert.equal(directory.statusCode, 422);

  const unauthorized = await invoke(undefined);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers['cache-control'], 'private, no-store, max-age=0');
});

test('rejects hard-linked and oversized profile files without exposing their content', async () => {
  const outside = join(fixtureRoot, 'outside-profile.json');
  writeFileSync(outside, JSON.stringify({ email: 'outside@example.test' }));
  const linkedDir = join(fixtureRoot, 'hard-linked');
  mkdirSync(linkedDir, { recursive: true });
  linkSync(outside, join(linkedDir, 'career_db.json'));
  const linked = await invoke('hard-linked');
  assert.equal(linked.statusCode, 422);
  assert.ok(!JSON.stringify(linked.body).includes('outside@example.test'));

  const largeDir = join(fixtureRoot, 'oversized');
  mkdirSync(largeDir, { recursive: true });
  writeFileSync(join(largeDir, 'career_db.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
  const oversized = await invoke('oversized');
  assert.equal(oversized.statusCode, 422);
  assert.equal(oversized.body.bookmarklet, undefined);
});
