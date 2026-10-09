/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the explorer's parts routes over REAL loopback HTTP, mounted as the manifest
 *                     |                             | mounts the package, on the SQL-dispatching store double: 401 without a caller; at concept the
 *                     |                             | parts model is derived and the budget is unsized; once sized, eleven watertight parts, the budget
 *                     |                             | OPEN on the unpublished masses and the stage refusing parts-complete by name; one part's exact
 *                     |                             | CAD Studio body with its D8 portable object in `source`; the generated design document; another
 *                     |                             | owner sees none of it; a stored vector that no longer validates is 409; and the parts live
 *                     |                             | acceptance script driven, unchanged, against this router with a CAD Studio double that validates
 *                     |                             | every posted body with CAD Studio's own compiled contract — pass, degraded when CAD Studio is not
 *                     |                             | installed, and fail when a feature is refused. The OCCT build itself is proven only live.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createOceanLabRoutes } from '../src-routes/ocean-lab-routes';
import { loftMassProperties, portableObjectProblems, revolveVolumeMm3, wingProgram, explorerSeed, type LoftSection } from '../src-routes/engine/vehicle';
import { VehiclePoolDouble } from './vehicle-pool-double';
import { bearerApi } from './explorer-live-acceptance.mjs';
import { runExplorerPartsAcceptance } from './explorer-parts-live-acceptance.mjs';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const cadContract = createRequire(__filename)(path.join(PACKAGE_DIR, '..', 'cad-studio', 'routes', 'feature-contract.js'));
const OWNER = 'owner-sub';
const STRANGER = 'stranger-sub';
const TOKENS: Record<string, string> = { 'owner-token': OWNER };

/** requiresAuth mirroring the framework: an oidc session or a bearer PAT names the caller, otherwise 401. */
function requiresAuthStub(req: Request, res: Response, next: NextFunction): void {
  const sub = req.header('x-test-sub') || TOKENS[(req.header('authorization') || '').replace(/^Bearer /, '')];
  if (!sub) { res.status(401).json({ error: 'unauthorized' }); return; }
  (req as unknown as { oidc: unknown }).oidc = { isAuthenticated: () => true, user: { sub } };
  next();
}

/** @description What the CAD Studio double measures of a posted program: the lab's own integrator, standing in for OCCT. */
function measure(body: { base: Record<string, number>; features: Array<{ type: string; params: Record<string, unknown> }>; settings?: { densityGcm3?: number } }): { volumeMm3: number; massG: number } {
  const density = body.settings?.densityGcm3 ?? 1.24;
  const loft = body.features.find((f) => f.type === 'loft');
  const revolve = body.features.find((f) => f.type === 'revolve');
  let volumeMm3 = Math.PI * (body.base.diameter / 2) ** 2 * body.base.height;
  if (loft) volumeMm3 = loftMassProperties(loft.params.sections as LoftSection[], 1e-6).volumeMm3;
  if (revolve) volumeMm3 = revolveVolumeMm3((revolve.params.points as number[][]).slice(1, -1));
  return { volumeMm3, massG: (volumeMm3 / 1000) * density };
}

/** @description A CAD Studio double: validates every body with CAD Studio's compiled contract, "builds" it, deletes it. */
function cadStudioDouble(options: { installed: boolean; refuse?: string }): express.Router {
  const router = express.Router();
  const models = new Map<string, unknown>();
  if (!options.installed) return router;
  router.post('/models', (req, res) => {
    cadContract.validateBase(req.body.base);
    cadContract.validateFeatureList(req.body.features);
    const id = `00000000-0000-4000-8000-${String(models.size + 1).padStart(12, '0')}`;
    const featureStatus = req.body.features.map((f: { id: string; type: string }, index: number) => ({ id: f.id, index, ok: f.type !== options.refuse, ...(f.type === options.refuse ? { error: 'kernel refused' } : {}) }));
    const model = { model_id: id, title: req.body.title, revision: 1, source: req.body.source, feature_status: featureStatus, report: { valid: true, ...measure(req.body) } };
    models.set(id, model);
    res.status(201).json({ model, build: { ok: true, ms: 1 } });
  });
  router.get('/models/:id', (req, res) => { const m = models.get(req.params.id); if (m) res.json({ model: m }); else res.status(404).json({ error: 'model_not_found' }); });
  router.delete('/models/:id', (req, res) => { if (models.delete(req.params.id)) res.status(204).end(); else res.status(404).json({ error: 'model_not_found' }); });
  return router;
}

interface Fixture { server: Server; origin: string; pool: VehiclePoolDouble }

/** Boot the package mount on loopback with a store double and a CAD Studio double. */
async function start(cad: { installed: boolean; refuse?: string } = { installed: true }): Promise<Fixture> {
  const pool = new VehiclePoolDouble();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/cad-studio', requiresAuthStub, cadStudioDouble(cad));
  app.use('/api/ocean-lab', requiresAuthStub, createOceanLabRoutes({ appPackageDir: PACKAGE_DIR, pool }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, pool };
}

/** One call as a named caller (or anonymous); the text is kept for the markdown route. */
async function call(f: Fixture, method: string, route: string, body?: unknown, sub: string | null = OWNER): Promise<{ status: number; json: any; text: string; type: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sub) headers['x-test-sub'] = sub;
  const res = await fetch(`${f.origin}/api/ocean-lab/vehicles${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
}

const close = (f: Fixture): Promise<void> => new Promise((resolve) => { f.server.close(() => resolve()); });

let f: Fixture;
let id = '';
beforeAll(async () => { f = await start(); });
afterAll(async () => { await close(f); });

describe('the explorer parts routes over loopback HTTP', () => {
  it('refuses the parts routes without a caller', async () => {
    const any = `/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`;
    for (const route of [`${any}/parts`, `${any}/parts/wing`, `${any}/design.md`]) expect((await call(f, 'GET', route, undefined, null)).status, route).toBe(401);
  });

  it('derives the parts model at concept, with the budget unsized', async () => {
    id = (await call(f, 'POST', '/explorer/seed', {})).json.vehicle.vehicleId;
    const r = await call(f, 'GET', `/${id}/parts`);
    expect(r.status).toBe(200);
    expect(r.json.stage.stage).toBe('concept');
    expect(r.json.watertightParts).toBe(11);
    expect(r.json.budget.status).toBe('unsized');
    expect(r.json.fabricable).toMatch(/does not mean the machine is safe to build, fly or wet/);
  });

  it('once sized: eleven parts, the budget OPEN on unpublished masses, and parts-complete refused by name', async () => {
    expect((await call(f, 'POST', `/${id}/evaluate`, {})).status).toBe(201);
    const r = await call(f, 'GET', `/${id}/parts`);
    expect(r.json.stage).toMatchObject({ stage: 'sized', next: 'parts-complete' });
    expect(r.json.stage.blockedBy.join(' ')).toMatch(/parts model is incomplete: 15 bought.*displacement budget is OPEN/);
    expect(r.json.budget).toMatchObject({ status: 'open', mediumId: 'seawater', sizedBy: 1 });
    expect(r.json.printed.map((p: { id: string }) => p.id)).toEqual(['float', 'sub-body', 'wing', 'rudder', 'spindle-blade']);
    expect(r.json.printed[0].program).toBe('cylinder 14.014 x 560 mm; revolve');
    expect(r.json.bought).toHaveLength(16);
    expect(r.json.bought.find((b: { id: string }) => b.id === 'solar-panel')).toMatchObject({ massEachKg: null, approxUsdEach: null, carriedBy: 'float', opensInCadStudio: false });
    expect(r.json.problems).toHaveLength(3);
    expect((await call(f, 'GET', `/${id}`)).json.stage.blockedBy).toEqual(r.json.stage.blockedBy);
  });

  it('serves one part with its portable object and the exact body to post to CAD Studio', async () => {
    const r = await call(f, 'GET', `/${id}/parts/wing`);
    expect(r.status).toBe(200);
    const program = wingProgram(explorerSeed().designVector).program;
    expect(r.json.cadStudio).toMatchObject({ title: 'Wing — Explorer', base: program.base, features: program.features, settings: { densityGcm3: 1.27 } });
    expect(r.json.cadStudio.source).toMatchObject({ package: 'ocean-lab', kind: 'wave-explorer', vehicleId: id, partId: 'wing', qty: 4, material: 'PETG' });
    expect(portableObjectProblems(r.json.cadStudio.source.portableObject)).toEqual([]);
    expect(r.json.part.portableObject).toEqual(r.json.cadStudio.source.portableObject);
    expect(() => cadContract.validateFeatureList(r.json.cadStudio.features)).not.toThrow();
    const tether = await call(f, 'GET', `/${id}/parts/umbilical`);
    expect(tether.json.cadStudio.settings).toBeUndefined();
    expect(tether.json.cadStudio.source.material).toBeNull();
    const none = await call(f, 'GET', `/${id}/parts/solar-panel`);
    expect(none.status).toBe(404);
    expect(none.json.parts).toEqual(['float', 'sub-body', 'wing', 'rudder', 'spindle-blade', 'umbilical']);
  });

  it('generates the design document from the record', async () => {
    const r = await call(f, 'GET', `/${id}/design.md`);
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/text\/markdown/);
    expect(r.text).toMatch(/^# Explorer — design/);
    expect(r.text).toMatch(/fabricable means the files are complete and self-consistent/);
    expect(r.text).toMatch(/11 watertight parts/);
  });

  it('another owner sees none of it', async () => {
    for (const route of [`/${id}/parts`, `/${id}/parts/wing`, `/${id}/design.md`]) expect((await call(f, 'GET', route, undefined, STRANGER)).status, route).toBe(404);
  });

  it('a stored vector that no longer validates derives no parts: 409 by name', async () => {
    const row = f.pool.vehicles.find((v) => v.vehicle_id === id) as Record<string, unknown>;
    const saved = row.design_vector;
    row.design_vector = { wings: { count: 99 } };
    try {
      const r = await call(f, 'GET', `/${id}/parts`);
      expect(r.status).toBe(409);
      expect(r.json.error).toBe('stored_vector_invalid');
    } finally { row.design_vector = saved; }
  });
});

describe('the parts live acceptance script, driven unchanged against this router', () => {
  it('passes with every part built by the CAD Studio double, and leaves nothing behind', async () => {
    const own = await start({ installed: true });
    try {
      const verdict = await runExplorerPartsAcceptance({ api: bearerApi(own.origin, 'owner-token'), tag: 'spec' });
      expect(verdict.state, verdict.detail).toBe('pass');
      expect(verdict.evidence.built).toHaveLength(6);
      expect(verdict.evidence.cleanup).toBe('deleted');
      expect(own.pool.vehicles).toEqual([]);
    } finally { await close(own); }
  });

  it('is degraded, not passed, when CAD Studio is not installed', async () => {
    const own = await start({ installed: false });
    try {
      const verdict = await runExplorerPartsAcceptance({ api: bearerApi(own.origin, 'owner-token'), tag: 'spec' });
      expect(verdict.state).toBe('degraded');
      expect(verdict.evidence.cleanup).toBe('deleted');
    } finally { await close(own); }
  });

  it('fails when CAD Studio refuses a feature: a build that skipped the loft is not a part', async () => {
    const own = await start({ installed: true, refuse: 'loft' });
    try {
      const verdict = await runExplorerPartsAcceptance({ api: bearerApi(own.origin, 'owner-token'), tag: 'spec' });
      expect(verdict.state).toBe('fail');
      expect(verdict.detail).toMatch(/refused wing feature/);
      expect(verdict.evidence.cleanup).toBe('deleted');
    } finally { await close(own); }
  });
});
