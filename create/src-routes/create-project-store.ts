/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist exact-owner project snapshots atomically, lock optimistic writes and verify immutable referenced assets.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Serialize bounded writer admission before shared-pool checkout while retaining both current authorization checks.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Unused-upload cleanup keeps the image a brand kit uses as its logo.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { documentAssets } from './create-project-validation';
import { acquireProjectWrite } from './create-project-write-gate';
import { ProjectError, PROJECT_LIMITS, PROJECT_ASSET_PREFIX, type ConfirmProjectAccess, type ProjectContext,
  type ProjectOwner, type ProjectInput, type ProjectMetadata, type ProjectSnapshot, type RevisionMetadata, type ProjectAsset } from './create-project-types';

interface ProjectRow { project_id: string; title: string; current_revision: number; created_at: Date | string; updated_at: Date | string; document?: ProjectInput['document'] }
interface AssetRow { asset_id: string; width: number; height: number; byte_length: number; sha256: string }
const METADATA = 'project_id,title,current_revision,created_at,updated_at';

function metadata(row: ProjectRow): ProjectMetadata {
  return { id: row.project_id, title: row.title, revision: row.current_revision,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
function asset(row: AssetRow): ProjectAsset {
  return { id: row.asset_id, src: PROJECT_ASSET_PREFIX + row.asset_id, width: row.width, height: row.height, bytes: row.byte_length, sha256: row.sha256 };
}

/** One transaction scopes both SQL and optional RLS to the verified principal; no system/admin escape hatch. */
export class CreateProjectStore {
  constructor(private readonly pool: ProjectContext['pool']) {}

  async transaction<T>(owner: ProjectOwner, write: boolean, work: (client: PoolClient) => Promise<T>, confirm?: ConfirmProjectAccess): Promise<T> {
    const release = write ? await acquireProjectWrite(this.pool) : () => undefined;
    try {
      if (write && confirm) await confirm();
      return await this.clientTransaction(owner, write, work, confirm);
    } finally { release(); }
  }

  private async clientTransaction<T>(owner: ProjectOwner, write: boolean, work: (client: PoolClient) => Promise<T>, confirm?: ConfirmProjectAccess): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true)", [owner.issuer, owner.sub]);
      const result = await work(client);
      if (confirm) await confirm();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }

  /** Serialize per-owner admissions so concurrent requests cannot bypass storage quotas. */
  private async ownerLock(client: PoolClient, owner: ProjectOwner): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([owner.issuer, owner.sub])]);
  }

  private async checkAssets(client: PoolClient, owner: ProjectOwner, input: ProjectInput): Promise<void> {
    const references = documentAssets(input.document);
    if (!references.length) return;
    const result = await client.query<AssetRow>('SELECT asset_id,width,height,byte_length,sha256 FROM create_project_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=ANY($3::uuid[])',
      [owner.issuer, owner.sub, references.map(row => row.id)]);
    const assets = new Map(result.rows.map(row => [row.asset_id, row]));
    if (references.some(ref => !assets.has(ref.id) || assets.get(ref.id)!.width !== ref.width || assets.get(ref.id)!.height !== ref.height)) {
      throw new ProjectError(400, 'project_asset_unavailable');
    }
  }

  private async lockProject(client: PoolClient, owner: ProjectOwner, id: string, expected: number): Promise<ProjectRow> {
    const result = await client.query<ProjectRow>(`SELECT ${METADATA} FROM create_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 FOR UPDATE`, [owner.issuer, owner.sub, id]);
    const row = result.rows[0];
    if (!row) throw new ProjectError(404, 'project_not_found');
    if (row.current_revision !== expected) throw new ProjectError(409, 'project_revision_conflict');
    return row;
  }

  private async recordAssets(client: PoolClient, owner: ProjectOwner, id: string, revision: number, input: ProjectInput): Promise<void> {
    const ids = [...new Set(documentAssets(input.document).map(row => row.id))];
    if (!ids.length) return;
    await client.query(`INSERT INTO create_project_revision_assets (project_id,revision,owner_issuer,owner_sub,asset_id)
      SELECT $3,$4,$1,$2,unnest($5::uuid[])`, [owner.issuer, owner.sub, id, revision, ids]);
  }

  async list(owner: ProjectOwner): Promise<ProjectMetadata[]> {
    return this.transaction(owner, false, async client => {
      const result = await client.query<ProjectRow>(`SELECT ${METADATA} FROM create_projects WHERE owner_issuer=$1 AND owner_sub=$2 ORDER BY updated_at DESC,project_id LIMIT 100`, [owner.issuer, owner.sub]);
      return result.rows.map(metadata);
    });
  }

  async summary(owner: ProjectOwner): Promise<{ projects: ProjectMetadata[]; count: number }> {
    return this.transaction(owner, false, async client => {
      const count = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM create_projects WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
      const result = await client.query<ProjectRow>(`SELECT ${METADATA} FROM create_projects WHERE owner_issuer=$1 AND owner_sub=$2 ORDER BY updated_at DESC,project_id LIMIT 6`, [owner.issuer, owner.sub]);
      return { projects: result.rows.map(metadata), count: count.rows[0].count };
    });
  }

  async get(owner: ProjectOwner, id: string, revision?: number): Promise<ProjectSnapshot> {
    return this.transaction(owner, false, async client => {
      const result = await client.query<ProjectRow>(`SELECT p.project_id,r.title,r.revision AS current_revision,p.created_at,r.created_at AS updated_at,r.document
        FROM create_projects p JOIN create_project_revisions r ON r.project_id=p.project_id AND r.owner_issuer=p.owner_issuer AND r.owner_sub=p.owner_sub
        WHERE p.owner_issuer=$1 AND p.owner_sub=$2 AND p.project_id=$3 AND r.revision=COALESCE($4,p.current_revision)`, [owner.issuer, owner.sub, id, revision ?? null]);
      const row = result.rows[0];
      if (!row?.document) throw new ProjectError(404, 'project_not_found');
      return { ...metadata(row), document: row.document };
    });
  }

  async revisions(owner: ProjectOwner, id: string): Promise<RevisionMetadata[]> {
    return this.transaction(owner, false, async client => {
      const project = await client.query('SELECT project_id FROM create_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3', [owner.issuer, owner.sub, id]);
      if (!project.rows.length) throw new ProjectError(404, 'project_not_found');
      const result = await client.query<{ revision: number; title: string; created_at: Date | string }>(`SELECT revision,title,created_at FROM create_project_revisions
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 ORDER BY revision DESC LIMIT 100`, [owner.issuer, owner.sub, id]);
      return result.rows.map(row => ({ revision: row.revision, title: row.title, createdAt: new Date(row.created_at).toISOString() }));
    });
  }

  async create(owner: ProjectOwner, input: ProjectInput, confirm: ConfirmProjectAccess): Promise<ProjectSnapshot> {
    return this.transaction(owner, true, async client => {
      await this.ownerLock(client, owner);
      const total = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM create_projects WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
      if (total.rows[0].count >= PROJECT_LIMITS.projects) throw new ProjectError(409, 'project_limit_reached');
      await this.checkAssets(client, owner, input);
      const id = randomUUID();
      const result = await client.query<ProjectRow>(`INSERT INTO create_projects (project_id,owner_issuer,owner_sub,title) VALUES ($3,$1,$2,$4) RETURNING ${METADATA}`, [owner.issuer, owner.sub, id, input.title]);
      await client.query('INSERT INTO create_project_revisions (project_id,owner_issuer,owner_sub,revision,title,document) VALUES ($3,$1,$2,1,$4,$5::jsonb)', [owner.issuer, owner.sub, id, input.title, JSON.stringify(input.document)]);
      await this.recordAssets(client, owner, id, 1, input);
      return { ...metadata(result.rows[0]), document: input.document };
    }, confirm);
  }

  async save(owner: ProjectOwner, id: string, expected: number, input: ProjectInput, confirm: ConfirmProjectAccess): Promise<ProjectSnapshot> {
    return this.transaction(owner, true, async client => {
      await this.ownerLock(client, owner);
      await this.lockProject(client, owner, id, expected);
      if (expected >= PROJECT_LIMITS.revisions) throw new ProjectError(409, 'project_revision_limit_reached');
      await this.checkAssets(client, owner, input);
      const revision = expected + 1;
      await client.query('INSERT INTO create_project_revisions (project_id,owner_issuer,owner_sub,revision,title,document) VALUES ($3,$1,$2,$4,$5,$6::jsonb)',
        [owner.issuer, owner.sub, id, revision, input.title, JSON.stringify(input.document)]);
      await this.recordAssets(client, owner, id, revision, input);
      const result = await client.query<ProjectRow>(`UPDATE create_projects SET title=$4,current_revision=$5,updated_at=NOW()
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND current_revision=$6 RETURNING ${METADATA}`, [owner.issuer, owner.sub, id, input.title, revision, expected]);
      if (!result.rows.length) throw new ProjectError(409, 'project_revision_conflict');
      return { ...metadata(result.rows[0]), document: input.document };
    }, confirm);
  }

  async delete(owner: ProjectOwner, id: string, expected: number, confirm: ConfirmProjectAccess): Promise<void> {
    await this.transaction(owner, true, async client => {
      await this.ownerLock(client, owner);
      await this.lockProject(client, owner, id, expected);
      await client.query('DELETE FROM create_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND current_revision=$4', [owner.issuer, owner.sub, id, expected]);
    }, confirm);
  }

  async getAsset(owner: ProjectOwner, id: string): Promise<ProjectAsset> {
    return this.transaction(owner, false, async client => {
      const result = await client.query<AssetRow>('SELECT asset_id,width,height,byte_length,sha256 FROM create_project_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [owner.issuer, owner.sub, id]);
      if (!result.rows.length) throw new ProjectError(404, 'project_asset_not_found');
      return asset(result.rows[0]);
    });
  }

  async addAsset(owner: ProjectOwner, value: ProjectAsset, confirm: ConfirmProjectAccess): Promise<void> {
    await this.transaction(owner, true, async client => {
      await this.ownerLock(client, owner);
      const total = await client.query<{ count: number; bytes: number }>('SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_length),0)::bigint AS bytes FROM create_project_assets WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
      if (total.rows[0].count >= PROJECT_LIMITS.assets || Number(total.rows[0].bytes) + value.bytes > PROJECT_LIMITS.assetBytes) throw new ProjectError(409, 'project_asset_limit_reached');
      await client.query('INSERT INTO create_project_assets (asset_id,owner_issuer,owner_sub,width,height,byte_length,sha256) VALUES ($3,$1,$2,$4,$5,$6,$7)',
        [owner.issuer, owner.sub, value.id, value.width, value.height, value.bytes, value.sha256]);
    }, confirm);
  }

  /** Retire only old assets referenced by no retained revision and no brand kit logo; serialize against new references. */
  async cleanupAssets(owner: ProjectOwner, removeFile: (id: string) => Promise<void>, confirm: ConfirmProjectAccess): Promise<string[]> {
    return this.transaction(owner, true, async client => {
      await this.ownerLock(client, owner);
      const result = await client.query<{ asset_id: string }>(`SELECT a.asset_id FROM create_project_assets a
        WHERE a.owner_issuer=$1 AND a.owner_sub=$2 AND a.created_at<NOW()-INTERVAL '24 hours'
        AND NOT EXISTS (SELECT 1 FROM create_project_revision_assets r WHERE r.asset_id=a.asset_id AND r.owner_issuer=$1 AND r.owner_sub=$2)
        AND NOT EXISTS (SELECT 1 FROM create_brand_kits b WHERE b.logo_asset_id=a.asset_id AND b.owner_issuer=$1 AND b.owner_sub=$2)
        ORDER BY a.created_at,a.asset_id LIMIT 25 FOR UPDATE`, [owner.issuer, owner.sub]);
      for (const row of result.rows) {
        await confirm(); await removeFile(row.asset_id);
        await client.query('DELETE FROM create_project_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [owner.issuer, owner.sub, row.asset_id]);
      }
      return result.rows.map(row => row.asset_id);
    }, confirm);
  }
}
