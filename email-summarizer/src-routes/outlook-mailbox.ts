/**
 * Outlook mailbox adapter — Microsoft Graph reads for Intelligent Communication (ADR-037).
 *
 * The Outlook / Microsoft 365 sibling of the Gmail reads in email-app-routes. Every call is a
 * FIXED Graph v1.0 operation on the caller's own mailbox (`/me/...`) with the bearer token the
 * route resolved from that caller's own connection; no URL, host or OData expression is ever
 * taken from the request. Results are normalized onto the kernel's MailSummary shape (the one
 * summarizeGmailMetadata builds), so the list, digest, bot summary and draft paths treat both
 * providers identically.
 *
 * Dependency-free at runtime (types only) so the compiled module can be exercised directly by
 * node:test with a recording fetch.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: inbox list (receivedDateTime window, clamped $top, @odata.nextLink followed only on graph.microsoft.com and only up to the cap), one message with a text-body preference, today's calendarView and the caller's own address, all normalized to MailSummary.
 *
 * @module outlook-mailbox
 */

import type { summarizeGmailMetadata } from '@/app/routes/email-routes';

/** The privacy-bounded per-message metadata shape shared with the Gmail leg. */
export type MailSummary = ReturnType<typeof summarizeGmailMetadata>;

/** One message opened for reading or drafting. */
export type MailDetail = MailSummary & { to: string; body: string };

/** One calendar entry in the My Day digest. */
export interface CalendarEvent {
  summary: string;
  start: string;
  location: string;
}

/** The fetch signature the adapter needs; injectable so tests record every request. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_BASE = `${GRAPH_ORIGIN}/v1.0`;
/** Largest list the surfaces ask for; also the Graph $top ceiling this adapter sends. */
export const OUTLOOK_MAX_LIST = 50;
/** Pages followed through @odata.nextLink before the adapter stops, whatever the cap. */
export const OUTLOOK_MAX_PAGES = 5;
const MAX_DAYS = 30;
const SNIPPET_MAX = 300;
const BODY_MAX = 20000;
const ID_MAX = 512;
const LIST_SELECT = 'id,subject,from,receivedDateTime,bodyPreview,isRead,importance,flag';
const DETAIL_SELECT = `${LIST_SELECT},toRecipients,body`;

/** A non-2xx Graph answer; the status is kept so callers can map 401/403. */
export class GraphRequestError extends Error {
  readonly status: number;

  /**
   * @description Build the error with the Graph status and a bounded response excerpt.
   * @param status - HTTP status Graph answered.
   * @param detail - Response body excerpt (already bounded).
   * @returns A GraphRequestError.
   */
  constructor(status: number, detail: string) {
    super(`graph ${status}: ${detail}`);
    this.name = 'GraphRequestError';
    this.status = status;
  }
}

interface GraphAddress { emailAddress?: { name?: string; address?: string } }
interface GraphMessage {
  id?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  importance?: string;
  flag?: { flagStatus?: string };
  body?: { contentType?: string; content?: string };
}

/**
 * @description Clamp a requested list size into 1..OUTLOOK_MAX_LIST (default 25).
 * @param value - Caller-supplied size.
 * @returns The bounded size.
 */
export function clampListSize(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : 25, 1), OUTLOOK_MAX_LIST);
}

/**
 * @description Clamp a look-back window into 1..30 days (default 7).
 * @param value - Caller-supplied day count.
 * @returns The bounded day count.
 */
export function clampDays(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : 7, 1), MAX_DAYS);
}

/** One header-safe display fragment: no CR/LF, no quote or angle bracket from a display name. */
function clean(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/["<>]/g, '').trim().slice(0, max);
}

/** Graph emailAddress → the `Name <address>` form the Gmail From header uses. */
function formatAddress(value: GraphAddress | undefined): string {
  const name = clean(value?.emailAddress?.name, 200);
  const address = clean(value?.emailAddress?.address, 320);
  if (name && address && name.toLowerCase() !== address.toLowerCase()) return `${name} <${address}>`;
  return address || name;
}

/** Received time as ISO, or '' when Graph sent nothing parseable. */
function receivedIso(value: unknown): string {
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/**
 * @description Map one Graph message onto MailSummary. `unread` is `isRead === false`,
 * `important` is Graph importance `high`, `starred` is a `flagged` follow-up flag — the three
 * deterministic prioritization flags the Gmail leg derives from UNREAD/IMPORTANT/STARRED.
 * `date` and `receivedAt` are the ISO receive time; `internalDate` is its epoch milliseconds,
 * matching Gmail's field.
 * @param message - The Graph message resource.
 * @returns The bounded metadata summary.
 */
export function normalizeGraphMessage(message: unknown): MailSummary {
  const m = (message || {}) as GraphMessage;
  const receivedAt = receivedIso(m.receivedDateTime);
  const unread = m.isRead === false;
  const important = String(m.importance || '').toLowerCase() === 'high';
  const starred = String(m.flag?.flagStatus || '').toLowerCase() === 'flagged';
  return {
    id: String(m.id || ''),
    from: formatAddress(m.from),
    subject: clean(m.subject, 500) || '(no subject)',
    date: receivedAt,
    internalDate: receivedAt ? String(Date.parse(receivedAt)) : '',
    receivedAt,
    snippet: String(m.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX),
    unread,
    important,
    starred,
    providerFlags: { unread, important, starred },
  };
}

/**
 * @description Accept a pagination link only when it stays on Graph's own origin and the caller's
 * own mailbox path; anything else is not followed, so the bearer token cannot be sent elsewhere.
 * @param value - The `@odata.nextLink` Graph returned.
 * @returns The link, or null when absent or foreign.
 */
export function safeNextLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.origin === GRAPH_ORIGIN && url.pathname.startsWith('/v1.0/me/') ? url.toString() : null;
  } catch {
    return null;
  }
}

/** GET one Graph URL with the bearer token; refuses any origin but Graph's. */
async function graphGet(token: string, url: string, fetchImpl: FetchLike, prefer?: string): Promise<Record<string, unknown>> {
  if (new URL(url).origin !== GRAPH_ORIGIN) throw new Error('graph request outside graph.microsoft.com refused');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new GraphRequestError(response.status, (await response.text()).slice(0, 200));
  return (await response.json()) as Record<string, unknown>;
}

/**
 * @description Build the fixed inbox list URL: a receivedDateTime window, newest first, the
 * digest $select and a clamped $top. The orderby property is the filter property, the only
 * $filter + $orderby pairing Graph accepts on messages (the core CR-22 sync reader sends the same).
 * @param sinceIso - Start of the window (ISO, computed by this module).
 * @param top - Page size (already clamped).
 * @returns The Graph URL.
 */
export function buildInboxListUrl(sinceIso: string, top: number): string {
  const query = new URLSearchParams();
  query.set('$filter', `receivedDateTime ge ${sinceIso}`);
  query.set('$orderby', 'receivedDateTime desc');
  query.set('$top', String(top));
  query.set('$select', LIST_SELECT);
  return `${GRAPH_BASE}/me/mailFolders/inbox/messages?${query.toString()}`;
}

/**
 * @description List the caller's inbox for the last `days`, newest first, at most `max` rows,
 * following @odata.nextLink (Graph-origin only) for at most OUTLOOK_MAX_PAGES pages.
 * @param token - The caller's Graph access token.
 * @param options - `{ days, max }`, both clamped here.
 * @param fetchImpl - fetch seam.
 * @param now - Clock seam for the window start.
 * @returns Normalized summaries.
 */
export async function listOutlookInbox(
  token: string, options: { days?: unknown; max?: unknown }, fetchImpl: FetchLike, now: Date = new Date(),
): Promise<MailSummary[]> {
  const max = clampListSize(options.max);
  const since = new Date(now.getTime() - clampDays(options.days) * 86_400_000).toISOString();
  const out: MailSummary[] = [];
  let url: string | null = buildInboxListUrl(since, max);
  for (let page = 0; url && page < OUTLOOK_MAX_PAGES && out.length < max; page++) {
    const data = await graphGet(token, url, fetchImpl);
    const rows = Array.isArray(data.value) ? data.value : [];
    for (const row of rows) {
      if (out.length >= max) break;
      const summary = normalizeGraphMessage(row);
      if (summary.id) out.push(summary);
    }
    url = safeNextLink(data['@odata.nextLink']);
  }
  return out.sort((a, b) => (Number(b.internalDate) || 0) - (Number(a.internalDate) || 0));
}

/** HTML body → readable text (fallback when Graph ignores the text preference). */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @description Validate a Graph message id from the request: nonempty, bounded, printable.
 * Graph ids carry `=`, `/` and `+`, so the id is URL-encoded as ONE path segment by the caller.
 * @param value - The id from the route.
 * @returns The id, or null when unusable.
 */
export function validMessageId(value: unknown): string | null {
  const id = String(value ?? '');
  return id && id.length <= ID_MAX && !/[\u0000-\u001f\s]/.test(id) ? id : null;
}

/**
 * @description Open one message of the caller's mailbox with the recipients and a bounded
 * text body (Graph `Prefer: outlook.body-content-type="text"`).
 * @param token - The caller's Graph access token.
 * @param id - Graph message id (validated by validMessageId).
 * @param fetchImpl - fetch seam.
 * @returns The summary plus `to` and `body`.
 */
export async function getOutlookMessage(token: string, id: string, fetchImpl: FetchLike): Promise<MailDetail> {
  const query = new URLSearchParams({ $select: DETAIL_SELECT });
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}?${query.toString()}`;
  const m = (await graphGet(token, url, fetchImpl, 'outlook.body-content-type="text"')) as GraphMessage;
  const raw = String(m.body?.content || '');
  const body = String(m.body?.contentType || '').toLowerCase() === 'html' ? htmlToText(raw) : raw;
  return {
    ...normalizeGraphMessage(m),
    to: (Array.isArray(m.toRecipients) ? m.toRecipients : []).map(formatAddress).filter(Boolean).join(', '),
    body: body.slice(0, BODY_MAX),
  };
}

/** Graph dateTimeTimeZone → an instant the surface can parse ('Z' added for bare UTC values). */
function eventStart(start: { dateTime?: string; timeZone?: string } | undefined, allDay: boolean): string {
  const value = String(start?.dateTime || '');
  if (!value) return '';
  if (allDay) return value.slice(0, 10);
  const utc = String(start?.timeZone || '').toUpperCase() === 'UTC';
  return utc && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? `${value.replace(/\.\d+$/, '')}Z` : value;
}

/**
 * @description Today's events from the caller's default calendar (server-local midnight to
 * midnight, the same window the Gmail leg reads), start order, at most 50.
 * @param token - The caller's Graph access token.
 * @param fetchImpl - fetch seam.
 * @param now - Clock seam.
 * @returns The events in the digest shape.
 */
export async function outlookEventsToday(token: string, fetchImpl: FetchLike, now: Date = new Date()): Promise<CalendarEvent[]> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const query = new URLSearchParams({
    startDateTime: start, endDateTime: end, $orderby: 'start/dateTime', $top: '50',
    $select: 'subject,start,location,isAllDay',
  });
  const data = await graphGet(token, `${GRAPH_BASE}/me/calendarView?${query.toString()}`, fetchImpl);
  const rows = (Array.isArray(data.value) ? data.value : []) as Array<{
    subject?: string; start?: { dateTime?: string; timeZone?: string }; location?: { displayName?: string }; isAllDay?: boolean;
  }>;
  return rows.map((e) => ({
    summary: clean(e.subject, 300) || '(busy)',
    start: eventStart(e.start, e.isAllDay === true),
    location: clean(e.location?.displayName, 300),
  }));
}

/**
 * @description The caller's own mailbox address (for "email me a copy").
 * @param token - The caller's Graph access token.
 * @param fetchImpl - fetch seam.
 * @returns `mail`, else `userPrincipalName`, else ''.
 */
export async function outlookOwnAddress(token: string, fetchImpl: FetchLike): Promise<string> {
  const me = await graphGet(token, `${GRAPH_BASE}/me?$select=mail,userPrincipalName`, fetchImpl);
  return clean(me.mail || me.userPrincipalName, 320);
}
