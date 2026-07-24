/**
 * hello-oshal — the minimal OSHAL app-package route.
 *
 * A package route module exports a factory named in oshal-app.yaml (`factory`). The factory
 * receives the swarm's app context and returns an Express handler/router. The OSHAL loader
 * mounts it in-process at the manifest's `mountPath` (here /api/hello-oshal) when the app is
 * activated and the APP_PACKAGE_DYNAMIC_ROUTES flag is on.
 *
 * This example is intentionally self-contained — no framework (`@/...`) imports — so it works
 * with zero runtime resolution. A real app may `require("@/features/...")`; those resolve to
 * the running framework by alias (see BUILDING-EXTENSIONS.md → "Routes").
 */

'use strict';

/**
 * @param {object} ctx - the swarm app context (pool, services, …). Unused here.
 * @returns {import('express').RequestHandler}
 */
exports.createHelloRoutes = function createHelloRoutes(ctx) {
  return function helloRouter(req, res, next) {
    // The loader strips the mount path, so req.url is relative to /api/hello-oshal.
    if (req.url === '/ping' || req.url.indexOf('/ping') === 0) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        app: 'hello-oshal',
        message: 'Hello from an installed OSHAL app package!',
        contextAvailable: !!ctx,
        at: new Date().toISOString(),
      }));
      return;
    }
    next();
  };
};
