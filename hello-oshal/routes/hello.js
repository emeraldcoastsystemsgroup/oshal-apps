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
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 21:05:00 | @codex-surface-audit    | Add a real responsive, control-plane-themed /app surface while preserving /ping as JSON.
 */

'use strict';

/**
 * @param {object} ctx - the swarm app context (pool, services, …). Unused here.
 * @returns {import('express').RequestHandler}
 */
exports.createHelloRoutes = function createHelloRoutes(ctx) {
  return function helloRouter(req, res, next) {
    // The loader strips the mount path, so req.url is relative to /api/hello-oshal.
    if (req.url === '/app' || req.url.indexOf('/app?') === 0) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(APP_HTML);
      return;
    }
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

const APP_HTML = `<!doctype html>
<html lang="en" data-theme="midnight">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hello oshal</title>
  <link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
  <script src="/shared/ui/js/surface-theme.js"></script>
  <style>
    :root {
      --page: var(--bg-primary, #0b1020);
      --card: var(--bg-card, #121a30);
      --line: var(--border-color, #243150);
      --text: var(--text-primary, #e8edf7);
      --muted: var(--text-secondary, #8a97b4);
      --accent: var(--accent-primary, #46e5b7);
      --good: var(--status-success, #46e5b7);
      --bad: var(--status-error, #ff6b81);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 20px;
      background: var(--page); color: var(--text);
      font: 15px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    main {
      width: min(560px, 100%); padding: clamp(22px, 6vw, 42px);
      border: 1px solid var(--line); border-radius: 18px; background: var(--card);
    }
    .mark {
      width: 48px; height: 48px; display: grid; place-items: center; border-radius: 14px;
      background: color-mix(in srgb, var(--accent) 18%, var(--card)); color: var(--accent);
      font-size: 24px;
    }
    h1 { margin: 18px 0 4px; font-size: clamp(24px, 7vw, 34px); line-height: 1.1; }
    p { margin: 0; color: var(--muted); }
    .status {
      display: flex; align-items: center; gap: 9px; margin-top: 24px; padding: 12px 14px;
      border: 1px solid var(--line); border-radius: 11px; color: var(--muted);
    }
    .dot { width: 9px; height: 9px; flex: none; border-radius: 50%; background: var(--muted); }
    .status.ok .dot { background: var(--good); }
    .status.bad .dot { background: var(--bad); }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">↗</div>
    <h1>Hello from oshal</h1>
    <p>This installed application route is mounted and responding through the swarm control plane.</p>
    <div class="status" id="status" role="status"><span class="dot"></span><span>Checking the package route…</span></div>
  </main>
  <script>
    fetch('/api/hello-oshal/ping')
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (data) {
        var status = document.getElementById('status');
        status.className = 'status ok';
        status.lastElementChild.textContent = data.message;
      })
      .catch(function () {
        var status = document.getElementById('status');
        status.className = 'status bad';
        status.lastElementChild.textContent = 'The package route is unavailable.';
      });
  </script>
</body>
</html>`;
