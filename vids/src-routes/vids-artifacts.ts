/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serialize owner-selected exports and explicit digest-bound publication against the completed job; read public tokens without owner or operator authority.
 */
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AppContext } from '@/app/composition/app-context';
import { runWithRequestIdentity } from '@/shared/services/database/request-identity';

export class ArtifactRefusal extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export interface ArtifactRow {
  job_id: string; artifact_id: string; owner_sub: string; sha256: string;
  byte_length: string | number; public_token: string | null; published_at: string | null;
}
export function artifactView(row: ArtifactRow | undefined): Record<string, unknown> | null {
  return row ? { jobId: row.job_id, sha256: row.sha256, byteLength: Number(row.byte_length),
    previewUrl: `/api/vids/jobs/${row.job_id}/artifact/video.mp4`,
    publicUrl: row.public_token ? `/api/vids-public/${row.public_token}/video.mp4` : null,
    publishedAt: row.published_at } : null;
}
export async function requireFinishedJob(ctx: AppContext, owner: string, job: string): Promise<void> {
  const row = (await ctx.pool.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2', [job, owner])).rows[0];
  if (!row) throw new ArtifactRefusal(404, 'job_not_found');
  if (row.status !== 'done') throw new ArtifactRefusal(409, 'finished_job_required');
}
export async function ownedArtifact(ctx: AppContext, owner: string, job: string): Promise<ArtifactRow | undefined> {
  return (await ctx.pool.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
}

async function withJob<T>(ctx: AppContext, owner: string, job: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ctx.pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    const row = (await client.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2 FOR UPDATE', [job, owner])).rows[0];
    if (!row) throw new ArtifactRefusal(404, 'job_not_found');
    const result = await action(client);
    await client.query('COMMIT'); return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    if ((error as { code?: string }).code === '55P03') throw new ArtifactRefusal(503, 'artifact_busy_retry');
    throw error;
  } finally { client.release(discard); }
}

export async function saveArtifact(ctx: AppContext, owner: string, job: string, id: string, sha: string, bytes: number): Promise<ArtifactRow> {
  return withJob(ctx, owner, job, async (client) => {
    const status = (await client.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2', [job, owner])).rows[0]?.status;
    if (status !== 'done') throw new ArtifactRefusal(409, 'finished_job_required');
    const existing = (await client.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
    if (existing) throw new ArtifactRefusal(409, 'export_already_attached');
    return (await client.query(`INSERT INTO vids_artifacts(job_id,artifact_id,owner_sub,sha256,byte_length)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [job, id, owner, sha, bytes])).rows[0];
  });
}

export async function publishArtifact(ctx: AppContext, owner: string, job: string, sha: string): Promise<ArtifactRow> {
  return withJob(ctx, owner, job, async (client) => {
    const status = (await client.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2', [job, owner])).rows[0]?.status;
    if (status !== 'done') throw new ArtifactRefusal(409, 'finished_job_required');
    const row = (await client.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0] as ArtifactRow | undefined;
    if (!row) throw new ArtifactRefusal(409, 'finished_export_required');
    if (row.sha256 !== sha) throw new ArtifactRefusal(409, 'export_changed_review_again');
    if (row.public_token) return row;
    return (await client.query(`UPDATE vids_artifacts SET public_token=$3,published_at=now()
      WHERE job_id=$1 AND owner_sub=$2 RETURNING *`, [job, owner, randomBytes(32).toString('hex')])).rows[0];
  });
}

export async function unpublishArtifact(ctx: AppContext, owner: string, job: string): Promise<ArtifactRow> {
  return withJob(ctx, owner, job, async (client) => {
    const row = (await client.query(`UPDATE vids_artifacts SET public_token=NULL,published_at=NULL
      WHERE job_id=$1 AND owner_sub=$2 RETURNING *`, [job, owner])).rows[0];
    if (!row) throw new ArtifactRefusal(404, 'export_not_found');
    return row;
  });
}

/** Remove only an explicitly confirmed private export; a published export must first be revoked. */
export async function removeArtifact(ctx: AppContext, owner: string, job: string): Promise<ArtifactRow> {
  return withJob(ctx, owner, job, async (client) => {
    const row = (await client.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
    if (!row) throw new ArtifactRefusal(404, 'export_not_found');
    if (row.public_token) throw new ArtifactRefusal(409, 'unpublish_before_removing');
    await client.query('DELETE FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner]);
    return row;
  });
}

export async function publicArtifact(ctx: AppContext, token: string): Promise<ArtifactRow | undefined> {
  return runWithRequestIdentity({ sub: null, isOperator: false }, async () => {
    const client = await ctx.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SELECT set_config('oshal.current_sub','',true),set_config('oshal.is_operator','off',true),
        set_config('oshal.vids_public_token',$1,true)`, [token]);
      const row = (await client.query(`SELECT artifact_id,sha256,byte_length FROM vids_artifacts
        WHERE public_token=$1 AND published_at IS NOT NULL`, [token])).rows[0];
      await client.query('COMMIT'); return row;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  });
}
