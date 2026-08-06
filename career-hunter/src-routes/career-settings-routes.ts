/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted caller-scoped Career credential state and mutation routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Stop presenting the controller host's Claude OAuth as a connection owned by every Career user.
 */

/**
 * Career Hunter connector settings routes.
 * @module career-settings-routes
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { encryptToken } from '@/app/routes/connector-token-crypto';
import { callerSub } from './career-user-store';

const logger = createChildLogger({ module: 'career-settings-routes' });
type CareerProvider = 'anthropic' | 'firecrawl';

async function getSettingsState(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const result = await ctx.pool.query(
      `SELECT provider FROM oshal_connections
        WHERE user_sub=$1 AND provider IN ('anthropic','firecrawl')`,
      [userSub],
    );
    res.json({
      anthropicConnected: result.rows.some((row) => row.provider === 'anthropic'),
      firecrawlSet: result.rows.some((row) => row.provider === 'firecrawl'),
    });
  } catch (err) {
    logger.error({ err, userSub }, 'career settings state failed');
    res.status(500).json({ error: 'settings read failed' });
  }
}

async function saveKey(
  ctx: AppContext,
  req: Request,
  res: Response,
  provider: CareerProvider,
): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const key = String(req.body?.key || '').trim();
  if (!key) { res.status(400).json({ error: 'key required' }); return; }
  try {
    const encrypted = await encryptToken(ctx.pool, userSub, key);
    await ctx.pool.query(
      `INSERT INTO oshal_connections (user_sub, provider, access_token, status)
       VALUES ($1,$2,$3,'connected')
       ON CONFLICT (user_sub, provider) DO UPDATE
       SET access_token=EXCLUDED.access_token, status='connected', updated_at=NOW()`,
      [userSub, provider, encrypted],
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userSub, provider }, 'career credential save failed');
    res.status(500).json({ error: 'credential save failed' });
  }
}

async function deleteKey(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const provider: CareerProvider = req.params.provider === 'anthropic'
    ? 'anthropic'
    : 'firecrawl';
  try {
    await ctx.pool.query(
      'DELETE FROM oshal_connections WHERE user_sub=$1 AND provider=$2',
      [userSub, provider],
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userSub, provider }, 'career credential delete failed');
    res.status(500).json({ error: 'credential delete failed' });
  }
}

/**
 * @description Registers caller-scoped Career provider credential settings routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used to encrypt and persist connector credentials.
 * @returns Nothing.
 */
export function registerCareerSettingsRoutes(router: Router, ctx: AppContext): void {
  router.get('/settings/state', (req, res) => getSettingsState(ctx, req, res));
  router.post('/settings/anthropic', (req, res) => saveKey(ctx, req, res, 'anthropic'));
  router.post('/settings/firecrawl', (req, res) => saveKey(ctx, req, res, 'firecrawl'));
  router.delete('/settings/key/:provider', (req, res) => deleteKey(ctx, req, res));
}
