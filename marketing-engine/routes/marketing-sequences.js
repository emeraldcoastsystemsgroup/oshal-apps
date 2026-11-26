"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.6 P3 sequences with
 *     per-recipient state and strict per-sequence standing authorization routes under
 *     /api/marketing: GET/POST /sequences, GET /sequences/:id, POST /sequences/:id/steps,
 *     PUT /sequences/:id/authorization (strict boolean true/false, 428 confirm gate on arm,
 *     one-click disarm), POST /sequences/:id/disarm, POST /sequences/:id/enroll, and
 *     POST /sequences/:id/tick (re-checks consent & suppression before every step, bounds by
 *     daily cap, advances state or stops unsubscribed/unconsented). Mirrors migration
 *     007-marketing-sequences.sql at the lazy-DDL chokepoint.
 *
 * @module marketing-sequences
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSequenceSchema = ensureSequenceSchema;
exports.listSequences = listSequences;
exports.createSequence = createSequence;
exports.getSequence = getSequence;
exports.addSequenceStep = addSequenceStep;
exports.updateSequenceAuthorization = updateSequenceAuthorization;
exports.disarmSequence = disarmSequence;
exports.enrollSequenceContact = enrollSequenceContact;
exports.tickSequence = tickSequence;
exports.registerSequenceRoutes = registerSequenceRoutes;
const crypto = __importStar(require("crypto"));
const database_1 = require("@/shared/services/database");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const runtime_1 = require("@/app/connectors/runtime");
const marketing_compliance_1 = require("./marketing-compliance");
const marketing_sequence_model_1 = require("./marketing-sequence-model");
const marketing_support_1 = require("./marketing-support");
/** Lazy-DDL mirror of migrations/007-marketing-sequences.sql. */
const SEQUENCE_TABLE_DDL = [
    `CREATE TABLE IF NOT EXISTS oshal_marketing_sequences (
    sequence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trigger_form_slug TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
    standing_authorization BOOLEAN NOT NULL DEFAULT FALSE,
    daily_cap INT NOT NULL DEFAULT 0 CHECK (daily_cap BETWEEN 0 AND 5000),
    signing_secret TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_sub, slug)
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sequences_owner_updated
    ON oshal_marketing_sequences (owner_sub, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sequences_owner_trigger
    ON oshal_marketing_sequences (owner_sub, trigger_form_slug)
    WHERE trigger_form_slug IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS oshal_marketing_sequence_steps (
    step_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    sequence_id UUID NOT NULL REFERENCES oshal_marketing_sequences (sequence_id) ON DELETE CASCADE,
    step_order INT NOT NULL CHECK (step_order BETWEEN 1 AND 50),
    delay_hours INT NOT NULL DEFAULT 0 CHECK (delay_hours BETWEEN 0 AND 8760),
    template_id TEXT NOT NULL CHECK (template_id IN ('announcement','newsletter','launch')),
    subject TEXT NOT NULL,
    headline TEXT NOT NULL DEFAULT '',
    intro TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    cta_label TEXT NOT NULL DEFAULT '',
    cta_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sequence_id, step_order)
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sequence_steps_owner_seq
    ON oshal_marketing_sequence_steps (owner_sub, sequence_id, step_order ASC)`,
    `CREATE TABLE IF NOT EXISTS oshal_marketing_enrollments (
    enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    sequence_id UUID NOT NULL REFERENCES oshal_marketing_sequences (sequence_id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
    current_step_order INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
      'active','completed','stopped_unsubscribed','stopped_unconsented','paused'
    )),
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_step_at TIMESTAMPTZ,
    history JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sequence_id, contact_id)
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_enrollments_owner_due
    ON oshal_marketing_enrollments (owner_sub, sequence_id, status, next_run_at ASC)`,
];
const SEQUENCE_RLS_TABLES = [
    'oshal_marketing_sequences',
    'oshal_marketing_sequence_steps',
    'oshal_marketing_enrollments',
];
/**
 * @description Ensure the 007-marketing-sequences tables + exact-owner FORCE RLS at the lazy-DDL chokepoint.
 * @param pool - Framework pool.
 */
async function ensureSequenceSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'marketing-sequences',
        statements: [
            ...SEQUENCE_TABLE_DDL,
            ...SEQUENCE_RLS_TABLES.flatMap((table) => (0, database_1.buildOwnerRlsPolicyStatements)(table, 'owner_sub')),
        ],
        requirements: [
            { table: 'oshal_marketing_sequences', columns: ['sequence_id', 'owner_sub', 'slug', 'standing_authorization', 'daily_cap', 'signing_secret'] },
            { table: 'oshal_marketing_sequence_steps', columns: ['step_id', 'owner_sub', 'sequence_id', 'step_order', 'delay_hours', 'template_id'] },
            { table: 'oshal_marketing_enrollments', columns: ['enrollment_id', 'owner_sub', 'sequence_id', 'contact_id', 'current_step_order', 'status', 'next_run_at'] },
        ],
    });
}
/** Check whether a loaded Resend connector spec declares a `headers` parameter on `send-email`. */
function resendActionAcceptsHeaders(spec) {
    const actions = spec?.actions;
    if (!Array.isArray(actions))
        return false;
    const act = actions.find((a) => a?.name === 'send-email');
    return Boolean(act?.parameters?.properties && 'headers' in act.parameters.properties);
}
/** Format sender From header from deployment config or saved compliance identity. */
function resolveSequenceFrom(senderName, senderEmail) {
    const envFrom = (process.env.MARKETING_EMAIL_FROM || '').trim();
    if (envFrom)
        return envFrom;
    if (!senderEmail)
        return '';
    return senderName ? `${senderName} <${senderEmail}>` : senderEmail;
}
/** Count live sequence sends recorded today for one sequence. */
async function countSequenceSentToday(pool, sub, sequenceId) {
    const found = await (0, marketing_support_1.rows)(pool, `SELECT COUNT(*)::int AS n
       FROM oshal_marketing_run_ledger
      WHERE user_sub = $1
        AND channel = 'email'
        AND action = 'sequence.step'
        AND outcome = 'published'
        AND detail->>'sequenceId' = $2
        AND ts >= date_trunc('day', now())`, [sub, sequenceId]);
    return Number(found[0]?.n ?? 0);
}
/**
 * @description GET /sequences — list caller's sequences (omitting signing_secret) with step and enrollment counts (read-only).
 */
async function listSequences(ctx, sub, _req, res) {
    const found = await (0, marketing_support_1.rows)(ctx.pool, `SELECT s.sequence_id, s.slug, s.name, s.description, s.trigger_form_slug,
            s.status, s.standing_authorization, s.daily_cap, s.created_at, s.updated_at,
            COALESCE(st.step_count, 0)::int AS step_count,
            COALESCE(en.active_enrollment_count, 0)::int AS active_enrollment_count,
            COALESCE(en.total_enrollment_count, 0)::int AS total_enrollment_count
       FROM oshal_marketing_sequences s
       LEFT JOIN (
         SELECT sequence_id, COUNT(*)::int AS step_count
           FROM oshal_marketing_sequence_steps
          WHERE owner_sub = $1
          GROUP BY sequence_id
       ) st ON st.sequence_id = s.sequence_id
       LEFT JOIN (
         SELECT sequence_id,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active_enrollment_count,
                COUNT(*)::int AS total_enrollment_count
           FROM oshal_marketing_enrollments
          WHERE owner_sub = $1
          GROUP BY sequence_id
       ) en ON en.sequence_id = s.sequence_id
      WHERE s.owner_sub = $1
      ORDER BY s.updated_at DESC LIMIT 200`, [sub]);
    res.json({ sequences: found.map(marketing_sequence_model_1.sanitizeSequenceRow) });
}
/**
 * @description POST /sequences — create an owner-scoped sequence (ALWAYS standing_authorization = false on creation).
 */
async function createSequence(ctx, sub, req, res) {
    const checked = (0, marketing_sequence_model_1.normalizeSequence)(req.body ?? {});
    if (!checked.ok) {
        res.status(400).json({ error: checked.error, message: checked.message });
        return;
    }
    const s = checked.sequence;
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        const inserted = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_sequences
         (owner_sub, slug, name, description, trigger_form_slug, status, standing_authorization, daily_cap, signing_secret)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7,$8)
       RETURNING *`, [sub, s.slug, s.name, s.description, s.triggerFormSlug, s.status, s.dailyCap, secret]))[0];
        res.status(201).json({ sequence: (0, marketing_sequence_model_1.sanitizeSequenceRow)(inserted) });
    }
    catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'sequence_slug_exists', slug: s.slug });
            return;
        }
        throw err;
    }
}
/**
 * @description GET /sequences/:id — return sequence (omitting signing_secret), ordered steps, and enrollments (read-only).
 */
async function getSequence(ctx, sub, req, res) {
    const sequenceId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(sequenceId)) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const seq = (await (0, marketing_support_1.rows)(ctx.pool, `SELECT sequence_id, slug, name, description, trigger_form_slug, status,
            standing_authorization, daily_cap, created_at, updated_at
       FROM oshal_marketing_sequences
      WHERE sequence_id = $1 AND owner_sub = $2`, [sequenceId, sub]))[0];
    if (!seq) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const [steps, enrollments] = await Promise.all([
        (0, marketing_support_1.rows)(ctx.pool, `SELECT step_id, sequence_id, step_order, delay_hours, template_id, subject,
              headline, intro, body, cta_label, cta_url, created_at
         FROM oshal_marketing_sequence_steps
        WHERE sequence_id = $1 AND owner_sub = $2
        ORDER BY step_order ASC`, [sequenceId, sub]),
        (0, marketing_support_1.rows)(ctx.pool, `SELECT e.enrollment_id, e.sequence_id, e.contact_id, e.current_step_order,
              e.status, e.next_run_at, e.last_step_at, e.history, e.created_at, e.updated_at,
              c.email, c.display_name
         FROM oshal_marketing_enrollments e
         JOIN oshal_marketing_contacts c
           ON c.contact_id = e.contact_id AND c.owner_sub = e.owner_sub
        WHERE e.sequence_id = $1 AND e.owner_sub = $2
        ORDER BY e.created_at ASC`, [sequenceId, sub]),
    ]);
    res.json({ sequence: (0, marketing_sequence_model_1.sanitizeSequenceRow)(seq), steps, enrollments });
}
/**
 * @description POST /sequences/:id/steps — add an ordered step to an owner-scoped sequence.
 */
async function addSequenceStep(ctx, sub, req, res) {
    const sequenceId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(sequenceId)) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const owned = await (0, marketing_support_1.rows)(ctx.pool, 'SELECT sequence_id FROM oshal_marketing_sequences WHERE sequence_id = $1 AND owner_sub = $2', [sequenceId, sub]);
    if (!owned.length) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const checked = (0, marketing_sequence_model_1.normalizeSequenceStep)(req.body ?? {});
    if (!checked.ok) {
        res.status(400).json({ error: checked.error, message: checked.message });
        return;
    }
    const st = checked.step;
    try {
        const inserted = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_sequence_steps
         (owner_sub, sequence_id, step_order, delay_hours, template_id, subject, headline, intro, body, cta_label, cta_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`, [sub, sequenceId, st.stepOrder, st.delayHours, st.templateId, st.subject, st.headline, st.intro, st.body, st.ctaLabel, st.ctaUrl]))[0];
        res.status(201).json({ step: inserted });
    }
    catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'step_order_exists', stepOrder: st.stepOrder });
            return;
        }
        throw err;
    }
}
/**
 * @description PUT /sequences/:id/authorization — strictly arm or disarm per-sequence standing authorization.
 * Rejects garbage non-boolean values (400), requires confirm: true (428) + dailyCap >= 1 (400) to arm,
 * and allows one-click disarm (standingAuthorization: false) with no confirm gate.
 */
async function updateSequenceAuthorization(ctx, sub, req, res) {
    const sequenceId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(sequenceId)) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const existing = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_sequences WHERE sequence_id = $1 AND owner_sub = $2', [sequenceId, sub]))[0];
    if (!existing) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const parsed = (0, marketing_sequence_model_1.parseStandingAuthInput)(req.body ?? {}, Number(existing.daily_cap ?? 0));
    if (!parsed.ok) {
        if (parsed.status === 428) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('marketing-sequence', 'sequence.standing_authorization'));
            return;
        }
        res.status(parsed.status).json({ error: parsed.error, message: parsed.message });
        return;
    }
    const nextCap = parsed.dailyCap !== undefined ? parsed.dailyCap : Number(existing.daily_cap ?? 0);
    const nextStatus = parsed.standingAuthorization ? 'active' : String(existing.status || 'draft');
    const updated = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_sequences
        SET standing_authorization = $1,
            daily_cap = $2,
            status = $3,
            updated_at = now()
      WHERE sequence_id = $4 AND owner_sub = $5
      RETURNING *`, [parsed.standingAuthorization, nextCap, nextStatus, sequenceId, sub]))[0];
    await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'sequence.authorization', parsed.standingAuthorization ? 'armed' : 'disarmed', { sequenceId, dailyCap: nextCap });
    res.json({ sequence: (0, marketing_sequence_model_1.sanitizeSequenceRow)(updated) });
}
/**
 * @description POST /sequences/:id/disarm — instant one-click emergency stop (no confirm gate).
 */
async function disarmSequence(ctx, sub, req, res) {
    const sequenceId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(sequenceId)) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const updated = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_sequences
        SET standing_authorization = FALSE, updated_at = now()
      WHERE sequence_id = $1 AND owner_sub = $2
      RETURNING *`, [sequenceId, sub]))[0];
    if (!updated) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'sequence.disarm', 'disarmed', { sequenceId });
    res.json({ ok: true, disarmed: true, sequence: (0, marketing_sequence_model_1.sanitizeSequenceRow)(updated) });
}
/**
 * @description POST /sequences/:id/enroll — enroll an owner-owned confirmed, unsuppressed contact into a sequence.
 */
async function enrollSequenceContact(ctx, sub, req, res) {
    const sequenceId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(sequenceId)) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const body = (req.body ?? {});
    const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
    if (!marketing_support_1.UUID_RE.test(contactId)) {
        res.status(400).json({ error: 'invalid_contact_id' });
        return;
    }
    const [seqRows, contactRows] = await Promise.all([
        (0, marketing_support_1.rows)(ctx.pool, 'SELECT sequence_id FROM oshal_marketing_sequences WHERE sequence_id = $1 AND owner_sub = $2', [sequenceId, sub]),
        (0, marketing_support_1.rows)(ctx.pool, 'SELECT contact_id, email, email_hash, status FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]),
    ]);
    if (!seqRows.length) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const contact = contactRows[0];
    if (!contact) {
        res.status(404).json({ error: 'contact_not_found' });
        return;
    }
    const [supps, consents] = await Promise.all([
        (0, marketing_support_1.rows)(ctx.pool, "SELECT suppression_id FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = 'email' AND address_hash = $2", [sub, String(contact.email_hash).toLowerCase()]),
        (0, marketing_support_1.rows)(ctx.pool, "SELECT status FROM oshal_marketing_consents WHERE owner_sub = $1 AND contact_id = $2 AND channel = 'email' ORDER BY updated_at DESC, created_at DESC LIMIT 1", [sub, contactId]),
    ]);
    if (supps.length > 0 || contact.status === 'suppressed' || contact.status === 'unsubscribed') {
        res.status(409).json({ error: 'contact_suppressed' });
        return;
    }
    if (String(consents[0]?.status || '') !== 'confirmed') {
        res.status(409).json({ error: 'contact_unconfirmed' });
        return;
    }
    try {
        const enrolled = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_enrollments
         (owner_sub, sequence_id, contact_id, current_step_order, status, next_run_at, history)
       VALUES ($1,$2,$3,0,'active',now(),'[]'::jsonb)
       RETURNING *`, [sub, sequenceId, contactId]))[0];
        res.status(201).json({ enrollment: enrolled });
    }
    catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'already_enrolled' });
            return;
        }
        throw err;
    }
}
/** Map enrollment + latest email consent rows into pure runtime snapshots. */
function buildEnrollmentSnapshots(enrollRows, consentRows) {
    const latestConsent = new Map();
    for (const c of consentRows) {
        const cid = String(c.contact_id || '');
        if (cid && !latestConsent.has(cid))
            latestConsent.set(cid, String(c.status || ''));
    }
    return enrollRows.map((e) => ({
        enrollmentId: String(e.enrollment_id),
        contactId: String(e.contact_id),
        email: String(e.email || ''),
        emailHash: String(e.email_hash || '').toLowerCase(),
        contactStatus: String(e.contact_status || 'active'),
        emailConsentStatus: latestConsent.get(String(e.contact_id)) ?? null,
        currentStepOrder: Number(e.current_step_order ?? 0),
        status: String(e.status || 'active'),
        nextRunAt: e.next_run_at,
    }));
}
/** Load sequence enrollments joined with contacts, latest email consent, and owner suppressions. */
async function loadSequenceTickContext(pool, sub, sequenceId) {
    const [stepRows, enrollRows, consentRows, suppRows] = await Promise.all([
        (0, marketing_support_1.rows)(pool, 'SELECT step_id, step_order, delay_hours, template_id, subject, headline, intro, body, cta_label, cta_url FROM oshal_marketing_sequence_steps WHERE sequence_id = $1 AND owner_sub = $2 ORDER BY step_order ASC', [sequenceId, sub]),
        (0, marketing_support_1.rows)(pool, `SELECT e.enrollment_id, e.contact_id, e.current_step_order, e.status, e.next_run_at, c.email, c.email_hash, c.status AS contact_status FROM oshal_marketing_enrollments e JOIN oshal_marketing_contacts c ON c.contact_id = e.contact_id AND c.owner_sub = e.owner_sub WHERE e.sequence_id = $1 AND e.owner_sub = $2 AND e.status = 'active' ORDER BY e.next_run_at ASC, e.created_at ASC`, [sequenceId, sub]),
        (0, marketing_support_1.rows)(pool, "SELECT contact_id, status FROM oshal_marketing_consents WHERE owner_sub = $1 AND channel = 'email' ORDER BY updated_at DESC, created_at DESC", [sub]),
        (0, marketing_support_1.rows)(pool, "SELECT address_hash FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = 'email'", [sub]),
    ]);
    const suppressedHashes = new Set(suppRows.map((s) => String(s.address_hash || '').toLowerCase()));
    return { steps: stepRows, enrollments: buildEnrollmentSnapshots(enrollRows, consentRows), suppressedHashes };
}
/** Dispatch one eligible sequence step email via the Resend connector rail. */
async function sendStepViaResendRail(ctx, sub, spec, from, decision) {
    if (!from)
        return { ok: false, ref: null, error: 'email_from_unconfigured' };
    if (!spec || !(0, marketing_support_1.specHasAction)(spec, 'send-email'))
        return { ok: false, ref: null, error: 'channel_unavailable' };
    const params = {
        from,
        to: decision.email,
        subject: decision.subject || 'Open Swarm update',
        html: decision.html || '',
        text: decision.text || '',
    };
    if (decision.headers && resendActionAcceptsHeaders(spec)) {
        params.headers = decision.headers;
    }
    const result = await (0, runtime_1.runConnectorAction)({
        pool: ctx.pool,
        spec,
        resolveCreds: () => (0, runtime_1.resolveConnectorActionCreds)(spec, ctx.pool, sub, connectors_routes_1.getValidAccessToken),
        userSub: sub,
        actionName: 'send-email',
        params,
        requestBody: { confirm: true },
    });
    const body = (result.body ?? {});
    if (result.status === 200 && body.ok) {
        return { ok: true, ref: String(body.data?.id ?? '').trim() || null };
    }
    if (body.code === 'not_connected')
        return { ok: false, ref: null, error: 'not_connected' };
    return { ok: false, ref: null, error: body.error || 'email_rejected' };
}
/** Persist one enrollment state update and append its decision record to history. */
async function persistEnrollmentDecision(pool, sub, decision, entry, nowIso) {
    await pool.query(`UPDATE oshal_marketing_enrollments
        SET current_step_order = $1,
            status = $2,
            next_run_at = COALESCE($3::timestamptz, next_run_at),
            last_step_at = $4::timestamptz,
            history = COALESCE(history, '[]'::jsonb) || $5::jsonb,
            updated_at = now()
      WHERE enrollment_id = $6 AND owner_sub = $7`, [
        decision.nextStepOrder,
        decision.nextEnrollmentStatus,
        decision.nextRunAtIso,
        nowIso,
        JSON.stringify([entry]),
        decision.enrollmentId,
        sub,
    ]);
}
/** Apply evaluated tick decisions (live Resend send or dry-run advancement/stop). */
async function applyTickDecisions(ctx, sub, sequenceId, plan, opts) {
    const spec = opts.dryRun ? null : (0, marketing_support_1.loadSpecSafe)('resend');
    const results = [];
    for (const d of plan.decisions) {
        if (!opts.dryRun && d.outcome === 'eligible') {
            const sent = await sendStepViaResendRail(ctx, sub, spec, opts.from, d);
            if (sent.ok) {
                plan.stats.sent += 1;
                const entry = { at: opts.nowIso, stepOrder: d.stepOrder, outcome: 'sent', ref: sent.ref };
                await persistEnrollmentDecision(ctx.pool, sub, d, entry, opts.nowIso);
                await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'sequence.step', 'published', { sequenceId, stepOrder: d.stepOrder, enrollmentId: d.enrollmentId, emailHash: d.emailHash, ref: sent.ref });
                results.push({ enrollmentId: d.enrollmentId, contactId: d.contactId, email: d.email, stepOrder: d.stepOrder, outcome: 'sent', nextStatus: d.nextEnrollmentStatus, nextStepOrder: d.nextStepOrder, nextRunAt: d.nextRunAtIso, providerRef: sent.ref });
            }
            else {
                plan.stats.error += 1;
                await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'sequence.step', 'error', { sequenceId, stepOrder: d.stepOrder, enrollmentId: d.enrollmentId, emailHash: d.emailHash, error: sent.error || 'send_failed' });
                results.push({ enrollmentId: d.enrollmentId, contactId: d.contactId, email: d.email, stepOrder: d.stepOrder, outcome: 'error', error: sent.error || 'send_failed', nextStatus: 'active', nextStepOrder: d.previousStepOrder });
            }
            continue;
        }
        if (d.shouldMutate) {
            const entry = { at: opts.nowIso, stepOrder: d.stepOrder, outcome: d.outcome, reason: d.gateReason, mode: opts.dryRun ? 'dry_run' : 'live' };
            await persistEnrollmentDecision(ctx.pool, sub, d, entry, opts.nowIso);
        }
        results.push({
            enrollmentId: d.enrollmentId, contactId: d.contactId, email: d.email, stepOrder: d.stepOrder,
            outcome: d.outcome, gateReason: d.gateReason, nextStatus: d.nextEnrollmentStatus,
            nextStepOrder: d.nextStepOrder, nextRunAt: d.nextRunAtIso,
            ...(d.unsubscribeToken ? { unsubscribeToken: d.unsubscribeToken, unsubscribeUrl: d.unsubscribeUrl, headers: d.headers } : {}),
        });
    }
    return results;
}
/** Load all DB inputs and compute a deterministic sequence tick plan. */
async function buildSequenceTickPlan(ctx, sub, seq, opts) {
    const sequenceId = String(seq.sequence_id);
    const [tickCtx, channelRows, channelSentToday, sequenceSentToday, compLoaded] = await Promise.all([
        loadSequenceTickContext(ctx.pool, sub, sequenceId),
        (0, marketing_support_1.rows)(ctx.pool, "SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1 AND channel = 'email'", [sub]),
        (0, marketing_support_1.countLedgerToday)(ctx.pool, sub, 'email'),
        countSequenceSentToday(ctx.pool, sub, sequenceId),
        (0, marketing_compliance_1.loadComplianceSettings)(ctx.pool, sub),
    ]);
    const plan = (0, marketing_sequence_model_1.evaluateSequenceStepRun)({
        ownerSub: sub,
        sequence: seq,
        steps: tickCtx.steps,
        enrollments: tickCtx.enrollments,
        suppressedEmailHashes: tickCtx.suppressedHashes,
        channelRow: channelRows[0] ?? null,
        channelSentToday,
        sequenceSentToday,
        compliance: compLoaded.settings,
        dryRun: opts.dryRun,
        nowMs: opts.parsedNow,
        includeUnsubscribePreviewTokens: opts.includePreviewTokens,
    });
    return { plan, settings: compLoaded.settings };
}
/**
 * @description POST /sequences/:id/tick — run due steps for one sequence.
 * Refuses 403 sequence_disarmed when disarmed and not dryRun. When armed (or dryRun),
 * re-checks channel consent, compliance, daily cap, recipient suppression, and confirmed
 * consent before every single step.
 */
async function tickSequence(ctx, sub, req, res) {
    const sequenceId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(sequenceId)) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const seq = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_sequences WHERE sequence_id = $1 AND owner_sub = $2', [sequenceId, sub]))[0];
    if (!seq) {
        res.status(404).json({ error: 'sequence_not_found' });
        return;
    }
    const body = (req.body ?? {});
    const dryRun = body.dryRun === true;
    const includePreviewTokens = dryRun && body.includeUnsubscribePreviewTokens === true;
    const parsedNow = typeof body.nowIso === 'string' && body.nowIso.trim() ? Date.parse(body.nowIso.trim()) : Date.now();
    if (!Number.isFinite(parsedNow)) {
        res.status(400).json({ error: 'invalid_now_iso' });
        return;
    }
    const nowIso = new Date(parsedNow).toISOString();
    const { plan, settings } = await buildSequenceTickPlan(ctx, sub, seq, { dryRun, includePreviewTokens, parsedNow });
    if (plan.blocked) {
        await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'sequence.tick', plan.error || 'skipped_disarmed', { sequenceId, reason: plan.reason });
        res.status(plan.httpStatus).json({
            error: plan.error, reason: plan.reason, ...(plan.reasons ? { reasons: plan.reasons } : {}),
            armed: plan.armed, sequenceId, stats: plan.stats, decisions: [],
        });
        return;
    }
    const from = resolveSequenceFrom(settings.senderName, settings.senderEmail);
    const decisions = await applyTickDecisions(ctx, sub, sequenceId, plan, { dryRun, from, nowIso });
    res.status(200).json({
        ok: true, dryRun, armed: plan.armed, sequenceId, nowIso,
        effectiveRemainingCap: plan.effectiveRemainingCap, stats: plan.stats, decisions,
    });
}
/**
 * @description Register P3 sequence and per-sequence standing authorization routes under /api/marketing.
 * @param router - The marketing Express router.
 * @param ctx - Framework app context.
 */
function registerSequenceRoutes(router, ctx) {
    ensureSequenceSchema(ctx.pool).catch((err) => marketing_support_1.logger.error({ err }, 'Failed to ensure marketing-engine sequences schema'));
    router.get('/sequences', (0, marketing_support_1.authed)(ctx, listSequences));
    router.post('/sequences', (0, marketing_support_1.authed)(ctx, createSequence));
    router.get('/sequences/:id', (0, marketing_support_1.authed)(ctx, getSequence));
    router.post('/sequences/:id/steps', (0, marketing_support_1.authed)(ctx, addSequenceStep));
    router.put('/sequences/:id/authorization', (0, marketing_support_1.authed)(ctx, updateSequenceAuthorization));
    router.post('/sequences/:id/disarm', (0, marketing_support_1.authed)(ctx, disarmSequence));
    router.post('/sequences/:id/enroll', (0, marketing_support_1.authed)(ctx, enrollSequenceContact));
    router.post('/sequences/:id/tick', (0, marketing_support_1.authed)(ctx, tickSequence));
}
