"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacyAccess = legacyAccess;
/** Refuse unavailable authority, identity changes, and roles without legacy access. */
async function legacyAccess(context) {
    try {
        const port = context.authorization;
        const original = port?.currentActor();
        if (original?.isActive !== true || [original.issuer, original.sub, original.principalId].some(value => typeof value !== 'string' || !value.trim() || value.length > 4096)
            || !Array.isArray(original.tenantIds) || original.tenantIds.length !== 1 || typeof original.tenantIds[0] !== 'string' || !original.tenantIds[0].trim())
            return false;
        const identity = JSON.stringify(original);
        const decision = await port.authorize({ permission: 'legacy.access' });
        return decision.allowed === true && JSON.stringify(port.currentActor()) === identity;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=office-authorization.js.map