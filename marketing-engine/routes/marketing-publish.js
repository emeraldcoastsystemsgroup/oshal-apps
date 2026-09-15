"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Publish rails and channel consent for the marketing-engine API, moved verbatim out of marketing-routes.ts at the 800-line decomposition threshold: the LinkedIn/Mastodon/Bluesky/email rails and the shared connector-action invocation behind them, the rail dispatcher, the consent→cap→confirm gate with its run-ledger outcome mapping, and the 428-gated per-channel consent PUT. Gate order, status codes, error codes and hints are unchanged.
 *
 * @module marketing-publish
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPublishRail = runPublishRail;
exports.gatePublish = gatePublish;
exports.putChannel = putChannel;
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
const runtime_1 = require("@/app/connectors/runtime");
const marketing_bluesky_operation_1 = require("./marketing-bluesky-operation");
const marketing_model_1 = require("./marketing-model");
const marketing_support_1 = require("./marketing-support");
// ---------------------------------------------------------------------------
// Publish rails (called only AFTER the consent→cap→confirm gates pass)
// ---------------------------------------------------------------------------
/** LinkedIn member share via the audited connector write action (linkedin.yaml create-post). */
async function publishLinkedIn(ctx, sub, text) {
    const spec = (0, marketing_support_1.loadSpecSafe)('linkedin');
    if (!spec || !(0, marketing_support_1.specHasAction)(spec, 'create-post')) {
        return { ok: false, status: 503, error: 'channel_unavailable', hint: 'core connector spec missing create-post' };
    }
    const conn = await (0, connector_tenancy_1.resolveConnectionRow)(ctx.pool, sub, 'linkedin');
    if (!conn || !conn.account_id)
        return { ok: false, status: 409, error: 'not_connected' };
    const params = {
        author: `urn:li:person:${conn.account_id}`,
        lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    return runSpecAction(ctx, sub, spec, 'create-post', params, 'linkedin_rejected');
}
/** Mastodon status via the connector write action (mastodon.yaml create-status, added by core). */
async function publishMastodon(ctx, sub, text) {
    const spec = (0, marketing_support_1.loadSpecSafe)('mastodon');
    if (!spec || !(0, marketing_support_1.specHasAction)(spec, 'create-status')) {
        return { ok: false, status: 503, error: 'channel_unavailable', hint: 'core connector spec missing create-status' };
    }
    return runSpecAction(ctx, sub, spec, 'create-status', { status: text }, 'mastodon_rejected');
}
/** Bluesky via the fixed in-process server operation (no declarative rail can do the exchange). */
async function publishBlueskyRail(ctx, sub, text) {
    const result = await (0, marketing_bluesky_operation_1.postToBluesky)(ctx.pool, sub, text);
    if (result.posted)
        return { ok: true, status: 200, ref: result.uri };
    if (result.error === 'bluesky_connection_unavailable')
        return { ok: false, status: 409, error: 'not_connected' };
    if (result.error === 'bluesky_text_too_long' || result.error === 'bluesky_text_required') {
        return { ok: false, status: 400, error: result.error };
    }
    return { ok: false, status: 502, error: result.error || 'bluesky_failed' };
}
/** One email via the Resend connector write action; from is deployment config, to is explicit. */
async function publishEmail(ctx, sub, item, body) {
    const from = (process.env.MARKETING_EMAIL_FROM || '').trim();
    if (!from) {
        return { ok: false, status: 503, error: 'email_from_unconfigured', hint: 'Set MARKETING_EMAIL_FROM to a verified sender address.' };
    }
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!marketing_support_1.EMAIL_RE.test(to))
        return { ok: false, status: 400, error: 'invalid_recipient', hint: 'Pass a single valid email address as "to".' };
    const spec = (0, marketing_support_1.loadSpecSafe)('resend');
    if (!spec || !(0, marketing_support_1.specHasAction)(spec, 'send-email')) {
        return { ok: false, status: 503, error: 'channel_unavailable', hint: 'core connector spec missing send-email' };
    }
    const subject = String(item.title || '').trim() || 'oshal update';
    return runSpecAction(ctx, sub, spec, 'send-email', { from, to, subject, text: String(item.body) }, 'email_rejected');
}
/** Shared connector-action invocation → RailResult (confirm:true only ever passed post-gate). */
async function runSpecAction(ctx, sub, spec, actionName, params, rejectionError) {
    const result = await (0, runtime_1.runConnectorAction)({
        pool: ctx.pool,
        spec,
        resolveCreds: () => (0, runtime_1.resolveConnectorActionCreds)(spec, ctx.pool, sub, connectors_routes_1.getValidAccessToken),
        userSub: sub,
        actionName,
        params,
        requestBody: { confirm: true },
    });
    const body = result.body;
    if (result.status === 200 && body.ok) {
        const ref = String(body.data?.id ?? body.data?.url ?? '').trim();
        return { ok: true, status: 200, ref: ref || undefined };
    }
    if (body.code === 'not_connected')
        return { ok: false, status: 409, error: 'not_connected' };
    return { ok: false, status: result.status >= 400 ? result.status : 502, error: body.error || rejectionError };
}
/**
 * @description Dispatch to the channel rail.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param item - The content row being published.
 * @param body - The request body (the email recipient is read from it).
 * @returns The rail result.
 */
async function runPublishRail(ctx, sub, item, body) {
    switch (item.channel) {
        case 'linkedin': return publishLinkedIn(ctx, sub, String(item.body));
        case 'mastodon': return publishMastodon(ctx, sub, String(item.body));
        case 'bluesky': return publishBlueskyRail(ctx, sub, String(item.body));
        case 'email': return publishEmail(ctx, sub, item, body);
        default: return { ok: false, status: 400, error: 'channel_not_publishable' };
    }
}
/** Gate outcome for the run ledger from the model's denial reason (verbatim when canonical). */
function skipOutcomeFor(reason) {
    if (reason === 'skipped_cap' || reason === 'skipped_consent')
        return reason;
    return /cap/i.test(reason) ? 'skipped_cap' : 'skipped_consent';
}
/**
 * @description The consent→cap→confirm gate (Non-negotiables order). Returns null when publishing may
 * proceed, else the refusal to send + the ledger outcome to record.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param channel - Channel being published to.
 * @param body - The request body, which carries the explicit write confirmation.
 * @returns Null when publishing may proceed, else the refusal and the ledger outcome.
 */
async function gatePublish(ctx, sub, channel, body) {
    const row = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1 AND channel = $2', [sub, channel]))[0] ?? null;
    const todayCount = await (0, marketing_support_1.countLedgerToday)(ctx.pool, sub, channel);
    const decision = (0, marketing_model_1.publishDecision)(row, todayCount);
    if (!decision.allowed) {
        const outcome = skipOutcomeFor(decision.reason);
        const reason = String(decision.detail ?? decision.reason);
        return { status: 403, payload: { error: outcome, reason }, outcome, reason };
    }
    if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
        return {
            status: 428,
            payload: (0, explicit_write_confirmation_1.confirmationRequiredPayload)('marketing-publish', `${channel}.publish`),
            outcome: 'skipped_confirm',
            reason: 'confirmation_required',
        };
    }
    return null;
}
/** Validate + normalize a PUT /channels/:channel body (explicit booleans only). */
function parseChannelBody(body) {
    const out = {};
    if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean')
            return { error: 'enabled must be a boolean' };
        out.enabled = body.enabled === true;
    }
    if (body.standingAuthorization !== undefined) {
        if (typeof body.standingAuthorization !== 'boolean')
            return { error: 'standingAuthorization must be a boolean' };
        out.standing = body.standingAuthorization === true;
    }
    if (body.dailyCap !== undefined) {
        const n = Number(body.dailyCap);
        if (!Number.isInteger(n) || n < 0 || n > 1000)
            return { error: 'dailyCap must be an integer 0-1000' };
        out.dailyCap = n;
    }
    return out;
}
/**
 * @description PUT /channels/:channel — upsert the caller's own consent row (standing enable is 428-gated).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function putChannel(ctx, sub, req, res) {
    const channel = String(req.params.channel || '');
    if (!marketing_support_1.CHANNELS.includes(channel)) {
        res.status(404).json({ error: 'unknown_channel' });
        return;
    }
    const body = (req.body ?? {});
    const parsed = parseChannelBody(body);
    if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
    }
    const cur = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1 AND channel = $2', [sub, channel]))[0] ?? { enabled: false, standing_authorization: false, daily_cap: 0 };
    const nextEnabled = parsed.enabled ?? (cur.enabled === true);
    const nextStanding = parsed.standing ?? (cur.standing_authorization === true);
    const nextCap = parsed.dailyCap ?? Number(cur.daily_cap ?? 0);
    if (parsed.standing === true) {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('marketing-channels', `${channel}.standing-authorization`));
            return;
        }
        if (nextCap < 1) {
            res.status(400).json({ error: 'daily_cap_required', hint: 'Standing authorization requires dailyCap >= 1.' });
            return;
        }
    }
    const row = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_channel_authorizations (user_sub, channel, enabled, standing_authorization, daily_cap, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (user_sub, channel) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       standing_authorization = EXCLUDED.standing_authorization,
       daily_cap = EXCLUDED.daily_cap,
       updated_at = now()
     RETURNING *`, [sub, channel, nextEnabled, nextStanding, nextCap]))[0];
    res.json({ channel: row });
}
