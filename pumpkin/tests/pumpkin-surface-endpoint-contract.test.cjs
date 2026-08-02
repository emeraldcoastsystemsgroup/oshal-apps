/**
 * SURFACE ↔ ROUTER CONTRACT.
 *
 * The pumpkin ships its API and its two surfaces in the same package, edited by different hands, and
 * nothing else checks that they agree: a surface calling an endpoint the router never registers gets
 * an HTML 404 body, `r.json()` throws, and the browser helper reports whatever generic message it
 * lands on. On a prop that only works one night a year, "why is this box empty" is not a debugging
 * session anybody wants at 6pm on the 31st.
 *
 * This builds the REAL compiled router (the bytes the framework mounts) and compares its registered
 * path set against every literal /api/pumpkin/... reference in the two bundled surfaces.
 *
 * QUARANTINE: `AWAITING_ROUTE` holds references whose route is owned by another lane and has not
 * landed. Entries expire LOUDLY — the moment the route ships, this suite goes red telling you to
 * delete the line. That is deliberate: a quarantine nobody is forced to clean up becomes permanent.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(PKG, 'routes');

/**
 * Endpoints a surface calls today that the router does not register yet.
 * Each entry MUST name the owner and the user-visible consequence.
 *
 * EMPTY, and it should stay that way. `/links` lived here while the Design C link/QR builder was
 * unbuilt; GET /api/pumpkin/links + GET /api/pumpkin/qr have now shipped, so the strict check below
 * covers them like every other endpoint.
 */
const AWAITING_ROUTE = new Map([]);

// ── Build the real router with the kernel @/ aliases and the DB-backed services stubbed ─────────
let capturedRouter = null;
const origLoad = Module._load;
Module._load = function shimmedLoad(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/shared/services/database') {
    return { buildOwnerRlsPolicyStatements: (t) => [`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`] };
  }
  if (request === '@/shared/middleware/authz') {
    return {
      hasValidServiceSecret: () => false,
      getTrustedServiceUserSub: () => null,
      getCaller: () => ({ sub: null, email: null }),
      isOperatorIdentity: () => false,
    };
  }
  if (request === '@/features/agent-management') {
    return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null };
  }
  if (request === '@/app/routes/inline-bot-execution') {
    return { executeBotOrInline: async () => ({ response: '{}' }) };
  }
  if (request === 'express') {
    return {
      Router: () => {
        const paths = new Set();
        const record = (method) => (routePath) => { paths.add(`${method} ${routePath}`); };
        capturedRouter = {
          get: record('GET'), post: record('POST'), put: record('PUT'),
          patch: record('PATCH'), delete: record('DELETE'), use: () => {},
          paths,
        };
        return capturedRouter;
      },
    };
  }
  return origLoad.call(this, request, ...rest);
};

const { createPumpkinRoutes } = require(path.join(ROUTES_DIR, 'pumpkin-routes.js'));
createPumpkinRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: PKG });
Module._load = origLoad;

const REGISTERED = new Set([...capturedRouter.paths].map((k) => k.split(' ')[1]));

/** Reduce a referenced URL to the router path shape, collapsing `:param` segments. */
function toRoutePath(reference) {
  const bare = reference.replace(/^\/api\/pumpkin/, '').replace(/[?#].*$/, '');
  const trimmed = bare.replace(/\/+$/, '') || '/';
  if (REGISTERED.has(trimmed)) return trimmed;
  // A trailing dynamic segment (`/presets/` + encodeURIComponent(name)) maps onto a `:param` route.
  const parent = trimmed.replace(/\/[^/]*$/, '');
  const param = [...REGISTERED].find((r) => r.startsWith(`${parent}/:`));
  return param || trimmed;
}

function referencedBy(file) {
  const src = fs.readFileSync(path.join(PKG, 'tools', file), 'utf8');
  // Deliberately narrow: a JS string ends at the quote, so `'/api/pumpkin/rooms'` must not swallow
  // the `').then(` that follows it.
  const hits = src.match(/\/api\/pumpkin\/[A-Za-z0-9_/:-]*/g) || [];
  return [...new Set(hits.map(toRoutePath))];
}

test('the compiled router really does register the routes this package advertises', () => {
  // Guard on the guard: if the shim ever fails to capture the router, every other assertion here
  // would trivially pass against an empty set.
  assert.ok(capturedRouter.paths.size >= 20,
    `expected the real router, got ${capturedRouter.paths.size} method+path registrations`);
  for (const expected of ['/speak', '/stream', '/rooms/register', '/rooms/say', '/rooms/heartbeat', '/rooms']) {
    assert.ok(REGISTERED.has(expected), `router lost ${expected}`);
  }
});

test('every endpoint the bundled surfaces call is actually registered', () => {
  const missing = [];
  for (const file of ['pumpkin-app.html', 'pumpkin-remote.html']) {
    for (const route of referencedBy(file)) {
      if (REGISTERED.has(route) || AWAITING_ROUTE.has(route)) continue;
      missing.push(`${file} calls /api/pumpkin${route}, which no route registers`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('quarantined endpoints are still referenced AND still missing — entries expire loudly', () => {
  const referenced = new Set([
    ...referencedBy('pumpkin-app.html'),
    ...referencedBy('pumpkin-remote.html'),
  ]);
  for (const [route, why] of AWAITING_ROUTE) {
    assert.ok(referenced.has(route),
      `AWAITING_ROUTE holds ${route} but no surface calls it any more — delete the entry. (${why})`);
    assert.ok(!REGISTERED.has(route),
      `${route} HAS SHIPPED. Delete its AWAITING_ROUTE entry so the strict check covers it. (${why})`);
  }
});

test('a surface that cannot reach a missing endpoint must degrade VISIBLY, never silently', () => {
  const control = fs.readFileSync(path.join(PKG, 'tools', 'pumpkin-app.html'), 'utf8');
  // The one thing worse than a dead link box is a link box quietly filled with the operator's own
  // localhost address — copied to a phone, it fails with no explanation anywhere.
  assert.doesNotMatch(control, /location\.origin/,
    'the control surface must never build a cross-device link from the browser\'s own origin');
  assert.match(control, /will NOT open on a phone/i,
    'the degraded fallback has to SAY that the address it fell back to is local-only');
});
