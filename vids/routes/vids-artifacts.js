"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtifactRefusal = void 0;
exports.artifactView = artifactView;
exports.requireFinishedJob = requireFinishedJob;
exports.ownedArtifact = ownedArtifact;
exports.saveArtifact = saveArtifact;
exports.publishArtifact = publishArtifact;
exports.unpublishArtifact = unpublishArtifact;
exports.removeArtifact = removeArtifact;
exports.publicArtifact = publicArtifact;
/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serialize owner-selected exports and explicit digest-bound publication against the completed job; read public tokens without owner or operator authority.
 */
const node_crypto_1 = require("node:crypto");
const request_identity_1 = require("@/shared/services/database/request-identity");
class ArtifactRefusal extends Error {
    status;
    code;
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
    }
}
exports.ArtifactRefusal = ArtifactRefusal;
function artifactView(row) {
    return row ? { jobId: row.job_id, sha256: row.sha256, byteLength: Number(row.byte_length),
        previewUrl: `/api/vids/jobs/${row.job_id}/artifact/video.mp4`,
        publicUrl: row.public_token ? `/api/vids-public/${row.public_token}/video.mp4` : null,
        publishedAt: row.published_at } : null;
}
async function requireFinishedJob(ctx, owner, job) {
    const row = (await ctx.pool.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2', [job, owner])).rows[0];
    if (!row)
        throw new ArtifactRefusal(404, 'job_not_found');
    if (row.status !== 'done')
        throw new ArtifactRefusal(409, 'finished_job_required');
}
async function ownedArtifact(ctx, owner, job) {
    return (await ctx.pool.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
}
async function withJob(ctx, owner, job, action) {
    const client = await ctx.pool.connect();
    let discard = false;
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        const row = (await client.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2 FOR UPDATE', [job, owner])).rows[0];
        if (!row)
            throw new ArtifactRefusal(404, 'job_not_found');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        try {
            await client.query('ROLLBACK');
        }
        catch {
            discard = true;
        }
        if (error.code === '55P03')
            throw new ArtifactRefusal(503, 'artifact_busy_retry');
        throw error;
    }
    finally {
        client.release(discard);
    }
}
async function saveArtifact(ctx, owner, job, id, sha, bytes) {
    return withJob(ctx, owner, job, async (client) => {
        const status = (await client.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2', [job, owner])).rows[0]?.status;
        if (status !== 'done')
            throw new ArtifactRefusal(409, 'finished_job_required');
        const existing = (await client.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
        if (existing)
            throw new ArtifactRefusal(409, 'export_already_attached');
        return (await client.query(`INSERT INTO vids_artifacts(job_id,artifact_id,owner_sub,sha256,byte_length)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [job, id, owner, sha, bytes])).rows[0];
    });
}
async function publishArtifact(ctx, owner, job, sha) {
    return withJob(ctx, owner, job, async (client) => {
        const status = (await client.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2', [job, owner])).rows[0]?.status;
        if (status !== 'done')
            throw new ArtifactRefusal(409, 'finished_job_required');
        const row = (await client.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
        if (!row)
            throw new ArtifactRefusal(409, 'finished_export_required');
        if (row.sha256 !== sha)
            throw new ArtifactRefusal(409, 'export_changed_review_again');
        if (row.public_token)
            return row;
        return (await client.query(`UPDATE vids_artifacts SET public_token=$3,published_at=now()
      WHERE job_id=$1 AND owner_sub=$2 RETURNING *`, [job, owner, (0, node_crypto_1.randomBytes)(32).toString('hex')])).rows[0];
    });
}
async function unpublishArtifact(ctx, owner, job) {
    return withJob(ctx, owner, job, async (client) => {
        const row = (await client.query(`UPDATE vids_artifacts SET public_token=NULL,published_at=NULL
      WHERE job_id=$1 AND owner_sub=$2 RETURNING *`, [job, owner])).rows[0];
        if (!row)
            throw new ArtifactRefusal(404, 'export_not_found');
        return row;
    });
}
/** Remove only an explicitly confirmed private export; a published export must first be revoked. */
async function removeArtifact(ctx, owner, job) {
    return withJob(ctx, owner, job, async (client) => {
        const row = (await client.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
        if (!row)
            throw new ArtifactRefusal(404, 'export_not_found');
        if (row.public_token)
            throw new ArtifactRefusal(409, 'unpublish_before_removing');
        await client.query('DELETE FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner]);
        return row;
    });
}
async function publicArtifact(ctx, token) {
    return (0, request_identity_1.runWithRequestIdentity)({ sub: null, isOperator: false }, async () => {
        const client = await ctx.pool.connect();
        let discard = false;
        try {
            await client.query('BEGIN READ ONLY');
            await client.query(`SELECT set_config('oshal.current_sub','',true),set_config('oshal.is_operator','off',true),
        set_config('oshal.vids_public_token',$1,true)`, [token]);
            const row = (await client.query(`SELECT artifact_id,sha256,byte_length FROM vids_artifacts
        WHERE public_token=$1 AND published_at IS NOT NULL`, [token])).rows[0];
            await client.query('COMMIT');
            return row;
        }
        catch (error) {
            try {
                await client.query('ROLLBACK');
            }
            catch {
                discard = true;
            }
            throw error;
        }
        finally {
            client.release(discard);
        }
    });
}
//# sourceMappingURL=vids-artifacts.js.map