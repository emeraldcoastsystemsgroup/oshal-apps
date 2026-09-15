/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist one exact-owner brand kit per person inside the project store's bounded, identity-scoped transactions; a logo must be an image the same owner uploaded.
 */
import type { PoolClient } from 'pg';
import { ProjectError, type ConfirmProjectAccess, type ProjectOwner } from './create-project-types';
import type { CreateProjectStore } from './create-project-store';

/** The validated kit document, as the shared browser/server module normalizes it. */
export interface BrandKitDocument {
  version: 1;
  name: string;
  colors: Record<string, string>;
  extras: Array<{ name: string; hex: string }>;
  fonts: { heading: string; body: string };
  voice: string;
  logo: null | { src: string; width: number; height: number };
}
export interface BrandKitRecord { kit: BrandKitDocument; revision: number; updatedAt: string }
export interface BrandLogo { id: string; width: number; height: number }
export const BRAND_REVISION_LIMIT = 100000;

interface KitRow { kit: BrandKitDocument; revision: number; updated_at: Date | string }

function record(row: KitRow): BrandKitRecord {
  return { kit: row.kit, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() };
}

/** The same per-owner advisory key the project store takes, so a logo reference and an unused-asset
 * cleanup for one person can never interleave. */
async function ownerLock(client: PoolClient, owner: ProjectOwner): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([owner.issuer, owner.sub])]);
}

async function currentRevision(client: PoolClient, owner: ProjectOwner): Promise<number> {
  const result = await client.query<{ revision: number }>('SELECT revision FROM create_brand_kits WHERE owner_issuer=$1 AND owner_sub=$2 FOR UPDATE', [owner.issuer, owner.sub]);
  return result.rows[0]?.revision ?? 0;
}

async function checkLogo(client: PoolClient, owner: ProjectOwner, logo: BrandLogo): Promise<void> {
  const result = await client.query<{ width: number; height: number }>('SELECT width,height FROM create_project_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3',
    [owner.issuer, owner.sub, logo.id]);
  const row = result.rows[0];
  if (!row || row.width !== logo.width || row.height !== logo.height) throw new ProjectError(400, 'brand_logo_unavailable');
}

/** One row per verified issuer and subject; every statement names both owner fields. */
export class CreateBrandKitStore {
  constructor(private readonly projects: CreateProjectStore) {}

  async get(owner: ProjectOwner): Promise<BrandKitRecord | null> {
    return this.projects.transaction(owner, false, async client => {
      const result = await client.query<KitRow>('SELECT kit,revision,updated_at FROM create_brand_kits WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
      return result.rows[0] ? record(result.rows[0]) : null;
    });
  }

  /** `expected` is the revision the page last read: 0 for a first save. A stale page gets 409. */
  async save(owner: ProjectOwner, expected: number, kit: BrandKitDocument, logo: BrandLogo | null, confirm: ConfirmProjectAccess): Promise<BrandKitRecord> {
    return this.projects.transaction(owner, true, async client => {
      await ownerLock(client, owner);
      const revision = await currentRevision(client, owner);
      if (revision !== expected) throw new ProjectError(409, 'brand_revision_conflict');
      if (revision >= BRAND_REVISION_LIMIT) throw new ProjectError(409, 'brand_revision_limit_reached');
      if (logo) await checkLogo(client, owner, logo);
      const result = revision === 0
        ? await client.query<KitRow>(`INSERT INTO create_brand_kits (owner_issuer,owner_sub,kit,logo_asset_id) VALUES ($1,$2,$3::jsonb,$4)
            RETURNING kit,revision,updated_at`, [owner.issuer, owner.sub, JSON.stringify(kit), logo?.id ?? null])
        : await client.query<KitRow>(`UPDATE create_brand_kits SET kit=$3::jsonb,logo_asset_id=$4,revision=revision+1,updated_at=NOW()
            WHERE owner_issuer=$1 AND owner_sub=$2 AND revision=$5 RETURNING kit,revision,updated_at`, [owner.issuer, owner.sub, JSON.stringify(kit), logo?.id ?? null, expected]);
      if (!result.rows.length) throw new ProjectError(409, 'brand_revision_conflict');
      return record(result.rows[0]);
    }, confirm);
  }

  async delete(owner: ProjectOwner, expected: number, confirm: ConfirmProjectAccess): Promise<void> {
    await this.projects.transaction(owner, true, async client => {
      await ownerLock(client, owner);
      const revision = await currentRevision(client, owner);
      if (!revision) throw new ProjectError(404, 'brand_kit_not_found');
      if (revision !== expected) throw new ProjectError(409, 'brand_revision_conflict');
      await client.query('DELETE FROM create_brand_kits WHERE owner_issuer=$1 AND owner_sub=$2 AND revision=$3', [owner.issuer, owner.sub, expected]);
    }, confirm);
  }
}
