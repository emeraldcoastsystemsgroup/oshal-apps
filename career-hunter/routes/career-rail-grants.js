"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAREER_RAIL_TARGET = void 0;
exports.verifyCareerRailRequest = verifyCareerRailRequest;
exports.createCareerRailCallbackVerifier = createCareerRailCallbackVerifier;
exports.admittedRunOf = admittedRunOf;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The package half of the kernel's signed-package-callbacks contract for the Career worker rail (1.25.1). Under ADR-149 enforce the kernel refused every engine-child completion with authorization_identity_required before routes/career-worker-rail.js ran, because a service-secret caller has no verified identity; the manifest's callbackVerifier now runs first, reads the exact body the signature covers, verifies the per-run grant the runner minted (lib/career-engine-runs.js: owner, timestamp, HMAC over method, path and body hash, single-use nonce, live run with a recorded owner issuer) and returns only that run's recorded (subject, issuer) for the kernel to refresh and authorize. The admitted run is remembered for this request object only, and the handler reads it rather than verifying a second time, which would also spend the nonce twice.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Drop the exported CAREER_RAIL_MOUNT constant: nothing read it (the verifier compares the request target against CAREER_RAIL_TARGET, which the run registry owns), and an unused export of the mount path invites a second copy of a value the manifest already declares.
 */
/**
 * Career worker rail grants — verification glue between the kernel's callback rail and the
 * package's in-process run registry.
 *
 * The engine child is a child of THIS controller process and calls back over its own loopback
 * listener, so the run registry (and with it every grant) lives in memory: a run cannot outlive
 * the process that spawned it, and a restarted controller admits nothing minted before it.
 *
 * @module career-rail-grants
 */
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const engineRuns = require('../lib/career-engine-runs');
const logger = (0, logger_1.createChildLogger)({ module: 'career-rail-grants' });
/** The one request the rail serves, as the controller receives it (mount plus route path). */
exports.CAREER_RAIL_TARGET = engineRuns.RAIL_PATH;
/** Runs the verifier admitted, keyed by the request object; nothing a client sends can attach one. */
const admitted = new WeakMap();
/** Read the request body with one raw parser, resolving false when the parser refuses it. */
function readBody(reader, req) {
    return new Promise((resolve) => {
        reader(req, {}, (err) => {
            if (err)
                logger.warn({ err, path: req.path }, 'career rail request body refused');
            resolve(!err);
        });
    });
}
/**
 * @description Verify one rail request: only POST /complete under the rail's own content type
 * and byte ceiling (the signature covers the exact body bytes, so this reads them), then the
 * per-run grant. The admitted run is remembered for this request object.
 * @param req - The request, before the mount prefix is stripped.
 * @returns The admitted run, or the refusal reason (logged; the kernel answers every refusal alike).
 */
async function verifyCareerRailRequest(req) {
    const target = String(req.originalUrl || req.url).split('?', 1)[0];
    if (req.method !== 'POST' || target !== exports.CAREER_RAIL_TARGET) {
        logger.warn({ method: req.method, path: target }, 'career rail request refused: unknown route');
        return { ok: false, error: 'rail_route_unknown' };
    }
    const reader = (0, express_1.raw)({ type: engineRuns.RAIL_CONTENT_TYPE, limit: engineRuns.railLimits().maxBodyBytes });
    if (!(await readBody(reader, req)) || !Buffer.isBuffer(req.body))
        return { ok: false, error: 'rail_body_refused' };
    const result = engineRuns.verifyRailRequest({ method: req.method, target, headers: req.headers, body: req.body });
    if (result.ok)
        admitted.set(req, result.run);
    else
        logger.warn({ error: result.error, path: target }, 'career rail request refused');
    return result;
}
/**
 * @description The manifest's `callbackVerifier` for the rail mount (kernel skill
 * `signed-package-callbacks`). It returns only the verified run's recorded owner subject and
 * issuer, never anything the request asserts, so the kernel refreshes that owner and checks the
 * catalog permission bound to POST /complete before the handler runs as that owner. Any refusal
 * returns null.
 * @param _ctx - Package app context (the registry is process-wide; nothing is read from it).
 * @returns The request verifier the route mounter calls.
 */
function createCareerRailCallbackVerifier(_ctx) {
    return async (req) => {
        const verdict = await verifyCareerRailRequest(req);
        if (!verdict.ok || !verdict.run.ownerIssuer)
            return null;
        return { sub: verdict.run.owner, issuer: verdict.run.ownerIssuer };
    };
}
/**
 * @description The run the verifier admitted for this request.
 * @param req - A rail request.
 * @returns The admitted run, or null when none was.
 */
function admittedRunOf(req) {
    return admitted.get(req) ?? null;
}
//# sourceMappingURL=career-rail-grants.js.map