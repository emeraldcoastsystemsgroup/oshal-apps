/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | 0.7.0: the ADR-149 resource adapter. authorization.yaml declares
 *                     |                             | one resource, `scan`, with `own` scope only; the kernel resolves
 *                     |                             | the named permission for every route, package tool, the operator
 *                     |                             | bot and the photo intake, then asks this adapter. Without it every
 *                     |                             | bound operation is refused authorization_resource_adapter_unavailable.
 *                     |                             | The adapter admits any active verified actor: ownership stays in
 *                     |                             | every store statement's owner predicate, the tables' forced row
 *                     |                             | security (migration 001) and the per-owner hashed data directory,
 *                     |                             | never in the catalog.
 */

import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'scan-to-print-authorization' });

/** @description The one resource authorization.yaml declares. */
export const SCAN_RESOURCE = 'scan';

/**
 * @description Register the catalog's resource adapter. The kernel accepts adapters only while the
 * package activates and one registration covers the whole application, so only the route entry
 * factory (scan-to-print-routes.ts) calls this. A context without the kernel's authorization port
 * (an isolated route test) has nothing to register.
 * @param ctx - Package context from the route mounter.
 * @returns Nothing; a refusal from the kernel propagates so a protected activation fails loudly.
 */
export function registerScanToPrintAuthorization(ctx: AppContext): void {
  if (!ctx.authorization) return;
  ctx.authorization.registerResource(SCAN_RESOURCE, { authorize: async ({ actor }) => actor.isActive === true });
  logger.info({ resource: SCAN_RESOURCE }, 'Registered the Scan to Print authorization resource');
}
