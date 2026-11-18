/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Serve the Job Apply connected-device setting screen on GET /settings and GET /review, plus read-only GET /config metadata for Career and Jarvis.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Read package version dynamically from oshal-app.yaml instead of hardcoding a literal string.
 */
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { AppContext } from '@/app/composition/app-context';

function readManifestVersion(packageDir: string): string {
  try {
    const raw = fs.readFileSync(path.join(packageDir, 'oshal-app.yaml'), 'utf8');
    const match = /^version:\s*([^\s#]+)/m.exec(raw);
    return match?.[1] ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createReviewRoutes(ctx: AppContext): Router {
  const router = Router();
  const packageDir = ctx.appPackageDir!;
  const version = readManifestVersion(packageDir);
  const pagePath = path.join(packageDir, 'tools/review.html');
  const sendPage = (_req: unknown, res: { setHeader(name: string, value: string): void; sendFile(file: string): void }) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(pagePath);
  };
  router.get('/settings', sendPage);
  router.get('/review', sendPage);
  router.get('/config', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const authed = (req as { oidc?: { isAuthenticated?: () => boolean } }).oidc?.isAuthenticated?.() === true;
    if (!authed) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({
      package: 'job-apply',
      version,
      setting: 'job_apply_device',
      settingsUrl: '/cockpit/?app=job-apply&screen=job-apply-settings',
      workersEndpoint: '/api/apply-operator/workers',
      devicesPageUrl: '/cockpit/tools/devices.html',
      careerUrl: '/cockpit/?app=career-hunter&screen=career-submission-activity',
    });
  });
  return router;
}
