"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoEditorStore = void 0;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exact-owner persistence for the manual video editor: one short transaction per operation stamped with the verified owner for the forced policy, every statement also naming both owner columns, optimistic baseRevision saves under the project row lock, 100 retained revisions, media references verified against the owner's immutable uploads, and per-owner quotas serialized by an owner advisory lock.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: the owner lock is shared with the export store, and revision retention never retires a revision a queued or running export is rendering (the export row would otherwise cascade away mid-encode).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Deleting a project returns the exports its rows cascade away, so the route can stop their jobs and remove their files; before this a deleted project left its export files on disk with no row that could ever reach them.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: delete one owned upload that no retained revision uses (a mistaken import, or an acceptance run's own fixture), file first and then its row, under the owner lock; one a revision still uses is refused.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Use the explicitly declared native full-read-set revision CAS while retaining PostgreSQL advisory admission.
 */
const node_crypto_1 = require("node:crypto");
const video_editor_write_gate_1 = require("./video-editor-write-gate");
const video_editor_types_1 = require("./video-editor-types");
const METADATA = 'project_id,title,current_revision,created_at,updated_at';
const MEDIA = 'asset_id,kind,byte_length,sha256,container,video_codec,audio_codec,width,height,frames,duration_ms,has_audio';
function metadata(row) {
    return { id: row.project_id, title: row.title, revision: row.current_revision,
        createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
function media(row) {
    return { id: row.asset_id, kind: row.kind, bytes: Number(row.byte_length), sha256: row.sha256, container: row.container, videoCodec: row.video_codec,
        audioCodec: row.audio_codec, width: row.width, height: row.height, frames: row.frames, durationMs: row.duration_ms, hasAudio: row.has_audio };
}
/** @description Every source a document references must be one of the owner's uploads with exactly the recorded metadata. */
function sameMedia(source, row) {
    if (!row || row.kind !== source.kind || row.frames !== source.frames)
        return false;
    if (source.kind === 'audio')
        return true;
    return row.width === source.width && row.height === source.height && row.has_audio === source.audio;
}
/** One transaction scopes SQL and the forced policy to the verified owner; there is no system or admin path. */
class VideoEditorStore {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * @description Run work in one short transaction stamped with the owner; writes are admitted one at a time
     * before checkout and re-authorized before work and before commit.
     * @param owner - Verified owner. @param write - Read-write when true. @param work - The statements.
     * @param confirm - Current-authorization recheck. @returns The work's result.
     */
    async transaction(owner, write, work, confirm) {
        const release = write ? await (0, video_editor_write_gate_1.acquireEditorWrite)(this.pool) : () => undefined;
        try {
            if (write && confirm)
                await confirm();
            const client = await this.pool.connect();
            let discard = false;
            try {
                await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
                await client.query("SET LOCAL statement_timeout = '5s'");
                await client.query("SET LOCAL lock_timeout = '2s'");
                await client.query("SELECT set_config('video.owner_issuer',$1,true),set_config('video.owner_sub',$2,true)", [owner.issuer, owner.sub]);
                const result = await work(client);
                if (confirm)
                    await confirm();
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
                throw error;
            }
            finally {
                client.release(discard);
            }
        }
        finally {
            release();
        }
    }
    /**
     * @description Serialize one owner's admissions (quotas, active-job checks) inside the current transaction.
     * @param client - Transaction client. @param owner - Verified owner. @returns void
     */
    async ownerLock(client, owner) {
        const native = client;
        // Native COMMIT checks the complete read set atomically; conflicting quota admissions refuse instead of waiting.
        if (native.storageModel === 'kernel-scoped-documents' && native.transactionMode === 'optimistic-serializable')
            return;
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['video-edit', owner.issuer, owner.sub])]);
    }
    async lockProject(client, owner, id, expected) {
        const result = await client.query(`SELECT ${METADATA} FROM video_edit_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 FOR UPDATE`, [owner.issuer, owner.sub, id]);
        if (!result.rows[0])
            throw new video_editor_types_1.EditorError(404, 'video_edit_project_not_found');
        if (result.rows[0].current_revision !== expected)
            throw new video_editor_types_1.EditorError(409, 'video_edit_revision_conflict');
    }
    /** Verify every referenced upload is the owner's, matches the document's metadata, and the project's media stay within 200 MiB. */
    async checkMedia(client, owner, input) {
        const sources = Object.values(input.document.sources), ids = [...new Set(sources.map(source => source.asset))];
        if (!ids.length)
            return [];
        const result = await client.query(`SELECT ${MEDIA} FROM video_edit_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=ANY($3::uuid[])`, [owner.issuer, owner.sub, ids]);
        const rows = new Map(result.rows.map(row => [row.asset_id, row]));
        if (sources.some(source => !sameMedia(source, rows.get(source.asset))))
            throw new video_editor_types_1.EditorError(400, 'video_edit_media_unavailable');
        if (result.rows.reduce((sum, row) => sum + Number(row.byte_length), 0) > video_editor_types_1.EDITOR_LIMITS.projectMediaBytes)
            throw new video_editor_types_1.EditorError(409, 'video_edit_project_media_limit');
        return ids;
    }
    async appendRevision(client, owner, id, revision, input) {
        const ids = await this.checkMedia(client, owner, input);
        await client.query('INSERT INTO video_edit_revisions (project_id,owner_issuer,owner_sub,revision,title,profile,document) VALUES ($3,$1,$2,$4,$5,$6,$7::jsonb)', [owner.issuer, owner.sub, id, revision, input.title, input.document.profile, JSON.stringify(input.document)]);
        if (ids.length) {
            await client.query('INSERT INTO video_edit_revision_assets (project_id,revision,owner_issuer,owner_sub,asset_id) SELECT $3,$4,$1,$2,unnest($5::uuid[])', [owner.issuer, owner.sub, id, revision, ids]);
        }
        // Retain the newest 100 revisions; their media references go with them, releasing unused uploads for cleanup.
        await client.query(`DELETE FROM video_edit_revisions r WHERE r.owner_issuer=$1 AND r.owner_sub=$2 AND r.project_id=$3 AND r.revision<=$4
      AND NOT EXISTS (SELECT 1 FROM video_edit_exports e WHERE e.owner_issuer=$1 AND e.owner_sub=$2 AND e.project_id=$3
        AND e.revision=r.revision AND e.status IN ('queued','running'))`, [owner.issuer, owner.sub, id, revision - video_editor_types_1.EDITOR_LIMITS.retainedRevisions]);
    }
    /** @description The owner's projects, newest first (metadata only). @param owner - Verified owner. @returns Up to 200 projects. */
    async list(owner) {
        return this.transaction(owner, false, async (client) => (await client.query(`SELECT ${METADATA} FROM video_edit_projects
      WHERE owner_issuer=$1 AND owner_sub=$2 ORDER BY updated_at DESC,project_id LIMIT ${video_editor_types_1.EDITOR_LIMITS.projects}`, [owner.issuer, owner.sub])).rows.map(metadata));
    }
    /** @description One retained revision (the current one by default). @param owner - Owner. @param id - Project. @param revision - Optional revision. @returns Snapshot. */
    async get(owner, id, revision) {
        return this.transaction(owner, false, async (client) => {
            const result = await client.query(`SELECT p.project_id,r.title,r.revision AS current_revision,p.created_at,r.created_at AS updated_at,r.document
        FROM video_edit_projects p JOIN video_edit_revisions r ON r.project_id=p.project_id AND r.owner_issuer=p.owner_issuer AND r.owner_sub=p.owner_sub
        WHERE p.owner_issuer=$1 AND p.owner_sub=$2 AND p.project_id=$3 AND r.revision=COALESCE($4,p.current_revision)`, [owner.issuer, owner.sub, id, revision ?? null]);
            const row = result.rows[0];
            if (!row?.document)
                throw new video_editor_types_1.EditorError(404, 'video_edit_project_not_found');
            return { ...metadata(row), document: row.document };
        });
    }
    /** @description Retained revision history, newest first. @param owner - Owner. @param id - Project. @returns Up to 100 rows. */
    async revisions(owner, id) {
        return this.transaction(owner, false, async (client) => {
            const project = await client.query('SELECT 1 FROM video_edit_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3', [owner.issuer, owner.sub, id]);
            if (!project.rows.length)
                throw new video_editor_types_1.EditorError(404, 'video_edit_project_not_found');
            const result = await client.query(`SELECT revision,title,created_at FROM video_edit_revisions
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 ORDER BY revision DESC LIMIT ${video_editor_types_1.EDITOR_LIMITS.retainedRevisions}`, [owner.issuer, owner.sub, id]);
            return result.rows.map(row => ({ revision: row.revision, title: row.title, createdAt: new Date(row.created_at).toISOString() }));
        });
    }
    /** @description Create a project at revision 1. @param owner - Owner. @param input - Validated input. @param confirm - Recheck. @returns Snapshot. */
    async create(owner, input, confirm) {
        return this.transaction(owner, true, async (client) => {
            await this.ownerLock(client, owner);
            const total = await client.query('SELECT COUNT(*)::int AS count FROM video_edit_projects WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
            if (total.rows[0].count >= video_editor_types_1.EDITOR_LIMITS.projects)
                throw new video_editor_types_1.EditorError(409, 'video_edit_project_limit');
            const id = (0, node_crypto_1.randomUUID)();
            const result = await client.query(`INSERT INTO video_edit_projects (project_id,owner_issuer,owner_sub,title) VALUES ($3,$1,$2,$4) RETURNING ${METADATA}`, [owner.issuer, owner.sub, id, input.title]);
            await this.appendRevision(client, owner, id, 1, input);
            return { ...metadata(result.rows[0]), document: input.document };
        }, confirm);
    }
    /** @description Append the next revision only if `expected` is still current. @returns The new snapshot; a newer revision is 409. */
    async save(owner, id, expected, input, confirm) {
        return this.transaction(owner, true, async (client) => {
            await this.ownerLock(client, owner);
            await this.lockProject(client, owner, id, expected);
            if (expected >= video_editor_types_1.EDITOR_LIMITS.revisionNumber)
                throw new video_editor_types_1.EditorError(409, 'video_edit_revision_limit');
            await this.appendRevision(client, owner, id, expected + 1, input);
            const result = await client.query(`UPDATE video_edit_projects SET title=$4,current_revision=$5,updated_at=NOW()
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND current_revision=$6 RETURNING ${METADATA}`, [owner.issuer, owner.sub, id, input.title, expected + 1, expected]);
            if (!result.rows.length)
                throw new video_editor_types_1.EditorError(409, 'video_edit_revision_conflict');
            return { ...metadata(result.rows[0]), document: input.document };
        }, confirm);
    }
    /**
     * @description Delete a project (its revisions and export rows cascade) only at the revision the caller saw.
     * @returns The IDs of the exports that went with it, so their jobs can be stopped and their files removed.
     */
    async delete(owner, id, expected, confirm) {
        return this.transaction(owner, true, async (client) => {
            await this.ownerLock(client, owner);
            await this.lockProject(client, owner, id, expected);
            const exports = await client.query('SELECT export_id FROM video_edit_exports WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3', [owner.issuer, owner.sub, id]);
            await client.query('DELETE FROM video_edit_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND current_revision=$4', [owner.issuer, owner.sub, id, expected]);
            return exports.rows.map(row => row.export_id);
        }, confirm);
    }
    /** @description One of the owner's uploads. @param owner - Owner. @param id - Media UUID. @returns Metadata; another owner's is 404. */
    async getMedia(owner, id) {
        return this.transaction(owner, false, async (client) => {
            const result = await client.query(`SELECT ${MEDIA} FROM video_edit_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3`, [owner.issuer, owner.sub, id]);
            if (!result.rows.length)
                throw new video_editor_types_1.EditorError(404, 'video_edit_media_not_found');
            return media(result.rows[0]);
        });
    }
    /** @description Admit one verified upload under the per-owner count and byte quotas. @returns void */
    async addMedia(owner, value, confirm) {
        await this.transaction(owner, true, async (client) => {
            await this.ownerLock(client, owner);
            const total = await client.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_length),0)::text AS bytes FROM video_edit_assets WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
            if (total.rows[0].count >= video_editor_types_1.EDITOR_LIMITS.ownerMedia || Number(total.rows[0].bytes) + value.bytes > video_editor_types_1.EDITOR_LIMITS.ownerMediaBytes)
                throw new video_editor_types_1.EditorError(409, 'video_edit_media_limit');
            await client.query(`INSERT INTO video_edit_assets (${MEDIA},owner_issuer,owner_sub) VALUES ($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$1,$2)`, [owner.issuer, owner.sub, value.id, value.kind, value.bytes, value.sha256, value.container, value.videoCodec, value.audioCodec, value.width, value.height, value.frames, value.durationMs, value.hasAudio]);
        }, confirm);
    }
    /**
     * @description Delete one owned upload that no retained revision uses, file first and then its row.
     * @param owner - Owner. @param id - Media UUID. @param removeFile - Deletes the file. @param confirm - Recheck (delete permission).
     * @returns void; another owner's is 404 and one still in use is 409.
     */
    async deleteMedia(owner, id, removeFile, confirm) {
        await this.transaction(owner, true, async (client) => {
            await this.ownerLock(client, owner);
            const result = await client.query(`SELECT ${MEDIA} FROM video_edit_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3 FOR UPDATE`, [owner.issuer, owner.sub, id]);
            if (!result.rows[0])
                throw new video_editor_types_1.EditorError(404, 'video_edit_media_not_found');
            const used = await client.query('SELECT 1 FROM video_edit_revision_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3 LIMIT 1', [owner.issuer, owner.sub, id]);
            if (used.rows.length)
                throw new video_editor_types_1.EditorError(409, 'video_edit_media_in_use');
            await confirm();
            await removeFile(media(result.rows[0]));
            await client.query('DELETE FROM video_edit_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [owner.issuer, owner.sub, id]);
        }, confirm);
    }
    /**
     * @description Remove uploads older than a day that no retained revision uses, deleting each file before its row.
     * @param owner - Owner. @param removeFile - Deletes one file. @param confirm - Recheck (delete permission). @returns Removed IDs.
     */
    async cleanupMedia(owner, removeFile, confirm) {
        return this.transaction(owner, true, async (client) => {
            await this.ownerLock(client, owner);
            const result = await client.query(`SELECT ${MEDIA} FROM video_edit_assets a WHERE a.owner_issuer=$1 AND a.owner_sub=$2 AND a.created_at<NOW()-INTERVAL '24 hours'
        AND NOT EXISTS (SELECT 1 FROM video_edit_revision_assets r WHERE r.asset_id=a.asset_id AND r.owner_issuer=$1 AND r.owner_sub=$2)
        ORDER BY a.created_at,a.asset_id LIMIT 25 FOR UPDATE`, [owner.issuer, owner.sub]);
            for (const row of result.rows) {
                await confirm();
                await removeFile(media(row));
                await client.query('DELETE FROM video_edit_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [owner.issuer, owner.sub, row.asset_id]);
            }
            return result.rows.map(row => row.asset_id);
        }, confirm);
    }
}
exports.VideoEditorStore = VideoEditorStore;
