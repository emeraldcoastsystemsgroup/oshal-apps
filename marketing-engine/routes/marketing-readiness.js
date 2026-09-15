"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Readiness probes for the Marketing Suite setup dashboard (ADR-141): first campaign, an armed channel, and a configured sender. Each answers from THIS package's own owner-scoped store in the signed-in caller's session — a group step is done only when the member says so. Deterministic and read-only: no connector call, no model, no write. "Armed" deliberately means enabled AND a daily cap of at least one, because a cap of zero means never — an enabled channel with cap 0 is the trap this probe exists to surface.
 *
 * @module marketing-readiness
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMarketingReadiness = readMarketingReadiness;
exports.createMarketingReadinessRoutes = createMarketingReadinessRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
const logger = (0, logger_1.createChildLogger)({ module: 'marketing-readiness' });
/** The signed-in caller's subject, or null (the same gate the rest of the package uses). */
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
/** Count the caller's campaigns; a missing table reads as zero rather than throwing. */
async function campaignProbe(ctx, sub) {
    try {
        const result = await ctx.pool.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE status = $2)::int AS active FROM oshal_marketing_campaigns WHERE user_sub = $1', [sub, 'active']);
        const total = Number(result.rows[0]?.total ?? 0);
        const active = Number(result.rows[0]?.active ?? 0);
        if (total === 0)
            return { ready: false, detail: 'No campaign yet — the board is where a campaign starts.' };
        return { ready: true, detail: `${total} campaign${total === 1 ? '' : 's'}, ${active} active.` };
    }
    catch (err) {
        logger.error({ err }, 'marketing readiness: campaign probe failed');
        return { ready: false, detail: 'Campaigns cannot be read right now.' };
    }
}
/** A channel counts as armed only when it is enabled AND its daily cap is at least one. */
async function channelProbe(ctx, sub) {
    try {
        const result = await ctx.pool.query(`SELECT channel, enabled, daily_cap FROM oshal_marketing_channel_authorizations
       WHERE user_sub = $1 ORDER BY channel`, [sub]);
        const armed = result.rows.filter((row) => row.enabled === true && Number(row.daily_cap ?? 0) > 0);
        const enabledNoCap = result.rows.filter((row) => row.enabled === true && Number(row.daily_cap ?? 0) === 0);
        if (armed.length > 0) {
            return { ready: true, detail: `Armed: ${armed.map((row) => String(row.channel)).join(', ')}.` };
        }
        if (enabledNoCap.length > 0) {
            return {
                ready: false,
                detail: `${enabledNoCap.map((row) => String(row.channel)).join(', ')} turned on with a daily cap of 0 — a cap of zero means nothing ever sends.`,
            };
        }
        return { ready: false, detail: 'Every channel is off. Turning one on takes a channel and a daily cap.' };
    }
    catch (err) {
        logger.error({ err }, 'marketing readiness: channel probe failed');
        return { ready: false, detail: 'Channel consent cannot be read right now.' };
    }
}
/** Email needs both halves: the deployment's verified From address and the caller's own Resend connection. */
async function senderProbe(ctx, sub) {
    const from = (process.env.MARKETING_EMAIL_FROM || '').trim();
    let connected = false;
    try {
        connected = Boolean(await (0, connector_tenancy_1.resolveConnectionRow)(ctx.pool, sub, 'resend'));
    }
    catch (err) {
        logger.error({ err }, 'marketing readiness: sender connection lookup failed');
        return { ready: false, detail: 'The sending connection cannot be read right now.' };
    }
    if (from && connected)
        return { ready: true, detail: 'Sender address set and Resend connected.' };
    if (!from && !connected)
        return { ready: false, detail: 'No sender address set and Resend is not connected.' };
    if (!from)
        return { ready: false, detail: 'Resend is connected, but no sender address is set on this deployment.' };
    return { ready: false, detail: 'A sender address is set, but Resend is not connected for you.' };
}
/**
 * @description Read all three probes for one owner. Every probe degrades to not-ready with a
 * readable reason rather than throwing, so one unavailable table cannot blank the setup page.
 * @param ctx - Framework context (the controller pool)
 * @param sub - The signed-in caller's subject
 * @returns The probe set declared in the manifest's `readiness:` block
 */
async function readMarketingReadiness(ctx, sub) {
    const [campaign, channels, sender] = await Promise.all([
        campaignProbe(ctx, sub),
        channelProbe(ctx, sub),
        senderProbe(ctx, sub),
    ]);
    return { campaign, channels, sender };
}
/**
 * @description Mount the readiness probes the Marketing Suite group's setup dashboard reads.
 * Answers 401 without a session subject; every probe is scoped to that subject, so one owner's
 * setup can never report another owner's progress. Read-only.
 * @param ctx - Framework context (the controller pool)
 * @returns Router exposing GET /
 */
function createMarketingReadinessRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.json(await readMarketingReadiness(ctx, sub));
    });
    return router;
}
