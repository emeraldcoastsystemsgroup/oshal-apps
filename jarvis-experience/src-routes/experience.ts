/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve package-owned Jarvis metadata/assets under the existing application authority; member data routes remain owned by their applications.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import type { AuthorizationResourceAdapter } from '@/shared/application-authorization';

/** @description Activation context containing the owned package root and resource authorization registration. */
interface ExperienceContext {
  appPackageDir: string;
  authorization: { registerResource(resource: string, adapter: AuthorizationResourceAdapter): void };
}

/** @description Mount only the declared Jarvis entry and assets; grants and business records are outside this package.
 * @param ctx Trusted package context, including its activation-only authorization port.
 * @returns The package router. */
export function createExperienceRoutes(ctx: ExperienceContext): Router {
  if (!ctx.authorization || !ctx.appPackageDir) throw new Error('Jarvis requires experience hosting and application authorization');
  ctx.authorization.registerResource('application', {
    authorize: async ({ actor, grant, fields }) => actor.isActive && Boolean(actor.sub?.trim()) && Boolean(actor.issuer?.trim())
      && grant.scope === 'own' && fields.length === 0,
  });
  const root = fs.realpathSync(path.join(ctx.appPackageDir, 'ui'));
  const router = Router();
  const send = (filename: string): RequestHandler => (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const file = fs.realpathSync(path.join(root, filename));
      if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('Asset unavailable');
      res.sendFile(file, error => { if (error && !res.headersSent) res.status(503).json({ error: 'experience_asset_unavailable' }); });
    } catch { res.status(503).json({ error: 'experience_asset_unavailable' }); }
  };
  router.get('/app', send('index.html'));
  router.get('/assets/config.js', send('config.js'));
  router.get('/assets/styles.css', send('styles.css'));
  router.get('/assets/full-swarm.css', send('full-swarm.css'));
  return router;
}
