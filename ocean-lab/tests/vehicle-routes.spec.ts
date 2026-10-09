/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the explorer record over REAL loopback HTTP, mounted exactly as the manifest
 *                     |                             | mounts the package (one `app.use('/api/ocean-lab', requiresAuth, factory)` with the AppContext),
 *                     |                             | on the SQL-dispatching store double (tests/vehicle-pool-double.ts; the RLS itself is proven on a
 *                     |                             | real PostgreSQL in vehicle-rls.spec.ts). Seed at concept and idempotent; evaluate to sized with
 *                     |                             | the five-row table, the year and the engine fingerprints; a stop-angle or tether change drops
 *                     |                             | the stage and a re-evaluation MOVES the table; air refused as medium_property_unavailable:
 *                     |                             | freeSurface and vacuum as model_not_valid_in_medium, with nothing recorded; an undeclared model
 *                     |                             | fails closed; the embodied hull drop (a fixture captured from embodied's own engine) recorded as
 *                     |                             | a run that never sizes the record, and refused when it lacks its schema, medium id or engine
 *                     |                             | fingerprints or poses as this lab's evaluation; a stored run without fingerprints withheld by
 *                     |                             | name; another owner sees nothing; 401 without a caller, 503 without a store or an engine
 *                     |                             | fingerprint; and the live acceptance script driven, unchanged, against this router.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The evaluate case expected the run's packageVersion as the literal 1.2.0, while the route stamps
 *                     |                             | it from the mounted package's real oshal-app.yaml, so the 1.2.1 bump turned the case red. The
 *                     |                             | expected version is now read from that manifest (MANIFEST_VERSION, asserted to be a real
 *                     |                             | x.y.z first), so a later version bump no longer breaks the fingerprint assertion.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createOceanLabRoutes } from '../src-routes/ocean-lab-routes';
import { VehiclePoolDouble } from './vehicle-pool-double';
import { bearerApi, runExplorerAcceptance } from './explorer-live-acceptance.mjs';

const PACKAGE_DIR = path.resolve(__dirname, '..');
/** The mounted package's manifest version: the evaluate route stamps runs with it, so the expectation follows the manifest, not a literal. */
const MANIFEST_VERSION = /^version:\s*(\d+\.\d+\.\d+)\s*$/m.exec(fs.readFileSync(path.join(PACKAGE_DIR, 'oshal-app.yaml'), 'utf8'))?.[1];
const HULL_DROP = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'embodied-hull-drop-air.json'), 'utf8'));
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

interface Fixture { server: Server; origin: string; pool: VehiclePoolDouble }

/** Boot the package mount on loopback with a store double, and embodied's hull route as a double serving the captured answer. */
async function start(ctx: { appPackageDir: string; pool?: VehiclePoolDouble | null }): Promise<Fixture> {
  const pool = ctx.pool === undefined ? new VehiclePoolDouble() : ctx.pool;
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/embodied/physics/hull', requiresAuthStub, (_req, res) => { res.json(HULL_DROP); });
  app.use('/api/ocean-lab', requiresAuthStub, createOceanLabRoutes({ appPackageDir: ctx.appPackageDir, ...(pool ? { pool } : {}) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, pool: pool as VehiclePoolDouble };
}

/** One JSON call as a named caller (or anonymous). */
async function call(f: Fixture, method: string, route: string, body?: unknown, sub: string | null = OWNER): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sub) headers['x-test-sub'] = sub;
  const res = await fetch(`${f.origin}/api/ocean-lab/vehicles${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

let f: Fixture;
let id = '';
beforeAll(async () => { f = await start({ appPackageDir: PACKAGE_DIR }); });
afterAll(async () => { await new Promise((resolve) => f.server.close(resolve)); });

describe('the explorer record over loopback HTTP', () => {
  it('refuses every record route without a caller', async () => {
    for (const [method, route] of [['GET', ''], ['GET', '/kinds'], ['POST', '/explorer/seed'], ['GET', `/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`]] as const) {
      expect((await call(f, method, route, method === 'POST' ? {} : undefined, null)).status, `${method} ${route}`).toBe(401);
    }
  });

  it('publishes the kind: eight limit rows, the stages, the fabricable sentence, the media and the envelopes', async () => {
    const r = await call(f, 'GET', '/kinds');
    expect(r.status).toBe(200);
    expect(r.json.kinds[0].id).toBe('wave-explorer');
    expect(r.json.kinds[0].limits).toHaveLength(8);
    expect(r.json.stages).toEqual(['concept', 'sized', 'parts-complete', 'fabricable', 'built']);
    expect(r.json.fabricable).toMatch(/does not mean the machine is safe to build, fly or wet/);
    expect(r.json.media.map((m: { id: string }) => m.id)).toEqual(['vacuum', 'air', 'seawater']);
    expect(r.json.forceModels.models[0]).toMatchObject({ id: 'wave-propulsion', validIn: ['seawater', 'air'], declared: true });
    expect(r.json.seed.provenance['site.seaStates.periodS'].source).toBe('reconstructed');
  });

  it('seeds the Explorer at concept with its limits, and a second seed is the same record', async () => {
    const r = await call(f, 'POST', '/explorer/seed', {});
    expect(r.status).toBe(201);
    expect(r.json.seeded).toBe(true);
    expect(r.json.stage.stage).toBe('concept');
    expect(r.json.limits.map((l: { status: string }) => l.status)).toEqual(Array(8).fill('open'));
    expect(r.json.stage.openLimits).toHaveLength(8);
    expect(r.json.runs).toEqual([]);
    id = r.json.vehicle.vehicleId;
    const again = await call(f, 'POST', '/explorer/seed', {});
    expect(again.status).toBe(200);
    expect(again.json.seeded).toBe(false);
    expect(again.json.vehicle.vehicleId).toBe(id);
    expect((await call(f, 'POST', '/explorer/seed', { name: '' })).status).toBe(400);
  });

  it('evaluates in seawater to sized: the five-row table, the year and the engine fingerprints on the run', async () => {
    const r = await call(f, 'POST', `/${id}/evaluate`, {});
    expect(r.status).toBe(201);
    expect(r.json.stage).toMatchObject({ stage: 'sized', sizedBy: 1, next: 'parts-complete' });
    const run = r.json.recorded.run;
    expect(run).toMatchObject({ sequence: 1, mediumId: 'seawater', plant: 'ocean-lab.wave-propulsion' });
    expect(MANIFEST_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(run.engineFingerprints).toMatchObject({ package: 'ocean-lab', packageVersion: MANIFEST_VERSION, engine: { id: 'ocean-lab.wave-propulsion', version: '1.0.0' } });
    expect(run.engineFingerprints.routesBuildHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.result.schema).toBe('oshal.run-result/1');
    expect(run.result.seaStates.map((s: { id: string }) => s.id)).toEqual(['flat', 'calm', 'light-swell', 'moderate', 'rough']);
    expect(Math.round(run.result.figures.kmPerYear)).toBe(7444);
    expect(run.result.figures.underWayFraction).toBeCloseTo(0.65, 9);
  });

  it('a stop-angle change drops the stage to concept, and re-evaluating MOVES the table and the year; so does the tether', async () => {
    const before = (await call(f, 'GET', `/${id}`)).json;
    const vector = JSON.parse(JSON.stringify(before.vehicle.designVector));
    vector.wings.stopAngleDeg = 25;
    const patched = await call(f, 'PATCH', `/${id}/design`, { designVector: vector });
    expect(patched.status).toBe(200);
    expect(patched.json.stage.stage).toBe('concept');
    expect(patched.json.stage.because).toMatch(/vector changed/);
    const second = await call(f, 'POST', `/${id}/evaluate`, { mediumId: 'seawater' });
    expect(second.json.stage).toMatchObject({ stage: 'sized', sizedBy: 2 });
    const [r1, r2] = second.json.runs;
    expect(r2.result.figures.kmPerYear).toBeGreaterThan(r1.result.figures.kmPerYear);
    expect(r2.result.seaStates[3].speedMs).not.toBe(r1.result.seaStates[3].speedMs);
    vector.tether.lengthM = 6;
    await call(f, 'PATCH', `/${id}/design`, { designVector: vector });
    const third = await call(f, 'POST', `/${id}/evaluate`, {});
    expect(third.json.recorded.run.result.figures.kmPerYear).toBeLessThan(r2.result.figures.kmPerYear);
  });

  it('refuses air as medium_property_unavailable: freeSurface and vacuum as model_not_valid_in_medium, recording nothing', async () => {
    const runsBefore = f.pool.runs.length;
    const air = await call(f, 'POST', `/${id}/evaluate`, { mediumId: 'air' });
    expect(air.status).toBe(422);
    expect(air.json).toMatchObject({ error: 'medium_property_unavailable', refusal: 'medium_property_unavailable: freeSurface', property: 'freeSurface', medium: 'air' });
    const vacuum = await call(f, 'POST', `/${id}/evaluate`, { mediumId: 'vacuum' });
    expect(vacuum.status).toBe(422);
    expect(vacuum.json.refusal).toBe('model_not_valid_in_medium: wave-propulsion, vacuum');
    expect((await call(f, 'POST', `/${id}/evaluate`, { mediumId: 'helium' })).status).toBe(400);
    expect(f.pool.runs.length).toBe(runsBefore);
  });

  it('holds a model to its envelope by name; an undeclared model fails closed to seawater', async () => {
    expect((await call(f, 'GET', '/force-models/wave-propulsion/in/seawater')).status).toBe(200);
    expect((await call(f, 'GET', '/force-models/wave-propulsion/in/vacuum')).json.error).toBe('model_not_valid_in_medium');
    expect((await call(f, 'GET', '/force-models/surf-ski/in/seawater')).json.envelope.declared).toBe(false);
    expect((await call(f, 'GET', '/force-models/surf-ski/in/air')).json.refusal).toBe('model_not_valid_in_medium: surf-ski, air');
  });

  it('records the embodied hull drop as data — a run with its medium id and fingerprints that never sizes the record', async () => {
    const stageBefore = (await call(f, 'GET', `/${id}`)).json.stage;
    const r = await call(f, 'POST', `/${id}/runs`, { run: HULL_DROP });
    expect(r.status).toBe(201);
    expect(r.json.recorded.run).toMatchObject({ mediumId: 'air', plant: 'embodied:analytic' });
    expect(r.json.recorded.run.engineFingerprints).toEqual(HULL_DROP.engine);
    expect(r.json.stage.sizedBy).toBe(stageBefore.sizedBy);
    expect(r.json.runs.at(-1).result.fall.gMagnitudeMps2).toBe(9.81);
  });

  it('refuses a foreign run without its schema, medium id or fingerprints, and one that poses as this lab\'s evaluation', async () => {
    const without = (edit: (run: any) => void): unknown => { const run = JSON.parse(JSON.stringify(HULL_DROP)); edit(run); return { run }; };
    const noEngine = await call(f, 'POST', `/${id}/runs`, without((run) => { delete run.engine; }));
    expect(noEngine.status).toBe(422);
    expect(noEngine.json.missing).toEqual(expect.arrayContaining(['engine.packageVersion', 'engine.routesBuildHash', 'engine.package']));
    expect((await call(f, 'POST', `/${id}/runs`, without((run) => { delete run.medium; }))).json.missing).toContain('medium.id');
    expect((await call(f, 'POST', `/${id}/runs`, without((run) => { run.schema = 'other/1'; }))).json.missing).toContain('schema');
    const poses = await call(f, 'POST', `/${id}/runs`, without((run) => { run.engine.package = 'ocean-lab'; }));
    expect(poses.json.error).toBe('run_poses_as_evaluation');
    expect((await call(f, 'POST', `/${id}/runs`, {})).status).toBe(400);
  });

  it('withholds a stored run that cannot name its medium and engine, by name, and lets it size nothing', async () => {
    f.pool.runs.push({ run_id: 'legacy-run', vehicle_id: id, owner_sub: OWNER, sequence: 99, medium_id: 'seawater', plant: 'ocean-lab.wave-propulsion', vector_fingerprint: 'f'.repeat(64), engine_fingerprints: { packageVersion: 'unknown' }, result: { figures: {} }, created_at: new Date().toISOString() });
    const r = await call(f, 'GET', `/${id}`);
    expect(r.json.runs.map((run: { sequence: number }) => run.sequence)).not.toContain(99);
    expect(r.json.withheld).toEqual([expect.objectContaining({ sequence: 99, missing: ['engine.packageVersion', 'engine.routesBuildHash'] })]);
    f.pool.runs = f.pool.runs.filter((run) => run.run_id !== 'legacy-run');
  });

  it('refuses an invalid design vector by naming the problem', async () => {
    const r = await call(f, 'PATCH', `/${id}/design`, { designVector: { wings: { count: 99 } } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('invalid_design_vector');
    expect(r.json.problems.join(' ')).toMatch(/wings\.count/);
  });

  it('another owner sees none of it, and cannot read, change, evaluate, record on or delete it', async () => {
    expect((await call(f, 'GET', '', undefined, STRANGER)).json.vehicles).toEqual([]);
    expect((await call(f, 'GET', `/${id}`, undefined, STRANGER)).status).toBe(404);
    const vector = (await call(f, 'GET', `/${id}`)).json.vehicle.designVector;
    expect((await call(f, 'PATCH', `/${id}/design`, { designVector: vector }, STRANGER)).status).toBe(404);
    expect((await call(f, 'POST', `/${id}/evaluate`, {}, STRANGER)).status).toBe(404);
    expect((await call(f, 'POST', `/${id}/runs`, { run: HULL_DROP }, STRANGER)).status).toBe(404);
    expect((await call(f, 'DELETE', `/${id}`, undefined, STRANGER)).status).toBe(404);
    expect((await call(f, 'GET', `/${id}`)).status).toBe(200);
  });

  it('deletes the vehicle with its limits and runs', async () => {
    expect((await call(f, 'DELETE', `/${id}`)).status).toBe(204);
    expect((await call(f, 'GET', `/${id}`)).status).toBe(404);
    expect(f.pool.limits.filter((l) => l.vehicle_id === id)).toEqual([]);
    expect(f.pool.runs.filter((r) => r.vehicle_id === id)).toEqual([]);
  });
});

describe('the record refuses rather than answers unlabelled', () => {
  it('without a store: 503 record_store_unavailable', async () => {
    const bare = await start({ appPackageDir: PACKAGE_DIR, pool: null });
    try {
      const r = await call(bare, 'GET', '');
      expect(r.status).toBe(503);
      expect(r.json.error).toBe('record_store_unavailable');
    } finally { await new Promise((resolve) => bare.server.close(resolve)); }
  });

  it('when the package cannot read its own version: evaluate is 503 run_unfingerprinted and records nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-lab-noversion-'));
    const noVersion = await start({ appPackageDir: dir });
    try {
      const seeded = await call(noVersion, 'POST', '/explorer/seed', {});
      const r = await call(noVersion, 'POST', `/${seeded.json.vehicle.vehicleId}/evaluate`, {});
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ error: 'run_unfingerprinted', missing: ['packageVersion'] });
      expect(noVersion.pool.runs).toEqual([]);
    } finally {
      await new Promise((resolve) => noVersion.server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the live acceptance script, driven unchanged against this router', () => {
  it('passes, and leaves nothing behind', async () => {
    const own = await start({ appPackageDir: PACKAGE_DIR });
    try {
      const verdict = await runExplorerAcceptance({ api: bearerApi(own.origin, 'owner-token'), tag: 'spec' });
      expect(verdict.state, verdict.detail).toBe('pass');
      expect(verdict.evidence.cleanup).toBe('deleted');
      expect(verdict.evidence.runs).toEqual(['1:ocean-lab.wave-propulsion:seawater', '2:ocean-lab.wave-propulsion:seawater', '3:embodied:analytic:air']);
      expect(own.pool.vehicles).toEqual([]);
      expect(own.pool.runs).toEqual([]);
    } finally { await new Promise((resolve) => own.server.close(resolve)); }
  });

  it('fails when the stage does not drop — the script is a real check, not a formality', async () => {
    const own = await start({ appPackageDir: PACKAGE_DIR });
    try {
      const api = bearerApi(own.origin, 'owner-token');
      const lying = async (method: string, route: string, body?: unknown) => {
        const r = await api(method, route, body);
        if (method === 'PATCH' && r.json?.stage) r.json.stage.stage = 'sized';
        return r;
      };
      const verdict = await runExplorerAcceptance({ api: lying, tag: 'mutant' });
      expect(verdict.state).toBe('fail');
      expect(verdict.detail).toMatch(/did not drop/);
      expect(verdict.evidence.cleanup).toBe('deleted');
    } finally { await new Promise((resolve) => own.server.close(resolve)); }
  });
});
