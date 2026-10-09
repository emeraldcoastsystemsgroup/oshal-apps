"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFuturesSchwabCaptureRoutes = createFuturesSchwabCaptureRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Give the signed-in operator explicit start, run, status and stop controls for private Schwab Futures bars.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Return active-contract session coverage diagnostics without exposing market bars.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preview and confirm bounded current-contract catch-up without arbitrary symbols or credentials.
 */
const express_1 = require("express");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const trading_schedule_dispatch_1 = require("@/app/trading-schedule-dispatch");
const trading_futures_schwab_capture_1 = require("@/app/trading-futures-schwab-capture");
const authz_1 = require("@/shared/middleware/authz");
/** @description Owner-only control rail. It never accepts a token, arbitrary symbol or order request. */
function createFuturesSchwabCaptureRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.use((req, res, next) => {
        const sub = req.oidc?.user?.sub;
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (!(0, authz_1.isOperatorIdentity)(sub)) {
            res.status(403).json({ error: 'operator_only' });
            return;
        }
        if (!ctx?.pool) {
            res.status(503).json({ error: 'schwab_capture_unavailable' });
            return;
        }
        next();
    });
    async function ownedSchedules(sub) {
        const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
        if (!svc)
            return [];
        const schedules = await svc.listSchedules({ ownerSub: sub, scope: 'mine' });
        return schedules.filter(item => item.ownerSub === sub && item.taskType === (0, trading_futures_schwab_capture_1.schwabFuturesCaptureTaskType)(sub));
    }
    function settings(raw) {
        const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const roots = body.roots === undefined ? ['ES', 'CL'] : body.roots;
        if (!Array.isArray(roots) || !roots.length || roots.length > 2 || roots.some(root => root !== 'ES' && root !== 'CL') || new Set(roots).size !== roots.length)
            throw new RangeError('Select ES, CL or both');
        const cron = body.cadence === 'half-hour' ? '7,37 * * * *' : body.cadence === undefined || body.cadence === 'hourly' ? trading_futures_schwab_capture_1.SCHWAB_FUTURES_CAPTURE_CRON : '';
        if (!cron)
            throw new RangeError('Choose hourly or half-hour capture');
        return { roots, cron };
    }
    async function capture(sub, roots) {
        const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'schwab');
        if (!token)
            return null;
        return (0, trading_futures_schwab_capture_1.captureSchwabFuturesBars)(ctx.pool, sub, token, roots);
    }
    function backfillSettings(raw) {
        const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        if (!Array.isArray(body.roots) || body.roots.some(root => typeof root !== 'string') ||
            typeof body.fromDate !== 'string' || typeof body.throughDate !== 'string')
            throw new RangeError('Choose roots and UTC dates');
        return { roots: body.roots, fromDate: body.fromDate, throughDate: body.throughDate,
            confirmation: typeof body.confirmation === 'string' ? body.confirmation : '' };
    }
    router.post('/backfill/preview', (req, res) => {
        try {
            const { roots, fromDate, throughDate } = backfillSettings(req.body);
            const plan = (0, trading_futures_schwab_capture_1.planSchwabCurrentBackfill)(roots, fromDate, throughDate);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ plan });
        }
        catch {
            res.status(400).json({ error: 'invalid_backfill_settings' });
        }
    });
    router.post('/backfill', async (req, res) => {
        try {
            const { roots, fromDate, throughDate, confirmation } = backfillSettings(req.body);
            const now = Date.now(), plan = (0, trading_futures_schwab_capture_1.planSchwabCurrentBackfill)(roots, fromDate, throughDate, now);
            if (confirmation !== plan.fingerprint) {
                res.status(409).json({ error: 'backfill_preview_changed' });
                return;
            }
            const sub = req.oidc.user.sub, token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'schwab');
            if (!token) {
                res.status(409).json({ error: 'schwab_connection_not_available' });
                return;
            }
            const receipt = await (0, trading_futures_schwab_capture_1.backfillSchwabCurrentFuturesBars)(ctx.pool, sub, token, roots, fromDate, throughDate, confirmation, fetch, now);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ receipt });
        }
        catch (error) {
            res.status(error instanceof RangeError ? 400 : 503).json({ error: error instanceof RangeError ? 'invalid_backfill_settings' : 'schwab_backfill_failed' });
        }
    });
    router.get('/', async (req, res) => {
        try {
            const sub = req.oidc.user.sub;
            const [coverage, health, schedules] = await Promise.all([(0, trading_futures_schwab_capture_1.listSchwabFuturesCoverage)(ctx.pool, sub), (0, trading_futures_schwab_capture_1.listSchwabFuturesHealth)(ctx.pool, sub), ownedSchedules(sub)]);
            const schedule = schedules[0];
            res.setHeader('Cache-Control', 'no-store');
            res.json({ coverage, health, enabled: schedule?.status === 'active', schedule: schedule ? {
                    cron: schedule.cron, roots: schedule.taskData.roots,
                    lastRunAt: schedule.lastRunAt, nextRunAt: schedule.nextRunAt, status: schedule.status
                } : null });
        }
        catch {
            res.status(503).json({ error: 'schwab_capture_unavailable' });
        }
    });
    router.post('/run', async (req, res) => {
        try {
            const { roots } = settings(req.body);
            const receipt = await capture(req.oidc.user.sub, roots);
            if (!receipt) {
                res.status(409).json({ error: 'schwab_connection_not_available' });
                return;
            }
            res.setHeader('Cache-Control', 'no-store');
            res.json({ receipt });
        }
        catch (error) {
            res.status(error instanceof RangeError ? 400 : 503).json({ error: error instanceof RangeError ? 'invalid_capture_settings' : 'schwab_capture_failed' });
        }
    });
    router.post('/enable', async (req, res) => {
        const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
        if (!svc) {
            res.status(503).json({ error: 'scheduler_unavailable' });
            return;
        }
        const sub = req.oidc.user.sub;
        try {
            const { roots, cron } = settings(req.body);
            if ((await ownedSchedules(sub)).length) {
                res.status(409).json({ error: 'schwab_capture_already_enabled' });
                return;
            }
            // First prove a complete capture. Never arm an empty or invalid provider source.
            const receipt = await capture(sub, roots);
            if (!receipt) {
                res.status(409).json({ error: 'schwab_connection_not_available' });
                return;
            }
            const schedule = await svc.createSchedule({ taskType: (0, trading_futures_schwab_capture_1.schwabFuturesCaptureTaskType)(sub),
                schedule: cron, timezone: 'Etc/UTC', ownerSub: sub,
                queue: 'intelligent-trades', taskData: { prompt: 'Owner-approved read-only Schwab Futures bar capture', userSub: sub, roots, mode: 'paper' } });
            res.setHeader('Cache-Control', 'no-store');
            res.json({ receipt, schedule: { cron: schedule.cron, nextRunAt: schedule.nextRunAt, status: schedule.status } });
        }
        catch (error) {
            res.status(error instanceof RangeError ? 400 : 503).json({ error: error instanceof RangeError ? 'invalid_capture_settings' : 'schwab_capture_failed' });
        }
    });
    router.delete('/', async (req, res) => {
        try {
            const schedules = await ownedSchedules(req.oidc.user.sub);
            const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
            let stopped = 0;
            if (svc)
                for (const schedule of schedules)
                    if (await svc.deleteSchedule(schedule.id))
                        stopped++;
            res.json({ stopped: stopped > 0, retainedBars: true });
        }
        catch {
            res.status(503).json({ error: 'schwab_capture_unavailable' });
        }
    });
    return router;
}
//# sourceMappingURL=trading-futures-schwab-capture-routes.js.map