"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateBrandKitStore = exports.BRAND_REVISION_LIMIT = void 0;
const create_project_types_1 = require("./create-project-types");
exports.BRAND_REVISION_LIMIT = 100000;
function record(row) {
    return { kit: row.kit, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() };
}
/** The same per-owner advisory key the project store takes, so a logo reference and an unused-asset
 * cleanup for one person can never interleave. */
async function ownerLock(client, owner) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([owner.issuer, owner.sub])]);
}
async function currentRevision(client, owner) {
    const result = await client.query('SELECT revision FROM create_brand_kits WHERE owner_issuer=$1 AND owner_sub=$2 FOR UPDATE', [owner.issuer, owner.sub]);
    return result.rows[0]?.revision ?? 0;
}
async function checkLogo(client, owner, logo) {
    const result = await client.query('SELECT width,height FROM create_project_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3', [owner.issuer, owner.sub, logo.id]);
    const row = result.rows[0];
    if (!row || row.width !== logo.width || row.height !== logo.height)
        throw new create_project_types_1.ProjectError(400, 'brand_logo_unavailable');
}
/** One row per verified issuer and subject; every statement names both owner fields. */
class CreateBrandKitStore {
    projects;
    constructor(projects) {
        this.projects = projects;
    }
    async get(owner) {
        return this.projects.transaction(owner, false, async (client) => {
            const result = await client.query('SELECT kit,revision,updated_at FROM create_brand_kits WHERE owner_issuer=$1 AND owner_sub=$2', [owner.issuer, owner.sub]);
            return result.rows[0] ? record(result.rows[0]) : null;
        });
    }
    /** `expected` is the revision the page last read: 0 for a first save. A stale page gets 409. */
    async save(owner, expected, kit, logo, confirm) {
        return this.projects.transaction(owner, true, async (client) => {
            await ownerLock(client, owner);
            const revision = await currentRevision(client, owner);
            if (revision !== expected)
                throw new create_project_types_1.ProjectError(409, 'brand_revision_conflict');
            if (revision >= exports.BRAND_REVISION_LIMIT)
                throw new create_project_types_1.ProjectError(409, 'brand_revision_limit_reached');
            if (logo)
                await checkLogo(client, owner, logo);
            const result = revision === 0
                ? await client.query(`INSERT INTO create_brand_kits (owner_issuer,owner_sub,kit,logo_asset_id) VALUES ($1,$2,$3::jsonb,$4)
            RETURNING kit,revision,updated_at`, [owner.issuer, owner.sub, JSON.stringify(kit), logo?.id ?? null])
                : await client.query(`UPDATE create_brand_kits SET kit=$3::jsonb,logo_asset_id=$4,revision=revision+1,updated_at=NOW()
            WHERE owner_issuer=$1 AND owner_sub=$2 AND revision=$5 RETURNING kit,revision,updated_at`, [owner.issuer, owner.sub, JSON.stringify(kit), logo?.id ?? null, expected]);
            if (!result.rows.length)
                throw new create_project_types_1.ProjectError(409, 'brand_revision_conflict');
            return record(result.rows[0]);
        }, confirm);
    }
    async delete(owner, expected, confirm) {
        await this.projects.transaction(owner, true, async (client) => {
            await ownerLock(client, owner);
            const revision = await currentRevision(client, owner);
            if (!revision)
                throw new create_project_types_1.ProjectError(404, 'brand_kit_not_found');
            if (revision !== expected)
                throw new create_project_types_1.ProjectError(409, 'brand_revision_conflict');
            await client.query('DELETE FROM create_brand_kits WHERE owner_issuer=$1 AND owner_sub=$2 AND revision=$3', [owner.issuer, owner.sub, expected]);
        }, confirm);
    }
}
exports.CreateBrandKitStore = CreateBrandKitStore;
//# sourceMappingURL=create-brand-kit-store.js.map