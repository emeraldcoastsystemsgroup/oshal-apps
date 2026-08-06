/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add caller-scoped digest settings, new-hit selection, connected-channel delivery, cron integration, and preview/send routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Honor notification-center channel preferences without weakening opt-out or once-per-day guards.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Use the dependency-leaf user-store API so digest callers avoid the main registrar cycle.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Complete exported digest data and registrar documentation for package consumers.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Send Twilio digests through the caller-scoped in-process operation instead of a full-environment child process.
 */
/**
 * Career daily digest — the batch notifier that tells each career-hunter user about
 * their NEW high-fit matches, at most once a day, over THEIR OWN connected channel.
 *
 * Product rule (operator, 2026-07-15): the SYSTEM sends the notification, not a human.
 * It goes to the signed-in user and comes FROM their configured channel — their Gmail
 * (gmail.send) when they have allowed email access, else a text from their Twilio when
 * that is what they have connected. Per-user config with a default of ON (opt-out);
 * nothing is sent on a day with no new hits, and never more than once per ~day.
 *
 * Runs from the career-hunter cron (13:00 window, after the midday score) so the digest
 * reflects the freshest ai_scored_at. The persistent once/day guard is Postgres
 * (career_digest_settings.last_digest_at, >20h), so boot catch-ups can never double-send.
 *
 * @module career-digest
 */
import { type Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { sendGmail } from '@/app/routes/email-routes';
import { sendUserTwilioSms } from '@/app/routes/twilio-sms-operation';
import { callerSub, listStoreUsers, openUserDb } from './career-user-store';
import { readUserPref } from '@/features/notifications';

const logger = createChildLogger({ module: 'career-digest' });

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_HITS = 8; // "the highest match — like 8 of them"
const MIN_FIT = 70; // matches the engine's freshHighFit threshold
// (RESEND_GUARD_HOURS + dueForDigest moved to @/app/routes/digest-resend-guard —
//  shared with the core morning-brief cron across the ADR-085 carve boundary.)

/** @description One newly surfaced high-fit role eligible for the caller's digest. */
export interface DigestHit {
  id: number;
  title: string;
  company: string;
  fit: number;
  location?: string | null;
  url?: string | null;
  salaryMax?: number | null;
}

/** @description Per-user digest settings mapped from storage or safe defaults when absent. */
export interface DigestSettings {
  enabled: boolean;
  lastDigestAt: string | null;
  channel: 'email' | 'text' | null; // null = auto
  phone: string | null;
}

/** Public cockpit origin for links in the notification (falls back to the local stack). */
function boardUrl(): string {
  const base = (process.env.OSHAL_PUBLIC_URL || (process.env.OIDC_BASE_URLS || '').split(',')[0] || 'http://localhost:35457').trim().replace(/\/$/, '');
  return `${base}/cockpit/?app=career-hunter`;
}

/**
 * @description Whether enough time has passed since the last digest to send another
 * (the persistent "no more than once a day" guard). True when never sent.
 * @param lastDigestAt ISO timestamp of the last sent digest, or null
 * @param nowMs clock override for tests
 * @returns true when a new digest may be sent
 */
import { dueForDigest } from '@/app/routes/digest-resend-guard';
export { dueForDigest };

/**
 * @description Render the digest as a plain-text email. Lists every hit with match %,
 * role, company, location, and link, plus the board link and the opt-out pointer
 * (the notification is opt-out, so it must always say how to turn it off).
 * @param hits new high-fit matches, best first
 * @param board absolute cockpit URL for the career board
 * @returns subject + body ready for sendGmail
 */
export function formatDigestEmail(hits: DigestHit[], board: string): { subject: string; body: string } {
  const day = new Date().toISOString().slice(0, 10);
  const subject = `Your career digest — ${hits.length} new high-fit match${hits.length === 1 ? '' : 'es'} (${day})`;
  const lines = hits.map((h, i) => {
    const bits = [`${i + 1}. [${h.fit}% match] ${h.title} — ${h.company}`];
    if (h.location) bits.push(`   ${h.location}`);
    if (h.salaryMax) bits.push(`   up to $${Math.round(h.salaryMax).toLocaleString('en-US')}`);
    if (h.url) bits.push(`   ${h.url}`);
    return bits.join('\n');
  });
  const body = [
    `New roles that scored ${MIN_FIT}+ against your resume since your last digest:`,
    '',
    ...lines,
    '',
    `Review, tune your resume, and apply from your board: ${board}`,
    '',
    `— OSHAL Career Hunter (automated daily digest, at most one per day).`,
    `You get this because the daily digest is ON in Career Settings — turn it off there any time.`,
  ].join('\n');
  return { subject, body };
}

/**
 * @description Render the digest as one SMS-sized text: top 3 roles + total count + board
 * link. Kept short deliberately — SMS is a nudge, the board is the surface.
 * @param hits new high-fit matches, best first
 * @param board absolute cockpit URL for the career board
 * @returns a single text message body
 */
export function formatDigestSms(hits: DigestHit[], board: string): string {
  const top = hits.slice(0, 3).map((h) => `${h.fit}% ${h.title} @ ${h.company}`).join('; ');
  const more = hits.length > 3 ? ` +${hits.length - 3} more` : '';
  return `OSHAL Career: ${hits.length} new high-fit match${hits.length === 1 ? '' : 'es'} — ${top}${more}. Board: ${board} (daily digest; turn off in Career Settings)`;
}

/** Read the user's digest settings, defaulting to enabled/auto when no row exists. */
async function readSettings(pool: AppContext['pool'], userSub: string): Promise<DigestSettings> {
  const r = await pool.query(
    `SELECT digest_enabled, last_digest_at, notify_channel, notify_phone FROM career_digest_settings WHERE user_sub=$1`,
    [userSub]);
  if (!r.rows.length) return { enabled: true, lastDigestAt: null, channel: null, phone: null };
  const row = r.rows[0];
  return {
    enabled: row.digest_enabled !== false,
    lastDigestAt: row.last_digest_at ? new Date(row.last_digest_at).toISOString() : null,
    channel: row.notify_channel === 'email' || row.notify_channel === 'text' ? row.notify_channel : null,
    phone: row.notify_phone || null,
  };
}

/** Which notification channels this user has actually connected (drives auto selection). */
async function channelReadiness(pool: AppContext['pool'], userSub: string): Promise<{ emailReady: boolean; textReady: boolean }> {
  const r = await pool.query(
    `SELECT provider, scopes FROM oshal_connections WHERE user_sub=$1 AND provider IN ('google','twilio') AND status='connected'`,
    [userSub]);
  const google = r.rows.find((c: { provider: string; scopes?: string }) => c.provider === 'google');
  return {
    // scopes stores the REQUESTED list; a decline still 403s at send time and we log + skip.
    emailReady: !!google && /gmail\.send/.test(String(google.scopes || '')),
    textReady: r.rows.some((c: { provider: string }) => c.provider === 'twilio'),
  };
}

/**
 * @description The user's NEW high-fit matches since their last digest: active, in-lane,
 * ai_fit >= MIN_FIT, still untouched (status new), and AI-SCORED after the cursor.
 * Cursor is ai_scored_at, never posted_date — most ATS feeds omit posted_date, so a date
 * filter on it silently matches nothing (documented in career-hunter-routes).
 * @param userSub per-user store owner
 * @param sinceIso last digest time (null = first digest: current top hits, still capped)
 * @returns up to MAX_HITS hits, best first
 */
export function findNewHits(userSub: string, sinceIso: string | null): DigestHit[] {
  const db = openUserDb(userSub);
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT pc.id, pc.title, co.name AS company, us.ai_fit_score AS fit,
             pc.location, pc.url, pc.salary_max AS salaryMax
        FROM corpus.postings_corpus pc
        JOIN corpus.companies co ON co.id = pc.company_id
        JOIN user_signals us ON us.posting_id = pc.id
       WHERE pc.active = 1 AND COALESCE(pc.target_role, 0) = 1
         AND us.ai_fit_score >= ${MIN_FIT}
         AND COALESCE(us.status, 'new') = 'new'
         AND (? IS NULL OR us.ai_scored_at > ?)
       ORDER BY us.ai_fit_score DESC, us.ai_scored_at DESC
       LIMIT ${MAX_HITS}`).all(sinceIso, sinceIso) as DigestHit[];
    return rows;
  } catch (err) {
    logger.error({ err, userSub }, 'digest: new-hits query failed');
    return [];
  } finally {
    db.close();
  }
}

/** Send via the user's own Gmail (to their own address). False = not sent (no token/scope). */
async function sendViaEmail(pool: AppContext['pool'], userSub: string, hits: DigestHit[]): Promise<boolean> {
  const token = await getValidAccessToken(pool, userSub, 'google');
  if (!token) return false;
  const prof = await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${token}` } });
  if (!prof.ok) { logger.warn({ userSub, status: prof.status }, 'digest: gmail profile failed'); return false; }
  const to = String(((await prof.json()) as { emailAddress?: string }).emailAddress || '');
  if (!to) return false;
  const { subject, body } = formatDigestEmail(hits, boardUrl());
  try {
    const sent = await sendGmail(token, { to, subject, body });
    logger.info({ userSub, id: sent.id, hits: hits.length }, 'digest: emailed');
    return true;
  } catch (err) {
    // A connection without gmail.send 403s here — log and let auto mode fall through to text.
    logger.warn({ userSub, err: (err as Error).message }, 'digest: gmail send failed');
    return false;
  }
}

/** Send through the user's own Twilio connection without moving its credential into a child. */
async function sendViaText(
  pool: AppContext['pool'],
  userSub: string,
  phone: string,
  hits: DigestHit[],
): Promise<boolean> {
  const body = formatDigestSms(hits, boardUrl());
  const result = await sendUserTwilioSms(pool, userSub, phone, body);
  if (result.delivered) logger.info({ userSub, hits: hits.length, id: result.id }, 'digest: texted');
  else logger.warn({ userSub, reason: result.error }, 'digest: sms send failed');
  return result.delivered;
}

/**
 * @description Run one user's digest end-to-end: settings gate → once/day guard → new-hits
 * query → channel pick (their email, else their text) → send → advance the cursor. Every
 * outcome is logged; the cursor only advances on a REAL send, so a user who connects a
 * channel later still gets their pending hits.
 * @param pool Postgres pool (settings + connections)
 * @param userSub the user to notify
 * @param opts force bypasses the once/day guard (the explicit send-now button)
 * @returns what happened, for logs/routes
 */
export async function sendDigestForUser(
  pool: AppContext['pool'], userSub: string, opts: { force?: boolean } = {},
): Promise<{ sent: boolean; channel?: 'email' | 'text'; hits: number; reason?: string }> {
  const s = await readSettings(pool, userSub);
  if (!s.enabled) return { sent: false, hits: 0, reason: 'disabled' };
  if (!opts.force && !dueForDigest(s.lastDigestAt)) return { sent: false, hits: 0, reason: 'already-sent-today' };
  const hits = findNewHits(userSub, s.lastDigestAt);
  if (!hits.length) return { sent: false, hits: 0, reason: 'no-new-hits' };

  // Notification preference center (079): a saved 'career-digest' pref overrides WHICH
  // channel carries the digest. Opt-out (digest_enabled) + the once/day cursor above stay
  // exactly as before; readUserPref fails open to null, so no pref = the old auto pick.
  const pref = await readUserPref(pool, userSub, 'career-digest');
  if (pref && (!pref.enabled || pref.channel === 'none')) {
    logger.info({ userSub, hits: hits.length }, 'digest: notification prefs route career-digest to none — skipped (cursor untouched)');
    return { sent: false, hits: hits.length, reason: 'prefs-none' };
  }
  if (pref?.channel === 'telegram') {
    logger.warn({ userSub }, 'digest: pref channel telegram has no per-user digest leg yet — skipped (cursor untouched)');
    return { sent: false, hits: hits.length, reason: 'prefs-telegram-unavailable' };
  }
  const wantChannel: 'email' | 'text' | null = pref ? (pref.channel === 'sms' ? 'text' : 'email') : s.channel;
  const phone = (pref?.channel === 'sms' && pref.phone) ? pref.phone : s.phone;
  const ready = await channelReadiness(pool, userSub);

  let channel: 'email' | 'text' | null = null;
  let ok = false;
  if (wantChannel !== 'text' && ready.emailReady) { ok = await sendViaEmail(pool, userSub, hits); channel = ok ? 'email' : null; }
  if (!ok && wantChannel !== 'email' && ready.textReady && phone) { ok = await sendViaText(pool, userSub, phone, hits); channel = ok ? 'text' : null; }
  if (!ok) {
    logger.info({ userSub, hits: hits.length, ready, pref: wantChannel }, 'digest: hits found but no usable channel — skipped');
    return { sent: false, hits: hits.length, reason: 'no-channel' };
  }
  await pool.query(
    `INSERT INTO career_digest_settings (user_sub, last_digest_at) VALUES ($1, NOW())
     ON CONFLICT (user_sub) DO UPDATE SET last_digest_at=NOW(), updated_at=NOW()`, [userSub]);
  return { sent: true, channel: channel as 'email' | 'text', hits: hits.length };
}

/**
 * @description The cron batch: run the digest for every per-user store. Per-user failures
 * are logged and never abort the batch.
 * @param ctx app context (pool)
 * @returns nothing after every current user store has been attempted
 */
export async function sendDigestsForAllUsers(ctx: AppContext): Promise<void> {
  for (const userSub of listStoreUsers()) {
    try {
      const r = await sendDigestForUser(ctx.pool, userSub);
      logger.info({ userSub, ...r }, 'career digest: user done');
    } catch (err) {
      logger.error({ err, userSub }, 'career digest: user failed');
    }
  }
}

/**
 * @description Per-user digest routes on the career-hunter router (already auth-gated by
 * the parent mount): read/save settings for the Career Settings card, preview what today's
 * digest would contain, and an explicit send-now (confirm-gated; outward-facing send).
 * @param router the career-hunter router
 * @param ctx app context
 * @returns nothing after routes are mounted
 */
export function registerCareerDigestRoutes(router: Router, ctx: AppContext): void {
  const pool = ctx.pool;

  router.get('/digest/state', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const [s, ready] = await Promise.all([readSettings(pool, userSub), channelReadiness(pool, userSub)]);
    res.json({ ...s, ...ready });
  });

  router.post('/settings/digest', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const b = req.body || {};
    const enabled = b.enabled !== false;
    const channel = b.channel === 'email' || b.channel === 'text' ? b.channel : null;
    const phone = String(b.phone || '').trim() || null;
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) { res.status(400).json({ error: 'phone must be E.164 (+15551234567)' }); return; }
    await pool.query(
      `INSERT INTO career_digest_settings (user_sub, digest_enabled, notify_channel, notify_phone)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_sub) DO UPDATE SET digest_enabled=$2, notify_channel=$3, notify_phone=$4, updated_at=NOW()`,
      [userSub, enabled, channel, phone]);
    logger.info({ userSub, enabled, channel, hasPhone: !!phone }, 'digest settings saved');
    res.json({ ok: true });
  });

  router.get('/digest/preview', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const s = await readSettings(pool, userSub);
    const hits = findNewHits(userSub, s.lastDigestAt);
    res.json({ hits, since: s.lastDigestAt, wouldSend: s.enabled && hits.length > 0 });
  });

  router.post('/digest/send-now', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (req.body?.confirm !== true) { res.status(428).json({ error: 'confirm required', message: 'POST {"confirm":true} to send your digest now.' }); return; }
    const r = await sendDigestForUser(pool, userSub, { force: true });
    res.status(r.sent ? 200 : 409).json(r);
  });
}
