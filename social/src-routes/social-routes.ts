/**
 * Social Routes — Social swarm surface (ADR-038).
 *
 * Per-user social composer. **LinkedIn** (Share on LinkedIn / w_member_social) +
 * Facebook (read-only profile). Same split as the email swarm:
 *  - **Drafting** (reasoning) runs ON the comms bot (codex) → cost in chat_tasks.
 *  - **Publishing** is a deterministic action — done inline in the api (the exact
 *    text the user approved, no LLM in the path) via the connector token.
 *  - **Reading profiles** is cheap I/O in the api.
 * The `scripts/oshal-linkedin.js` CLI is the same publish path for bots/cron.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-15 12:30:00 | roger.murphy@agenticfederal.us   | Initial social swarm surface: GET /composer + /profiles (LinkedIn+Facebook), POST /draft (comms bot drafts a post), POST /post (publish to LinkedIn via UGC Posts with the connector token).
 * 2026-06-15 19:25:00 | roger.murphy@agenticfederal.us   | X/Twitter publishing: POST /post now takes a `target` (linkedin|twitter) and publishes the approved text to X (POST /2/tweets) via the connector token; /profiles reads the X profile too. Publish still happens inline (no LLM, exact approved text). Mirrors scripts/oshal-x.js (the bot/cron path).
 * 2026-06-16 09:30:00 | roger.murphy@agenticfederal.us   | POST /draft takes `target` (linkedin|twitter) and drafts platform-appropriately — X = a single tweet (≤280, punchy), LinkedIn = the multi-paragraph post. Powers the multi-network Composer (network selector → draft → refine → publish to X or LinkedIn).
 * 2026-06-15 23:50:00 | roger.murphy@agenticfederal.us   | Token broker: runOnBot resolves the caller's google+twitter access tokens via the controller (resolveBotCreds) and threads them to the comms bot (creds), so the bot uses provided short-lived tokens instead of needing SESSION_SECRET to decrypt oshal_connections.
 * 2026-06-15 21:10:00 | roger.murphy@agenticfederal.us   | Facebook Pages STREAMS + publishing via the meta-business connector: GET /facebook/pages (caller's managed Pages, page tokens NOT exposed), GET /facebook/pages/:id/feed (the Page stream — message/created_time/permalink/reactions/comments/shares, pages_read_engagement), POST /facebook/pages/:id/post (publish approved text to the Page, pages_manage_posts; deterministic, no LLM). Page tokens resolved per-request via /me/accounts using the user's Business connector token.
 * 2026-06-15 21:35:00 | roger.murphy@agenticfederal.us   | GET /facebook serves facebook-stream.html — the Pages stream UI (page selector → live feed cards with reactions/comments/shares + permalink → publish box). Theme-inherits the cockpit; graceful no-Pages empty state linking to facebook.com/pages/create.
 * 2026-06-16 09:20:00 | roger.murphy@agenticfederal.us   | X follow + timeline (stream) read, ACCOUNT-LEVEL-GATED: GET /twitter/timeline (home stream, reverse_chronological) + POST /twitter/follow (follow by @handle: resolve username → id → POST /2/users/:id/following). The user's OWN X API plan is the switch — free tier is post-only and 402s on reads/follows, surfaced cleanly as x_tier_required (works the moment they're on Basic). Follow also needs the follows.write scope (reconnect X after enabling).
 * 2026-06-16 12:40:00 | roger.murphy@agenticfederal.us   | GET /signals — social-media notifications read from the inbox store (oshal_inbox_messages, category=social) captured by the inbox-ingest cron. The "inbox is the feed" pipe: complete + fast, served from the store (never a live capped grab), so nothing is missed on a busy day.
 * 2026-06-16 12:55:00 | roger.murphy@agenticfederal.us   | The social feed, organized + flowing: GET /signals/ui (Social Signals surface, in the social app) + POST /signals/organize (the comms bot reads the stored social signals — controller feeds them per ADR-036 — and returns a grouped briefing). This is how the social bot "gets its read" on social media: controller data-access → bot reasoning, no DB creds in the bot, no mesh needed (mesh/selector deferred to the trading-trigger use case).
 * 2026-07-19 20:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the social app package (ADR-085 Wave 2, "skill with a surface"). Standard (ctx) factory; the surfaces (workspace/signals/composer/facebook-stream) serve from ctx.appPackageDir/tools (load-time env fallback, D10); shared core helpers (token broker, connectors, inline-bot-execution) import via @/ aliases. The communications-bot + social-writer nodes (containers + registries + personas), the inbox-ingest cron feeding oshal_inbox_messages (category=social — the Signals engine), the linkedin/twitter/meta-business connectors, and the kernel-resident LinkedIn AI Content Assistant (/api/linkedin-assistant — retains its own no-post gate) stay framework-resident per ADR-093.
 *
 * @module social-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { resolveBotCreds } from '@/app/routes/connector-token-broker';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'social-routes' });

/** The comms bot (codex) drafts posts — same bot the email swarm uses. */
const COMMS_BOT_AGENT_ID = 'b0000000-0000-0000-0000-000000000001';
const botClient = new BotNodeClient(createRegistryEndpointResolver());
const FB_GRAPH = `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v21.0'}`;

/** Signed-in user's OIDC sub. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Serve a static HTML surface. */
function servePage(dir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(dir, file), (err) => {
      if (err) { logger.error({ err, file }, 'Failed to serve social surface'); res.status(404).send('Page not found'); }
    });
  };
}

/** Run a reasoning prompt on the comms bot (cost captured there). */
async function runOnBot(ctx: AppContext, kind: string, sub: string, prompt: string): Promise<string> {
  // Token broker: hand the bot the caller's short-lived tokens (google + twitter) so it
  // reads via a provided token rather than needing SESSION_SECRET to decrypt the DB.
  const creds = await resolveBotCreds(ctx.pool, sub, ['google', 'twitter']);
  const result = await executeBotOrInline(ctx, botClient, COMMS_BOT_AGENT_ID, {
    text: prompt,
    taskId: `social-${kind}-${sub}`,
    workspaceFolderId: `social-${sub}`,
    agentId: COMMS_BOT_AGENT_ID,
    agenticMode: true,
    direct: true,
    userSub: sub,
    creds,
  });
  return result.response;
}

/** Publish approved text to X/Twitter via the connector token (POST /2/tweets). */
async function publishToX(ctx: AppContext, sub: string, text: string): Promise<Record<string, unknown>> {
  if (text.length > 280) return { ok: false, code: 400, error: 'too_long', message: `Tweet is ${text.length} chars (max 280).` };
  const token = await getValidAccessToken(ctx.pool, sub, 'twitter');
  if (!token) return { ok: false, code: 409, error: 'no_twitter_connection', message: 'Connect X at /utilities first.' };
  const r = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: { id?: string } };
  if (r.status >= 200 && r.status < 300) return { ok: true, target: 'twitter', tweetId: j?.data?.id ?? null };
  return { ok: false, code: 502, status: r.status, error: JSON.stringify(j).slice(0, 300) };
}

/** Publish approved text to LinkedIn via the connector token (UGC Posts / w_member_social). */
async function publishToLinkedIn(ctx: AppContext, sub: string, text: string): Promise<Record<string, unknown>> {
  const token = await getValidAccessToken(ctx.pool, sub, 'linkedin');
  if (!token) return { ok: false, code: 409, error: 'no_linkedin_connection', message: 'Connect LinkedIn at /utilities first.' };
  const authorId = (await ctx.pool.query("SELECT account_id FROM oshal_connections WHERE user_sub = $1 AND provider = 'linkedin'", [sub])).rows[0]?.account_id;
  if (!authorId) return { ok: false, code: 409, error: 'reconnect', message: 'Missing LinkedIn author id — reconnect at /utilities.' };
  const body = {
    author: `urn:li:person:${authorId}`,
    lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify(body),
  });
  if (r.status >= 200 && r.status < 300) return { ok: true, target: 'linkedin', postId: r.headers.get('x-restli-id') };
  return { ok: false, code: 502, status: r.status, error: (await r.text()).slice(0, 300) };
}

/** The caller's numeric X user id (the API's source id for timeline + follow), or null. */
async function twitterUserId(ctx: AppContext, sub: string): Promise<string | null> {
  const r = (await ctx.pool.query("SELECT account_id FROM oshal_connections WHERE user_sub = $1 AND provider = 'twitter'", [sub])).rows[0];
  return r?.account_id ? String(r.account_id) : null;
}

/** X read/follow endpoints are gated by the user's OWN X API plan (free = post-only). A 402/403
 *  from X means their account lacks the tier — surface that cleanly instead of a raw 502. */
function xTierGate(status: number): { code: number; body: Record<string, unknown> } | null {
  if (status === 402 || status === 403) {
    return { code: 402, body: { error: 'x_tier_required', message: 'This needs an X API Basic plan — the free tier is post-only (reads/follows return 402). Upgrade your X account to enable it.' } };
  }
  return null;
}

/** Shape of a Page from /me/accounts (page access_token included). */
interface FbPage { id: string; name: string; category?: string; access_token: string; tasks?: string[] }

/**
 * @description List the caller's Facebook Pages via the Business connector's user token.
 * `/me/accounts` returns each Page WITH its own page access token — the token used to read
 * the Page feed and publish. Throws on Graph error so routes can surface it.
 * @param ctx - app context (db pool for the connector token)
 * @param sub - caller OIDC sub
 * @returns the caller's managed Pages (with page tokens)
 */
async function facebookPages(ctx: AppContext, sub: string): Promise<FbPage[]> {
  const userTok = await getValidAccessToken(ctx.pool, sub, 'meta-business');
  if (!userTok) return [];
  const r = await fetch(`${FB_GRAPH}/me/accounts?fields=id,name,category,access_token,tasks&access_token=${encodeURIComponent(userTok)}`);
  if (!r.ok) throw new Error(`pages ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: FbPage[] };
  return j.data || [];
}

/** The page access token for one page id (or null if the caller doesn't manage it). */
async function facebookPageToken(ctx: AppContext, sub: string, pageId: string): Promise<string | null> {
  const page = (await facebookPages(ctx, sub)).find((p) => String(p.id) === String(pageId));
  return page?.access_token || null;
}

/** Publish approved text to the caller's Facebook Page (first managed Page) — makes Facebook
 *  a first-class Composer target alongside LinkedIn/X. Deterministic (no LLM in the path). */
async function publishToFacebook(ctx: AppContext, sub: string, text: string): Promise<{ ok: boolean; code?: number; status?: number; error?: string; message?: string; target?: string; pageId?: string; postId?: string | null }> {
  const pages = await facebookPages(ctx, sub);
  if (!pages.length) return { ok: false, code: 409, error: 'no_facebook_pages', message: 'Connect Facebook at /utilities, or you manage no Page on this account.' };
  const page = pages[0];
  const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(page.id)}/feed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, access_token: page.access_token }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string };
  if (r.status >= 200 && r.status < 300) return { ok: true, target: 'facebook', pageId: page.id, postId: j.id ?? null };
  return { ok: false, code: 502, status: r.status, error: JSON.stringify(j).slice(0, 300) };
}

/**
 * @description Builds the social swarm surface router (mount at /api/social, auth: oidc).
 * Packaged shape (ADR-085): standard (ctx) factory — the surfaces serve from the installed
 * package's tools/ dir (ctx.appPackageDir, captured at factory time per D10).
 * @param ctx - app context (db pool for connector tokens, appPackageDir for the surfaces).
 * @returns Express router.
 */
export function createSocialRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir
    ? path.join(ctx.appPackageDir, 'tools')
    : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');

  router.get('/composer', servePage(assetRoot, 'social-composer.html'));

  /** GET /facebook — the Facebook Pages stream surface (read feed + publish to a Page). */
  router.get('/facebook', servePage(assetRoot, 'facebook-stream.html'));

  /** GET /workspace — the combined Social Workspace: engagement signals (who to engage)
   *  on the left + the Composer (draft/refine/publish) on the right, in one split screen. */
  router.get('/workspace', servePage(assetRoot, 'social-workspace.html'));

  /** GET /signals/ui — the Social Signals surface (the inbox-fed social feed + AI organize). */
  router.get('/signals/ui', servePage(assetRoot, 'social-signals.html'));

  /** GET /profiles — connected social profiles (cheap reads). */
  router.get('/profiles', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const profiles: Record<string, unknown> = {};
    try {
      const li = await getValidAccessToken(ctx.pool, sub, 'linkedin');
      if (li) {
        const r = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${li}` } });
        if (r.ok) profiles.linkedin = await r.json();
      }
    } catch (err) { logger.warn({ err }, 'LinkedIn profile read failed'); }
    try {
      // Facebook is the Pages (Business) connector now — the standalone login app was
      // dropped + merged into Pages. Report Facebook as connected via meta-business.
      const fb = await getValidAccessToken(ctx.pool, sub, 'meta-business');
      if (fb) {
        const r = await fetch(`${FB_GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(fb)}`);
        if (r.ok) profiles.facebook = await r.json();
        else profiles.facebook = { connected: true };
      }
    } catch (err) { logger.warn({ err }, 'Facebook profile read failed'); }
    try {
      const tw = await getValidAccessToken(ctx.pool, sub, 'twitter');
      if (tw) {
        const r = await fetch('https://api.twitter.com/2/users/me?user.fields=username,name,public_metrics', { headers: { Authorization: `Bearer ${tw}` } });
        if (r.ok) profiles.twitter = await r.json();
      }
    } catch (err) { logger.warn({ err }, 'X profile read failed'); }
    res.json({ profiles });
  });

  /** POST /draft — the comms bot drafts a post for the chosen network (linkedin|twitter). */
  router.post('/draft', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = req.body as { topic?: string; tone?: string; target?: string };
    const topic = body?.topic?.trim();
    const tone = body?.tone || 'professional and engaging';
    const target = (body?.target || 'linkedin').toLowerCase();
    if (!topic) { res.status(400).json({ error: 'topic required' }); return; }
    try {
      const prompt = (target === 'twitter' || target === 'x')
        ? [
            `Draft a single ${tone} X/Twitter post (a tweet) about: ${topic}`,
            'HARD LIMIT 280 characters. One punchy hook, no thread, 0–2 hashtags.',
            'Output ONLY the tweet text — no preamble, no quotes.',
          ].join('\n')
        : [
            `Draft a ${tone} LinkedIn post about: ${topic}`,
            'Hook first, 2–4 short paragraphs, 1–3 relevant hashtags at the end.',
            'Output ONLY the post text — no preamble, no quotes.',
          ].join('\n');
      res.json({ draft: await runOnBot(ctx, 'draft', sub, prompt) });
    } catch (err) {
      logger.error({ err }, 'Draft failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /post — publish the approved text to the chosen network (deterministic, no LLM).
   *  Body: { text, target?: 'linkedin' | 'twitter' } (default linkedin). */
  router.post('/post', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = req.body as { text?: string; target?: string; confirm?: boolean };
    const text = body?.text?.trim();
    const target = (body?.target || 'linkedin').toLowerCase();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    if (!hasExplicitWriteConfirmation(body)) { res.status(428).json(confirmationRequiredPayload('no-post', 'Publishing a social post')); return; }
    try {
      const result = target === 'twitter' || target === 'x'
        ? await publishToX(ctx, sub, text)
        : target === 'facebook'
          ? await publishToFacebook(ctx, sub, text)
          : await publishToLinkedIn(ctx, sub, text);
      res.status(result.ok ? 200 : ((result.code as number) || 502)).json(result);
    } catch (err) {
      logger.error({ err, target }, 'Post failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /facebook/pages — the caller's managed Pages (page tokens NOT exposed to the client). */
  router.get('/facebook/pages', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const pages = await facebookPages(ctx, sub);
      if (!pages.length) {
        res.status(409).json({ error: 'no_facebook_pages', message: 'Connect "Facebook Pages (Business)" at /utilities, or you manage no Pages on this account.' });
        return;
      }
      res.json({ pages: pages.map((p) => ({
        id: p.id, name: p.name, category: p.category ?? null,
        canPost: Array.isArray(p.tasks) ? p.tasks.includes('CREATE_CONTENT') : true,
      })) });
    } catch (err) {
      logger.error({ err }, 'Facebook pages list failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /facebook/pages/:id/feed — the Page's stream (read; pages_read_engagement). */
  router.get('/facebook/pages/:id/feed', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const pageId = String(req.params.id);
    try {
      const tok = await facebookPageToken(ctx, sub, pageId);
      if (!tok) { res.status(404).json({ error: 'page_not_found', message: 'You do not manage that Page (or reconnect Facebook Pages).' }); return; }
      const fields = 'message,story,created_time,permalink_url,full_picture,reactions.summary(true),comments.summary(true),shares';
      const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(pageId)}/feed?fields=${fields}&limit=25&access_token=${encodeURIComponent(tok)}`);
      const j = (await r.json()) as { data?: Array<Record<string, any>> };
      if (!r.ok) { res.status(502).json({ error: JSON.stringify(j).slice(0, 300) }); return; }
      res.json({ feed: (j.data || []).map((p) => ({
        id: p.id, message: p.message ?? p.story ?? '', createdTime: p.created_time ?? null,
        permalink: p.permalink_url ?? null, image: p.full_picture ?? null,
        reactions: p.reactions?.summary?.total_count ?? 0,
        comments: p.comments?.summary?.total_count ?? 0,
        shares: p.shares?.count ?? 0,
      })) });
    } catch (err) {
      logger.error({ err, pageId }, 'Facebook feed read failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /signals — the caller's social-media notifications, read from the inbox store (the
   *  "inbox is the feed" pipe). Captured by the inbox-ingest cron from Gmail's Social category;
   *  served from the store (complete + fast), never a live capped grab. ?days= window (default 7). */
  router.get('/signals', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const days = Math.min(Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1), 30);
    try {
      const rows = (await ctx.pool.query(
        `SELECT msg_id, from_addr, subject, snippet, received_at FROM oshal_inbox_messages
         WHERE user_sub = $1 AND category = 'social' AND received_at > NOW() - ($2 || ' days')::interval
         ORDER BY received_at DESC LIMIT 100`,
        [sub, String(days)],
      )).rows as Array<{ msg_id: string; from_addr: string; subject: string; snippet: string; received_at: string }>;
      res.json({ signals: rows.map((r) => ({
        id: r.msg_id, from: r.from_addr, subject: r.subject, snippet: r.snippet, receivedAt: r.received_at,
      })), windowDays: days, note: rows.length ? undefined : 'No social notifications captured yet — enable email notifications on X/Facebook/LinkedIn to your connected inbox; the ingest cron picks them up.' });
    } catch (err) {
      logger.error({ err }, 'social signals read failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /signals/organize — the comms bot reads the stored social signals (controller feeds
   *  them, ADR-036) and returns an organized briefing: grouped by source, what-matters surfaced,
   *  reply-needed flagged. This is how the social bot "gets its read" on social media. */
  router.post('/signals/organize', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const rows = (await ctx.pool.query(
        `SELECT from_addr, subject, snippet FROM oshal_inbox_messages
         WHERE user_sub = $1 AND category = 'social' AND received_at > NOW() - interval '7 days'
         ORDER BY received_at DESC LIMIT 50`, [sub],
      )).rows as Array<{ from_addr: string; subject: string; snippet: string }>;
      if (!rows.length) { res.json({ organized: 'No social notifications captured yet — enable email notifications on X/Facebook/LinkedIn to your connected inbox; the ingest cron picks them up within ~15 min.', count: 0 }); return; }
      const list = rows.map((r, i) => `${i + 1}. [${r.from_addr}] ${r.subject} — ${r.snippet}`).join('\n');
      const prompt = [
        'These are my recent social-media notifications (pulled from my inbox). Organize them into a tight briefing:',
        '- group by platform/source (LinkedIn, X, Facebook, etc.)',
        '- surface the 3–5 that matter most (real mentions/replies/opportunities), ignoring routine promos',
        '- flag anything that needs a reply.',
        'Be concise — this is a daily glance, not an essay.\n',
        list,
      ].join('\n');
      res.json({ organized: await runOnBot(ctx, 'signals', sub, prompt), count: rows.length });
    } catch (err) {
      logger.error({ err }, 'social signals organize failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /twitter/timeline — the caller's X home stream (reverse-chronological). Account-gated:
   *  X free tier is post-only and 402s on reads → returned as a clean x_tier_required. */
  router.get('/twitter/timeline', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const token = await getValidAccessToken(ctx.pool, sub, 'twitter');
      if (!token) { res.status(409).json({ error: 'no_twitter_connection', message: 'Connect X at /utilities first.' }); return; }
      const uid = await twitterUserId(ctx, sub);
      if (!uid) { res.status(409).json({ error: 'reconnect', message: 'Missing X user id — reconnect X.' }); return; }
      const r = await fetch(`https://api.twitter.com/2/users/${uid}/timelines/reverse_chronological?max_results=25&tweet.fields=created_at,public_metrics`, { headers: { Authorization: `Bearer ${token}` } });
      const gate = xTierGate(r.status);
      if (gate) { res.status(gate.code).json(gate.body); return; }
      const j = (await r.json()) as { data?: Array<Record<string, any>> };
      if (!r.ok) { res.status(502).json({ error: JSON.stringify(j).slice(0, 300) }); return; }
      res.json({ timeline: (j.data || []).map((t) => ({
        id: t.id, text: t.text, createdAt: t.created_at ?? null,
        likes: t.public_metrics?.like_count ?? 0, retweets: t.public_metrics?.retweet_count ?? 0, replies: t.public_metrics?.reply_count ?? 0,
      })) });
    } catch (err) {
      logger.error({ err }, 'X timeline read failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /twitter/follow — follow an account by @handle (needs follows.write + a paid X tier).
   *  Body: { username }. Account-gated: a 402/403 → x_tier_required (free tier / missing scope). */
  router.post('/twitter/follow', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!hasExplicitWriteConfirmation(req.body)) { res.status(428).json(confirmationRequiredPayload('no-post', 'Following an X account')); return; }
    const handle = (req.body as { username?: string; confirm?: boolean })?.username?.trim().replace(/^@/, '');
    if (!handle) { res.status(400).json({ error: 'username required' }); return; }
    try {
      const token = await getValidAccessToken(ctx.pool, sub, 'twitter');
      if (!token) { res.status(409).json({ error: 'no_twitter_connection', message: 'Connect X at /utilities first.' }); return; }
      const uid = await twitterUserId(ctx, sub);
      if (!uid) { res.status(409).json({ error: 'reconnect', message: 'Missing X user id — reconnect X.' }); return; }
      const ur = await fetch(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle)}`, { headers: { Authorization: `Bearer ${token}` } });
      const ugate = xTierGate(ur.status);
      if (ugate) { res.status(ugate.code).json(ugate.body); return; }
      const target = ((await ur.json()) as { data?: { id?: string } }).data?.id;
      if (!target) { res.status(404).json({ error: 'user_not_found', message: `@${handle} not found` }); return; }
      const fr = await fetch(`https://api.twitter.com/2/users/${uid}/following`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_user_id: target }),
      });
      const fgate = xTierGate(fr.status);
      if (fgate) { res.status(fgate.code).json({ ...fgate.body, hint: 'Following also needs the follows.write scope — reconnect X after enabling it.' }); return; }
      const fj = (await fr.json()) as { data?: { following?: boolean } };
      if (fr.ok && fj.data?.following) { res.json({ ok: true, followed: `@${handle}`, targetId: target }); return; }
      res.status(502).json({ ok: false, error: JSON.stringify(fj).slice(0, 300) });
    } catch (err) {
      logger.error({ err }, 'X follow failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /facebook/pages/:id/post — publish approved text to the Page (pages_manage_posts).
   *  Deterministic (no LLM in the path) — same discipline as LinkedIn/X publish. */
  router.post('/facebook/pages/:id/post', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const pageId = String(req.params.id);
    const text = (req.body as { text?: string; confirm?: boolean })?.text?.trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    if (!hasExplicitWriteConfirmation(req.body)) { res.status(428).json(confirmationRequiredPayload('no-post', 'Publishing a Facebook Page post')); return; }
    try {
      const tok = await facebookPageToken(ctx, sub, pageId);
      if (!tok) { res.status(404).json({ error: 'page_not_found' }); return; }
      const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(pageId)}/feed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: tok }),
      });
      const j = (await r.json()) as { id?: string };
      if (r.status >= 200 && r.status < 300) { res.json({ ok: true, target: 'facebook', pageId, postId: j.id ?? null }); return; }
      res.status(502).json({ ok: false, error: JSON.stringify(j).slice(0, 300) });
    } catch (err) {
      logger.error({ err, pageId }, 'Facebook page post failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
