/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Scoped doubles of the two kernel seams LoRA 1.7.0 depends on, for the package's branch specs. mountLoraIngest runs the worker router the way the signed-package-callbacks rail does (POST only, the package verifier first, then the router as the verified grant owner), and answers a refusal with the verifier's own reason so each refusal class stays individually provable; the kernel logs that reason and answers callback_signature_invalid, and it also refreshes the owner and requires the catalog permission, which this double does not. fixtureAuthorization stands in for the kernel's per-package authorization port by reading the verified issuer from the request identity. The real kernel boundary is crossed by signed-callback-boundary.core.test.js.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import { getRequestIdentity, runWithRequestIdentity } from '@/shared/services/database/request-identity';
import type { AppContext } from '@/app/composition/app-context';
import { LORA_INGEST_MOUNT, createLoraIngestRoutes, verifyWorkerRequest } from '../../src-routes/lora-ingest-routes';

/**
 * @description Mount the worker router at its manifest path behind its verifier, as the kernel rail
 * does, running the router as the grant owner the verifier admitted.
 * @param app - The fixture application.
 * @param ctx - The package context the router is built with.
 * @returns Nothing.
 */
export function mountLoraIngest(app: Express, ctx: AppContext): void {
  const router = createLoraIngestRoutes(ctx);
  app.use(LORA_INGEST_MOUNT, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'callback_post_required' }); return; }
    verifyWorkerRequest(ctx, req).then((verdict) => {
      if (!verdict.ok) { res.status(401).json({ error: verdict.error }); return; }
      runWithRequestIdentity({ sub: verdict.grant.ownerSub, principalIssuer: verdict.grant.ownerIssuer, isOperator: false },
        () => router(req, res, next));
    }).catch(next);
  });
}

/**
 * @description The package authorization port as the kernel hands it to a route factory: resource
 * registration is accepted, and the current actor is the request identity when it names an issuer.
 * @returns A port for a fixture package context.
 */
export function fixtureAuthorization(): NonNullable<AppContext['authorization']> {
  return {
    registerResource: () => undefined,
    currentActor: () => {
      const identity = getRequestIdentity();
      return identity?.sub && identity.principalIssuer
        ? { sub: identity.sub, issuer: identity.principalIssuer, isActive: true, isSwarmAdmin: false } : undefined;
    },
    authorize: async () => { throw new Error('named permissions are decided by the kernel; branch specs never ask'); },
  };
}
