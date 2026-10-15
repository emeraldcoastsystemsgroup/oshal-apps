/**
 * Native-kernel connector egress for the Social package.
 *
 * Inside the native kernel's package sandbox there is no network and no connector broker: the
 * framework's getValidAccessToken answers null and the oshal_connections rows are not the package's to
 * read. The kernel instead offers a fenced egress keyed by the manifest: this package declares
 * api.twitter.com (connector twitter), api.linkedin.com (connector linkedin) and graph.facebook.com
 * (connector meta-business), each with the caller's own connection applied by the kernel as a Bearer
 * token. The package sends those requests through the global fetch with no Authorization header and no
 * access_token, and never sees a credential.
 *
 * This module holds what that path needs: which providers the caller has connected (from the kernel's
 * connectors.metadata intent, metadata only), a per-request token lookup that answers the broker token
 * outside the kernel and a sentinel inside it, the request headers each path sends, and recognition of
 * the kernel's "not connected" refusal. Outside the kernel (OSHAL_EGRESS unset) every lookup is the
 * framework broker exactly as before.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: connection state from connectors.metadata, the per-request connector token lookup (broker outside the kernel, sentinel inside), the Bearer header only outside the kernel, the Graph access_token query only outside the kernel, and the kernel "not connected" refusal test.
 *
 * @module kernel-egress
 */

import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';

const logger = createChildLogger({ module: 'social-kernel-egress' });

/** The sentinel token under the kernel: the kernel, not the package, holds the credential. */
export const KERNEL_TOKEN = 'kernel';

/** The connectors this package reads through a token. */
export type SocialConnector = 'twitter' | 'linkedin' | 'meta-business';

/** Connector ids naming one provider's grant in the kernel's connection metadata. */
const CONNECTOR_IDS: Record<SocialConnector, readonly string[]> = {
  twitter: ['twitter', 'x'],
  linkedin: ['linkedin'],
  'meta-business': ['meta-business'],
};

/** What the caller's connection allows, as far as the metadata can tell. */
export type ConnectionState = 'connected' | 'reconnect' | 'none';

/** One saved connection as the kernel describes it: never a credential. */
export interface ConnectionMetadata { provider?: string; revoked?: boolean; expires_at_ms?: number | null; renewable?: boolean }

/** The connectors.metadata answer. */
export interface ConnectionsAnswer { connections?: ConnectionMetadata[] }

/**
 * @description True inside the native kernel's package sandbox, where manifest egress declarations carry the credentials.
 * @returns Whether connector requests go through the kernel egress.
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
  } catch (err) {
    logger.error({ err, stack: err instanceof Error ? err.stack : undefined }, 'connectors.metadata refused');
    return null;
  }
}

/**
 * @description Classify one provider's connection. Usable unless revoked, or past its expiry with nothing to renew it.
 * @param meta - The connectors.metadata answer (or null when unknown).
 * @param ids - The connector ids naming the provider.
 * @param now - Clock seam in milliseconds.
 * @returns The state, or null when the metadata cannot say.
 */
export function connectionState(meta: ConnectionsAnswer | null, ids: readonly string[], now = Date.now()): ConnectionState | null {
  if (!meta || !Array.isArray(meta.connections)) return null;
  const rows = meta.connections.filter((c) => ids.includes(String(c?.provider || '').toLowerCase()));
  if (!rows.length) return 'none';
  const usable = rows.some((c) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
  return usable ? 'connected' : 'reconnect';
}

/**
 * @description The per-request connector token lookup. Outside the kernel it is the framework broker, unchanged. Under
 * the kernel it reads the caller's connection metadata once and answers the sentinel for a usable (or unknown)
 * connection and null for none or a lapsed one, the same null the broker gives when there is nothing to use.
 * @param ctx - The application context.
 * @param sub - The authenticated caller's OIDC subject.
 * @returns The lookup for one connector.
 */
export function connectorTokens(ctx: AppContext, sub: string): (provider: SocialConnector) => Promise<string | null> {
  if (!kernelEgress()) return (provider) => getValidAccessToken(ctx.pool, sub, provider);
  let meta: Promise<ConnectionsAnswer | null> | null = null;
  return async (provider) => {
    meta ||= readConnections(ctx);
    const state = connectionState(await meta, CONNECTOR_IDS[provider]);
    return state === 'none' || state === 'reconnect' ? null : KERNEL_TOKEN;
  };
}

/**
 * @description The Authorization header a request carries: the broker token outside the kernel, nothing under it
 * (the kernel applies the caller's connection and refuses a package-set Authorization).
 * @param token - The looked-up token (the sentinel under the kernel).
 * @returns The header object to spread into the request headers.
 */
export function bearer(token: string): Record<string, string> {
  return token === KERNEL_TOKEN ? {} : { Authorization: `Bearer ${token}` };
}

/**
 * @description The Graph access_token query suffix: the user token outside the kernel, nothing under it.
 * @param token - The looked-up token (the sentinel under the kernel).
 * @returns '' or '&access_token=...'.
 */
export function graphTokenParam(token: string): string {
  return token === KERNEL_TOKEN ? '' : `&access_token=${encodeURIComponent(token)}`;
}

/**
 * @description Is this the kernel egress refusing a request because the caller has no connection for its connector?
 * @param err - What the fetch rejected with.
 * @returns True for the kernel's "not connected" refusal.
 */
export function isNotConnected(err: unknown): boolean {
  return kernelEgress() && /not connected/i.test(String((err as Error)?.message || ''));
}

/**
 * @description The caller's numeric X user id under the kernel, read from the X API itself (GET /2/users/me) because
 * the connection row is not the package's to read there.
 * @returns The id, or null when X does not answer one.
 */
export async function kernelTwitterUserId(): Promise<string | null> {
  const r = await fetch('https://api.twitter.com/2/users/me');
  if (!r.ok) return null;
  const id = ((await r.json().catch(() => ({}))) as { data?: { id?: unknown } }).data?.id;
  return id ? String(id) : null;
}

/**
 * @description Under the kernel, the caller's Facebook connection providers that are not revoked, from the metadata:
 * the readiness answer the oshal_connections query gives outside the kernel.
 * @param ctx - The application context.
 * @returns The provider ids (meta-business / facebook).
 */
export async function kernelFacebookProviders(ctx: unknown): Promise<string[]> {
  const meta = await readConnections(ctx);
  const rows = Array.isArray(meta?.connections) ? meta!.connections! : [];
  return rows
    .filter((c) => ['meta-business', 'facebook'].includes(String(c?.provider || '').toLowerCase()) && c.revoked !== true)
    .map((c) => String(c.provider).toLowerCase());
}
