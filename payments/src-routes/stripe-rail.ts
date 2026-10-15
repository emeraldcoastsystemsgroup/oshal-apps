/**
 * Stripe rail for Payments — the person's own Stripe account, reached only through api.stripe.com.
 *
 * The person pastes their own Stripe key (a restricted key, test first) on the Connections page.
 * The key never reaches this package: on the native kernel every request goes through the kernel's
 * fenced egress, which admits only api.stripe.com (oshal-app.yaml `egress:`) and places the caller's
 * own sealed key in the Authorization header itself. On the legacy platform the brokered token is
 * read per caller and placed here, and it is still never returned, logged or echoed.
 *
 * The mode comes from Stripe, not from guessing at a key: every Stripe object carries `livemode`,
 * and the balance read answers it for the saved key. A key Stripe will not let us read the balance
 * with is reported as mode "unknown" and handled as LIVE. Operations: a Checkout Session for an
 * amount + description (a hosted payment page the customer pays on), the session's status, recent
 * payments (charges) and a FULL refund of one charge. Nothing here moves money on its own: the
 * routes require an explicit confirmation, and a second LIVE confirmation when the key is not test.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | T8: a balance answer without a boolean `livemode` is LIVE (fail safe: real money until Stripe says test), so every action on such a key requires the LIVE confirmation; only `livemode: false` is test mode.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial Stripe rail: status/mode from Stripe's own livemode, Checkout Session create + read, recent charges, full refund; form-encoded requests to api.stripe.com only; every key-shaped string scrubbed from anything returned. Guard: tests/stripe-rail.test.cjs (local fake Stripe server).
 *
 * @module stripe-rail
 */

/** The only Stripe origin this rail ever calls (the manifest's declared egress host). */
export const STRIPE_API = 'https://api.stripe.com';

/** Stripe's own minimum for a card payment in USD is 50 cents; the ceiling keeps a typo from becoming a large request. */
export const MIN_AMOUNT_CENTS = 50;
export const MAX_AMOUNT_CENTS = 99_999_999;

/** Where the key comes from: the kernel places it ('kernel'), the legacy broker gave one, or there is none. */
export type StripeCredential = 'kernel' | string | null;

/** How one caller's requests reach Stripe. `credential` is never serialized or returned. */
export interface StripeTransport {
  fetch: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  base: string;
  credential: StripeCredential;
}

/** The connection state the page and the concierge show. */
export type StripeMode = 'not_connected' | 'key_rejected' | 'test' | 'live' | 'unknown';

export interface StripeStatus {
  provider: 'stripe';
  connected: boolean;
  mode: StripeMode;
  /** True only when Stripe itself answered livemode:false. */
  testMode: boolean;
  detail?: string;
  available?: Array<{ amountCents: number; currency: string }>;
}

/** Why a Stripe call did not succeed, in a form the routes map to HTTP. */
export type StripeFailure = 'not_connected' | 'rejected' | 'permission' | 'invalid' | 'provider' | 'transport';

export class StripeError extends Error {
  readonly kind: StripeFailure;
  readonly status: number;
  constructor(kind: StripeFailure, message: string, status = 0) {
    super(scrubKeys(message));
    this.name = 'StripeError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * @description Remove anything shaped like a Stripe key (secret, restricted or publishable, test or live,
 * including Stripe's own masked echo such as `sk_test_****1234`) and any bearer value from text.
 * Stripe's 401 message repeats part of the key; nothing key-shaped may reach a page, a log or a model.
 * @param {unknown} text Any text.
 * @returns {string} The text with every key-shaped run replaced by `[stripe key]`.
 */
export function scrubKeys(text: unknown): string {
  return String(text ?? '')
    .replace(/\b(?:(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]*|whsec_[A-Za-z0-9*]+)/g, '[stripe key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

/**
 * @description Stripe's form encoding (application/x-www-form-urlencoded with bracketed keys).
 * @param {Record<string, string | number | undefined>} params Flat bracket-keyed parameters.
 * @returns {string} The encoded body; undefined values are left out.
 */
export function formEncode(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

/** One request to Stripe; the answer is parsed JSON or a StripeError with the reason in words. */
async function call(t: StripeTransport, method: 'GET' | 'POST', path: string, params?: Record<string, string | number | undefined>): Promise<any> {
  if (!t.credential) throw new StripeError('not_connected', 'Stripe is not connected: paste your Stripe key on the Connections page.');
  const headers: Record<string, string> = { accept: 'application/json' };
  // The kernel places the caller's sealed key itself; a legacy broker token is placed here and nowhere else.
  if (t.credential !== 'kernel') headers.authorization = `Bearer ${t.credential}`;
  let url = `${t.base}${path}`;
  let body: string | undefined;
  if (params && method === 'GET') { const q = formEncode(params); if (q) url += `?${q}`; }
  if (params && method === 'POST') { body = formEncode(params); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  let response;
  try {
    response = await t.fetch(url, { method, headers, body, redirect: 'manual' });
  } catch (err) {
    const message = scrubKeys((err as Error)?.message || err);
    if (/not connected/i.test(message)) throw new StripeError('not_connected', 'Stripe is not connected: paste your Stripe key on the Connections page.');
    throw new StripeError('transport', `Stripe could not be reached: ${message}`);
  }
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (response.ok && json && typeof json === 'object') return json;
  const reason = scrubKeys(json?.error?.message || `Stripe answered HTTP ${response.status}`);
  if (response.status === 401) throw new StripeError('rejected', `Stripe rejected the saved key: ${reason}`, 401);
  if (response.status === 403) throw new StripeError('permission', `The saved Stripe key is not permitted to do this: ${reason}`, 403);
  if (response.status === 400 || response.status === 402 || response.status === 404) throw new StripeError('invalid', reason, response.status);
  throw new StripeError('provider', reason, response.status);
}

/**
 * @description The caller's Stripe connection state, read from Stripe's balance (which carries `livemode`).
 * Not connected, a rejected key and a key without balance access each answer in words instead of failing.
 * @param {StripeTransport} t The caller's transport.
 * @returns {Promise<StripeStatus>} The state; never contains the key.
 */
export async function stripeStatus(t: StripeTransport): Promise<StripeStatus> {
  try {
    const balance = await call(t, 'GET', '/v1/balance');
    // Fail safe: only Stripe's own `livemode: false` is test mode; anything else (true, missing, malformed) is LIVE.
    const live = balance.livemode !== false;
    const available = Array.isArray(balance.available)
      ? balance.available.map((row: any) => ({ amountCents: Number(row.amount) || 0, currency: String(row.currency || '').toUpperCase() }))
      : [];
    return { provider: 'stripe', connected: true, mode: live ? 'live' : 'test', testMode: !live, available };
  } catch (err) {
    const e = err as StripeError;
    if (e.kind === 'not_connected') return { provider: 'stripe', connected: false, mode: 'not_connected', testMode: false, detail: 'Stripe is not connected. Paste your Stripe key on the Connections page (start with a test key).' };
    if (e.kind === 'rejected') return { provider: 'stripe', connected: false, mode: 'key_rejected', testMode: false, detail: 'Stripe rejected the saved key. Replace it on the Connections page.' };
    if (e.kind === 'permission') return { provider: 'stripe', connected: true, mode: 'unknown', testMode: false, detail: 'The saved key cannot read the Stripe balance, so its mode is unknown; every action is treated as LIVE.' };
    throw e;
  }
}

/** A validated payment request. */
export interface PaymentRequest { amountCents: number; currency: string; description: string }

/**
 * @description Validate an amount + description before anything is sent to Stripe.
 * @param {any} body The request body.
 * @returns {PaymentRequest} The normalized request.
 * @throws {StripeError} kind 'invalid' with the reason in words.
 */
export function paymentRequest(body: any): PaymentRequest {
  const amountCents = Number(body?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
    throw new StripeError('invalid', `amountCents must be a whole number of cents from ${MIN_AMOUNT_CENTS} to ${MAX_AMOUNT_CENTS}.`, 400);
  }
  const currency = String(body?.currency || 'usd').trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new StripeError('invalid', 'currency must be a three-letter code such as usd.', 400);
  const description = String(body?.description || '').replace(/\s+/g, ' ').trim();
  if (!description || description.length > 200) throw new StripeError('invalid', 'A description (what the payment is for, up to 200 characters) is required.', 400);
  return { amountCents, currency, description };
}

/**
 * @description Admit a return address for the hosted page: https anywhere, or http only on this machine.
 * @param {unknown} value The page's own address.
 * @returns {string} The URL text, or throws when it is not one Stripe should send a customer to.
 */
export function returnUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(String(value || '')); } catch { throw new StripeError('invalid', 'returnUrl must be the Payments page address.', 400); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new StripeError('invalid', 'returnUrl must use https.', 400);
  url.hash = '';
  return url.toString();
}

/** A Checkout Session as the page sees it. */
function session(s: any) {
  return {
    id: String(s.id || ''), url: s.url ? String(s.url) : null, status: String(s.status || ''),
    paymentStatus: String(s.payment_status || ''), amountCents: Number(s.amount_total) || 0,
    currency: String(s.currency || '').toUpperCase(), livemode: s.livemode === true,
    expiresAt: s.expires_at ? new Date(Number(s.expires_at) * 1000).toISOString() : null,
  };
}

/**
 * @description Create a Stripe Checkout Session: one hosted payment page for this amount and description.
 * Creating it moves no money; the customer pays on Stripe's page.
 * @param {StripeTransport} t The caller's transport.
 * @param {PaymentRequest} req The validated request.
 * @param {string} back The Payments page address Stripe returns the customer to.
 * @param {string} requestId The page's request id, kept in Stripe metadata for reconciliation.
 * @returns {Promise<object>} The session (id, url, status, amount, livemode, expiry).
 */
export async function createCheckoutSession(t: StripeTransport, req: PaymentRequest, back: string, requestId: string) {
  const join = back.includes('?') ? '&' : '?';
  const created = await call(t, 'POST', '/v1/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': req.currency,
    'line_items[0][price_data][unit_amount]': req.amountCents,
    'line_items[0][price_data][product_data][name]': req.description,
    success_url: `${back}${join}stripe=paid&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}${join}stripe=canceled`,
    'metadata[oshal_request]': requestId.slice(0, 120),
  });
  return session(created);
}

/** Stripe Checkout Session ids look like cs_test_… / cs_live_…; nothing else is sent into a path. */
export function checkoutSessionId(value: unknown): string {
  const id = String(value || '');
  if (!/^cs_(?:test|live)_[A-Za-z0-9]{1,200}$/.test(id)) throw new StripeError('invalid', 'Not a Stripe Checkout Session id.', 400);
  return id;
}

/** @description Read one Checkout Session's current status. @param {StripeTransport} t Transport. @param {string} id Session id. @returns {Promise<object>} The session. */
export async function getCheckoutSession(t: StripeTransport, id: string) {
  return session(await call(t, 'GET', `/v1/checkout/sessions/${checkoutSessionId(id)}`));
}

/** The recorded status for a session: paid → completed, expired → expired, otherwise awaiting payment. */
export function sessionRecordStatus(s: { status: string; paymentStatus: string }): string {
  if (s.paymentStatus === 'paid' || s.status === 'complete') return 'completed';
  if (s.status === 'expired') return 'expired';
  return 'pending';
}

/**
 * @description The caller's most recent Stripe payments (charges), newest first.
 * @param {StripeTransport} t The caller's transport.
 * @param {number} limit How many (1-50).
 * @returns {Promise<object[]>} Normalized payments; no customer card or key data.
 */
export async function listPayments(t: StripeTransport, limit = 20) {
  const n = Math.min(50, Math.max(1, Math.trunc(Number(limit)) || 20));
  const list = await call(t, 'GET', '/v1/charges', { limit: n });
  const rows = Array.isArray(list?.data) ? list.data : [];
  return rows.map((c: any) => ({
    id: String(c.id || ''), amountCents: Number(c.amount) || 0, currency: String(c.currency || '').toUpperCase(),
    status: String(c.status || ''), paid: c.paid === true, refunded: c.refunded === true,
    amountRefundedCents: Number(c.amount_refunded) || 0, description: c.description ? String(c.description).slice(0, 200) : '',
    created: c.created ? new Date(Number(c.created) * 1000).toISOString() : null, livemode: c.livemode === true,
    receiptUrl: c.receipt_url ? String(c.receipt_url) : null,
  }));
}

/** Stripe charge ids (ch_…, py_…) are the only thing a refund names. */
export function chargeId(value: unknown): string {
  const id = String(value || '');
  if (!/^(?:ch|py)_[A-Za-z0-9]{1,200}$/.test(id)) throw new StripeError('invalid', 'Not a Stripe charge id.', 400);
  return id;
}

/**
 * @description Refund one charge in FULL (Stripe refuses a second full refund, so a retry cannot refund twice).
 * @param {StripeTransport} t The caller's transport.
 * @param {string} id The charge id.
 * @returns {Promise<object>} The refund (id, status, amount, currency, charge).
 */
export async function refundCharge(t: StripeTransport, id: string) {
  const r = await call(t, 'POST', '/v1/refunds', { charge: chargeId(id) });
  return {
    id: String(r.id || ''), status: String(r.status || ''), amountCents: Number(r.amount) || 0,
    currency: String(r.currency || '').toUpperCase(), chargeId: String(r.charge || id),
  };
}
