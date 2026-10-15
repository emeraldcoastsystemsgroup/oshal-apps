/**
 * Stripe routes for Payments, mounted on the payments router (/api/payments/stripe/...).
 *
 * Every route acts for the signed-in caller only, with the caller's own Stripe key (placed by the
 * kernel's fenced egress; legacy: the caller's brokered token). Money-shaped actions — creating a
 * payment page and refunding — need `confirm: true`, and also `confirmLive: true` unless Stripe says
 * the saved key is a TEST key. A refused confirmation is answered before anything is sent to Stripe
 * (the live check reads only the balance). Nothing returned or logged carries a key.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial: GET /stripe/status, POST /stripe/checkout, GET /stripe/checkout/:id, GET /stripe/payments, POST /stripe/refund; two-step confirmation (confirm, then confirmLive unless test); requests recorded owner-scoped in oshal_merchant_payments. Guard: tests/stripe-rail.test.cjs.
 *
 * @module stripe-routes
 */

import type { Router, Request, Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import {
  STRIPE_API, StripeError, stripeStatus, paymentRequest, returnUrl, createCheckoutSession, getCheckoutSession,
  checkoutSessionId, chargeId, sessionRecordStatus, listPayments, refundCharge, scrubKeys,
  type StripeTransport, type StripeStatus,
} from './stripe-rail';

const logger = createChildLogger({ module: 'payments-stripe-routes' });

/** Resolves the caller's Stripe transport. */
export type StripeTransportFor = (sub: string) => Promise<StripeTransport>;

/** Options for createPaymentsRoutes; production passes none. */
export interface PaymentsRouteOptions { stripeTransport?: StripeTransportFor }

/** Signed-in caller's OIDC sub. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string; oid?: string } } }).oidc?.user;
  const sub = u?.sub || u?.oid;
  return sub ? String(sub) : null;
}

/**
 * @description The production transport. Under the native kernel (OSHAL_EGRESS=kernel) the kernel places
 * the caller's own sealed Stripe key on every api.stripe.com request; elsewhere the caller's brokered token.
 * @param {AppContext} ctx App context (pool for the legacy broker).
 * @param {string} sub The caller.
 * @returns {Promise<StripeTransport>} Transport whose credential is 'kernel', the token, or null (not connected).
 */
export async function defaultStripeTransport(ctx: AppContext, sub: string): Promise<StripeTransport> {
  const send = (url: string, init?: Record<string, unknown>) => (globalThis.fetch as any)(url, init);
  if (process.env.OSHAL_EGRESS === 'kernel') return { fetch: send, base: STRIPE_API, credential: 'kernel' };
  const token = await getValidAccessToken(ctx.pool, sub, 'stripe').catch(() => null);
  return { fetch: send, base: STRIPE_API, credential: token ? String(token) : null };
}

/** @description The /providers row for Stripe. @param {StripeStatus} s Status. @returns {object} Provider row. */
export function stripeProvider(s: StripeStatus) {
  return { provider: 'stripe', connected: s.connected, testMode: s.testMode, mode: s.mode, sourceLabel: 'Stripe payment page',
    ...(s.detail ? { detail: s.detail } : {}) };
}

/** @description A status read that failed for another reason (Stripe down): connected unknown, reason in words. */
export function stripeUnavailable(err: unknown): StripeStatus {
  logger.error({ err: scrubKeys((err as Error)?.message || err) }, 'stripe status failed');
  return { provider: 'stripe', connected: false, mode: 'not_connected', testMode: false,
    detail: `Stripe could not be checked: ${scrubKeys((err as Error)?.message || err)}` };
}

/** HTTP status for a Stripe failure. */
function httpFor(err: unknown): number {
  const kind = (err as StripeError)?.kind;
  return kind === 'not_connected' || kind === 'rejected' ? 409 : kind === 'invalid' ? 400 : kind === 'permission' ? 403 : 502;
}

/** Answer a failure in words; never the key. */
function fail(res: Response, err: unknown, what: string): void {
  const message = scrubKeys((err as Error)?.message || err);
  if (!(err instanceof StripeError) || err.kind === 'provider' || err.kind === 'transport') logger.error({ err: message }, `stripe ${what} failed`);
  res.status(httpFor(err)).json({ error: (err as StripeError)?.kind || 'stripe_failed', message });
}

/**
 * @description The confirmation gate for a money-shaped action. `confirm: true` always; `confirmLive: true`
 * as well unless Stripe answered livemode:false for this key. Returns the refusal body, or null to proceed.
 * @param {any} body The request body.
 * @param {StripeStatus | null} status The key's status (null = not yet read).
 * @param {string} action What would happen, in words.
 * @returns {object | null} A 428 body, or null.
 */
export function moneyConfirmation(body: any, status: StripeStatus | null, action: string): Record<string, unknown> | null {
  if (!hasExplicitWriteConfirmation(body)) {
    return { error: 'confirmation_required', guard: 'stripe-confirm', message: `${action} requires confirm: true. Nothing was sent to Stripe.` };
  }
  if (status && status.mode !== 'test' && body?.confirmLive !== true) {
    return { error: 'live_confirmation_required', guard: 'stripe-live-mode', mode: status.mode,
      message: `${action} uses a ${status.mode === 'live' ? 'LIVE' : 'mode-unknown (treated as LIVE)'} Stripe key: real money. It requires confirmLive: true. Nothing was sent to Stripe.` };
  }
  return null;
}

/** Status first; refuse unless connected. */
async function connectedStatus(t: StripeTransport): Promise<StripeStatus> {
  const s = await stripeStatus(t);
  if (!s.connected) throw new StripeError(s.mode === 'key_rejected' ? 'rejected' : 'not_connected', s.detail || 'Stripe is not connected.');
  return s;
}

/** Record (or refresh) one payment request in the caller's own audit rows. */
async function recordRequest(ctx: AppContext, sub: string, s: any, note: string | null, status: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO oshal_merchant_payments
       (charge_id, user_sub, provider, amount_cents, currency, note, status, raw_status, payer_url, test_mode)
     VALUES ($1,$2,'stripe',$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (provider, charge_id) DO UPDATE SET status = EXCLUDED.status, raw_status = EXCLUDED.raw_status, updated_at = now()`,
    [s.id, sub, s.amountCents, s.currency, note, status, `${s.status}/${s.paymentStatus}`, s.url, !s.livemode]);
}

/**
 * @description Mount the Stripe routes on the payments router.
 * @param {Router} router The payments router.
 * @param {AppContext} ctx App context.
 * @param {StripeTransportFor} transportFor Per-caller transport.
 * @param {(pool: AppContext['pool']) => Promise<void>} ensureSchema Lazy audit-table bootstrap.
 * @returns {void}
 */
export function mountStripeRoutes(router: Router, ctx: AppContext, transportFor: StripeTransportFor,
  ensureSchema: (pool: AppContext['pool']) => Promise<void>): void {
  const signedIn = (handler: (req: Request, res: Response, sub: string) => Promise<void>) => async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    await handler(req, res, sub);
  };

  router.get('/stripe/status', signedIn(async (_req, res, sub) => {
    try { res.json(await stripeStatus(await transportFor(sub))); } catch (err) { fail(res, err, 'status'); }
  }));

  router.post('/stripe/checkout', signedIn(async (req, res, sub) => createCheckout(req, res, sub)));

  router.get('/stripe/checkout/:id', signedIn(async (req, res, sub) => {
    try {
      const id = checkoutSessionId(req.params.id);
      await ensureSchema(ctx.pool);
      const owned = (await ctx.pool.query("SELECT 1 FROM oshal_merchant_payments WHERE provider = 'stripe' AND charge_id = $1 AND user_sub = $2", [id, sub])).rowCount;
      if (!owned) { res.status(404).json({ error: 'not_found' }); return; }
      const s = await getCheckoutSession(await transportFor(sub), id);
      await recordRequest(ctx, sub, s, null, sessionRecordStatus(s));
      res.json({ session: s, status: sessionRecordStatus(s) });
    } catch (err) { fail(res, err, 'checkout status'); }
  }));

  router.get('/stripe/payments', signedIn(async (req, res, sub) => {
    try { res.json({ payments: await listPayments(await transportFor(sub), Number(req.query.limit) || 20) }); } catch (err) { fail(res, err, 'payments'); }
  }));

  router.post('/stripe/refund', signedIn(async (req, res, sub) => refund(req, res, sub)));

  /** POST /stripe/checkout — { amountCents, currency?, description, returnUrl, requestId, confirm, confirmLive? }. */
  async function createCheckout(req: Request, res: Response, sub: string): Promise<void> {
    const b = (req.body || {}) as any;
    try {
      const request = paymentRequest(b);
      const back = returnUrl(b.returnUrl);
      const early = moneyConfirmation(b, null, 'Creating a Stripe payment page');
      if (early) { res.status(428).json(early); return; }
      const t = await transportFor(sub);
      const status = await connectedStatus(t);
      const refusal = moneyConfirmation(b, status, 'Creating a Stripe payment page');
      if (refusal) { res.status(428).json(refusal); return; }
      await ensureSchema(ctx.pool);
      const s = await createCheckoutSession(t, request, back, String(b.requestId || `req-${Date.now()}`));
      await recordRequest(ctx, sub, s, request.description, sessionRecordStatus(s));
      logger.info({ session: s.id, livemode: s.livemode, amountCents: s.amountCents }, 'stripe checkout session created');
      res.json({ ok: true, session: s, mode: status.mode });
    } catch (err) { fail(res, err, 'checkout'); }
  }

  /** POST /stripe/refund — { chargeId, confirm, confirmLive? }: a FULL refund of one of the caller's charges. */
  async function refund(req: Request, res: Response, sub: string): Promise<void> {
    const b = (req.body || {}) as any;
    try {
      const charge = chargeId(b.chargeId);
      const early = moneyConfirmation(b, null, 'Refunding a Stripe payment');
      if (early) { res.status(428).json(early); return; }
      const t = await transportFor(sub);
      const status = await connectedStatus(t);
      const refusal = moneyConfirmation(b, status, 'Refunding a Stripe payment');
      if (refusal) { res.status(428).json(refusal); return; }
      const r = await refundCharge(t, charge);
      logger.info({ refund: r.id, charge: r.chargeId, mode: status.mode, amountCents: r.amountCents }, 'stripe refund created');
      res.json({ ok: true, refund: r, mode: status.mode });
    } catch (err) { fail(res, err, 'refund'); }
  }
}
