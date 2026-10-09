/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the loopback fixture for the Rides mobile smoke: the ACTUAL package surface with its vendored Leaflet, the core's shared UI and cockpit assets, and the COMPILED Rides router on the framework's real express (loaded through the route harness with an in-memory pool, a recording Uber Rides provider that prices a fixed trip and a scripted concierge). Map tiles come from a local blank tile via OSHAL_MAP_TILE_URL, set while the fixture runs and restored on close. A parent page iframes the surface and records every bridge envelope that reaches it. No database, no provider, no model, no external traffic.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
/** Resolve bare modules (express, playwright) from the framework checkout. */
export const coreRequire = createRequire(path.join(CORE, 'package.json'));
const harness = createRequire(import.meta.url)('./rides-routes-harness.js');
/** A transparent 1x1 PNG served for every map tile. */
const BLANK_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** The parent page: iframes one surface and records every bridge envelope posted to it. */
function harnessPage(src) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe id="surface" title="surface" src="${src}"></iframe>
<script>window.__inbox=[];window.addEventListener('message',function(e){if(e.origin===location.origin&&e.data&&e.data.channel==='oshal-surface-bridge')window.__inbox.push(e.data);});</script>
</body></html>`;
}

/**
 * @description Start one loopback fixture serving the actual Rides surface over its compiled router.
 * @returns {Promise<{origin: string, pool: object, provider: object, requests: object[], setReply: Function, close: Function}>}
 */
export async function startFixture() {
  const express = coreRequire('express');
  const requests = [];
  let reply = { say: 'Tell me what you need.' };
  const provider = harness.fakeProvider();
  const pool = harness.fakePool();
  const { router } = harness.loadRoutes({ pool, provider, express, reply: () => reply });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.method !== 'GET') requests.push({ method: req.method, path: req.path, body: req.body }); next(); });
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/harness.html', (req, res) => {
    const src = String(req.query.src || '');
    if (!/^\/api\/rides\/[a-z]+$/.test(src)) { res.status(400).end(); return; }
    res.type('html').send(harnessPage(src));
  });
  app.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  app.get('/tiles/:z/:x/:y.png', (_req, res) => res.type('png').send(BLANK_TILE));
  app.use('/shared/ui', express.static(path.join(CORE, 'src', 'shared', 'ui')));
  app.use('/cockpit', express.static(path.join(CORE, 'src', 'pages', 'cockpit')));
  app.use('/api/rides', (req, _res, next) => {
    req.oidc = { isAuthenticated: () => true, user: { sub: 'rider-smoke' } };
    next();
  }, router);
  app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // /config reads the tile URL per request, so pointing it at this server keeps the map offline.
  const savedTiles = process.env.OSHAL_MAP_TILE_URL;
  process.env.OSHAL_MAP_TILE_URL = `${origin}/tiles/{z}/{x}/{y}.png`;
  const restoreTiles = () => { if (savedTiles === undefined) delete process.env.OSHAL_MAP_TILE_URL; else process.env.OSHAL_MAP_TILE_URL = savedTiles; };
  return {
    origin,
    pool, provider, requests,
    setReply: (next) => { reply = next; },
    close: () => new Promise((resolve, reject) => { restoreTiles(); server.closeAllConnections(); server.close((err) => (err ? reject(err) : resolve())); }),
  };
}
