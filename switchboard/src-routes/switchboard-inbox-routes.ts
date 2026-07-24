/**
 * Switchboard Inbox Routes — the UNIFIED INBOX, the full triage surface (mounted
 * under the Switchboard app router at /inbox → /api/switchboard/inbox, requiresAuth).
 *
 * This is Overview's "Needs you" at full size: one ranked, normalized triage list
 * across the signed-in user's own accounts, pulled from the stores/APIs the kernel
 * already fills — read-only, NO LLM in this path (ADR-036 controller/bot split).
 * Three real sources, each best-effort (a missing connection is skipped, never faked):
 *
 *   (a) the shared inbox store `oshal_inbox_messages` (ALL categories — primary,
 *       social, updates, forums; promotions/bulk dropped) filled by the framework
 *       inbox-ingest cron from Gmail — read exactly the way social-routes reads
 *       category='social', just widened to every category;
 *   (b) live Outlook mail via Microsoft Graph GET /v1.0/me/messages (token via the
 *       broker — 'microsoft' then 'outlook', mirroring storage-target.ts::graphToken);
 *   (c) live Slack DMs + mentions via the shared slack-client (pullSlackFeed +
 *       slackIdentity) on the caller's Slack user token.
 *
 * Every item normalizes onto the SAME shape the /feed board uses
 * ({id,source,kind,person,subject,snippet,ts,hot,workspaceId?}), ranked hot→newest.
 * Reads are scoped to the caller's own connections via getValidAccessToken; no DB
 * creds leave here. Optional ?workspace= gates which source connections are read
 * (member connection_ids → their providers), ?channel= post-filters by source.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 03:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial Unified Inbox module: GET /inbox (surface) + GET /inbox/items (ranked, normalized triage list across the stored inbox + live Outlook (Graph) + live Slack DMs/mentions). Read-only; no LLM in the controller path. Workspace-scoped by member connection providers; channel-filterable. Surfaces serve from ctx.appPackageDir/tools (D10 load-time fallback).
 *
 * @module switchboard-inbox-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { pullSlackFeed, slackIdentity, type SlackFeedMessage } from '@/app/routes/slack-client';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'switchboard-inbox-routes' });

const GRAPH_MESSAGES =
  'https://graph.microsoft.com/v1.0/me/messages?$select=id,subject,bodyPreview,from,receivedDateTime,isRead,importance&$top=25&$orderby=receivedDateTime%20desc';

/** One normalized triage row — every source maps into this shape (mirrors /feed). */
interface InboxItem {
  id: string;
  source: 'gmail' | 'outlook' | 'linkedin' | 'x' | 'facebook' | 'instagram' | 'slack' | 'social';
  kind: 'mail' | 'dm' | 'mention';
  person: string;
  subject?: string;
  snippet?: string;
  ts: string;
  hot?: boolean;
  workspaceId?: string;
}

/** The signed-in user's OIDC subject, or null if unauthenticated. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Serve a static HTML surface from the package tools directory. */
function servePage(dir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(dir, file), (err) => {
      if (err) {
        logger.error({ err, file }, 'Failed to serve switchboard inbox surface');
        res.status(404).send('Page not found');
      }
    });
  };
}

/** Extract a human display name from an RFC/Graph From value (falls back to the address). */
function displayName(from: string): string {
  return (from.match(/^"?([^"<]+?)"?\s*</)?.[1] || from.split('@')[0] || from || 'unknown').trim();
}

/** Automated / bulk mail the operator never needs to reply to (dropped from triage). */
function isBulk(from: string, subject: string): boolean {
  return /no-?reply|do-?not-?reply|notifications?@|mailer|newsletter|updates?@|billing@|receipts?@|support@|via\b/i.test(from)
    || /unsubscribe|receipt|order (confirmed|shipped)|statement is ready/i.test(subject);
}

/** Time-sensitive language → surface as hot (needs you now). */
function timeSensitive(subject: string, snippet: string): boolean {
  return /\b(asap|urgent|eod|today|by (\d|noon|end of day)|deadline|due (today|by)|before the)\b/i.test(`${subject} ${snippet}`);
}

/** Infer the social platform from a stored notification's sender domain. */
function inferPlatform(from: string): InboxItem['source'] {
  const f = from.toLowerCase();
  if (f.includes('linkedin.com')) return 'linkedin';
  if (f.includes('facebookmail') || f.includes('facebook.com')) return 'facebook';
  if (f.includes('instagram')) return 'instagram';
  if (/(^|@|\.)(x|twitter)\.com/.test(f)) return 'x';
  return 'social';
}

/** Rank comparator: hot first, then newest. */
function rankItems(items: InboxItem[]): InboxItem[] {
  return items.sort((a, b) => (a.hot ? 0 : 1) - (b.hot ? 0 : 1) || +new Date(b.ts) - +new Date(a.ts));
}

/**
 * @description Resolve the provider set backing a workspace's member connections, so the inbox
 * only reads the source accounts that belong to that workspace. Absent workspace → null (= all).
 * Membership is the caller's OWN rows (user_sub filter + owner-RLS), never another user's.
 * @param pool - GUC-wrapped Postgres pool.
 * @param sub - caller OIDC sub.
 * @param workspaceId - the workspace to scope to.
 * @returns a Set of provider keys in the workspace, or null when the workspace is empty/all.
 */
async function workspaceProviders(pool: AppContext['pool'], sub: string, workspaceId: string): Promise<Set<string> | null> {
  const rows = (await pool.query(
    `SELECT c.provider AS provider
       FROM oshal_switchboard_workspace_accounts wa
       JOIN oshal_connections c ON c.connection_id = wa.connection_id AND c.user_sub = wa.user_sub
      WHERE wa.user_sub = $1 AND wa.workspace_id = $2`,
    [sub, workspaceId],
  )).rows as Array<{ provider: string }>;
  if (!rows.length) return null;
  return new Set(rows.map((r) => r.provider));
}

/**
 * @description Read the caller's stored inbox (ALL categories, bulk/promotions dropped) — the
 * gmail-sourced store the inbox-ingest cron fills. Social-category rows become platform mentions;
 * the rest become mail. No unread flag exists in the store, so hotness = time-sensitive language.
 * @param pool - GUC-wrapped Postgres pool.
 * @param sub - caller OIDC sub.
 * @param days - lookback window (bounded by the caller).
 * @returns normalized triage rows from the store.
 */
async function storedInboxItems(pool: AppContext['pool'], sub: string, days: number): Promise<InboxItem[]> {
  const rows = (await pool.query(
    `SELECT msg_id, from_addr, subject, snippet, category, received_at FROM oshal_inbox_messages
      WHERE user_sub = $1 AND category <> 'promotions' AND received_at > NOW() - ($2 || ' days')::interval
      ORDER BY received_at DESC LIMIT 120`,
    [sub, String(days)],
  )).rows as Array<{ msg_id: string; from_addr: string; subject: string; snippet: string; category: string; received_at: string }>;
  const out: InboxItem[] = [];
  for (const r of rows) {
    const from = r.from_addr || '';
    const subject = r.subject || '(no subject)';
    if (isBulk(from, subject)) continue;
    const social = r.category === 'social';
    out.push({
      id: r.msg_id, source: social ? inferPlatform(from) : 'gmail', kind: social ? 'mention' : 'mail',
      person: displayName(from), subject, snippet: r.snippet || '', ts: r.received_at,
      hot: social ? false : timeSensitive(subject, r.snippet || ''),
    });
  }
  return out;
}

/** Shape of one message from Microsoft Graph /me/messages. */
interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
}

/**
 * @description Pull the caller's live Outlook mail via Microsoft Graph and keep the triage-worthy
 * ones (unread, not bulk). hot = high importance or time-sensitive. Throws on a Graph error so the
 * caller can log + skip this source (best-effort).
 * @param token - a Microsoft Graph access token (Mail.Read).
 * @returns normalized Outlook mail rows.
 */
async function outlookItems(token: string): Promise<InboxItem[]> {
  const r = await fetch(GRAPH_MESSAGES, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`graph ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { value?: GraphMessage[] };
  const out: InboxItem[] = [];
  for (const m of j.value || []) {
    const addr = m.from?.emailAddress?.address || '';
    const subject = m.subject || '(no subject)';
    if (m.isRead || isBulk(addr, subject)) continue;
    out.push({
      id: m.id, source: 'outlook', kind: 'mail',
      person: m.from?.emailAddress?.name || displayName(addr), subject, snippet: m.bodyPreview || '',
      ts: m.receivedDateTime || new Date().toISOString(),
      hot: (m.importance || '').toLowerCase() === 'high' || timeSensitive(subject, m.bodyPreview || ''),
    });
  }
  return out;
}

/**
 * @description Pull the caller's live Slack DMs + @-mentions via the shared slack-client. Only
 * messages FROM others are kept: direct/group DMs (hot) and channel messages that @-mention the
 * caller. Throws on a Slack error so the caller can log + skip this source (best-effort).
 * @param token - a Slack USER token (xoxp).
 * @returns normalized Slack triage rows.
 */
async function slackItems(token: string): Promise<InboxItem[]> {
  const me = await slackIdentity(token);
  if (!me.ok) throw new Error('slack auth failed');
  const mention = me.userId ? `<@${me.userId}>` : null;
  const { messages } = await pullSlackFeed(token, { maxChannels: 15, perChannel: 10, maxUsers: 40 });
  const out: InboxItem[] = [];
  for (const m of messages as SlackFeedMessage[]) {
    if (me.userId && m.userId === me.userId) continue; // skip the caller's own messages
    const direct = m.type === 'im' || m.type === 'mpim';
    const mentioned = mention ? m.text.includes(mention) : false;
    if (!direct && !mentioned) continue;
    out.push({
      id: `slack-${m.channelId}-${m.ts}`, source: 'slack', kind: direct ? 'dm' : 'mention',
      person: m.user || m.userId || 'Slack', subject: m.channel, snippet: m.text.slice(0, 240),
      ts: m.time, hot: direct,
    });
  }
  return out;
}

/** Tally the normalized items by channel (source) for the surface's left rail. */
function tallyByChannel(items: InboxItem[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const it of items) by[it.source] = (by[it.source] || 0) + 1;
  return by;
}

/**
 * @description Assemble the unified triage list from the three sources the workspace scope allows.
 * Each source is best-effort (a failure logs + yields []); results are ranked hot→newest, tagged
 * with the workspace id when scoped, and truncated to a sane board size.
 * @param ctx - app context (pool + broker).
 * @param sub - caller OIDC sub.
 * @param opts - resolved scope: provider gate (null = all), lookback days, active workspace id.
 * @returns the ranked items plus whether any source connection was present.
 */
async function assembleInbox(
  ctx: AppContext, sub: string, opts: { providers: Set<string> | null; days: number; workspaceId: string | null },
): Promise<{ items: InboxItem[]; connected: boolean }> {
  const want = (p: string): boolean => !opts.providers || opts.providers.has(p);
  const msTok = (want('microsoft') || want('outlook'))
    ? (await getValidAccessToken(ctx.pool, sub, 'microsoft')) || (await getValidAccessToken(ctx.pool, sub, 'outlook'))
    : null;
  const slackTok = want('slack') ? await getValidAccessToken(ctx.pool, sub, 'slack') : null;
  const [stored, outlook, slack] = await Promise.all([
    want('google') ? storedInboxItems(ctx.pool, sub, opts.days).catch((err) => { logger.error({ err }, 'inbox store read failed'); return []; }) : Promise.resolve([]),
    msTok ? outlookItems(msTok).catch((err) => { logger.error({ err }, 'outlook read failed'); return []; }) : Promise.resolve([]),
    slackTok ? slackItems(slackTok).catch((err) => { logger.error({ err }, 'slack read failed'); return []; }) : Promise.resolve([]),
  ]);
  const items = rankItems([...stored, ...outlook, ...slack]).slice(0, 60);
  if (opts.workspaceId) for (const it of items) it.workspaceId = opts.workspaceId;
  return { items, connected: !!(stored.length || msTok || slackTok) };
}

/**
 * @description Builds the Switchboard Unified Inbox sub-router (mounted at /inbox by the parent
 * Switchboard router, under requiresAuth). Serves the triage surface and the normalized /items
 * feed. Cheap reads only — no LLM in this path (ADR-036). Surfaces serve from tools/ (D10).
 * @param ctx - app context (db pool for the stored inbox + broker tokens, appPackageDir for surfaces).
 * @returns Express router to mount at /inbox (auth-gated by the parent mounter).
 */
export function createInboxRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');

  // Surface: the full triage board.
  router.get('/', servePage(assetRoot, 'switchboard-inbox.html'));

  // Data: the unified, ranked, normalized triage list. surface=1 → graceful "connect" payload.
  router.get('/items', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const days = Math.min(Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1), 30);
    const workspaceId = typeof req.query.workspace === 'string' && req.query.workspace ? req.query.workspace : null;
    const channel = typeof req.query.channel === 'string' && req.query.channel ? req.query.channel : null;
    try {
      const providers = workspaceId ? await workspaceProviders(ctx.pool, sub, workspaceId) : null;
      const { items, connected } = await assembleInbox(ctx, sub, { providers, days, workspaceId });
      if (!connected) {
        if (req.query.surface === '1') { res.json({ connected: false, message: 'Connect Gmail, Outlook, or Slack at /utilities to fill your inbox.' }); return; }
        res.status(409).json({ error: 'no_connection', message: 'Connect Gmail, Outlook, or Slack at /utilities first.' });
        return;
      }
      const filtered = channel ? items.filter((it) => it.source === channel) : items;
      res.json({ connected: true, items: filtered, counts: { total: filtered.length, needsReply: filtered.filter((i) => i.hot).length, byChannel: tallyByChannel(filtered) } });
    } catch (err) {
      logger.error({ err }, 'Switchboard inbox items failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
