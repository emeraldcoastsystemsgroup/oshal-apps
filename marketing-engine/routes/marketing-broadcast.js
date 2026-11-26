"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.5 P1 broadcast
 *     pipeline, one-click unsubscribe (RFC 8058 + signed per-recipient/per-list tokens), and
 *     recipient preference routes under /api/marketing: GET/POST /broadcasts,
 *     GET /broadcasts/:id, POST /broadcasts/:id/send (full send gate chain with dry-run audit
 *     ledger and confirmed live Resend rail), POST /audience/unsubscribe (constant-time HMAC
 *     verification, immediate suppression + consent revocation + contact unsubscribed status),
 *     and GET/PUT /audience/preferences/:contactId. Mirrors migration 006-marketing-broadcasts.sql
 *     at the lazy-DDL chokepoint.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.6: support verifying
 *     sequence-minted RFC 8058 one-click unsubscribe tokens via oshal_marketing_sequences fallback
 *     when messageId references a sequence_id.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.9 (P5): stamp
 *     unsubscribed_at on matching oshal_marketing_deliveries rows when one-click unsubscribe runs
 *     so per-campaign engagement counts reflect unsubscribes automatically.
 *
 * @module marketing-broadcast
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
exports.ensureBroadcastSchema = ensureBroadcastSchema;
exports.listBroadcasts = listBroadcasts;
exports.createBroadcast = createBroadcast;
exports.getBroadcast = getBroadcast;
exports.sendBroadcast = sendBroadcast;
exports.unsubscribeOneClick = unsubscribeOneClick;
exports.getContactPreferences = getContactPreferences;
exports.updateContactPreferences = updateContactPreferences;
exports.registerBroadcastRoutes = registerBroadcastRoutes;
const crypto = __importStar(require("crypto"));
const database_1 = require("@/shared/services/database");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const runtime_1 = require("@/app/connectors/runtime");
const marketing_broadcast_model_1 = require("./marketing-broadcast-model");
const marketing_compliance_1 = require("./marketing-compliance");
const marketing_support_1 = require("./marketing-support");
/** Lazy-DDL mirror of migrations/006-marketing-broadcasts.sql. */
const BROADCAST_TABLE_DDL = [
    `CREATE TABLE IF NOT EXISTS oshal_marketing_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    campaign_id UUID REFERENCES oshal_marketing_campaigns (campaign_id) ON DELETE SET NULL,
    list_id UUID NOT NULL REFERENCES oshal_marketing_lists (list_id) ON DELETE CASCADE,
    template_id TEXT NOT NULL CHECK (template_id IN ('announcement','newsletter','launch')),
    subject TEXT NOT NULL,
    headline TEXT NOT NULL DEFAULT '',
    intro TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    cta_label TEXT NOT NULL DEFAULT '',
    cta_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','partial','blocked')),
    signing_secret TEXT NOT NULL,
    stats JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_messages_owner_updated
    ON oshal_marketing_messages (owner_sub, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS oshal_marketing_deliveries (
    delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    message_id UUID NOT NULL REFERENCES oshal_marketing_messages (message_id) ON DELETE CASCADE,
    contact_id UUID REFERENCES oshal_marketing_contacts (contact_id) ON DELETE SET NULL,
    email_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'sent','dry_run','skipped_consent','skipped_unconfirmed',
      'skipped_suppressed','skipped_compliance','skipped_cap','skipped_confirm','error'
    )),
    gate_reason TEXT NOT NULL DEFAULT '',
    provider_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_deliveries_owner_message
    ON oshal_marketing_deliveries (owner_sub, message_id, created_at DESC)`,
];
const BROADCAST_RLS_TABLES = [
    'oshal_marketing_messages',
    'oshal_marketing_deliveries',
];
/**
 * @description Ensure the 006-marketing-broadcasts tables + exact-owner FORCE RLS at the lazy-DDL chokepoint.
 * @param pool - Framework pool.
 */
async function ensureBroadcastSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'marketing-broadcast',
        statements: [
            ...BROADCAST_TABLE_DDL,
            ...BROADCAST_RLS_TABLES.flatMap((table) => (0, database_1.buildOwnerRlsPolicyStatements)(table, 'owner_sub')),
        ],
        requirements: [
            { table: 'oshal_marketing_messages', columns: ['message_id', 'owner_sub', 'list_id', 'template_id', 'signing_secret', 'status', 'stats'] },
            { table: 'oshal_marketing_deliveries', columns: ['delivery_id', 'owner_sub', 'message_id', 'contact_id', 'email_hash', 'status', 'gate_reason'] },
        ],
    });
}
/** Run work inside a DB transaction when the pool supports connect(), or directly on query-only pools. */
async function withOptionalTransaction(pool, work) {
    const connectable = pool;
    if (typeof connectable.connect !== 'function')
        return work(pool);
    const client = await connectable.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        try {
            await client.query('ROLLBACK');
        }
        catch { /* rollback best-effort */ }
        throw err;
    }
    finally {
        client.release();
    }
}
/** Extract an unsubscribe token from JSON body or query string without calling req.is(). */
function extractUnsubscribeToken(req) {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body : {});
    if (typeof body.token === 'string' && body.token.trim())
        return body.token.trim();
    if (typeof req.query?.token === 'string' && req.query.token.trim())
        return req.query.token.trim();
    return '';
}
/** Format sender From header from deployment config or saved compliance identity. */
function resolveBroadcastFrom(senderName, senderEmail) {
    const envFrom = (process.env.MARKETING_EMAIL_FROM || '').trim();
    if (envFrom)
        return envFrom;
    if (!senderEmail)
        return '';
    return senderName ? `${senderName} <${senderEmail}>` : senderEmail;
}
/** Check whether a loaded Resend connector spec declares a `headers` parameter on `send-email`. */
function resendActionAcceptsHeaders(spec) {
    const actions = spec?.actions;
    if (!Array.isArray(actions))
        return false;
    const act = actions.find((a) => a?.name === 'send-email');
    return Boolean(act?.parameters?.properties && 'headers' in act.parameters.properties);
}
/**
 * @description GET /broadcasts — list caller's broadcast messages (omitting signing_secret) with stats (read-only).
 */
async function listBroadcasts(ctx, sub, _req, res) {
    const found = await (0, marketing_support_1.rows)(ctx.pool, `SELECT message_id, campaign_id, list_id, template_id, subject, headline, intro, body,
            cta_label, cta_url, status, stats, created_at, updated_at
       FROM oshal_marketing_messages
      WHERE owner_sub = $1
      ORDER BY updated_at DESC LIMIT 200`, [sub]);
    res.json({ broadcasts: found.map(marketing_broadcast_model_1.sanitizeBroadcastRow) });
}
/**
 * @description POST /broadcasts — create an owner-scoped broadcast draft targeting an owned list.
 */
async function createBroadcast(ctx, sub, req, res) {
    const checked = (0, marketing_broadcast_model_1.normalizeBroadcastDraft)(req.body ?? {});
    if (!checked.ok) {
        res.status(400).json({ error: checked.error, message: checked.message });
        return;
    }
    const d = checked.draft;
    const ownedList = await (0, marketing_support_1.rows)(ctx.pool, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [d.listId, sub]);
    if (!ownedList.length) {
        res.status(404).json({ error: 'list_not_found', listId: d.listId });
        return;
    }
    if (d.campaignId && !(await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, d.campaignId))) {
        res.status(404).json({ error: 'campaign_not_found', campaignId: d.campaignId });
        return;
    }
    const secret = crypto.randomBytes(32).toString('hex');
    const inserted = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_messages
       (owner_sub, campaign_id, list_id, template_id, subject, headline, intro, body, cta_label, cta_url, status, signing_secret, stats)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,'{}'::jsonb)
     RETURNING *`, [sub, d.campaignId, d.listId, d.templateId, d.subject, d.headline, d.intro, d.body, d.ctaLabel, d.ctaUrl, secret]))[0];
    res.status(201).json({ broadcast: (0, marketing_broadcast_model_1.sanitizeBroadcastRow)(inserted) });
}
/**
 * @description GET /broadcasts/:id — return broadcast metadata (omitting signing_secret) and its per-recipient delivery ledger (read-only).
 */
async function getBroadcast(ctx, sub, req, res) {
    const messageId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(messageId)) {
        res.status(404).json({ error: 'broadcast_not_found' });
        return;
    }
    const msg = (await (0, marketing_support_1.rows)(ctx.pool, `SELECT message_id, campaign_id, list_id, template_id, subject, headline, intro, body,
            cta_label, cta_url, status, stats, created_at, updated_at
       FROM oshal_marketing_messages
      WHERE message_id = $1 AND owner_sub = $2`, [messageId, sub]))[0];
    if (!msg) {
        res.status(404).json({ error: 'broadcast_not_found' });
        return;
    }
    const deliveries = await (0, marketing_support_1.rows)(ctx.pool, `SELECT delivery_id, message_id, contact_id, email_hash, status, gate_reason, provider_ref, created_at
       FROM oshal_marketing_deliveries
      WHERE message_id = $1 AND owner_sub = $2
      ORDER BY created_at ASC`, [messageId, sub]);
    res.json({ broadcast: (0, marketing_broadcast_model_1.sanitizeBroadcastRow)(msg), deliveries });
}
/** Load list recipients with their latest email consent status and owner suppressions. */
async function loadListRecipientsAndSuppressions(pool, sub, listId) {
    const [memberContacts, consentRows, suppRows] = await Promise.all([
        (0, marketing_support_1.rows)(pool, `SELECT c.contact_id, c.email, c.email_hash, c.display_name, c.status
         FROM oshal_marketing_list_members m
         JOIN oshal_marketing_contacts c
           ON c.contact_id = m.contact_id AND c.owner_sub = m.owner_sub
        WHERE m.list_id = $1 AND m.owner_sub = $2
        ORDER BY m.added_at ASC, c.contact_id ASC`, [listId, sub]),
        (0, marketing_support_1.rows)(pool, `SELECT contact_id, status
         FROM oshal_marketing_consents
        WHERE owner_sub = $1 AND channel = 'email'
        ORDER BY updated_at DESC, created_at DESC`, [sub]),
        (0, marketing_support_1.rows)(pool, "SELECT address_hash FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = 'email'", [sub]),
    ]);
    const latestConsent = new Map();
    for (const c of consentRows) {
        const cid = String(c.contact_id || '');
        if (cid && !latestConsent.has(cid))
            latestConsent.set(cid, String(c.status || ''));
    }
    const recipients = memberContacts.map((c) => ({
        contactId: String(c.contact_id),
        email: String(c.email || ''),
        emailHash: String(c.email_hash || '').toLowerCase(),
        displayName: String(c.display_name || ''),
        contactStatus: String(c.status || 'active'),
        emailConsentStatus: latestConsent.get(String(c.contact_id)) ?? null,
    }));
    const suppressedHashes = new Set(suppRows.map((s) => String(s.address_hash || '').toLowerCase()));
    return { recipients, suppressedHashes };
}
/** Persist a broadcast run's per-recipient delivery rows and update message status/stats. */
async function persistBroadcastLedger(pool, sub, messageId, nextStatus, stats, ledgerRows) {
    return withOptionalTransaction(pool, async (q) => {
        await q.query("DELETE FROM oshal_marketing_deliveries WHERE owner_sub = $1 AND message_id = $2 AND status <> 'sent'", [sub, messageId]);
        const saved = [];
        for (const row of ledgerRows) {
            const inserted = (await (0, marketing_support_1.rows)(q, `INSERT INTO oshal_marketing_deliveries
           (owner_sub, message_id, contact_id, email_hash, status, gate_reason, provider_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING delivery_id, message_id, contact_id, email_hash, status, gate_reason, provider_ref, created_at`, [sub, messageId, row.contactId, row.emailHash, row.status, row.gateReason, row.providerRef]))[0];
            if (inserted)
                saved.push(inserted);
        }
        await q.query(`UPDATE oshal_marketing_messages
          SET status = $1, stats = $2::jsonb, updated_at = now()
        WHERE message_id = $3 AND owner_sub = $4`, [nextStatus, JSON.stringify(stats), messageId, sub]);
        return saved;
    });
}
/** Dispatch one eligible broadcast email through the Resend connector rail (honest degradation when unconnected). */
async function sendViaResendRail(ctx, sub, spec, from, decision) {
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
        const ref = String(body.data?.id ?? '').trim() || null;
        return { ok: true, ref };
    }
    if (body.code === 'not_connected')
        return { ok: false, ref: null, error: 'not_connected' };
    return { ok: false, ref: null, error: body.error || 'email_rejected' };
}
/** Execute live confirmed deliveries for every eligible recipient and return ledger rows + final message status. */
async function executeLiveDeliveries(ctx, sub, decisions, stats, from) {
    const spec = (0, marketing_support_1.loadSpecSafe)('resend');
    const ledgerRows = [];
    for (const d of decisions) {
        if (d.status !== 'eligible') {
            ledgerRows.push({ contactId: d.contactId, emailHash: d.emailHash, status: d.status, gateReason: d.gateReason, providerRef: null });
            continue;
        }
        const sent = await sendViaResendRail(ctx, sub, spec, from, d);
        if (sent.ok) {
            stats.sent += 1;
            ledgerRows.push({ contactId: d.contactId, emailHash: d.emailHash, status: 'sent', gateReason: 'sent', providerRef: sent.ref });
            await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'broadcast.send', 'published', { emailHash: d.emailHash, ref: sent.ref });
        }
        else {
            stats.error += 1;
            ledgerRows.push({ contactId: d.contactId, emailHash: d.emailHash, status: 'error', gateReason: sent.error || 'send_failed', providerRef: null });
            await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'broadcast.send', 'error', { emailHash: d.emailHash, error: sent.error || 'send_failed' });
        }
    }
    const nextStatus = stats.sent > 0
        ? (stats.error > 0 ? 'partial' : 'sent')
        : 'blocked';
    return { ledgerRows, nextStatus };
}
/** Build a broadcast gate plan from DB state for one owner-owned message row. */
async function buildPlanForMessage(ctx, sub, msg, opts) {
    const [channelRows, sentToday, compLoaded, audience] = await Promise.all([
        (0, marketing_support_1.rows)(ctx.pool, "SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1 AND channel = 'email'", [sub]),
        (0, marketing_support_1.countLedgerToday)(ctx.pool, sub, 'email'),
        (0, marketing_compliance_1.loadComplianceSettings)(ctx.pool, sub),
        loadListRecipientsAndSuppressions(ctx.pool, sub, String(msg.list_id)),
    ]);
    const plan = (0, marketing_broadcast_model_1.planBroadcastDeliveries)({
        ownerSub: sub,
        message: {
            messageId: String(msg.message_id),
            listId: String(msg.list_id),
            templateId: msg.template_id,
            subject: String(msg.subject || ''),
            headline: String(msg.headline || ''),
            intro: String(msg.intro || ''),
            body: String(msg.body || ''),
            ctaLabel: String(msg.cta_label || ''),
            ctaUrl: String(msg.cta_url || ''),
            signingSecret: String(msg.signing_secret || ''),
        },
        channelRow: channelRows[0] ?? null,
        sentToday,
        compliance: compLoaded.settings,
        recipients: audience.recipients,
        suppressedEmailHashes: audience.suppressedHashes,
        dryRun: opts.dryRun,
        confirmed: opts.confirmed,
        includeUnsubscribePreviewTokens: opts.includePreviewTokens,
    });
    return { plan, settings: compLoaded.settings };
}
/** Persist and respond for a preflight-blocked broadcast (consent, cap, or compliance). */
async function respondBlockedBroadcast(ctx, sub, messageId, plan, res) {
    const ledgerInput = plan.decisions.length > 0
        ? plan.decisions.map((d) => ({ contactId: d.contactId, emailHash: d.emailHash, status: d.status, gateReason: d.gateReason, providerRef: null }))
        : [{ contactId: null, emailHash: '', status: plan.error || 'skipped_consent', gateReason: plan.reason || 'blocked', providerRef: null }];
    const saved = await persistBroadcastLedger(ctx.pool, sub, messageId, 'blocked', plan.stats, ledgerInput);
    await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'broadcast.send', plan.error || 'skipped_consent', { messageId, reason: plan.reason });
    res.status(plan.httpStatus).json({
        error: plan.error, reason: plan.reason, ...(plan.reasons ? { reasons: plan.reasons } : {}),
        messageId, status: 'blocked', stats: plan.stats, deliveries: saved,
    });
}
/** Persist and respond for a dry-run broadcast audit (writes dry_run + skipped_* without Resend). */
async function respondDryRunBroadcast(ctx, sub, msg, plan, includePreviewTokens, res) {
    const messageId = String(msg.message_id);
    const ledgerInput = plan.decisions.map((d) => ({
        contactId: d.contactId, emailHash: d.emailHash,
        status: d.status === 'eligible' ? 'dry_run' : d.status, gateReason: d.gateReason, providerRef: null,
    }));
    const nextStatus = msg.status === 'approved' ? 'approved' : 'draft';
    const saved = await persistBroadcastLedger(ctx.pool, sub, messageId, nextStatus, plan.stats, ledgerInput);
    const previewTokens = includePreviewTokens
        ? plan.decisions.filter((d) => d.status === 'eligible' && d.unsubscribeToken).map((d) => ({
            contactId: d.contactId, email: d.email, emailHash: d.emailHash,
            unsubscribeUrl: d.unsubscribeUrl, unsubscribeToken: d.unsubscribeToken, headers: d.headers,
        }))
        : undefined;
    res.status(200).json({
        ok: true, dryRun: true, messageId, status: nextStatus, stats: plan.stats, deliveries: saved,
        ...(previewTokens ? { previewTokens } : {}),
    });
}
/**
 * @description POST /broadcasts/:id/send — run the full P1 broadcast send gate chain.
 * Supports `{ dryRun: true }` (writes dry_run + skipped_* audit rows without calling Resend)
 * and confirmed live sends `{ confirm: true }` (refuses 428 without confirm: true).
 */
async function sendBroadcast(ctx, sub, req, res) {
    const messageId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(messageId)) {
        res.status(404).json({ error: 'broadcast_not_found' });
        return;
    }
    const msg = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_messages WHERE message_id = $1 AND owner_sub = $2', [messageId, sub]))[0];
    if (!msg) {
        res.status(404).json({ error: 'broadcast_not_found' });
        return;
    }
    if (msg.status === 'sent') {
        res.status(409).json({ error: 'broadcast_already_sent' });
        return;
    }
    const body = (req.body ?? {});
    const dryRun = body.dryRun === true;
    const confirmed = (0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body);
    const includePreviewTokens = dryRun && body.includeUnsubscribePreviewTokens === true;
    const { plan, settings } = await buildPlanForMessage(ctx, sub, msg, { dryRun, confirmed, includePreviewTokens });
    if (plan.blocked && plan.httpStatus === 428) {
        await (0, marketing_support_1.recordRun)(ctx.pool, sub, 'email', 'broadcast.send', 'skipped_confirm', { messageId, reason: 'confirmation_required' });
        res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('marketing-broadcast', 'email.broadcast'));
        return;
    }
    if (plan.blocked) {
        await respondBlockedBroadcast(ctx, sub, messageId, plan, res);
        return;
    }
    if (dryRun) {
        await respondDryRunBroadcast(ctx, sub, msg, plan, includePreviewTokens, res);
        return;
    }
    const from = resolveBroadcastFrom(settings.senderName, settings.senderEmail);
    const { ledgerRows, nextStatus } = await executeLiveDeliveries(ctx, sub, plan.decisions, plan.stats, from);
    const saved = await persistBroadcastLedger(ctx.pool, sub, messageId, nextStatus, plan.stats, ledgerRows);
    res.status(200).json({ ok: true, dryRun: false, messageId, status: nextStatus, stats: plan.stats, deliveries: saved });
}
/** Atomically suppress email_hash, revoke email consents, and mark contact unsubscribed. */
async function persistOneClickUnsubscribe(pool, sub, payload, revokedAt) {
    const patchEvidence = JSON.stringify({
        revokedAt, revokedVia: 'one_click_unsubscribe', listId: payload.listId, messageId: payload.messageId ?? null,
    });
    return withOptionalTransaction(pool, async (q) => {
        const suppression = (await (0, marketing_support_1.rows)(q, `INSERT INTO oshal_marketing_suppressions (owner_sub, channel, address_hash, reason, source)
       VALUES ($1,'email',$2,'one_click_unsubscribe','rfc8058')
       ON CONFLICT (owner_sub, channel, address_hash)
       DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source
       RETURNING *`, [sub, payload.emailHash]))[0];
        const updConsents = await q.query(`UPDATE oshal_marketing_consents
          SET status = 'revoked', evidence = COALESCE(evidence, '{}'::jsonb) || $3::jsonb, updated_at = now()
        WHERE owner_sub = $1 AND contact_id = $2 AND channel = 'email' AND status <> 'revoked'`, [sub, payload.contactId, patchEvidence]);
        await q.query(`UPDATE oshal_marketing_contacts
          SET status = 'unsubscribed', updated_at = now()
        WHERE owner_sub = $1 AND (contact_id = $2 OR email_hash = $3)`, [sub, payload.contactId, payload.emailHash]);
        return { suppression, revokedConsents: Number(updConsents.rowCount ?? 0) };
    });
}
/**
 * @description POST /audience/unsubscribe — RFC 8058 one-click unsubscribe handler.
 * Verifies signed per-recipient/per-list HMAC-SHA256 token (fail-closed 400 unsubscribe_token_forged),
 * atomically suppresses email_hash, revokes active email consents with evidence, and marks contact unsubscribed.
 */
async function unsubscribeOneClick(ctx, sub, req, res) {
    const rawToken = extractUnsubscribeToken(req);
    const decoded = (0, marketing_broadcast_model_1.decodeUnsubscribeTokenUnverified)(rawToken);
    if (!decoded || decoded.ownerSub !== sub || !decoded.messageId) {
        res.status(400).json({ error: 'unsubscribe_token_forged' });
        return;
    }
    let secretRow = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT message_id, signing_secret FROM oshal_marketing_messages WHERE message_id = $1 AND owner_sub = $2', [decoded.messageId, sub]))[0];
    if (!secretRow) {
        try {
            secretRow = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT sequence_id, signing_secret FROM oshal_marketing_sequences WHERE sequence_id = $1 AND owner_sub = $2', [decoded.messageId, sub]))[0];
        }
        catch { /* sequences table may be absent in isolated broadcast mocks */ }
    }
    if (!secretRow) {
        res.status(400).json({ error: 'unsubscribe_token_forged' });
        return;
    }
    const verified = (0, marketing_broadcast_model_1.verifyUnsubscribeToken)(rawToken, String(secretRow.signing_secret || ''), sub);
    if (!verified.ok) {
        res.status(400).json({ error: verified.error });
        return;
    }
    const revokedAt = new Date().toISOString();
    const outcome = await persistOneClickUnsubscribe(ctx.pool, sub, verified.payload, revokedAt);
    try {
        await ctx.pool.query(`UPDATE oshal_marketing_deliveries
          SET unsubscribed_at = COALESCE(unsubscribed_at, $4::timestamptz)
        WHERE owner_sub = $1 AND message_id = $2 AND (contact_id = $3 OR email_hash = $5)`, [sub, verified.payload.messageId, verified.payload.contactId, revokedAt, verified.payload.emailHash]);
    }
    catch { /* 010 engagement columns may be absent in isolated broadcast mocks */ }
    res.status(200).json({
        ok: true, unsubscribed: true, suppressed: true,
        contactId: verified.payload.contactId, listId: verified.payload.listId, emailHash: verified.payload.emailHash,
        revokedConsents: outcome.revokedConsents, revokedAt, suppression: outcome.suppression,
    });
}
/** Load one owner-scoped contact's preference snapshot (list memberships + channel suppression/consent state). */
async function loadPreferencesSnapshot(pool, sub, contactId) {
    if (!marketing_support_1.UUID_RE.test(contactId))
        return null;
    const contact = (await (0, marketing_support_1.rows)(pool, 'SELECT contact_id, email, email_hash, display_name, status FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]))[0];
    if (!contact)
        return null;
    const [consents, memberships, allLists, suppressions] = await Promise.all([
        (0, marketing_support_1.rows)(pool, 'SELECT channel, purpose, status, updated_at FROM oshal_marketing_consents WHERE contact_id = $1 AND owner_sub = $2 ORDER BY updated_at DESC, created_at DESC', [contactId, sub]),
        (0, marketing_support_1.rows)(pool, 'SELECT list_id, added_at FROM oshal_marketing_list_members WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]),
        (0, marketing_support_1.rows)(pool, 'SELECT list_id, slug, name FROM oshal_marketing_lists WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT 200', [sub]),
        (0, marketing_support_1.rows)(pool, 'SELECT suppression_id, channel, reason, source, created_at FROM oshal_marketing_suppressions WHERE address_hash = $1 AND owner_sub = $2', [String(contact.email_hash), sub]),
    ]);
    const memberSet = new Set(memberships.map((m) => String(m.list_id)));
    const channelState = (ch) => ({
        consentStatus: consents.find((c) => c.channel === ch)?.status ?? 'none',
        suppressed: suppressions.some((s) => s.channel === ch),
    });
    return {
        contact,
        lists: allLists.map((l) => ({ list_id: l.list_id, slug: l.slug, name: l.name, subscribed: memberSet.has(String(l.list_id)) })),
        channels: { email: channelState('email'), sms: channelState('sms') },
        suppressions,
    };
}
/**
 * @description GET /audience/preferences/:contactId — read owner-scoped contact preferences (read-only).
 */
async function getContactPreferences(ctx, sub, req, res) {
    const contactId = String(req.params.contactId || '');
    const snapshot = await loadPreferencesSnapshot(ctx.pool, sub, contactId);
    if (!snapshot) {
        res.status(404).json({ error: 'contact_not_found' });
        return;
    }
    res.json(snapshot);
}
/** Apply an explicit channel opt-out inside a preferences transaction (suppression + consent revocation). */
async function applyPreferenceOptOut(q, sub, contact, channel) {
    const patch = JSON.stringify({ revokedAt: new Date().toISOString(), revokedVia: 'preference_update' });
    await q.query(`INSERT INTO oshal_marketing_suppressions (owner_sub, channel, address_hash, reason, source)
     VALUES ($1,$2,$3,'preference_opt_out','preferences')
     ON CONFLICT (owner_sub, channel, address_hash)
     DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source`, [sub, channel, contact.email_hash]);
    await q.query(`UPDATE oshal_marketing_consents
        SET status = 'revoked', evidence = COALESCE(evidence, '{}'::jsonb) || $4::jsonb, updated_at = now()
      WHERE owner_sub = $1 AND contact_id = $2 AND channel = $3 AND status <> 'revoked'`, [sub, contact.contact_id, channel, patch]);
    if (channel === 'email') {
        await q.query("UPDATE oshal_marketing_contacts SET status = 'unsubscribed', updated_at = now() WHERE owner_sub = $1 AND contact_id = $2", [sub, contact.contact_id]);
    }
}
/** Replace one owner-scoped contact's list memberships after validating every target list belongs to the owner. */
async function syncContactListMemberships(q, sub, contactId, uniqueIds) {
    for (const lid of uniqueIds) {
        const owned = await (0, marketing_support_1.rows)(q, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [lid, sub]);
        if (!owned.length)
            return lid;
    }
    await q.query('DELETE FROM oshal_marketing_list_members WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]);
    for (const lid of uniqueIds) {
        await q.query('INSERT INTO oshal_marketing_list_members (owner_sub, list_id, contact_id) VALUES ($1,$2,$3) ON CONFLICT (list_id, contact_id) DO NOTHING', [sub, lid, contactId]);
    }
    return null;
}
/**
 * @description PUT /audience/preferences/:contactId — update owner-scoped list memberships and channel opt-outs.
 */
async function updateContactPreferences(ctx, sub, req, res) {
    const contactId = String(req.params.contactId || '');
    if (!marketing_support_1.UUID_RE.test(contactId)) {
        res.status(404).json({ error: 'contact_not_found' });
        return;
    }
    const body = (req.body ?? {});
    const listIdsProvided = Array.isArray(body.listIds);
    const rawListIds = listIdsProvided ? body.listIds : [];
    if (listIdsProvided && (rawListIds.length > 50 || rawListIds.some((id) => typeof id !== 'string' || !marketing_support_1.UUID_RE.test(id)))) {
        res.status(400).json({ error: 'invalid_list_id' });
        return;
    }
    const channelsObj = (body.channels && typeof body.channels === 'object' ? body.channels : {});
    const emailOptOut = body.emailOptOut === true || channelsObj.email?.optOut === true;
    const smsOptOut = body.smsOptOut === true || channelsObj.sms?.optOut === true;
    const result = await withOptionalTransaction(ctx.pool, async (q) => {
        const contact = (await (0, marketing_support_1.rows)(q, 'SELECT contact_id, email_hash FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]))[0];
        if (!contact)
            return { error: 'contact_not_found' };
        if (listIdsProvided) {
            const missing = await syncContactListMemberships(q, sub, contactId, [...new Set(rawListIds)]);
            if (missing)
                return { error: 'list_not_found', listId: missing };
        }
        if (emailOptOut)
            await applyPreferenceOptOut(q, sub, contact, 'email');
        if (smsOptOut)
            await applyPreferenceOptOut(q, sub, contact, 'sms');
        return { ok: true };
    });
    if ('error' in result) {
        res.status(404).json({ error: result.error, ...('listId' in result ? { listId: result.listId } : {}) });
        return;
    }
    const snapshot = await loadPreferencesSnapshot(ctx.pool, sub, contactId);
    res.json(snapshot);
}
/**
 * @description Register P1 broadcast pipeline, one-click unsubscribe, and preference routes under /api/marketing.
 * @param router - The marketing Express router.
 * @param ctx - Framework app context.
 */
function registerBroadcastRoutes(router, ctx) {
    ensureBroadcastSchema(ctx.pool).catch((err) => marketing_support_1.logger.error({ err }, 'Failed to ensure marketing-engine broadcast schema'));
    router.get('/broadcasts', (0, marketing_support_1.authed)(ctx, listBroadcasts));
    router.post('/broadcasts', (0, marketing_support_1.authed)(ctx, createBroadcast));
    router.get('/broadcasts/:id', (0, marketing_support_1.authed)(ctx, getBroadcast));
    router.post('/broadcasts/:id/send', (0, marketing_support_1.authed)(ctx, sendBroadcast));
    router.post('/audience/unsubscribe', (0, marketing_support_1.authed)(ctx, unsubscribeOneClick));
    router.get('/audience/preferences/:contactId', (0, marketing_support_1.authed)(ctx, getContactPreferences));
    router.put('/audience/preferences/:contactId', (0, marketing_support_1.authed)(ctx, updateContactPreferences));
}
