"use strict";
/**
 * The request plumbing every Fantasy Football route shares: who is asking, which league they name,
 * and how a league that could not be resolved is answered.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — requireSub, leagueRequestOf (an ESPN leagueId or a hand-typed manualId) and sendContextFailure, shared by fantasy-routes.ts and fantasy-manage-routes.ts so neither imports the other.
 *
 * @module fantasy-http
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSub = requireSub;
exports.leagueRequestOf = leagueRequestOf;
exports.sendContextFailure = sendContextFailure;
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const fantasy_context_1 = require("./fantasy-context");
const fantasy_feed_1 = require("./fantasy-feed");
/**
 * @description Resolve the caller or answer 401.
 * @param req - Request.
 * @param res - Response.
 * @returns The subject, or null when already answered.
 */
function requireSub(req, res) {
    const sub = (0, trading_routes_helpers_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'authentication required' });
        return null;
    }
    return sub;
}
/**
 * @description Which league a request names: `leagueId` (ESPN) or `manualId` (hand-typed).
 * @param q - Query or body.
 * @returns The league request.
 */
function leagueRequestOf(q) {
    const manual = Number(q.manualId);
    return {
        season: (0, fantasy_feed_1.seasonOf)(q.season),
        leagueId: q.leagueId ? String(q.leagueId).trim() : undefined,
        manualId: Number.isInteger(manual) && manual > 0 ? manual : undefined,
        week: Number(q.week) || undefined,
    };
}
/**
 * @description Send the refusal a failed context resolution carries; an unreachable ESPN is named as
 * the transport, never as a credential problem.
 * @param res - Response.
 * @param result - The failed result.
 * @returns Nothing.
 */
function sendContextFailure(res, result) {
    const failure = result.body.failure;
    if (result.status === 503 && failure && (0, fantasy_context_1.answerUnreachable)(res, failure))
        return;
    res.status(result.status).json(result.body);
}
//# sourceMappingURL=fantasy-http.js.map