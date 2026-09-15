/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the actual compiled Create project router with real Express/Sharp and explicit fixture-only verified actors.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Route brand.* permissions to the brand resource adapter, as the runtime routes each permission to its catalog resource.
 */
import { createRequire } from 'node:module';
import Module from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
export const requireCore = createRequire(resolve(coreRoot, 'package.json'));
export const express = requireCore('express'), sharp = requireCore('sharp');
const dependencies = new Map([['express', express], ['multer', requireCore('multer')], ['sharp', sharp]]);
const requirePackage = createRequire(resolve(packageRoot, 'routes/create-project-routes.js'));
const original = Module._load;
let createCreateProjectRoutes;
try {
  Module._load = function(request, parent, main) { return dependencies.has(request) ? dependencies.get(request) : original.call(this, request, parent, main); };
  ({ createCreateProjectRoutes } = requirePackage('./create-project-routes.js'));
} finally { Module._load = original; }

export const ISSUER = 'https://create-identity.fixture.test';
export const actors = {
  alice: { issuer: ISSUER, sub: 'alice', isActive: true, isSwarmAdmin: false },
  bob: { issuer: ISSUER, sub: 'bob', isActive: true, isSwarmAdmin: false },
  collision: { issuer: 'https://other-create.fixture.test', sub: 'alice', isActive: true, isSwarmAdmin: false },
  admin: { issuer: ISSUER, sub: 'admin', isActive: true, isSwarmAdmin: true },
  inactive: { issuer: ISSUER, sub: 'inactive', isActive: false, isSwarmAdmin: false },
};
export function document(name = 'Synthetic project', images = {}, layers = []) {
  return { version: 1, name, width: 320, height: 240, background: '#ffffff', images, layers };
}
export function input(name = 'Synthetic project', images = {}, layers = []) { return { title: name, document: document(name, images, layers) }; }

/** These headers exist only on this loopback fixture; production code only sees the injected context actor. */
export async function startApi(t, pool, options = {}) {
  const dataRoot = await mkdtemp(resolve(tmpdir(), 'create-project-assets-'));
  const scope = new AsyncLocalStorage(), resources = new Map();
  const state = { denied: new Set(options.denied || []), decisions: [], actor: undefined };
  const authorization = {
    currentActor: () => scope.getStore(), registerResource: (name, adapter) => resources.set(name, adapter),
    authorize: async operation => {
      state.decisions.push(operation.permission);
      const actor = scope.getStore();
      const resource = resources.get(operation.permission.startsWith('brand.') ? 'brand' : 'projects');
      const own = actor && resource && await resource.authorize({ actor, operation, grant: { scope: 'own' } });
      return { allowed: !!own && !state.denied.has(operation.permission) };
    },
  };
  const app = express();
  app.use((req, _res, next) => scope.run(actors[req.header('x-fixture-actor') || 'alice'], next));
  app.use('/api/create', createCreateProjectRoutes({ pool, authorization, appPackageDir: packageRoot }, { dataRoot }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(dataRoot, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body, actor = 'alice', headers = {}) => {
    const response = await fetch(origin + '/api/create' + path, { method,
      headers: { 'x-fixture-actor': actor, ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    const text = await response.text(); let result;
    try { result = JSON.parse(text); } catch { result = text; }
    return { status: response.status, headers: response.headers, body: result };
  };
  return { call, origin, state, dataRoot, resources };
}

/** Strict empty read-store seam: refuse every business mutation and record actual transaction SQL. */
export function emptyPool() {
  const queries = [], releases = [];
  return { queries, releases, connect: async () => ({
    query: async (sql, values = []) => {
      queries.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK|SET|SELECT set_config)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^SELECT/.test(sql) && /FROM create_/.test(sql)) {
        if (!/owner_issuer=\$1/.test(sql) || !/owner_sub=\$2/.test(sql)) throw new Error('Fixture refused unqualified owner query');
        return { rows: /COUNT/.test(sql) ? [{ count: 0 }] : [], rowCount: 0 };
      }
      throw new Error('Fixture refused unexpected SQL');
    }, release: discard => releases.push(discard),
  }) };
}

export async function imageBody() {
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#228899' } }).png().toBuffer();
  const form = new FormData(); form.append('image', new Blob([bytes], { type: 'image/png' }), 'synthetic.png'); return form;
}
