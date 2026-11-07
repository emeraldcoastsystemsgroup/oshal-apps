/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the native Ambient Recall workspace (/api/person-model/app) and bounded UI assets inside the caller's authenticated package mount.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Router } = require('express');

const ALLOWED_QUERIES = new Set(['v', 'audience', 'tab', 'profile']);
const ASSETS = new Map([
  ['person-model.css', { file: 'person-model.css', type: 'text/css; charset=utf-8' }],
  ['person-model.js', { file: 'person-model.js', type: 'text/javascript; charset=utf-8' }],
]);

function resolvePackageRoot(ctx) {
  if (ctx && typeof ctx.appPackageDir === 'string' && ctx.appPackageDir.trim()) {
    return fs.realpathSync(ctx.appPackageDir);
  }
  return fs.realpathSync(path.resolve(import.meta.dirname, '..'));
}

function readToolAsset(packageRoot, fileName) {
  const toolsDir = path.join(packageRoot, 'tools');
  const resolved = fs.realpathSync(path.join(toolsDir, fileName));
  const rel = path.relative(toolsDir, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('asset escapes tools root');
  }
  return fs.readFileSync(resolved, 'utf8');
}

function validQuery(query) {
  const keys = Object.keys(query || {});
  if (keys.some((k) => !ALLOWED_QUERIES.has(k))) return false;
  if (query?.tab !== undefined && !['recall', 'asks', 'people', 'trends'].includes(String(query.tab))) {
    return false;
  }
  if (query?.profile !== undefined && (typeof query.profile !== 'string' || query.profile.length > 128)) {
    return false;
  }
  return true;
}

export function createPersonModelSurfaceRoutes(ctx = {}) {
  const router = Router();
  const packageRoot = resolvePackageRoot(ctx);

  const serveApp = (req, res) => {
    if (!validQuery(req.query)) {
      res.status(400).json({ error: 'ambient_recall_invalid_query' });
      return;
    }
    const html = readToolAsset(packageRoot, 'person-model.html');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('text/html; charset=utf-8').send(html);
  };

  router.get('/', serveApp);
  router.get('/app', serveApp);

  router.get('/ui/:asset', (req, res) => {
    const item = ASSETS.get(String(req.params?.asset || ''));
    if (!item) {
      res.status(404).json({ error: 'ambient_recall_asset_not_found' });
      return;
    }
    const content = readToolAsset(packageRoot, item.file);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(item.type).send(content);
  });

  return router;
}
