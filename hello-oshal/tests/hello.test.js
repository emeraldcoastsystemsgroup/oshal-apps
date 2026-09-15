/** Real HTTP behavior of the shipped route; Node built-ins only, ephemeral loopback listeners. */
'use strict';
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { test } = require('node:test');
const { createHelloRoutes } = require('../routes/hello.js');

async function fixture(context, run) {
  const handler = createHelloRoutes(context);
  const server = createServer((req, res) => handler(req, res, () => {
    res.statusCode = 404; res.end('unhandled');
  }));
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}

test('ping returns the installed package identity and real context availability', async () => {
  for (const [context, expected] of [[undefined, false], [{ fixture: true }, true]]) {
    await fixture(context, async base => {
      const response = await fetch(base + '/ping?fixture=1');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/json/);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.app, 'hello-oshal');
      assert.equal(payload.contextAvailable, expected);
      assert.equal(payload.message, 'Hello from an installed OSHAL app package!');
      assert.ok(Number.isFinite(Date.parse(payload.at)), 'response contains an actual timestamp');
    });
  }
});

test('the app surface serves its real readiness flow and unrelated routes fall through', async () => {
  await fixture(undefined, async base => {
    const response = await fetch(base + '/app?fixture=1');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /<title>Hello oshal<\/title>/);
    assert.match(html, /fetch\('\/api\/hello-oshal\/ping'\)/);
    assert.match(html, /role="status"/);
    const missing = await fetch(base + '/unrelated');
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), 'unhandled');
  });
});
