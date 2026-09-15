/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve only real editor modules and synthetic owner-qualified raster responses for native canvas proof.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const requireCore = createRequire(resolve(coreRoot, 'package.json'));
export const { chromium } = requireCore('playwright');
export const ASSET = '/api/create/project-assets/12345678-1234-1234-1234-123456789abc';
const MODULES = new Set(['model.mjs', 'model-validation.mjs', 'history.mjs', 'renderer.mjs', 'hit-test.mjs', 'image-assets.mjs']);

/** @description Use local synthetic image responses; no installed application or account is contacted.
 * @param {object} options Asset response status, MIME type and optional held response.
 * @returns {Promise<object>} Ephemeral origin, recorded requests, mutable synthetic asset and cleanup. */
export async function startFixture(options = {}) {
  const requests = [], asset = { bytes: Buffer.alloc(0) };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://fixture.invalid').pathname;
    requests.push({ method: req.method, pathname, hasOwnerCookie: (req.headers.cookie ?? '').includes('synthetic-editor-owner=fixture') });
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body><canvas id="canvas"></canvas></body></html>'); return; }
    if (pathname === ASSET) {
      if (options.hold) return;
      const status = options.status ?? ((req.headers.cookie ?? '').includes('synthetic-editor-owner=fixture') ? 200 : 403);
      res.writeHead(status, { 'content-type': options.type ?? 'image/png' }).end(asset.bytes); return;
    }
    if (pathname.startsWith('/editor/') && MODULES.has(basename(pathname))) {
      try { res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(resolve(packageRoot, 'tools/editor', basename(pathname)))); }
      catch { res.writeHead(404).end(); } return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1'); await new Promise(done => server.once('listening', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, asset,
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
