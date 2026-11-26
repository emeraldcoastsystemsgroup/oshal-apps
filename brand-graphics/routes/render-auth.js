"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertPersonalScopeOnly = assertPersonalScopeOnly;
exports.requireRenderOwner = requireRenderOwner;
const render_types_1 = require("./render-types");
const SPOOF_KEYS = new Set([
    'tenant', 'tenantId', 'owner', 'ownerKey', 'ownerSub', 'userSub', 'issuer', 'principalId', 'workspace',
]);
const SPOOF_HEADERS = ['x-oshal-tenant-id', 'x-tenant-id'];
function assertPersonalScopeOnly(req) {
    const query = (req.query || {});
    for (const key of Object.keys(query)) {
        if (SPOOF_KEYS.has(key))
            throw new render_types_1.RenderError(400, 'personal_scope_only', 'Personal scope cannot be overridden.');
    }
    const body = req.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        for (const key of Object.keys(body)) {
            if (SPOOF_KEYS.has(key))
                throw new render_types_1.RenderError(400, 'personal_scope_only', 'Personal scope cannot be overridden.');
        }
    }
    for (const header of SPOOF_HEADERS) {
        if (req.headers?.[header] !== undefined) {
            throw new render_types_1.RenderError(400, 'personal_scope_only', 'Tenant override headers are not permitted.');
        }
    }
}
async function requireRenderOwner(ctx, req, permissions) {
    assertPersonalScopeOnly(req);
    if (ctx?.authorization && typeof ctx.authorization.currentActor === 'function') {
        const actor = ctx.authorization.currentActor();
        if (!actor || actor.isActive !== true || typeof actor.issuer !== 'string' || !actor.issuer || typeof actor.sub !== 'string' || !actor.sub) {
            throw new render_types_1.RenderError(401, 'not_authenticated', 'Sign in to use Brand Graphics renders.');
        }
        if (typeof ctx.authorization.authorize === 'function') {
            for (const permission of permissions) {
                const decision = await ctx.authorization.authorize({ permission });
                if (decision?.allowed !== true) {
                    throw new render_types_1.RenderError(403, 'permission_denied', `Missing required permission: ${permission}`);
                }
            }
        }
        return { issuer: actor.issuer, sub: actor.sub };
    }
    const oidc = req.oidc;
    const sub = oidc?.user?.sub || oidc?.user?.oid;
    if (!sub || oidc?.isAuthenticated?.() !== true) {
        throw new render_types_1.RenderError(401, 'not_authenticated', 'Sign in to use Brand Graphics renders.');
    }
    return { issuer: String(oidc.user.iss || 'local-oidc'), sub: String(sub) };
}
