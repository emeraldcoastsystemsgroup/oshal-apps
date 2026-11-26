/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure Marketing Engine 0.6.10 P4 SMS consent,
 *     E.164 phone normalization, NANP area-code timezone inference, TCPA/CTIA prior express
 *     written consent evidence validation, deterministic opt-in confirmation message builder,
 *     DST-aware clock-controlled recipient-local quiet-hours evaluator (8 a.m.-9 p.m. local),
 *     full SMS send gate, and inbound CTIA STOP/HELP keyword classifier (zero I/O).
 *
 * @module marketing-sms-model
 */

import { hashAddress, normalizeUtm } from './marketing-audience-model';

/** @description Strict E.164 pattern: + followed by country code 1-9 and 7..14 more digits. */
const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const US_10_RE = /^[2-9][0-9]{9}$/;
const US_11_RE = /^1[2-9][0-9]{9}$/;
const HELP_WORD_RE = /\bhelp\b/i;
const STOP_WORD_RE = /\bstop\b/i;

/** @description Default recipient-local quiet-hours bounds (9 p.m. to 8 a.m. local). */
export const DEFAULT_SMS_QUIET_START_HOUR = 21;
export const DEFAULT_SMS_QUIET_END_HOUR = 8;
export const DEFAULT_SMS_FALLBACK_TIMEZONE = 'America/New_York';

/** @description CTIA mandatory STOP family keywords (case-insensitive). */
export const SMS_STOP_KEYWORDS = new Set([
  'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT',
]);

/** @description CTIA mandatory HELP family keywords (case-insensitive). */
export const SMS_HELP_KEYWORDS = new Set(['HELP', 'INFO']);

/** @description NANP (US/Canada) area code groups mapped to canonical IANA timezones. */
const NANP_ZONE_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['America/New_York', [
    '201', '202', '203', '207', '212', '215', '216', '229', '239', '240', '248', '267',
    '301', '302', '304', '305', '313', '315', '321', '330', '336', '347', '352', '386',
    '401', '404', '407', '410', '412', '413', '416', '434', '438', '440', '443', '470',
    '475', '478', '502', '508', '513', '514', '516', '517', '518', '540', '561', '570',
    '571', '585', '603', '607', '609', '610', '613', '614', '617', '631', '646', '647',
    '678', '703', '704', '706', '716', '717', '718', '724', '727', '732', '734', '757',
    '770', '772', '774', '781', '786', '802', '803', '804', '813', '814', '828', '843',
    '845', '848', '856', '857', '859', '860', '862', '863', '864', '865', '904', '908',
    '910', '912', '914', '917', '919', '929', '937', '941', '954', '973', '978', '980',
  ]],
  ['America/Chicago', [
    '205', '210', '214', '217', '218', '224', '225', '228', '251', '254', '256', '262',
    '281', '309', '312', '314', '316', '318', '319', '320', '325', '331', '334', '337',
    '346', '361', '402', '405', '409', '414', '417', '430', '432', '469', '479', '501',
    '504', '507', '512', '515', '531', '563', '573', '580', '601', '608', '612', '615',
    '618', '620', '630', '636', '641', '651', '660', '662', '682', '701', '708', '712',
    '713', '715', '731', '737', '763', '769', '773', '785', '806', '815', '816', '817',
    '830', '832', '847', '850', '870', '901', '903', '913', '918', '920', '931', '936',
    '940', '952', '956', '972', '979', '985',
  ]],
  ['America/Denver', [
    '208', '303', '307', '385', '406', '435', '480', '505', '520', '575', '602', '623',
    '719', '720', '801', '915', '928', '970',
  ]],
  ['America/Los_Angeles', [
    '206', '209', '213', '253', '310', '323', '360', '408', '415', '424', '425', '442',
    '458', '503', '509', '510', '530', '541', '559', '562', '604', '619', '626', '628',
    '650', '657', '661', '669', '702', '707', '714', '725', '747', '760', '775', '778',
    '805', '818', '831', '858', '909', '916', '925', '949', '951', '971',
  ]],
  ['America/Anchorage', ['907']],
  ['Pacific/Honolulu', ['808']],
];

const NANP_AREA_CODE_MAP: ReadonlyMap<string, string> = new Map(
  NANP_ZONE_GROUPS.flatMap(([zone, codes]) => codes.map((code) => [code, zone] as const)),
);

/** @description Complete TCPA/CTIA prior express written SMS consent evidence record. */
export interface SmsConsentEvidence {
  programName: string;
  disclosureText: string;
  formText: string;
  frequency: string;
  helpText: string;
  stopText: string;
  feeDisclosure: string;
  recordedAt: string;
  ip: string | null;
  userAgent: string | null;
  utm: Record<string, string>;
  phoneHash?: string;
  timezone?: string;
  timezoneInferred?: boolean;
}

/** @description Quiet-hours evaluation result for a recipient-local clock instant. */
export interface SmsQuietHoursResult {
  allowed: boolean;
  held: boolean;
  recipientTimezone: string;
  localHour: number;
  localTimeLabel: string;
  releaseAtIso: string;
  quietStartHour: number;
  quietEndHour: number;
}

/** @description Full SMS send gate verdict combining suppression, consent, and quiet hours. */
export interface SmsSendGateDecision {
  allowed: boolean;
  decision: 'allowed' | 'held_quiet_hours' | 'refused_consent' | 'refused_suppressed' | 'refused_invalid_phone';
  reason: string;
  recipientTimezone: string;
  timezoneInferred: boolean;
  localHour: number | null;
  localTimeLabel: string | null;
  releaseAtIso: string | null;
}

/** @description Deterministic inbound CTIA keyword classification result. */
export interface InboundSmsKeywordResult {
  action: 'stop' | 'help' | 'none';
  keyword: string | null;
  suppress: boolean;
  replyText: string | null;
}

/**
 * @description Normalize a phone number to strict E.164 (+[1-9][0-9]{7,14}), cleanly accepting
 * formatted US/CA 10-digit or 1-prefixed 11-digit numbers and rejecting invalid inputs.
 */
export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/[\s().-]+/g, '');
  if (stripped.startsWith('+')) {
    return E164_RE.test(stripped) ? stripped : null;
  }
  if (US_10_RE.test(stripped)) return `+1${stripped}`;
  if (US_11_RE.test(stripped)) return `+${stripped}`;
  return null;
}

/**
 * @description Check whether a candidate string is a valid IANA time zone via Intl.DateTimeFormat.
 */
export function isValidIanaTimezone(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const tz = raw.trim();
  if (!tz || tz.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * @description Infer a recipient's IANA time zone from a NANP (+1) E.164 phone number's area code,
 * falling back cleanly to fallbackTimezone and always marking inferred: true.
 */
export function inferTimezoneFromPhone(
  phoneE164: unknown,
  fallbackTimezone: string = DEFAULT_SMS_FALLBACK_TIMEZONE,
): { timezone: string; inferred: true; areaCode: string | null } {
  const safeFallback = isValidIanaTimezone(fallbackTimezone)
    ? fallbackTimezone.trim()
    : DEFAULT_SMS_FALLBACK_TIMEZONE;
  const normalized = normalizePhoneE164(phoneE164);
  if (normalized && normalized.startsWith('+1') && normalized.length === 12) {
    const areaCode = normalized.slice(2, 5);
    const mapped = NANP_AREA_CODE_MAP.get(areaCode);
    if (mapped) return { timezone: mapped, inferred: true, areaCode };
    return { timezone: safeFallback, inferred: true, areaCode };
  }
  return { timezone: safeFallback, inferred: true, areaCode: null };
}

/**
 * @description Resolve recipient timezone: explicit valid IANA timezone returns inferred: false;
 * omitted timezone infers from E.164 area code (inferred: true); invalid explicit timezone fails.
 */
export function resolveRecipientTimezone(input: {
  explicitTimezone?: unknown;
  phoneE164?: unknown;
  fallbackTimezone?: string;
}): { ok: true; timezone: string; inferred: boolean } | { ok: false; error: 'invalid_timezone' } {
  if (typeof input.explicitTimezone === 'string' && input.explicitTimezone.trim() !== '') {
    const tz = input.explicitTimezone.trim();
    if (!isValidIanaTimezone(tz)) return { ok: false, error: 'invalid_timezone' };
    return { ok: true, timezone: tz, inferred: false };
  }
  const inferred = inferTimezoneFromPhone(input.phoneE164, input.fallbackTimezone);
  return { ok: true, timezone: inferred.timezone, inferred: true };
}

/** Extract a bounded trimmed string from an object under primary or snake_case fallback keys. */
function readBoundedText(src: Record<string, unknown>, keys: string[], max: number): string {
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim().slice(0, max);
  }
  return '';
}

/** Validate a single ISO-8601 timestamp string and return its canonical ISO form or null. */
function parseIsoTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = Date.parse(raw.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * @description Validate and normalize all 7 mandatory TCPA/CTIA prior express written SMS consent
 * evidence fields: programName, disclosureText, frequency, helpText, stopText, feeDisclosure,
 * and recordedAt.
 */
export function normalizeSmsConsentEvidence(
  raw: unknown,
  fallback?: { ip?: string; userAgent?: string; recordedAt?: string; phoneE164?: string; timezone?: string; timezoneInferred?: boolean },
): { ok: true; evidence: SmsConsentEvidence } | { ok: false; error: 'sms_consent_incomplete'; missingFields: string[] } {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const programName = readBoundedText(src, ['programName', 'program_name'], 80);
  const disclosureText = readBoundedText(src, ['disclosureText', 'disclosure_text', 'formText', 'form_text'], 2000);
  const frequency = readBoundedText(src, ['frequency'], 160);
  const helpText = readBoundedText(src, ['helpText', 'help_text'], 240);
  const stopText = readBoundedText(src, ['stopText', 'stop_text'], 240);
  const feeDisclosure = readBoundedText(src, ['feeDisclosure', 'fee_disclosure'], 240);
  const hasExplicitRecorded = 'recordedAt' in src || 'recorded_at' in src;
  const rawRecorded = src.recordedAt ?? src.recorded_at ?? (hasExplicitRecorded ? '' : fallback?.recordedAt);
  const recordedAt = parseIsoTimestamp(rawRecorded);

  const missingFields: string[] = [];
  if (programName.length < 2) missingFields.push('programName');
  if (!disclosureText) missingFields.push('disclosureText');
  if (!frequency) missingFields.push('frequency');
  if (!helpText || !HELP_WORD_RE.test(helpText)) missingFields.push('helpText');
  if (!stopText || !STOP_WORD_RE.test(stopText)) missingFields.push('stopText');
  if (!feeDisclosure) missingFields.push('feeDisclosure');
  if (!recordedAt) missingFields.push('recordedAt');
  if (missingFields.length > 0) return { ok: false, error: 'sms_consent_incomplete', missingFields };

  const ip = readBoundedText(src, ['ip'], 128) || (fallback?.ip ? fallback.ip.trim().slice(0, 128) : null);
  const userAgent = readBoundedText(src, ['userAgent', 'user_agent'], 512)
    || (fallback?.userAgent ? fallback.userAgent.trim().slice(0, 512) : null);
  const evidence: SmsConsentEvidence = {
    programName, disclosureText, formText: disclosureText, frequency,
    helpText, stopText, feeDisclosure, recordedAt: recordedAt!,
    ip, userAgent, utm: normalizeUtm(src.utm),
  };
  if (fallback?.phoneE164) evidence.phoneHash = hashAddress(fallback.phoneE164);
  if (fallback?.timezone) {
    evidence.timezone = fallback.timezone;
    evidence.timezoneInferred = Boolean(fallback.timezoneInferred);
  }
  return { ok: true, evidence };
}

/**
 * @description Deterministically generate the mandatory TCPA/CTIA opt-in confirmation SMS message
 * naming programName, frequency, feeDisclosure, HELP, and STOP.
 */
export function buildSmsOptInConfirmationText(evidence: Pick<
  SmsConsentEvidence,
  'programName' | 'frequency' | 'feeDisclosure' | 'helpText' | 'stopText'
>): string {
  const clean = (s: string): string => String(s || '').trim().replace(/\.+$/, '');
  return `${clean(evidence.programName)}: You are subscribed to SMS updates. ${clean(evidence.frequency)}. `
    + `${clean(evidence.feeDisclosure)}. ${clean(evidence.helpText)}. ${clean(evidence.stopText)}.`;
}

/**
 * @description Verify a stored consent row carries confirmed SMS prior express written consent
 * with every required TCPA/CTIA evidence field present and valid.
 */
export function hasValidSmsConsent(consentRow: Record<string, unknown> | null | undefined): boolean {
  if (!consentRow || typeof consentRow !== 'object') return false;
  if (String(consentRow.channel || '') !== 'sms') return false;
  if (String(consentRow.status || '') !== 'confirmed') return false;
  const checked = normalizeSmsConsentEvidence(consentRow.evidence);
  return checked.ok;
}

/** Extract numeric local date/time parts in an IANA timezone using 24-hour cycle. */
function getLocalDateParts(date: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const map: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** Convert a wall-clock local date + hour (00:00 minutes/seconds) in an IANA timezone to UTC Date. */
function localWallClockToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const targetMs = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let guessMs = targetMs;
  for (let i = 0; i < 3; i += 1) {
    const p = getLocalDateParts(new Date(guessMs), timeZone);
    const renderedMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diffMs = targetMs - renderedMs;
    if (diffMs === 0) break;
    guessMs += diffMs;
  }
  return new Date(guessMs);
}

/** Normalize an integer hour bound (0..23) with fallback. */
function clampHour(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

/**
 * @description Clock-controlled DST-aware evaluator for recipient-local SMS quiet hours
 * (default 21:00-08:00, i.e., permitting 8 a.m.-9 p.m. recipient-local). When held, returns the
 * exact UTC ISO timestamp of the next quietEndHour:00:00 in recipientTimezone.
 */
export function evaluateSmsQuietHours(
  nowIso: string,
  recipientTimezone: string,
  opts: { quietStartHour?: number; quietEndHour?: number } = {},
): SmsQuietHoursResult {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) throw Object.assign(new Error('Invalid nowIso timestamp'), { code: 'invalid_now_iso' });
  const tz = isValidIanaTimezone(recipientTimezone) ? recipientTimezone.trim() : DEFAULT_SMS_FALLBACK_TIMEZONE;
  const quietStartHour = clampHour(opts.quietStartHour, DEFAULT_SMS_QUIET_START_HOUR);
  const quietEndHour = clampHour(opts.quietEndHour, DEFAULT_SMS_QUIET_END_HOUR);
  const canonicalNowIso = new Date(nowMs).toISOString();
  const local = getLocalDateParts(new Date(nowMs), tz);
  const localTimeLabel = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;

  const isQuiet = quietStartHour > quietEndHour
    ? local.hour >= quietStartHour || local.hour < quietEndHour
    : quietStartHour < quietEndHour
      ? local.hour >= quietStartHour && local.hour < quietEndHour
      : false;

  if (!isQuiet) {
    return {
      allowed: true, held: false, recipientTimezone: tz,
      localHour: local.hour, localTimeLabel, releaseAtIso: canonicalNowIso,
      quietStartHour, quietEndHour,
    };
  }

  const needsNextDay = quietStartHour > quietEndHour && local.hour >= quietStartHour;
  const targetDay = new Date(Date.UTC(local.year, local.month - 1, local.day + (needsNextDay ? 1 : 0)));
  const releaseUtc = localWallClockToUtc(
    targetDay.getUTCFullYear(),
    targetDay.getUTCMonth() + 1,
    targetDay.getUTCDate(),
    quietEndHour,
    tz,
  );
  return {
    allowed: false, held: true, recipientTimezone: tz,
    localHour: local.hour, localTimeLabel, releaseAtIso: releaseUtc.toISOString(),
    quietStartHour, quietEndHour,
  };
}

/**
 * @description Evaluate the complete SMS send gate: suppression -> valid TCPA/CTIA SMS consent ->
 * recipient-local quiet-hours window. Never allows a suppressed or unconsented recipient.
 */
export function evaluateSmsSendGate(input: {
  phoneE164: string | null | undefined;
  consentRow: Record<string, unknown> | null | undefined;
  suppressed: boolean;
  timezone: string;
  timezoneInferred: boolean;
  quietHours?: { quietStartHour?: number; quietEndHour?: number };
  nowIso?: string;
}): SmsSendGateDecision {
  const tz = isValidIanaTimezone(input.timezone) ? input.timezone.trim() : DEFAULT_SMS_FALLBACK_TIMEZONE;
  const inferred = Boolean(input.timezoneInferred);
  if (input.suppressed) {
    return {
      allowed: false, decision: 'refused_suppressed', reason: 'sms_suppressed',
      recipientTimezone: tz, timezoneInferred: inferred, localHour: null, localTimeLabel: null, releaseAtIso: null,
    };
  }
  if (!hasValidSmsConsent(input.consentRow)) {
    return {
      allowed: false, decision: 'refused_consent', reason: 'sms_consent_required',
      recipientTimezone: tz, timezoneInferred: inferred, localHour: null, localTimeLabel: null, releaseAtIso: null,
    };
  }
  if (!normalizePhoneE164(input.phoneE164)) {
    return {
      allowed: false, decision: 'refused_invalid_phone', reason: 'invalid_phone',
      recipientTimezone: tz, timezoneInferred: inferred, localHour: null, localTimeLabel: null, releaseAtIso: null,
    };
  }
  const qh = evaluateSmsQuietHours(input.nowIso ?? new Date().toISOString(), tz, input.quietHours);
  return {
    allowed: qh.allowed,
    decision: qh.held ? 'held_quiet_hours' : 'allowed',
    reason: qh.held ? 'quiet_hours_hold' : 'permitted_window',
    recipientTimezone: qh.recipientTimezone,
    timezoneInferred: inferred,
    localHour: qh.localHour,
    localTimeLabel: qh.localTimeLabel,
    releaseAtIso: qh.releaseAtIso,
  };
}

/**
 * @description Pure deterministic CTIA inbound keyword classifier matching STOP family
 * (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT, any case) and HELP family (HELP/INFO, any case).
 */
export function classifyInboundSmsKeyword(body: unknown, programName = 'Open Swarm Alerts'): InboundSmsKeywordResult {
  if (typeof body !== 'string') return { action: 'none', keyword: null, suppress: false, replyText: null };
  const token = body.trim().replace(/[.!?]+$/, '').toUpperCase();
  const prog = typeof programName === 'string' && programName.trim()
    ? programName.trim().slice(0, 80)
    : 'Open Swarm Alerts';
  if (SMS_STOP_KEYWORDS.has(token)) {
    return {
      action: 'stop',
      keyword: token,
      suppress: true,
      replyText: `${prog}: You are unsubscribed and will receive no further SMS messages. Reply HELP for support.`,
    };
  }
  if (SMS_HELP_KEYWORDS.has(token)) {
    return {
      action: 'help',
      keyword: token,
      suppress: false,
      replyText: `${prog} SMS support: Reply STOP to opt out at any time. Msg & data rates may apply.`,
    };
  }
  return { action: 'none', keyword: null, suppress: false, replyText: null };
}
