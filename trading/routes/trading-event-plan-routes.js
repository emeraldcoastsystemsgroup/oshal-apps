"use strict";
/**
 * Event playbooks (ADR-136 D6) — a one-off IPO entry/exit the operator designs in the Strategy
 * Studio and arms on a SELECTED account. The Studio refused "the Anthropic IPO" because it only knew
 * rotations; this module is the store half of the fix. The kernel (@/app/trading-event-plans) owns
 * the plan store, the parameter clamps, the dry-run arithmetic and the every-5-minutes executor
 * state machine (EDGAR S-1/424B4 watch → first-trade limit at IPO price × (1 + premium cap) →
 * take-profit / stop off the IPO "strike" → time stop); these routes are the operator's surface
 * over it plus the Studio's event branch.
 *
 *   GET    /api/trading/events/plans            → this book's plans + every plan + enabled/scheduled
 *   GET    /api/trading/events/plans/:id        → one plan + its dry-run at the account's equity
 *   POST   /api/trading/events/plans            → create a draft on the resolved book (201)
 *   PATCH  /api/trading/events/plans/:id        → rename / re-parameterize (kernel locks once entered)
 *   POST   /api/trading/events/plans/:id/arm    → confirm-gated (428); arms + ensures the per-user schedule
 *   POST   /api/trading/events/plans/:id/disarm → cancels working orders when needed → cancelled
 *   DELETE /api/trading/events/plans/:id        → only draft|cancelled|closed|missed (kernel rule)
 *
 * Every handler resolves the caller via callerSub (401) and the book QUERY-FIRST
 * (`?book=` rides every surface fetch; body.book wins only when the query is silent — the 2026-09-03
 * paper-routing class, where a body/query split sent every order to PAPER regardless of the
 * selected account). Equity for the dry-run comes from the book's broker reader and is null on ANY
 * failure — never a fabricated number.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the seven event-plan routes (list/get/create/patch/arm/disarm/delete) over the kernel event-plan store, arm confirm-gated (428) + per-user 'trading-events:<sub>' schedule upsert in America/New_York (503 scheduler_unavailable before any state change), view-only books may hold a draft with a warning, TradingError → its status/code else logger.error + 502; and respondEventStudioTurn — the Studio's event branch (IPO research selection, equity read, eventPlanPrompt → parseEventPlanReply → normalizeEventPlanParams → create or refine-in-place, needsInput on a prose-only reply, notBacktestable + dryRun in the response).
 *
 * @module trading-event-plan-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.equityForBook = equityForBook;
exports.registerTradingEventPlanRoutes = registerTradingEventPlanRoutes;
exports.respondEventStudioTurn = respondEventStudioTurn;
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_books_store_1 = require("@/app/trading-books-store");
const trading_schedule_dispatch_1 = require("@/app/trading-schedule-dispatch");
const free_tier_rotation_1 = require("@/app/routes/free-tier-rotation");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const trading_event_plans_1 = require("@/app/trading-event-plans");
const trading_strategy_research_1 = require("./trading-strategy-research");
const trading_strategy_studio_prompt_1 = require("./trading-strategy-studio-prompt");
const logger = (0, logger_1.createChildLogger)({ module: 'trading-event-plan-routes' });
/** The note the arm response carries while the server-side executor flag is off. */
const EXECUTOR_OFF_NOTE = 'TRADING_EVENT_PLANS is off on this server — the plan is armed but the executor will not fire until it is enabled.';
/** The warning a draft on a view-only account carries. */
const VIEW_ONLY_WARNING = 'This account is view-only — the plan cannot buy until you Start trading on it.';
/** Why an event playbook has no backtest — the Studio response says it every turn. */
const NOT_BACKTESTABLE = 'The issuer is not listed yet, so there is no price history to backtest; the dry-run shows exactly what the executor would place at example IPO prices.';
/**
 * @description Resolve the caller's sub or answer 401 — shared by every handler.
 * @param req - The request.
 * @param res - The response (401 written when unauthenticated).
 * @returns The sub, or null after the 401 was sent.
 */
function sub(req, res) {
    const s = (0, trading_routes_helpers_1.callerSub)(req);
    if (!s)
        res.status(401).json({ error: 'not_authenticated' });
    return s;
}
/**
 * @description Resolve the SELECTED book QUERY-FIRST: `?book=` (the surface's selected account rides
 * every fetch), then body.book, then the legacy `mode` aliases in the same order.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param req - The request.
 * @returns The resolved TradingBook (400 unknown_book on a garbage ref, never a silent paper remap).
 */
function resolveRequestBook(ctx, s, req) {
    const b = (req.body || {});
    return (0, trading_routes_helpers_1.resolveBook)(ctx.pool, s, req.query.book ?? b.book ?? req.query.mode ?? b.mode);
}
/**
 * @description Route failure → a TradingError's own status/code, else a logged 502.
 * @param res - The response.
 * @param err - The thrown value.
 * @param what - The handler, for the log line.
 */
function fail(res, err, what) {
    if (err instanceof trading_routes_helpers_1.TradingError) {
        res.status(err.httpStatus).json({ error: err.code, message: err.message });
        return;
    }
    logger.error({ err, what }, 'event plan route failed');
    res.status(502).json({ error: err.message || 'event_plan_failed' });
}
/**
 * @description The account's live equity from the book's broker reader — the dry-run's sizing input.
 * Null on ANY failure (no book, unconfigured rail, dropped login, venue error): a dry-run sized off
 * a guessed equity would show orders the executor will never place.
 * @param s - Caller sub.
 * @param book - The book, or null when it could not be loaded.
 * @returns Equity in USD, or null.
 */
async function equityForBook(s, book) {
    if (!book)
        return null;
    try {
        const binding = book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined;
        const reader = (0, trading_1.getBrokerReader)(book.kind, s, binding);
        if (!reader.configured())
            return null;
        const equity = (await reader.getAccount()).equity;
        return Number.isFinite(equity) ? equity : null;
    }
    catch (err) {
        logger.error({ err, book: book.ref }, 'event plan equity read failed — dry-run runs without equity');
        return null;
    }
}
/**
 * @description Equity for the book a stored plan belongs to (loadBook → reader); null on any failure.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param plan - The stored plan.
 * @returns Equity in USD, or null.
 */
async function planEquity(ctx, s, plan) {
    try {
        return await equityForBook(s, await (0, trading_books_store_1.loadBook)(ctx.pool, s, plan.bookId));
    }
    catch (err) {
        logger.error({ err, planId: plan.planId, bookId: plan.bookId }, 'event plan book load failed — dry-run runs without equity');
        return null;
    }
}
/**
 * @description Whether the caller's 'trading-events:<sub>' schedule exists and is active.
 * @param s - Caller sub.
 * @returns True only for an active, owner-matching schedule; false when the scheduler is absent.
 */
async function eventScheduleActive(s) {
    const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
    if (!svc)
        return false;
    const taskType = (0, trading_event_plans_1.eventPlanTaskType)(s);
    const mine = await svc.listSchedules({ ownerSub: s, scope: 'mine' });
    return mine.some((r) => r.taskType === taskType && r.ownerSub === s && r.status === 'active');
}
/**
 * @description Coerce the optional free-text fields of a create/patch body (null clears, undefined keeps).
 * @param v - The raw field.
 * @param max - Max length kept.
 * @returns The trimmed string, null, or undefined.
 */
function optText(v, max) {
    if (v === undefined)
        return undefined;
    if (v === null)
        return null;
    return String(v).trim().slice(0, max);
}
/** The citation projection every response carries (the same shape the rotation studio returns). */
function citationView(c) {
    return { id: c.id, name: c.name, authors: c.authors, year: c.year, journal: c.journal, url: c.url };
}
/**
 * @description Registers the event-playbook routes on the trading router (ADR-136 D6).
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool).
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingEventPlanRoutes(router, ctx) {
    registerPlanReads(router, ctx);
    registerPlanWrites(router, ctx);
    registerPlanLifecycle(router, ctx);
}
/** The two reads: the list for the SELECTED book and one plan with its dry-run. */
function registerPlanReads(router, ctx) {
    /** GET /events/plans — the SELECTED book's plans, every plan, and the executor/schedule state. */
    router.get('/events/plans', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        try {
            await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
            const book = await resolveRequestBook(ctx, s, req);
            const [plans, allPlans, scheduled] = await Promise.all([
                (0, trading_event_plans_1.listEventPlans)(ctx.pool, s, { bookId: book.bookId }), (0, trading_event_plans_1.listEventPlans)(ctx.pool, s), eventScheduleActive(s),
            ]);
            res.json({ plans, allPlans, enabled: (0, trading_event_plans_1.eventPlansEnabled)(), scheduled, book: book.ref });
        }
        catch (err) {
            fail(res, err, 'list');
        }
    });
    /** GET /events/plans/:id — one plan + its dry-run at the account's current equity. */
    router.get('/events/plans/:id', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        try {
            await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
            const plan = await (0, trading_event_plans_1.getEventPlan)(ctx.pool, s, String(req.params.id));
            if (!plan) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            res.json({ plan, dryRun: (0, trading_event_plans_1.dryRunEventPlan)(plan, await planEquity(ctx, s, plan)) });
        }
        catch (err) {
            fail(res, err, 'get');
        }
    });
}
/** Create + patch — the draft's parameters, re-clamped by the kernel on every write. */
function registerPlanWrites(router, ctx) {
    /** POST /events/plans — create a DRAFT on the resolved book. A view-only account may hold a draft
     *  (the warning says it cannot buy); arming is the separate, confirm-gated step. */
    router.post('/events/plans', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const b = (req.body || {});
        const name = String(b.name || '').trim().slice(0, 80);
        if (!name) {
            res.status(400).json({ error: 'name_required', message: 'Give the playbook a name.' });
            return;
        }
        try {
            await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
            const book = await resolveRequestBook(ctx, s, req);
            const params = (0, trading_event_plans_1.normalizeEventPlanParams)(b.params);
            const plan = await (0, trading_event_plans_1.createEventPlan)(ctx.pool, s, {
                book, name, params, hypothesis: optText(b.hypothesis, 1000) ?? null, narration: optText(b.narration, 2000) ?? null,
                citations: Array.isArray(b.citations) ? b.citations : [],
            });
            logger.info({ sub: s, planId: plan.planId, book: book.ref, issuer: params.issuer }, 'event plan created');
            res.status(201).json({ plan, dryRun: (0, trading_event_plans_1.dryRunEventPlan)(plan, await equityForBook(s, book)), warning: book.enabled ? null : VIEW_ONLY_WARNING });
        }
        catch (err) {
            fail(res, err, 'create');
        }
    });
    /** PATCH /events/plans/:id — rename / re-parameterize. Params merge over the stored ones and are
     *  re-clamped by the kernel; the kernel refuses (409 plan_locked) once the plan has entered. */
    router.patch('/events/plans/:id', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const b = (req.body || {});
        try {
            await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
            const current = await (0, trading_event_plans_1.getEventPlan)(ctx.pool, s, String(req.params.id));
            if (!current) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            const patch = {};
            if (b.name !== undefined)
                patch.name = String(b.name).trim().slice(0, 80);
            if (b.params !== undefined)
                patch.params = (0, trading_event_plans_1.normalizeEventPlanParams)({ ...current.params, ...(b.params && typeof b.params === 'object' ? b.params : {}) });
            if (b.hypothesis !== undefined)
                patch.hypothesis = optText(b.hypothesis, 1000);
            if (b.narration !== undefined)
                patch.narration = optText(b.narration, 2000);
            if (Array.isArray(b.citations))
                patch.citations = b.citations;
            const plan = await (0, trading_event_plans_1.updateEventPlan)(ctx.pool, s, current.planId, patch);
            if (!plan) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            res.json({ plan, dryRun: (0, trading_event_plans_1.dryRunEventPlan)(plan, await planEquity(ctx, s, plan)) });
        }
        catch (err) {
            fail(res, err, 'patch');
        }
    });
}
/** Arm / disarm / delete — the lifecycle transitions the kernel state machine allows. */
function registerPlanLifecycle(router, ctx) {
    /** POST /events/plans/:id/arm — confirm-gated: arming lets the executor place REAL orders on the
     *  book once the issuer lists. Checks the scheduler BEFORE arming so a 503 changes nothing. */
    router.post('/events/plans/:id/arm', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const b = (req.body || {});
        if (b.confirm !== true) {
            res.status(428).json({ error: 'confirm_required', message: 'Arming lets the executor buy on the listing day — resend with confirm:true.' });
            return;
        }
        const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
        if (!svc) {
            res.status(503).json({ error: 'scheduler_unavailable', message: 'The agent scheduler is not running (ENABLE_AGENT_SCHEDULER).' });
            return;
        }
        try {
            await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
            const plan = await (0, trading_event_plans_1.armEventPlan)(ctx.pool, s, String(req.params.id));
            await svc.createSchedule({
                taskType: (0, trading_event_plans_1.eventPlanTaskType)(s), schedule: trading_event_plans_1.EVENT_PLANS_CRON, timezone: trading_event_plans_1.EVENT_PLANS_TIMEZONE, ownerSub: s, queue: 'intelligent-trades',
                taskData: { prompt: 'Event playbooks — IPO watch/entry/exit state machine', userSub: s },
            });
            const enabled = (0, trading_event_plans_1.eventPlansEnabled)();
            logger.info({ sub: s, planId: plan.planId, book: plan.bookRef, enabled }, 'event plan ARMED + schedule ensured');
            res.json({ plan, scheduled: true, enabled, note: enabled ? null : EXECUTOR_OFF_NOTE });
        }
        catch (err) {
            fail(res, err, 'arm');
        }
    });
    /** POST /events/plans/:id/disarm — cancels working orders when needed, then → cancelled. */
    router.post('/events/plans/:id/disarm', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        try {
            await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
            const plan = await (0, trading_event_plans_1.disarmEventPlan)(ctx, s, String(req.params.id));
            logger.info({ sub: s, planId: plan.planId, status: plan.status }, 'event plan disarmed');
            res.json({ plan });
        }
        catch (err) {
            fail(res, err, 'disarm');
        }
    });
    /** DELETE /events/plans/:id — only draft|cancelled|closed|missed (the kernel refuses the rest). */
    router.delete('/events/plans/:id', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        try {
            await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
            res.json({ deleted: await (0, trading_event_plans_1.deleteEventPlan)(ctx.pool, s, String(req.params.id)) });
        }
        catch (err) {
            fail(res, err, 'delete');
        }
    });
}
/**
 * @description Ask the trading-analyst for the playbook (same executeBotOrInline path as the rotation
 * studio, so cost lands in chat_tasks under the analyst's agent_id).
 * @param ctx - App context.
 * @param turn - The studio turn.
 * @param findings - The IPO findings offered.
 * @param equity - The book's equity, or null.
 * @returns The bot's raw reply text.
 */
async function askEventAnalyst(ctx, turn, findings, equity) {
    const current = turn.existingPlan ? { name: turn.existingPlan.name, plan: turn.existingPlan.params } : undefined;
    const byoLlmConnection = await (0, free_tier_rotation_1.resolveUserLlmConnection)(ctx.pool, turn.sub);
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, turn.botClient, turn.agentId, {
        text: (0, trading_strategy_studio_prompt_1.eventPlanPrompt)(turn.message, findings, turn.book.ref, equity, current),
        taskId: `trading-studio-${turn.sub}`, workspaceFolderId: `trading-${turn.sub}`,
        agentId: turn.agentId, agenticMode: true, direct: true, userSub: turn.sub, byoLlmConnection,
    });
    return String(result.response || '').trim();
}
/**
 * @description Persist the parsed design: create a draft on the book, or refine the existing plan IN
 * PLACE (omitted params keep their stored values — the contract is "change only what was asked").
 * @param ctx - App context.
 * @param turn - The studio turn.
 * @param parsed - The parsed reply.
 * @returns The stored plan row.
 */
async function persistEventDesign(ctx, turn, parsed) {
    const rawPlan = (parsed.plan && typeof parsed.plan === 'object' ? parsed.plan : {});
    const citations = parsed.citations.map(citationView);
    if (turn.existingPlan) {
        const params = (0, trading_event_plans_1.normalizeEventPlanParams)({ ...turn.existingPlan.params, ...rawPlan });
        const row = await (0, trading_event_plans_1.updateEventPlan)(ctx.pool, turn.sub, turn.existingPlan.planId, { params, hypothesis: parsed.hypothesis, narration: parsed.narration, citations });
        if (!row)
            throw new trading_routes_helpers_1.TradingError(404, 'plan_not_found', 'The event plan being refined no longer exists.');
        return row;
    }
    const params = (0, trading_event_plans_1.normalizeEventPlanParams)(rawPlan);
    return (0, trading_event_plans_1.createEventPlan)(ctx.pool, turn.sub, { book: turn.book, name: parsed.name, params, hypothesis: parsed.hypothesis, narration: parsed.narration, citations });
}
/**
 * @description The Studio's event branch (ADR-136 D6): select the IPO research, read the account's
 * equity, run the analyst, parse (a prose-only reply is a clarifying question → needsInput), create
 * or refine the plan, and answer with the plan + its dry-run. Own try/catch so the rotation route's
 * error path stays untouched: TradingError → its status/code (400 bad params, 409 plan_locked), else 502.
 * @param ctx - App context.
 * @param res - The response to write.
 * @param turn - The studio turn.
 * @returns Nothing — the response is written here.
 */
async function respondEventStudioTurn(ctx, res, turn) {
    try {
        await (0, trading_event_plans_1.ensureEventPlansSchema)(ctx.pool);
        const findings = (0, trading_strategy_research_1.selectResearch)(`${turn.message} ipo initial public offering listing`, 4);
        const equity = await equityForBook(turn.sub, turn.book);
        const raw = await askEventAnalyst(ctx, turn, findings, equity);
        let parsed;
        try {
            parsed = (0, trading_strategy_studio_prompt_1.parseEventPlanReply)(raw, findings);
        }
        catch (err) {
            const question = (0, trading_strategy_studio_prompt_1.stripBotFences)(raw);
            if (!question)
                throw new Error('empty bot reply');
            logger.warn({ err, sub: turn.sub }, 'event studio reply carried no json — returning it as a clarifying question');
            res.json({ needsInput: true, message: question.slice(0, 2000) });
            return;
        }
        const plan = await persistEventDesign(ctx, turn, parsed);
        logger.info({ sub: turn.sub, planId: plan.planId, refined: !!turn.existingPlan, book: turn.book.ref, cites: parsed.citations.map((c) => c.id) }, 'studio event playbook designed');
        res.json({
            kind: 'event', strategyId: plan.planId, planId: plan.planId, name: plan.name, refined: !!turn.existingPlan,
            hypothesis: parsed.hypothesis, narration: parsed.narration, manualSteps: parsed.manualSteps,
            citations: parsed.citations.map(citationView),
            plan, dryRun: (0, trading_event_plans_1.dryRunEventPlan)(plan, equity), account: turn.book.ref,
            armed: plan.status !== 'draft' && plan.status !== 'cancelled',
            notBacktestable: NOT_BACKTESTABLE,
        });
    }
    catch (err) {
        fail(res, err, 'studio');
    }
}
//# sourceMappingURL=trading-event-plan-routes.js.map