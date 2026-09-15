"use strict";
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
exports.collectCompletedReports = collectCompletedReports;
exports.createCompletedReportBriefingRoutes = createCompletedReportBriefingRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reconcile bounded recorded reports through the registered exact-owner briefing transaction and existing scheduler.
 */
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const taskStore = __importStar(require("@/app/routes/jarvis-task-store"));
const jarvis_briefing_delivery_1 = require("@/app/routes/jarvis-briefing-delivery");
const request_identity_1 = require("@/shared/services/database/request-identity");
const SESSION = 'daily-trade-recap-recorded-reports';
const LIMIT = 50;
const ADMISSION_BUDGET_MS = 10_000;
function recordedReport(row) {
    if (typeof row.user_sub !== 'string' || !row.user_sub.trim() || row.user_sub.length > 512)
        return null;
    if (row.user_sub !== row.user_sub.trim() || /[\u0000-\u001f\u007f]/.test(row.user_sub))
        return null;
    if (typeof row.et_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.et_day))
        return null;
    const parsed = new Date(`${row.et_day}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.et_day)
        return null;
    if (typeof row.summary !== 'string' || !row.summary.trim())
        return null;
    return { sub: row.user_sub, day: row.et_day, summary: row.summary.replace(/\s+/g, ' ').trim().slice(0, 500) };
}
async function recordedRows(ctx, now) {
    const query = {
        text: `SELECT user_sub,et_day::text,LEFT(summary,500) AS summary FROM oshal_trading_strategy_journal
      WHERE kind='report' AND source='daily-report'
        AND created_at >= $1::timestamptz - INTERVAL '72 hours' AND created_at <= $1
        AND et_day <= $1::date ORDER BY created_at DESC,id DESC LIMIT $2`,
        values: [now.toISOString(), LIMIT], query_timeout: 2_000,
    };
    const result = await (0, request_identity_1.runWithSystemIdentity)(() => ctx.pool.query(query));
    return result.rows.slice(0, LIMIT);
}
async function admitRows(rows, startedAt) {
    const counts = { inspected: 0, queued: 0, deferred: 0, invalid: 0, budgetReached: false };
    for (const row of rows) {
        if (Date.now() - startedAt >= ADMISSION_BUDGET_MS) {
            counts.budgetReached = true;
            break;
        }
        counts.inspected += 1;
        const report = recordedReport(row);
        if (!report) {
            counts.invalid += 1;
            continue;
        }
        const hash = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([report.sub, report.day])).digest('hex');
        const title = `Trading report recorded for ${report.day}`;
        const result = `${title}. ${report.summary}\nThis records the report journal; it does not confirm email or site delivery.`;
        const accepted = await taskStore.saveCompletedBriefing(`daily-trade-recap:report:${hash}`, report.sub, SESSION, title, result);
        if (accepted)
            counts.queued += 1;
        else
            counts.deferred += 1;
    }
    return counts;
}
/**
 * @description Reconcile existing recorded reports without generating reports, trading or sending outward messages.
 * @param ctx - Package-bound framework context; recipient identity comes only from recorded owner fields.
 * @returns Aggregate scheduler metadata without report text or owner identifiers.
 */
async function collectCompletedReports(ctx) {
    const runtime = (0, jarvis_briefing_delivery_1.getJarvisBriefingDelivery)();
    if (typeof taskStore.saveCompletedBriefing !== 'function' || !runtime) {
        return { state: 'unavailable', summary: 'Recorded-report briefings require the registered completed-briefing runtime.' };
    }
    try {
        if (!await runtime.service.isProducerSession(SESSION))
            return { state: 'unavailable', summary: 'Recorded-report briefing source is not registered.' };
        const startedAt = Date.now();
        const counts = await admitRows(await recordedRows(ctx, new Date(startedAt)), startedAt);
        return { state: counts.deferred || counts.budgetReached ? 'deferred' : 'available', counts,
            summary: `Recorded reports: ${counts.inspected} inspected, ${counts.queued} queued, ${counts.deferred} deferred or already queued, ${counts.invalid} invalid; admission budget ${counts.budgetReached ? 'reached' : 'available'}.` };
    }
    catch {
        return { state: 'unavailable', summary: 'Recorded-report briefing collection is unavailable; a later scheduled run can retry.' };
    }
}
/**
 * @description Expose the same fixed collector under the manifest's service-authenticated route.
 * @param ctx - Package-bound context; request bodies cannot supply recipients or results.
 * @returns Router with the existing deterministic service-route entry point.
 */
function createCompletedReportBriefingRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.post('/collect', async (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const result = await collectCompletedReports(ctx);
        res.status(result.state === 'unavailable' ? 503 : result.state === 'deferred' ? 202 : 200).json(result);
    });
    return router;
}
//# sourceMappingURL=completed-report-briefings.js.map