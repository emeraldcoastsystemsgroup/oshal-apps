/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.0.0: the package's one route factory. A package with an access catalog must register an adapter for every resource the catalog names before its routes are served (oshal-kernel crates/host-process/bridge/authorization.js `seal`); without it the kernel answers "package did not report itself ready" for every route, the readiness one included. The `shelf` resource is this package's one read, so its adapter admits an active, identified caller holding an `own` grant and nothing else. The readiness answer itself is the shared package-smoke handler.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.0.0, before its first release: readiness is no longer answered here. The store gate requires every routed package to answer readiness with the store's one reviewed module pair (src-routes/package-smoke.ts and routes/package-smoke.js, factory createPackageSmokeRoutes, declared at /api/engineering-shelf/_smoke exactly as scripts/security/security-ci-contract.test.mjs assertReadinessSmoke reads it), and it refused this factory in that place. The manifest now declares that pair, and this factory second at the same mount: it registers the `shelf` adapter while the package activates and serves no path of its own, so the package still answers one address. Without this factory the kernel's runner refuses the whole package at activation ("An installed authorization resource has no registered adapter", crates/host-process/bridge/authorization.js `seal`).
 */
import { Router } from 'express';
import type { AuthorizationResourceAdapter } from '@/shared/application-authorization';

interface ShelfContext {
  authorization: { registerResource(resource: string, adapter: AuthorizationResourceAdapter): void };
}

/**
 * @description Register the adapter of the catalog's one resource, `shelf`, while the package activates. The
 * Engineer role's one grant here is `app.open` with scope `own`; nothing in this package is another person's. The
 * manifest declares this factory at the readiness mount, after the store's package-smoke pair, so readiness stays
 * the shared handler and this router adds no address.
 * @param ctx The package context; application authorization must be present.
 * @returns An empty router: every request falls through to the readiness router mounted with it.
 */
export function createShelfRoutes(ctx: ShelfContext): Router {
  if (!ctx.authorization) throw new Error('The engineering shelf requires application authorization');
  ctx.authorization.registerResource('shelf', {
    authorize: async ({ actor, grant, fields }) => actor.isActive && Boolean(actor.sub?.trim()) && Boolean(actor.issuer?.trim())
      && grant.scope === 'own' && fields.length === 0,
  });
  return Router();
}
