/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Hello OSHAL company audience view (ADR-164 D6). Hello OSHAL has no page file: GET /api/hello-oshal/app is answered by the route factory in routes/hello.js, so the fixture asks that real factory for the page (the mount path stripped, as the loader mounts it) and writes the exact bytes to a temporary file named relative to the store root, which is how the harness serves a page. The one read, GET /api/hello-oshal/ping, answers in the route's own shape (ok, app, message, contextAvailable, at). The full-page marker is the status line turned ok, so the harness proves the page's own status script still runs without the parameter. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHelloRoutes } = require('../routes/hello.js');

/**
 * @description Ask the real route factory for the page it serves at /app, write it to a temporary file and return
 * that file's path relative to the store root (the harness joins it onto its root and serves it at the declared URL).
 * @returns {string} A store-relative path to the served page.
 */
function servedPage() {
  let html = null;
  createHelloRoutes(undefined)({ url: '/app', method: 'GET' }, { setHeader() {}, end(body) { html = String(body); } }, () => {});
  if (!html) throw new Error('hello-oshal audience fixture: the route did not serve /app');
  const store = path.resolve(__dirname, '..', '..');
  const file = path.join(os.tmpdir(), 'oshal-hello-oshal-audience-view-' + process.pid + '.html');
  fs.writeFileSync(file, html);
  process.once('exit', () => fs.rmSync(file, { force: true }));
  const rel = path.relative(store, file);
  if (path.isAbsolute(rel)) throw new Error('hello-oshal audience fixture: the temporary directory must be on the store checkout\x27s drive (' + file + ')');
  return rel;
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'hello-oshal', file: servedPage(), url: '/api/hello-oshal/app', fullMarker: '#status.ok',
  reads: {
    '/api/hello-oshal/ping': () => ({ ok: true, app: 'hello-oshal', message: 'Hello from an installed OSHAL app package!', contextAvailable: true, at: iso(0) }),
  },
  audiences: {
    company: {
      stats: 3, sections: ['route', 'package'],
      text: ['Engineering · Hello OSHAL', 'The package route is responding', 'The minimal example package: one JSON route and this page.', 'Route check',
        'GET /api/hello-oshal/ping', 'HTTP 200', 'Hello from an installed OSHAL app package!', 'What this package ships', 'One JSON route', 'One ribbon surface',
        'This page, served at /api/hello-oshal/app.', 'Nothing saved', 'No packaged bot, no migrations and no background work.'],
      statValues: { route: 'Responding', answered: 'just now', context: 'Received' },
    },
  },
});

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
