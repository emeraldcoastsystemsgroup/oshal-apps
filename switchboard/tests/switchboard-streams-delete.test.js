/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Live 2026-10-11: a Streams draft could only be archived; the sweep's test post stayed in the Archived count because there was no DELETE route or button. The compiled route runs against an in-memory table set: the owner's confirmed delete removes the post with its variants and revisions; another person's post, an unconfirmed request and a scheduled post remove nothing; the surface offers Delete and sends confirm:true.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'switchboard-streams-routes.js');
const SURFACE = path.join(PKG, 'tools', 'switchboard-streams.html');
const POST_A = '11111111-2222-4333-8444-555555555555';
const POST_S = '66666666-7777-4888-9999-000000000000';

/** In-memory posts/variants/revisions with the exact statements the delete path issues. */
function makePool() {
  const posts = [
    { post_id: POST_A, user_sub: 'owner-1', state: 'archived', title: 'sweep2-post', publish_claimed_at: null },
    { post_id: POST_S, user_sub: 'owner-1', state: 'scheduled', title: 'later', publish_claimed_at: null },
  ];
  const variants = [{ post_id: POST_A, user_sub: 'owner-1', platform: 'x' }, { post_id: POST_S, user_sub: 'owner-1', platform: 'x' }];
  const revisions = [{ post_id: POST_A, user_sub: 'owner-1' }];
  const pool = {
    async query(sql, params = []) {
      if (/^DELETE FROM oshal_switchboard_stream_posts/.test(sql)) {
        const hit = posts.filter((p) => p.user_sub === params[0] && p.post_id === params[1] && p.state !== 'scheduled' && !p.publish_claimed_at);
        for (const h of hit) posts.splice(posts.indexOf(h), 1);
        return { rows: hit.map((h) => ({ post_id: h.post_id })), rowCount: hit.length };
      }
      for (const [table, rows] of [['variants', variants], ['revisions', revisions]]) {
        if (new RegExp(`^DELETE FROM oshal_switchboard_stream_${table}`).test(sql)) {
          const hit = rows.filter((r) => r.user_sub === params[0] && r.post_id === params[1]);
          for (const h of hit) rows.splice(rows.indexOf(h), 1);
          return { rows: [], rowCount: hit.length };
        }
      }
      if (/^SELECT \* FROM oshal_switchboard_stream_posts/.test(sql)) {
        const rows = posts.filter((p) => p.user_sub === params[0] && p.post_id === params[1]);
        return { rows, rowCount: rows.length };
      }
      if (/^SELECT \* FROM oshal_switchboard_stream_variants/.test(sql)) {
        const rows = variants.filter((v) => v.user_sub === params[0] && v.post_id === params[1]);
        return { rows, rowCount: rows.length };
      }
      throw new Error(`unexpected SQL in delete test: ${sql.slice(0, 80)}`);
    },
  };
  return { pool, posts, variants, revisions };
}

/** Load the exact compiled route bytes with only framework boundaries replaced. */
function loadDelete(pool) {
  const handlers = new Map();
  const fakeRouter = new Proxy({}, {
    get: (_t, verb) => (route, handler) => { handlers.set(`${String(verb).toUpperCase()} ${route}`, handler); return fakeRouter; },
  });
  const stubs = {
    express: { Router: () => fakeRouter },
    path: require('node:path'),
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/services/database/request-identity': { runWithSystemIdentity: async (fn) => fn() },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (body) => !!body && body.confirm === true,
      confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true.` }),
    },
    './switchboard-compose-routes': { publishTo: async () => ({ ok: false }) },
    './switchboard-streams-model': require(path.join(PKG, 'routes', 'switchboard-streams-model.js')),
  };
  const shimRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    throw new Error(`unexpected require in streams route: ${id}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE),
  );
  mod.exports.createStreamsRoutes({ pool, appPackageDir: PKG });
  const handler = handlers.get('DELETE /posts/:id');
  assert.ok(handler, 'DELETE /posts/:id is registered');
  return handler;
}

/** Call the handler with a recording response. */
async function call(handler, sub, id, body) {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ oidc: sub ? { user: { sub } } : undefined, params: { id }, body, query: {} }, res);
  return res;
}

test('the owner deletes an archived post with its variants and revisions after confirming', async () => {
  const db = makePool();
  const del = loadDelete(db.pool);
  assert.equal((await call(del, 'owner-1', POST_A, {})).statusCode, 428);
  assert.equal(db.posts.length, 2, 'an unconfirmed request removes nothing');
  const res = await call(del, 'owner-1', POST_A, { confirm: true });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { deleted: true, postId: POST_A });
  assert.equal(db.posts.some((p) => p.post_id === POST_A), false);
  assert.equal(db.variants.some((v) => v.post_id === POST_A), false);
  assert.equal(db.revisions.length, 0);
});

test('another person, a scheduled post and an unknown id remove nothing', async () => {
  const db = makePool();
  const del = loadDelete(db.pool);
  assert.equal((await call(del, 'someone-else', POST_A, { confirm: true })).statusCode, 404);
  const scheduled = await call(del, 'owner-1', POST_S, { confirm: true });
  assert.equal(scheduled.statusCode, 409);
  assert.match(scheduled.body.error, /Unschedule/);
  assert.equal((await call(del, null, POST_A, { confirm: true })).statusCode, 401);
  assert.equal((await call(del, 'owner-1', 'not-a-uuid', { confirm: true })).statusCode, 404);
  assert.equal(db.posts.length, 2);
  assert.equal(db.variants.length, 2);
});

test('the Streams surface offers Delete and sends confirm:true', () => {
  const html = fs.readFileSync(SURFACE, 'utf8');
  assert.match(html, /b\("Delete","#i-x","danger","del"\)/);
  assert.match(html, /method:"DELETE", body:JSON\.stringify\(\{ confirm:true \}\)/);
  assert.match(html, /if\(act==="del"\)\{ doDelete\(btn\); return; \}/);
});
