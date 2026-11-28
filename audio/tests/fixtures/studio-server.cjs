/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the genuine Audio router, disposable SQLite/CAS and kernel UI assets; caller authentication uses explicit test-secret header/cookie fixtures, never native admission.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { getDatabase, createAudioRepository } = require('../../lib/db.js');
const { BlobStore } = require('../../lib/blob_store.js');
const { SecurityMiddleware } = require('../../lib/security.js');
const { createRouter } = require('../../lib/router.js');
const { createAudioRoutes } = require('../../routes/audio-routes.js');
const PACKAGE = path.resolve(__dirname, '../..');
const toolchain = process.env.STORE_CI_TOOLCHAIN || path.resolve(PACKAGE, '../scripts/toolchain');
const runtime = createRequire(path.join(toolchain, 'package.json'));

/** @description Resolve the genuine pinned browser driver. @returns {object} Playwright. */
function playwright() { return runtime('playwright'); }

/** @description Build real mono PCM WAV input, independent of the application encoder. @returns {Buffer} One second at 48 kHz. */
function toneWav() {
  const samples = 48000, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(96000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(8000 * Math.sin(i * Math.PI * 880 / 48000)), 44 + i * 2);
  return data;
}

/** @description Serve actual shared kernel files, refusing missing assets instead of substituting a UI. @returns {boolean} Whether the path belongs here. */
function kernelAsset(req, res, platform) {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const roots = [['/shared/ui/', 'src/shared/ui'], ['/cockpit/', 'src/pages/cockpit']];
  const match = roots.find(([prefix]) => pathname.startsWith(prefix));
  let file;
  if (match) file = path.resolve(platform, match[1], '.' + pathname.slice(match[0].length - 1));
  else if (pathname === '/ui/kernel/table.js') file = path.resolve(platform, '../crates/api/src/kernel_table.js');
  else return false;
  const allowed = file.startsWith(path.resolve(platform) + path.sep) || pathname === '/ui/kernel/table.js';
  if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return true; }
  const mime = { '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
  return true;
}

/** @description Start real isolated source routes; authentication is a named fixture seam, never installed admission. @returns {Promise<object>} Server and exact cleanup. */
async function studioFixture() {
  const platform = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_PLATFORM_ROOT || process.env.STORE_CI_KERNEL_PLATFORM;
  if (!platform || !fs.existsSync(path.join(platform, 'src/shared/ui'))) throw new Error('A genuine kernel platform export is required');
  process.env.OSHAL_AUDIO_TEST_SECRET ||= crypto.randomBytes(32).toString('hex');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-workflow-'));
  const db = getDatabase(path.join(directory, 'audio.sqlite'));
  const repo = createAudioRepository({ db }), blobStore = new BlobStore(directory);
  const root = createRouter();
  root.use('/api/audio', createAudioRoutes({ appPackageDir: PACKAGE, db, repo, blobStore }));
  const requests = [];
  const server = http.createServer((req, res) => {
    const cookie = /(?:^|;\s*)audio_workflow_auth=([A-Za-z0-9._-]+)/.exec(req.headers.cookie || '');
    const transport = req.headers.authorization ? 'header' : cookie ? 'fixture-cookie' : 'none';
    if (!req.headers.authorization && cookie) req.headers.authorization = 'Bearer ' + cookie[1];
    const request = { method: req.method, path: new URL(req.url, 'http://127.0.0.1').pathname, authenticated: Boolean(req.headers.authorization) };
    request.authenticationTransport = transport;
    requests.push(request); res.once('finish', () => { request.status = res.statusCode; request.bytes = res.getHeader('Content-Length'); });
    if (!kernelAsset(req, res, platform)) root.handle(req, res);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const subject = 'audio-workflow-' + crypto.randomUUID();
  const token = SecurityMiddleware.generateToken({ sub: subject, role: 'editor' });
  const viewerToken = SecurityMiddleware.generateToken({ sub: subject, role: 'viewer' });
  const authenticate = context => context.addCookies([{ name: 'audio_workflow_auth', value: token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  const call = async (method, route, body) => {
    const response = await fetch(base + route, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const close = async () => { await new Promise(done => server.close(done)); db.close(); fs.rmSync(directory, { recursive: true, force: true }); };
  return { base, token, viewerToken, authenticate, directory, requests, call, close };
}
module.exports = { playwright, toneWav, studioFixture };
