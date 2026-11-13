/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): a phone or TV is told to sign in to the installation the person is on, never to a fixed one. Until now POST /provision (the phone-provision tool, as Jarvis calls it) wrote one installation's public address into its plan whenever the caller sent no serverUrl, and four places on the page carried the same address as a fallback: on any other installation a customer's TV would have been sent to a server that is not theirs. Over the real routes, a real SQLite file and real HTTP, with the headers the kernel hands a package (a tool call carries x-oshal-public-origin and no Host; a browser request carries its Host and protocol http): the kernel's own public origin is used; without it the public host name the request arrived on, as https whatever the request's protocol says; the caller's serverUrl wins over both; and with neither (a loopback or home-network address, a bare name, a public-origin header that is not an origin) the route answers 400 server_required in words and plans nothing. The page's four pushes send the page's own origin. A guard reads every file the package runs and fails on any web address that is not a reserved name or one of the two outside services the package names, and on any of the product's own installation domains with or without a scheme; it is shown to catch each kind first.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const PKG = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-installation-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;
const store = require(path.join(PKG, 'lib', 'db.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));

const ALICE = { isActive: true, issuer: 'https://issuer.example', sub: 'alice' };
const SLOT_A = 'https://slot-a.example.com';
let server;
let port;

before(async () => {
  const db = store.getDatabase(path.join(work, 'installation.sqlite'));
  const routes = createPhoneControlRoutes({ appPackageDir: PKG, db, authorization: { currentActor: () => ALICE, registerResource() {} } });
  // A tool call reaches a package with no Host header at all, so this server must take such a request.
  server = http.createServer({ requireHostHeader: false }, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      req.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      // The kernel ends TLS and hands the package protocol http; one case says https to show it is never read.
      req.protocol = req.headers['x-test-protocol'] || 'http';
      req.url = req.url.slice('/api/phone-control'.length) || '/';
      routes.handle(req, res, () => { res.statusCode = 404; res.end('{}'); });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => {
  server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

/**
 * @description POST /provision with exactly the headers given: no Host unless one is named, as a tool call has none.
 * @param {object} body The request body.
 * @param {object} headers The headers, lowercase; `host` is sent only when present.
 * @returns {Promise<{status:number,json:object}>} The answer.
 */
function provision(body, headers = {}) {
  const payload = JSON.stringify(body);
  const options = {
    host: '127.0.0.1', port, method: 'POST', path: '/api/phone-control/provision', setHost: false,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers }
  };
  return new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

/** The arguments the planned command carries to the bridge on the person's computer. */
function planned(json) {
  const b64 = /--b64 (\S+)$/.exec(json.command)?.[1];
  assert.ok(b64, `the plan carries a bridge command: ${JSON.stringify(json)}`);
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

const TV = { serialOrIp: '192.168.1.42' };

test('1.14.0: the Jarvis tool path uses the public origin the kernel declares for this installation', async () => {
  const answer = await provision(TV, { 'x-oshal-public-origin': SLOT_A });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  assert.equal(answer.json.args.serverUrl, SLOT_A);
  assert.equal(planned(answer.json).serverUrl, SLOT_A, 'the command the computer runs names this installation');
  assert.equal(planned(answer.json).serial, '192.168.1.42:5555');
  const slash = await provision(TV, { 'x-oshal-public-origin': `${SLOT_A}/` });
  assert.equal(slash.json.args.serverUrl, SLOT_A, 'a trailing slash is not part of the address');
  const plain = await provision(TV, { 'x-oshal-public-origin': 'http://oshal.example.net:8787' });
  assert.equal(plain.json.args.serverUrl, 'http://oshal.example.net:8787', 'the kernel\'s own scheme and port are kept as declared');
});

test('1.14.0: a request with no declared origin uses the public host it arrived on, as https whatever its protocol says', async () => {
  const named = await provision(TV, { host: 'slot-b.example.com' });
  assert.equal(named.status, 200, JSON.stringify(named.json));
  assert.equal(named.json.args.serverUrl, 'https://slot-b.example.com', 'protocol http behind the kernel\'s TLS is not read');
  const ported = await provision(TV, { host: 'Slot-B.Example.com:8443' });
  assert.equal(ported.json.args.serverUrl, 'https://slot-b.example.com:8443');
});

test('1.14.0: the caller\'s own server wins, then the kernel\'s origin, then the host', async () => {
  const both = { 'x-oshal-public-origin': SLOT_A, host: 'slot-b.example.com' };
  const named = await provision({ ...TV, serverUrl: 'https://chosen.example.org' }, both);
  assert.equal(named.json.args.serverUrl, 'https://chosen.example.org');
  assert.equal((await provision(TV, both)).json.args.serverUrl, SLOT_A);
  assert.equal((await provision({ ...TV, serverUrl: '   ' }, both)).json.args.serverUrl, SLOT_A, 'a blank server is no server');
});

test('1.14.0: when this installation\'s public address cannot be known the route says so and plans nothing', async () => {
  const unknown = [{}, { host: '127.0.0.1:38788' }, { host: 'localhost:38788' }, { host: '192.168.1.5:38788' }, { host: 'spark.local' },
    { host: 'kernel' }, { host: '[::1]:38788' }, { host: '127.0.0.1:38788', 'x-test-protocol': 'https' },
    { 'x-oshal-public-origin': 'javascript:alert(1)' }, { 'x-oshal-public-origin': `${SLOT_A}/somewhere` },
    { 'x-oshal-public-origin': 'ftp://files.example.com' }, { 'x-oshal-public-origin': 'slot-a.example.com' }];
  for (const headers of unknown) {
    const answer = await provision(TV, headers);
    assert.equal(answer.status, 400, `${JSON.stringify(headers)} -> ${JSON.stringify(answer.json)}`);
    assert.equal(answer.json.error, 'server_required');
    assert.match(answer.json.message, /^Say which server this TV should connect to\. /);
    assert.match(answer.json.message, /nothing was guessed/);
    assert.equal(answer.json.command, undefined, 'nothing is planned');
    assert.equal(answer.json.args, undefined);
  }
  const phone = await provision({ ...TV, preferAndroid: true });
  assert.match(phone.json.message, /^Say which server this phone should connect to\. /);
  const told = await provision({ ...TV, serverUrl: 'https://chosen.example.org' }, { host: '127.0.0.1:38788' });
  assert.equal(told.json.args.serverUrl, 'https://chosen.example.org', 'the person\'s answer is all it takes');
});

test('1.14.0: the page tells a pushed app the origin of the page it was opened on', async () => {
  const link = await import(path.join(PKG, 'tools', 'computer-link.js'));
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    delete globalThis.location;
    assert.equal(link.installationOrigin(), '', 'outside a page there is no address, and none is made up');
    Object.defineProperty(globalThis, 'location', { value: { origin: 'https://slot-c.example.com' }, configurable: true });
    assert.equal(link.installationOrigin(), 'https://slot-c.example.com');
    Object.defineProperty(globalThis, 'location', { value: { origin: 'null' }, configurable: true });
    assert.equal(link.installationOrigin(), '', 'an opaque origin is no address');
  } finally {
    if (had) Object.defineProperty(globalThis, 'location', had); else delete globalThis.location;
  }
  const read = (file) => fs.readFileSync(path.join(PKG, 'tools', file), 'utf8');
  const pushes = ['phone-rdp.js', 'phone-setup.js', 'phone-concierge.js'].map(read).join('\n');
  assert.equal((pushes.match(/serverUrl(?: =|:) installationOrigin\(\)/g) || []).length, 4, 'each of the four pushes sends the page\'s own origin');
  assert.doesNotMatch(pushes, /location\?\.origin \|\| 'https?:\/\/[^']*\.[^']*'/, 'no push falls back to a named address');
  const tool = /- name: phone-provision\n[\s\S]*?\n {2}- name: /.exec(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'))[0];
  assert.match(tool, /server_required/, 'the tool tells Jarvis what to do when the address is not known');
});

/** Names nobody can be reached at: a bare name, a reserved ending, or the documentation domains. */
const RESERVED = /^(?:[a-z0-9-]+|\.+|.+\.(?:local|localhost|example|test|invalid)|(?:.+\.)?example\.(?:com|org|net))$/;
/** An IPv4 address that is this computer or a documentation range (RFC 5737), never a house or a server. */
const HARMLESS_ADDRESS = /^(?:127\.\d+\.\d+\.\d+|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
/** The outside services this package names, and the one file each may be named in. */
const OUTSIDE = Object.freeze({ 'github.com': 'oshal-app.yaml', 'watch.amazon.com': path.join('bridge', 'oshal_phone_play.py') });
/** The product's own installation domains: none may be written into a file the package runs, with or without a scheme. */
const INSTALLATIONS = /(?:^|[^a-z0-9.-])((?:[a-z0-9-]+\.)*(?:agenticfederal\.us|oswarm\.ai|oshal\.ai))(?![a-z0-9-])/gi;

/**
 * @description Every installation address written into a text: a web address whose host is not reserved, harmless
 * or one of the outside services allowed in that file, and any of the product's own installation domains.
 * @param {string} file The file, relative to the package.
 * @param {string} text Its text.
 * @returns {string[]} One line per finding.
 */
function namedInstallations(file, text) {
  const found = [];
  for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
    const host = match[1].toLowerCase().replace(/\.+$/, '') || '.';
    const numeric = /^\d+(?:\.\d+){3}$/.test(host);
    const allowed = numeric ? HARMLESS_ADDRESS.test(host) : (RESERVED.test(host) || OUTSIDE[host] === file);
    if (!allowed) found.push(`${file}: ${match[0]}`);
  }
  for (const match of text.matchAll(INSTALLATIONS)) found.push(`${file}: ${match[1]}`);
  return found;
}

test('1.14.0: no file the package runs names an installation', () => {
  // The guard first, on text it must catch and text it must let through.
  const host = ['oshal', 'agenticfederal', 'us'].join('.');
  for (const bad of [`const u = 'https://${host}';`, `host = "${host}"`, 'fetch("https://trial.oswarm.ai/api")', 'open https://customer.somewhere.io now',
    'curl http://192.168.1.60:5555/', 'see oshal.ai for more']) {
    assert.notDeepEqual(namedInstallations('routes/x.js', bad), [], `the guard must catch: ${bad}`);
  }
  for (const good of ['new URL(req.url, "http://localhost")', "issuer: 'https://issuer.example'", 'https://oshal.example.com', "'https://your-oshal-host'",
    'DEFAULT \'https://oshal.local\'', 'http://127.0.0.1:38788/readyz', 'pair [url=https://..]', 'com.oshal.remote/.ui.SignInActivity']) {
    assert.deepEqual(namedInstallations('routes/x.js', good), [], `the guard must allow: ${good}`);
  }
  assert.notDeepEqual(namedInstallations('routes/x.js', 'https://github.com/x'), [], 'an outside service is allowed only in its own file');

  const walk = (folder) => fs.readdirSync(path.join(PKG, folder), { withFileTypes: true })
    .filter((entry) => entry.name !== '__pycache__' && entry.name !== 'node_modules')
    .flatMap((entry) => (entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]));
  const files = ['oshal-app.yaml', 'authorization.yaml', ...['routes', 'lib', 'tools', 'bridge', 'personas', 'src-routes', 'migrations'].flatMap(walk)];
  assert.ok(files.length >= 30, `the package's runtime files are read (${files.length})`);
  const findings = files.flatMap((file) => namedInstallations(file, fs.readFileSync(path.join(PKG, file), 'utf8')));
  assert.deepEqual(findings, [], 'a device must be told the installation it is on; name no installation in the package');
});
