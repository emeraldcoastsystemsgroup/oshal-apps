"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateRegionEditStore = exports.REGION_EDIT_STUCK_MINUTES = void 0;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exact-owner region edit records: admission (one in flight per person, a rolling daily ceiling), completion only while still generating, cancel/reject that never touch the project, and acceptance that appends one child revision under the project's optimistic revision lock in the same transaction that marks the edit accepted.
 */
const node_crypto_1 = require("node:crypto");
const create_project_types_1 = require("./create-project-types");
/** A request still "generating" this long after its last update was interrupted (restart or a hung provider). */
exports.REGION_EDIT_STUCK_MINUTES = 10;
const COLUMNS = `e.edit_id,e.project_id,e.source_revision,e.layer_id,e.source_asset_id,e.selection,e.instruction,e.status,
  e.result_asset_id,a.width,a.height,e.accepted_revision,e.provider,e.model,e.cost_usd,e.error,e.created_at,e.updated_at,
  (e.status='generating' AND e.updated_at < NOW() - INTERVAL '${exports.REGION_EDIT_STUCK_MINUTES} minutes') AS stale`;
const FROM = `FROM create_region_edits e LEFT JOIN create_project_assets a
  ON a.asset_id=e.result_asset_id AND a.owner_issuer=e.owner_issuer AND a.owner_sub=e.owner_sub`;
function record(row) {
    const interrupted = row.stale;
    return { id: row.edit_id, projectId: row.project_id, sourceRevision: row.source_revision, layerId: row.layer_id,
        sourceAssetId: row.source_asset_id, selection: row.selection, instruction: row.instruction,
        status: interrupted ? 'failed' : row.status, error: interrupted ? 'region_edit_interrupted' : row.error,
        resultAsset: row.result_asset_id && row.width && row.height
            ? { id: row.result_asset_id, src: create_project_types_1.PROJECT_ASSET_PREFIX + row.result_asset_id, width: row.width, height: row.height } : null,
        acceptedRevision: row.accepted_revision, provider: row.provider, model: row.model,
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
        createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
/** Every statement repeats both owner columns; the table's forced exact-owner policy is the second wall. */
class CreateRegionEditStore {
    projects;
    constructor(projects) {
        this.projects = projects;
    }
    async select(client, owner, projectId, editId, lock = false) {
        const result = await client.query(`SELECT ${COLUMNS} ${FROM} WHERE e.owner_issuer=$1 AND e.owner_sub=$2 AND e.project_id=$3 AND e.edit_id=$4${lock ? ' FOR UPDATE OF e' : ''}`, [owner.issuer, owner.sub, projectId, editId]);
        if (!result.rows[0])
            throw new create_project_types_1.ProjectError(404, 'region_edit_not_found');
        return result.rows[0];
    }
    /** Persist the interruption the reads already report, so a stuck request stops counting as in flight. */
    async sweep(client, owner) {
        await client.query(`UPDATE create_region_edits SET status='failed',error='region_edit_interrupted',updated_at=NOW()
      WHERE owner_issuer=$1 AND owner_sub=$2 AND status='generating' AND updated_at < NOW() - INTERVAL '${exports.REGION_EDIT_STUCK_MINUTES} minutes'`, [owner.issuer, owner.sub]);
    }
    /**
     * @description Admit one request against a real source revision: one generation in flight per person and a rolling 24-hour ceiling.
     * @param owner - Verified owner. @param request - Validated request. @param dailyCap - Requests allowed per rolling day.
     * @param confirm - Current-permission re-check before commit.
     * @returns The new generating record.
     */
    async create(owner, request, dailyCap, confirm) {
        return this.projects.transaction(owner, true, async (client) => {
            await this.projects.ownerLock(client, owner);
            await this.sweep(client, owner);
            const counts = await client.query(`SELECT COUNT(*) FILTER (WHERE status='generating')::int AS active,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS recent FROM create_region_edits WHERE owner_issuer=$1 AND owner_sub=$2`, [owner.issuer, owner.sub]);
            if (counts.rows[0].active > 0)
                throw new create_project_types_1.ProjectError(409, 'region_edit_in_progress');
            if (counts.rows[0].recent >= dailyCap)
                throw new create_project_types_1.ProjectError(429, 'region_edit_daily_limit');
            const id = (0, node_crypto_1.randomUUID)();
            await client.query(`INSERT INTO create_region_edits (edit_id,project_id,owner_issuer,owner_sub,source_revision,layer_id,source_asset_id,selection,instruction)
        VALUES ($3,$4,$1,$2,$5,$6,$7,$8::jsonb,$9)`, [owner.issuer, owner.sub, id, request.projectId, request.sourceRevision,
                request.layerId, request.sourceAssetId, JSON.stringify(request.selection), request.instruction]);
            return record(await this.select(client, owner, request.projectId, id));
        }, confirm);
    }
    /**
     * @description Read one of the owner's region edits; an interrupted one reads as failed.
     * @param owner - Verified owner. @param projectId - Project. @param editId - Edit.
     * @returns The record; another owner's or an unknown edit is 404.
     */
    async get(owner, projectId, editId) {
        return this.projects.transaction(owner, false, async (client) => record(await this.select(client, owner, projectId, editId)));
    }
    /**
     * @description Attach the composited candidate, but only while the request is still generating (a cancelled one stays cancelled).
     * @param owner - Verified owner. @param projectId - Project. @param editId - Edit. @param result - Candidate raster and provider facts.
     * @param confirm - Current-permission re-check before commit.
     * @returns True when the candidate was attached.
     */
    async complete(owner, projectId, editId, result, confirm) {
        return this.projects.transaction(owner, true, async (client) => {
            const updated = await client.query(`UPDATE create_region_edits SET status='ready',result_asset_id=$5,provider=$6,model=$7,cost_usd=$8,updated_at=NOW()
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND edit_id=$4 AND status='generating'`, [owner.issuer, owner.sub, projectId, editId, result.asset.id, result.provider.slice(0, 200), result.model.slice(0, 200), result.costUsd]);
            return (updated.rowCount ?? 0) === 1;
        }, confirm);
    }
    /**
     * @description Record a failure code for a request that is still generating; the project is never touched.
     * @param owner - Verified owner. @param projectId - Project. @param editId - Edit. @param code - Stable error code.
     * @returns void
     */
    async fail(owner, projectId, editId, code) {
        const safe = /^[a-z0-9_]{1,80}$/.test(code) ? code : 'region_edit_failed';
        await this.projects.transaction(owner, true, async (client) => {
            await client.query(`UPDATE create_region_edits SET status='failed',error=$5,updated_at=NOW()
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND edit_id=$4 AND status='generating'`, [owner.issuer, owner.sub, projectId, editId, safe]);
        });
    }
    /**
     * @description Stop waiting for a generating request (cancel) or discard a ready candidate (reject); neither touches the project.
     * @param owner - Verified owner. @param projectId - Project. @param editId - Edit. @param action - cancel or reject.
     * @param confirm - Current-permission re-check before commit.
     * @returns The updated record.
     */
    async close(owner, projectId, editId, action, confirm) {
        return this.projects.transaction(owner, true, async (client) => {
            const row = await this.select(client, owner, projectId, editId, true), from = action === 'cancel' ? 'generating' : 'ready';
            if (row.status !== from || row.stale)
                throw new create_project_types_1.ProjectError(409, action === 'cancel' ? 'region_edit_not_cancellable' : 'region_edit_not_ready');
            await client.query(`UPDATE create_region_edits SET status=$5,result_asset_id=NULL,updated_at=NOW()
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND edit_id=$4`, [owner.issuer, owner.sub, projectId, editId, action === 'cancel' ? 'cancelled' : 'rejected']);
            return record(await this.select(client, owner, projectId, editId));
        }, confirm);
    }
    /**
     * @description Turn a ready candidate into the project's next revision, only on top of the exact revision the person is looking at.
     * @param owner - Verified owner. @param projectId - Project. @param editId - Edit. @param expected - The current revision the browser holds.
     * @param derive - Builds the child document from the current revision; refuses a stale or locked target.
     * @param confirm - Current-permission re-check before commit.
     * @returns The new project snapshot.
     */
    async accept(owner, projectId, editId, expected, derive, confirm) {
        return this.projects.transaction(owner, true, async (client) => {
            await this.projects.ownerLock(client, owner);
            const row = await this.select(client, owner, projectId, editId, true);
            if (row.status !== 'ready' || row.stale)
                throw new create_project_types_1.ProjectError(409, 'region_edit_not_ready');
            await this.projects.lockProject(client, owner, projectId, expected);
            if (expected >= create_project_types_1.PROJECT_LIMITS.revisions)
                throw new create_project_types_1.ProjectError(409, 'project_revision_limit_reached');
            const current = await client.query(`SELECT title,document FROM create_project_revisions
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND revision=$4`, [owner.issuer, owner.sub, projectId, expected]);
            if (!current.rows[0])
                throw new create_project_types_1.ProjectError(404, 'project_not_found');
            const snapshot = await this.projects.appendRevision(client, owner, projectId, expected, derive(current.rows[0], record(row)));
            await client.query(`UPDATE create_region_edits SET status='accepted',accepted_revision=$5,updated_at=NOW()
        WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND edit_id=$4 AND status='ready'`, [owner.issuer, owner.sub, projectId, editId, snapshot.revision]);
            return snapshot;
        }, confirm);
    }
}
exports.CreateRegionEditStore = CreateRegionEditStore;
//# sourceMappingURL=create-region-edit-store.js.map