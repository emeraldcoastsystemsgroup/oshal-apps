/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Fixed in-process Bluesky post operation (twilio-sms-operation shape, ADR-133): the caller's stored identifier:app-password is decrypted inside this function, exchanged for a session at two fixed AT-proto endpoints only, and never returned, logged, placed in process.env, or passed to a child process. The declarative connector tier cannot express the createSession token exchange (connector-spec contract §5), so this schema-bounded server operation is the sanctioned rail.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Same QueryablePool fix: derive the pool type from AppContext so this module compiles against the real framework types, not the package's ambient stub.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | postToBluesky was 52 lines; the createRecord call moved verbatim into createBlueskyPost so every function is under the 50-line limit. Same endpoint, headers, body, timeout, and sanitized error codes.
 *
 * @module marketing-bluesky-operation
 */

import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';

/** The framework pool surface, derived from AppContext so this never drifts from core. */
type QueryablePool = AppContext['pool'];

const logger = createChildLogger({ module: 'marketing-bluesky-operation' });

/** Bluesky caps a post at 300 graphemes; a simple length bound is the enforced approximation. */
const MAX_POST_CHARS = 300;
/** Handle shape: at least two dot-separated DNS labels (e.g. alice.bsky.social). */
const HANDLE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
/** DID shape (method + method-specific id; the id itself may contain colons). */
const DID_RE = /^did:[a-z]+:[A-Za-z0-9._%-]+$/;
/** Conservative email shape for identifier-by-email logins. */
const EMAIL_RE = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;

/** @description Sanitized result from the fixed Bluesky post server operation. */
export interface BlueskyPostResult {
  posted: boolean;
  uri?: string;
  error?: string;
}

/** The AT-proto service base URL (env-tunable, default the public Bluesky service). */
function serviceBase(): string {
  const configured = (process.env.MARKETING_BLUESKY_SERVICE || '').trim().replace(/\/+$/, '');
  return configured || 'https://bsky.social';
}

/**
 * Parse the stored `identifier:app-password` secret without accepting ambiguous or partial
 * shapes. Identifier may be a handle, a DID (which itself contains colons, so DIDs are matched
 * as a prefix before the generic first-colon split), or an email. Never logs any part of it.
 */
function parseBlueskyCredential(raw: string | null): { identifier: string; password: string } | null {
  if (!raw) return null;
  let identifier: string;
  let password: string;
  const didMatch = raw.match(/^(did:[a-z]+:[A-Za-z0-9._%-]+):(.+)$/);
  if (didMatch) {
    identifier = didMatch[1].trim();
    password = didMatch[2].trim();
  } else {
    const separator = raw.indexOf(':');
    if (separator <= 0 || separator >= raw.length - 1) return null;
    identifier = raw.slice(0, separator).trim();
    password = raw.slice(separator + 1).trim();
  }
  if (!password || password.length < 6 || password.length > 128 || /\s/.test(password)) return null;
  const identifierOk = DID_RE.test(identifier) || HANDLE_RE.test(identifier) || EMAIL_RE.test(identifier);
  return identifierOk ? { identifier, password } : null;
}

/**
 * Exchange the credential for a short-lived session at the fixed createSession endpoint.
 * Returns either the session or a sanitized error code; the password never leaves this call.
 */
async function createBlueskySession(
  base: string,
  identifier: string,
  password: string,
): Promise<{ accessJwt: string; did: string } | { error: string }> {
  const response = await fetch(`${base}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { error: `bluesky_auth_http_${response.status}` };
  const session = await response.json().catch(() => ({})) as { accessJwt?: unknown; did?: unknown };
  if (
    typeof session.accessJwt !== 'string' || !session.accessJwt.trim()
    || typeof session.did !== 'string' || !session.did.startsWith('did:')
  ) {
    return { error: 'bluesky_session_invalid' };
  }
  return { accessJwt: session.accessJwt, did: session.did };
}

/**
 * Create one app.bsky.feed.post record in the session owner's own repo at the fixed createRecord
 * endpoint. Returns a sanitized result; the session token never leaves this call.
 */
async function createBlueskyPost(
  base: string,
  session: { accessJwt: string; did: string },
  text: string,
  userSub: string,
): Promise<BlueskyPostResult> {
  const response = await fetch(`${base}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({})) as { uri?: unknown };
  if (!response.ok || typeof result.uri !== 'string' || !result.uri.trim()) {
    logger.warn({ userSub, status: response.status }, 'Bluesky post rejected');
    return { posted: false, error: `bluesky_post_http_${response.status}` };
  }
  return { posted: true, uri: result.uri };
}

/**
 * @description Publish one text post to the authenticated user's own Bluesky account. The stored
 * `identifier:app-password` secret is decrypted inside this function, used only against two fixed
 * AT-proto endpoints (createSession then createRecord), and never returned, logged, placed in
 * process.env, or passed to a child process. Both calls carry a 15s timeout.
 * @param pool - Controller database pool used by the connector credential resolver
 * @param userSub - Exact authenticated owner of the Bluesky connection
 * @param text - Plain post text (rejected, not truncated, above 300 characters)
 * @returns Sanitized post result: { posted, uri?, error? }
 */
export async function postToBluesky(
  pool: QueryablePool,
  userSub: string,
  text: string,
): Promise<BlueskyPostResult> {
  if (!userSub.trim()) return { posted: false, error: 'bluesky_user_required' };
  const boundedText = text.trim();
  if (!boundedText) return { posted: false, error: 'bluesky_text_required' };
  if (boundedText.length > MAX_POST_CHARS) return { posted: false, error: 'bluesky_text_too_long' };

  const combinedSecret = await getValidAccessToken(pool, userSub, 'bluesky');
  const credential = parseBlueskyCredential(combinedSecret);
  if (!credential) return { posted: false, error: 'bluesky_connection_unavailable' };

  const base = serviceBase();
  try {
    const session = await createBlueskySession(base, credential.identifier, credential.password);
    if ('error' in session) {
      logger.warn({ userSub, error: session.error }, 'Bluesky session exchange failed');
      return { posted: false, error: session.error };
    }
    return await createBlueskyPost(base, session, boundedText, userSub);
  } catch (error) {
    logger.error(
      { userSub, errorType: error instanceof Error ? error.name : 'unknown' },
      'Bluesky operation network failure',
    );
    return { posted: false, error: 'bluesky_network_failed' };
  }
}
