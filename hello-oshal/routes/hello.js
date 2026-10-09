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
 * 2                   | maintainer@emeraldcoastsystemsgroup.com | 1.2.2: the company audience view (ADR-164 D6) on /app, the page the Business shells open with ?audience=company. The shared kit follows the theme bootstrap and paints what this sample package is and what its one JSON route answers (GET /ping: route state, the answer time the route reports, whether the factory received the swarm context), with a refused, failing, unexpected or unreachable route each named for what it is. The page's status script runs only when no view renders, so the route is read once. The centred-card layout is scoped to the full page (the body grid under html:not([data-audience]), the card on .hello) so the kit's root, itself a main element, is not boxed by the page's own main rule. The template still holds no backslash, backtick or dollar-brace, so the served bytes equal this source.
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
  <!-- Audience view (ADR-164 D6). The Business shells open this page with ?audience=company. Hello OSHAL keeps no
       saved records, so the view shows what the package is and what its one JSON route answers, from a single plain
       GET /api/hello-oshal/ping, painted by the shared kit in the company grammar. It writes nothing and reads
       nothing else; the status script at the end of the page runs only when no view renders. Any other request
       runs the full page below unchanged. -->
  <link rel="stylesheet" href="/shared/ui/css/app-view.css" />
  <script src="/shared/ui/js/app-view.js"></script>
  <script>
  (function () {
    var A = window.AppView; if (!A) return;
    var ROUTE = 'GET /api/hello-oshal/ping';
    var KICKER = 'Engineering · Hello OSHAL';
    var LEDE = 'The minimal example package: one JSON route and this page. It keeps no saved records and runs no background work, so what its route answers is all there is to show.';
    // One read. A network failure resolves as status 0 and an answer that is not JSON keeps body null, so every
    // outcome reaches the view as a state to name rather than a thrown error.
    function ping() {
      return fetch('/api/hello-oshal/ping', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (r) {
        return r.json().then(function (body) { return { status: r.status, ok: r.ok, body: body && typeof body === 'object' ? body : null }; },
          function () { return { status: r.status, ok: r.ok, body: null }; });
      }, function () { return { status: 0, ok: false, body: null }; });
    }
    // The route answers { ok, app, message, contextAvailable, at }; anything short of that is named, never shown as healthy.
    function verdict(res) {
      if (res.status === 0) return { value: 'Unreachable', tone: 'bad', title: 'The package route could not be reached', text: 'The request to the package route did not reach the server.' };
      if (res.status === 401) return { value: 'Refused', tone: 'warn', title: 'Sign in to check the package route', text: 'The package route refused this session (HTTP 401).' };
      if (res.status === 403) return { value: 'Refused', tone: 'warn', title: 'This account cannot open the package route', text: 'The package route refused this account (HTTP 403).' };
      if (!res.ok) return { value: 'Failing', tone: 'bad', title: 'The package route is failing', text: 'The package route answered HTTP ' + res.status + '.' };
      if (!res.body) return { value: 'Unexpected answer', tone: 'warn', title: 'The package route answered unexpectedly', text: 'The package route answered HTTP ' + res.status + ', but not with JSON.' };
      if (res.body.ok !== true || res.body.app !== 'hello-oshal') return { value: 'Unexpected answer', tone: 'warn', title: 'The package route answered unexpectedly', text: 'The answer does not carry the hello-oshal identity.' };
      return { value: 'Responding', tone: 'ok', title: 'The package route is responding', text: null, healthy: true };
    }
    function stats(res, v) {
      var b = v.healthy ? res.body : {};
      return [
        { id: 'route', label: 'Package route', value: v.value, tone: v.tone, hint: res.status ? 'HTTP ' + res.status : 'No answer' },
        { id: 'answered', label: 'Answered', value: v.healthy ? A.when(b.at) : '—', hint: v.healthy ? 'The time the route reports' : null },
        { id: 'context', label: 'Swarm context', value: v.healthy ? (b.contextAvailable === true ? 'Received' : 'Not received') : '—', hint: v.healthy ? 'As the route reports it' : null }
      ];
    }
    function routeSection(res, v) {
      var b = v.healthy ? res.body : {};
      return { kind: 'table', id: 'route', title: 'Route check', wide: true,
        columns: ['Route', 'Status', 'Package', 'Answer', 'Answered'],
        rows: [[ROUTE, { text: res.status ? 'HTTP ' + res.status : 'No answer', tone: v.tone }, v.healthy ? b.app : '—', v.healthy ? String(b.message || '—') : v.text, v.healthy ? A.when(b.at) : '—']] };
    }
    // What this version ships, as its manifest declares it (the audience-view test holds the manifest to these lines).
    function packageSection() {
      return { kind: 'list', id: 'package', title: 'What this package ships', note: 'Copy it as the starting point for a new extension.', items: [
        { title: 'One JSON route', text: 'GET /api/hello-oshal/ping answers with the package name, a greeting and the time it answered.' },
        { title: 'One ribbon surface', text: 'This page, served at /api/hello-oshal/app.' },
        { title: 'Nothing saved', text: 'No packaged bot, no migrations and no background work.' }
      ] };
    }
    function company() {
      return ping().then(function (res) {
        var v = verdict(res);
        return { kicker: KICKER, title: v.title, lede: v.healthy ? LEDE : v.text, stats: stats(res, v), sections: [routeSection(res, v), packageSection()] };
      });
    }
    // ADR-164 D6: the other shells' audience (family) paints this same account-scoped card in its own grammar; the reads and the model do not change.
    A.boot({ app: 'hello-oshal', escapeLabel: 'Open Hello OSHAL in the cockpit', audiences: { company: company, family: company } });
  })();
  </script>
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
      margin: 0; background: var(--page); color: var(--text);
      font: 15px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    /* The centred card belongs to the full page; an audience view lays out its own root. */
    html:not([data-audience]) body { min-height: 100dvh; display: grid; place-items: center; padding: 20px; }
    .hello {
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
  <main class="hello">
    <div class="mark" aria-hidden="true">↗</div>
    <h1>Hello from oshal</h1>
    <p>This installed application route is mounted and responding through the swarm control plane.</p>
    <div class="status" id="status" role="status"><span class="dot"></span><span>Checking the package route…</span></div>
  </main>
  <script>
    // The full page only: under an audience view the shared kit paints instead (see the head script) and has made
    // its own read, so the route is not read a second time.
    if (!window.AppView || !AppView.active()) {
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
    }
  </script>
</body>
</html>`;
