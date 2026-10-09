/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Replace directory-membership publication with a committed, revocable per-export token. Anonymous reads grant no job/control access and are never cached.
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { publicArtifact } from './vids-artifacts';
import { serveVideo } from './vids-artifact-files';

export function createVidsPublicRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.get('/:token/video.mp4', async (req, res) => {
    const token = String(req.params.token);
    if (!/^[a-f0-9]{64}$/.test(token)) { res.status(404).end(); return; }
    try {
      const row = await publicArtifact(ctx, token);
      if (!row) { res.status(404).end(); return; }
      await serveVideo(req, res, row);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      res.status((error as { code?: string }).code === 'ENOENT' ? 404 : 503).end();
    }
  });
  return router;
}
