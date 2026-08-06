/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-05 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Execute the compiled World write guard and prove URL credentials fail, bearer/dedicated headers succeed, wrong credentials fail, and logs never contain the token
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

const ROUTE_PATH = path.join(__dirname, '..', 'routes', 'world-routes.js');

function loadGuard(logs) {
  const registrations = [];
  const router = {
    get() {},
    post(routePath, ...handlers) { registrations.push({ routePath, handlers }); },
  };
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({
        info: (...args) => logs.push(args),
        warn: (...args) => logs.push(args),
        error: (...args) => logs.push(args),
      }) };
    }
    if (request === '@/features/world-data/world-intelligence-service') {
      return { createWorldIntelligenceService: () => ({}) };
    }
    if (request === '@/features/world-data/world-types') {
      return { WorldContributionSchema: { safeParse: () => ({ success: false }) } };
    }
    if (request === '@/features/world-data/outlet-ratings') {
      return { buildOutletSeedContribution: () => ({}) };
    }
    if (request === '@/features/world-data/news-fetcher') {
      return { ingestFeeds: async () => ({}), backtest: async () => ({}) };
    }
    if (request === './world-app-html') return { WORLD_APP_HTML: '<html></html>' };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(ROUTE_PATH)];
    require(ROUTE_PATH).createWorldRoutes();
  } finally {
    Module._load = originalLoad;
  }
  const contribution = registrations.find((entry) => entry.routePath === '/contribute');
  assert.ok(contribution, 'compiled route must register /contribute');
  return contribution.handlers[0];
}

function callGuard(guard, options = {}) {
  const headers = Object.fromEntries(
    Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  let nextCalled = false;
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  guard({
    method: 'POST',
    path: '/contribute',
    query: options.query || {},
    header: (name) => headers[name.toLowerCase()],
  }, response, () => { nextCalled = true; });
  return { nextCalled, statusCode: response.statusCode, body: response.body };
}

test('compiled World write guard accepts headers and rejects every URL token', () => {
  const previous = process.env.WORLD_INGEST_TOKEN;
  const secret = 'world-test-token-that-must-not-reach-logs';
  process.env.WORLD_INGEST_TOKEN = secret;
  const logs = [];
  try {
    const guard = loadGuard(logs);

    assert.deepEqual(callGuard(guard, {
      query: { token: secret },
      headers: { authorization: `Bearer ${secret}` },
    }), {
      nextCalled: false,
      statusCode: 401,
      body: { error: 'query_token_not_allowed' },
    });
    assert.equal(callGuard(guard, {
      headers: { authorization: `Bearer ${secret}` },
    }).nextCalled, true);
    assert.equal(callGuard(guard, {
      headers: { 'x-world-ingest-token': secret },
    }).nextCalled, true);
    assert.deepEqual(callGuard(guard, {
      headers: { authorization: 'Bearer wrong-token' },
    }), {
      nextCalled: false,
      statusCode: 401,
      body: { error: 'unauthorized' },
    });

    assert.doesNotMatch(JSON.stringify(logs), new RegExp(secret));
    assert.doesNotMatch(fs.readFileSync(ROUTE_PATH, 'utf8'), /req\.query\.token\s*===/);
  } finally {
    if (previous === undefined) delete process.env.WORLD_INGEST_TOKEN;
    else process.env.WORLD_INGEST_TOKEN = previous;
    delete require.cache[require.resolve(ROUTE_PATH)];
  }
});
