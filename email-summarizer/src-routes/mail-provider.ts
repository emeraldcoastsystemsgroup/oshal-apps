/**
 * Mail provider selection for Intelligent Communication (ADR-037).
 *
 * One closed list of mailbox providers the /api/email routes can read, the parser for the
 * `?provider=` switch, and the choice of brokered connection when the caller names none. Token lookup is
 * injected (the route passes the kernel broker, getValidAccessToken, bound to the caller's own
 * sub), so this module never sees a pool, another user's sub or a credential store and can be
 * exercised directly by node:test.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: google|outlook provider switch, Google-first default for callers that name no provider, and per-provider missing/reconnect error bodies.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add 'yahoo' to the switch. Yahoo is not a TOKEN provider: its app password is resolved and spent inside core's fixed IMAP reader, so the broker lookup here stays google|outlook and Yahoo is read through the AppContext seam. MailboxRefusal carries a provider-shaped refusal (status + body) out of a mailbox operation.
 *
 * @module mail-provider
 */

/** Mailbox providers the package reads, in default-selection order (Google first, as before). */
export const MAIL_PROVIDERS = ['google', 'outlook', 'yahoo'] as const;

/** One supported mailbox provider id (the kernel connector id). */
export type MailProvider = typeof MAIL_PROVIDERS[number];

/**
 * Providers whose short-lived token this package may resolve through the kernel broker. Yahoo is
 * deliberately absent: its app password never leaves core (AppContext `imapMail`).
 */
export const TOKEN_PROVIDERS = ['google', 'outlook'] as const;

/** A provider read with a brokered bearer token. */
export type TokenProvider = typeof TOKEN_PROVIDERS[number];

/** Human names used in the refusal messages. */
const PROVIDER_LABEL: Record<MailProvider, string> = {
  google: 'Google',
  outlook: 'Outlook / Microsoft 365',
  yahoo: 'Yahoo Mail',
};

/** A mailbox operation the route must answer with this status and body instead of a 502. */
export class MailboxRefusal extends Error {
  readonly status: number;
  readonly provider: MailProvider | null;
  readonly body: { error: string; message: string };

  /**
   * @description Carry a refusal out of a mailbox operation.
   * @param status - HTTP status for the route to answer.
   * @param provider - The provider the refusal names (null when the caller named none).
   * @param body - `{ error, message }`.
   * @returns A MailboxRefusal.
   */
  constructor(status: number, provider: MailProvider | null, body: { error: string; message: string }) {
    super(body.error);
    this.name = 'MailboxRefusal';
    this.status = status;
    this.provider = provider;
    this.body = body;
  }
}

/** Result of parsing the `?provider=` switch. */
export type ProviderChoice = { ok: true; provider: MailProvider | null } | { ok: false };

/**
 * @description Parse the provider switch. Absent or empty means "the caller's connected
 * provider"; anything outside MAIL_PROVIDERS is refused rather than guessed.
 * @param raw - `req.query.provider` (or a body field).
 * @returns `{ ok: true, provider }` or `{ ok: false }` for an unknown value.
 */
export function parseMailProvider(raw: unknown): ProviderChoice {
  if (raw === undefined || raw === null || raw === '') return { ok: true, provider: null };
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim().toLowerCase();
  return (MAIL_PROVIDERS as readonly string[]).includes(value) ? { ok: true, provider: value as MailProvider } : { ok: false };
}

/** A resolved connection, or why there is none. */
export type MailConnection =
  | { provider: TokenProvider; token: string }
  | { provider: TokenProvider | null; token: null; reconnect: boolean };

/**
 * @description Pick the caller's brokered mailbox connection. A named provider is resolved alone —
 * there is no fallback to another provider or another account. With no provider named, providers
 * are tried in TOKEN_PROVIDERS order and the first usable token wins. A broker failure (a refresh the
 * provider refused) marks that provider as needing reconnect instead of aborting the choice.
 * @param requested - The parsed provider, or null for the default.
 * @param tokenFor - The caller-bound broker lookup (resolves ONLY the caller's own connection).
 * @param onError - Called with every broker failure so the route can log it.
 * @returns The connection, or the provider (if any) the refusal should name.
 */
export async function selectMailConnection(
  requested: TokenProvider | null,
  tokenFor: (provider: TokenProvider) => Promise<string | null>,
  onError: (provider: TokenProvider, err: unknown) => void,
): Promise<MailConnection> {
  const candidates: readonly TokenProvider[] = requested ? [requested] : TOKEN_PROVIDERS;
  let failed: TokenProvider | null = null;
  for (const provider of candidates) {
    try {
      const token = await tokenFor(provider);
      if (token) return { provider, token };
    } catch (err) {
      onError(provider, err);
      failed = failed ?? provider;
    }
  }
  if (failed) return { provider: failed, token: null, reconnect: true };
  return { provider: requested, token: null, reconnect: false };
}

/**
 * @description The refusal body for a caller with no usable connection.
 * @param provider - The provider that was asked for (null when the caller named none).
 * @param reconnect - True when a connection exists but its grant could not be refreshed.
 * @returns `{ error, message }` for a 409 (or the surface's connected:false payload).
 */
export function missingConnectionBody(provider: MailProvider | null, reconnect = false): { error: string; message: string } {
  if (!provider) {
    return { error: 'no_mail_connection', message: 'Connect Google, Outlook / Microsoft 365 or Yahoo Mail at /utilities first.' };
  }
  if (reconnect) {
    return { error: 'reconnect_required', message: `Reconnect your ${PROVIDER_LABEL[provider]} account at /utilities.` };
  }
  return { error: `no_${provider}_connection`, message: `Connect your ${PROVIDER_LABEL[provider]} account at /utilities first.` };
}
