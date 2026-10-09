/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify independent Calendar HTTP reads and explicit optional-operation refusals when legacy framework services are absent.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const core = process.env.OSHAL_CORE_ROOT || path.resolve(__dirname, '../../../oshal/src');
const express = require(require.resolve('express', { paths: [core] }));

test('read screens load without optional sync or briefing services; explicit operations fail visibly', async () => {
  const attempted = [], logged = [];
  const original = Module._load;
  const logger = { error: fields => logged.push(fields.err?.message) };
  Module._load = function(request, ...args) {
    if (request === 'express') return express;
    if (request === '@/shared/logger') return { createChildLogger: () => logger };
    if (request.startsWith('@/')) {
      attempted.push(request);
      throw new Error(`Owned missing optional service: ${request}`);
    }
    return original.call(this, request, ...args);
  };
  let server;
  let writes = 0;
  try {
    const ctx = { appPackageDir: path.resolve(__dirname, '..'), pool: { query: async () => { writes += 1; throw new Error('No storage expected'); } } };
    const { createCalendarSyncRoutes } = require('../routes/sync.js');
    const { createMeetingBriefRoutes } = require('../routes/meeting-briefs.js');
    const { createReviewRoutes } = require('../routes/review.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.oidc = { user: { sub: 'owned-calendar-fixture' }, isAuthenticated: () => true }; next(); });
    app.use('/review', createReviewRoutes(ctx));
    app.use('/sync', createCalendarSyncRoutes(ctx));
    app.use('/briefs', createMeetingBriefRoutes(ctx));
    assert.deepEqual(attempted, []);
    server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const review = await fetch(`${origin}/review`);
    assert.equal(review.status, 200);
    assert.match(await review.text(), /Calendar/);
    const unconfirmed = await fetch(`${origin}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unconfirmed.status, 400);
    assert.deepEqual(attempted, []);
    const sync = await fetch(`${origin}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":true}' });
    assert.equal(sync.status, 502);
    assert.match((await sync.json()).error, /previous snapshot was retained/);
    const brief = await fetch(`${origin}/briefs/collect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(brief.status, 503);
    assert.equal((await brief.json()).state, 'unavailable');
    assert.deepEqual(attempted, ['@/app/routes/connectors-routes', '@/app/routes/jarvis-task-store']);
    assert.equal(logged.length, 2);
    assert.equal(writes, 0);
  } finally {
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    Module._load = original;
  }
});
