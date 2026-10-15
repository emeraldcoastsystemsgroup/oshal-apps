/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the TMDB client
 *   sends requests through the global fetch with no key, maps upstream failures to a status, and the key
 *   resolver reports connected only after a real configuration read; outside the kernel the legacy
 *   ConnectorClient path still receives the key.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// The compiled client imports the framework's connector runtime at load; outside the framework a stub stands in.
const constructed = [];
const stub = path.join(__dirname, 'tmdb-kernel-egress.stub.cjs');
require('node:fs').writeFileSync(stub, `'use strict';
class ConnectorClient { constructor(options) { require(${JSON.stringify(__filename)}).constructed.push(options); } async request(p) { return { legacy: p }; } }
module.exports = { ConnectorClient };`);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '@/app/connectors/runtime') return stub;
  if (request === '@/shared/logger') return path.join(__dirname, 'tmdb-kernel-egress.logger.cjs');
  return resolve.call(this, request, ...rest);
};
require('node:fs').writeFileSync(path.join(__dirname, 'tmdb-kernel-egress.logger.cjs'),
  "'use strict'; module.exports = { createChildLogger: () => ({ warn() {}, info() {}, error() {}, debug() {} }) };");
module.exports.constructed = constructed;
const client = require('../routes/tmdb-client');

test.after(() => {
  for (const file of [stub, path.join(__dirname, 'tmdb-kernel-egress.logger.cjs')]) require('node:fs').rmSync(file, { force: true });
});

function withFetch(replies, run) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status || 200, headers: { 'content-type': 'application/json' } });
  };
  return run(calls).finally(() => { globalThis.fetch = saved; });
}

test('inside the kernel sandbox a TMDB read carries no key and the kernel answer is parsed', async () => {
  process.env.OSHAL_EGRESS = 'kernel';
  try {
    await withFetch([{ body: { results: [{ id: 7, title: 'Dune', release_date: '2021-10-22', vote_average: 7.8, media_type: 'movie' }] } }], async (calls) => {
      const items = await client.tmdbTrending(client.KERNEL_KEY, 5);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.themoviedb.org/3/trending/all/week');
      assert.equal(calls[0].init.headers.accept, 'application/json');
      assert.ok(!calls[0].url.includes('api_key'), 'the kernel appends the key, not the package');
      assert.deepEqual(items.map((t) => [t.key, t.title, t.year]), [['movie:7', 'Dune', '2021']]);
    });
    await withFetch([{ status: 401, body: { status_message: 'Invalid API key' } }], async () => {
      await assert.rejects(client.tmdbConfiguration(), (error) => error.status === 401);
    });
    const refusal = Object.assign(new Error('tmdb is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_TMDB for the installation'), { code: 'native_executor_unavailable' });
    await withFetch([refusal], async () => {
      await assert.rejects(client.tmdbConfiguration(), (error) => error === refusal);
    });
    assert.equal(constructed.length, 0, 'the legacy connector client is never built under the kernel');
  } finally {
    delete process.env.OSHAL_EGRESS;
  }
});

test('outside the kernel the legacy connector client still receives the operator key', async () => {
  delete process.env.OSHAL_EGRESS;
  const answer = await client.tmdbConfiguration();
  assert.deepEqual(answer, { legacy: '/configuration' });
  assert.equal(constructed.length, 1);
  assert.deepEqual(constructed[0].auth, { type: 'apiKeyQuery', param: 'api_key', value: 'kernel' });
  assert.equal(client.kernelEgress(), false);
});
