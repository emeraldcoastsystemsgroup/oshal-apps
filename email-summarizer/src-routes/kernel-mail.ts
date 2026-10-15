/**
 * Native-kernel mail egress for Intelligent Communication.
 *
 * Inside the native kernel's package sandbox there is no network and no connector broker: the
 * framework's getValidAccessToken answers null, and the framework email module
 * (@/app/routes/email-routes) is not present, so its senders and Gmail summarizer are inert stand-ins.
 * The kernel instead offers a fenced egress keyed by the manifest: this package declares
 * gmail.googleapis.com, www.googleapis.com, graph.microsoft.com and graph.facebook.com, each with the
 * caller's own connection applied by the kernel as a Bearer token. The package sends requests through
 * the global fetch with no Authorization header and never sees a credential.
 *
 * This module holds what that path needs and nothing else: which providers the caller has connected
 * (from the kernel's connectors.metadata intent, metadata only), the fetch wrapper that keeps a request
 * inside what the egress accepts and turns the kernel's "not connected" refusal into the package's own
 * 409, and the Gmail summary and the two senders the framework would otherwise provide. The senders keep
 * the framework's header-injection fence byte for byte: every header-bound value is CRLF-flattened here.
 * Outside the kernel (OSHAL_EGRESS unset) nothing in this module is used.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: connection state from connectors.metadata, the kernel fetch wrapper (allow-listed headers, "not connected" and 401 mapped to MailboxRefusal), the Gmail metadata summary and the Gmail / Graph senders for the native kernel.
 *
 * @module kernel-mail
 */

import { randomBytes } from 'crypto';
import { MailboxRefusal, missingConnectionBody, type MailProvider, type TokenProvider } from './mail-provider';

/** The sentinel token the mailbox carries under the kernel: the kernel, not the package, holds the credential. */
export const KERNEL_TOKEN = 'kernel';

/** Request headers the kernel egress lets a package set itself; anything else (Authorization, Prefer) is dropped. */
const PACKAGE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match',
  'if-modified-since', 'x-requested-with', 'cache-control', 'range']);

/** Connector ids naming one provider's grant. The kernel resolves the Google aliases to the same authorization. */
const CONNECTORS: Record<TokenProvider | 'facebook', readonly string[]> = {
  google: ['google', 'gmail', 'google-calendar', 'google-drive'],
  outlook: ['outlook', 'microsoft'],
  facebook: ['facebook'],
};

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** What the caller's connection allows, as far as the metadata can tell. */
export type ConnectionState = 'connected' | 'reconnect' | 'none';

/** One saved connection as the kernel describes it: never a credential. */
interface ConnectionMetadata { provider?: string; revoked?: boolean; expires_at_ms?: number | null; renewable?: boolean }

/** A Gmail message summary: the same privacy-bounded shape as the framework's summarizeGmailMetadata. */
export interface GmailSummary {
  id: string; from: string; subject: string; date: string; internalDate: string; receivedAt: string; snippet: string;
  unread: boolean; important: boolean; starred: boolean; providerFlags: { unread: boolean; important: boolean; starred: boolean };
}

/** One outbound message (the framework senders' call shape). */
export interface OutboundMessage { to: string; subject: string; body: string; attachment?: { filename: string; contentBase64: string; mimeType?: string } }

/**
 * @description True inside the native kernel's package sandbox, where manifest egress declarations carry the credentials.
 * @returns Whether mail requests go through the kernel egress.
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
export async function readConnections(ctx: unknown, onError: (err: unknown) => void = () => undefined): Promise<{ connections?: ConnectionMetadata[] } | null> {
  const intent = (ctx as { intent?: (name: string, input: unknown) => Promise<unknown> } | null)?.intent;
  if (typeof intent !== 'function') return null;
  try {
    const answer = await intent.call(ctx, 'connectors.metadata', {});
    return answer && typeof answer === 'object' ? answer as { connections?: ConnectionMetadata[] } : null;
  } catch (err) {
    onError(err);
    return null;
  }
}

/**
 * @description Classify one provider's connection. Usable unless revoked, or past its expiry with nothing to renew it.
 * @param meta - The connectors.metadata answer (or null when unknown).
 * @param provider - The provider family.
 * @param now - Clock seam in milliseconds.
 * @returns The state, or null when the metadata cannot say.
 */
export function connectionState(meta: { connections?: ConnectionMetadata[] } | null, provider: TokenProvider | 'facebook', now = Date.now()): ConnectionState | null {
  if (!meta || !Array.isArray(meta.connections)) return null;
  const ids = CONNECTORS[provider];
  const rows = meta.connections.filter((c) => ids.includes(String(c?.provider || '').toLowerCase()));
  if (!rows.length) return 'none';
  const usable = rows.some((c) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
  return usable ? 'connected' : 'reconnect';
}

/**
 * @description The selectMailConnection lookup under the kernel: the sentinel for a usable (or unknown) connection,
 * null for none, and a throw for a lapsed one so the selection reports reconnect.
 * @param meta - The connectors.metadata answer (or null).
 * @returns The per-provider lookup.
 */
export function kernelTokenFor(meta: { connections?: ConnectionMetadata[] } | null): (provider: TokenProvider) => Promise<string | null> {
  return async (provider) => {
    const state = connectionState(meta, provider);
    if (state === 'none') return null;
    if (state === 'reconnect') throw new Error(`${provider} connection has lapsed`);
    return KERNEL_TOKEN;
  };
}

/** Keep only the headers the kernel egress accepts from a package. */
function packageHeaders(headers: unknown): Record<string, string> {
  const entries = headers && typeof headers === 'object' ? Object.entries(headers as Record<string, unknown>) : [];
  return Object.fromEntries(entries.filter(([name]) => PACKAGE_HEADERS.has(name.toLowerCase())).map(([name, value]) => [name, String(value)]));
}

/**
 * @description A fetch for one provider through the kernel egress: drops the headers the kernel would refuse (the
 * kernel applies Authorization itself), answers a kernel "not connected" refusal as the 409 a missing connection gets,
 * and a 401 as reconnect.
 * @param provider - The mailbox provider whose refusal body to use.
 * @returns A fetch-compatible function.
 */
export function kernelFetch(provider: MailProvider): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init = {}) => {
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers: packageHeaders(init.headers) });
    } catch (err) {
      if (/not connected/i.test(String((err as Error)?.message || ''))) throw new MailboxRefusal(409, provider, missingConnectionBody(provider));
      throw err;
    }
    if (response.status === 401) throw new MailboxRefusal(409, provider, missingConnectionBody(provider, true));
    return response;
  };
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
 * summarizeGmailMetadata (labels reduced to UNREAD/IMPORTANT/STARRED; no body), for the kernel where that module is absent.
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

/**
 * @description Build the RFC-2822 message exactly as the framework's sendGmail does, header-injection fence included:
 * to/subject/filename are CRLF-flattened, the filename loses double quotes and the MIME type anything non-token.
 * @param m - The outbound message.
 * @returns The raw message text.
 */
export function gmailRaw(m: OutboundMessage): string {
  const join = (lines: string[]) => lines.join('\r\n');
  const headerSafe = (s: string) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  const to = headerSafe(m.to);
  const subject = headerSafe(m.subject);
  if (!m.attachment || !m.attachment.contentBase64) {
    return join([`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', m.body]);
  }
  const boundary = `oshal_${randomBytes(8).toString('hex')}`;
  const att = m.attachment;
  const filename = headerSafe(att.filename).replace(/"/g, '');
  const mimeType = (att.mimeType || 'application/octet-stream').replace(/[^\w./+-]/g, '');
  return join([
    `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', '', m.body, '',
    `--${boundary}`, `Content-Type: ${mimeType}; name="${filename}"`, `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64', '', att.contentBase64.replace(/\s+/g, ''), '', `--${boundary}--`,
  ]);
}

/**
 * @description Send through Gmail users.messages.send via the kernel egress (gmail.send scope on the caller's grant).
 * @param m - The outbound message.
 * @returns The provider message id.
 */
export async function kernelSendGmail(m: OutboundMessage): Promise<{ id: string }> {
  const r = await kernelFetch('google')(`${GMAIL}/messages/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(gmailRaw(m), 'utf8').toString('base64url') }),
  });
  if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { id: String(((await r.json()) as { id?: unknown }).id || '') };
}

/**
 * @description Send through Microsoft Graph users/me/sendMail via the kernel egress, the same JSON as the framework's
 * sendOutlookMail. Graph answers 202 with no message id.
 * @param m - The outbound message.
 * @returns An empty provider id.
 */
export async function kernelSendOutlook(m: OutboundMessage): Promise<{ id: string }> {
  const message: Record<string, unknown> = {
    subject: m.subject, body: { contentType: 'Text', content: m.body }, toRecipients: [{ emailAddress: { address: m.to } }],
  };
  if (m.attachment?.contentBase64) {
    message.attachments = [{
      '@odata.type': '#microsoft.graph.fileAttachment', name: m.attachment.filename,
      contentType: m.attachment.mimeType || 'application/octet-stream', contentBytes: m.attachment.contentBase64.replace(/\s+/g, ''),
    }];
  }
  const r = await kernelFetch('outlook')('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!r.ok) throw new Error(`graph sendMail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { id: '' };
}
