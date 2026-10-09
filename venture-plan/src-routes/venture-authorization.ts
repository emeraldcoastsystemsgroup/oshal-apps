/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Venture Plan's ADR-149 package side (1.5.0). authorization.yaml declares one resource, `venture`, and the kernel asks the package's adapter for it after it has resolved the named permission a request, a bot call or the scheduled tick needs; without a registered adapter every catalog-bound operation is refused authorization_resource_adapter_unavailable. The adapter admits any active verified actor: row ownership stays where it always was, in each handler's owner predicate and the tables' owner-or-operator row-level security.
 */

/**
 * Venture Plan authorization helpers.
 *
 * `authorization.yaml` declares one resource, `venture`, with `own` scope only. The kernel decides
 * the named permission for every operation (route bindings, bot bindings, the `jobs` binding of the
 * rebaseline tick, role grants, current tier) and then asks this adapter; the adapter never widens
 * what a query can read, because ownership is enforced by the owner predicate every store
 * statement carries and by row-level security, not by the catalog.
 *
 * @module venture-authorization
 */
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'venture-authorization' });

/** The one resource `authorization.yaml` declares. */
export const VENTURE_RESOURCE = 'venture';

/**
 * @description Register the catalog's resource adapter. The kernel accepts adapters only while the
 * package is activating, and one registration covers the whole application, so the small tick
 * router's factory (venture-rebaseline-routes.ts) calls this: every activation mounts it, and a
 * protected package's activation fails if any of its route factories does. A package context
 * without the kernel's authorization port (an isolated route test) has nothing to register.
 * @param ctx - Package context from the route mounter.
 * @returns Nothing; a refusal from the kernel propagates so a strict activation fails loudly.
 */
export function registerVentureAuthorization(ctx: AppContext): void {
  if (!ctx.authorization) return;
  ctx.authorization.registerResource(VENTURE_RESOURCE, { authorize: async ({ actor }) => actor.isActive === true });
  logger.info({ resource: VENTURE_RESOURCE }, 'venture authorization resource registered');
}
