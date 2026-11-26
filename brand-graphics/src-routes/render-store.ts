/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: per-owner lasting storage for render job history, rendered MP4 clips, and personal brand kits under OSHAL_PACKAGE_DATA_DIR.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RenderOwner } from './render-auth';
import {
  OPEN_SWARM_KIT,
  RenderError,
  parseBrandKitPatch,
  type BrandStyle,
  type RenderJobRecord,
  type ResolvedBrandKit,
} from './render-types';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JOBS_PER_OWNER = 100;

export function resolveDataRoot(overrideDir?: string): string {
  const configured = overrideDir || process.env.OSHAL_PACKAGE_DATA_DIR;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.join(os.tmpdir(), 'brand-graphics-data');
}

export function ownerHash(owner: RenderOwner): string {
  return crypto.createHash('sha256').update(JSON.stringify([owner.issuer, owner.sub])).digest('hex');
}

export function ownerRenderDir(owner: RenderOwner, overrideDir?: string): string {
  const root = resolveDataRoot(overrideDir);
  const dir = path.join(root, 'renders', ownerHash(owner));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function assertJobId(raw: string): string {
  if (typeof raw !== 'string' || !JOB_ID.test(raw)) {
    throw new RenderError(400, 'invalid_job_id', 'Render job id must be a UUID v4.');
  }
  return raw.toLowerCase();
}

export function mp4FilePath(owner: RenderOwner, jobId: string, overrideDir?: string): string {
  const id = assertJobId(jobId);
  const dir = ownerRenderDir(owner, overrideDir);
  const target = path.resolve(dir, `${id}.mp4`);
  if (path.dirname(target) !== path.resolve(dir)) {
    throw new RenderError(400, 'invalid_job_id', 'Invalid render path.');
  }
  return target;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function listRenderJobs(owner: RenderOwner, overrideDir?: string): RenderJobRecord[] {
  const file = path.join(ownerRenderDir(owner, overrideDir), 'jobs.json');
  const parsed = readJsonFile<unknown>(file, []);
  if (!Array.isArray(parsed)) return [];
  return (parsed as RenderJobRecord[]).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getRenderJob(owner: RenderOwner, jobId: string, overrideDir?: string): RenderJobRecord | null {
  const id = assertJobId(jobId);
  return listRenderJobs(owner, overrideDir).find((job) => job.id === id) || null;
}

export function saveRenderJob(owner: RenderOwner, job: RenderJobRecord, overrideDir?: string): void {
  const dir = ownerRenderDir(owner, overrideDir);
  const file = path.join(dir, 'jobs.json');
  const existing = listRenderJobs(owner, overrideDir).filter((item) => item.id !== job.id);
  const next = [job, ...existing].slice(0, MAX_JOBS_PER_OWNER);
  writeJsonAtomic(file, next);
}

export function deleteRenderJob(owner: RenderOwner, jobId: string, overrideDir?: string): boolean {
  const id = assertJobId(jobId);
  const dir = ownerRenderDir(owner, overrideDir);
  const file = path.join(dir, 'jobs.json');
  const current = listRenderJobs(owner, overrideDir);
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) return false;
  writeJsonAtomic(file, next);
  const clip = mp4FilePath(owner, id, overrideDir);
  if (fs.existsSync(clip)) fs.unlinkSync(clip);
  return true;
}

export function readSavedBrandKit(owner: RenderOwner, overrideDir?: string): Partial<ResolvedBrandKit> | null {
  const file = path.join(ownerRenderDir(owner, overrideDir), 'brand-kit.json');
  const parsed = readJsonFile<unknown>(file, null);
  if (!parsed || typeof parsed !== 'object') return null;
  try {
    return parseBrandKitPatch(parsed);
  } catch {
    return null;
  }
}

export function saveBrandKit(owner: RenderOwner, patch: Partial<ResolvedBrandKit>, overrideDir?: string): ResolvedBrandKit {
  const file = path.join(ownerRenderDir(owner, overrideDir), 'brand-kit.json');
  const resolved = finalizeKit('my-brand', patch, 'saved-brand-kit');
  writeJsonAtomic(file, {
    brandName: resolved.brandName,
    primaryColor: resolved.primaryColor,
    accentColor: resolved.accentColor,
    backgroundColor: resolved.backgroundColor,
    logoRef: resolved.logoRef,
  });
  return resolved;
}

async function readCreateBrandKit(ctx: any, owner: RenderOwner): Promise<Partial<ResolvedBrandKit> | null> {
  if (!ctx?.pool || typeof ctx.pool.connect !== 'function') return null;
  let client: any;
  try {
    client = await ctx.pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='1500ms'");
    await client.query("SELECT set_config('create.owner_issuer',$1,true)", [owner.issuer]);
    await client.query("SELECT set_config('create.owner_sub',$1,true)", [owner.sub]);
    await client.query("SELECT set_config('oshal.current_issuer',$1,true)", [owner.issuer]);
    await client.query("SELECT set_config('oshal.current_subject',$1,true)", [owner.sub]);
    const res = await client.query(
      'SELECT kit FROM create_brand_kits WHERE owner_issuer = $1 AND owner_sub = $2 LIMIT 1',
      [owner.issuer, owner.sub],
    );
    await client.query('COMMIT');
    const kit = res?.rows?.[0]?.kit;
    if (!kit || typeof kit !== 'object') return null;
    return parseBrandKitPatch({
      name: kit.name,
      colors: kit.colors,
      logo: kit.logo,
    });
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return null;
  } finally {
    if (client) client.release();
  }
}

function finalizeKit(
  brandStyle: BrandStyle,
  patch: Partial<ResolvedBrandKit> | null,
  source: ResolvedBrandKit['source'],
): ResolvedBrandKit {
  return {
    brandStyle,
    brandName: (patch?.brandName && patch.brandName.trim()) || OPEN_SWARM_KIT.brandName,
    primaryColor: patch?.primaryColor || OPEN_SWARM_KIT.primaryColor,
    accentColor: patch?.accentColor || OPEN_SWARM_KIT.accentColor,
    backgroundColor: patch?.backgroundColor || OPEN_SWARM_KIT.backgroundColor,
    logoRef: patch?.logoRef ?? null,
    source,
  };
}

export async function resolveOwnerBrandKit(
  ctx: any,
  owner: RenderOwner,
  brandStyle: BrandStyle,
  requestPatch: Partial<ResolvedBrandKit> | null,
  overrideDir?: string,
): Promise<ResolvedBrandKit> {
  if (brandStyle === 'oshal') return { ...OPEN_SWARM_KIT };
  if (requestPatch && (requestPatch.brandName || requestPatch.primaryColor || requestPatch.accentColor || requestPatch.backgroundColor)) {
    return finalizeKit('my-brand', requestPatch, 'request');
  }
  const fromCreate = await readCreateBrandKit(ctx, owner);
  if (fromCreate) return finalizeKit('my-brand', fromCreate, 'create-brand-kit');
  const fromSaved = readSavedBrandKit(owner, overrideDir);
  if (fromSaved) return finalizeKit('my-brand', fromSaved, 'saved-brand-kit');
  return finalizeKit('my-brand', null, 'fallback');
}
