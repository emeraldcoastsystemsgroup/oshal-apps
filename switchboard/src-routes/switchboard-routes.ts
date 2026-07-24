/**
 * Switchboard Routes — the "Today" board API (mounted /api/switchboard, requiresAuth).
 *
 * Switchboard is the merged comms + social command center (Social + Intelligent
 * Communication + Feeds collapse into one app, one ribbon, one design language).
 * This slice is the **Today** pane: a single, prioritized, time-ordered stream of
 * everything that actually needs the signed-in user — pulled from the stores the
 * kernel already fills, normalized onto one board:
 *
 *   • Gmail primary inbox (getValidAccessToken → gmail.readonly) — the items that
 *     look like they NEED A REPLY (unread + not bulk), time-sensitive ones flagged;
 *     the bulk/automated remainder is counted as "handled by bot", never shown.
 *   • Today's calendar (calendar.readonly) — upcoming meetings.
 *   • The inbox-fed **social signals** (oshal_inbox_messages, category='social',
 *     filled by the framework inbox-ingest cron) — mentions/DMs from LinkedIn/X/
 *     Facebook, platform inferred from the sender domain.
 *
 * Controller/bot split (ADR-036): this route only does cheap data-access (reads +
 * normalize + rank). It calls NO LLM — reasoning (ranking prose, reply drafting)
 * runs on the communications-bot in later slices. Reads are scoped to the caller's
 * own connection via getValidAccessToken(pool, sub, 'google'); no DB creds leave here.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 02:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial Switchboard Today pane: GET /today (surface) + GET /feed (unified board — Gmail needs-reply + calendar + inbox-fed social signals, normalized, ranked, time-bucketed). Read-only; no LLM in the controller path. Surfaces serve from ctx.appPackageDir/tools (D10 load-time fallback).
 *
 * @module switchboard-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { summarizeGmailMetadata } from '@/app/routes/email-routes';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import { createInboxRoutes } from './switchboard-inbox-routes';
import { createCalendarRoutes } from './switchboard-calendar-routes';
import { createComposeRoutes } from './switchboard-compose-routes';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'switchboard-routes' });

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** The privacy-bounded per-message metadata shape (built by the kernel's ONE summarizer). */
type MailSummary = ReturnType<typeof summarizeGmailMetadata>;

/** One normalized card on the board — every source maps into this shape. */
interface FeedItem {
  id: string;
  source: 'gmail' | 'outlook' | 'linkedin' | 'x' | 'facebook' | 'instagram' | 'sms' | 'voice' | 'calendar' | 'social';
  kind: 'mail' | 'dm' | 'mention' | 'sms' | 'call' | 'meeting';
  person: string;
  subject?: string;
  snippet?: string;
  ts: string;
  group: 'now' | 'today' | 'week';
  hot?: boolean;
  overdue?: boolean;
  badge?: string;
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
        logger.error({ err, file }, 'Failed to serve switchboard surface');
        res.status(404).send('Page not found');
      }
    });
  };
}

/** GET a Google API URL with the bearer token; throws on non-2xx. */
async function gget(token: string, url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<Record<string, unknown>>;
}

/** List recent inbox message metadata for a query (bounded). */
async function listInbox(token: string, q: string, max: number): Promise<MailSummary[]> {
  const list = await gget(token, `${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
  const ids = ((list.messages as Array<{ id: string }>) || []).map((m) => m.id).slice(0, max);
  const out: MailSummary[] = [];
  for (const id of ids) {
    const m = await gget(token, `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    out.push(summarizeGmailMetadata(id, m));
  }
  return out;
}

/** Today's remaining calendar events (upcoming only). */
async function eventsToday(token: string): Promise<Array<{ summary: string; start: string; guests: number }>> {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const data = await gget(token, `${CAL}?timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime&maxResults=10`);
  return ((data.items as Array<{ summary?: string; start?: { dateTime?: string; date?: string }; attendees?: unknown[] }>) || []).map((e) => ({
    summary: e.summary || '(busy)',
    start: e.start?.dateTime || e.start?.date || '',
    guests: (e.attendees || []).length,
  }));
}

/** The caller's stored social notifications (inbox-fed Signals engine). */
async function socialSignals(pool: AppContext['pool'], sub: string): Promise<Array<{ id: string; from: string; subject: string; snippet: string; receivedAt: string }>> {
  const rows = (await pool.query(
    `SELECT msg_id, from_addr, subject, snippet, received_at FROM oshal_inbox_messages
     WHERE user_sub = $1 AND category = 'social' AND received_at > NOW() - interval '7 days'
     ORDER BY received_at DESC LIMIT 30`,
    [sub],
  )).rows as Array<{ msg_id: string; from_addr: string; subject: string; snippet: string; received_at: string }>;
  return rows.map((r) => ({ id: r.msg_id, from: r.from_addr, subject: r.subject, snippet: r.snippet, receivedAt: r.received_at }));
}

/** Extract a human display name from an RFC From header (falls back to the address). */
function displayName(from: string): string {
  return (from.match(/^"?([^"<]+?)"?\s*</)?.[1] || from.split('@')[0] || from || 'unknown').trim();
}

/** Automated / bulk mail the operator never needs to reply to (counted as "handled"). */
function isBulk(from: string, subject: string): boolean {
  return /no-?reply|do-?not-?reply|notifications?@|mailer|newsletter|updates?@|billing@|receipts?@|support@|via\b/i.test(from)
    || /unsubscribe|receipt|order (confirmed|shipped)|statement is ready/i.test(subject);
}

/** Time-sensitive language → surface as overdue/needs-by. */
function timeSensitive(subject: string, snippet: string): boolean {
  return /\b(asap|urgent|eod|today|by (\d|noon|end of day)|deadline|due (today|by)|before the)\b/i.test(`${subject} ${snippet}`);
}

/** Infer the social platform from a notification's sender domain. */
function inferPlatform(from: string): FeedItem['source'] {
  const f = from.toLowerCase();
  if (f.includes('linkedin.com')) return 'linkedin';
  if (f.includes('facebookmail') || f.includes('facebook.com')) return 'facebook';
  if (f.includes('instagram')) return 'instagram';
  if (/(^|@|\.)(x|twitter)\.com/.test(f)) return 'x';
  return 'social';
}

/** Which time bucket a timestamp (+ hotness) belongs to. */
function bucketOf(ts: string, hot: boolean): FeedItem['group'] {
  const age = Date.now() - new Date(ts).getTime();
  if (hot || age < 2 * 3600e3) return 'now';
  if (age < 24 * 3600e3) return 'today';
  return 'week';
}

/** Rank comparator: overdue → hot → newest, meetings sort by start ascending. */
function rankItems(items: FeedItem[]): FeedItem[] {
  return items.sort((a, b) => {
    if (a.kind === 'meeting' && b.kind === 'meeting') return +new Date(a.ts) - +new Date(b.ts);
    const w = (x: FeedItem): number => (x.overdue ? 0 : x.hot ? 1 : 2);
    return w(a) - w(b) || +new Date(b.ts) - +new Date(a.ts);
  });
}

/** Map Gmail metadata → board items + the "handled" (bulk) count. */
function mailItems(msgs: MailSummary[]): { items: FeedItem[]; handled: number } {
  const items: FeedItem[] = [];
  let handled = 0;
  for (const m of msgs) {
    const bulk = isBulk(m.from, m.subject);
    if (!m.unread || bulk) { if (bulk || !m.important) handled++; continue; }
    const urgent = m.important && timeSensitive(m.subject, m.snippet);
    items.push({
      id: m.id, source: 'gmail', kind: 'mail', person: displayName(m.from),
      subject: m.subject, snippet: m.snippet, ts: m.receivedAt,
      group: bucketOf(m.receivedAt, true), hot: true, overdue: urgent,
      badge: urgent ? 'Time-sensitive' : 'Needs reply',
    });
  }
  return { items, handled };
}

/** Map calendar events → upcoming meeting items. */
function meetingItems(events: Array<{ summary: string; start: string; guests: number }>): FeedItem[] {
  return events.filter((e) => e.start && new Date(e.start).getTime() > Date.now() - 3600e3).slice(0, 4).map((e) => ({
    id: `cal-${e.start}`, source: 'calendar', kind: 'meeting', person: e.summary,
    snippet: e.guests ? `${e.guests} guest${e.guests === 1 ? '' : 's'} · today` : 'today',
    ts: e.start, group: bucketOf(e.start, new Date(e.start).getTime() - Date.now() < 90 * 60e3),
  }));
}

/** Map social signals → mention items (platform inferred from sender). */
function signalItems(sigs: Array<{ id: string; from: string; subject: string; snippet: string; receivedAt: string }>): FeedItem[] {
  return sigs.slice(0, 8).map((s) => ({
    id: s.id, source: inferPlatform(s.from), kind: 'mention', person: displayName(s.from),
    subject: s.subject, snippet: s.snippet, ts: s.receivedAt, group: bucketOf(s.receivedAt, false),
  }));
}

/** Assemble the whole board: pull → normalize → rank → count. */
function assembleBoard(msgs: MailSummary[], events: Array<{ summary: string; start: string; guests: number }>, sigs: Parameters<typeof signalItems>[0]): Record<string, unknown> {
  const mail = mailItems(msgs);
  const meetings = meetingItems(events);
  const signals = signalItems(sigs);
  const items = rankItems([...mail.items, ...meetings, ...signals]).slice(0, 12);
  const nextMeeting = meetings[0] ? new Date(meetings[0].ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
  return {
    items,
    counts: {
      needsReply: mail.items.length,
      timeSensitive: mail.items.filter((i) => i.overdue).length,
      meetings: meetings.length,
      handled: mail.handled,
    },
    nextMeeting,
  };
}

// ── Workspaces (ADR-113) ──────────────────────────────────────────────────────
// A "workspace" is a named brand/identity desk grouping a set of the caller's
// connected accounts. APP-OWNED state (NOT a connector-framework field): two tables,
// owner-RLS at this lazy-DDL chokepoint, membership keyed on oshal_connections.
// connection_id so it is forward-compatible with multi-account-per-provider.

/** Allowed workspace colour keys (the surface maps each to a hex). */
const WS_COLORS = ['brass', 'emerald', 'indigo', 'magenta', 'slate', 'teal', 'coral', 'amber'];

/** Friendly label for a connected account (provider + optional email). */
function accountLabel(provider: string, email: string | null): string {
  const names: Record<string, string> = {
    google: 'Gmail', gmail: 'Gmail', outlook: 'Outlook', linkedin: 'LinkedIn', twitter: 'X',
    'meta-business': 'Meta', facebook: 'Facebook', instagram: 'Instagram', slack: 'Slack',
    telegram: 'Telegram', discord: 'Discord', twilio: 'Phone / SMS',
  };
  const base = names[provider] || provider;
  return email ? `${base} · ${email}` : base;
}

/**
 * @description Create the two workspace tables if missing. Owner-RLS is appended at this
 * lazy-DDL chokepoint (buildOwnerRlsPolicyStatements, keyed on the oshal.current_sub GUC)
 * per the ADR-085 packaged-app rule — same discipline as oshal_email_digests.
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is ensured (or validated in validate-only mode).
 */
export async function ensureWorkspaceSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'switchboard workspaces',
    statements: [
      `CREATE TABLE IF NOT EXISTS oshal_switchboard_workspaces (
        workspace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_sub TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'brass',
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      ...buildOwnerRlsPolicyStatements('oshal_switchboard_workspaces', 'user_sub'),
      `CREATE TABLE IF NOT EXISTS oshal_switchboard_workspace_accounts (
        workspace_id UUID NOT NULL,
        user_sub TEXT NOT NULL,
        connection_id UUID NOT NULL,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, connection_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sb_wsa_user ON oshal_switchboard_workspace_accounts (user_sub, workspace_id)`,
      ...buildOwnerRlsPolicyStatements('oshal_switchboard_workspace_accounts', 'user_sub'),
    ],
    requirements: [
      { table: 'oshal_switchboard_workspaces', columns: ['workspace_id', 'user_sub', 'name', 'color', 'sort_order'] },
      { table: 'oshal_switchboard_workspace_accounts', columns: ['workspace_id', 'user_sub', 'connection_id'] },
    ],
  });
}

/** List the caller's connected accounts (the settings picker source). */
async function listAccounts(pool: AppContext['pool'], sub: string): Promise<Array<{ connectionId: string; provider: string; label: string; email: string | null }>> {
  const rows = (await pool.query(
    `SELECT connection_id, provider, account_email FROM oshal_connections
     WHERE user_sub = $1 AND status = 'connected' ORDER BY provider`,
    [sub],
  )).rows as Array<{ connection_id: string; provider: string; account_email: string | null }>;
  return rows.map((r) => ({ connectionId: r.connection_id, provider: r.provider, label: accountLabel(r.provider, r.account_email), email: r.account_email }));
}

/** List the caller's workspaces with their member connection_ids. */
async function listWorkspaces(pool: AppContext['pool'], sub: string): Promise<Array<Record<string, unknown>>> {
  const ws = (await pool.query('SELECT workspace_id, name, color, sort_order FROM oshal_switchboard_workspaces WHERE user_sub = $1 ORDER BY sort_order, created_at', [sub])).rows as Array<{ workspace_id: string; name: string; color: string; sort_order: number }>;
  const mem = (await pool.query('SELECT workspace_id, connection_id FROM oshal_switchboard_workspace_accounts WHERE user_sub = $1', [sub])).rows as Array<{ workspace_id: string; connection_id: string }>;
  const byWs = new Map<string, string[]>();
  for (const m of mem) { const a = byWs.get(m.workspace_id) || []; a.push(m.connection_id); byWs.set(m.workspace_id, a); }
  return ws.map((w) => ({ workspaceId: w.workspace_id, name: w.name, color: w.color, sortOrder: w.sort_order, accounts: byWs.get(w.workspace_id) || [] }));
}

/** Resolve the providers whose accounts belong to a workspace (empty/absent → null = all). */
async function workspaceProviderSet(pool: AppContext['pool'], sub: string, wsId: unknown): Promise<Set<string> | null> {
  if (typeof wsId !== 'string' || !wsId) return null;
  const rows = (await pool.query(
    `SELECT c.provider FROM oshal_switchboard_workspace_accounts m
     JOIN oshal_connections c ON c.connection_id = m.connection_id AND c.user_sub = m.user_sub
     WHERE m.user_sub = $1 AND m.workspace_id = $2`,
    [sub, wsId],
  )).rows as Array<{ provider: string }>;
  return new Set(rows.map((r) => r.provider));
}

/**
 * @description Builds the Switchboard app surface router. Serves the Today page and
 * the unified /feed board over the signed-in user's own stores. Cheap reads only —
 * no LLM in this path (ADR-036). Surfaces serve from the package tools/ dir (D10).
 *
 * @param ctx - App context (db pool for the social store + token lookup, appPackageDir for surfaces).
 * @returns Express router to mount at /api/switchboard (auth-gated by the mounter).
 */
export function createSwitchboardRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
  ensureWorkspaceSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure switchboard workspace schema'));

  // Surface: the Today board (default view) + the workspace organizer (settings).
  router.get('/today', servePage(assetRoot, 'switchboard-today.html'));
  router.get('/', servePage(assetRoot, 'switchboard-today.html'));
  router.get('/organize', servePage(assetRoot, 'switchboard-workspaces.html'));

  // Data: the unified board. ?workspace=<id> scopes the board to that desk's accounts
  // (ADR-113); absent = all. surface=1 → graceful "connect" payload instead of a 409.
  router.get('/feed', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    // Workspace scope: if the selected desk excludes the Google account, omit Gmail +
    // calendar from the board (they ride the google connection). Absent → include all.
    const providers = await workspaceProviderSet(ctx.pool, sub, req.query.workspace);
    const includeGoogle = !providers || providers.has('google');
    const token = includeGoogle ? await getValidAccessToken(ctx.pool, sub, 'google') : null;
    if (includeGoogle && !token) {
      if (req.query.surface === '1') { res.json({ connected: false, message: 'Connect your Google account at /utilities to light up your board.' }); return; }
      res.status(409).json({ error: 'no_google_connection', message: 'Connect your Google account at /utilities first.' });
      return;
    }
    try {
      const [msgs, events, sigs] = await Promise.all([
        token ? listInbox(token, 'in:inbox newer_than:2d', 40) : Promise.resolve([]),
        token ? eventsToday(token).catch(() => []) : Promise.resolve([]),
        socialSignals(ctx.pool, sub).catch(() => []),
      ]);
      res.json({ connected: true, workspace: typeof req.query.workspace === 'string' ? req.query.workspace : null, ...assembleBoard(msgs, events, sigs) });
    } catch (err) {
      logger.error({ err }, 'Switchboard feed failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // ── Workspaces (ADR-113): the caller organizes their connected accounts into
  //    named brand/identity desks. All row ops go through ctx.pool (GUC-stamped,
  //    owner-RLS enforced) AND filter by user_sub explicitly (defense in depth).

  /** GET /accounts — the caller's connected accounts (settings picker source). */
  router.get('/accounts', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      res.json({ accounts: await listAccounts(ctx.pool, sub) });
    } catch (err) {
      logger.error({ err }, 'Switchboard accounts list failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /workspaces — the caller's workspaces + their member connection_ids. */
  router.get('/workspaces', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      res.json({ workspaces: await listWorkspaces(ctx.pool, sub) });
    } catch (err) {
      logger.error({ err }, 'Switchboard workspaces list failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /workspaces {name, color?} — create a workspace. */
  router.post('/workspaces', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const name = String((req.body as { name?: string })?.name || '').trim();
    const rawColor = (req.body as { color?: string })?.color;
    const color = typeof rawColor === 'string' && WS_COLORS.includes(rawColor) ? rawColor : 'brass';
    if (!name || name.length > 60) { res.status(400).json({ error: 'name required (≤60 chars)' }); return; }
    try {
      const r = (await ctx.pool.query(
        'INSERT INTO oshal_switchboard_workspaces (user_sub, name, color) VALUES ($1, $2, $3) RETURNING workspace_id, name, color, sort_order',
        [sub, name, color],
      )).rows[0];
      res.status(201).json({ workspace: { workspaceId: r.workspace_id, name: r.name, color: r.color, sortOrder: r.sort_order, accounts: [] } });
    } catch (err) {
      logger.error({ err }, 'Switchboard workspace create failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** PATCH /workspaces/:id {name?, color?, sortOrder?} — rename / recolor / reorder. */
  router.patch('/workspaces/:id', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = (req.body || {}) as { name?: string; color?: string; sortOrder?: number };
    const sets: string[] = []; const vals: unknown[] = []; let i = 1;
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (!n || n.length > 60) { res.status(400).json({ error: 'name must be 1–60 chars' }); return; }
      sets.push(`name = $${i++}`); vals.push(n);
    }
    if (typeof body.color === 'string' && WS_COLORS.includes(body.color)) { sets.push(`color = $${i++}`); vals.push(body.color); }
    if (typeof body.sortOrder === 'number') { sets.push(`sort_order = $${i++}`); vals.push(Math.trunc(body.sortOrder)); }
    if (!sets.length) { res.status(400).json({ error: 'nothing to update' }); return; }
    vals.push(sub, req.params.id);
    try {
      const r = await ctx.pool.query(`UPDATE oshal_switchboard_workspaces SET ${sets.join(', ')}, updated_at = now() WHERE user_sub = $${i++} AND workspace_id = $${i}`, vals);
      if (!r.rowCount) { res.status(404).json({ error: 'workspace not found' }); return; }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Switchboard workspace update failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** DELETE /workspaces/:id — remove a workspace and its memberships. */
  router.delete('/workspaces/:id', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await ctx.pool.query('DELETE FROM oshal_switchboard_workspace_accounts WHERE user_sub = $1 AND workspace_id = $2', [sub, req.params.id]);
      const r = await ctx.pool.query('DELETE FROM oshal_switchboard_workspaces WHERE user_sub = $1 AND workspace_id = $2', [sub, req.params.id]);
      res.json({ ok: true, removed: r.rowCount || 0 });
    } catch (err) {
      logger.error({ err }, 'Switchboard workspace delete failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** PUT /workspaces/:id/accounts {connectionIds:[]} — replace the workspace's membership.
   *  Only the caller's OWN connections are added (the INSERT…SELECT validates ownership),
   *  so a forged connection_id from another user can never join a workspace. */
  router.put('/workspaces/:id/accounts', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const raw = (req.body as { connectionIds?: unknown })?.connectionIds;
    if (!Array.isArray(raw)) { res.status(400).json({ error: 'connectionIds array required' }); return; }
    const ids = raw.filter((x): x is string => typeof x === 'string');
    try {
      const owns = await ctx.pool.query('SELECT 1 FROM oshal_switchboard_workspaces WHERE user_sub = $1 AND workspace_id = $2', [sub, req.params.id]);
      if (!owns.rowCount) { res.status(404).json({ error: 'workspace not found' }); return; }
      await ctx.pool.query('DELETE FROM oshal_switchboard_workspace_accounts WHERE user_sub = $1 AND workspace_id = $2', [sub, req.params.id]);
      for (const cid of ids) {
        await ctx.pool.query(
          `INSERT INTO oshal_switchboard_workspace_accounts (workspace_id, user_sub, connection_id)
           SELECT $2, $1, connection_id FROM oshal_connections WHERE user_sub = $1 AND connection_id = $3
           ON CONFLICT DO NOTHING`,
          [sub, req.params.id, cid],
        );
      }
      res.json({ ok: true, count: ids.length });
    } catch (err) {
      logger.error({ err }, 'Switchboard workspace membership update failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Portal sections (each a self-contained module — ADR-113): the unified Inbox,
  // the content Calendar, and the Compose desk. Mounted under their own prefix.
  router.use('/inbox', createInboxRoutes(ctx));
  router.use('/calendar', createCalendarRoutes(ctx));
  router.use('/compose', createComposeRoutes(ctx));

  return router;
}
