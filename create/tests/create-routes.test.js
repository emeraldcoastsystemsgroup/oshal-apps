/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Real HTTP behaviour of the shipped compiled route: the home surface and the skin are served from the package dir captured at factory time, with no-store and the right content types; a package dir that lacks them answers 404 JSON, never a stack trace; unrelated paths fall through. Express itself is outside the claimed boundary and is replaced by the store's seam stub (plain node, no install, the AI Office destination-suite pattern); the response helpers the handlers call are implemented over Node's real ServerResponse.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.1.0 — GET /new serves the New screen byte-for-byte.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Use the catalog-compatible fixed theme namespace and verify the editor module allowlist.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Verify exact editable-template modules and their missing-package responses.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Serve the Brand Kit page and its shared brand modules through the exact allowlist, with the same missing-package 404.
 *
 * Node built-ins only; ephemeral loopback listeners.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createServer } = require('node:http');
const { test } = require('node:test');

const PKG = path.resolve(__dirname, '..');

/** Minimal express seam: a Router that dispatches GET handlers by exact pathname over real HTTP. */
function fakeRouter() {
  const routes = new Map();
  const router = (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const handler = routes.get(`${req.method.toLowerCase()} ${url.pathname}`);
    if (!handler) return next();
    decorate(res);
    return handler(req, res, next);
  };
  router.routes = routes;
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (routePath, ...handlers) => { routes.set(`${method} ${routePath}`, handlers.at(-1)); return router; };
  }
  return router;
}

/** The response helpers the shipped handlers call, over Node's real ServerResponse. */
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.type = (t) => { res.setHeader('Content-Type', t); return res; };
  res.json = (body) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
  res.sendFile = (file) => { res.end(fs.readFileSync(file)); return res; };
  return res;
}

const STUBS = { express: { Router: () => fakeRouter() } };
const originalLoad = Module._load;
Module._load = function loadWithStoreSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createCreateRoutes } = require('../routes/create-routes.js');
const { createPackageSmokeRoutes } = require('../routes/package-smoke.js');
test.after(() => { Module._load = originalLoad; });

async function fixture(handler, run) {
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end('unhandled'); }));
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
}

test('the home surface and the skin are served byte-for-byte from the installed package dir', async () => {
  await fixture(createCreateRoutes({ appPackageDir: PKG }), async (base) => {
    const home = await fetch(base + '/home');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /^text\/html/);
    assert.equal(home.headers.get('cache-control'), 'no-store');
    const html = await home.text();
    assert.match(html, /<html lang="en" data-theme="create">/);
    assert.match(html, /What will you create today\?/);
    assert.equal(html, fs.readFileSync(path.join(PKG, 'tools', 'create-home.html'), 'utf8'));

    const fresh = await fetch(base + '/new');
    assert.equal(fresh.status, 200);
    assert.match(fresh.headers.get('content-type'), /^text\/html/);
    assert.equal(await fresh.text(), fs.readFileSync(path.join(PKG, 'tools', 'create-new.html'), 'utf8'));

    const skin = await fetch(base + '/theme/create.css');
    assert.equal(skin.status, 200);
    assert.match(skin.headers.get('content-type'), /^text\/css/);
    assert.equal(skin.headers.get('cache-control'), 'no-store');
    assert.equal(await skin.text(), fs.readFileSync(path.join(PKG, 'ui', 'create.css'), 'utf8'));

    const missing = await fetch(base + '/unrelated');
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), 'unhandled');
  });
});

test('the editor serves exact bundled modules and never arbitrary neighboring files', async () => {
  await fixture(createCreateRoutes({ appPackageDir: PKG }), async (base) => {
    for (const [route, relative, type] of [
      ['/editor', 'tools/create-editor.html', 'text/html'],
      ['/editor/model.mjs', 'tools/editor/model.mjs', 'text/javascript'],
      ['/editor/templates.mjs', 'tools/editor/templates.mjs', 'text/javascript'],
      ['/editor/editor-templates.mjs', 'tools/editor/editor-templates.mjs', 'text/javascript'],
      ['/editor/editor.css', 'tools/editor/editor.css', 'text/css'],
      ['/brand', 'tools/create-brand.html', 'text/html'],
      ['/editor/brand-kit.mjs', 'tools/editor/brand-kit.mjs', 'text/javascript'],
      ['/editor/brand-page.mjs', 'tools/editor/brand-page.mjs', 'text/javascript'],
      ['/editor/brand-editor.mjs', 'tools/editor/brand-editor.mjs', 'text/javascript'],
      ['/editor/brand.css', 'tools/editor/brand.css', 'text/css'],
    ]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').startsWith(type));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), fs.readFileSync(path.join(PKG, relative), 'utf8'));
    }
    for (const route of ['/editor/README.md', '/editor/authorization.yaml', '/theme/other.css', '/editor/%2e%2e%2foshal-app.yaml']) {
      assert.equal((await fetch(base + route)).status, 404);
    }
  });
});

test('a package dir without the bundled files answers 404 JSON, never a stack trace', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'create-empty-'));
  try {
    await fixture(createCreateRoutes({ appPackageDir: empty }), async (base) => {
      for (const route of ['/home', '/new', '/theme/create.css', '/editor/templates.mjs', '/editor/editor-templates.mjs', '/brand', '/editor/brand-kit.mjs']) {
        const r = await fetch(base + route);
        assert.equal(r.status, 404, route);
        assert.deepEqual(await r.json(), { error: 'not_found' });
      }
    });
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('the package dir is captured at factory time, not read per request', async () => {
  const before = process.env.OSHAL_APP_PACKAGE_DIR;
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'create-other-'));
  process.env.OSHAL_APP_PACKAGE_DIR = PKG;
  try {
    const handler = createCreateRoutes({});
    // A later mount of ANOTHER package moves the load-time channel; this package must not follow it.
    process.env.OSHAL_APP_PACKAGE_DIR = other;
    await fixture(handler, async (base) => {
      const r = await fetch(base + '/theme/create.css');
      assert.equal(r.status, 200);
      assert.match(await r.text(), /\[data-theme="create"\]/);
    });
  } finally {
    if (before === undefined) delete process.env.OSHAL_APP_PACKAGE_DIR; else process.env.OSHAL_APP_PACKAGE_DIR = before;
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test('the readiness smoke reports this package identity from its own manifest', async () => {
  await fixture(createPackageSmokeRoutes({ appPackageDir: PKG }), async (base) => {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.package, 'create');
    assert.match(body.version, /^\d+\.\d+\.\d+$/);
    assert.equal(body.manifest, 'verified');
  });
});
