"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure sequence state-machine and strict
 *     per-sequence standing authorization model for marketing-engine 0.6.6 (zero DB, zero
 *     network): strict boolean-only standing authorization guard (absent row = OFF, garbage
 *     values never arm, arming requires confirm: true + dailyCap >= 1, one-click disarm needs
 *     no confirm), sequence & step normalization (always standing_authorization = false on
 *     creation), row sanitization omitting signing_secret, and deterministic step advancement
 *     gate re-checking channel consent, compliance settings, per-sequence standing auth,
 *     daily cap, recipient suppression, and confirmed consent before every single step.
 *
 * @module marketing-sequence-model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DELAY_HOURS = exports.MAX_STEP_ORDER = exports.MAX_SEQUENCE_DAILY_CAP = exports.SEQUENCE_SLUG_RE = exports.ENROLLMENT_STATUSES = exports.SEQUENCE_STATUSES = void 0;
exports.isSequenceArmed = isSequenceArmed;
exports.parseStandingAuthInput = parseStandingAuthInput;
exports.normalizeSequence = normalizeSequence;
exports.normalizeSequenceStep = normalizeSequenceStep;
exports.sanitizeSequenceRow = sanitizeSequenceRow;
exports.emptySequenceTickStats = emptySequenceTickStats;
exports.evaluateSequenceStepRun = evaluateSequenceStepRun;
const marketing_model_1 = require("./marketing-model");
const marketing_broadcast_model_1 = require("./marketing-broadcast-model");
const marketing_templates_1 = require("./marketing-templates");
/** @description Valid sequence lifecycle statuses. */
exports.SEQUENCE_STATUSES = ['draft', 'active', 'paused', 'archived'];
/** @description Valid per-recipient enrollment statuses. */
exports.ENROLLMENT_STATUSES = [
    'active', 'completed', 'stopped_unsubscribed', 'stopped_unconsented', 'paused',
];
/** @description Allowed slug format for sequence slugs and trigger form slugs. */
exports.SEQUENCE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** @description Maximum sequence daily cap. */
exports.MAX_SEQUENCE_DAILY_CAP = 5000;
/** @description Maximum step order within one sequence. */
exports.MAX_STEP_ORDER = 50;
/** @description Maximum inter-step delay in hours (365 days). */
exports.MAX_DELAY_HOURS = 8760;
/** Trim and bound text input cleanly. */
function trimBound(raw, max) {
    if (typeof raw !== 'string')
        return '';
    return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, max);
}
/** Convert a display name into a URL-safe slug. */
function slugifyName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
/**
 * @description Strict per-sequence standing authorization check.
 * Returns true ONLY when the row exists, standing_authorization === true (strict boolean),
 * daily_cap is an integer >= 1, and status === 'active'. Absent rows and garbage values ALWAYS
 * return false.
 * @param seqRow - Sequence row or null/undefined.
 * @returns True strictly when armed.
 */
function isSequenceArmed(seqRow) {
    if (!seqRow || typeof seqRow !== 'object' || Array.isArray(seqRow))
        return false;
    return seqRow.standing_authorization === true
        && Number.isInteger(seqRow.daily_cap)
        && seqRow.daily_cap >= 1
        && seqRow.status === 'active';
}
/** Validate an integer dailyCap against a min..MAX_SEQUENCE_DAILY_CAP range. */
function isValidCap(val, min) {
    return typeof val === 'number' && Number.isInteger(val) && val >= min && val <= exports.MAX_SEQUENCE_DAILY_CAP;
}
/**
 * @description Strictly validate PUT /sequences/:id/authorization input.
 * Rejects non-boolean garbage values ('true', 1, 'yes', {}, null, undefined) with 400.
 * Disarming (false) requires NO confirm. Arming (true) requires confirm: true (428 if missing)
 * and a valid integer dailyCap in 1..5000 (400 if 0 or invalid).
 * @param raw - Untrusted request body.
 * @param existingDailyCap - Current sequence daily_cap used when body omits dailyCap.
 * @returns Parsed standing authorization command or coded HTTP refusal.
 */
function parseStandingAuthInput(raw, existingDailyCap = 0) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
    if (typeof src.standingAuthorization !== 'boolean') {
        return { ok: false, status: 400, error: 'invalid_standing_authorization', message: 'standingAuthorization must be a strict boolean (true or false).' };
    }
    const hasCap = src.dailyCap !== undefined || src.daily_cap !== undefined;
    const rawCap = src.dailyCap !== undefined ? src.dailyCap : src.daily_cap;
    if (src.standingAuthorization === false) {
        if (!hasCap)
            return { ok: true, standingAuthorization: false };
        if (!isValidCap(rawCap, 0)) {
            return { ok: false, status: 400, error: 'invalid_daily_cap', message: 'dailyCap must be an integer between 0 and 5000.' };
        }
        return { ok: true, standingAuthorization: false, dailyCap: rawCap };
    }
    if (hasCap && !isValidCap(rawCap, 1)) {
        return { ok: false, status: 400, error: 'invalid_daily_cap', message: 'Arming standing authorization requires an integer dailyCap between 1 and 5000.' };
    }
    if (src.confirm !== true) {
        return { ok: false, status: 428, error: 'confirmation_required', message: 'Arming per-sequence standing authorization requires confirm: true.' };
    }
    const resolvedCap = hasCap ? rawCap : existingDailyCap;
    if (!isValidCap(resolvedCap, 1)) {
        return { ok: false, status: 400, error: 'invalid_daily_cap', message: 'Arming standing authorization requires a dailyCap of at least 1.' };
    }
    return { ok: true, standingAuthorization: true, dailyCap: resolvedCap };
}
/**
 * @description Validate and normalize POST /sequences creation input.
 * Always forces standingAuthorization = false on creation regardless of caller input.
 * @param raw - Untrusted request body.
 * @returns Normalized sequence creation payload or coded validation error.
 */
function normalizeSequence(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
    const name = trimBound(src.name, 120);
    if (!name)
        return { ok: false, error: 'name_required', message: 'Sequence name is required (1-120 characters).' };
    const slugInput = trimBound(src.slug, 64).toLowerCase();
    const slug = slugInput || slugifyName(name);
    if (!exports.SEQUENCE_SLUG_RE.test(slug)) {
        return { ok: false, error: 'invalid_slug', message: 'Sequence slug must match ^[a-z0-9][a-z0-9-]{0,63}$.' };
    }
    const rawTrigger = trimBound(src.triggerFormSlug ?? src.trigger_form_slug, 64).toLowerCase();
    if (rawTrigger && !exports.SEQUENCE_SLUG_RE.test(rawTrigger)) {
        return { ok: false, error: 'invalid_trigger_form_slug', message: 'triggerFormSlug must be a valid lowercase slug.' };
    }
    const rawCap = src.dailyCap !== undefined ? src.dailyCap : src.daily_cap;
    let dailyCap = 0;
    if (rawCap !== undefined && rawCap !== null && rawCap !== '') {
        const num = Number(rawCap);
        if (!Number.isInteger(num) || num < 0 || num > exports.MAX_SEQUENCE_DAILY_CAP) {
            return { ok: false, error: 'invalid_daily_cap', message: 'dailyCap must be an integer between 0 and 5000.' };
        }
        dailyCap = num;
    }
    const rawStatus = trimBound(src.status, 16) || 'draft';
    if (rawStatus !== 'draft' && rawStatus !== 'active' && rawStatus !== 'paused') {
        return { ok: false, error: 'invalid_status', message: 'status must be draft, active, or paused.' };
    }
    return {
        ok: true,
        sequence: {
            name,
            slug,
            description: trimBound(src.description, 1000),
            triggerFormSlug: rawTrigger || null,
            status: rawStatus,
            standingAuthorization: false,
            dailyCap,
        },
    };
}
/**
 * @description Validate and normalize POST /sequences/:id/steps input.
 * @param raw - Untrusted request body.
 * @returns Normalized step fields or coded validation error.
 */
function normalizeSequenceStep(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
    const stepOrder = Number(src.stepOrder ?? src.step_order);
    if (!Number.isInteger(stepOrder) || stepOrder < 1 || stepOrder > exports.MAX_STEP_ORDER) {
        return { ok: false, error: 'invalid_step_order', message: 'stepOrder must be an integer between 1 and 50.' };
    }
    const rawDelay = src.delayHours !== undefined ? src.delayHours : src.delay_hours;
    const delayHours = rawDelay === undefined || rawDelay === null || rawDelay === '' ? 0 : Number(rawDelay);
    if (!Number.isInteger(delayHours) || delayHours < 0 || delayHours > exports.MAX_DELAY_HOURS) {
        return { ok: false, error: 'invalid_delay_hours', message: 'delayHours must be an integer between 0 and 8760.' };
    }
    const tplRaw = trimBound(src.templateId ?? src.template_id, 32) || 'announcement';
    if (!marketing_templates_1.MARKETING_TEMPLATE_IDS.includes(tplRaw)) {
        return { ok: false, error: 'invalid_template_id', message: 'templateId must be announcement, newsletter, or launch.' };
    }
    const subject = trimBound(src.subject, 240);
    if (!subject)
        return { ok: false, error: 'subject_required', message: 'Step subject is required.' };
    const body = trimBound(src.body, 8000);
    if (!body)
        return { ok: false, error: 'body_required', message: 'Step body is required.' };
    const rawCtaUrl = trimBound(src.ctaUrl ?? src.cta_url, 2000);
    const ctaUrl = rawCtaUrl ? (0, marketing_templates_1.safeHttpUrl)(rawCtaUrl) : '';
    if (rawCtaUrl && !ctaUrl) {
        return { ok: false, error: 'invalid_cta_url', message: 'CTA URL must start with https:// or http://.' };
    }
    return {
        ok: true,
        step: {
            stepOrder,
            delayHours,
            templateId: tplRaw,
            subject,
            headline: trimBound(src.headline, 240) || subject,
            intro: trimBound(src.intro, 1200),
            body,
            ctaLabel: trimBound(src.ctaLabel ?? src.cta_label, 120),
            ctaUrl: ctaUrl || '',
        },
    };
}
/**
 * @description Project an oshal_marketing_sequences row for API output, strictly omitting signing_secret.
 * @param row - Raw database row.
 * @returns Sanitized sequence object without secrets.
 */
function sanitizeSequenceRow(row) {
    const armed = isSequenceArmed(row);
    return {
        sequence_id: row.sequence_id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? '',
        trigger_form_slug: row.trigger_form_slug ?? null,
        status: row.status ?? 'draft',
        standing_authorization: row.standing_authorization === true,
        armed,
        daily_cap: Number.isInteger(row.daily_cap) ? row.daily_cap : Number(row.daily_cap ?? 0),
        ...(row.step_count !== undefined ? { step_count: Number(row.step_count) } : {}),
        ...(row.active_enrollment_count !== undefined ? { active_enrollment_count: Number(row.active_enrollment_count) } : {}),
        ...(row.total_enrollment_count !== undefined ? { total_enrollment_count: Number(row.total_enrollment_count) } : {}),
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
    };
}
/** Create an initialized zeroed tick stats summary. */
function emptySequenceTickStats(evaluated) {
    return {
        evaluated,
        eligible: 0,
        dryRun: 0,
        sent: 0,
        completed: 0,
        notDue: 0,
        stoppedUnsubscribed: 0,
        stoppedUnconsented: 0,
        skippedCap: 0,
        skippedCompliance: 0,
        skippedDisarmed: 0,
        error: 0,
    };
}
/** Construct a blocked preflight tick result. */
function blockedTick(armed, httpStatus, error, reason, stats, reasons) {
    return {
        blocked: true,
        httpStatus,
        armed,
        error,
        reason,
        ...(reasons ? { reasons } : {}),
        effectiveRemainingCap: 0,
        decisions: [],
        stats,
    };
}
/** Check owner email channel consent and cap for a sequence tick. */
function checkSequenceChannelGate(input, armed, stats) {
    const paused = typeof input.channelRow?.paused_reason === 'string' ? input.channelRow.paused_reason.trim() : '';
    if (!(0, marketing_model_1.isChannelEnabled)(input.channelRow) || paused !== '') {
        const reason = paused ? `channel_paused:${paused}` : 'email_channel_consent_off';
        return { blocked: blockedTick(armed, 403, 'skipped_consent', reason, stats), channelDailyCap: 0 };
    }
    const chCap = Number(input.channelRow?.daily_cap);
    if (!Number.isFinite(chCap) || chCap < 1) {
        return { blocked: blockedTick(armed, 403, 'skipped_cap', 'channel_daily_cap_zero', stats), channelDailyCap: 0 };
    }
    return { channelDailyCap: chCap };
}
/** Evaluate preflight standing auth, owner channel consent, compliance readiness, and effective cap. */
function checkTickPreflight(input) {
    const armed = isSequenceArmed(input.sequence);
    const stats = emptySequenceTickStats(input.enrollments.length);
    const fallback = (0, marketing_templates_1.normalizeComplianceSettings)({});
    const norm = (0, marketing_templates_1.normalizeComplianceSettings)(input.compliance ?? {});
    const settings = norm.ok ? norm.settings : fallback.settings;
    if (!armed && !input.dryRun) {
        stats.skippedDisarmed = input.enrollments.length;
        return { armed, settings, effectiveRemainingCap: 0, blocked: blockedTick(false, 403, 'sequence_disarmed', 'sequence_standing_authorization_off', stats) };
    }
    const chGate = checkSequenceChannelGate(input, armed, stats);
    if (chGate.blocked)
        return { armed, settings, effectiveRemainingCap: 0, blocked: chGate.blocked };
    if (!(0, marketing_templates_1.complianceReadiness)(settings).readyForEmailSend) {
        const reasons = [
            { code: 'compliance_incomplete', message: 'Configure sender identity, physical postal address, and unsubscribe URL in Compliance settings.' },
        ];
        return { armed, settings, effectiveRemainingCap: 0, blocked: blockedTick(armed, 422, 'skipped_compliance', 'compliance_incomplete', stats, reasons) };
    }
    const chRem = Math.max(0, chGate.channelDailyCap - Math.max(0, Number(input.channelSentToday) || 0));
    const seqCap = Number.isInteger(input.sequence.daily_cap) ? input.sequence.daily_cap : 0;
    const seqRem = Math.max(0, seqCap - Math.max(0, Number(input.sequenceSentToday) || 0));
    return { armed, settings, effectiveRemainingCap: Math.min(seqRem, chRem) };
}
/** Construct a non-sending enrollment decision (skip, defer, stop, or already complete). */
function makeNonSendDecision(e, emailHash, opts) {
    return {
        enrollmentId: e.enrollmentId, contactId: e.contactId, email: e.email, emailHash,
        stepOrder: opts.stepOrder, outcome: opts.outcome, gateReason: opts.gateReason,
        nextEnrollmentStatus: opts.nextEnrollmentStatus,
        previousStepOrder: e.currentStepOrder,
        nextStepOrder: e.currentStepOrder,
        nextRunAtIso: opts.nextRunAtIso,
        shouldMutate: opts.shouldMutate,
    };
}
/** Render one step email for an eligible enrollment with signed unsubscribe URL and RFC 8058 headers. */
function renderEnrollmentStepEmail(enrollment, step, followingStep, input, settings, canMutate) {
    const emailHash = String(enrollment.emailHash || '').trim().toLowerCase();
    const unsubToken = (0, marketing_broadcast_model_1.mintUnsubscribeToken)({
        ownerSub: input.ownerSub, contactId: enrollment.contactId, emailHash,
        listId: input.sequence.sequence_id, messageId: input.sequence.sequence_id,
    }, input.sequence.signing_secret);
    const unsubUrl = (0, marketing_broadcast_model_1.buildUnsubscribeUrl)(settings.unsubscribeBaseUrl, unsubToken);
    if (!unsubUrl) {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: step.step_order, outcome: 'skipped_compliance', gateReason: 'invalid_unsubscribe_url',
            nextEnrollmentStatus: enrollment.status, nextRunAtIso: null, shouldMutate: false,
        });
    }
    const headers = (0, marketing_broadcast_model_1.buildRfc8058Headers)(unsubUrl);
    const rendered = (0, marketing_templates_1.renderMarketingTemplate)({
        templateId: step.template_id, subject: step.subject, headline: step.headline, intro: step.intro,
        body: step.body, ctaLabel: step.cta_label, ctaUrl: step.cta_url, unsubscribeUrl: unsubUrl,
    }, settings);
    const lint = (0, marketing_templates_1.lintMarketingEmail)({ html: rendered.html, text: rendered.text, compliance: settings, unsubscribeUrl: unsubUrl });
    if (!lint.ok) {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: step.step_order, outcome: 'skipped_compliance',
            gateReason: lint.errors[0]?.code || 'template_compliance_failed',
            nextEnrollmentStatus: enrollment.status, nextRunAtIso: null, shouldMutate: false,
        });
    }
    const nextEnrollmentStatus = followingStep ? 'active' : 'completed';
    const nextRunAtIso = followingStep
        ? new Date(input.nowMs + followingStep.delay_hours * 3_600_000).toISOString()
        : new Date(input.nowMs).toISOString();
    return {
        enrollmentId: enrollment.enrollmentId, contactId: enrollment.contactId, email: enrollment.email, emailHash,
        stepOrder: step.step_order, outcome: input.dryRun ? 'dry_run' : 'eligible',
        gateReason: input.dryRun ? 'dry_run_due' : 'armed_due',
        nextEnrollmentStatus, previousStepOrder: enrollment.currentStepOrder, nextStepOrder: step.step_order,
        nextRunAtIso, shouldMutate: canMutate,
        subject: rendered.subject, html: rendered.html, text: rendered.text, unsubscribeUrl: unsubUrl,
        ...(input.dryRun && input.includeUnsubscribePreviewTokens ? { unsubscribeToken: unsubToken } : {}),
        headers,
    };
}
/** Evaluate one enrollment against due time, step order, suppression, consent, and daily cap. */
function evaluateSingleEnrollment(enrollment, sortedSteps, input, settings, remainingCap, canMutate) {
    const emailHash = String(enrollment.emailHash || '').trim().toLowerCase();
    if (enrollment.status !== 'active') {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: null, outcome: 'skipped_inactive', gateReason: `enrollment_${enrollment.status}`,
            nextEnrollmentStatus: enrollment.status, nextRunAtIso: null, shouldMutate: false,
        });
    }
    const dueMs = enrollment.nextRunAt instanceof Date ? enrollment.nextRunAt.getTime() : Date.parse(String(enrollment.nextRunAt || ''));
    if (Number.isFinite(dueMs) && dueMs > input.nowMs) {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: null, outcome: 'not_due', gateReason: 'not_yet_due',
            nextEnrollmentStatus: 'active', nextRunAtIso: new Date(dueMs).toISOString(), shouldMutate: false,
        });
    }
    const nextIdx = sortedSteps.findIndex((s) => s.step_order > enrollment.currentStepOrder);
    if (nextIdx < 0) {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: null, outcome: 'completed', gateReason: 'no_more_steps',
            nextEnrollmentStatus: 'completed', nextRunAtIso: new Date(input.nowMs).toISOString(), shouldMutate: canMutate,
        });
    }
    const step = sortedSteps[nextIdx];
    if (input.suppressedEmailHashes.has(emailHash) || enrollment.contactStatus === 'suppressed' || enrollment.contactStatus === 'unsubscribed') {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: step.step_order, outcome: 'skipped_suppressed', gateReason: 'recipient_suppressed',
            nextEnrollmentStatus: 'stopped_unsubscribed', nextRunAtIso: null, shouldMutate: canMutate,
        });
    }
    if (String(enrollment.emailConsentStatus || '') !== 'confirmed') {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: step.step_order, outcome: 'skipped_unconfirmed', gateReason: 'recipient_consent_not_confirmed',
            nextEnrollmentStatus: 'stopped_unconsented', nextRunAtIso: null, shouldMutate: canMutate,
        });
    }
    if (remainingCap <= 0) {
        return makeNonSendDecision(enrollment, emailHash, {
            stepOrder: step.step_order, outcome: 'skipped_cap', gateReason: 'sequence_daily_cap_reached',
            nextEnrollmentStatus: 'active', nextRunAtIso: null, shouldMutate: false,
        });
    }
    return renderEnrollmentStepEmail(enrollment, step, sortedSteps[nextIdx + 1], input, settings, canMutate);
}
/** Tally one enrollment decision into the tick stats accumulator. */
function tallyDecision(stats, decision) {
    if (decision.outcome === 'eligible') {
        stats.eligible += 1;
        if (decision.nextEnrollmentStatus === 'completed')
            stats.completed += 1;
    }
    else if (decision.outcome === 'dry_run') {
        stats.dryRun += 1;
        if (decision.nextEnrollmentStatus === 'completed')
            stats.completed += 1;
    }
    else if (decision.outcome === 'completed')
        stats.completed += 1;
    else if (decision.outcome === 'not_due')
        stats.notDue += 1;
    else if (decision.outcome === 'skipped_suppressed')
        stats.stoppedUnsubscribed += 1;
    else if (decision.outcome === 'skipped_unconfirmed')
        stats.stoppedUnconsented += 1;
    else if (decision.outcome === 'skipped_cap')
        stats.skippedCap += 1;
    else if (decision.outcome === 'skipped_compliance')
        stats.skippedCompliance += 1;
    else if (decision.outcome === 'skipped_disarmed')
        stats.skippedDisarmed += 1;
}
/**
 * @description Deterministically evaluate a sequence tick across all enrollments:
 * 1. Per-sequence standing authorization (disarmed live tick refused 403 sequence_disarmed)
 * 2. Owner email channel consent & compliance readiness
 * 3. Per-enrollment due time, suppression re-check, confirmed consent re-check, daily cap,
 *    multipart template render with signed unsubscribe URL + RFC 8058 headers, and step advancement.
 * @param input - Complete runtime snapshot for one sequence tick.
 * @returns Gate verdict, effective cap, per-enrollment decisions, and aggregate stats.
 */
function evaluateSequenceStepRun(input) {
    const pre = checkTickPreflight(input);
    if (pre.blocked)
        return pre.blocked;
    const sortedSteps = [...input.steps].sort((a, b) => a.step_order - b.step_order);
    const stats = emptySequenceTickStats(input.enrollments.length);
    const decisions = [];
    let remaining = pre.effectiveRemainingCap;
    const canMutate = pre.armed;
    for (const enrollment of input.enrollments) {
        const decision = evaluateSingleEnrollment(enrollment, sortedSteps, input, pre.settings, remaining, canMutate);
        decisions.push(decision);
        tallyDecision(stats, decision);
        if (decision.outcome === 'eligible' || decision.outcome === 'dry_run') {
            remaining = Math.max(0, remaining - 1);
        }
    }
    return {
        blocked: false,
        httpStatus: 200,
        armed: pre.armed,
        effectiveRemainingCap: pre.effectiveRemainingCap,
        decisions,
        stats,
    };
}
