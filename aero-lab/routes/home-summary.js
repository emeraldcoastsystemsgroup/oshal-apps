"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Owner-scoped Home summary for Aero Lab, mounted at
 *                     |                             | /api/aero-lab/home-summary: the caller's saved vehicles, how many
 *                     |                             | are sized at their current design vector, the recorded
 *                     |                             | evaluations, and the newest vehicles with their stage and what
 *                     |                             | blocks the next one (the same stageOf the vehicle record
 *                     |                             | computes on read). The concierge beside Aero Lab had nothing
 *                     |                             | of the person's record and named a structural failure no
 *                     |                             | evaluation recorded; the kernel now reads this summary into
 *                     |                             | its ON SCREEN NOW block. GET only, bounded reads, no writes; a
 *                     |                             | failed read answers 503 (said as unavailable, never zeros).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUMMARY_VEHICLES = void 0;
exports.clip = clip;
exports.buildAeroHomeSummary = buildAeroHomeSummary;
exports.createAeroHomeSummaryRoutes = createAeroHomeSummaryRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const floater_record_1 = require("./floater-record");
const vehicle_store_1 = require("./vehicle-store");
const logger = (0, logger_1.createChildLogger)({ module: 'aero-lab-home-summary' });
/** Vehicles read per summary (newest first); the record lists more on the vehicle screen. */
exports.SUMMARY_VEHICLES = 20;
/** Vehicles listed as items under the figures. */
const LISTED = 4;
/** Core Home caps: item text and detail lengths. */
const TEXT_CHARS = 120;
const DETAIL_CHARS = 400;
const FOOTNOTE = 'Counts saved vehicles only; unsaved slider designs are not counted. A stage is not a flight or safety verdict.';
/** @description Bound a text to the core cap. @param value - Any value. @param limit - Characters. @returns The clipped text. */
function clip(value, limit) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
/**
 * @description Shape the Home summary body from the caller's vehicles (newest first).
 * @param vehicles - The vehicles read, with their stage.
 * @param more - Whether the owner has more vehicles than were read.
 * @param now - The read time.
 * @returns The summary body: metrics, the same tiles, items and asOf.
 */
function buildAeroHomeSummary(vehicles, more, now) {
    const sized = vehicles.filter((v) => v.stage.stage !== 'concept').length;
    const evaluations = vehicles.reduce((sum, v) => sum + v.evaluations, 0);
    const suffix = more ? '+' : '';
    const metrics = [
        { id: 'vehicles', label: 'Saved vehicles', value: `${vehicles.length}${suffix}` },
        { id: 'sized', label: 'Sized at current design', value: `${sized}${suffix}` },
        { id: 'evaluations', label: 'Recorded evaluations', value: `${evaluations}${suffix}` },
    ];
    const items = vehicles.slice(0, LISTED).map((v) => ({
        text: clip(`${v.name}: ${v.stage.stage}`, TEXT_CHARS),
        detail: clip(vehicleDetail(v), DETAIL_CHARS),
        tone: (v.stage.blockedBy ?? []).some((b) => b.includes('RED')) ? 'warn' : 'neutral',
        fix: 'aero-lab',
    }));
    if (!vehicles.length)
        items.push({ text: 'No saved vehicles yet. Open Aero Lab to begin.', tone: 'neutral', fix: 'aero-lab' });
    items.push({ text: clip(FOOTNOTE, TEXT_CHARS), tone: 'neutral', fix: 'aero-lab' });
    return { metrics, tiles: metrics, items, asOf: now.toISOString(), partial: false };
}
/** @description One vehicle's evaluations, what blocks its next stage, and why it holds this one. */
function vehicleDetail(v) {
    const blocked = (v.stage.blockedBy ?? []).join('; ');
    return `${v.evaluations} evaluation(s) recorded. ${blocked ? `Next stage blocked by: ${blocked}. ` : ''}${v.stage.because ?? ''}`;
}
/** @description The signed-in caller as the framework stamps the request, or null. */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
/** @description Read the owner's newest vehicles with their evaluations and the stage each holds. */
async function readVehicles(pool, sub) {
    const rows = await (0, vehicle_store_1.listVehicles)(pool, sub, exports.SUMMARY_VEHICLES + 1);
    const vehicles = [];
    for (const row of rows.slice(0, exports.SUMMARY_VEHICLES)) {
        const evaluations = await (0, vehicle_store_1.listEvaluations)(pool, sub, row.vehicle_id);
        const like = evaluations.map((e) => ({ sequence: e.sequence, mediumId: e.medium_id, vectorFingerprint: e.vector_fingerprint, result: e.result }));
        vehicles.push({ name: row.name, evaluations: evaluations.length, stage: (0, floater_record_1.stageOf)(floater_record_1.FLOATER_KIND, row.design_vector, like) });
    }
    return { vehicles, more: rows.length > exports.SUMMARY_VEHICLES };
}
/**
 * @description Build the GET /api/aero-lab/home-summary router.
 * @param arg - The AppContext (with `pool`), or {ctx}.
 * @returns The router.
 */
function createAeroHomeSummaryRoutes(arg) {
    const pool = arg.ctx?.pool ?? arg.pool;
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const sub = callerSub(req);
        if (!sub)
            return void res.status(401).json({ error: 'not_authenticated' });
        try {
            const { vehicles, more } = await readVehicles(pool, sub);
            res.json(buildAeroHomeSummary(vehicles, more, new Date()));
        }
        catch (err) {
            logger.error({ err, stack: err.stack }, 'aero-lab home summary failed');
            res.status(503).json({ error: 'summary_unavailable' });
        }
    });
    return router;
}
