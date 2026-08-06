/**
 * Switchboard Compose Routes — the Composer (write once → per-platform variants → publish).
 *
 * Mounted by the parent Switchboard router at /api/switchboard/compose (auth-gated at the
 * package mount). This is the "write once, everywhere" pane of Switchboard:
 *
 *   • GET  /compose            — serve the Composer surface (tools/switchboard-compose.html).
 *   • GET  /compose/targets    — which platforms the caller can post to (connected + optionally
 *                                filtered to a workspace's member accounts). Cheap DB read.
 *   • POST /compose/variants   — per-platform rewrites of the source text. This IS reasoning, so
 *                                it runs ON the communications-bot (executeBotOrInline), exactly
 *                                like social-routes' runOnBot — cost captured in chat_tasks, NOT
 *                                a controller LLM.
 *   • POST /compose/image      — REAL image generation via the media-generation kernel skill
 *                                (resolveStoryboardImageProvider — the same path Portrait Studio
 *                                uses), returned as a preview data-URL. Spend is captured through
 *                                recordStoryboardImageCost. Depends on a configured image provider
 *                                (STORYBOARD_IMAGE_PROVIDER, default `codex` = the swarm OpenAI key).
 *   • POST /compose/publish    — publish the EXACT approved text to X / LinkedIn / Facebook via the
 *                                caller's connector token. Deterministic (no LLM in the path) and
 *                                gated behind the explicit-write confirmation (no-post guard) — the
 *                                same three real bindings social-routes POST /post uses.
 *
 * Controller/bot split (ADR-036): only /variants touches an LLM, and it does so ON the bot. The
 * publish path is deterministic and posts the exact bytes the user approved. Reads are scoped to
 * the caller's own connections via getValidAccessToken; no DB creds leave this process.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 03:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial compose module: GET /compose (surface) + GET /compose/targets (connected/workspace-scoped platforms) + POST /compose/variants (per-platform rewrites on the comms bot) + POST /compose/image (real image generation via the media-generation kernel skill, returned as a preview data-URL, spend captured) + POST /compose/publish (exact approved text to X/LinkedIn/Facebook via the connector token, confirm-gated, no LLM). Reads the parent-owned workspace tables to scope "posting as workspace".
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Export PLATFORMS + PUBLISHABLE + platformProviders (additive, no behavior change) so the Stage broadcast pane fans out through this module's exact platform spec and the SAME publishTo path — never a parallel rail (the same reuse contract the calendar executor already follows).
 *
 * 2026-08-06 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: retire connector credentials from the comms-bot variant request. The model receives only the source copy and platform constraints; confirmed publishing remains deterministic and resolves one provider token immediately before its API call.
 *
 * @module switchboard-compose-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { resolveStoryboardImageProvider, recordStoryboardImageCost, type StoryboardImageResult } from '@/features/video-generation';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'switchboard-compose-routes' });

/** The comms bot (codex) writes the per-platform variants — the same node the social + email swarms use. */
const COMMS_BOT_AGENT_ID = 'b0000000-0000-0000-0000-000000000001';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** Hard ceiling on a single vendor image call so a stuck provider can't hang the request. */
const IMAGE_TIMEOUT_MS = 90_000;

/** Per-platform authoring spec: char limit (for the card meter), the connector provider, brand label. */
export interface PlatformSpec { limit: number; provider: string; label: string }
export const PLATFORMS: Record<string, PlatformSpec> = {
  x: { limit: 280, provider: 'twitter', label: 'X' },
  twitter: { limit: 280, provider: 'twitter', label: 'X' },
  linkedin: { limit: 3000, provider: 'linkedin', label: 'LinkedIn' },
  facebook: { limit: 63206, provider: 'meta-business', label: 'Facebook' },
  instagram: { limit: 2200, provider: 'meta-business', label: 'Instagram' },
  threads: { limit: 500, provider: 'meta-business', label: 'Threads' },
};

/** The variant platforms the composer offers (pure text rewriting — always available). */
const VARIANT_PLATFORMS = ['x', 'linkedin', 'facebook', 'instagram', 'threads'];

/** Platforms with a REAL publish binding here (mirrors social-routes POST /post exactly). */
export const PUBLISHABLE = new Set(['x', 'twitter', 'linkedin', 'facebook']);

/** Signed-in user's OIDC sub, or null. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Serve a static HTML surface from the package tools directory. */
function servePage(dir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(dir, file), (err) => {
      if (err) { logger.error({ err, file }, 'Failed to serve switchboard compose surface'); res.status(404).send('Page not found'); }
    });
  };
}

/** The connector providers that back a given post platform (for the workspace-membership guard). */
export function platformProviders(platform: string): string[] {
  if (platform === 'x' || platform === 'twitter') return ['twitter'];
  if (platform === 'linkedin') return ['linkedin'];
  if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') return ['meta-business', 'facebook'];
  return [];
}

/**
 * @description Resolve the connector providers that belong to a workspace (its member accounts).
 * Reads the PARENT-owned workspace tables (created by switchboard-routes' ensureWorkspaceSchema) —
 * this module never DDLs them, it only SELECTs, always scoped to the caller's own sub.
 * @param pool - Postgres pool. @param sub - Caller sub. @param workspaceId - Workspace id, or null for "all".
 * @returns The provider set for that workspace, or null when no workspace is scoped (= all accounts).
 */
async function workspaceProviders(pool: AppContext['pool'], sub: string, workspaceId: string | null): Promise<Set<string> | null> {
  if (!workspaceId) return null;
  const rows = (await pool.query(
    `SELECT c.provider FROM oshal_switchboard_workspace_accounts a
       JOIN oshal_connections c ON c.connection_id = a.connection_id AND c.user_sub = a.user_sub
      WHERE a.user_sub = $1 AND a.workspace_id = $2`,
    [sub, workspaceId],
  )).rows as Array<{ provider: string }>;
  return new Set(rows.map((r) => String(r.provider)));
}

/** Run a reasoning prompt on the comms bot (cost captured there). Mirrors social-routes' runOnBot. */
async function runOnBot(ctx: AppContext, kind: string, sub: string, prompt: string): Promise<string> {
  const result = await executeBotOrInline(ctx, botClient, COMMS_BOT_AGENT_ID, {
    text: prompt,
    taskId: `switchboard-compose-${kind}-${sub}`,
    workspaceFolderId: `switchboard-${sub}`,
    agentId: COMMS_BOT_AGENT_ID,
    agenticMode: false,
    direct: true,
    userSub: sub,
  });
  return result.response;
}

/** Build the platform-appropriate rewrite prompt (X = one tweet, LinkedIn = post, else concise). */
function variantPrompt(platform: string, source: string): string {
  const p = PLATFORMS[platform];
  const tail = ['Keep the author’s meaning and voice. Output ONLY the post text — no preamble, no quotes.', '', '---', source];
  if (platform === 'x' || platform === 'twitter') {
    return [`Rewrite the following into a single ${p.label} post (a tweet).`, 'HARD LIMIT 280 characters. One punchy hook, no thread, 0–2 hashtags.', ...tail].join('\n');
  }
  if (platform === 'linkedin') {
    return [`Rewrite the following as a ${p.label} post.`, 'Hook first, 2–4 short paragraphs, 1–3 relevant hashtags at the end.', ...tail].join('\n');
  }
  return [`Rewrite the following as a ${p.label} post.`, `Keep it natural for ${p.label}; stay well under ${p.limit} characters.`, ...tail].join('\n');
}

/** Race a promise against a hard deadline so a wedged vendor call can't hang the request. */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
  try { return await Promise.race([work, deadline]); } finally { if (timer) clearTimeout(timer); }
}

/**
 * @description Generate one preview image from a prompt via the media-generation kernel skill
 * (the same provider Portrait Studio uses). Spend is captured through recordStoryboardImageCost,
 * attributed to the comms bot and the owning user. Returns a data-URL for an inline preview.
 * @param ctx - App context (pool for cost capture). @param sub - Owner sub. @param prompt - Image prompt.
 * @returns The generated PNG as a data-URL plus the model + provider that produced it.
 */
async function generateComposeImage(ctx: AppContext, sub: string, prompt: string): Promise<{ dataUrl: string; model: string; provider: string }> {
  const provider = await resolveStoryboardImageProvider();
  const result: StoryboardImageResult = await withTimeout(
    provider.generateWithMeta
      ? provider.generateWithMeta(prompt, null)
      : provider.generate(prompt, null).then((image) => ({ image, costUsd: null, model: `${provider.id}-default` })),
    IMAGE_TIMEOUT_MS, 'image generation',
  );
  if (typeof result.costUsd === 'number' && result.costUsd > 0) {
    await recordStoryboardImageCost(ctx.pool, {
      taskId: `switchboard-compose-${crypto.randomUUID()}`,
      agentId: COMMS_BOT_AGENT_ID, ownerSub: sub,
      providerId: `image-provider:${provider.id}`, model: result.model, costUsd: result.costUsd,
    });
  }
  return { dataUrl: `data:image/png;base64,${result.image.toString('base64')}`, model: result.model, provider: provider.id };
}

/** Publish approved text to X/Twitter via the connector token (POST /2/tweets). Mirrors social-routes. */
async function publishToX(ctx: AppContext, sub: string, text: string): Promise<Record<string, unknown>> {
  if (text.length > 280) return { ok: false, code: 400, error: 'too_long', message: `Tweet is ${text.length} chars (max 280).` };
  const token = await getValidAccessToken(ctx.pool, sub, 'twitter');
  if (!token) return { ok: false, code: 409, error: 'no_twitter_connection', message: 'Connect X at /utilities first.' };
  const r = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: { id?: string } };
  if (r.status >= 200 && r.status < 300) return { ok: true, target: 'x', tweetId: j?.data?.id ?? null };
  return { ok: false, code: 502, status: r.status, error: JSON.stringify(j).slice(0, 300) };
}

/** Publish approved text to LinkedIn via the connector token (UGC Posts / w_member_social). Mirrors social-routes. */
async function publishToLinkedIn(ctx: AppContext, sub: string, text: string): Promise<Record<string, unknown>> {
  const token = await getValidAccessToken(ctx.pool, sub, 'linkedin');
  if (!token) return { ok: false, code: 409, error: 'no_linkedin_connection', message: 'Connect LinkedIn at /utilities first.' };
  const authorId = (await ctx.pool.query("SELECT account_id FROM oshal_connections WHERE user_sub = $1 AND provider = 'linkedin'", [sub])).rows[0]?.account_id;
  if (!authorId) return { ok: false, code: 409, error: 'reconnect', message: 'Missing LinkedIn author id — reconnect at /utilities.' };
  const body = {
    author: `urn:li:person:${authorId}`, lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' }, body: JSON.stringify(body),
  });
  if (r.status >= 200 && r.status < 300) return { ok: true, target: 'linkedin', postId: r.headers.get('x-restli-id') };
  return { ok: false, code: 502, status: r.status, error: (await r.text()).slice(0, 300) };
}

/** Publish approved text to the caller's first managed Facebook Page via the meta-business token. Mirrors social-routes. */
async function publishToFacebook(ctx: AppContext, sub: string, text: string): Promise<Record<string, unknown>> {
  const graph = `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v21.0'}`;
  const userTok = await getValidAccessToken(ctx.pool, sub, 'meta-business');
  if (!userTok) return { ok: false, code: 409, error: 'no_facebook_connection', message: 'Connect Facebook at /utilities first.' };
  const pagesRes = await fetch(`${graph}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userTok)}`);
  if (!pagesRes.ok) return { ok: false, code: 502, status: pagesRes.status, error: (await pagesRes.text()).slice(0, 300) };
  const page = ((await pagesRes.json()) as { data?: Array<{ id: string; access_token: string }> }).data?.[0];
  if (!page) return { ok: false, code: 409, error: 'no_facebook_pages', message: 'You manage no Facebook Page on this account.' };
  const r = await fetch(`${graph}/${encodeURIComponent(page.id)}/feed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, access_token: page.access_token }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string };
  if (r.status >= 200 && r.status < 300) return { ok: true, target: 'facebook', pageId: page.id, postId: j.id ?? null };
  return { ok: false, code: 502, status: r.status, error: JSON.stringify(j).slice(0, 300) };
}

/** Dispatch an approved publish to the right platform binding. */
/**
 * @description Publish exact approved text to one platform via the caller's connector token
 * (X / LinkedIn / Facebook Page). Inline, no LLM. Exported so the Calendar's scheduled-post
 * executor reuses the SAME sanctioned publish path instead of forking it.
 * @param ctx - App context (pool for the connector token).
 * @param sub - The owning user's OIDC subject (the account being published from).
 * @param platform - x | twitter | linkedin | facebook.
 * @param text - The exact text to publish.
 * @returns { ok, target?, ...ids } on success, or { ok:false, code, error, message } on failure.
 */
export function publishTo(ctx: AppContext, sub: string, platform: string, text: string): Promise<Record<string, unknown>> {
  if (platform === 'x' || platform === 'twitter') return publishToX(ctx, sub, text);
  if (platform === 'facebook') return publishToFacebook(ctx, sub, text);
  if (platform === 'linkedin') return publishToLinkedIn(ctx, sub, text);
  return Promise.resolve({ ok: false, code: 400, error: 'unsupported_platform', message: 'Publish supports x, linkedin, facebook.' });
}

/**
 * @description Builds the Compose sub-router. The parent mounts it at /api/switchboard/compose, so
 * routes here are relative ('/', '/targets', '/variants', '/image', '/publish'). Surfaces serve from
 * the package tools/ dir (D10 load-time fallback). Only /variants touches an LLM, and on the bot.
 * @param ctx - App context (pool for connector tokens + cost + workspace reads, appPackageDir for the surface).
 * @returns Express router to mount under /compose in the parent Switchboard router.
 */
export function createComposeRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');

  // Surface: the Composer.
  router.get('/', servePage(assetRoot, 'switchboard-compose.html'));

  /** GET /targets?workspace= — platforms the caller can author for, connected-state + workspace-scoped. */
  router.get('/targets', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const workspaceId = String(req.query.workspace || '').trim() || null;
    try {
      const connectedRows = (await ctx.pool.query(
        "SELECT provider FROM oshal_connections WHERE user_sub = $1 AND status = 'connected'", [sub],
      )).rows as Array<{ provider: string }>;
      const connected = new Set(connectedRows.map((r) => String(r.provider)));
      const ws = await workspaceProviders(ctx.pool, sub, workspaceId);
      const targets = VARIANT_PLATFORMS.map((platform) => {
        const provs = platformProviders(platform);
        const isConnected = provs.some((p) => connected.has(p));
        const inWorkspace = !ws || provs.some((p) => ws.has(p));
        return {
          platform, label: PLATFORMS[platform].label, limit: PLATFORMS[platform].limit,
          publishable: PUBLISHABLE.has(platform), connected: isConnected, inWorkspace,
        };
      });
      res.json({ targets, workspaceScoped: Boolean(workspaceId) });
    } catch (err) {
      logger.error({ err }, 'Compose targets read failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /variants { text, platforms:[], workspaceId? } — per-platform rewrites, drafted on the comms bot. */
  router.post('/variants', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = (req.body || {}) as { text?: string; platforms?: unknown };
    const text = body.text?.trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const requested = Array.isArray(body.platforms) ? body.platforms.filter((x): x is string => typeof x === 'string') : [];
    const platforms = [...new Set(requested.map((p) => p.toLowerCase()).filter((p) => PLATFORMS[p]))].slice(0, 5);
    if (!platforms.length) { res.status(400).json({ error: 'platforms required (x | linkedin | facebook | instagram | threads)' }); return; }
    try {
      const variants: Array<Record<string, unknown>> = [];
      for (const platform of platforms) {
        const draft = await runOnBot(ctx, `variant-${platform}`, sub, variantPrompt(platform, text));
        variants.push({ platform, label: PLATFORMS[platform].label, limit: PLATFORMS[platform].limit, publishable: PUBLISHABLE.has(platform), text: draft.trim() });
      }
      res.json({ variants });
    } catch (err) {
      logger.error({ err }, 'Compose variants failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /image { prompt } — real image generation, returned as a preview data-URL. Spend captured. */
  router.post('/image', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const prompt = String((req.body as { prompt?: string })?.prompt || '').trim();
    if (!prompt) { res.status(400).json({ error: 'prompt required' }); return; }
    if (prompt.length > 1000) { res.status(400).json({ error: 'prompt too long (max 1000 chars)' }); return; }
    try {
      const image = await generateComposeImage(ctx, sub, prompt);
      res.json({ image: image.dataUrl, model: image.model, provider: image.provider });
    } catch (err) {
      const message = (err as Error).message || 'image generation failed';
      // A provider that isn't configured is an operator dependency, not a bug — surface it as 503 so
      // the composer shows a clear "image generation isn't set up" note rather than a generic failure.
      const notConfigured = /not configured|no OpenAI credential|no OpenRouter|is not a provider|Refusing to fall back/i.test(message);
      logger.error({ err, notConfigured }, 'Compose image generation failed');
      res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'image_provider_unavailable' : 'image_generation_failed', message: message.slice(0, 300) });
    }
  });

  /** POST /publish { platform, text, workspaceId?, mediaRef?, confirm } — publish the exact approved text. */
  router.post('/publish', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = (req.body || {}) as { platform?: string; text?: string; mediaRef?: string; workspaceId?: string; confirm?: boolean };
    const platform = String(body.platform || '').toLowerCase();
    const text = body.text?.trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    if (!PUBLISHABLE.has(platform)) { res.status(400).json({ error: 'unsupported_platform', message: 'Publish supports x, linkedin, facebook.' }); return; }
    if (!hasExplicitWriteConfirmation(body)) { res.status(428).json(confirmationRequiredPayload('no-post', `Publishing to ${PLATFORMS[platform]?.label || platform}`)); return; }
    // Attaching a generated image to a published post has NO real binding here (social-routes has no
    // media-upload path). Refuse rather than silently drop the media and claim success.
    if (body.mediaRef) {
      res.status(501).json({ error: 'media_attach_unsupported', message: 'Attaching generated media on publish is not yet supported — publish the text and attach the downloaded image in-platform. (X media/upload + LinkedIn asset register are follow-ups.)' });
      return;
    }
    try {
      const ws = await workspaceProviders(ctx.pool, sub, String(body.workspaceId || '').trim() || null);
      if (ws && ws.size && !platformProviders(platform).some((p) => ws.has(p))) {
        res.status(403).json({ error: 'workspace_mismatch', message: `${PLATFORMS[platform]?.label || platform} is not one of this workspace's accounts.` });
        return;
      }
      const result = await publishTo(ctx, sub, platform, text);
      res.status(result.ok ? 200 : ((result.code as number) || 502)).json(result);
    } catch (err) {
      logger.error({ err, platform }, 'Compose publish failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
