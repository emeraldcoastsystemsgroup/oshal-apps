/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bind Portrait permissions to verified identities and issuer-qualified ownership.
 */
import { Router, json } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import type { AuthorizationActor } from '@/shared/application-authorization';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = ['view', 'read', 'create', 'change', 'delete', 'export', 'email', 'artist'] as const;

/** @description Read only the framework-verified execution identity.
 * @param ctx Bound package context. @returns Active exact principal, or an authentication failure.
 */
export function portraitActor(ctx: AppContext): AuthorizationActor {
  const actor = ctx.authorization?.currentActor();
  if (!actor?.isActive || !actor.sub || !actor.issuer) throw Object.assign(new Error('portrait_verified_identity_required'), { status: 401 });
  return actor;
}

/** @description Recheck current app access and the named operation immediately before work.
 * @param ctx Bound package context. @param action Catalog action. @param resourceId Optional owned row.
 * @returns Nothing when allowed; rejects unavailable or revoked rights.
 */
export async function requirePortraitPermission(ctx: AppContext, action: string, resourceId?: string): Promise<void> {
  portraitActor(ctx);
  for (const permission of new Set(['portrait.view', `portrait.${action}`])) {
    const decision = await ctx.authorization!.authorize({ permission, ...(resourceId ? { resourceId } : {}) });
    if (!decision.allowed) throw Object.assign(new Error('portrait_permission_denied'), { status: 403 });
  }
}

/** @description Register an own-only adapter; broad roles never override the row owner.
 * @param ctx Bound package context. @returns Nothing; missing core authorization refuses activation.
 */
export function registerPortraitAuthorization(ctx: AppContext): void {
  if (!ctx.authorization) throw new Error('Portrait Studio requires application-authorization');
  ctx.authorization.registerResource('portraits', { authorize: async ({ actor, operation, grant }) => {
    if (!actor.isActive || !actor.issuer || !actor.sub || grant.scope !== 'own' || operation.tenantId) return false;
    const id = operation.resourceId ?? /^\/portraits\/([^/]+)(?:\/|$)/.exec(operation.path ?? '')?.[1];
    if (!id) return true; // Collections below always constrain their SQL to this exact principal.
    if (!UUID.test(id)) return false;
    const found = await ctx.pool.query(
      'SELECT portrait_id FROM ps_portraits WHERE portrait_id = $1 AND user_sub = $2 AND owner_issuer = $3',
      [id, actor.sub, actor.issuer],
    );
    return found.rows.length === 1;
  } });
}

/** @description Expose effective operations and an actual bounded metadata change operation.
 * @param ctx Bound package context. @returns Router mounted under the Portrait package root.
 */
export function createPortraitAuthorizationRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/permissions', async (_req, res) => {
    try {
      const permissions = Object.fromEntries(await Promise.all(ACTIONS.map(async action => {
        try { await requirePortraitPermission(ctx, action); return [action, true]; }
        catch { return [action, false]; }
      })));
      res.set('Cache-Control', 'private, no-store').json({ permissions, unavailable: { email: 'portrait_mail_identity_unavailable' } });
    } catch { res.status(403).json({ error: 'portrait_permission_denied' }); }
  });
  router.patch('/portraits/:id', json({ limit: '4kb' }), async (req, res) => {
    try {
      const actor = portraitActor(ctx);
      await requirePortraitPermission(ctx, 'change', req.params.id);
      const title = req.body?.title;
      if (typeof title !== 'string' || title.trim().length > 120 || Object.keys(req.body).some(key => key !== 'title')) {
        res.status(400).json({ error: 'Only a title of at most 120 characters may be changed' }); return;
      }
      const result = await ctx.pool.query(
        'UPDATE ps_portraits SET title = $4, updated_at = NOW() WHERE portrait_id = $1 AND user_sub = $2 AND owner_issuer = $3 RETURNING portrait_id, title',
        [req.params.id, actor.sub, actor.issuer, title.trim()],
      );
      if (!result.rows.length) { res.status(404).json({ error: 'portrait_not_found' }); return; }
      await requirePortraitPermission(ctx, 'change', req.params.id);
      res.set('Cache-Control', 'private, no-store').json(result.rows[0]);
    } catch { res.status(403).json({ error: 'portrait_permission_denied' }); }
  });
  return router;
}
