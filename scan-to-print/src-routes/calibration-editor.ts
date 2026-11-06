/** CHANGE LOG: 2026-11-05 | maintainer@emeraldcoastsystemsgroup.com | Recheck the exact owned source-change permission without granting processing or worker configuration. */
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Original-person calibration source uses real job persistence, closed validation, atomic CAS and existing output retirement without reconstructing or printing.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Join the trusted native request-wide SQL/file transaction; retain dedicated RLS PostgreSQL transactions and refuse an unbound native write.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Route-backed native approval uses bounded JSON transport and the same closed, original-owned calibration transaction.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Build mutation receipts from the actual SQL RETURNING row with fresh authority, avoiding another connection snapshot or concurrent source reread.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The projection says whether this seat may build the model (canReconstruct: scan.edit), so the page offers Make 3D model, a video or a .ply only to a seat the kernel admits for them (Roger, trial.oswarm.ai, 2026-11-06: a visitor holding only source-editor was refused at the kernel after taking photos). The answer is a read; every route still rechecks its own permission.
 */
import type { AppContext } from '@/app/composition/app-context';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createJob, type JobRow } from './job-store';
import { ARTIFACT_FILES, artifactPath, jobDir, requireUuid, type ArtifactKey } from './data-dir';
import { RECONSTRUCTION_LIMITS } from './engine/pipeline';
type Person = {
  issuer: string;
  sub: string;
  principalId: string;
  tenant: string;
};
export class CalibrationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
const exact = (value: any, keys: string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new CalibrationError('Use only the supported calibration fields.');
};
function original(ctx: AppContext): Person {
  const a = ctx.authorization?.currentActor() as any;
  if (!a?.isActive || !['issuer', 'sub', 'principalId'].every(k => typeof a[k] === 'string' && a[k].trim().length > 0 && a[k].length <= 512) || !Array.isArray(a.tenantIds) || a.tenantIds.length !== 1 || typeof a.tenantIds[0] !== 'string' || !a.tenantIds[0].trim() || a.tenantIds[0].length > 512) throw new CalibrationError('An active original person is required.', 401);
  return {
    issuer: a.issuer,
    sub: a.sub,
    principalId: a.principalId,
    tenant: a.tenantIds[0]
  };
}
const stable = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex');
export async function calibrationAccess(ctx: AppContext, permission: string, expected?: Person): Promise<Person> {
  const a = original(ctx),
    port = ctx.authorization as any;
  if (!port?.authorize || (await port.authorize({
    permission
  })).allowed !== true) throw new CalibrationError('Current calibration permission is required.', 403);
  const b = original(ctx);
  if (stable(a) !== stable(b) || expected && stable(a) !== stable(expected)) throw new CalibrationError('The original person changed during this operation.', 401);
  return a;
}
export async function assertCalibrationOwner(ctx: AppContext, jobId: string, person?: Person, client: any = ctx.pool): Promise<void> {
  const a = person ?? (await calibrationAccess(ctx, 'scan.source.change')),
    row = (await client.query('SELECT job_id,owner_key FROM scan_print_job_editor WHERE job_id=$1', [jobId])).rows[0];
  if (row ? row.owner_key !== digest(a) : (ctx.pool as any).storageModel !== 'kernel-scoped-documents') throw new CalibrationError('This legacy object needs verified original-owner binding before editing. Its saved evidence is kept.', 403);
}
async function tx<T>(ctx: AppContext, a: Person, work: (c: any) => Promise<T>): Promise<T> {
  const nativePool = ctx.pool as any;
  if (nativePool.storageModel === 'kernel-scoped-documents') {
    if (typeof nativePool.nativeAtomicRequest !== 'function' || nativePool.nativeAtomicRequest() !== true) throw new CalibrationError('The native calibration transaction is unavailable.', 503);
    const result = await work(nativePool);
    await calibrationAccess(ctx, 'scan.source.change', a);
    return result;
  }
  const c = await nativePool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('scan_editor.owner_key',$1,true)", [digest(a)]);
    const result = await work(c);
    await calibrationAccess(ctx, 'scan.source.change', a);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function createOwnedJob(ctx: AppContext, sub: string, title: string): Promise<JobRow> {
  const a = await calibrationAccess(ctx, 'scan.source.change');
  if (sub !== a.sub) throw new CalibrationError('The job owner changed.', 401);
  return tx(ctx, a, async c => {
    const job = await createJob(c, sub, title, 'photos');
    await c.query('INSERT INTO scan_print_job_editor(job_id,owner_key) VALUES($1,$2)', [job.job_id, digest(a)]);
    return job;
  });
}
export function calibrationDimensions(raw: unknown): Array<{
  axis: 'x' | 'y' | 'z';
  mm: number;
}> {
  if (!Array.isArray(raw) || raw.length > 3) throw new CalibrationError('Use up to three distinct measured axes.');
  const axes = new Set();
  return raw.map(entry => {
    exact(entry, ['axis', 'mm']);
    if (!['x', 'y', 'z'].includes(entry.axis) || axes.has(entry.axis) || typeof entry.mm !== 'number' || !Number.isFinite(entry.mm) || entry.mm <= 0 || entry.mm > 100000) throw new CalibrationError('Each measured axis needs a positive number up to 100000 mm.');
    axes.add(entry.axis);
    return {
      axis: entry.axis,
      mm: entry.mm
    };
  }).sort((a, b) => a.axis.localeCompare(b.axis));
}
export function calibrationSettings(raw: unknown): {
  resolution: number;
  smoothIterations: number;
} {
  exact(raw, ['resolution', 'smoothIterations']);
  const result: any = {};
  for (const k of ['resolution', 'smoothIterations'] as const) {
    const bound = RECONSTRUCTION_LIMITS[k],
      v = (raw as any)[k] ?? bound.default;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < bound.min || v > bound.max) throw new CalibrationError(`${k} must be an integer between ${bound.min} and ${bound.max}.`);
    result[k] = v;
  }
  return result;
}
export const calibrationSource = (job: JobRow) => ({
  title: job.title,
  knownDimensions: calibrationDimensions(job.known_dimensions),
  settings: calibrationSettings(job.settings)
});
export const calibrationHash = (job: JobRow) => digest({...calibrationSource(job),sourceKind:job.source_kind});
export async function readCalibration(ctx: AppContext, sub: string, jobId: string): Promise<any> {
  requireUuid(jobId);
  const a = await calibrationAccess(ctx, 'scan.read');
  if (sub !== a.sub) throw new CalibrationError('The job owner changed.', 401);
  const job = (await ctx.pool.query('SELECT * FROM scan_print_job WHERE owner_sub=$1 AND job_id=$2', [sub, jobId])).rows[0] as JobRow;
  if (!job) throw new CalibrationError('Object not found.', 404);
  await assertCalibrationOwner(ctx, jobId, a);
  return calibrationProjection(ctx,job,a);
}
async function calibrationProjection(ctx:AppContext,job:JobRow,a:Person):Promise<any>{
  let canEdit = true;
  try {
    await calibrationAccess(ctx, 'scan.source.change', a);
  } catch (e) {
    if ((e as CalibrationError).status !== 403) throw e;
    canEdit = false;
  }
  let canReconstruct = true;
  try {
    await calibrationAccess(ctx, 'scan.edit', a);
  } catch (e) {
    if ((e as CalibrationError).status !== 403) throw e;
    canReconstruct = false;
  }
  await calibrationAccess(ctx, 'scan.read', a);
  return {
    jobId:job.job_id,
    sourceSha: calibrationHash(job),
    ...calibrationSource(job),
    canEdit,
    canReconstruct,
    state: job.state,
    sourceKind: job.source_kind,
    editableFields: job.source_kind === 'pointcloud' ? ['smoothIterations'] : ['knownDimensions', 'resolution', 'smoothIterations'],
    rebuild: job.source_kind === 'pointcloud' ? 'Reimport the original point cloud with its measured units; smoothing is applied during that import.' : 'Reconstruct from the saved photos. Reupload any optional depth refinement before using that capture lane.'
  };
}
export async function updateCalibration(ctx: AppContext, dataRoot: string, sub: string, jobId: string, input: any): Promise<any> {
  requireUuid(jobId);
  if (input && (Object.hasOwn(input, 'knownDimensionsJson') || Object.hasOwn(input, 'settingsJson'))) {
    exact(input, ['jobId', 'expectedSourceSha', 'knownDimensionsJson', 'settingsJson']);
    if (typeof input.knownDimensionsJson !== 'string' || typeof input.settingsJson !== 'string' || input.knownDimensionsJson.length > 2048 || input.settingsJson.length > 1024) throw new CalibrationError('Supply the complete bounded calibration JSON fields.');
    try {
      input = {jobId: input.jobId, expectedSourceSha: input.expectedSourceSha, knownDimensions: JSON.parse(input.knownDimensionsJson), settings: JSON.parse(input.settingsJson)};
    } catch { throw new CalibrationError('Calibration JSON must be a valid complete dimensions array and settings object.'); }
  }
  exact(input, ['jobId', 'expectedSourceSha', 'knownDimensions', 'settings']);
  if (input.jobId !== undefined && input.jobId !== jobId) throw new CalibrationError('The selected object changed.');
  if (typeof input.expectedSourceSha !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedSourceSha)) throw new CalibrationError('Read the current calibration before editing.');
  if (!input.settings || typeof input.settings.resolution!=='number' || typeof input.settings.smoothIterations!=='number' || !Object.hasOwn(input.settings, 'resolution') || !Object.hasOwn(input.settings, 'smoothIterations')) throw new CalibrationError('Supply both complete saved reconstruction settings.');
  const dimensions = calibrationDimensions(input.knownDimensions),
    settings = calibrationSettings(input.settings),
    a = await calibrationAccess(ctx, 'scan.source.change');
  await calibrationAccess(ctx, 'scan.read', a);
  if (sub !== a.sub) throw new CalibrationError('The original owner changed.', 401);
  const result = await tx(ctx, a, async c => {
    const job = (await c.query('SELECT * FROM scan_print_job WHERE owner_sub=$1 AND job_id=$2 FOR UPDATE', [sub, jobId])).rows[0] as JobRow;
    if (!job) throw new CalibrationError('Object not found.', 404);
    await assertCalibrationOwner(ctx, jobId, a, c);
    if (job.source_kind === 'pointcloud' && (stable(calibrationDimensions(job.known_dimensions)) !== stable(dimensions) || calibrationSettings(job.settings).resolution !== settings.resolution)) throw new CalibrationError('Point-cloud scale comes from its original import units, not silhouette ruler dimensions or resolution. Reimport that source to change its scale.');
    if (calibrationHash(job) !== input.expectedSourceSha) throw new CalibrationError('The saved calibration changed. Re-read it before applying this edit.', 409);
    await calibrationAccess(ctx, 'scan.source.change', a);
    const changed = stable(calibrationSource(job)) !== stable({
      title: job.title,
      knownDimensions: dimensions,
      settings
    });
    if (!changed) return {
      job,
      changed
    };
    const updated = (await c.query("UPDATE scan_print_job SET known_dimensions=$3::jsonb,settings=$4::jsonb,state='capturing',report=NULL,failure_reason=NULL,updated_at=now() WHERE owner_sub=$1 AND job_id=$2 RETURNING *", [sub, jobId, JSON.stringify(dimensions), JSON.stringify(settings)])).rows[0];
    await calibrationAccess(ctx, 'scan.read', a);
    return {
      job: updated as JobRow,
      changed
    };
  });
  if (result.changed) {
    const dir = jobDir(dataRoot, sub, jobId);
    for (const key of Object.keys(ARTIFACT_FILES) as ArtifactKey[]) fs.rmSync(artifactPath(dir, key), {
      force: true
    });
  }
  return {
    job: result.job,
    calibration: await calibrationProjection(ctx,result.job,a),
    changed: result.changed
  };
}
