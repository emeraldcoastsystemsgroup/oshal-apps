"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAutomationSettings = readAutomationSettings;
exports.readAutomationSettingsSystem = readAutomationSettingsSystem;
exports.registerCareerAutomationRoutes = registerCareerAutomationRoutes;
const logger_1 = require("@/shared/logger");
const request_identity_1 = require("@/shared/services/database/request-identity");
const career_user_store_1 = require("./career-user-store");
// Pure default-deny gate, shared with the node:test guard (compiled file lives in
// routes/, so lib/ is a sibling directory — same resolution the apply-prompt bridge uses).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require('../lib/automation-gate');
const logger = (0, logger_1.createChildLogger)({ module: 'career-automation' });
/** Longest issuer the kernel's callback principal contract accepts. */
const MAX_ISSUER_LENGTH = 2048;
/** The saving request's verified issuer, as the kernel established it; never a request field. */
function callerIssuer() {
    const issuer = (0, request_identity_1.getRequestIdentity)()?.principalIssuer;
    return typeof issuer === 'string' && issuer.length > 0 && issuer.length <= MAX_ISSUER_LENGTH ? issuer : null;
}
/**
 * @description Read the user's automation opt-in row under the CALLER's identity (route
 * context — the GUC'd pool sees the caller's own row). Absent row → both flags false.
 * @param ctx app context (GUC-wrapped pool)
 * @param userSub the user to read
 * @returns the user's automation settings, default-deny
 */
async function readAutomationSettings(ctx, userSub) {
    const r = await ctx.pool.query(`SELECT auto_generate, auto_submit, owner_issuer FROM career_automation_settings WHERE user_sub=$1`, [userSub]);
    const row = r.rows[0];
    const issuer = row?.owner_issuer;
    return {
        autoGenerate: gate.autoGenerateAllowed(row),
        autoSubmit: gate.autoSubmitAllowed(row),
        ownerIssuer: typeof issuer === 'string' && issuer.length > 0 ? issuer : null,
    };
}
/**
 * @description Cron-path read: the cron runs OUTSIDE any request, so an un-scoped query on
 * the FORCE-RLS settings table returns no row — safe (automation stays off) but it would
 * also make a real opt-in unenforceable from the cron. runWithSystemIdentity is the
 * positive trusted marker for platform-originated reads (same pattern as remote-task cost
 * capture). Still default-deny: absent row → false.
 * @param ctx app context
 * @param userSub the user to read
 * @returns the user's automation settings, default-deny
 */
async function readAutomationSettingsSystem(ctx, userSub) {
    return (0, request_identity_1.runWithSystemIdentity)(() => readAutomationSettings(ctx, userSub));
}
/**
 * @description Settings routes for the Career Settings card (parent mount already
 * auth-gates): GET /automation/state reads the caller's own flags; POST /settings/automation
 * saves them. Opt-in requires the EXPLICIT boolean true — anything else saves false.
 * @param router the career-hunter router
 * @param ctx app context
 * @returns nothing
 */
function registerCareerAutomationRoutes(router, ctx) {
    router.get('/automation/state', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        res.json(await readAutomationSettings(ctx, userSub));
    });
    router.post('/settings/automation', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        // Explicit true or nothing — a missing/garbage field always lands false.
        const autoGenerate = req.body?.autoGenerate === true;
        const autoSubmit = req.body?.autoSubmit === true;
        // The issuer the nightly chain will mint this owner's callback grants for: the kernel's
        // verified identity for THIS request. A save with no verified issuer records none.
        const ownerIssuer = callerIssuer();
        await ctx.pool.query(`INSERT INTO career_automation_settings (user_sub, auto_generate, auto_submit, owner_issuer)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_sub) DO UPDATE SET auto_generate=$2, auto_submit=$3, owner_issuer=$4, updated_at=NOW()`, [userSub, autoGenerate, autoSubmit, ownerIssuer]);
        logger.info({ userSub, autoGenerate, autoSubmit, issuerRecorded: ownerIssuer !== null }, 'career automation settings saved');
        res.json({ ok: true, autoGenerate, autoSubmit, issuerRecorded: ownerIssuer !== null });
    });
}
//# sourceMappingURL=career-automation.js.map