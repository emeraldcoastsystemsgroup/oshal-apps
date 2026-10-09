/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the loopback fixture for the Shopping mobile smoke: the ACTUAL package surface, the core's shared UI and cockpit assets, and the COMPILED Shopping router on the framework's real express (loaded through the route harness with an in-memory pool, a recording Walmart provider and a scripted concierge). A parent page iframes the surface and records every bridge envelope that reaches it. No database, no provider, no model, no external traffic.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Serve the router under the native admission rule: every request runs in an AsyncLocalStorage context naming its admission (GET and HEAD read, anything else write), and the pool refuses a SQL write made under read admission with the native host's message. A fresh shopper therefore gets exactly the production behaviour, where GET /cart can no longer create the list and the page's first add must.
 */
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
/** Resolve bare modules (express, playwright) from the framework checkout. */
export const coreRequire = createRequire(path.join(CORE, 'package.json'));
const harness = createRequire(import.meta.url)('./shopping-routes-harness.js');

/** Catalog rows shaped like the core Walmart provider's normalize() output (enough to scroll at 390 px). */
export const PRODUCTS = [
  ['10450115', 'Great Value 2% Reduced Fat Milk, 1 Gallon', 'Great Value', 2.78],
  ['15206353', 'Folgers Classic Roast Ground Coffee, 25.9 oz', 'Folgers', 8.98],
  ['44390948', 'Fresh Bananas, each', 'Fresh', 0.24],
  ['10324110', 'Dawn Ultra Dishwashing Liquid Dish Soap, 19.4 fl oz', 'Dawn', 3.97],
  ['23656343', 'Great Value Large White Eggs, 12 Count', 'Great Value', 2.12],
  ['13176893', 'Method Gel Hand Wash, Sweet Water, 12 fl oz', 'Method', 3.84],
  ['10291646', 'Great Value Whole Vitamin D Milk, 1 Gallon', 'Great Value', 2.82],
  ['55501234', 'Great Value Coffee Filters, 200 Count', 'Great Value', 1.97],
].map(([productId, title, brand, price]) => ({ retailer: 'walmart', productId, title, brand, price, imageUrl: '', productUrl: `https://www.walmart.com/ip/${productId}` }));

/** The parent page: iframes one surface and records every bridge envelope posted to it. */
function harnessPage(src) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe id="surface" title="surface" src="${src}"></iframe>
<script>window.__inbox=[];window.addEventListener('message',function(e){if(e.origin===location.origin&&e.data&&e.data.channel==='oshal-surface-bridge')window.__inbox.push(e.data);});</script>
</body></html>`;
}

/**
 * @description Start one loopback fixture serving the actual Shopping surface over its compiled router.
 * @returns {Promise<{origin: string, pool: object, provider: object, requests: object[], setReply: Function, close: Function}>}
 */
export async function startFixture() {
  const express = coreRequire('express');
  const requests = [];
  let reply = { say: 'Tell me what you need.' };
  const provider = harness.fakeProvider({
    search: (args) => {
      const q = String(args[1]).toLowerCase();
      const hits = PRODUCTS.filter((p) => p.productId === args[1] || p.title.toLowerCase().includes(q));
      return { source: 'walmart', items: (hits.length ? hits : PRODUCTS).slice(0, Number(args[2]) || 8) };
    },
    deals: () => ({ source: 'walmart', feed: 'rollback', items: PRODUCTS.slice(0, 4) }),
  });
  // A fresh shopper (no list) under the native host's admission: a GET request may not write.
  const admission = new AsyncLocalStorage();
  const pool = harness.admittedPool(harness.fakePool({ lists: [] }), () => admission.getStore());
  const { router } = harness.loadRoutes({ pool, provider, express, reply: () => reply });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.method !== 'GET') requests.push({ method: req.method, path: req.path, body: req.body }); next(); });
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/harness.html', (req, res) => {
    const src = String(req.query.src || '');
    if (!/^\/api\/purchasing\/[a-z]+$/.test(src)) { res.status(400).end(); return; }
    res.type('html').send(harnessPage(src));
  });
  app.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  app.use('/shared/ui', express.static(path.join(CORE, 'src', 'shared', 'ui')));
  app.use('/cockpit', express.static(path.join(CORE, 'src', 'pages', 'cockpit')));
  app.use('/api/purchasing', (req, _res, next) => {
    req.oidc = { isAuthenticated: () => true, user: { sub: 'shopper-smoke' } };
    admission.run(['GET', 'HEAD'].includes(req.method) ? 'read' : 'write', next);
  }, router);
  app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    pool, provider, requests,
    setReply: (next) => { reply = next; },
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close((err) => (err ? reject(err) : resolve())); }),
  };
}
