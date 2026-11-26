/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: owner identity resolution, personal-scope guard, and named permission enforcement for Brand Graphics renders.
 */
import type { Request } from 'express';
import { RenderError } from './render-types';

export interface RenderOwner {
  issuer: string;
  sub: string;
}

const SPOOF_KEYS = new Set([
  'tenant', 'tenantId', 'owner', 'ownerKey', 'ownerSub', 'userSub', 'issuer', 'principalId', 'workspace',
]);
const SPOOF_HEADERS = ['x-oshal-tenant-id', 'x-tenant-id'];

export function assertPersonalScopeOnly(req: Request): void {
  const query = (req.query || {}) as Record<string, unknown>;
  for (const key of Object.keys(query)) {
    if (SPOOF_KEYS.has(key)) throw new RenderError(400, 'personal_scope_only', 'Personal scope cannot be overridden.');
  }
  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of Object.keys(body as Record<string, unknown>)) {
      if (SPOOF_KEYS.has(key)) throw new RenderError(400, 'personal_scope_only', 'Personal scope cannot be overridden.');
    }
  }
  for (const header of SPOOF_HEADERS) {
    if (req.headers?.[header] !== undefined) {
      throw new RenderError(400, 'personal_scope_only', 'Tenant override headers are not permitted.');
    }
  }
}

export async function requireRenderOwner(ctx: any, req: Request, permissions: string[]): Promise<RenderOwner> {
  assertPersonalScopeOnly(req);
  if (ctx?.authorization && typeof ctx.authorization.currentActor === 'function') {
    const actor = ctx.authorization.currentActor();
    if (!actor || actor.isActive !== true || typeof actor.issuer !== 'string' || !actor.issuer || typeof actor.sub !== 'string' || !actor.sub) {
      throw new RenderError(401, 'not_authenticated', 'Sign in to use Brand Graphics renders.');
    }
    if (typeof ctx.authorization.authorize === 'function') {
      for (const permission of permissions) {
        const decision = await ctx.authorization.authorize({ permission });
        if (decision?.allowed !== true) {
          throw new RenderError(403, 'permission_denied', `Missing required permission: ${permission}`);
        }
      }
    }
    return { issuer: actor.issuer, sub: actor.sub };
  }
  const oidc = (req as any).oidc;
  const sub = oidc?.user?.sub || oidc?.user?.oid;
  if (!sub || oidc?.isAuthenticated?.() !== true) {
    throw new RenderError(401, 'not_authenticated', 'Sign in to use Brand Graphics renders.');
  }
  return { issuer: String(oidc.user.iss || 'local-oidc'), sub: String(sub) };
}
