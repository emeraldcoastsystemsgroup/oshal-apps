"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtifactRefusal = void 0;
exports.publicLinkSeam = publicLinkSeam;
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
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Hand each published token to the kernel's no-login link seam (ctx.publicLinks.publish, after the row commits, in the same request) and revoke the token an unpublish cleared (ctx.publicLinks.revoke). The native kernel serves the declared anonymous /api/vids-public/:token/video.mp4 read only for a token the package published for its owner, so every live link answered 404 "no such link". A refused publish rolls the row back to unpublished and answers 503 public_link_unavailable; a refused revoke after the row is cleared is logged, not fatal. The legacy core has no seam and serves the link itself: no seam, no call.
 */
const node_crypto_1 = require("node:crypto");
const logger_1 = require("@/shared/logger");
const request_identity_1 = require("@/shared/services/database/request-identity");
const logger = (0, logger_1.createChildLogger)({ module: 'vids-artifacts' });
/**
 * @description The no-login link seam when the installation offers one. The legacy core has none: it serves
 * /api/vids-public itself from the row, so there is nothing to hand over.
 * @param ctx - The package context.
 * @returns The seam, or null when this installation serves the link from the row alone.
 */
function publicLinkSeam(ctx) {
    const seam = ctx.publicLinks;
    return seam && typeof seam.publish === 'function' && typeof seam.revoke === 'function' ? seam : null;
}
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
/**
 * @description Publish the owner's reviewed export: mint the row's token, commit it, then hand that exact token to
 * the kernel's link seam so the declared anonymous read serves it. A token the row already carries is handed over
 * again (one link, not two), which also repairs an export published before the package handed tokens over.
 * @param ctx - The package context, with the seam when the native kernel supplies one.
 * @param owner - The admitted owner.
 * @param job - The finished job.
 * @param sha - The digest the owner reviewed; it must still match the row.
 * @returns The published row, whose token the kernel (or the legacy core itself) now serves.
 * @throws ArtifactRefusal 503 public_link_unavailable when the kernel refused the token: the row is unpublished again.
 */
async function publishArtifact(ctx, owner, job, sha) {
    const row = await withJob(ctx, owner, job, async (client) => {
        const status = (await client.query('SELECT status FROM vids_jobs WHERE job_id=$1 AND user_sub=$2', [job, owner])).rows[0]?.status;
        if (status !== 'done')
            throw new ArtifactRefusal(409, 'finished_job_required');
        const current = (await client.query('SELECT * FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
        if (!current)
            throw new ArtifactRefusal(409, 'finished_export_required');
        if (current.sha256 !== sha)
            throw new ArtifactRefusal(409, 'export_changed_review_again');
        if (current.public_token)
            return current;
        return (await client.query(`UPDATE vids_artifacts SET public_token=$3,published_at=now()
      WHERE job_id=$1 AND owner_sub=$2 RETURNING *`, [job, owner, (0, node_crypto_1.randomBytes)(32).toString('hex')])).rows[0];
    });
    const seam = publicLinkSeam(ctx);
    if (!seam || !row.public_token)
        return row;
    try {
        await seam.publish(row.public_token);
        return row;
    }
    catch (error) {
        logger.error({ err: error, jobId: job }, 'Vids public link refused by the kernel; unpublishing the export again');
        await rollBackPublish(ctx, owner, job, row.public_token);
        throw new ArtifactRefusal(503, 'public_link_unavailable');
    }
}
/** Restore the row the kernel will never serve to unpublished; only the token this request minted is cleared. */
async function rollBackPublish(ctx, owner, job, token) {
    try {
        await ctx.pool.query(`UPDATE vids_artifacts SET public_token=NULL,published_at=NULL
      WHERE job_id=$1 AND owner_sub=$2 AND public_token=$3`, [job, owner, token]);
    }
    catch (error) {
        logger.error({ err: error, jobId: job }, 'Vids export stayed published after the kernel refused its link');
    }
}
/**
 * @description Clear the owner's public token, then withdraw that token at the kernel's link seam. The row is
 * cleared first: once it commits no read serves the bytes on either installation, so a refused withdrawal is
 * logged rather than failing the owner's revoke.
 * @param ctx - The package context, with the seam when the native kernel supplies one.
 * @param owner - The admitted owner.
 * @param job - The job whose export is revoked.
 * @returns The unpublished row.
 */
async function unpublishArtifact(ctx, owner, job) {
    let cleared = null;
    const row = await withJob(ctx, owner, job, async (client) => {
        const before = (await client.query('SELECT public_token FROM vids_artifacts WHERE job_id=$1 AND owner_sub=$2', [job, owner])).rows[0];
        if (!before)
            throw new ArtifactRefusal(404, 'export_not_found');
        cleared = before.public_token ?? null;
        return (await client.query(`UPDATE vids_artifacts SET public_token=NULL,published_at=NULL
      WHERE job_id=$1 AND owner_sub=$2 RETURNING *`, [job, owner])).rows[0];
    });
    const seam = publicLinkSeam(ctx);
    if (seam && cleared) {
        try {
            await seam.revoke(cleared);
        }
        catch (error) {
            logger.error({ err: error, jobId: job }, 'Vids public link withdrawal refused by the kernel; the export is already unpublished');
        }
    }
    return row;
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