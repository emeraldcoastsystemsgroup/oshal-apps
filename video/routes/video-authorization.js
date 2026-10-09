"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDITOR_ACTIONS = void 0;
exports.registerVideoAuthorization = registerVideoAuthorization;
exports.editorOwner = editorOwner;
exports.requireEditorAccess = requireEditorAccess;
exports.editorPermissions = editorPermissions;
const video_editor_types_1 = require("./video-editor-types");
exports.EDITOR_ACTIONS = ['view', 'read', 'create', 'change', 'delete', 'export'];
/** Own scope only: an active verified actor, a grant scoped to its owner, and no shared tenant selector. */
const ownOnly = { authorize: async ({ actor, operation, grant }) => actor.isActive && !!actor.issuer && !!actor.sub && grant.scope === 'own' && !operation.tenantId };
/**
 * @description Register both catalog resources for this package. Adapters are per application, so the
 * editor factory registering them during activation covers the studio, pump, summary and readiness
 * mounts too; those route files are unchanged. Without a framework authorization context (a unit
 * fixture) there is nothing to register.
 * @param authorization - This package's authorization context, when the framework supplies one.
 * @returns void
 */
function registerVideoAuthorization(authorization) {
    if (!authorization)
        return;
    authorization.registerResource('studio', ownOnly);
    authorization.registerResource('editor', ownOnly);
}
/**
 * @description The only source of editor ownership: the framework's active execution actor.
 * @param ctx - Editor context. @returns The verified issuer and subject.
 */
function editorOwner(ctx) {
    const actor = ctx.authorization?.currentActor();
    if (!actor?.isActive || typeof actor.issuer !== 'string' || typeof actor.sub !== 'string'
        || !actor.issuer.trim() || !actor.sub.trim() || actor.issuer.length > 2048 || actor.sub.length > 2048) {
        throw new video_editor_types_1.EditorError(401, 'video_edit_verified_identity_required');
    }
    return Object.freeze({ issuer: actor.issuer, sub: actor.sub });
}
async function allowed(ctx, permission) {
    return (await ctx.authorization.authorize({ permission })).allowed;
}
/**
 * @description Re-read the caller's current named editor permissions; used before work and again before commit.
 * @param ctx - Editor context. @param action - Editor action. @param expected - The owner the work started as.
 * @returns The (unchanged) owner.
 */
async function requireEditorAccess(ctx, action, expected) {
    const owner = editorOwner(ctx);
    if (expected && (owner.issuer !== expected.issuer || owner.sub !== expected.sub))
        throw new video_editor_types_1.EditorError(401, 'video_edit_identity_changed');
    const required = ['view', ...(action === 'export' ? ['read', 'export'] : action === 'upload' || action === 'view' ? [] : [action])];
    for (const permission of required)
        if (!(await allowed(ctx, `editor.${permission}`)))
            throw new video_editor_types_1.EditorError(403, 'video_edit_permission_denied');
    if (action === 'upload' && !(await allowed(ctx, 'editor.create')) && !(await allowed(ctx, 'editor.change'))) {
        throw new video_editor_types_1.EditorError(403, 'video_edit_permission_denied');
    }
    return owner;
}
/**
 * @description Report the caller's effective editor actions without turning an unavailable check into access.
 * @param ctx - Editor context. @returns Action to boolean.
 */
async function editorPermissions(ctx) {
    editorOwner(ctx);
    return Object.fromEntries(await Promise.all(exports.EDITOR_ACTIONS.map(async (action) => {
        try {
            await requireEditorAccess(ctx, action);
            return [action, true];
        }
        catch {
            return [action, false];
        }
    })));
}
