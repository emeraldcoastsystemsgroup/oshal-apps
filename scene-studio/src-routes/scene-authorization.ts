/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (0.2.0) — Scene Studio's ADR-149 package side.
 *                     |                             | authorization.yaml declares one resource, `scene`, with `own`
 *                     |                             | scope only; the kernel resolves the named permission for every
 *                     |                             | route, tool and the director and then asks this adapter. Without
 *                     |                             | a registered adapter every bound operation is refused
 *                     |                             | authorization_resource_adapter_unavailable. The adapter admits
 *                     |                             | any active verified actor: ownership stays in every store
 *                     |                             | statement's owner predicate, the tables' forced row security and
 *                     |                             | the per-owner hashed data directory, never in the catalog.
 */

import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'scene-studio-authorization' });

/** @description The one resource authorization.yaml declares. */
export const SCENE_RESOURCE = 'scene';

/**
 * @description Register the catalog's resource adapter. The kernel accepts adapters only while the
 * package activates and one registration covers the whole application, so only the route entry
 * factory (scene-studio-routes.ts) calls this. A context without the kernel's authorization port
 * (an isolated route test) has nothing to register.
 * @param ctx - Package context from the route mounter.
 * @returns Nothing; a refusal from the kernel propagates so a protected activation fails loudly.
 */
export function registerSceneStudioAuthorization(ctx: AppContext): void {
  if (!ctx.authorization) return;
  ctx.authorization.registerResource(SCENE_RESOURCE, { authorize: async ({ actor }) => actor.isActive === true });
  logger.info({ resource: SCENE_RESOURCE }, 'Registered the Scene Studio authorization resource');
}
