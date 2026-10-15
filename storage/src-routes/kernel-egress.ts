/**
 * Native-kernel egress helpers for the Storage routes.
 *
 * Inside the native kernel's package sandbox the framework's getValidAccessToken answers null, the
 * framework's oshal_connections table is not the package's to read, and there is no network of the
 * package's own. The manifest declares api.github.com (github connector) and api.dropboxapi.com
 * (dropbox connector), each with the caller's connection applied by the kernel as the Bearer token;
 * the package calls the global fetch with no Authorization header and never sees the credential.
 * This module says whether that path is active, reads the caller's connections from the kernel's
 * connectors.metadata intent (metadata only), and recognizes the kernel's "not connected" refusal.
 * Outside the kernel (OSHAL_EGRESS unset) nothing here changes behaviour.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: kernel egress detection, the caller's usable connections from connectors.metadata (Google aliases reported as google, the name the settings pages read), and the "not connected" refusal test.
 *
 * @module kernel-egress
 */

/** The sentinel the routes carry in place of a token under the kernel: the kernel, not the package, holds the credential. */
export const KERNEL_TOKEN = 'kernel';

/** Connector ids that name the one Google grant; the settings pages know it as `google`. */
const GOOGLE_ALIASES = new Set(['google', 'gmail', 'google-calendar', 'google-drive']);

/** One saved connection as the kernel describes it: never a credential. */
interface ConnectionMetadata { provider?: string; revoked?: boolean; expires_at_ms?: number | null; renewable?: boolean }

/** The connectors.metadata answer. */
export interface ConnectionsAnswer { connections?: ConnectionMetadata[] }

/**
 * @description True inside the native kernel's package sandbox, where the manifest's egress declarations carry the
 * GitHub and Dropbox credentials.
 * @returns Whether provider requests go through the kernel egress.
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

/** A connection is usable unless revoked, or past its expiry with nothing to renew it. */
function usable(c: ConnectionMetadata, now: number): boolean {
  return c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true);
}

/**
 * @description The providers the caller can use, named as the legacy connections table names them (Google aliases
 * become `google`), without duplicates.
 * @param meta - The connectors.metadata answer, or null when unknown.
 * @param now - Clock seam in milliseconds.
 * @returns The usable provider names; empty when the metadata cannot say.
 */
export function usableProviders(meta: ConnectionsAnswer | null, now = Date.now()): string[] {
  if (!meta || !Array.isArray(meta.connections)) return [];
  const names = meta.connections.filter((c) => c && usable(c, now)).map((c) => {
    const id = String(c.provider || '').toLowerCase();
    return GOOGLE_ALIASES.has(id) ? 'google' : id;
  }).filter(Boolean);
  return [...new Set(names)];
}

/**
 * @description Whether the caller may use one connector, from the metadata.
 * @param meta - The connectors.metadata answer, or null when unknown.
 * @param connector - The connector id (`github` or `dropbox`).
 * @param now - Clock seam in milliseconds.
 * @returns True or false when the metadata says, null when it cannot.
 */
export function connectionUsable(meta: ConnectionsAnswer | null, connector: string, now = Date.now()): boolean | null {
  if (!meta || !Array.isArray(meta.connections)) return null;
  return meta.connections.some((c) => String(c?.provider || '').toLowerCase() === connector && usable(c, now));
}

/**
 * @description True for the kernel egress refusal raised when the caller has no connection for the declared connector.
 * @param err - The rejection from the global fetch.
 * @returns Whether the rejection means "not connected".
 */
export function isNotConnected(err: unknown): boolean {
  return kernelEgress() && /is not connected/i.test(String((err as Error)?.message || ''));
}
