"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECT_ACTIONS = void 0;
exports.projectOwner = projectOwner;
exports.registerCreateProjectAuthorization = registerCreateProjectAuthorization;
exports.requireProjectAccess = requireProjectAccess;
exports.projectPermissions = projectPermissions;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Repeat named project permissions with verified issuer-qualified personal ownership and no administrative row bypass.
 */
const create_project_types_1 = require("./create-project-types");
exports.PROJECT_ACTIONS = ['view', 'read', 'create', 'change', 'delete', 'export'];
/** Only the framework's active execution actor establishes ownership. */
function projectOwner(ctx) {
    const actor = ctx.authorization?.currentActor();
    if (!actor?.isActive || typeof actor.issuer !== 'string' || typeof actor.sub !== 'string'
        || !actor.issuer.trim() || !actor.sub.trim() || actor.issuer.length > 2048 || actor.sub.length > 2048) {
        throw new create_project_types_1.ProjectError(401, 'project_verified_identity_required');
    }
    return Object.freeze({ issuer: actor.issuer, sub: actor.sub });
}
/** Collection grants remain own-only; every actual project/asset SQL statement checks both owner fields. */
function registerCreateProjectAuthorization(ctx) {
    if (!ctx.authorization)
        throw new Error('Create projects require application-authorization');
    ctx.authorization.registerResource('projects', { authorize: async ({ actor, operation, grant }) => actor.isActive && !!actor.issuer && !!actor.sub && grant.scope === 'own' && !operation.tenantId });
}
/** Re-read current policy immediately before work and transaction commit. */
async function requireProjectAccess(ctx, action, expected) {
    const owner = projectOwner(ctx);
    if (expected && (owner.issuer !== expected.issuer || owner.sub !== expected.sub))
        throw new create_project_types_1.ProjectError(401, 'project_identity_changed');
    const required = new Set(['view', ...(action === 'export' ? ['read', 'export'] : action === 'upload' ? [] : [action])]);
    for (const permission of required) {
        if (!(await ctx.authorization.authorize({ permission: `project.${permission}` })).allowed)
            throw new create_project_types_1.ProjectError(403, 'project_permission_denied');
    }
    if (action === 'upload') {
        const create = await ctx.authorization.authorize({ permission: 'project.create' });
        if (!create.allowed && !(await ctx.authorization.authorize({ permission: 'project.change' })).allowed)
            throw new create_project_types_1.ProjectError(403, 'project_permission_denied');
    }
    return owner;
}
/** Report effective actions without converting unavailable authorization into successful access. */
async function projectPermissions(ctx) {
    projectOwner(ctx);
    return Object.fromEntries(await Promise.all(exports.PROJECT_ACTIONS.map(async (action) => {
        try {
            await requireProjectAccess(ctx, action);
            return [action, true];
        }
        catch {
            return [action, false];
        }
    })));
}
//# sourceMappingURL=create-project-authorization.js.map