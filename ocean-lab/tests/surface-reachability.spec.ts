/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard for a SHIPPED defect: the two standalone energy surfaces
 *                     |                             | were unreachable. `app.use(express.static(apiDir))` had been
 *                     |                             | removed deliberately ("static files are now protected"), so
 *                     |                             | every surface needed its own explicit auth-gated route — and
 *                     |                             | harvest-console had none, which meant the page 404'd and all
 *                     |                             | five candidate URLs its inline loader probes for the engine
 *                     |                             | script 404'd with it. A page that renders its own boot-error
 *                     |                             | banner on every load is not a surface.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Rewritten for the ocean-lab PACKAGE. The surfaces now ship inside
 *                     |                             | the package and are served by its own factory, so the guard got
 *                     |                             | strictly stronger: instead of a hand-maintained table of URLs,
 *                     |                             | it PARSES the shipped surface files for every /api/ocean-lab
 *                     |                             | path they reference and asserts each one is routable. A surface
 *                     |                             | that starts fetching a new endpoint fails this until the route
 *                     |                             | exists. It also asserts the manifest's requiresAuth:true, which
 *                     |                             | is the real production guard now that the factory takes an
 *                     |                             | injectable one — a packaged route the framework does not wrap is
 *                     |                             | anonymous, and these routes integrate millions of timesteps.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createOceanLabRoutes } from '../src-routes/ocean-lab-routes';

/** Native fetch captured before anything could stub the global. */
const realFetch = globalThis.fetch;

/** This package's root — the directory the framework hands the factory as ctx.appPackageDir. */
const PACKAGE_DIR = path.resolve(__dirname, '..');

/** Where the bundled surfaces live inside the package. */
const TOOLS_DIR = path.join(PACKAGE_DIR, 'tools');

/**
 * The mount path the manifest declares. Every asserted URL is built from this, so changing the
 * mount moves the whole guard rather than leaving it asserting stale URLs.
 */
const MOUNT = '/api/ocean-lab';

/** The two pages, and the engine scripts each one's inline loader gives up on if it cannot reach. */
const PAGES = ['harvest-console.html', 'blade-studio.html'] as const;
const SCRIPTS = ['harvest-console.js', 'blade-studio.js', 'blade-studio-gl.js'] as const;

/** requiresAuth stub mirroring express-openid-connect: 401 without a session, else pass through. */
function requiresAuthStub(req: Request, res: Response, next: NextFunction): void {
  const user = (req as unknown as { oidc?: { user?: unknown } }).oidc?.user;
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

interface Fixture {
  server: Server;
  origin: string;
}

/**
 * @description Boot a throwaway server carrying the REAL packaged factory, mounted exactly the way
 * the manifest declares it — one `app.use(MOUNT, guard, factory)`, which is what the framework's
 * manifest route mounter does for a route entry with `requiresAuth: true`.
 * @param authenticated - Whether the injected oidc session carries a user.
 * @returns The running fixture.
 */
async function startFixture(authenticated: boolean): Promise<Fixture> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { oidc: unknown }).oidc = authenticated
      ? { isAuthenticated: () => true, user: { sub: 'surface-user' } }
      : { isAuthenticated: () => false };
    next();
  });
  app.use(MOUNT, requiresAuthStub, createOceanLabRoutes({ ctx: { appPackageDir: PACKAGE_DIR } }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

interface Hit {
  status: number;
  contentType: string;
  body: string;
}

/**
 * @description Fetch a path through the WHATWG URL parser, i.e. exactly what a browser sends.
 * @param fixture - Which server to hit.
 * @param routePath - Path under the origin.
 * @returns Status, content type and body text.
 */
async function get(fixture: Fixture, routePath: string): Promise<Hit> {
  const res = await realFetch(`${fixture.origin}${routePath}`);
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: await res.text() };
}

/**
 * @description Send a RAW request line, bypassing URL normalisation.
 *
 * This is the only honest way to test traversal from a client. `fetch('/a/../../../.env')` never
 * puts those dot segments on the wire — the WHATWG URL parser collapses them first — so a
 * traversal case written with fetch proves nothing about the server. node:http writes the path
 * verbatim.
 * @param fixture - Which server to hit.
 * @param rawPath - The literal request target, dot segments and all.
 * @returns Status and body text.
 */
function rawGet(fixture: Fixture, rawPath: string): Promise<{ status: number; body: string }> {
  const { port } = fixture.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: rawPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * @description Every distinct `/api/ocean-lab/...` path the SHIPPED surface files reference.
 *
 * This is the point of the whole spec: the assertion set is DERIVED from what the surfaces actually
 * ask for, not from a list a person keeps in step by hand. A surface that starts fetching a new
 * endpoint fails this test until the route exists.
 * @returns Sorted unique ENDPOINT paths. Two shapes are dropped because neither is a request a
 * surface ever makes: a bare directory prefix (`.../assets/`, concatenated with a filename at
 * runtime — the concrete files are asserted separately above), and a bare router prefix
 * (`/api/ocean-lab/harvest`, which only ever appears in the pages' own provenance prose naming
 * where the data comes from). An endpoint needs at least one segment past the router prefix.
 */
function pathsReferencedBySurfaces(): string[] {
  const routerPrefixes = new Set([`${MOUNT}/harvest`, `${MOUNT}/rotor`, MOUNT]);
  const found = new Set<string>();
  for (const file of [...PAGES, ...SCRIPTS]) {
    const source = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
    for (const match of source.matchAll(/\/api\/ocean-lab\/[A-Za-z0-9/_.-]+/g)) {
      const cleaned = match[0].replace(/[.,)]+$/, '');
      if (cleaned.endsWith('/') || routerPrefixes.has(cleaned)) continue;
      found.add(cleaned);
    }
  }
  return [...found].sort();
}

let authed: Fixture;
let anon: Fixture;

beforeAll(async () => {
  authed = await startFixture(true);
  anon = await startFixture(false);
});

afterAll(async () => {
  await Promise.all(
    [authed, anon].map((f) => new Promise<void>((resolve) => f.server.close(() => resolve()))),
  );
});

describe('ocean-lab surfaces ship inside the package', () => {
  it('carries both pages and all three engine scripts in tools/', () => {
    for (const file of [...PAGES, ...SCRIPTS]) {
      const full = path.join(TOOLS_DIR, file);
      expect(fs.existsSync(full), `${file} must ship in tools/`).toBe(true);
      expect(fs.statSync(full).size, file).toBeGreaterThan(1000);
    }
  });

  it('ships the compiled route module the manifest points at', () => {
    const compiled = path.join(PACKAGE_DIR, 'routes', 'ocean-lab-routes.js');
    expect(fs.existsSync(compiled), 'routes/ocean-lab-routes.js must be compiled and committed').toBe(true);
    expect(fs.readFileSync(compiled, 'utf8')).toContain('exports.createOceanLabRoutes');
  });

  it('reaches for exactly one core module across the WHOLE compiled tree', () => {
    // Scanning only the entry module would miss the engine: `naca-section.js` requires
    // @/shared/logger too, and an engine file that started reaching for @/features/... or
    // @/shared/pool would have compiled, loaded, and gone unnoticed until it broke on a box where
    // that module moved. The package's portability claim is about every file it ships, so the
    // guard has to be about every file it ships.
    const compiledFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) compiledFiles.push(full);
      }
    };
    walk(path.join(PACKAGE_DIR, 'routes'));
    expect(compiledFiles.length, 'the compiled tree is missing').toBeGreaterThan(30);

    const offenders: string[] = [];
    for (const file of compiledFiles) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [, id] of source.matchAll(/require\("(@\/[^"]+)"\)/g)) {
        if (id !== '@/shared/logger') {
          offenders.push(`${path.relative(PACKAGE_DIR, file)} → ${id}`);
        }
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('declares requiresAuth on the manifest mount — the real production guard', () => {
    const manifest = fs.readFileSync(path.join(PACKAGE_DIR, 'oshal-app.yaml'), 'utf8');
    const mount = manifest.slice(manifest.indexOf('\nroutes:'));
    expect(mount).toContain('module: routes/ocean-lab-routes.js');
    expect(mount).toContain('factory: createOceanLabRoutes');
    expect(mount).toContain(`mountPath: ${MOUNT}`);
    expect(mount).toContain('requiresAuth: true');
    expect(mount).toContain('requiresContext: true');
  });
});

describe('ocean-lab surfaces are reachable', () => {
  it('serves each page as HTML', async () => {
    for (const route of [`${MOUNT}/app`, `${MOUNT}/harvest-console`, `${MOUNT}/blade-studio`]) {
      const res = await get(authed, route);
      expect(res.status, route).toBe(200);
      expect(res.contentType, route).toMatch(/text\/html/);
      expect(res.body, route).toContain('<html');
    }
  });

  it('serves every engine script as JavaScript from all three mounts a surface can probe', async () => {
    const routes = [
      ...SCRIPTS.map((f) => `${MOUNT}/assets/${f}`),
      `${MOUNT}/harvest/assets/harvest-console.js`,
      `${MOUNT}/rotor/assets/blade-studio.js`,
      `${MOUNT}/rotor/assets/blade-studio-gl.js`,
    ];
    for (const route of routes) {
      const res = await get(authed, route);
      expect(res.status, route).toBe(200);
      expect(res.contentType, route).toMatch(/javascript/);
      expect(res.body.length, route).toBeGreaterThan(1000);
    }
  });

  it('routes every /api/ocean-lab path the shipped surfaces actually reference', async () => {
    const referenced = pathsReferencedBySurfaces();
    // A near-empty set means the package's URL rewrite silently failed and the surfaces are still
    // pointed at the retired kernel mounts.
    expect(referenced.length, referenced.join(',')).toBeGreaterThan(3);
    for (const routePath of referenced) {
      const res = await get(authed, routePath);
      if (res.status !== 404) continue;
      // Only a POST-only route may 404 a GET. Prove it is one: an UNMOUNTED path 404s both ways.
      const post = await realFetch(`${authed.origin}${routePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(post.status, `${routePath} is mounted for neither GET nor POST`).not.toBe(404);
    }
  });
});

describe('ocean-lab surfaces are guarded', () => {
  it('refuses an anonymous caller on every page, script and data route', async () => {
    const routes = [
      `${MOUNT}/app`,
      `${MOUNT}/harvest-console`,
      `${MOUNT}/blade-studio`,
      `${MOUNT}/capabilities`,
      `${MOUNT}/harvest/sites`,
      ...SCRIPTS.map((f) => `${MOUNT}/assets/${f}`),
      `${MOUNT}/harvest/assets/harvest-console.js`,
      `${MOUNT}/rotor/assets/blade-studio.js`,
    ];
    for (const route of routes) {
      const res = await get(anon, route);
      expect(res.status, route).toBe(401);
      // The guard runs BEFORE any disk read, so no file bytes may appear in the 401 body.
      expect(res.body, route).toBe(JSON.stringify({ error: 'unauthorized' }));
    }
  });

  it('does not resolve a traversal, normalised or raw', async () => {
    const normalised = await get(authed, `${MOUNT}/assets/../../../.env`);
    expect(normalised.status).not.toBe(200);

    // Raw dot segments reach the router verbatim. Express must fail to MATCH a route rather than
    // normalise them into a file read, so the only acceptable answer is its own 404 page.
    const raw = await rawGet(authed, `${MOUNT}/assets/../../../.env`);
    expect(raw.status).toBe(404);
    expect(raw.body).toContain('Cannot GET');

    const encoded = await rawGet(authed, `${MOUNT}/assets/..%2f..%2f..%2f.env`);
    expect(encoded.status).not.toBe(200);
  });
});
