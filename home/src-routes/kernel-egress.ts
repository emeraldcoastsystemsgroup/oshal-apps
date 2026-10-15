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

/** The sentinel the routes carry in place of a token under the kernel: the kernel, not the package, holds the credential. */
export const KERNEL_TOKEN = 'kernel';

/** One saved connection as the kernel describes it: never a credential. */
interface ConnectionMetadata { provider?: string; revoked?: boolean; expires_at_ms?: number | null; renewable?: boolean }

/** The connectors.metadata answer. */
export interface ConnectionsAnswer { connections?: ConnectionMetadata[] }

/**
 * @description True inside the native kernel's package sandbox, where the manifest's egress declaration carries the
 * SmartThings credential.
 * @returns Whether SmartThings requests go through the kernel egress.
 */
export function kernelEgress(): boolean {
  return process.env.OSHAL_EGRESS === 'kernel';
}

/**
 * @description Read the caller's saved connections from the kernel (metadata only). A context without the intent, or a
 * refused intent, answers null: the state is then unknown and the provider request itself decides.
 * @param ctx - The application context; the native bridge carries `intent`.
 * @returns The connectors.metadata answer, or null.
 */
export async function readConnections(ctx: unknown): Promise<ConnectionsAnswer | null> {
  const intent = (ctx as { intent?: (name: string, input: unknown) => Promise<unknown> } | null)?.intent;
  if (typeof intent !== 'function') return null;
  try {
    const answer = await intent.call(ctx, 'connectors.metadata', {});
    return answer && typeof answer === 'object' ? answer as ConnectionsAnswer : null;
  } catch {
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
export function connectionUsable(meta: ConnectionsAnswer | null, connector: string, now = Date.now()): boolean | null {
  if (!meta || !Array.isArray(meta.connections)) return null;
  const rows = meta.connections.filter((c) => String(c?.provider || '').toLowerCase() === connector);
  return rows.some((c) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
}

/**
 * @description True for the kernel egress refusal raised when the caller has no connection for the declared connector.
 * @param err - The rejection from the global fetch.
 * @returns Whether the rejection means "not connected".
 */
export function isNotConnected(err: unknown): boolean {
  return kernelEgress() && /is not connected/i.test(String((err as Error)?.message || ''));
}
