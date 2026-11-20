/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the real anonymous page reader refuses 301/302/303/307/308 redirects (navigation and subresource) to loopback, IPv6 ::1, RFC1918, link-local/cloud metadata and CGNAT without touching the private destination or leaking its body.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import { playwright } from './helpers/ux-page.mjs';

const require = createRequire(import.meta.url);
const engine = require('../engine/jobhunter/browser_fetch.cjs');
const policy = require('../engine/jobhunter/browser_read_policy.cjs');
const { chromium } = playwright();

let publicServer, secretV4Server, secretV6Server;
let publicOrigin, secretV4Origin, secretV6Origin = null;
let secretV4Hits = 0, secretV6Hits = 0;

function listen(server, host) {
  return new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(0, host, () => res(server.address().port));
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((res) => server.close(res));
}

function handleSecret(onHit) {
  return (req, res) => {
    onHit();
    if (req.url.endsWith('.json')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jobs: [{ jobId: 'leak-1', title: 'Leaked Secret Role', jobUrl: '/jobs/leak-1' }] }));
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<h1>Internal Admin</h1><a href="/jobs/leaked-internal">Leaked Internal Admin Job</a>');
  };
}

function handlePublic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const map = {
    '/redirect-301': [301, `${secretV4Origin}/secret-jobs`],
    '/redirect-302': [302, `${secretV4Origin}/secret-jobs`],
    '/redirect-303': [303, `${secretV4Origin}/secret-jobs`],
    '/redirect-307': [307, `${secretV4Origin}/secret-jobs`],
    '/redirect-308': [308, `${secretV4Origin}/secret-jobs`],
    '/redirect-metadata': [302, 'http://169.254.169.254/latest/meta-data/'],
    '/redirect-v6': [302, secretV6Origin ? `${secretV6Origin}/secret-jobs` : 'http://[::1]:1/secret-jobs'],
    '/redirect-api-secret': [302, `${secretV4Origin}/secret-jobs.json`],
    '/redirect-allowed': [302, '/public-target'],
  };
  if (map[url.pathname]) {
    const [status, location] = map[url.pathname];
    res.writeHead(status, { location });
    res.end();
    return;
  }
  res.setHeader('content-type', 'text/html');
  if (url.pathname === '/subresource-redirect') {
    res.end('<h1>Careers</h1><a href="/jobs/public-ok">Public Engineer</a>'
      + '<script>fetch("/redirect-api-secret").then(r=>r.json()).catch(()=>{});</script>');
    return;
  }
  res.end('<h1>Careers</h1><a href="/jobs/redirected-ok">Public Redirected Engineer</a>');
}

before(async () => {
  secretV4Server = http.createServer(handleSecret(() => { secretV4Hits++; }));
  secretV4Origin = `http://127.0.0.1:${await listen(secretV4Server, '127.0.0.1')}`;
  try {
    secretV6Server = http.createServer(handleSecret(() => { secretV6Hits++; }));
    secretV6Origin = `http://[::1]:${await listen(secretV6Server, '::1')}`;
  } catch {
    secretV6Server = null;
  }
  publicServer = http.createServer(handlePublic);
  publicOrigin = `http://127.0.0.1:${await listen(publicServer, '127.0.0.1')}`;
});

after(async () => {
  await Promise.all([closeServer(publicServer), closeServer(secretV4Server), closeServer(secretV6Server)]);
});

const run = (path) => engine.scrape(
  { url: publicOrigin + path, maxPages: 2, deadlineMs: 12000 },
  { chromium, fixtureOrigin: publicOrigin },
);

test('publicAddress refuses loopback, RFC1918, link-local, metadata, CGNAT, ULA and IPv4-mapped IPv6', () => {
  const blocked = [
    '127.0.0.1', '127.255.255.254', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.254',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.254',
    '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '2001:db8::1', '2002:7f00:0001::1',
  ];
  for (const ip of blocked) assert.equal(policy.publicAddress(ip), false, `must refuse ${ip}`);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(policy.publicAddress(ip), true, `must allow ${ip}`);
  }
});

test('301/302/303/307/308 redirects to loopback 127.0.0.1 are refused without touching the private server', async () => {
  for (const path of ['/redirect-301', '/redirect-302', '/redirect-303', '/redirect-307', '/redirect-308']) {
    const beforeHits = secretV4Hits;
    let value = null;
    try { value = await run(path); } catch { /* refusal error is expected */ }
    assert.equal(secretV4Hits, beforeHits, `${path} reached the private 127.0.0.1 server`);
    if (value) {
      assert.deepEqual(value.dom, [], `${path} leaked private DOM links`);
      assert.deepEqual(value.payloads, [], `${path} leaked private JSON payloads`);
    }
  }
});

test('302 redirects to IPv6 ::1 and 169.254.169.254 metadata are refused cleanly', async () => {
  const beforeV6 = secretV6Hits;
  let v6Val = null;
  try { v6Val = await run('/redirect-v6'); } catch { /* refusal expected */ }
  assert.equal(secretV6Hits, beforeV6, 'redirect to ::1 reached the private IPv6 server');
  if (v6Val) assert.deepEqual(v6Val.dom, []);

  let metaVal = null;
  try { metaVal = await run('/redirect-metadata'); } catch { /* refusal expected */ }
  if (metaVal) {
    assert.deepEqual(metaVal.dom, []);
    assert.deepEqual(metaVal.payloads, []);
  }
});

test('subresource fetch() 302 redirect to loopback JSON endpoint is refused without leaking body', async () => {
  const beforeHits = secretV4Hits;
  const value = await run('/subresource-redirect');
  assert.equal(secretV4Hits, beforeHits, 'subresource fetch redirect reached the private server');
  assert.deepEqual(value.payloads, [], 'subresource redirect leaked private JSON payload');
  assert.deepEqual(value.dom.map((row) => row.title), ['Public Engineer']);
});

test('same-origin allowed 302 redirect still loads jobs normally', async () => {
  const value = await run('/redirect-allowed');
  assert.deepEqual(value.dom.map((row) => row.title), ['Public Redirected Engineer']);
});

function connectStatus(proxyPort, authority) {
  return new Promise((res, rej) => {
    const socket = net.connect({ host: '127.0.0.1', port: proxyPort }, () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => { data += chunk.toString('utf8'); });
    socket.on('end', () => res(data.split('\r\n')[0]));
    socket.on('error', rej);
  });
}

test('createReadProxy CONNECT tunnel refuses loopback, RFC1918, metadata, CGNAT and non-443 ports', async () => {
  const proxy = await policy.createReadProxy({ lookup: async () => [{ address: '127.0.0.1' }] });
  const port = Number(new URL(proxy.url).port);
  try {
    const targets = [
      '127.0.0.1:443', '[::1]:443', 'localhost:443', '10.0.0.1:443',
      '172.16.0.1:443', '192.168.1.1:443', '169.254.169.254:443',
      '100.64.0.1:443', '8.8.8.8:8443', 'private.example:443',
    ];
    for (const authority of targets) {
      const line = await connectStatus(port, authority);
      assert.match(line, /^HTTP\/1\.1 403\b/, `CONNECT ${authority} was not refused: ${line}`);
    }
  } finally {
    await proxy.close();
  }
});
