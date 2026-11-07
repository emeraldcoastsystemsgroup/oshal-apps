/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the native Bot Forge workspace and 1-click caller-scoped Inject contract without shell or workspace writes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Router } = require('express');

const ALLOWED_PAGE_QUERIES = new Set(['v', 'audience', 'draft']);
const UI_ASSETS = new Map([
  ['forge.css', { file: 'forge.css', type: 'text/css; charset=utf-8' }],
  ['forge-model.js', { file: 'forge-model.js', type: 'text/javascript; charset=utf-8' }],
  ['forge.js', { file: 'forge.js', type: 'text/javascript; charset=utf-8' }],
]);

function resolvePackageRoot(ctx) {
  if (ctx && typeof ctx.appPackageDir === 'string' && ctx.appPackageDir.trim()) {
    return fs.realpathSync(ctx.appPackageDir);
  }
  return fs.realpathSync(path.resolve(import.meta.dirname, '..'));
}

function readBoundedToolAsset(packageRoot, fileName) {
  const toolsRoot = path.join(packageRoot, 'tools');
  const candidate = fs.realpathSync(path.join(toolsRoot, fileName));
  const rel = path.relative(toolsRoot, candidate);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('tool asset escapes tools directory');
  }
  return fs.readFileSync(candidate, 'utf8');
}

function validatePageQuery(query) {
  const keys = Object.keys(query || {});
  if (keys.some((key) => !ALLOWED_PAGE_QUERIES.has(key))) return false;
  if (query?.draft !== undefined && (typeof query.draft !== 'string' || !/^[0-9a-f-]{36}$/i.test(query.draft))) {
    return false;
  }
  return true;
}

export function createBotForgeRoutes(ctx = {}) {
  const router = Router();
  const packageRoot = resolvePackageRoot(ctx);

  const serveWorkspace = (req, res) => {
    if (!validatePageQuery(req.query)) {
      res.status(400).json({ error: 'bot_forge_invalid_query', message: 'Unsupported query parameter on Bot Forge workspace.' });
      return;
    }
    const html = readBoundedToolAsset(packageRoot, 'forge.html');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('text/html; charset=utf-8').send(html);
  };

  router.get('/', serveWorkspace);
  router.get('/app', serveWorkspace);

  router.get('/ui/:asset', (req, res) => {
    const entry = UI_ASSETS.get(String(req.params?.asset || ''));
    if (!entry) {
      res.status(404).json({ error: 'bot_forge_asset_not_found' });
      return;
    }
    const body = readBoundedToolAsset(packageRoot, entry.file);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(entry.type).send(body);
  });

  router.get('/contract', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json({
      package: 'codex-packer',
      version: '1.3.0',
      publishMode: 'caller-scoped-authored',
      requiresPermissionPreview: true,
      zeroGitCommitRequired: true,
      defaultWorkerBot: 'codex-packer',
      endpoints: {
        agents: '/api/agents',
        definitions: '/api/workflow-studio/definitions',
      },
    });
  });

  return router;
}
