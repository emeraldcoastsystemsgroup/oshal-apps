"use strict";
/**
 * Trading autopilot control routes — start / stop / status for the every-5-minutes paper bot.
 *
 * The autopilot itself is the deterministic multi-timeframe loop in trading-schedule-dispatch.ts,
 * driven by a per-user `trading-autopilot:<sub>` schedule on the shared scheduler. These routes are
 * the operator's switch over that schedule:
 *   POST   /api/trading/autopilot  → enable/replace (cron + universe + book) — upserts the schedule
 *   GET    /api/trading/autopilot  → status (enabled, cron, next/last run, count, universe size)
 *   DELETE /api/trading/autopilot  → stop (delete the schedule)
 *
 * Paper-only by contract (the dispatch refuses live), so no live-confirm surface here. Every route
 * is requiresAuth-gated at mount (auth is opt-in per route, CLAUDE.md) and scoped to the caller's
 * own sub — a user can only see/drive their own autopilot.
 *
 * Mounted at /api/trading/autopilot in server.ts BEFORE /api/trading so the specific path wins.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-22 12:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — enable/status/stop over the per-user trading-autopilot schedule; caller-scoped; paper-only; default ~100-name universe.
 * 2026-07-13 00:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | Seventh leg: trading-lab (ADR-092 Strategy Lab nightly forward walks + regressions) created/listed/stopped with the other advisor legs.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases — the schedule/research/assess/review/optimize/lab dispatch loops themselves STAY kernel (they are the autopilot; these routes are only the operator's switch over their schedules). Route bodies byte-identical; the factory stays zero-arg (the mounter's ctx argument is ignored) — zero behavior change.
 *
 * @module trading-autopilot-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTradingAutopilotRoutes = createTradingAutopilotRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const authz_1 = require("@/shared/middleware/authz");
const trading_1 = require("@/features/trading");
const trading_schedule_dispatch_1 = require("@/app/trading-schedule-dispatch");
const trading_research_dispatch_1 = require("@/app/trading-research-dispatch");
const trading_assess_dispatch_1 = require("@/app/trading-assess-dispatch");
const trading_review_dispatch_1 = require("@/app/trading-review-dispatch");
const trading_optimize_dispatch_1 = require("@/app/trading-optimize-dispatch");
const trading_lab_dispatch_1 = require("@/app/trading-lab-dispatch");
/** The advisor legs and their cadences. */
const RESEARCH_CRON = '*/15 * * * *';
const FAST_CRON = '*/2 * * * *';
const ASSESS_CRON = '0 */2 * * *';
const REVIEW_CRON = '30 6 * * *';
const logger = (0, logger_1.createChildLogger)({ module: 'trading-autopilot-routes' });
/** Signed-in caller's OIDC sub, or the trusted sub from an internal service-secret call
 *  (X-Service-Secret + X-OSHAL-User-Sub) so the trading_* operator tools / Jarvis can drive
 *  the autopilot on the user's behalf. Same precedence as eats/rides/spotify/purchasing. */
function callerSub(req) {
    const trusted = (0, authz_1.getTrustedServiceUserSub)(req);
    if (trusted)
        return trusted;
    const u = req.oidc?.user;
    const sub = u?.sub || u?.oid;
    return sub ? String(sub) : null;
}
/** All of the caller's trading schedules (autopilot + research + fast). */
async function findTradingSchedules(sub) {
    const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
    if (!svc)
        return [];
    const mine = await svc.listSchedules({ ownerSub: sub, scope: 'mine' });
    return mine.filter((s) => /^trading-(autopilot|research|fast|assess|review|optimize|lab)/.test(s.taskType) && s.ownerSub === sub);
}
/** The caller's autopilot schedule, if any. */
async function findAutopilot(sub) {
    return (await findTradingSchedules(sub)).find((s) => s.taskType.startsWith('trading-autopilot')) ?? null;
}
/** Shape the status payload for one schedule (or the disabled default). */
function statusOf(schedule) {
    if (!schedule)
        return { enabled: false, cron: trading_schedule_dispatch_1.AUTOPILOT_CRON_DEFAULT, defaultUniverseCount: trading_1.DEFAULT_UNIVERSE.length };
    const td = schedule.taskData;
    const universe = Array.isArray(td.universe) ? td.universe : trading_1.DEFAULT_UNIVERSE;
    return {
        enabled: schedule.status === 'active',
        cron: schedule.cron,
        mode: String(td.mode || 'paper'),
        universeCount: universe.length,
        nextRunAt: schedule.nextRunAt,
        lastRunAt: schedule.lastRunAt,
        executionCount: schedule.executionCount,
    };
}
/**
 * @description Build the autopilot control router (mount at /api/trading/autopilot behind requiresAuth).
 * @returns Express router.
 */
function createTradingAutopilotRoutes() {
    const router = (0, express_1.Router)();
    /** GET /api/trading/autopilot — advisor status (all three legs) for the caller. */
    router.get('/', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const legs = await findTradingSchedules(sub);
            const leg = (prefix) => legs.find((s) => s.taskType.startsWith(prefix)) ?? null;
            res.json({
                ok: true,
                ...statusOf(leg('trading-autopilot')),
                legs: {
                    technical: !!leg('trading-autopilot'),
                    research: !!leg('trading-research'),
                    fast: !!leg('trading-fast'),
                    assess: !!leg('trading-assess'),
                    review: !!leg('trading-review'),
                    optimize: !!leg('trading-optimize'),
                    lab: !!leg('trading-lab'),
                },
            });
        }
        catch (err) {
            logger.error({ err }, 'autopilot status failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/trading/autopilot — enable/replace the whole advisor (technical + research + fast).
     *  Body: { cron?, universe?: string[] }. Paper-only. */
    router.post('/', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
        if (!svc) {
            res.status(503).json({ error: 'scheduler_unavailable', message: 'The agent scheduler is not running (ENABLE_AGENT_SCHEDULER).' });
            return;
        }
        const b = (req.body || {});
        const cron = (typeof b.cron === 'string' && b.cron.trim()) ? b.cron.trim() : trading_schedule_dispatch_1.AUTOPILOT_CRON_DEFAULT;
        const universe = Array.isArray(b.universe) && b.universe.length
            ? [...new Set(b.universe.map((s) => String(s).toUpperCase()))].slice(0, 150)
            : trading_1.DEFAULT_UNIVERSE;
        const taskData = { userSub: sub, mode: 'paper', universe };
        try {
            const schedule = await svc.createSchedule({
                taskType: (0, trading_schedule_dispatch_1.autopilotTaskType)(sub), schedule: cron, ownerSub: sub, queue: 'intelligent-trades',
                taskData: { prompt: `Multi-timeframe paper autopilot (${universe.length} symbols)`, ...taskData },
            });
            await svc.createSchedule({
                taskType: (0, trading_research_dispatch_1.researchTaskType)(sub), schedule: RESEARCH_CRON, ownerSub: sub, queue: 'intelligent-trades',
                taskData: { prompt: 'News + fundamentals research brain (paper)', ...taskData },
            });
            await svc.createSchedule({
                taskType: (0, trading_research_dispatch_1.fastTaskType)(sub), schedule: FAST_CRON, ownerSub: sub, queue: 'intelligent-trades',
                taskData: { prompt: 'Fast breaking-news brain (paper)', ...taskData },
            });
            await svc.createSchedule({
                taskType: (0, trading_assess_dispatch_1.assessTaskType)(sub), schedule: ASSESS_CRON, ownerSub: sub, queue: 'intelligent-trades',
                taskData: { prompt: 'Next-session assessment / predictions (paper)', ...taskData },
            });
            await svc.createSchedule({
                taskType: (0, trading_review_dispatch_1.reviewTaskType)(sub), schedule: REVIEW_CRON, ownerSub: sub, queue: 'intelligent-trades',
                taskData: { prompt: 'Overnight signal review — learn per-signal mass + proximity', ...taskData },
            });
            await svc.createSchedule({
                taskType: (0, trading_optimize_dispatch_1.optimizeTaskType)(sub), schedule: trading_optimize_dispatch_1.OPTIMIZE_CRON, ownerSub: sub, queue: 'intelligent-trades',
                taskData: { prompt: 'Nightly parameter optimization — backtest tweaks, recommend (approval-gated)', ...taskData },
            });
            await svc.createSchedule({
                taskType: (0, trading_lab_dispatch_1.labTaskType)(sub), schedule: trading_lab_dispatch_1.LAB_CRON, ownerSub: sub, queue: 'intelligent-trades',
                taskData: { prompt: 'Strategy Lab — forward walks + pinned-window regressions (ADR-092)', ...taskData },
            });
            logger.info({ sub, cron, universeCount: universe.length }, 'advisor enabled (technical + research + fast + assess + review + optimize + lab)');
            res.json({
                ok: true, ...statusOf(schedule),
                legs: { technical: cron, research: RESEARCH_CRON, fast: FAST_CRON, assess: ASSESS_CRON, review: REVIEW_CRON, optimize: trading_optimize_dispatch_1.OPTIMIZE_CRON, lab: trading_lab_dispatch_1.LAB_CRON },
                note: 'Paper-only. Trade legs run only at market open; assessment runs overnight/pre-market (predictions, no orders); optimization runs nightly and only RECOMMENDS (you approve on the Tuning tab).',
            });
        }
        catch (err) {
            logger.error({ err }, 'advisor enable failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** DELETE /api/trading/autopilot — stop the whole advisor (all three legs) for the caller. */
    router.delete('/', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
        if (!svc) {
            res.status(503).json({ error: 'scheduler_unavailable' });
            return;
        }
        try {
            const legs = await findTradingSchedules(sub);
            let deleted = 0;
            for (const s of legs)
                if (await svc.deleteSchedule(s.id))
                    deleted += 1;
            logger.info({ sub, deleted }, 'advisor stopped');
            res.json({ ok: true, deleted, enabled: false });
        }
        catch (err) {
            logger.error({ err }, 'advisor stop failed');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=trading-autopilot-routes.js.map