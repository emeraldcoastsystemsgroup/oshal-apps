/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.10 P4 owner-scoped SMS
 *     consent, recipient timezone, quiet-hours scheduling, and STOP/HELP keyword routes under
 *     /api/marketing (oidc): POST /audience/sms-opt-in, POST /audience/sms/schedule,
 *     GET /audience/sms/queue, and POST /audience/sms/keyword. Mirrors migration
 *     011-marketing-sms-consent.sql at the lazy-DDL chokepoint.
 *
 * @module marketing-sms
 */

import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import { hashAddress, normalizeEmail, normalizeTags } from './marketing-audience-model';
import { loadComplianceSettings } from './marketing-compliance';
import {
  buildSmsOptInConfirmationText, classifyInboundSmsKeyword, evaluateSmsSendGate,
  isValidIanaTimezone, normalizePhoneE164, normalizeSmsConsentEvidence,
  resolveRecipientTimezone,
} from './marketing-sms-model';
import { UUID_RE, authed, logger, rows, tooLarge, type QueryablePool } from './marketing-support';

/** Lazy-DDL mirror of migrations/011-marketing-sms-consent.sql. */
const SMS_TABLE_DDL: string[] = [
  'ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS phone_e164 TEXT',
  'ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS phone_hash TEXT',
  'ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS timezone TEXT',
  'ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS timezone_inferred BOOLEAN NOT NULL DEFAULT FALSE',
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_contacts_owner_phone_hash
    ON oshal_marketing_contacts (owner_sub, phone_hash)
    WHERE phone_hash IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS oshal_marketing_sms_queue (
    sms_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    contact_id UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
    phone_hash TEXT NOT NULL,
    body TEXT NOT NULL,
    recipient_timezone TEXT NOT NULL,
    timezone_inferred BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL CHECK (status IN ('held_quiet_hours','ready','refused_consent','refused_suppressed','sent','cancelled')),
    gate_reason TEXT NOT NULL DEFAULT '',
    scheduled_for TIMESTAMPTZ NOT NULL,
    release_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sms_queue_owner_created
    ON oshal_marketing_sms_queue (owner_sub, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sms_queue_owner_contact_status
    ON oshal_marketing_sms_queue (owner_sub, contact_id, status)`,
];

const VALID_QUEUE_STATUSES = new Set([
  'held_quiet_hours', 'ready', 'refused_consent', 'refused_suppressed', 'sent', 'cancelled',
]);

/**
 * @description Ensure the 011-marketing-sms-consent schema + exact-owner FORCE RLS at lazy DDL.
 */
export async function ensureSmsSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'marketing-sms',
    statements: [
      ...SMS_TABLE_DDL,
      ...buildOwnerRlsPolicyStatements('oshal_marketing_sms_queue', 'owner_sub'),
    ],
    requirements: [
      {
        table: 'oshal_marketing_contacts',
        columns: ['phone_e164', 'phone_hash', 'timezone', 'timezone_inferred'],
      },
      {
        table: 'oshal_marketing_sms_queue',
        columns: ['sms_id', 'owner_sub', 'contact_id', 'phone_hash', 'status', 'recipient_timezone', 'release_at'],
      },
    ],
  });
}

/** Merge nested evidence with top-level TCPA fields for POST /audience/sms-opt-in. */
function collectSmsEvidenceInput(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.evidence && typeof body.evidence === 'object' && !Array.isArray(body.evidence)
    ? (body.evidence as Record<string, unknown>)
    : {};
  const merged: Record<string, unknown> = { ...nested };
  const keys = [
    'programName', 'program_name', 'disclosureText', 'disclosure_text', 'formText', 'form_text',
    'frequency', 'helpText', 'help_text', 'stopText', 'stop_text', 'feeDisclosure', 'fee_disclosure',
    'recordedAt', 'recorded_at', 'utm',
  ];
  for (const k of keys) {
    if (k in body) merged[k] = body[k];
  }
  return merged;
}

/** Resolve or upsert the owner-scoped contact for an SMS opt-in request. */
async function resolveOptInContact(
  pool: QueryablePool,
  sub: string,
  body: Record<string, unknown>,
  smsProfile: { phoneE164: string; phoneHash: string; timezone: string; timezoneInferred: boolean },
): Promise<{ contact?: any; error?: string; status?: number }> {
  const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
  if (contactId) {
    if (!UUID_RE.test(contactId)) return { status: 404, error: 'contact_not_found' };
    const updated = (await rows(
      pool,
      `UPDATE oshal_marketing_contacts
          SET phone_e164 = $1, phone_hash = $2, timezone = $3, timezone_inferred = $4, updated_at = now()
        WHERE contact_id = $5 AND owner_sub = $6
        RETURNING *`,
      [smsProfile.phoneE164, smsProfile.phoneHash, smsProfile.timezone, smsProfile.timezoneInferred, contactId, sub],
    ))[0];
    return updated ? { contact: updated } : { status: 404, error: 'contact_not_found' };
  }
  const email = normalizeEmail(body.email);
  if (!email) return { status: 400, error: 'contact_or_email_required' };
  const emailHash = hashAddress(email);
  const rawName = typeof body.displayName === 'string'
    ? body.displayName : typeof body.display_name === 'string' ? body.display_name : '';
  const displayName = rawName.trim().slice(0, 200);
  const tags = normalizeTags(body.tags);
  const contact = (await rows(
    pool,
    `INSERT INTO oshal_marketing_contacts
       (owner_sub, email, email_hash, display_name, tags, status, phone_e164, phone_hash, timezone, timezone_inferred)
     VALUES ($1,$2,$3,$4,$5::jsonb,'active',$6,$7,$8,$9)
     ON CONFLICT (owner_sub, email_hash) DO UPDATE SET
       display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE oshal_marketing_contacts.display_name END,
       phone_e164 = EXCLUDED.phone_e164,
       phone_hash = EXCLUDED.phone_hash,
       timezone = EXCLUDED.timezone,
       timezone_inferred = EXCLUDED.timezone_inferred,
       updated_at = now()
     RETURNING *`,
    [sub, email, emailHash, displayName, JSON.stringify(tags), smsProfile.phoneE164, smsProfile.phoneHash, smsProfile.timezone, smsProfile.timezoneInferred],
  ))[0];
  return { contact };
}

/**
 * @description POST /audience/sms-opt-in — record a contact's E.164 phone, explicit or inferred
 * timezone, and complete TCPA/CTIA prior express written SMS consent evidence. Refuses 400 on
 * missing TCPA/CTIA fields or invalid phone/timezone, and 409 if the phone is SMS-suppressed.
 */
export async function recordSmsOptIn(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const phoneE164 = normalizePhoneE164(b.phoneE164 ?? b.phone_e164 ?? b.phone);
  if (!phoneE164) { res.status(400).json({ error: 'invalid_phone' }); return; }

  const { settings } = await loadComplianceSettings(ctx.pool, sub);
  const tzResolved = resolveRecipientTimezone({
    explicitTimezone: b.timezone,
    phoneE164,
    fallbackTimezone: settings.smsDefaultTimezone,
  });
  if (!tzResolved.ok) { res.status(400).json({ error: tzResolved.error }); return; }

  const uaHeader = typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
  const evChecked = normalizeSmsConsentEvidence(collectSmsEvidenceInput(b), {
    ip: req.ip,
    userAgent: uaHeader,
    recordedAt: new Date().toISOString(),
    phoneE164,
    timezone: tzResolved.timezone,
    timezoneInferred: tzResolved.inferred,
  });
  if (!evChecked.ok) {
    res.status(400).json({ error: evChecked.error, missingFields: evChecked.missingFields });
    return;
  }
  if (tooLarge(evChecked.evidence, 32_000)) { res.status(400).json({ error: 'evidence_too_large' }); return; }

  const phoneHash = hashAddress(phoneE164);
  const supps = await rows(
    ctx.pool,
    "SELECT suppression_id FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = 'sms' AND address_hash = $2",
    [sub, phoneHash],
  );
  if (supps.length > 0) { res.status(409).json({ error: 'sms_suppressed', channel: 'sms' }); return; }

  const resolved = await resolveOptInContact(ctx.pool, sub, b, {
    phoneE164, phoneHash, timezone: tzResolved.timezone, timezoneInferred: tzResolved.inferred,
  });
  if (resolved.error || !resolved.contact) {
    res.status(resolved.status ?? 400).json({ error: resolved.error ?? 'contact_or_email_required' });
    return;
  }

  const purpose = typeof b.purpose === 'string' && b.purpose.trim() ? b.purpose.trim().slice(0, 120) : 'marketing';
  const consent = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_consents (owner_sub, contact_id, channel, purpose, status, evidence)
     VALUES ($1,$2,'sms',$3,'confirmed',$4::jsonb) RETURNING *`,
    [sub, String(resolved.contact.contact_id), purpose, JSON.stringify(evChecked.evidence)],
  ))[0];
  const confirmationText = buildSmsOptInConfirmationText(evChecked.evidence);
  res.status(201).json({
    contact: resolved.contact,
    consent,
    confirmationText,
    timezone: tzResolved.timezone,
    timezoneInferred: tzResolved.inferred,
  });
}

/** Persist one SMS gate evaluation row into oshal_marketing_sms_queue. */
async function insertSmsQueueRow(
  pool: QueryablePool,
  sub: string,
  row: {
    contactId: string;
    phoneHash: string;
    body: string;
    recipientTimezone: string;
    timezoneInferred: boolean;
    status: string;
    gateReason: string;
    scheduledFor: string;
    releaseAt: string | null;
  },
): Promise<any> {
  return (await rows(
    pool,
    `INSERT INTO oshal_marketing_sms_queue
       (owner_sub, contact_id, phone_hash, body, recipient_timezone, timezone_inferred, status, gate_reason, scheduled_for, release_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)
     RETURNING *`,
    [
      sub, row.contactId, row.phoneHash, row.body, row.recipientTimezone, row.timezoneInferred,
      row.status, row.gateReason, row.scheduledFor, row.releaseAt,
    ],
  ))[0];
}

/** Load contact, latest SMS consent, suppression state, and timezone for scheduleSmsMessage. */
async function loadSmsGateInputs(
  pool: QueryablePool,
  sub: string,
  contactId: string,
): Promise<{
  contact?: any;
  phoneE164?: string | null;
  phoneHash?: string;
  consentRow?: any;
  suppressed?: boolean;
  recipientTimezone?: string;
  timezoneInferred?: boolean;
  quietStartHour?: number;
  quietEndHour?: number;
} | null> {
  const contact = (await rows(
    pool, 'SELECT * FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub],
  ))[0];
  if (!contact) return null;
  const [{ settings }, consentRows] = await Promise.all([
    loadComplianceSettings(pool, sub),
    rows(
      pool,
      "SELECT * FROM oshal_marketing_consents WHERE owner_sub = $1 AND contact_id = $2 AND channel = 'sms' ORDER BY created_at DESC LIMIT 1",
      [sub, contactId],
    ),
  ]);
  const phoneE164 = normalizePhoneE164(contact.phone_e164);
  const phoneHash = contact.phone_hash ? String(contact.phone_hash) : (phoneE164 ? hashAddress(phoneE164) : '');
  const supps = phoneHash
    ? await rows(
      pool,
      "SELECT suppression_id FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = 'sms' AND address_hash = $2",
      [sub, phoneHash],
    )
    : [];
  const tzResolved = isValidIanaTimezone(contact.timezone)
    ? { timezone: String(contact.timezone), inferred: Boolean(contact.timezone_inferred) }
    : resolveRecipientTimezone({ phoneE164, fallbackTimezone: settings.smsDefaultTimezone });
  return {
    contact,
    phoneE164,
    phoneHash,
    consentRow: consentRows[0] ?? null,
    suppressed: supps.length > 0,
    recipientTimezone: 'timezone' in tzResolved ? tzResolved.timezone : settings.smsDefaultTimezone,
    timezoneInferred: 'inferred' in tzResolved ? tzResolved.inferred : true,
    quietStartHour: settings.smsQuietStartHour,
    quietEndHour: settings.smsQuietEndHour,
  };
}

/**
 * @description POST /audience/sms/schedule — evaluate suppression, TCPA/CTIA SMS consent, and
 * recipient-local quiet hours at nowIso (clock-injectable for testing), persisting the audit/queue
 * row and answering 403 (refused), 202 (held_quiet_hours), or 200 (ready).
 */
export async function scheduleSmsMessage(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const contactId = typeof b.contactId === 'string' ? b.contactId.trim() : '';
  if (!UUID_RE.test(contactId)) { res.status(404).json({ error: 'contact_not_found' }); return; }
  const msgBody = typeof b.body === 'string' ? b.body.trim().slice(0, 1600) : '';
  if (!msgBody) { res.status(400).json({ error: 'sms_body_required' }); return; }
  const rawNow = b.nowIso ?? b.now_iso;
  const nowIso = rawNow !== undefined && rawNow !== null && String(rawNow).trim() !== ''
    ? String(rawNow).trim() : new Date().toISOString();
  if (!Number.isFinite(Date.parse(nowIso))) { res.status(400).json({ error: 'invalid_now_iso' }); return; }
  const canonicalNow = new Date(Date.parse(nowIso)).toISOString();

  const loaded = await loadSmsGateInputs(ctx.pool, sub, contactId);
  if (!loaded) { res.status(404).json({ error: 'contact_not_found' }); return; }

  const gate = evaluateSmsSendGate({
    phoneE164: loaded.phoneE164,
    consentRow: loaded.consentRow,
    suppressed: Boolean(loaded.suppressed),
    timezone: loaded.recipientTimezone!,
    timezoneInferred: Boolean(loaded.timezoneInferred),
    quietHours: { quietStartHour: loaded.quietStartHour, quietEndHour: loaded.quietEndHour },
    nowIso: canonicalNow,
  });
  const queueStatus = gate.decision === 'allowed'
    ? 'ready'
    : gate.decision === 'held_quiet_hours'
      ? 'held_quiet_hours'
      : gate.decision === 'refused_suppressed' ? 'refused_suppressed' : 'refused_consent';
  const queueItem = await insertSmsQueueRow(ctx.pool, sub, {
    contactId, phoneHash: loaded.phoneHash ?? '', body: msgBody,
    recipientTimezone: gate.recipientTimezone, timezoneInferred: gate.timezoneInferred,
    status: queueStatus, gateReason: gate.reason,
    scheduledFor: canonicalNow, releaseAt: gate.releaseAtIso,
  });
  if (queueStatus === 'refused_suppressed' || queueStatus === 'refused_consent') {
    res.status(403).json({
      error: gate.reason, status: queueStatus,
      recipientTimezone: gate.recipientTimezone, timezoneInferred: gate.timezoneInferred, queueItem,
    });
    return;
  }
  res.status(queueStatus === 'held_quiet_hours' ? 202 : 200).json({
    status: queueStatus, releaseAt: gate.releaseAtIso,
    recipientTimezone: gate.recipientTimezone, timezoneInferred: gate.timezoneInferred,
    localHour: gate.localHour, localTimeLabel: gate.localTimeLabel, queueItem,
  });
}

/**
 * @description GET /audience/sms/queue — read-only listing of the caller's SMS queue & gate decisions.
 */
export async function listSmsQueue(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
  if (status && !VALID_QUEUE_STATUSES.has(status)) { res.status(400).json({ error: 'invalid_status' }); return; }
  const contactId = typeof req.query?.contactId === 'string' ? req.query.contactId.trim() : '';
  if (contactId && !UUID_RE.test(contactId)) { res.status(400).json({ error: 'invalid_contact_id' }); return; }
  const where: string[] = ['q.owner_sub = $1'];
  const params: unknown[] = [sub];
  if (status) { params.push(status); where.push(`q.status = $${params.length}`); }
  if (contactId) { params.push(contactId); where.push(`q.contact_id = $${params.length}`); }
  const items = await rows(
    ctx.pool,
    `SELECT q.*, c.email, c.display_name, c.phone_e164
       FROM oshal_marketing_sms_queue q
       JOIN oshal_marketing_contacts c ON c.contact_id = q.contact_id AND c.owner_sub = q.owner_sub
      WHERE ${where.join(' AND ')}
      ORDER BY q.created_at DESC
      LIMIT 200`,
    params,
  );
  res.json({ items, total: items.length });
}

/** Resolve phoneHash and matching owned contact ids for STOP/HELP keyword processing. */
async function resolveKeywordTarget(
  pool: QueryablePool,
  sub: string,
  body: Record<string, unknown>,
): Promise<{ phoneHash?: string; contactIds?: string[]; error?: string; status?: number }> {
  const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
  if (contactId) {
    if (!UUID_RE.test(contactId)) return { status: 404, error: 'contact_not_found' };
    const found = (await rows(
      pool, 'SELECT contact_id, phone_e164, phone_hash FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2',
      [contactId, sub],
    ))[0];
    if (!found) return { status: 404, error: 'contact_not_found' };
    const e164 = normalizePhoneE164(found.phone_e164);
    const phoneHash = found.phone_hash ? String(found.phone_hash) : (e164 ? hashAddress(e164) : '');
    if (!phoneHash) return { status: 400, error: 'contact_missing_phone' };
    return { phoneHash, contactIds: [String(found.contact_id)] };
  }
  const e164 = normalizePhoneE164(body.phoneE164 ?? body.phone_e164 ?? body.phone);
  if (!e164) return { status: 400, error: 'invalid_phone' };
  const phoneHash = hashAddress(e164);
  const matched = await rows(
    pool, 'SELECT contact_id FROM oshal_marketing_contacts WHERE owner_sub = $1 AND phone_hash = $2', [sub, phoneHash],
  );
  return { phoneHash, contactIds: matched.map((r) => String(r.contact_id)) };
}

/**
 * @description POST /audience/sms/keyword — owner-scoped CTIA STOP/HELP processor. STOP suppresses
 * phone_hash in oshal_marketing_suppressions (channel='sms'), revokes SMS consents, cancels held
 * quiet-hours queue items, and returns the final confirmation reply; HELP returns program help text.
 */
export async function processSmsKeyword(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const target = await resolveKeywordTarget(ctx.pool, sub, b);
  if (target.error || !target.phoneHash) {
    res.status(target.status ?? 400).json({ error: target.error ?? 'invalid_phone' });
    return;
  }
  const programName = typeof b.programName === 'string' && b.programName.trim()
    ? b.programName.trim().slice(0, 80) : 'Open Swarm Alerts';
  const classified = classifyInboundSmsKeyword(b.body ?? b.keyword, programName);
  if (classified.action !== 'stop') {
    res.json({
      action: classified.action,
      keyword: classified.keyword,
      suppressed: false,
      revokedConsents: 0,
      cancelledQueueItems: 0,
      replyText: classified.replyText,
    });
    return;
  }

  await ctx.pool.query(
    `INSERT INTO oshal_marketing_suppressions (owner_sub, channel, address_hash, reason, source)
     VALUES ($1,'sms',$2,'sms_stop_keyword','sms_keyword')
     ON CONFLICT (owner_sub, channel, address_hash) DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source`,
    [sub, target.phoneHash],
  );
  let revokedConsents = 0;
  let cancelledQueueItems = 0;
  for (const cid of target.contactIds ?? []) {
    const rev = await ctx.pool.query(
      `UPDATE oshal_marketing_consents SET status = 'revoked', updated_at = now()
        WHERE owner_sub = $1 AND contact_id = $2 AND channel = 'sms' AND status <> 'revoked'`,
      [sub, cid],
    );
    revokedConsents += Number(rev.rowCount ?? 0);
    const can = await ctx.pool.query(
      `UPDATE oshal_marketing_sms_queue SET status = 'cancelled', gate_reason = 'cancelled_by_stop'
        WHERE owner_sub = $1 AND contact_id = $2 AND status = 'held_quiet_hours'`,
      [sub, cid],
    );
    cancelledQueueItems += Number(can.rowCount ?? 0);
  }
  res.json({
    action: 'stop',
    keyword: classified.keyword,
    suppressed: true,
    phoneHash: target.phoneHash,
    revokedConsents,
    cancelledQueueItems,
    replyText: classified.replyText,
  });
}

/**
 * @description Register P4 SMS consent, quiet-hours scheduling, and STOP/HELP keyword routes
 * under existing /api/marketing (oidc).
 */
export function registerSmsRoutes(router: Router, ctx: AppContext): void {
  ensureSmsSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure marketing-engine SMS schema'));
  router.post('/audience/sms-opt-in', authed(ctx, recordSmsOptIn));
  router.post('/audience/sms/schedule', authed(ctx, scheduleSmsMessage));
  router.get('/audience/sms/queue', authed(ctx, listSmsQueue));
  router.post('/audience/sms/keyword', authed(ctx, processSmsKeyword));
}
