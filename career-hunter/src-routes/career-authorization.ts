/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Intelligent Career's ADR-149 package side (1.25.1). authorization.yaml declares one resource, `career`, and the kernel asks the package's adapter for it after it has resolved the named permission a request needs; without a registered adapter every catalog-bound request, the engine rail's signed callbacks included, is refused authorization_resource_adapter_unavailable. The adapter admits any active verified actor: row ownership stays where it always was, in each route's owner-scoped store paths and the tables' forced row-level security.
 */

/**
 * Career authorization helpers.
 *
 * `authorization.yaml` declares one resource, `career`, with `own` scope only. The kernel decides
 * the named permission for every request (route bindings, role grants, current tier) and then asks
 * this adapter; the adapter never widens what a query can read, because ownership is enforced by
 * the per-user store layout and the FORCE-RLS tables, not by the catalog.
 *
 * @module career-authorization
 */
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'career-authorization' });

/** The one resource `authorization.yaml` declares. */
export const CAREER_RESOURCE = 'career';

/**
 * @description Register the catalog's resource adapter. The kernel accepts adapters only while the
 * package is activating, so every route factory that may be the first (or only) one mounted calls
 * this; re-registration within one activation replaces the same adapter. A package context without
 * the kernel's authorization port (an isolated route test) has nothing to register.
 * @param ctx - Package context from the route mounter.
 * @returns Nothing; a refusal from the kernel propagates so a strict activation fails loudly.
 */
export function registerCareerAuthorization(ctx: AppContext): void {
  if (!ctx.authorization) return;
  ctx.authorization.registerResource(CAREER_RESOURCE, { authorize: async ({ actor }) => actor.isActive === true });
  logger.info({ resource: CAREER_RESOURCE }, 'career authorization resource registered');
}
