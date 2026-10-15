/**
 * Switchboard native-kernel egress helpers.
 *
 * Inside the native kernel's package sandbox there is no network and no connector broker: the
 * framework's getValidAccessToken answers null, and the framework email and Slack modules are inert
 * stand-ins. The kernel instead offers a fenced egress keyed by this package's manifest: each declared
 * host carries the caller's own connection, applied by the kernel as a Bearer token. The package calls
 * the global fetch with no Authorization header and never sees a credential.
 *
 * This module holds what that path needs: which providers the caller has connected (from the kernel's
 * connectors.metadata intent, metadata only), recognition of the kernel's "not connected" refusal, the
 * Gmail metadata summary the framework would otherwise provide, and the Slack Web API reads the Inbox
 * needs (auth.test, users.conversations, conversations.history, users.info) without a token.
 * Outside the kernel (OSHAL_EGRESS unset) nothing in this module is used.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: connection state from connectors.metadata, the kernel "not connected" refusal test, the package-local Gmail metadata summary and the token-free Slack feed reads for the native kernel egress.
 *
 * @module switchboard-kernel-egress
 */

/** Connector ids naming one provider family's grant. The kernel resolves the Google aliases to one authorization. */
export const GOOGLE_IDS: readonly string[] = ['google', 'gmail', 'google-calendar', 'google-drive'];
export const OUTLOOK_IDS: readonly string[] = ['outlook', 'microsoft'];
export const SLACK_IDS: readonly string[] = ['slack'];

const SLACK_API = 'https://slack.com/api';

/** What the caller's connection allows, as far as the metadata can tell. */
export type ConnectionState = 'connected' | 'reconnect' | 'none';

/** One saved connection as the kernel describes it: never a credential. */
export interface ConnectionMetadata {
  id?: string;
  label?: string;
  provider?: string;
  revoked?: boolean;
  expires_at_ms?: number | null;
  renewable?: boolean;
}

/** The connectors.metadata answer. */
export interface ConnectionsAnswer { connections?: ConnectionMetadata[] }

/** A Gmail message summary: the same privacy-bounded shape as the framework's summarizeGmailMetadata. */
export interface GmailSummary {
  id: string; from: string; subject: string; date: string; internalDate: string; receivedAt: string; snippet: string;
  unread: boolean; important: boolean; starred: boolean; providerFlags: { unread: boolean; important: boolean; starred: boolean };
}

/** One normalized Slack message (the framework slack-client's feed shape). */
export interface SlackRow {
  channelId: string;
  channel: string;
  type: 'channel' | 'private' | 'im' | 'mpim';
  userId: string | null;
  user: string | null;
  text: string;
  ts: string;
  time: string;
}

/** Caps for one Slack pull. */
export interface SlackPullOptions { maxChannels: number; perChannel: number; maxUsers: number }

/**
 * @description True inside the native kernel's package sandbox, where manifest egress declarations carry the credentials.
 * @returns Whether provider requests go through the kernel egress.
 */
export function kernelEgress(): boolean {
  return process.env.OSHAL_EGRESS === 'kernel';
}

/**
 * @description Read the caller's saved connections from the kernel (metadata only). A context without the intent, or a
 * refused intent, answers null: the state is then unknown and the provider request itself decides.
 * @param ctx - The application context; the native bridge carries `intent`.
 * @param onError - Told about a refused intent so the route can log it.
 * @returns The connectors.metadata answer, or null.
 */
export async function readConnections(ctx: unknown, onError: (err: unknown) => void = () => undefined): Promise<ConnectionsAnswer | null> {
  const intent = (ctx as { intent?: (name: string, input: unknown) => Promise<unknown> } | null)?.intent;
  if (typeof intent !== 'function') return null;
  try {
    const answer = await intent.call(ctx, 'connectors.metadata', {});
    return answer && typeof answer === 'object' ? answer as ConnectionsAnswer : null;
  } catch (err) {
    onError(err);
    return null;
  }
}

/**
 * @description Whether one saved connection can be used: not revoked, and not past its expiry with nothing to renew it.
 * @param c - The connection metadata.
 * @param now - Clock seam in milliseconds.
 * @returns True when the kernel can apply it.
 */
export function usableConnection(c: ConnectionMetadata, now = Date.now()): boolean {
  return c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true);
}

/**
 * @description Classify one provider family's connection.
 * @param meta - The connectors.metadata answer (or null when unknown).
 * @param ids - The connector ids naming that provider family.
 * @param now - Clock seam in milliseconds.
 * @returns The state, or null when the metadata cannot say.
 */
export function connectionState(meta: ConnectionsAnswer | null, ids: readonly string[], now = Date.now()): ConnectionState | null {
  if (!meta || !Array.isArray(meta.connections)) return null;
  const rows = meta.connections.filter((c) => ids.includes(String(c?.provider || '').toLowerCase()));
  if (!rows.length) return 'none';
  return rows.some((c) => usableConnection(c, now)) ? 'connected' : 'reconnect';
}

/**
 * @description The caller's usable connections from the metadata (revoked and lapsed ones dropped).
 * @param meta - The connectors.metadata answer (or null).
 * @param now - Clock seam in milliseconds.
 * @returns The usable connection rows.
 */
export function usableConnections(meta: ConnectionsAnswer | null, now = Date.now()): ConnectionMetadata[] {
  return (meta && Array.isArray(meta.connections) ? meta.connections : []).filter((c) => c && c.provider && usableConnection(c, now));
}

/**
 * @description Whether an error is the kernel egress refusing a request because the caller has no connection for
 * the declared connector ("<connector> is not connected: connect it on Utilities ...").
 * @param err - The rejection.
 * @returns True for the not-connected refusal.
 */
export function isNotConnected(err: unknown): boolean {
  return /is not connected/i.test(String((err as Error | null)?.message || ''));
}

/** Read a header value (case-insensitive) from a Gmail message payload. */
function header(msg: Record<string, unknown>, name: string): string {
  const payload = msg.payload as { headers?: Array<{ name: string; value: string }> } | undefined;
  const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

/** Gmail's millisecond internalDate as a stable ISO time, or '' when unusable. */
function receivedAt(internalDate: string): string {
  const millis = Number(internalDate);
  if (!Number.isFinite(millis) || millis <= 0) return '';
  const received = new Date(millis);
  return Number.isNaN(received.getTime()) ? '' : received.toISOString();
}

/**
 * @description The privacy-bounded Gmail metadata summary, identical in shape and rules to the framework's
 * summarizeGmailMetadata (labels reduced to UNREAD/IMPORTANT/STARRED; no body), for the kernel where that module is inert.
 * @param id - Fallback message id when the payload lacks one.
 * @param msg - The Gmail message payload.
 * @returns The bounded summary.
 */
export function summarizeGmail(id: string, msg: Record<string, unknown>): GmailSummary {
  const labelIds = (msg.labelIds as string[]) || [];
  const unread = labelIds.includes('UNREAD');
  const important = labelIds.includes('IMPORTANT');
  const starred = labelIds.includes('STARRED');
  const internalDate = msg.internalDate == null ? '' : String(msg.internalDate);
  return {
    id: String(msg.id || id), from: header(msg, 'From'), subject: header(msg, 'Subject') || '(no subject)', date: header(msg, 'Date'),
    internalDate, receivedAt: receivedAt(internalDate), snippet: (msg.snippet as string) || '',
    unread, important, starred, providerFlags: { unread, important, starred },
  };
}

/** A Slack Web API GET through the kernel egress. Slack answers 200 and reports failure in { ok:false, error }. */
async function slackGet(method: string, params: Record<string, string> = {}): Promise<Record<string, any>> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${SLACK_API}/${method}${qs ? `?${qs}` : ''}`);
  return r.json().catch(() => ({ ok: false, error: 'bad_json' })) as Promise<Record<string, any>>;
}

/**
 * @description Validate the caller's Slack connection and name its user (auth.test) through the kernel egress.
 * @returns Whether Slack accepted the connection, plus the user id when it did.
 */
export async function kernelSlackIdentity(): Promise<{ ok: boolean; userId?: string }> {
  const j = await slackGet('auth.test');
  return { ok: !!j.ok, userId: j.user_id };
}

/** Recent history of one conversation, as normalized rows; author ids collected into `userIds`. */
async function conversationRows(c: Record<string, any>, perChannel: number, userIds: Set<string>): Promise<SlackRow[] | null> {
  const type: SlackRow['type'] = c.is_im ? 'im' : c.is_mpim ? 'mpim' : c.is_private ? 'private' : 'channel';
  if (c.is_im && c.user) userIds.add(c.user);
  const hist = await slackGet('conversations.history', { channel: c.id, limit: String(perChannel) });
  if (!hist.ok) return null;
  const rows: SlackRow[] = [];
  for (const m of (hist.messages || []) as Array<Record<string, any>>) {
    if (m.subtype && m.subtype !== 'thread_broadcast') continue;
    if (m.user) userIds.add(m.user);
    rows.push({
      channelId: c.id, channel: c.name || (c.is_im ? `dm:${c.user || c.id}` : c.id), type,
      userId: m.user || null, user: null, text: String(m.text || ''), ts: m.ts,
      time: new Date(Math.floor(parseFloat(m.ts) * 1000)).toISOString(),
    });
  }
  return rows;
}

/** Resolve author ids to display handles (capped) and name DM channels after their partner. */
async function resolveNames(messages: SlackRow[], userIds: Set<string>, maxUsers: number): Promise<void> {
  const names = new Map<string, string>();
  for (const uid of Array.from(userIds).slice(0, maxUsers)) {
    const info = await slackGet('users.info', { user: uid });
    if (info.ok && info.user) names.set(uid, info.user.profile?.display_name || info.user.real_name || info.user.name || uid);
  }
  for (const m of messages) {
    if (m.userId) m.user = names.get(m.userId) || m.userId;
    if (m.type === 'im' && m.channel.startsWith('dm:')) {
      const partner = m.channel.slice(3);
      m.channel = `DM · ${names.get(partner) || partner}`;
    }
  }
}

/**
 * @description Pull the caller's recent Slack messages across channels and DMs through the kernel egress, the same reads
 * and caps as the framework slack-client's pullSlackFeed, merged newest-first with author handles resolved.
 * @param opts - Conversation, per-conversation and author-lookup caps.
 * @returns The normalized messages.
 */
export async function kernelPullSlackFeed(opts: SlackPullOptions): Promise<{ messages: SlackRow[] }> {
  const convResp = await slackGet('users.conversations', { types: 'public_channel,private_channel,im,mpim', exclude_archived: 'true', limit: '200' });
  if (!convResp.ok) throw new Error(`slack users.conversations failed: ${convResp.error || 'unknown'}`);
  const convos = (Array.isArray(convResp.channels) ? convResp.channels : []).slice(0, opts.maxChannels) as Array<Record<string, any>>;
  const messages: SlackRow[] = [];
  const userIds = new Set<string>();
  for (const c of convos) messages.push(...((await conversationRows(c, opts.perChannel, userIds)) || []));
  await resolveNames(messages, userIds, opts.maxUsers);
  messages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
  return { messages };
}
