"use strict";
/**
 * Native-kernel egress helpers for the Smart Home routes.
 *
 * Inside the native kernel's package sandbox the framework's getValidAccessToken answers null and
 * there is no network of the package's own. The manifest declares api.smartthings.com with the
 * caller's smartthings connection, which the kernel applies as the Bearer token; the package calls
 * the global fetch with no Authorization header and never sees the credential. This module says
 * whether that path is active, reads the caller's connection state from the kernel's
 * connectors.metadata intent (metadata only), and recognizes the kernel's "not connected" refusal.
 * Outside the kernel (OSHAL_EGRESS unset) nothing here changes behaviour.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: kernel egress detection, the SmartThings connection state from connectors.metadata, and the "not connected" refusal test used by /control, /scene/run and /refresh.
 *
 * @module kernel-egress
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KERNEL_TOKEN = void 0;
exports.kernelEgress = kernelEgress;
exports.readConnections = readConnections;
exports.connectionUsable = connectionUsable;
exports.isNotConnected = isNotConnected;
/** The sentinel the routes carry in place of a token under the kernel: the kernel, not the package, holds the credential. */
exports.KERNEL_TOKEN = 'kernel';
/**
 * @description True inside the native kernel's package sandbox, where the manifest's egress declaration carries the
 * SmartThings credential.
 * @returns Whether SmartThings requests go through the kernel egress.
 */
function kernelEgress() {
    return process.env.OSHAL_EGRESS === 'kernel';
}
/**
 * @description Read the caller's saved connections from the kernel (metadata only). A context without the intent, or a
 * refused intent, answers null: the state is then unknown and the provider request itself decides.
 * @param ctx - The application context; the native bridge carries `intent`.
 * @returns The connectors.metadata answer, or null.
 */
async function readConnections(ctx) {
    const intent = ctx?.intent;
    if (typeof intent !== 'function')
        return null;
    try {
        const answer = await intent.call(ctx, 'connectors.metadata', {});
        return answer && typeof answer === 'object' ? answer : null;
    }
    catch {
        return null;
    }
}
/**
 * @description Whether the caller may use one connector, from the metadata. Usable unless revoked, or past its expiry
 * with nothing to renew it.
 * @param meta - The connectors.metadata answer, or null when unknown.
 * @param connector - The connector id (for example `smartthings`).
 * @param now - Clock seam in milliseconds.
 * @returns True or false when the metadata says, null when it cannot.
 */
function connectionUsable(meta, connector, now = Date.now()) {
    if (!meta || !Array.isArray(meta.connections))
        return null;
    const rows = meta.connections.filter((c) => String(c?.provider || '').toLowerCase() === connector);
    return rows.some((c) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
}
/**
 * @description True for the kernel egress refusal raised when the caller has no connection for the declared connector.
 * @param err - The rejection from the global fetch.
 * @returns Whether the rejection means "not connected".
 */
function isNotConnected(err) {
    return kernelEgress() && /is not connected/i.test(String(err?.message || ''));
}
//# sourceMappingURL=kernel-egress.js.map