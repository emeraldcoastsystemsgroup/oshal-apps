/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S4's guard. The record's engine is driven directly —
 *                     |                             | the reference design read from the committed files (every
 *                     |                             | artifact hashed, the BOM total, the as-built ledger), the budget
 *                     |                             | check RED at +274.3 g, the kind's limit rows with a kind that
 *                     |                             | declares none refused at load, the stage function dropping a
 *                     |                             | changed vector back to concept, the force-model envelopes
 *                     |                             | refusing by name with an undeclared model failing closed — and
 *                     |                             | then the routes over real loopback HTTP (express from the
 *                     |                             | framework checkout, the auth wrapper as the manifest mounts it,
 *                     |                             | a SQL-dispatching in-memory pool double): seed, read, change the
 *                     |                             | vector, another owner's 404, the caller gate's 401, and an
 *                     |                             | evaluation that cannot name its engine withheld by name. The
 *                     |                             | owner RLS boundary itself is proven against a real PostgreSQL
 *                     |                             | in aero-vehicle-rls.spec.ts, not here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | D5 at the seed: a package dir with no manifest, one whose
 *                     |                             | version is the placeholder 'unknown', and one with a real
 *                     |                             | version but no engine tree each answer 503
 *                     |                             | run_unfingerprinted naming what is missing, and the pool
 *                     |                             | holds no vehicle and no evaluation afterwards; the caller
 *                     |                             | gate still answers first. A stored row whose version is
 *                     |                             | the placeholder, or whose engine hash is null, is withheld
 *                     |                             | by name like a row with no version at all.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FABRICABLE_SENTENCE, FLOATER_KIND, STAGES, assertKindDeclared, asBuiltLedger, bomOptionATotalG, budgetCheck,
  designVectorFingerprint, firstEvaluation, floaterSeed, loadReferenceDesign, stageOf,
} from '../src-routes/floater-record';
import { DEFAULT_MEDIUM, MEDIA_KNOWN, MediumRefusal, envelopeFor, listEnvelopes, requireMediumProperties, requireModelValidIn } from '../src-routes/force-model-envelopes';
import { createAeroVehicleRoutes } from '../src-routes/vehicle-routes';
import { engineBuildHash } from '../src-routes/engine-build-hash';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const PORT = 42173;
const API = `http://127.0.0.1:${PORT}/api/aero-lab/vehicles`;

/** The auth wrapper exactly as the manifest mount applies it: a header names the caller, no header is 401. */
function requiresAuthDouble(req: Request, res: Response, next: NextFunction): void {
  const sub = req.headers['x-test-sub'];
  if (typeof sub === 'string' && sub) { (req as unknown as { oidc: unknown }).oidc = { user: { sub }, isAuthenticated: () => true }; next(); return; }
  res.status(401).json({ error: 'unauthorized' });
}

interface VehicleRow { vehicle_id: string; owner_sub: string; kind: string; name: string; design_vector: unknown; provenance: unknown; created_at: string; updated_at: string }
interface EvaluationRow { evaluation_id: string; vehicle_id: string; owner_sub: string; sequence: number; medium_id: string; vector_fingerprint: string; engine_fingerprints: unknown; result: unknown; created_at: string }

/** A SQL-dispatching in-memory pool answering exactly the statements vehicle-store.ts issues, owner-scoped like the real ones. */
function fakePool() {
  const vehicles: VehicleRow[] = [];
  const evaluations: EvaluationRow[] = [];
  const now = () => new Date().toISOString();
  return {
    vehicles, evaluations,
    async query(sql: string, p: unknown[] = []) {
      if (/^INSERT INTO aero_lab_vehicle \(/.test(sql)) {
        const row: VehicleRow = { vehicle_id: randomUUID(), owner_sub: String(p[0]), kind: String(p[1]), name: String(p[2]), design_vector: JSON.parse(String(p[3])), provenance: JSON.parse(String(p[4])), created_at: now(), updated_at: now() };
        vehicles.push(row); return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/FROM aero_lab_vehicle WHERE owner_sub = \$1 AND vehicle_id = \$2/.test(sql)) { const r = vehicles.filter((v) => v.owner_sub === p[0] && v.vehicle_id === p[1]); return { rows: r.map((v) => ({ ...v })), rowCount: r.length }; }
      if (/FROM aero_lab_vehicle WHERE owner_sub = \$1 AND kind = \$2 AND name = \$3/.test(sql)) { const r = vehicles.filter((v) => v.owner_sub === p[0] && v.kind === p[1] && v.name === p[2]); return { rows: r.map((v) => ({ ...v })), rowCount: r.length }; }
      if (/FROM aero_lab_vehicle WHERE owner_sub = \$1 ORDER BY/.test(sql)) { const r = vehicles.filter((v) => v.owner_sub === p[0]).slice(0, Number(p[1])); return { rows: r.map((v) => ({ ...v })), rowCount: r.length }; }
      if (/^UPDATE aero_lab_vehicle SET design_vector/.test(sql)) { const hit = vehicles.filter((v) => v.owner_sub === p[0] && v.vehicle_id === p[1]); hit.forEach((v) => { v.design_vector = JSON.parse(String(p[2])); v.updated_at = now(); }); return { rows: hit.map((v) => ({ ...v })), rowCount: hit.length }; }
      if (/^INSERT INTO aero_lab_vehicle_evaluation/.test(sql)) {
        const row: EvaluationRow = { evaluation_id: randomUUID(), vehicle_id: String(p[0]), owner_sub: String(p[1]), sequence: Number(p[2]), medium_id: String(p[3]), vector_fingerprint: String(p[4]), engine_fingerprints: JSON.parse(String(p[5])), result: JSON.parse(String(p[6])), created_at: now() };
        evaluations.push(row); return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/FROM aero_lab_vehicle_evaluation WHERE owner_sub = \$1 AND vehicle_id = \$2/.test(sql)) { const r = evaluations.filter((e) => e.owner_sub === p[0] && e.vehicle_id === p[1]).sort((a, b) => a.sequence - b.sequence); return { rows: r.map((e) => ({ ...e })), rowCount: r.length }; }
      throw new Error(`fake pool cannot run: ${sql.slice(0, 90)}`);
    },
  };
}

describe('the committed reference design, read as data', () => {
  const ref = loadReferenceDesign(PACKAGE_DIR);

  it('hashes every committed artifact and keeps every validator', () => {
    const names = ref.files.map((f) => f.name);
    for (const required of FLOATER_KIND.fabricationOutputs) expect(names, `${required} is a declared fabrication output`).toContain(required);
    expect(names).toContain('design_snapshot.json');
    for (const f of ref.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(ref.validators).sort()).toEqual(['verify_dxf_airfoil.json', 'verify_gore.json', 'verify_stl.json', 'verify_vehicle.json', 'verify_viewer.json']);
    expect((ref.validators['verify_stl.json'] as { 'wing.stl': { manifold: boolean } })['wing.stl'].manifold).toBe(true);
  });

  it('reads the two ledgers the budget compares, from BOM.csv and V2_CONFIG.md, and they agree with the snapshot', () => {
    expect(ref.bomOptionATotalG).toBe(1998.1);
    expect(ref.ledger.certifiedG).toBe(1998.1);
    expect(ref.ledger.asBuiltG).toBe(2272.4);
    expect(ref.ledger.deltaG).toBe(274.3);
    expect(ref.ledger.rows.length).toBe(9);
    expect(Math.round(Number(ref.snapshot.ledger_sum_kg) * 10000) / 10).toBe(1998.1);
  });

  it('refuses a BOM without the option-A total and a ledger table that does not sum', () => {
    expect(() => bomOptionATotalG('item,spec,qty,unit_mass_g,total_mass_g,source_hint\nwing,x,1,1,1,y\n')).toThrow(/no "TOTAL all-up, OPTION A pack" row/);
    const table = ['| item | v1 certified | as-built | delta |', '|---|---|---|---|', '| a | 1.0 | 2.0 | +1.0 |', '| **ALL-UP** | **1.0** | **3.0** | **+2.0** |'].join('\n');
    expect(() => asBuiltLedger(table)).toThrow(/rows sum to 1 \/ 2 g, the ALL-UP line says 1 \/ 3 g/);
    expect(() => asBuiltLedger('no table here')).toThrow(/as-built ledger table is absent/);
  });

  it('the budget check is RED at +274.3 g and blocks parts-complete — the point of S4', () => {
    const check = budgetCheck(ref.ledger);
    expect(check.status).toBe('red');
    expect(check.deltaG).toBe(274.3);
    expect(check.toleranceG).toBe(0);
    expect(check.blocks).toBe('parts-complete');
    expect(check.why).toMatch(/\+274\.3 g of mass nothing was sized for/);
    expect(budgetCheck({ ...ref.ledger, asBuiltG: 1998.1, deltaG: 0 }).status).toBe('green');
    expect(budgetCheck({ ...ref.ledger, asBuiltG: 1998.2, deltaG: 0.1 }).status).toBe('red');
  });
});

describe('the kind, its limits and the stage function', () => {
  it('the Floater kind declares its honest limits as rows, and a kind without them is refused at load', () => {
    expect(FLOATER_KIND.limits.map((l) => l.id)).toEqual(['nothing-built', 'ideal-chain', 'real-parts-heavier', 'vent-ballonet-undesigned', 'party-helium', 'no-structural-analysis']);
    expect(FLOATER_KIND.limits.filter((l) => l.blocking).length).toBe(5);
    for (const l of FLOATER_KIND.limits) { expect(l.sentence.length).toBeGreaterThan(20); expect(l.retireWhen.length).toBeGreaterThan(20); }
    expect(() => assertKindDeclared({ ...FLOATER_KIND, limits: [] })).toThrow(/declares no limits/);
    expect(() => assertKindDeclared({ ...FLOATER_KIND, requiredFigures: [] })).toThrow(/no required figures/);
    expect(() => assertKindDeclared({ ...FLOATER_KIND, forceModels: ['aeropolar', 'magic'] })).toThrow(/no declared envelope: magic/);
  });

  it('the stage is computed on read: sized at the evaluated vector, concept the moment the vector changes', () => {
    const ref = loadReferenceDesign(PACKAGE_DIR);
    const seed = floaterSeed(ref);
    const first = firstEvaluation(ref, seed, { packageVersion: '1.3.0', engineBuildHash: '0'.repeat(64) });
    expect(first.sequence).toBe(1);
    expect(first.mediumId).toBe('air');
    expect(first.vectorFingerprint).toBe(designVectorFingerprint(seed.designVector));
    expect(designVectorFingerprint({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(designVectorFingerprint({ a: [1, { c: 3, d: 2 }], b: 1 }));

    const sized = stageOf(FLOATER_KIND, seed.designVector, [first]);
    expect(sized.stage).toBe('sized');
    expect(sized.sizedBy).toBe(1);
    expect(sized.next).toBe('parts-complete');
    expect(sized.blockedBy.join('\n')).toMatch(/the mass budget is RED/);
    expect(sized.blockedBy.join('\n')).toMatch(/\+274\.3 g/);
    expect(sized.fabricable).toBe(FABRICABLE_SENTENCE);
    expect(sized.openLimits.length).toBe(6);

    const changed = { ...seed.designVector, planform: { ...(seed.designVector.planform as object), span_m: 2.6 } };
    const dropped = stageOf(FLOATER_KIND, changed, [first]);
    expect(dropped.stage).toBe('concept');
    expect(dropped.sizedBy).toBeNull();
    expect(dropped.because).toMatch(/1 evaluation\(s\) exist at other vectors/);

    const missingFigure = { ...first, result: { ...first.result, figures: { trim_V_ms: 3.8 } } };
    expect(stageOf(FLOATER_KIND, seed.designVector, [missingFigure]).stage).toBe('concept');
    expect(STAGES).toEqual(['concept', 'sized', 'parts-complete', 'fabricable', 'built']);
  });
});

describe('force-model envelopes (ADR-160 D7): declared as data, refused by name, undeclared fails closed', () => {
  it('the three air models are declared air-only and each carries its reason', () => {
    expect(listEnvelopes().map((e) => e.id)).toEqual(['aeropolar', 'aerosurface', 'solar']);
    for (const e of listEnvelopes()) { expect(e.validIn).toEqual(['air']); expect(e.declared).toBe(true); expect(e.why.length).toBeGreaterThan(60); }
    expect(MEDIA_KNOWN).toEqual(['vacuum', 'air', 'seawater']);
    expect(DEFAULT_MEDIUM).toBe('air');
  });

  it('model_not_valid_in_medium: aeropolar in seawater is refused by name, with the Reynolds reason', () => {
    expect(requireModelValidIn('aeropolar', 'air').declared).toBe(true);
    let refusal: MediumRefusal | null = null;
    try { requireModelValidIn('aeropolar', 'seawater'); } catch (e) { refusal = e as MediumRefusal; }
    expect(refusal).toBeInstanceOf(MediumRefusal);
    expect(refusal?.code).toBe('model_not_valid_in_medium');
    expect(refusal?.refusal).toBe('model_not_valid_in_medium: aeropolar, seawater');
    expect(refusal?.because).toMatch(/Reynolds/);
    expect(() => requireModelValidIn('solar', 'vacuum')).toThrow(/model_not_valid_in_medium: solar, vacuum/);
  });

  it('an undeclared model fails closed: the default medium only, every other refused by name', () => {
    const e = envelopeFor('something-nobody-declared');
    expect(e.declared).toBe(false);
    expect(e.validIn).toEqual(['air']);
    expect(requireModelValidIn('something-nobody-declared', 'air').declared).toBe(false);
    expect(() => requireModelValidIn('something-nobody-declared', 'seawater')).toThrow(/model_not_valid_in_medium: something-nobody-declared, seawater/);
    expect(() => requireModelValidIn('something-nobody-declared', 'vacuum')).toThrow(/fails closed/);
  });

  it('unknown_medium: a medium this lab does not know is named, never substituted', () => {
    expect(() => requireModelValidIn('aeropolar', 'helium')).toThrow(/unknown_medium: helium/);
  });

  it('medium_property_unavailable: a posted medium record lacking a required property is refused by name', () => {
    const air = { id: 'air', densityKgM3: 1.225, dynamicViscosityPaS: 1.78938e-5 };
    expect(requireMediumProperties('aeropolar', air)).toEqual({ densityKgM3: 1.225, dynamicViscosityPaS: 1.78938e-5 });
    expect(() => requireMediumProperties('aeropolar', { id: 'air', densityKgM3: 1.225, dynamicViscosityPaS: null })).toThrow(/medium_property_unavailable: dynamicViscosityPaS/);
    expect(() => requireMediumProperties('aeropolar', { id: 'seawater', densityKgM3: 1025, dynamicViscosityPaS: 0.00107625 })).toThrow(/model_not_valid_in_medium/);
  });
});

describe('the vehicle routes over loopback HTTP, owner-scoped behind the auth wrapper', () => {
  let server: Server;
  const pool = fakePool();
  const OWNER = { 'x-test-sub': 'floater-owner' };
  const STRANGER = { 'x-test-sub': 'someone-else' };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/aero-lab/vehicles', requiresAuthDouble, createAeroVehicleRoutes({ pool, appPackageDir: PACKAGE_DIR }));
    server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });
  });
  afterAll(async () => { await new Promise<void>((resolve) => server?.close(() => resolve())); });

  const call = async (route: string, init: RequestInit = {}, headers: Record<string, string> = OWNER) => {
    const res = await fetch(`${API}${route}`, { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> };
  };

  it('401s every route without a caller', async () => {
    for (const route of ['', '/kinds', '/force-models/aeropolar/in/air', `/${randomUUID()}`]) expect((await call(route, {}, {})).status, route).toBe(401);
    expect((await call('/floater/seed', { method: 'POST', body: '{}' }, {})).status).toBe(401);
  });

  it('publishes the kind with its limits, the stages, the fabricable sentence and the declared envelopes', async () => {
    const r = await call('/kinds');
    expect(r.status).toBe(200);
    expect(r.body.kinds[0].id).toBe('solar-dynastat');
    expect(r.body.kinds[0].limits.length).toBe(6);
    expect(r.body.fabricable).toBe(FABRICABLE_SENTENCE);
    expect(r.body.forceModels.models.map((m: { id: string }) => m.id)).toEqual(['aeropolar', 'aerosurface', 'solar']);
  });

  it('holds a model to its envelope by name over HTTP: 200 in air, 422 in seawater, 400 for a medium it does not know', async () => {
    expect((await call('/force-models/aeropolar/in/air')).body.valid).toBe(true);
    const sea = await call('/force-models/aeropolar/in/seawater');
    expect(sea.status).toBe(422);
    expect(sea.body.error).toBe('model_not_valid_in_medium');
    expect(sea.body.refusal).toBe('model_not_valid_in_medium: aeropolar, seawater');
    const undeclared = await call('/force-models/nobody-declared-this/in/seawater');
    expect(undeclared.status).toBe(422);
    expect(undeclared.body.because).toMatch(/fails closed/);
    expect((await call('/force-models/aeropolar/in/helium')).status).toBe(400);
  });

  it('seeds the Floater from the reference design as vehicle + evaluation 1, sized with a RED budget, idempotently', async () => {
    const first = await call('/floater/seed', { method: 'POST', body: '{}' });
    expect(first.status).toBe(201);
    expect(first.body.seeded).toBe(true);
    expect(first.body.vehicle.name).toBe('Floater');
    expect(first.body.vehicle.kind).toBe('solar-dynastat');
    expect(first.body.vehicle.designVector.planform.span_m).toBe(2.5);
    expect(first.body.stage.stage).toBe('sized');
    expect(first.body.stage.blockedBy.join('\n')).toMatch(/RED.*\+274\.3 g/);
    expect(first.body.stage.fabricable).toBe(FABRICABLE_SENTENCE);
    const evaluation = first.body.evaluations[0].evaluation;
    expect(evaluation.sequence).toBe(1);
    expect(evaluation.mediumId).toBe('air');
    expect(evaluation.engineFingerprints.package).toBe('aero-lab');
    expect(evaluation.engineFingerprints.generator).toBe('engine/export_build_files.py');
    expect(evaluation.engineFingerprints.engineBuildHash).toBe(engineBuildHash(path.join(PACKAGE_DIR, 'engine')));
    const declaredVersion = /^version:\s*([^#\r\n]+)/m.exec(fs.readFileSync(path.join(PACKAGE_DIR, 'oshal-app.yaml'), 'utf8'))?.[1].trim();
    expect(evaluation.engineFingerprints.packageVersion).toBe(declaredVersion);
    expect(evaluation.result.budget.status).toBe('red');
    expect(evaluation.result.budget.deltaG).toBe(274.3);
    expect(evaluation.result.artifacts.length).toBeGreaterThan(20);
    expect(evaluation.result.figures.trim_V_ms).toBeCloseTo(3.796, 3);

    const again = await call('/floater/seed', { method: 'POST', body: '{}' });
    expect(again.status).toBe(200);
    expect(again.body.seeded).toBe(false);
    expect(again.body.vehicle.vehicleId).toBe(first.body.vehicle.vehicleId);
    expect(pool.vehicles.length).toBe(1);
    expect(pool.evaluations.length).toBe(1);
  });

  it('lists and reads the record with its stage; another owner sees nothing and gets 404', async () => {
    const list = await call('');
    expect(list.body.vehicles.length).toBe(1);
    expect(list.body.vehicles[0].stage.stage).toBe('sized');
    const id = list.body.vehicles[0].vehicle.vehicleId;
    const one = await call(`/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.evaluations.length).toBe(1);
    expect(one.body.withheld).toEqual([]);
    expect(one.body.kind.limits.length).toBe(6);

    expect((await call('', {}, STRANGER)).body.vehicles).toEqual([]);
    expect((await call(`/${id}`, {}, STRANGER)).status).toBe(404);
    expect((await call('/not-a-uuid')).status).toBe(404);
    expect((await call(`/${randomUUID()}`)).status).toBe(404);
    const strangerSeed = await call('/floater/seed', { method: 'POST', body: '{}' }, STRANGER);
    expect(strangerSeed.status).toBe(201);
    expect(strangerSeed.body.vehicle.vehicleId).not.toBe(id);
  });

  it('a changed design vector drops the stage to concept on the next read, and the evaluation no longer counts', async () => {
    const id = (await call('')).body.vehicles.find((v: { vehicle: { name: string } }) => v.vehicle.name === 'Floater').vehicle.vehicleId;
    expect((await call(`/${id}/design`, { method: 'PATCH', body: JSON.stringify({}) })).status).toBe(400);
    expect((await call(`/${id}/design`, { method: 'PATCH', body: JSON.stringify({ designVector: [] }) })).status).toBe(400);
    expect((await call(`/${id}/design`, { method: 'PATCH', body: JSON.stringify({ designVector: { span_m: 2.6 } }) }, STRANGER)).status).toBe(404);
    const patched = await call(`/${id}/design`, { method: 'PATCH', body: JSON.stringify({ designVector: { planform: { span_m: 2.6 } } }) });
    expect(patched.status).toBe(200);
    expect(patched.body.stage.stage).toBe('concept');
    expect(patched.body.stage.sizedBy).toBeNull();
    const read = await call(`/${id}`);
    expect(read.body.stage.stage).toBe('concept');
    expect(read.body.evaluations.length).toBe(1);
  });

  it('an evaluation that cannot name its medium or engine is WITHHELD by name, never listed as a result (D5)', async () => {
    const id = (await call('')).body.vehicles.find((v: { vehicle: { name: string } }) => v.vehicle.name === 'Floater').vehicle.vehicleId;
    const hash = engineBuildHash(path.join(PACKAGE_DIR, 'engine'));
    const stored = (sequence: number, engine_fingerprints: Record<string, unknown>): EvaluationRow => ({ evaluation_id: randomUUID(), vehicle_id: id, owner_sub: 'floater-owner', sequence, medium_id: 'air', vector_fingerprint: 'f'.repeat(64), engine_fingerprints, result: { figures: {} }, created_at: new Date().toISOString() });
    pool.evaluations.push(stored(2, { generator: 'engine/export_build_files.py', engineBuildHash: hash }));
    pool.evaluations.push(stored(3, { packageVersion: 'unknown', generator: 'engine/export_build_files.py', engineBuildHash: hash }));
    pool.evaluations.push(stored(4, { packageVersion: '1.3.0', generator: 'engine/export_build_files.py', engineBuildHash: null }));
    const read = await call(`/${id}`);
    expect(read.body.evaluations.map((e: { sequence: number }) => e.sequence)).toEqual([1]);
    expect(read.body.withheld.map((w: { sequence: number; missing: string[] }) => [w.sequence, w.missing])).toEqual([
      [2, ['engineFingerprints.packageVersion']],
      [3, ['engineFingerprints.packageVersion']],
      [4, ['engineFingerprints.engineBuildHash']],
    ]);
    for (const w of read.body.withheld) expect(w.because).toMatch(/ADR-160 D5/);
  });
});

describe('a package that cannot name its engine seeds nothing (ADR-160 D5): 503 run_unfingerprinted, no row written', () => {
  const PORT2 = PORT + 1;
  let server: Server;
  const dirs: string[] = [];
  const pools = { noManifest: fakePool(), placeholder: fakePool(), noEngine: fakePool() };
  const packageDirWith = (label: string, manifest: string | null): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aero-lab-${label}-`));
    dirs.push(dir);
    if (manifest !== null) fs.writeFileSync(path.join(dir, 'oshal-app.yaml'), manifest);
    return dir;
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/no-manifest', requiresAuthDouble, createAeroVehicleRoutes({ pool: pools.noManifest, appPackageDir: packageDirWith('no-manifest', null) }));
    app.use('/placeholder', requiresAuthDouble, createAeroVehicleRoutes({ pool: pools.placeholder, appPackageDir: packageDirWith('placeholder', 'name: aero-lab\nversion: unknown\n') }));
    app.use('/no-engine', requiresAuthDouble, createAeroVehicleRoutes({ pool: pools.noEngine, appPackageDir: packageDirWith('no-engine', 'name: aero-lab\nversion: 9.9.9\n') }));
    server = await new Promise<Server>((resolve) => { const s = app.listen(PORT2, () => resolve(s)); });
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  const seed = async (mount: string, headers: Record<string, string> = { 'x-test-sub': 'floater-owner' }) => {
    const res = await fetch(`http://127.0.0.1:${PORT2}${mount}/floater/seed`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', ...headers } });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> };
  };

  it('a package dir without a manifest: 503 run_unfingerprinted naming the version and the engine, and no vehicle or evaluation is inserted', async () => {
    const r = await seed('/no-manifest');
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('run_unfingerprinted');
    expect(r.body.missing).toEqual(['packageVersion', 'engineBuildHash']);
    expect(r.body.message).toMatch(/ADR-160 D5/);
    expect(pools.noManifest.vehicles).toEqual([]);
    expect(pools.noManifest.evaluations).toEqual([]);
  });

  it("a manifest whose version is the placeholder 'unknown' carries no version: 503, nothing inserted", async () => {
    const r = await seed('/placeholder');
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('run_unfingerprinted');
    expect(r.body.missing).toContain('packageVersion');
    expect(pools.placeholder.vehicles).toEqual([]);
    expect(pools.placeholder.evaluations).toEqual([]);
  });

  it('a real version but no engine tree to hash: 503 naming engineBuildHash alone, nothing inserted', async () => {
    const r = await seed('/no-engine');
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('run_unfingerprinted');
    expect(r.body.missing).toEqual(['engineBuildHash']);
    expect(pools.noEngine.vehicles).toEqual([]);
    expect(pools.noEngine.evaluations).toEqual([]);
  });

  it('the caller gate still answers first: no caller is 401, not 503', async () => {
    expect((await seed('/no-manifest', {})).status).toBe(401);
  });
});
